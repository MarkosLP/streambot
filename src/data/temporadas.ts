import { getDb, nowIso } from './db.js';

/**
 * Temporadas del Loot (27 sep 2026).
 *
 * El poder de una mochila solo sube: quien lleva meses tiene un ranking que
 * nadie nuevo puede alcanzar. Por eso hay un segundo marcador, los PUNTOS DE
 * TEMPORADA, que vuelven a cero cada mes. Las mochilas no se tocan.
 *
 * Una temporada es un mes en hora local ('2026-09'). Al acabar, su podio pasa
 * al Salón de la Fama y el primero se queda un título para siempre.
 */

export interface Puesto {
  twitch_id: string;
  display_name: string;
  puntos: number;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** La temporada de una fecha, en hora local: '2026-09'. */
export function deFecha(fecha = new Date()): string {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;
}

/** 'septiembre' (o 'septiembre de 2025' si no es de este año). */
export function nombre(temporada: string, ahora = new Date()): string {
  const [anio, mes] = temporada.split('-').map(Number) as [number, number];
  const n = MESES[mes - 1] ?? temporada;
  return anio === ahora.getFullYear() ? n : `${n} de ${anio}`;
}

/** Días que le quedan a la temporada en curso (el de hoy cuenta). */
export function diasQuedan(ahora = new Date()): number {
  const fin = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1);
  const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  return Math.round((fin.getTime() - hoy.getTime()) / 86_400_000);
}

export function sumar(twitchId: string, displayName: string, puntos: number, ahora = new Date()): void {
  if (!twitchId || puntos <= 0) return;
  getDb()
    .prepare(
      `INSERT INTO temporada_puntos (temporada, twitch_id, display_name, puntos) VALUES (?, ?, ?, ?)
       ON CONFLICT(temporada, twitch_id) DO UPDATE SET puntos = puntos + excluded.puntos, display_name = excluded.display_name`,
    )
    .run(deFecha(ahora), twitchId, displayName, Math.round(puntos));
}

/** El ranking de una temporada, del primero al último. */
export function ranking(temporada: string, limite = 10, excluir: string[] = []): Puesto[] {
  const filas = getDb()
    .prepare('SELECT twitch_id, display_name, puntos FROM temporada_puntos WHERE temporada = ? AND puntos > 0 ORDER BY puntos DESC, rowid ASC')
    .all(temporada) as unknown as Puesto[];
  const fuera = excluir.map((e) => e.toLowerCase());
  return filas.filter((f) => !fuera.includes(f.display_name.toLowerCase())).slice(0, limite);
}

/** Tu puesto en una temporada, o null si aún no tienes puntos. */
export function puesto(temporada: string, twitchId: string, excluir: string[] = []): { puesto: number; de: number; puntos: number } | null {
  const todos = ranking(temporada, 100_000, excluir);
  const i = todos.findIndex((p) => p.twitch_id === twitchId);
  return i < 0 ? null : { puesto: i + 1, de: todos.length, puntos: todos[i]!.puntos };
}

// ---------------------------------------------------------------------------
// Cierre y Salón de la Fama
// ---------------------------------------------------------------------------

/** Temporadas anteriores a la actual con puntos y aún sin cerrar, de la más antigua a la más nueva. */
export function pendientesDeCerrar(ahora = new Date()): string[] {
  const filas = getDb()
    .prepare(
      `SELECT DISTINCT temporada FROM temporada_puntos
        WHERE temporada < ? AND temporada NOT IN (SELECT temporada FROM temporadas_cerradas)
        ORDER BY temporada`,
    )
    .all(deFecha(ahora)) as Array<{ temporada: string }>;
  return filas.map((f) => f.temporada);
}

/** Apunta el podio de una temporada y la marca como cerrada. Devuelve el podio. */
export function cerrar(temporada: string, podio: Puesto[]): void {
  const db = getDb();
  const insertar = db.prepare('INSERT OR REPLACE INTO salon_fama (temporada, puesto, twitch_id, display_name, puntos) VALUES (?, ?, ?, ?, ?)');
  podio.forEach((p, i) => insertar.run(temporada, i + 1, p.twitch_id, p.display_name, p.puntos));
  db.prepare('INSERT OR IGNORE INTO temporadas_cerradas (temporada, at) VALUES (?, ?)').run(temporada, nowIso());
}

/** Temporadas cerradas cuyo final aún no se ha contado en el chat. */
export function sinAnunciar(): string[] {
  return (getDb().prepare('SELECT temporada FROM temporadas_cerradas WHERE anunciada = 0 ORDER BY temporada').all() as Array<{ temporada: string }>)
    .map((f) => f.temporada);
}

export function marcarAnunciada(temporada: string): void {
  getDb().prepare('UPDATE temporadas_cerradas SET anunciada = 1 WHERE temporada = ?').run(temporada);
}

export function podio(temporada: string): Puesto[] {
  return getDb()
    .prepare('SELECT twitch_id, display_name, puntos FROM salon_fama WHERE temporada = ? ORDER BY puesto')
    .all(temporada) as unknown as Puesto[];
}

/** El Salón de la Fama entero, lo más reciente primero. */
export function salon(limite = 24): Array<{ temporada: string; podio: Puesto[] }> {
  const temporadas = getDb()
    .prepare('SELECT DISTINCT temporada FROM salon_fama ORDER BY temporada DESC LIMIT ?')
    .all(limite) as Array<{ temporada: string }>;
  return temporadas.map(({ temporada }) => ({ temporada, podio: podio(temporada) }));
}

/** La última temporada que ha ganado alguien, o null. */
export function ultimaGanada(twitchId: string): string | null {
  const f = getDb()
    .prepare('SELECT temporada FROM salon_fama WHERE twitch_id = ? AND puesto = 1 ORDER BY temporada DESC LIMIT 1')
    .get(twitchId) as { temporada: string } | undefined;
  return f?.temporada ?? null;
}
