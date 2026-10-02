import { getDb, nowIso } from './db.js';

/**
 * Quién es suscriptor (26 sep 2026, propuestas S1-S7).
 *
 * Dos fuentes: los avisos de Twitch (Sub, ReSub: traen los meses) y la
 * insignia de suscriptor de cada mensaje del chat (así se sabe aunque se
 * suscribiera antes de que el bot lo apuntara). Lo que está en memoria evita
 * escribir en la base de datos con cada mensaje: solo cuando algo cambia.
 */

const cache = new Map<string, boolean>();

/** Un aviso de sub: es suscriptor, con estos meses (nunca menos de los que ya tenía). */
export function apuntar(twitchId: string, meses: number, nivel = 1): void {
  getDb()
    .prepare(`INSERT INTO suscriptores (twitch_id, activo, meses, nivel, actualizado) VALUES (?, 1, ?, ?, ?)
      ON CONFLICT(twitch_id) DO UPDATE SET activo = 1, meses = MAX(meses, excluded.meses), nivel = excluded.nivel, actualizado = excluded.actualizado`)
    .run(twitchId, meses, nivel, nowIso());
  cache.set(twitchId, true);
}

/** Con cada mensaje: la insignia dice si lo es ahora. Solo escribe si cambia. */
export function desdeChat(twitchId: string, esSub: boolean): void {
  if (cache.get(twitchId) === esSub) return;
  if (esSub) {
    getDb()
      .prepare(`INSERT INTO suscriptores (twitch_id, activo, meses, nivel, actualizado) VALUES (?, 1, 0, 1, ?)
        ON CONFLICT(twitch_id) DO UPDATE SET activo = 1, actualizado = excluded.actualizado`)
      .run(twitchId, nowIso());
  } else {
    getDb().prepare('UPDATE suscriptores SET activo = 0, actualizado = ? WHERE twitch_id = ?').run(nowIso(), twitchId);
  }
  cache.set(twitchId, esSub);
}

export function esSub(twitchId: string): boolean {
  const enMemoria = cache.get(twitchId);
  if (enMemoria !== undefined) return enMemoria;
  const fila = getDb().prepare('SELECT activo FROM suscriptores WHERE twitch_id = ?').get(twitchId) as { activo: number } | undefined;
  const es = fila?.activo === 1;
  cache.set(twitchId, es);
  return es;
}

/** Meses acumulados que sabemos (0 si solo lo sabemos por la insignia). */
export function meses(twitchId: string): number {
  const fila = getDb().prepare('SELECT meses FROM suscriptores WHERE twitch_id = ?').get(twitchId) as { meses: number } | undefined;
  return fila?.meses ?? 0;
}

/** Solo para tests (y tras !olvidame, que borra la fila). */
export function reset(): void {
  cache.clear();
}
