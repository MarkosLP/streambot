/**
 * Informe de El Linde del Velo sobre la base de datos REAL, en solo lectura.
 * Para antes y después de la prueba supervisada con chat real
 * (docs/MMO-PRUEBA-SUPERVISADA.md). No escribe nada, no se conecta a
 * Streamer.bot ni a OBS y no envía mensajes. Se puede pasar con el bot en marcha.
 *
 *   npm run mmo:informe            (data/crid4m.sqlite o DB_PATH del .env)
 *   npm run mmo:informe -- otra.sqlite
 *
 * Sale con código 1 si alguna comprobación falla.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { config } from '../config.js';

const ruta = process.argv[2] ?? config.dbPath;
if (!existsSync(ruta)) {
  console.error(`No existe ${ruta}.`);
  process.exit(1);
}
const db = new DatabaseSync(ruta, { readOnly: true });
const tablas = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((t) => t.name));
if (!tablas.has('mmo_world')) {
  console.log('El Linde del Velo todavía no existe en esta base de datos (el bot nunca lo ha arrancado).');
  process.exit(0);
}
const columnas = new Set((db.prepare('PRAGMA table_info(mmo_world)').all() as Array<{ name: string }>).map((c) => c.name));
const uno = <T>(sql: string, ...args: Array<string | number>) => db.prepare(sql).get(...args) as T | undefined;
const n = (sql: string, ...args: Array<string | number>) => (uno<{ n: number }>(sql, ...args)?.n ?? 0);
const ahora = Date.now();
const hora = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString('es-ES') : '—');
const hace = (ms: number) => {
  const s = Math.round((ahora - ms) / 1000);
  return s < 120 ? `hace ${s} s` : s < 7200 ? `hace ${Math.round(s / 60)} min` : `hace ${Math.round(s / 3600)} h`;
};

const w = uno<Record<string, number | string | null>>('SELECT * FROM mmo_world WHERE id = 1');
console.log('\n== El Linde del Velo ==');
console.log(`Base de datos: ${ruta} (solo lectura)`);
if (!w) {
  console.log('El mundo no tiene fila todavía: nadie lo ha usado.');
  process.exit(0);
}
const latido = columnas.has('latido_ms') ? (w.latido_ms as number | null) : null;
console.log(`Modo: ${w.modo} · fase: ${w.fase} · expedición ${w.expedicion_id} · ${w.progreso}/${w.meta}`);
console.log(`Plazo: ${hora(w.hasta_ms as number)}${w.pausado_ms ? ` · CONGELADO desde ${hora(w.pausado_ms as number)}` : ''}`);
console.log(`Último latido del bot: ${latido ? `${hora(latido)} (${hace(latido)})` : 'nunca (bot anterior a la recuperación)'}`);
console.log(`Último suceso: ${w.ultimo_suceso || '—'}`);

const completadas = n('SELECT COUNT(*) AS n FROM mmo_resultados WHERE completada = 1');
const cerradas = n('SELECT COUNT(*) AS n FROM mmo_resultados WHERE completada = 0');
console.log(`\nExpediciones: ${completadas} completadas, ${cerradas} cerradas sin completar.`);
if (tablas.has('mmo_reliquias')) console.log(`Reliquias en la Lumbre: ${n('SELECT COUNT(*) AS n FROM mmo_reliquias')} de 60.`);
console.log(`Jugadores con renombre: ${n('SELECT COUNT(*) AS n FROM mmo_jugadores')}.`);

const fallos: string[] = [];
const avisos: string[] = [];
const comprobar = (ok: boolean, texto: string) => {
  console.log(`  ${ok ? 'OK   ' : 'FALLO'} ${texto}`);
  if (!ok) fallos.push(texto);
};
console.log('\nComprobaciones:');
comprobar(n(`SELECT COUNT(*) AS n FROM mmo_premios p LEFT JOIN mmo_resultados r ON r.expedicion_id = p.expedicion_id
  WHERE r.completada IS NOT 1`) === 0, 'Solo hay premios en expediciones completadas.');
comprobar(n(`SELECT COUNT(*) AS n FROM (SELECT expedicion_id, twitch_id FROM mmo_premios GROUP BY expedicion_id, twitch_id HAVING COUNT(*) > 1)`) === 0,
  'Nadie tiene dos premios de la misma expedición.');
comprobar(n(`SELECT COUNT(*) AS n FROM mmo_jugadores j
  WHERE j.renombre != (SELECT COALESCE(SUM(renombre), 0) FROM mmo_premios p WHERE p.twitch_id = j.twitch_id)`) === 0,
  'El renombre de cada jugador es la suma de sus premios.');
comprobar(n(`SELECT COUNT(*) AS n FROM mmo_participantes p JOIN mmo_resultados r ON r.expedicion_id = p.expedicion_id
  WHERE r.completada = 1 AND NOT EXISTS (SELECT 1 FROM mmo_premios x WHERE x.expedicion_id = p.expedicion_id AND x.twitch_id = p.twitch_id)`) === 0,
  'Cada participante de una expedición completada tiene su premio.');
comprobar(n(`SELECT COUNT(*) AS n FROM mmo_historial h JOIN consent c ON c.twitch_id = h.twitch_id WHERE c.opted_out = 1`) === 0,
  'No queda rastro en el mundo de quien pidió !olvidame.');
// Atasco: activo, reloj corriendo y plazo vencido hace más de un minuto con el bot vivo.
const vencido = w.modo === 'activo' && w.fase !== 'calma' && w.pausado_ms === null && w.hasta_ms !== null && ahora - (w.hasta_ms as number) > 60_000;
const vivo = latido !== null && ahora - latido < 30_000;
comprobar(!(vencido && vivo), 'Ninguna fase atascada pasado su plazo con el bot en marcha.');
if (w.modo === 'activo' && !vivo) avisos.push('El mundo está activo pero el bot no da señales de vida en los últimos 30 s (¿está cerrado?). Al arrancar, recuperará el tiempo.');
if (vencido && !vivo) avisos.push('El plazo venció con el bot cerrado: al arrancar no se perderá la expedición si hubo latido antes del cierre.');
for (const a of avisos) console.log(`  AVISO ${a}`);

const ultimos = db.prepare('SELECT expedicion_id, nombre, texto, at_ms FROM mmo_historial ORDER BY id DESC LIMIT 10').all() as Array<{ expedicion_id: number; nombre: string; texto: string; at_ms: number }>;
if (ultimos.length) {
  console.log('\nÚltimo en el mundo:');
  for (const u of ultimos.reverse()) console.log(`  ${hora(u.at_ms)} · exp. ${u.expedicion_id} · ${u.nombre ? `${u.nombre} ${u.texto}` : `✦ ${u.texto}`}`);
}
db.close();
console.log(fallos.length ? `\n${fallos.length} comprobación(es) con FALLO.` : '\nTodo en orden.');
process.exit(fallos.length ? 1 : 0);
