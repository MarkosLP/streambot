import { getDb } from '../../data/db.js';
import * as streams from '../../data/streams.js';
import * as killswitch from '../../core/killswitch.js';
import { log } from '../../core/logger.js';
import type { Viewer } from '../../core/events.js';

import { REGIONES, CLIMAS, CRONICA, CAPITULO_CADA, TOTAL_RELIQUIAS, buscarMision, type Clima, type Mision, type Region } from './contenido.js';

/** El Linde del Velo. El contenido (misiones, reliquias, crónica) está en contenido.ts; el navegador de OBS solo lee estado(). */
export { REGIONES, TOTAL_RELIQUIAS };

/** El azar del mundo: misión, clima y suceso. Las pruebas lo fijan. */
let azar: () => number = Math.random;
export function setAzar(fn: (() => number) | null): void {
  azar = fn ?? Math.random;
}
const elegir = <T>(lista: readonly T[]): T => lista[Math.min(lista.length - 1, Math.floor(azar() * lista.length))]!;

export const DURACION_MS = 20 * 60_000;
export const DESCANSO_MS = 60_000;
export const ACCION_MS = 2 * 60_000;
let reloj: NodeJS.Timeout | null = null;

type Modo = 'apagado' | 'activo' | 'pausado';
type Fase = 'calma' | 'expedicion' | 'resultado';

interface Mundo {
  id: number;
  modo: Modo;
  fase: Fase;
  expedicion_id: number;
  region_index: number;
  progreso: number;
  meta: number;
  hasta_ms: number | null;
  pausado_ms: number | null;
  ultimo_suceso: string;
  /** Último momento en que el bot estaba vivo (lo apunta avanzar()). */
  latido_ms: number | null;
}

interface Participante {
  twitch_id: string;
  nombre: string;
  aporte: number;
  ultimo_ms: number;
}

export interface EstadoPublico {
  version: 1;
  modo: Modo;
  fase: Fase;
  region: { id: string; nombre: string; objetivo: string };
  objetivo: { actual: number; meta: number };
  hasta: string | null;
  participantes: Array<{ nombre: string; aporte: number }>;
  /** `suceso: true` = lo cuenta el mundo, no una persona (quien va vacío). */
  acciones: Array<{ quien: string; texto: string; at: string; suceso?: true }>;
  resultado: null | {
    completada: boolean;
    hallazgo: string | null;
    premios: Array<{ nombre: string; renombre: number }>;
    /** La reliquia era nueva para la colección de la Lumbre. */
    nueva: boolean;
    /** Capítulo de la crónica que desbloqueó esta expedición, si alguno. */
    capitulo: null | { numero: number; titulo: string };
  };
  clima: Clima;
  reliquias: { halladas: number; total: number };
  /** capitulo 0 = prólogo. siguienteEn = expediciones completadas que faltan para el siguiente. */
  cronica: { capitulo: number; total: number; titulo: string; texto: string; siguienteEn: number | null };
  ultimoSuceso: string;
  /** Activo pero con el tiempo congelado: sin directo, con el bot apagado o sin conexión con el chat. */
  detenido: null | 'sin-directo' | 'bot-apagado' | 'sin-chat';
}

/** El mundo solo corre con directo y con el bot encendido. */
function detenido(): EstadoPublico['detenido'] {
  if (!streams.current()) return 'sin-directo';
  if (!killswitch.isEnabled()) return 'bot-apagado';
  if (!chatConectado()) return 'sin-chat';
  return null;
}

/**
 * Si el chat llega al bot (Streamer.bot conectado). Sin él, nadie puede escribir
 * !explorar: el plazo se congela como sin directo. Lo conecta index.ts; por
 * defecto (pruebas, simulador) se da por conectado.
 */
let chatConectado: () => boolean = () => true;
export function setChatConectado(fn: (() => boolean) | null): void {
  chatConectado = fn ?? (() => true);
}

function mundo(): Mundo {
  const db = getDb();
  const guardado = db.prepare('SELECT * FROM mmo_world WHERE id = 1').get() as unknown as Mundo | undefined;
  if (guardado) return guardado;
  db.prepare(`INSERT OR IGNORE INTO mmo_world
    (id, modo, fase, expedicion_id, region_index, progreso, meta, hasta_ms, pausado_ms, ultimo_suceso)
    VALUES (1, 'apagado', 'calma', 0, 0, 0, 4, NULL, NULL, '')`).run();
  return db.prepare('SELECT * FROM mmo_world WHERE id = 1').get() as unknown as Mundo;
}

interface Expedicion {
  region_id: string;
  mision_id: string;
  clima: string;
  suceso: string | null;
  reliquia_id: string | null;
  reliquia_nueva: number;
  capitulo: number | null;
}

function expedicion(id: number): Expedicion | undefined {
  return getDb().prepare('SELECT region_id, mision_id, clima, suceso, reliquia_id, reliquia_nueva, capitulo FROM mmo_expediciones WHERE expedicion_id = ?')
    .get(id) as unknown as Expedicion | undefined;
}

/** La misión de una expedición. Las que empezaron antes de existir el contenido usan la primera de su región. */
function misionDe(region: Region, datos: Expedicion | undefined): Mision {
  return buscarMision(region.id, datos?.mision_id) ?? region.misiones[0]!;
}

const contar = (sql: string, ...args: Array<string | number>) => (getDb().prepare(sql).get(...args) as { n: number }).n;
const completadas = () => contar('SELECT COUNT(*) AS n FROM mmo_resultados WHERE completada = 1');
const reliquiasHalladas = () => contar('SELECT COUNT(*) AS n FROM mmo_reliquias');

function cronica(): EstadoPublico['cronica'] {
  const total = CRONICA.length - 1;
  const hechas = completadas();
  const capitulo = Math.min(total, Math.floor(hechas / CAPITULO_CADA));
  return { capitulo, total, ...CRONICA[capitulo]!, siguienteEn: capitulo < total ? (capitulo + 1) * CAPITULO_CADA - hechas : null };
}

/**
 * La misión que menos se ha hecho en la región, al azar entre las empatadas y sin
 * repetir la última. La primera vez en cada región, la de presentación.
 */
function elegirMision(region: Region): Mision {
  const filas = getDb().prepare('SELECT mision_id, COUNT(*) AS n, MAX(expedicion_id) AS ultima FROM mmo_expediciones WHERE region_id = ? GROUP BY mision_id')
    .all(region.id) as Array<{ mision_id: string; n: number; ultima: number }>;
  if (filas.length === 0) return region.misiones[0]!;
  const usos = new Map(filas.map((f) => [f.mision_id, f.n]));
  const ultima = filas.reduce((a, b) => (b.ultima > a.ultima ? b : a)).mision_id;
  const minimo = Math.min(...region.misiones.map((m) => usos.get(m.id) ?? 0));
  const empatadas = region.misiones.filter((m) => (usos.get(m.id) ?? 0) === minimo);
  const sinRepetir = empatadas.filter((m) => m.id !== ultima);
  return elegir(sinRepetir.length ? sinRepetir : empatadas);
}

/** Cielo distinto al de la expedición anterior. La primera de todas, de día. */
function elegirClima(): Clima {
  const anterior = getDb().prepare('SELECT clima FROM mmo_expediciones ORDER BY expedicion_id DESC LIMIT 1').get() as { clima: string } | undefined;
  if (!anterior) return 'dia';
  return elegir(CLIMAS.filter((c) => c.id !== anterior.clima)).id;
}

/** El suceso que menos ha salido en la región. */
function elegirSuceso(region: Region): string {
  const filas = getDb().prepare('SELECT suceso, COUNT(*) AS n FROM mmo_expediciones WHERE region_id = ? AND suceso IS NOT NULL GROUP BY suceso')
    .all(region.id) as Array<{ suceso: string; n: number }>;
  const usos = new Map(filas.map((f) => [f.suceso, f.n]));
  const minimo = Math.min(...region.sucesos.map((x) => usos.get(x) ?? 0));
  return elegir(region.sucesos.filter((x) => (usos.get(x) ?? 0) === minimo));
}

/** Primero las que faltan en la colección; con las dos ya halladas, una de ellas otra vez. */
function elegirReliquia(region: Region, mision: Mision): { id: string; nombre: string; nueva: boolean } {
  const ids = mision.reliquias.map((_, i) => `${region.id}.${mision.id}.${i}`);
  const halladas = new Set((getDb().prepare(`SELECT reliquia_id FROM mmo_reliquias WHERE reliquia_id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as Array<{ reliquia_id: string }>).map((f) => f.reliquia_id));
  const falta = ids.findIndex((id) => !halladas.has(id));
  const i = falta >= 0 ? falta : Math.floor(azar() * ids.length) % ids.length;
  return { id: ids[i]!, nombre: mision.reliquias[i]!, nueva: falta >= 0 };
}

function participantes(id: number): Participante[] {
  if (id === 0) return [];
  return getDb().prepare('SELECT twitch_id, nombre, aporte, ultimo_ms FROM mmo_participantes WHERE expedicion_id = ? ORDER BY aporte DESC, nombre ASC')
    .all(id) as unknown as Participante[];
}

/** Lectura sin avance temporal ni escrituras en la base, salvo crear la fila inicial. */
export function estado(): EstadoPublico {
  const w = mundo();
  const enCurso = w.fase !== 'calma';
  const region = REGIONES[(enCurso ? w.region_index : w.expedicion_id) % REGIONES.length]!;
  const datos = enCurso ? expedicion(w.expedicion_id) : undefined;
  const gente = enCurso ? participantes(w.expedicion_id) : [];
  const acciones = enCurso ? getDb().prepare(
    'SELECT twitch_id, nombre, texto, at_ms FROM mmo_historial WHERE expedicion_id = ? ORDER BY id DESC LIMIT 3',
  ).all(w.expedicion_id) as Array<{ twitch_id: string; nombre: string; texto: string; at_ms: number }> : [];
  const final = w.fase === 'resultado' ? getDb().prepare(
    'SELECT completada, hallazgo FROM mmo_resultados WHERE expedicion_id = ?',
  ).get(w.expedicion_id) as { completada: number; hallazgo: string | null } | undefined : undefined;
  const premios = final?.completada ? getDb().prepare(
    `SELECT p.nombre, r.renombre FROM mmo_premios r
       JOIN mmo_participantes p ON p.expedicion_id = r.expedicion_id AND p.twitch_id = r.twitch_id
      WHERE r.expedicion_id = ? ORDER BY p.aporte DESC, p.nombre ASC`,
  ).all(w.expedicion_id) as Array<{ nombre: string; renombre: number }> : [];
  return {
    version: 1,
    modo: w.modo,
    fase: w.fase,
    region: { id: region.id, nombre: region.nombre, objetivo: enCurso ? misionDe(region, datos).objetivo : 'Por descubrir' },
    objetivo: { actual: w.progreso, meta: w.meta },
    // Congelado (pausa, sin directo, bot cerrado): sin cuenta atrás que no se cumple.
    hasta: w.modo !== 'activo' || w.hasta_ms === null || w.pausado_ms !== null ? null : new Date(w.hasta_ms).toISOString(),
    participantes: gente.map(({ nombre, aporte }) => ({ nombre, aporte })),
    acciones: acciones.map(({ twitch_id, nombre, texto, at_ms }) => ({
      quien: nombre, texto, at: new Date(at_ms).toISOString(), ...(twitch_id === '' && { suceso: true as const }),
    })),
    resultado: final ? {
      completada: final.completada === 1,
      hallazgo: final.hallazgo,
      premios: premios.map(({ nombre, renombre }) => ({ nombre, renombre })),
      nueva: final.completada === 1 && datos?.reliquia_nueva === 1,
      capitulo: datos?.capitulo ? { numero: datos.capitulo, titulo: CRONICA[datos.capitulo]!.titulo } : null,
    } : null,
    clima: CLIMAS.find((c) => c.id === datos?.clima)?.id ?? 'dia',
    reliquias: { halladas: reliquiasHalladas(), total: TOTAL_RELIQUIAS },
    cronica: cronica(),
    ultimoSuceso: w.ultimo_suceso,
    detenido: w.modo === 'activo' ? detenido() : null,
  };
}

export function arrancar(now = Date.now()): void {
  if (reloj) return;
  recuperar(now);
  reloj = setInterval(() => { avanzar(); }, 5_000);
  reloj.unref();
}

/** Al cerrar el bot, el plazo se congela: el tiempo que esté cerrado no cuenta. */
export function parar(now = Date.now()): void {
  if (reloj) clearInterval(reloj);
  reloj = null;
  try {
    congelar(now);
  } catch {
    // Sin base de datos abierta no hay nada que congelar.
  }
}

/**
 * Al arrancar: si el bot se cerró de golpe (sin parar(), por un corte de luz o
 * un cuelgue), el plazo no se congeló. Se congela desde el último latido, así el
 * tiempo que estuvo cerrado no cuenta y la expedición no se pierde al volver.
 */
export function recuperar(now = Date.now()): void {
  const w = mundo();
  if (w.modo !== 'activo' || w.hasta_ms === null || w.pausado_ms !== null || w.latido_ms === null) return;
  const desde = Math.min(w.latido_ms, now);
  getDb().prepare('UPDATE mmo_world SET pausado_ms = ? WHERE id = 1 AND pausado_ms IS NULL').run(desde);
  log.warn(`El Linde del Velo: el bot se cerró sin despedirse; los ${Math.round((now - desde) / 60_000)} min cerrado no cuentan.`);
}

/** pausado_ms con modo activo = plazo congelado hasta que el mundo pueda correr otra vez. */
function congelar(now: number): void {
  const r = getDb().prepare("UPDATE mmo_world SET pausado_ms = ? WHERE id = 1 AND modo = 'activo' AND hasta_ms IS NOT NULL AND pausado_ms IS NULL").run(now);
  if (r.changes) log.info('El Linde del Velo: tiempo congelado (sin directo, bot apagado o cerrándose).');
}

/** Reactivar desde pausa (o desde un plazo congelado) conserva el tiempo que quedaba. */
export function activar(now = Date.now()): EstadoPublico {
  const w = mundo();
  const diferencia = w.pausado_ms !== null ? Math.max(0, now - w.pausado_ms) : 0;
  log.info(`El Linde del Velo: activado${diferencia ? ` (plazo desplazado ${Math.round(diferencia / 60_000)} min)` : ''}.`);
  getDb().prepare(`UPDATE mmo_world SET modo = 'activo', pausado_ms = NULL,
    hasta_ms = CASE WHEN hasta_ms IS NULL THEN NULL ELSE hasta_ms + ? END WHERE id = 1`)
    .run(diferencia);
  return estado();
}

export function pausar(now = Date.now()): EstadoPublico {
  const w = mundo();
  // Si ya estaba congelado, la pausa cuenta desde entonces.
  if (w.modo === 'activo') getDb().prepare("UPDATE mmo_world SET modo = 'pausado', pausado_ms = COALESCE(pausado_ms, ?) WHERE id = 1").run(now);
  if (w.modo === 'activo') log.info('El Linde del Velo: en pausa.');
  return estado();
}

/** Apagar termina la sesión del mundo sin dar premios a una expedición a medias. */
export function apagar(): EstadoPublico {
  mundo();
  getDb().prepare("UPDATE mmo_world SET modo = 'apagado', fase = 'calma', progreso = 0, meta = 4, hasta_ms = NULL, pausado_ms = NULL WHERE id = 1").run();
  log.info('El Linde del Velo: apagado.');
  return estado();
}

/** Se llama periódicamente y al recibir un comando. Nunca genera eventos atrasados en cadena. */
export function avanzar(now = Date.now()): EstadoPublico {
  let w = mundo();
  if (w.modo !== 'activo') return estado();
  // El bot está vivo: si se cierra de golpe, recuperar() sabrá desde cuándo.
  getDb().prepare('UPDATE mmo_world SET latido_ms = ? WHERE id = 1').run(now);
  // Sin directo o con el bot apagado, el plazo se congela; al volver, se desplaza lo que estuvo parado.
  if (detenido()) {
    congelar(now);
    return estado();
  }
  if (w.pausado_ms !== null) {
    const parado = Math.max(0, now - w.pausado_ms);
    getDb().prepare('UPDATE mmo_world SET hasta_ms = hasta_ms + ?, pausado_ms = NULL WHERE id = 1').run(parado);
    log.info(`El Linde del Velo: el tiempo vuelve a correr (${Math.round(parado / 60_000)} min congelado).`);
    w = mundo();
  }
  if (w.hasta_ms === null || now < w.hasta_ms) return estado();
  if (w.fase === 'expedicion') {
    const db = getDb();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT OR IGNORE INTO mmo_resultados (expedicion_id, completada, hallazgo, at_ms) VALUES (?, 0, NULL, ?)')
        .run(w.expedicion_id, now);
      db.prepare("UPDATE mmo_world SET fase = 'resultado', hasta_ms = ?, ultimo_suceso = 'La compañía volvió al refugio sin completar la expedición.' WHERE id = 1")
        .run(now + DESCANSO_MS);
      db.exec('COMMIT');
      log.info(`El Linde del Velo: el Velo se cerró sin completar la expedición ${w.expedicion_id} (${w.progreso}/${w.meta}).`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  } else if (w.fase === 'resultado') {
    getDb().prepare("UPDATE mmo_world SET fase = 'calma', progreso = 0, meta = 4, hasta_ms = NULL WHERE id = 1").run();
  }
  return estado();
}

export type ResultadoExplorar =
  | {
    tipo: 'ok'; progreso: number; meta: number; completada: boolean; renombre: number; inicio: boolean; region: string;
    objetivo: string; texto: string; aporte: number; participantes: number;
    /** Lo que pasó a mitad de camino con esta acción, si pasó. */
    suceso: string | null;
    /** Al completar: la reliquia, si es nueva, cuántas tiene la Lumbre y el capítulo desbloqueado. */
    hallazgo: string; nueva: boolean; reliquias: number; capitulo: string | null;
  }
  | { tipo: 'apagado' | 'sin-directo' | 'bloqueado' | 'olvidado' | 'repetido' | 'descanso' }
  | { tipo: 'espera'; segundos: number };

/** Una acción de chat equivale a un aporte. Mensaje y premios se deduplican en SQLite. */
export function explorar(viewer: Viewer, mensajeId: string, now = Date.now()): ResultadoExplorar {
  if (!viewer.id || !viewer.login || !mensajeId) return { tipo: 'bloqueado' };
  if (getDb().prepare('SELECT 1 FROM mmo_acciones WHERE mensaje_id = ?').get(mensajeId)) return { tipo: 'repetido' };
  avanzar(now);
  const w = mundo();
  if (w.modo !== 'activo') return { tipo: 'apagado' };
  if (!streams.current()) return { tipo: 'sin-directo' };
  if (!killswitch.isEnabled()) return { tipo: 'bloqueado' };
  const optOut = getDb().prepare('SELECT opted_out FROM consent WHERE twitch_id = ?').get(viewer.id) as { opted_out: number } | undefined;
  if (optOut?.opted_out === 1) return { tipo: 'olvidado' };
  if (w.fase === 'resultado') return { tipo: 'descanso' };
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare('SELECT 1 FROM mmo_acciones WHERE mensaje_id = ?').get(mensajeId)) {
      db.exec('COMMIT');
      return { tipo: 'repetido' };
    }
    let actual = w;
    const inicio = actual.fase === 'calma';
    if (actual.fase === 'calma') {
      const siguiente = actual.expedicion_id + 1;
      const regionIndex = (siguiente - 1) % REGIONES.length;
      const destino = REGIONES[regionIndex]!;
      db.prepare('INSERT OR REPLACE INTO mmo_expediciones (expedicion_id, region_id, mision_id, clima, inicio_ms) VALUES (?, ?, ?, ?, ?)')
        .run(siguiente, destino.id, elegirMision(destino).id, elegirClima(), now);
      db.prepare(`UPDATE mmo_world SET fase = 'expedicion', expedicion_id = ?, region_index = ?,
        progreso = 0, meta = 4, hasta_ms = ?, ultimo_suceso = 'La compañía salió del refugio.' WHERE id = 1`)
        .run(siguiente, regionIndex, now + DURACION_MS);
      actual = { ...actual, fase: 'expedicion', expedicion_id: siguiente, region_index: regionIndex, progreso: 0, meta: 4, hasta_ms: now + DURACION_MS };
    }
    const anterior = db.prepare('SELECT ultimo_ms FROM mmo_participantes WHERE expedicion_id = ? AND twitch_id = ?')
      .get(actual.expedicion_id, viewer.id) as { ultimo_ms: number } | undefined;
    if (anterior && now - anterior.ultimo_ms < ACCION_MS) {
      db.exec('COMMIT');
      return { tipo: 'espera', segundos: Math.ceil((ACCION_MS - (now - anterior.ultimo_ms)) / 1000) };
    }
    db.prepare('INSERT INTO mmo_acciones (mensaje_id, twitch_id, at_ms) VALUES (?, ?, ?)').run(mensajeId, viewer.id, now);
    db.prepare(`INSERT INTO mmo_participantes (expedicion_id, twitch_id, nombre, aporte, ultimo_ms)
      VALUES (?, ?, ?, 1, ?) ON CONFLICT(expedicion_id, twitch_id)
      DO UPDATE SET nombre = excluded.nombre, aporte = aporte + 1, ultimo_ms = excluded.ultimo_ms`)
      .run(actual.expedicion_id, viewer.id, viewer.displayName, now);
    const gente = participantes(actual.expedicion_id);
    const meta = Math.min(12, 4 + 2 * (gente.length - 1));
    const progreso = actual.progreso + 1;
    const completada = progreso >= meta;
    const region = REGIONES[actual.region_index % REGIONES.length]!;
    const mision = misionDe(region, expedicion(actual.expedicion_id));
    const texto = mision.acciones[(progreso - 1) % mision.acciones.length]!;
    db.prepare('INSERT INTO mmo_historial (expedicion_id, twitch_id, nombre, texto, at_ms) VALUES (?, ?, ?, ?, ?)')
      .run(actual.expedicion_id, viewer.id, viewer.displayName, texto, now);
    // A mitad de camino, una vez por expedición, el mundo cuenta algo.
    let suceso: string | null = null;
    if (!completada && progreso >= Math.ceil(meta / 2)) {
      const elegido = elegirSuceso(region);
      if (db.prepare('UPDATE mmo_expediciones SET suceso = ? WHERE expedicion_id = ? AND suceso IS NULL').run(elegido, actual.expedicion_id).changes) {
        db.prepare("INSERT INTO mmo_historial (expedicion_id, twitch_id, nombre, texto, at_ms) VALUES (?, '', '', ?, ?)")
          .run(actual.expedicion_id, elegido, now);
        suceso = elegido;
      }
    }
    let renombre = 0;
    let reliquia = { id: '', nombre: '', nueva: false };
    let capitulo: number | null = null;
    if (completada) {
      for (const p of gente) {
        const puntos = 5 + Math.min(p.aporte, 3);
        const nuevo = db.prepare('INSERT OR IGNORE INTO mmo_premios (expedicion_id, twitch_id, renombre) VALUES (?, ?, ?)')
          .run(actual.expedicion_id, p.twitch_id, puntos);
        if (nuevo.changes) {
          db.prepare(`INSERT INTO mmo_jugadores (twitch_id, nombre, renombre) VALUES (?, ?, ?)
            ON CONFLICT(twitch_id) DO UPDATE SET nombre = excluded.nombre, renombre = renombre + excluded.renombre`)
            .run(p.twitch_id, p.nombre, puntos);
        }
        if (p.twitch_id === viewer.id) renombre = puntos;
      }
      reliquia = elegirReliquia(region, mision);
      if (reliquia.nueva) db.prepare('INSERT OR IGNORE INTO mmo_reliquias (reliquia_id, expedicion_id, at_ms) VALUES (?, ?, ?)').run(reliquia.id, actual.expedicion_id, now);
      db.prepare('INSERT OR IGNORE INTO mmo_resultados (expedicion_id, completada, hallazgo, at_ms) VALUES (?, 1, ?, ?)')
        .run(actual.expedicion_id, reliquia.nombre, now);
      const hechas = completadas();
      if (hechas % CAPITULO_CADA === 0 && hechas / CAPITULO_CADA < CRONICA.length) capitulo = hechas / CAPITULO_CADA;
      db.prepare('UPDATE mmo_expediciones SET reliquia_id = ?, reliquia_nueva = ?, capitulo = ? WHERE expedicion_id = ?')
        .run(reliquia.id, reliquia.nueva ? 1 : 0, capitulo, actual.expedicion_id);
    }
    db.prepare(`UPDATE mmo_world SET progreso = ?, meta = ?, fase = ?, hasta_ms = ?, ultimo_suceso = ? WHERE id = 1`)
      .run(progreso, meta, completada ? 'resultado' : 'expedicion', completada ? now + DESCANSO_MS : actual.hasta_ms,
        completada ? `La compañía completó la expedición en ${region.nombre}.` : suceso ?? 'La compañía sigue explorando.');
    db.exec('COMMIT');
    if (inicio) log.info(`El Linde del Velo: ${viewer.displayName} abre la expedición ${actual.expedicion_id} a ${region.nombre}.`);
    if (completada) log.info(`El Linde del Velo: expedición ${actual.expedicion_id} completada por ${gente.length} aventurero(s); ${reliquia.nombre}${reliquia.nueva ? ' (nueva)' : ''}.`);
    if (capitulo !== null) log.info(`El Linde del Velo: nuevo capítulo de la crónica, ${capitulo}: «${CRONICA[capitulo]!.titulo}».`);
    const aporte = gente.find((p) => p.twitch_id === viewer.id)?.aporte ?? 1;
    return {
      tipo: 'ok', progreso, meta, completada, renombre, inicio, region: region.nombre, objetivo: mision.objetivo, texto, aporte,
      participantes: gente.length, suceso, hallazgo: reliquia.nombre, nueva: reliquia.nueva,
      reliquias: reliquiasHalladas(), capitulo: capitulo === null ? null : CRONICA[capitulo]!.titulo,
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function renombre(twitchId: string): number {
  const fila = getDb().prepare('SELECT renombre FROM mmo_jugadores WHERE twitch_id = ?').get(twitchId) as { renombre: number } | undefined;
  return fila?.renombre ?? 0;
}

/** Se invoca desde !olvidame, incluyendo participantes y premios históricos. */
export function olvidar(twitchId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM mmo_participantes WHERE twitch_id = ?').run(twitchId);
  db.prepare('DELETE FROM mmo_jugadores WHERE twitch_id = ?').run(twitchId);
  db.prepare('DELETE FROM mmo_acciones WHERE twitch_id = ?').run(twitchId);
  db.prepare('DELETE FROM mmo_historial WHERE twitch_id = ?').run(twitchId);
  db.prepare('DELETE FROM mmo_premios WHERE twitch_id = ?').run(twitchId);
  const w = mundo();
  if (w.fase !== 'expedicion') return;
  const gente = participantes(w.expedicion_id);
  const progreso = gente.reduce((n, p) => n + p.aporte, 0);
  const meta = Math.min(12, 4 + 2 * Math.max(0, gente.length - 1));
  db.prepare('UPDATE mmo_world SET progreso = ?, meta = ? WHERE id = 1').run(progreso, meta);
}

/**
 * A quién ya se avisó de que espere, y hasta cuándo. Insistir durante la espera
 * no gasta más mensajes del bot: la escena ya enseña el progreso. Se pierde al
 * reiniciar, y no pasa nada: como mucho se repite un aviso.
 */
const avisados = new Map<string, number>();
function avisarUnaVez(clave: string, hasta: number, now: number): boolean {
  if ((avisados.get(clave) ?? 0) > now) return false;
  if (avisados.size > 500) for (const [k, fin] of avisados) if (fin <= now) avisados.delete(k);
  avisados.set(clave, hasta);
  return true;
}

/** Respuestas del MVP. Los controles requieren propietario o moderador. */
export function comando(texto: string, viewer: Viewer, mensajeId: string, now = Date.now()): string | null {
  const t = texto.trim().toLowerCase();
  if (t === '!mundo activar' || t === '!mundo pausar' || t === '!mundo apagar') {
    if (!viewer.isBroadcaster && !viewer.isModerator) return 'Solo Crid4m o un moderador puede controlar el mundo.';
    if (t.endsWith('activar')) { activar(now); return 'El Linde del Velo está activo. Escribe !explorar para iniciar una expedición.'; }
    if (t.endsWith('pausar')) {
      const e = pausar(now);
      return e.modo === 'pausado' ? 'El Linde del Velo está en pausa. El tiempo de la expedición se conserva.' : 'El Linde del Velo ya estaba apagado.';
    }
    apagar();
    return 'El Linde del Velo está apagado.';
  }
  if (t === '!mundo') {
    const e = avanzar(now);
    if (e.modo !== 'activo') return 'El Velo está cerrado ahora mismo. Vuelve cuando Crid4m abra el mundo.';
    const memoria = `Reliquias de la Lumbre: ${e.reliquias.halladas}/${e.reliquias.total} · Crónica: ${e.cronica.capitulo === 0 ? 'prólogo' : `capítulo ${e.cronica.capitulo} de ${e.cronica.total}`}.`;
    if (e.fase === 'calma') return `El Linde del Velo · La compañía descansa en la Última Lumbre. Escribe !explorar para salir hacia ${e.region.nombre}. Basta con una persona. ${memoria}`;
    if (e.fase === 'resultado') return e.resultado?.completada
      ? `La compañía vuelve de ${e.region.nombre} con ${e.resultado.hallazgo}. Nueva salida en breve.`
      : `El Velo se cerró en ${e.region.nombre} con ${e.objetivo.actual}/${e.objetivo.meta}. Nadie pierde nada.`;
    const minutos = e.hasta ? Math.max(0, Math.ceil((Date.parse(e.hasta) - now) / 60_000)) : 0;
    return `El Linde del Velo · ${e.region.nombre}, «${e.region.objetivo}»: ${e.objetivo.actual}/${e.objetivo.meta}. El Velo se cierra en ${minutos} min. !explorar para ayudar.`;
  }
  if (t === '!expedicion') return `${viewer.displayName}: ${renombre(viewer.id)} de renombre en El Linde del Velo. Usa !mundo para ver la expedición.`;
  if (t !== '!explorar') return null;
  const r = explorar(viewer, mensajeId, now);
  // Con tres o más en la compañía, el chat solo confirma la primera aportación de cada
  // persona, la salida y el final; las demás se ven en la escena (techo de respuestas por hora).
  if (r.tipo === 'ok' && !r.completada && !r.inicio && r.aporte > 1 && r.participantes > 2) return null;
  if (r.tipo === 'ok') return r.completada
    ? `¡Expedición completada en ${r.region}! La compañía encuentra ${r.hallazgo}${r.nueva ? ` (reliquia ${r.reliquias}/${TOTAL_RELIQUIAS} para la Lumbre)` : ''}. Todos ganan renombre; tú +${r.renombre}.`
      + (r.capitulo ? ` 📜 Nuevo capítulo de la crónica: «${r.capitulo}».` : '')
    : r.inicio ? `${viewer.displayName} cruza el Velo hacia ${r.region}. Misión: ${r.objetivo}. La compañía sale: ${r.progreso}/${r.meta}.`
    : `${viewer.displayName} ${r.texto} (${r.progreso}/${r.meta}).${r.suceso ? ` ${r.suceso}` : ''}`;
  if (r.tipo === 'espera') return avisarUnaVez(`espera|${viewer.id}`, now + r.segundos * 1000, now)
    ? `Aún te recuperas de la última salida. Podrás explorar en ${r.segundos} s.` : null;
  if (r.tipo === 'apagado') return 'El Linde del Velo está cerrado o en pausa. Usa !mundo para ver su estado.';
  if (r.tipo === 'sin-directo') return 'El Linde del Velo espera a que empiece el directo.';
  if (r.tipo === 'descanso') return avisarUnaVez(`descanso|${viewer.id}`, mundo().hasta_ms ?? now + DESCANSO_MS, now)
    ? 'La compañía descansa tras la expedición. Vuelve en un minuto.' : null;
  return null;
}
