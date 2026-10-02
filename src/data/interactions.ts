import { getDb, nowIso } from './db.js';

/**
 * Qué pasó con una interacción.
 *
 * `skipped` y `blocked` no son errores: son decisiones del sistema, y saber
 * cuántas veces decide callarse será tan informativo como saber cuántas veces
 * habla cuando lleguen las métricas de la Fase 11.
 */
export type InteractionStatus = 'sent' | 'blocked' | 'skipped' | 'error';

export interface InteractionRow {
  id: number;
  interaction: string;
  twitch_id: string | null;
  at: string;
  status: InteractionStatus;
  detail: string | null;
}

export function record(params: {
  interaction: string;
  twitchId?: string | null;
  status: InteractionStatus;
  detail?: string | null;
}): void {
  getDb()
    .prepare('INSERT INTO interactions (interaction, twitch_id, at, status, detail) VALUES (?, ?, ?, ?, ?)')
    .run(
      params.interaction,
      params.twitchId ?? null,
      nowIso(),
      params.status,
      params.detail ?? null,
    );
}

export function findByUser(twitchId: string): InteractionRow[] {
  return getDb()
    .prepare('SELECT * FROM interactions WHERE twitch_id = ? ORDER BY id')
    .all(twitchId) as unknown as InteractionRow[];
}

export function all(): InteractionRow[] {
  return getDb().prepare('SELECT * FROM interactions ORDER BY id').all() as unknown as InteractionRow[];
}

export function count(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM interactions').get() as { n: number };
  return row.n;
}
