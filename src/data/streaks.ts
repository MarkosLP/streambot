import { getDb, nowIso } from './db.js';

/**
 * Rachas de asistencia (#19, docs/02 § 5).
 *
 * Cuenta directos CONSECUTIVOS a los que ha asistido una persona. Asistir es
 * escribir al menos un mensaje.
 *
 * El riesgo de esta interacción no es técnico, lo dice el catálogo: *"romper
 * una racha larga genera frustración real"*. Por eso existe el comodín, y por
 * eso toda la lógica delicada está aquí, separada de la interacción, donde se
 * puede probar caso por caso sin montar un directo entero.
 */

export interface StreakRow {
  twitch_id: string;
  current: number;
  best: number;
  last_stream_id: number | null;
  comodin_mes: string | null;
  updated_at: string;
}

/** Hitos que se anuncian. Salen de docs/02: 3, 5, 10, 25. */
export const HITOS = [3, 5, 10, 25] as const;

export function esHito(n: number): boolean {
  return (HITOS as readonly number[]).includes(n);
}

export function find(twitchId: string): StreakRow | null {
  const row = getDb()
    .prepare(
      'SELECT twitch_id, current, best, last_stream_id, comodin_mes, updated_at FROM streaks WHERE twitch_id = ?',
    )
    .get(twitchId);
  return (row as StreakRow | undefined) ?? null;
}

/** El mes actual en local, como "2026-09". Ver el comentario de la tabla. */
export function mesActual(ahora = new Date()): string {
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`;
}

/** Qué le ha pasado a la racha al registrar esta asistencia. */
export type Resultado =
  | { tipo: 'primera'; racha: number }
  | { tipo: 'continua'; racha: number }
  | { tipo: 'comodin'; racha: number; saltados: number }
  | { tipo: 'rota'; racha: number; anterior: number }
  | { tipo: 'repetida'; racha: number };

/**
 * Registra que alguien ha asistido al directo `streamId`.
 *
 * `anteriorId` es el id del directo INMEDIATAMENTE anterior a este, o null si
 * este es el primero de todos. Lo calcula quien llama, porque es una pregunta
 * sobre la tabla `streams` y aquí solo se decide qué hacer con la racha.
 *
 * Las cinco salidas posibles no son un capricho: la interacción necesita
 * distinguirlas para saber si dice algo y qué dice. Anunciar "racha rota" a
 * quien acaba de gastar el comodín sería justo lo contrario de la mitigación.
 */
export function registrarAsistencia(
  twitchId: string,
  streamId: number,
  anteriorId: number | null,
  ahora = new Date(),
): Resultado {
  const db = getDb();
  const previo = find(twitchId);
  const mes = mesActual(ahora);

  // Primera vez que se le ve en un directo.
  if (!previo) {
    db.prepare(
      'INSERT INTO streaks (twitch_id, current, best, last_stream_id, comodin_mes, updated_at) VALUES (?, 1, 1, ?, NULL, ?)',
    ).run(twitchId, streamId, nowIso());
    return { tipo: 'primera', racha: 1 };
  }

  // Ya se le contó en este mismo directo. Escribir diez mensajes no son diez
  // asistencias.
  if (previo.last_stream_id === streamId) {
    return { tipo: 'repetida', racha: previo.current };
  }

  const vinoAlAnterior = anteriorId !== null && previo.last_stream_id === anteriorId;

  if (vinoAlAnterior) {
    return guardar(twitchId, previo, previo.current + 1, streamId, previo.comodin_mes, {
      tipo: 'continua',
      racha: previo.current + 1,
    });
  }

  // Se ha saltado al menos uno. Aquí entra el comodín.
  const saltados = contarSaltados(previo.last_stream_id, streamId);
  const comodinDisponible = previo.comodin_mes !== mes;

  // El comodín perdona UN directo, no una desaparición de un mes. Perdonar
  // cualquier ausencia vaciaría de sentido la palabra "racha".
  if (saltados === 1 && comodinDisponible && previo.current > 0) {
    return guardar(twitchId, previo, previo.current + 1, streamId, mes, {
      tipo: 'comodin',
      racha: previo.current + 1,
      saltados,
    });
  }

  const anterior = previo.current;
  return guardar(twitchId, previo, 1, streamId, previo.comodin_mes, {
    tipo: 'rota',
    racha: 1,
    anterior,
  });
}

/** Cuántos directos se ha perdido entre el último al que vino y este. */
function contarSaltados(desdeId: number | null, hastaId: number): number {
  if (desdeId === null) return 0;
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM streams WHERE id > ? AND id < ?')
    .get(desdeId, hastaId) as { n: number };
  return Number(row.n);
}

function guardar(
  twitchId: string,
  previo: StreakRow,
  nueva: number,
  streamId: number,
  comodinMes: string | null,
  resultado: Resultado,
): Resultado {
  getDb()
    .prepare(
      'UPDATE streaks SET current = ?, best = ?, last_stream_id = ?, comodin_mes = ?, updated_at = ? WHERE twitch_id = ?',
    )
    .run(nueva, Math.max(previo.best, nueva), streamId, comodinMes, nowIso(), twitchId);

  return resultado;
}

/** Borra la racha de alguien. Lo usa `!olvidame`. */
export function borrar(twitchId: string): number {
  const info = getDb().prepare('DELETE FROM streaks WHERE twitch_id = ?').run(twitchId);
  return Number(info.changes);
}

export function count(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM streaks').get() as { n: number };
  return row.n;
}
