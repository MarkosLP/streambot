import { getDb, nowIso } from './db.js';
import { log } from '../core/logger.js';

/**
 * Sesiones de directo.
 *
 * Sirven para poder decir "primer mensaje de esta persona EN ESTE DIRECTO",
 * que es distinto de "primer mensaje de su vida" y de "no le veía hace 20
 * días". Las tres cosas se parecen y no son lo mismo.
 *
 * Se abren con `Twitch.StreamOnline` y se cierran con `Twitch.StreamOffline`.
 *
 * IMPORTANTE: puede no haber ningún directo abierto y eso NO es un error.
 * Si arrancas el bot a mitad de directo, el evento de apertura ya pasó y
 * nadie nos lo va a repetir. Por eso `current()` devuelve null sin quejarse
 * y quien lo llama tiene que aguantarlo.
 */

export interface StreamRow {
  id: number;
  started_at: string;
  ended_at: string | null;
}

/** El directo en curso, o null si no hay ninguno abierto. */
export function current(): StreamRow | null {
  const row = getDb()
    .prepare('SELECT id, started_at, ended_at FROM streams WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1')
    .get();
  return (row as StreamRow | undefined) ?? null;
}

/**
 * Abre un directo.
 *
 * Si ya había uno abierto se reutiliza en vez de abrir otro. Twitch puede
 * mandar `StreamOnline` más de una vez por un corte de conexión, y dos filas
 * abiertas a la vez dejarían la tabla sin sentido.
 */
export function open(at = nowIso()): StreamRow {
  const abierto = current();
  if (abierto) {
    log.debug(`StreamOnline con el directo ${abierto.id} ya abierto; se reutiliza.`);
    return abierto;
  }

  getDb().prepare('INSERT INTO streams (started_at, ended_at) VALUES (?, NULL)').run(at);
  const fila = current();
  if (fila) log.info(`Directo iniciado (sesión ${fila.id}).`);
  return fila!;
}

/** Cierra el directo en curso. Si no había ninguno, no hace nada. */
export function close(at = nowIso()): StreamRow | null {
  const abierto = current();
  if (!abierto) {
    log.debug('StreamOffline sin ningún directo abierto; no hay nada que cerrar.');
    return null;
  }

  getDb().prepare('UPDATE streams SET ended_at = ? WHERE id = ?').run(at, abierto.id);
  log.info(`Directo terminado (sesión ${abierto.id}).`);
  return { ...abierto, ended_at: at };
}

export function count(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM streams').get() as { n: number };
  return row.n;
}

/** Solo para el simulador y los tests: fabrica un directo ya empezado. */
export function openAt(startedAt: string): StreamRow {
  getDb().prepare('INSERT INTO streams (started_at, ended_at) VALUES (?, NULL)').run(startedAt);
  return current()!;
}

/**
 * El directo inmediatamente anterior a uno dado, o null si es el primero.
 *
 * Lo necesitan las rachas: sin saber cuál era el directo anterior no se puede
 * distinguir "vino al último" de "se saltó tres".
 */
export function previousId(streamId: number): number | null {
  const row = getDb()
    .prepare('SELECT id FROM streams WHERE id < ? ORDER BY id DESC LIMIT 1')
    .get(streamId) as { id: number } | undefined;
  return row?.id ?? null;
}
