import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDatabase, configureDatabase, getDb } from '../../data/db.js';
import * as streams from '../../data/streams.js';
import * as killswitch from '../../core/killswitch.js';
import * as mmo from './index.js';
import { MAX_MESSAGE_LENGTH } from '../../config.js';
import { META_ARRIESGADA } from './contenido.js';
import type { Viewer } from '../../core/events.js';

/**
 * Fase 3 del plan: varias horas con Crid4m ausente, aceleradas. Ocho horas
 * simuladas con gente que entra y sale, mensajes repetidos, pausa, cortes del
 * directo, reinicios del bot (cerrar y reabrir el archivo SQLite), una caída
 * larga, un !olvidame y un apagado a mitad. Se comprueba lo que pide el plan:
 * sin premios duplicados ni bloqueo del juego, y respuestas solo a comandos.
 */

const carpeta = mkdtempSync(join(tmpdir(), 'crid4m-mmo-resistencia-'));
const archivo = join(carpeta, 'mmo.sqlite');
const INICIO = Date.UTC(2026, 9, 3, 8, 0, 0);
const MIN = 60_000;
const PASO = 30_000;   // el bot avanza cada 5 s; a efectos del ciclo basta con medio minuto

before(() => configureDatabase(archivo));
after(() => {
  closeDatabase();
  rmSync(carpeta, { recursive: true, force: true });
});

/** Azar con semilla: si falla, falla siempre igual. */
function azar(semilla: number) {
  return () => {
    semilla = (semilla * 1664525 + 1013904223) % 2 ** 32;
    return semilla / 2 ** 32;
  };
}

const persona = (id: string): Viewer => ({
  id, login: id, displayName: id[0]!.toUpperCase() + id.slice(1), isBroadcaster: false, isModerator: false,
  isVip: false, isSubscriber: false, rawRole: null,
});

/** Quién juega y cuándo (minutos desde el inicio) y con qué ganas por paso. */
const JUGADORES = [
  { v: persona('ana'), desde: 0, hasta: 480, ganas: .5 },
  { v: persona('bruno'), desde: 30, hasta: 200, ganas: .25 },
  { v: persona('carla'), desde: 60, hasta: 480, ganas: .15 },
  { v: persona('dani'), desde: 120, hasta: 300, ganas: .4 },
  { v: persona('eva'), desde: 250, hasta: 480, ganas: .3 },
  { v: persona('fer'), desde: 330, hasta: 420, ganas: .6 },
];

function reiniciarBot() {
  closeDatabase();
  configureDatabase(archivo);
}

const mundo = () => getDb().prepare('SELECT * FROM mmo_world WHERE id = 1').get() as {
  modo: string; fase: string; expedicion_id: number; progreso: number; meta: number; hasta_ms: number | null; pausado_ms: number | null; latido_ms: number | null;
};
const contar = (sql: string, ...args: (string | number)[]) =>
  (getDb().prepare(sql).get(...args) as { n: number }).n;

test('ocho horas de mundo sin dueño: sin premios duplicados, sin bloqueos y sin hablar de más', () => {
  const r = azar(20261002);
  killswitch.enable('resistencia');
  let chat = true, recuperaciones = 0;
  let antesDelCorte: ReturnType<typeof mundo> | null = null;
  mmo.setChatConectado(() => chat);
  streams.openAt(new Date(INICIO).toISOString());
  mmo.activar(INICIO);

  let comandos = 0, respuestas = 0, repetidos = 0;
  const avisosEspera = new Map<string, number>();
  let caido = false;
  const largas: string[] = [];

  for (let t = INICIO; t < INICIO + 480 * MIN; t += PASO) {
    const min = (t - INICIO) / MIN;

    // Guion de lo que le pasa al canal durante el día.
    if (min === 95) mmo.pausar(t);
    if (min === 110) {
      const antes = mundo();
      mmo.activar(t);
      if (antes.hasta_ms !== null) assert.equal(mundo().hasta_ms, antes.hasta_ms + 15 * MIN, 'la pausa no se come el tiempo de la expedición');
    }
    if (min === 150) reiniciarBot();
    if (min === 200) streams.close(new Date(t).toISOString());
    if (min === 260) streams.open(new Date(t).toISOString());
    if (min === 300) caido = true;   // el PC se queda colgado hora y media: ni reloj ni chat
    if (min === 390) {
      caido = false;
      reiniciarBot();
      const antes = mundo();
      const resultados = contar('SELECT COUNT(*) AS n FROM mmo_resultados');
      // Se cayó sin parar(): al arrancar, la hora y media cerrado no cuenta.
      mmo.recuperar(t);
      mmo.avanzar(t);
      const despues = mundo();
      assert.equal(contar('SELECT COUNT(*) AS n FROM mmo_resultados'), resultados, 'no se cierra nada por el tiempo que estuvo caído');
      assert.equal(despues.fase, antes.fase, `${antes.fase} → ${despues.fase}`);
      assert.equal(despues.progreso, antes.progreso);
      // Le queda lo mismo que le quedaba en el último latido antes de caerse.
      if (antes.hasta_ms !== null) assert.equal(despues.hasta_ms! - t, antes.hasta_ms - antes.latido_ms!, 'conserva lo que le quedaba');
      recuperaciones++;
    }
    if (min === 400) mmo.olvidar('carla');
    // Streamer.bot se cae un cuarto de hora: no llega ningún comando y el reloj no corre.
    if (min === 430) {
      chat = false;
      antesDelCorte = mundo();
    }
    if (min === 445) {
      mmo.avanzar(t);
      const w = mundo();
      assert.equal(w.expedicion_id, antesDelCorte!.expedicion_id, 'el corte de chat no cierra la expedición');
      assert.equal(w.fase, antesDelCorte!.fase);
      chat = true;
    }
    if (caido) continue;

    mmo.avanzar(t);

    for (const { v, desde, hasta, ganas } of JUGADORES) {
      if (!chat) break; // sin Streamer.bot, el chat no llega al bot
      if (min < desde || min >= hasta || (v.id === 'carla' && min >= 400)) continue;
      if (r() >= ganas) continue;
      // Algunos votan en las encrucijadas con !explorar 1 o 2.
      const texto = r() < .15 ? '!mundo' : r() < .1 ? '!expedicion' : r() < .3 ? `!explorar ${r() < .5 ? 1 : 2}` : '!explorar';
      const id = `m-${t}-${v.id}`;
      comandos++;
      const respuesta = mmo.comando(texto, v, id, t);
      if (respuesta?.startsWith('Aún te recuperas')) {
        // Un aviso por espera: insistir no hace hablar más al bot.
        assert.ok(t >= (avisosEspera.get(v.id) ?? 0), `${v.id} avisado dos veces en la misma espera`);
        avisosEspera.set(v.id, t + Number(/en (\d+) s/.exec(respuesta)![1]) * 1000);
      }
      if (respuesta !== null) {
        respuestas++;
        if (respuesta.length > MAX_MESSAGE_LENGTH) largas.push(respuesta);
      }
      // A veces Streamer.bot entrega dos veces el mismo mensaje, justo detrás.
      if (texto.startsWith('!explorar') && r() < .1) {
        const antes = mundo();
        assert.notEqual(mmo.explorar(v, id, t).tipo, 'ok', 'un mensaje repetido no vuelve a contar');
        assert.equal(mundo().progreso, antes.progreso);
        repetidos++;
      }

    }
    // Mensajes que no son comandos: el mundo no contesta.
    assert.equal(mmo.comando('hola a todos', JUGADORES[0]!.v, `charla-${t}`, t), null);

    // Nunca se queda colgado: corriendo el tiempo, ninguna fase pasa de su plazo.
    const w = mundo();
    if (w.modo === 'activo' && w.pausado_ms === null && streams.current() && w.fase !== 'calma') {
      assert.ok(w.hasta_ms !== null && t <= w.hasta_ms + PASO, `fase ${w.fase} pasada de plazo en el minuto ${min}`);
    }
    if (w.fase === 'expedicion') assert.ok(w.progreso < w.meta && w.meta >= 4 && w.meta <= 12 + META_ARRIESGADA);
  }

  // Apagar a mitad de una expedición: termina sin premios para ella.
  // Se deja terminar lo que hubiera en curso y alguien nuevo abre otra: así queda a medias seguro.
  const t = INICIO + 480 * MIN + mmo.DURACION_MS + 2 * mmo.DESCANSO_MS;
  mmo.avanzar(t - mmo.DESCANSO_MS - 1000);
  mmo.avanzar(t);
  assert.equal(mmo.explorar(persona('zoe'), 'ultimo', t).tipo, 'ok');
  assert.equal(mundo().fase, 'expedicion');
  const ultima = mundo().expedicion_id;
  mmo.apagar();
  assert.equal(contar('SELECT COUNT(*) AS n FROM mmo_premios WHERE expedicion_id = ?', ultima), 0);
  assert.equal(mundo().modo, 'apagado');

  // Cada premio, una vez y solo en expediciones completadas.
  const completadas = contar('SELECT COUNT(*) AS n FROM mmo_resultados WHERE completada = 1');
  const fallidas = contar('SELECT COUNT(*) AS n FROM mmo_resultados WHERE completada = 0');
  assert.ok(completadas >= 15, `el juego avanza: ${completadas} completadas`);
  assert.equal(contar(`SELECT COUNT(*) AS n FROM mmo_premios p
    LEFT JOIN mmo_resultados r ON r.expedicion_id = p.expedicion_id WHERE r.completada IS NOT 1`), 0);
  // El renombre acumulado coincide con la suma de sus premios: nada contado dos veces.
  for (const { twitch_id, renombre } of getDb().prepare('SELECT twitch_id, renombre FROM mmo_jugadores').all() as Array<{ twitch_id: string; renombre: number }>) {
    assert.equal(renombre, contar('SELECT COALESCE(SUM(renombre), 0) AS n FROM mmo_premios WHERE twitch_id = ?', twitch_id), twitch_id);
  }
  // Cada participante de una expedición completada recibe exactamente un premio.
  assert.equal(contar(`SELECT COUNT(*) AS n FROM mmo_participantes p JOIN mmo_resultados r ON r.expedicion_id = p.expedicion_id
    WHERE r.completada = 1 AND NOT EXISTS (SELECT 1 FROM mmo_premios x WHERE x.expedicion_id = p.expedicion_id AND x.twitch_id = p.twitch_id)`), 0);
  // !olvidame: de Carla no queda nada.
  for (const tabla of ['mmo_participantes', 'mmo_jugadores', 'mmo_acciones', 'mmo_historial', 'mmo_premios']) {
    assert.equal(contar(`SELECT COUNT(*) AS n FROM ${tabla} WHERE twitch_id = 'carla'`), 0, tabla);
  }
  // Solo contesta a comandos, y caben en un mensaje de Twitch.
  assert.ok(respuestas <= comandos);
  assert.deepEqual(largas, []);
  assert.ok(repetidos > 0, 'la simulación sí ha probado mensajes repetidos');
  assert.equal(recuperaciones, 1);
  mmo.setChatConectado(null);
  console.log(`8 h simuladas: ${completadas} expediciones completadas, ${fallidas} cerradas sin completar, ${comandos} comandos, ${respuestas} respuestas, ${repetidos} repetidos descartados.`);
});
