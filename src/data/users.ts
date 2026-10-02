import { getDb, nowIso } from './db.js';
import type { Viewer } from '../core/events.js';

export interface UserRow {
  twitch_id: string;
  login: string;
  display_name: string;
  first_seen: string;
  last_seen: string;
}

export function find(twitchId: string): UserRow | null {
  const row = getDb()
    .prepare(
      'SELECT twitch_id, login, display_name, first_seen, last_seen FROM users WHERE twitch_id = ?',
    )
    .get(twitchId);
  return (row as UserRow | undefined) ?? null;
}

export interface TouchResult {
  row: UserRow;
  isNew: boolean;
  /**
   * Cuándo se le vio por última vez ANTES de esta aparición. null si es nuevo.
   *
   * Existe porque `touch()` machaca `last_seen` con la hora actual, y el
   * manejador lo llama ANTES que a las interacciones. Sin guardar el valor
   * anterior, `#18 Bienvenida de Vuelta` no tendría forma de saber cuánto
   * tiempo llevaba sin aparecer: leería su propia escritura.
   */
  previousLastSeen: string | null;
}

/**
 * Registra la aparición de un espectador y dice si es la primera vez que
 * este sistema lo ve.
 *
 * Leer y después escribir es seguro aquí: Node es de un solo hilo y el
 * manejador de eventos procesa un mensaje entero antes de coger el siguiente,
 * así que no hay dos ejecuciones de esta función solapadas.
 */
export function touch(viewer: Viewer): TouchResult {
  const db = getDb();
  const now = nowIso();
  const existing = find(viewer.id);

  if (existing) {
    // El login y el nombre pueden cambiar con el tiempo: los refrescamos.
    db.prepare('UPDATE users SET login = ?, display_name = ?, last_seen = ? WHERE twitch_id = ?')
      .run(viewer.login, viewer.displayName, now, viewer.id);

    return {
      row: { ...existing, login: viewer.login, display_name: viewer.displayName, last_seen: now },
      isNew: false,
      previousLastSeen: existing.last_seen,
    };
  }

  db.prepare(
    'INSERT INTO users (twitch_id, login, display_name, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)',
  ).run(viewer.id, viewer.login, viewer.displayName, now, now);

  return {
    row: {
      twitch_id: viewer.id,
      login: viewer.login,
      display_name: viewer.displayName,
      first_seen: now,
      last_seen: now,
    },
    isNew: true,
    previousLastSeen: null,
  };
}

export function count(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  return row.n;
}

/** Alguien que ha pasado alguna vez por el chat, por su login (con o sin @). */
export function findByLogin(login: string): UserRow | null {
  const row = getDb()
    .prepare(
      'SELECT twitch_id, login, display_name, first_seen, last_seen FROM users WHERE login = ? ORDER BY last_seen DESC LIMIT 1',
    )
    .get(login.replace(/^@/, '').trim().toLowerCase());
  return (row as UserRow | undefined) ?? null;
}
