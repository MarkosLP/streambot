import { getDb, nowIso } from '../../data/db.js';
import { log } from '../../core/logger.js';

/**
 * El evento de la semana (27 sep 2026): un modificador del Loot que cambia
 * solo cada lunes. No hace falta programar nada nuevo cada semana: rota por
 * esta lista, y cada uno cambia UNA regla que ya existe.
 *
 * Desde el panel se puede fijar uno concreto o quitarlos ('ninguno'). Se
 * guarda en la tabla `ajustes` con la clave 'evento'; sin fila, rota solo.
 */

export type IdEvento = 'fiebre-oro' | 'semana-maldita' | 'forja-caliente' | 'coleccionista' | 'arena' | 'caza-mayor';

export interface Evento {
  id: IdEvento;
  nombre: string;
  emoji: string;
  /** Lo que se dice en el chat: qué cambia, en una frase. */
  texto: string;
}

export const EVENTOS: Evento[] = [
  { id: 'fiebre-oro', emoji: '🪙', nombre: 'Fiebre del oro', texto: 'los cofres del chat tienen la suerte del Cofre del tesoro' },
  { id: 'semana-maldita', emoji: '☠️', nombre: 'Semana maldita', texto: '1 de cada 6 objetos de los cofres sale maldito (poder doble, pero se pierde en duelos)' },
  { id: 'forja-caliente', emoji: '🔥', nombre: 'Forja al rojo vivo', texto: '!forjar pide 2 objetos en vez de 3' },
  { id: 'coleccionista', emoji: '📖', nombre: 'Semana del coleccionista', texto: 'si un cofre te iba a dar algo que ya tenías en la colección, se vuelve a tirar' },
  { id: 'arena', emoji: '🤺', nombre: 'Semana de la arena', texto: 'ganar un duelo da el triple de puntos de temporada' },
  { id: 'caza-mayor', emoji: '🐉', nombre: 'Caza mayor', texto: 'al tumbar un jefe, todos los que pegan reciben un Cofre del tesoro' },
];

export type Eleccion = 'auto' | 'ninguno' | IdEvento;

const CLAVE = 'evento';
/** En memoria; null = aún sin leer de la base de datos. */
let eleccion: Eleccion | null = null;

function leer(): Eleccion {
  if (eleccion !== null) return eleccion;
  try {
    const f = getDb().prepare('SELECT valor FROM ajustes WHERE clave = ?').get(CLAVE) as { valor: string } | undefined;
    eleccion = valida(f?.valor) ?? 'auto';
  } catch {
    eleccion = 'auto';
  }
  return eleccion;
}

function valida(v: unknown): Eleccion | null {
  if (v === 'auto' || v === 'ninguno') return v;
  return EVENTOS.some((e) => e.id === v) ? (v as IdEvento) : null;
}

/** Desde el panel. Devuelve false si no es una elección válida. */
export function elegir(v: unknown, quien: string): boolean {
  const e = valida(v);
  if (!e) return false;
  eleccion = e;
  try {
    getDb()
      .prepare('INSERT INTO ajustes (clave, valor, at) VALUES (?, ?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, at = excluded.at')
      .run(CLAVE, e, nowIso());
  } catch { /* sin base de datos: se queda en memoria */ }
  log.warn(`Evento de la semana: ${e === 'auto' ? 'rota solo' : e} — ${quien}.`);
  return true;
}

/** El lunes (hora local) de la semana de una fecha. */
function lunes(fecha: Date): Date {
  const d = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/** El que toca por rotación: el mismo toda la semana, de lunes a domingo. */
export function porRotacion(ahora = new Date()): Evento {
  // Días desde un lunes de referencia; con fechas locales a mediodía no le
  // afecta el cambio de hora.
  const ref = new Date(2026, 0, 5, 12);
  const l = lunes(ahora);
  l.setHours(12);
  const semanas = Math.round((l.getTime() - ref.getTime()) / (7 * 86_400_000));
  return EVENTOS[((semanas % EVENTOS.length) + EVENTOS.length) % EVENTOS.length]!;
}

/** El evento en vigor, o null si no hay ninguno. */
export function actual(ahora = new Date()): Evento | null {
  const e = leer();
  if (e === 'ninguno') return null;
  if (e === 'auto') return porRotacion(ahora);
  return EVENTOS.find((x) => x.id === e) ?? null;
}

export const activo = (id: IdEvento, ahora = new Date()) => actual(ahora)?.id === id;

/** Cuándo cambia: el próximo lunes. */
export function diasParaCambiar(ahora = new Date()): number {
  const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  return 7 - ((hoy.getDay() + 6) % 7);
}

/** `☠️ Semana maldita: 1 de cada 6…`, para el chat. */
export const describir = (e: Evento) => `${e.emoji} ${e.nombre}: ${e.texto}`;

/** Para el panel. */
export function estado(ahora = new Date()) {
  return {
    eleccion: leer(),
    actual: actual(ahora),
    rotacion: porRotacion(ahora),
    cambiaEnDias: diasParaCambiar(ahora),
    eventos: EVENTOS,
  };
}

/**
 * Solo para tests (lo llama loot.reset): sin evento, para que ninguna prueba
 * dependa de la semana en que se ejecuta. `e` fija uno concreto.
 */
export function reset(e: Eleccion = 'ninguno'): void {
  eleccion = e;
}
