import { getDb, nowIso } from './db.js';
import * as suscriptores from './suscriptores.js';
import * as temporadas from './temporadas.js';
import {
  MOCHILA_MAX,
  MOCHILA_SUB,
  OBJETOS_MECENAS,
  TITULO_MECENAS,
  NIVEL,
  OBJETOS,
  PODER,
  RAREZAS,
  TITULOS,
  poderDe,
  type Botin,
  type Rareza,
} from '../interactions/loot/objetos.js';

/**
 * Inventarios del Loot del chat.
 *
 * Una fila por objeto en la mochila. Se guarda el NOMBRE del objeto y no un
 * id del catálogo: si mañana cambias el catálogo, lo que ya tiene la gente no
 * se transforma en otra cosa ni desaparece.
 *
 * Aparte, `coleccion` recuerda qué objetos distintos ha tenido cada uno ALGUNA
 * vez, y `duelos` sus victorias. `!olvidame` borra las tres (core/consent.ts).
 */

export type Origen = 'cofre' | 'oro' | 'panel' | 'regalo' | 'jefe' | 'fidelidad' | 'suscriptor' | 'raid' | 'bits' | 'forja' | 'guerra' | 'maldicion' | 'temporada';

export interface FilaLoot {
  id: number;
  twitch_id: string;
  display_name: string;
  objeto: string;
  rareza: Rareza;
  origen: Origen;
  at: string;
  maldito: number;
}

/** Orden de rareza en SQL: el texto no se ordena solo. */
const ORDEN_RAREZA = `CASE rareza WHEN 'legendario' THEN 4 WHEN 'epico' THEN 3 WHEN 'raro' THEN 2 ELSE 1 END`;

/** El poder de una fila en SQL: el de su rareza, el doble si está maldita. */
const PODER_SQL = `(CASE rareza WHEN 'legendario' THEN ${PODER.legendario} WHEN 'epico' THEN ${PODER.epico}
  WHEN 'raro' THEN ${PODER.raro} ELSE ${PODER.comun} END) * (1 + maldito)`;
const ORDEN_PODER = `${PODER_SQL}`;

// ---------------------------------------------------------------------------
// Meter cosas en la mochila
// ---------------------------------------------------------------------------

export interface Resultado {
  /** true = el objeto está en la mochila. */
  guardado: boolean;
  /** Lo que se tiró para hacerle sitio, si la mochila estaba llena. */
  sustituido: Botin | null;
  /** Primera vez que tiene este objeto: cuenta para la colección. */
  nuevoEnColeccion: boolean;
  /** Título ganado justo ahora al completar una rareza. */
  tituloNuevo: string | null;
}

/**
 * Mete un objeto en la mochila respetando el límite.
 *
 * Con la mochila llena, lo nuevo entra si es IGUAL O MEJOR que lo peor que
 * llevas, y lo peor (el más antiguo, entre iguales) se tira. Si es peor, se
 * queda en el suelo. En los dos casos cuenta para la colección: lo has
 * conseguido, aunque no te lo quedes.
 */
export function dar(twitchId: string, displayName: string, botin: Botin, origen: Origen, at = nowIso()): Resultado {
  const db = getDb();
  const antes = titulo(twitchId);
  const nuevoEnColeccion = Number(
    db
      .prepare('INSERT OR IGNORE INTO coleccion (twitch_id, objeto, rareza, first_at) VALUES (?, ?, ?, ?)')
      .run(twitchId, botin.objeto, botin.rareza, at).changes,
  ) > 0;
  const despues = titulo(twitchId);
  const tituloNuevo = despues !== antes ? despues : null;
  // Puntos de temporada: lo que vale el objeto, se lo quede o no (como la
  // colección). El premio de fin de temporada no suma: sería empezar la
  // siguiente con ventaja.
  if (origen !== 'temporada') temporadas.sumar(twitchId, displayName, poderDe(botin));

  let sustituido: Botin | null = null;
  if (contar(twitchId) >= capacidad(twitchId)) {
    // Una maldición no se tira: lo peor se busca entre lo que no está maldito.
    const peor = db
      .prepare(`SELECT id, objeto, rareza FROM loot WHERE twitch_id = ? AND maldito = 0 ORDER BY ${ORDEN_RAREZA} ASC, id ASC LIMIT 1`)
      .get(twitchId) as { id: number; objeto: string; rareza: Rareza } | undefined;
    // Y un objeto maldito entra siempre: las maldiciones no respetan mochilas.
    if (!botin.maldito && (!peor || NIVEL[botin.rareza] < NIVEL[peor.rareza])) {
      return { guardado: false, sustituido: null, nuevoEnColeccion, tituloNuevo };
    }
    if (peor) {
      db.prepare('DELETE FROM loot WHERE id = ?').run(peor.id);
      sustituido = { objeto: peor.objeto, rareza: peor.rareza };
    }
  }

  db.prepare('INSERT INTO loot (twitch_id, display_name, objeto, rareza, origen, at, maldito) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(twitchId, displayName, botin.objeto, botin.rareza, origen, at, botin.maldito ? 1 : 0);
  return { guardado: true, sustituido, nuevoEnColeccion, tituloNuevo };
}

/** Sin límite ni colección. Solo para preparar datos en los tests. */
export function guardar(twitchId: string, displayName: string, botin: Botin, origen: Origen, at = nowIso()): void {
  getDb()
    .prepare('INSERT INTO loot (twitch_id, display_name, objeto, rareza, origen, at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(twitchId, displayName, botin.objeto, botin.rareza, origen, at);
}

export function contar(twitchId: string): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM loot WHERE twitch_id = ?').get(twitchId) as { n: number }).n;
}

// ---------------------------------------------------------------------------
// Mirar la mochila
// ---------------------------------------------------------------------------

export interface Inventario {
  total: number;
  porRareza: Record<Rareza, number>;
  /** La pieza de más rareza; entre iguales, la más reciente. */
  mejor: Botin | null;
  poder: number;
  malditos: number;
  /** Por rareza, sin los malditos: lo que se puede fundir en la forja. */
  forjables: Record<Rareza, number>;
}

export function inventario(twitchId: string): Inventario {
  const db = getDb();
  const filas = db
    .prepare('SELECT rareza, maldito, COUNT(*) AS n FROM loot WHERE twitch_id = ? GROUP BY rareza, maldito')
    .all(twitchId) as Array<{ rareza: Rareza; maldito: number; n: number }>;

  const porRareza = Object.fromEntries(RAREZAS.map((r) => [r, 0])) as Record<Rareza, number>;
  const forjables = Object.fromEntries(RAREZAS.map((r) => [r, 0])) as Record<Rareza, number>;
  let malditos = 0;
  let poder = 0;
  for (const f of filas) {
    porRareza[f.rareza] += f.n;
    if (f.maldito) malditos += f.n;
    else forjables[f.rareza] += f.n;
    poder += f.n * PODER[f.rareza] * (f.maldito ? 2 : 1);
  }

  // La mejor pieza: la de más poder. Un Épico maldito (16) gana a un Épico (8).
  const mejor = db
    .prepare(`SELECT objeto, rareza, maldito FROM loot WHERE twitch_id = ? ORDER BY ${ORDEN_PODER} DESC, id DESC LIMIT 1`)
    .get(twitchId) as { objeto: string; rareza: Rareza; maldito: number } | undefined;

  return {
    total: filas.reduce((n, f) => n + f.n, 0),
    porRareza,
    malditos,
    forjables,
    mejor: mejor ? { objeto: mejor.objeto, rareza: mejor.rareza, maldito: mejor.maldito === 1 } : null,
    poder,
  };
}

export function poder(twitchId: string): number {
  return inventario(twitchId).poder;
}

// ---------------------------------------------------------------------------
// Forja
// ---------------------------------------------------------------------------

/**
 * Quita `cantidad` objetos de una rareza, los más antiguos primero.
 * Devuelve cuáles, o null si no hay suficientes (y entonces no quita nada).
 */
export function consumir(twitchId: string, rareza: Rareza, cantidad: number): Botin[] | null {
  const db = getDb();
  const filas = db
    // Los malditos no se forjan: ya son especiales.
    .prepare('SELECT id, objeto, rareza FROM loot WHERE twitch_id = ? AND rareza = ? AND maldito = 0 ORDER BY id ASC LIMIT ?')
    .all(twitchId, rareza, cantidad) as Array<{ id: number; objeto: string; rareza: Rareza }>;
  if (filas.length < cantidad) return null;
  const borrar = db.prepare('DELETE FROM loot WHERE id = ?');
  for (const f of filas) borrar.run(f.id);
  return filas.map(({ objeto, rareza: r }) => ({ objeto, rareza: r }));
}

// ---------------------------------------------------------------------------
// Colección y títulos
// ---------------------------------------------------------------------------

export interface Coleccion {
  total: number;
  de: number;
  porRareza: Record<Rareza, { tiene: number; de: number }>;
}

export function coleccion(twitchId: string): Coleccion {
  const filas = getDb()
    .prepare('SELECT objeto, rareza FROM coleccion WHERE twitch_id = ?')
    .all(twitchId) as Array<{ objeto: string; rareza: Rareza }>;
  // Solo cuenta lo que está en el catálogo de su rareza: ni los de mecenas
  // (colección aparte) ni objetos que ya no existan.
  const porRareza = Object.fromEntries(
    RAREZAS.map((r) => [r, { tiene: filas.filter((f) => f.rareza === r && OBJETOS[r].includes(f.objeto)).length, de: OBJETOS[r].length }]),
  ) as Coleccion['porRareza'];
  return {
    total: RAREZAS.reduce((n, r) => n + porRareza[r].tiene, 0),
    de: RAREZAS.reduce((n, r) => n + porRareza[r].de, 0),
    porRareza,
  };
}

/**
 * El título más alto que ha ganado: el de la rareza más alta cuya colección
 * está completa. Cuenta con el catálogo ACTUAL; si añades objetos, habrá que
 * conseguirlos para recuperar el título.
 */
export function titulo(twitchId: string): string | null {
  const c = coleccion(twitchId);
  // El más alto: Leyenda Viviente, Campeón de una temporada, Mecenas del Reino, el resto.
  if (c.porRareza.legendario.tiene >= c.porRareza.legendario.de) return TITULOS.legendario;
  // Ganar una temporada da un título para siempre (el de la última ganada).
  const ganada = temporadas.ultimaGanada(twitchId);
  if (ganada) return `Campeón de ${temporadas.nombre(ganada)}`;
  if (mecenas(twitchId).tiene >= OBJETOS_MECENAS.length) return TITULO_MECENAS;
  for (const r of [...RAREZAS].reverse()) {
    if (c.porRareza[r].tiene >= c.porRareza[r].de) return TITULOS[r];
  }
  return null;
}

/** ¿Ha tenido alguna vez este objeto? (Semana del coleccionista.) */
export function loTuvo(twitchId: string, objeto: string): boolean {
  return getDb().prepare('SELECT 1 FROM coleccion WHERE twitch_id = ? AND objeto = ?').get(twitchId, objeto) !== undefined;
}

/** Cuántos de la colección de mecenas ha conseguido alguien alguna vez. */
export function mecenas(twitchId: string): { tiene: number; de: number } {
  const nombres = OBJETOS_MECENAS.map((m) => m.objeto);
  const filas = getDb().prepare('SELECT objeto FROM coleccion WHERE twitch_id = ?').all(twitchId) as Array<{ objeto: string }>;
  return { tiene: filas.filter((f) => nombres.includes(f.objeto)).length, de: nombres.length };
}

/** Cuántos objetos caben en su mochila: 30 si es suscriptor (S5), 20 si no. */
export function capacidad(twitchId: string): number {
  return suscriptores.esSub(twitchId) ? MOCHILA_SUB : MOCHILA_MAX;
}

// ---------------------------------------------------------------------------
// Duelos
// ---------------------------------------------------------------------------

export function apuntarDuelo(ganador: string, perdedor: string): void {
  const db = getDb();
  db.prepare('INSERT INTO duelos (twitch_id, ganados, perdidos) VALUES (?, 1, 0) ON CONFLICT(twitch_id) DO UPDATE SET ganados = ganados + 1').run(ganador);
  db.prepare('INSERT INTO duelos (twitch_id, ganados, perdidos) VALUES (?, 0, 1) ON CONFLICT(twitch_id) DO UPDATE SET perdidos = perdidos + 1').run(perdedor);
}

export function duelos(twitchId: string): { ganados: number; perdidos: number } {
  const fila = getDb().prepare('SELECT ganados, perdidos FROM duelos WHERE twitch_id = ?').get(twitchId) as
    | { ganados: number; perdidos: number }
    | undefined;
  return { ganados: fila?.ganados ?? 0, perdidos: fila?.perdidos ?? 0 };
}

// ---------------------------------------------------------------------------
// Para el panel
// ---------------------------------------------------------------------------

export function recientes(limite = 20): FilaLoot[] {
  return getDb()
    .prepare('SELECT id, twitch_id, display_name, objeto, rareza, origen, at, maldito FROM loot ORDER BY id DESC LIMIT ?')
    .all(limite) as unknown as FilaLoot[];
}

/** Las mochilas más fuertes: por poder. */
export function mochilas(limite = 10) {
  const filas = getDb()
    .prepare(
      `SELECT twitch_id, MAX(display_name) AS display_name, COUNT(*) AS total,
              SUM(rareza = 'legendario') AS legendarios, SUM(rareza = 'epico') AS epicos,
              SUM(${PODER_SQL}) AS poder, SUM(maldito) AS malditos
       FROM loot GROUP BY twitch_id ORDER BY poder DESC, total DESC LIMIT ?`,
    )
    .all(limite) as Array<{ twitch_id: string; display_name: string; total: number; legendarios: number; epicos: number; poder: number; malditos: number }>;
  return filas.map((f) => ({ ...f, ...duelos(f.twitch_id), titulo: titulo(f.twitch_id), coleccion: coleccion(f.twitch_id).total }));
}

/** El puesto por poder entre quienes tienen algo (1 = el más fuerte). */
export function puesto(twitchId: string): { puesto: number; de: number } | null {
  const todos = mochilas(1000);
  const i = todos.findIndex((m) => m.twitch_id === twitchId);
  return i < 0 ? null : { puesto: i + 1, de: todos.length };
}

// ---------------------------------------------------------------------------
// Malditos
// ---------------------------------------------------------------------------

/** El maldito más fuerte de alguien, con su fila; o null si no lleva ninguno. */
function peorMaldicion(twitchId: string): { id: number; objeto: string; rareza: Rareza } | null {
  const fila = getDb()
    .prepare(`SELECT id, objeto, rareza FROM loot WHERE twitch_id = ? AND maldito = 1 ORDER BY ${ORDEN_RAREZA} DESC, id ASC LIMIT 1`)
    .get(twitchId) as { id: number; objeto: string; rareza: Rareza } | undefined;
  return fila ?? null;
}

export function tieneMaldito(twitchId: string): Botin | null {
  const f = peorMaldicion(twitchId);
  return f ? { objeto: f.objeto, rareza: f.rareza, maldito: true } : null;
}

/**
 * Tras un duelo, el maldito más fuerte del perdedor pasa al ganador. Sigue
 * maldito: la patata caliente cambia de manos. Entra aunque la mochila del
 * ganador esté llena.
 */
export function traspasarMaldito(deId: string, aId: string, aNombre: string): Botin | null {
  const f = peorMaldicion(deId);
  if (!f) return null;
  const db = getDb();
  db.prepare('UPDATE loot SET twitch_id = ?, display_name = ? WHERE id = ?').run(aId, aNombre, f.id);
  db.prepare('INSERT OR IGNORE INTO coleccion (twitch_id, objeto, rareza, first_at) VALUES (?, ?, ?, ?)')
    .run(aId, f.objeto, f.rareza, nowIso());
  return { objeto: f.objeto, rareza: f.rareza, maldito: true };
}

/** Quita la maldición del maldito más fuerte: ya no se pierde en duelos, pero pierde el poder doble. */
export function purificar(twitchId: string): Botin | null {
  const f = peorMaldicion(twitchId);
  if (!f) return null;
  getDb().prepare('UPDATE loot SET maldito = 0 WHERE id = ?').run(f.id);
  return { objeto: f.objeto, rareza: f.rareza };
}

export function borrarDe(twitchId: string): number {
  return Number(getDb().prepare('DELETE FROM loot WHERE twitch_id = ?').run(twitchId).changes);
}

// ---------------------------------------------------------------------------
// Dar y usar
// ---------------------------------------------------------------------------

const sinTildes = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Qué objeto de la mochila se quiere: el que lleve ese texto en el nombre, el
 * más antiguo de esa rareza, o sin nada, el peor que lleves. Nunca un maldito:
 * las maldiciones solo cambian de manos perdiendo un duelo.
 */
export function elegir(twitchId: string, que: { rareza?: Rareza; texto?: string } = {}): (Botin & { id: number }) | null {
  const filas = getDb()
    .prepare(`SELECT id, objeto, rareza FROM loot WHERE twitch_id = ? AND maldito = 0 ORDER BY ${ORDEN_RAREZA} ASC, id ASC`)
    .all(twitchId) as Array<{ id: number; objeto: string; rareza: Rareza }>;
  const texto = que.texto ? sinTildes(que.texto.trim()) : '';
  const f = texto
    ? filas.find((x) => sinTildes(x.objeto).includes(texto))
    : que.rareza
      ? filas.find((x) => x.rareza === que.rareza)
      : filas[0];
  return f ? { id: f.id, objeto: f.objeto, rareza: f.rareza } : null;
}

/**
 * Pasa un objeto (por su fila) a otra persona. Cuenta para su colección.
 * No mira el límite de la mochila: eso lo decide quien llama, antes.
 */
export function pasar(filaId: number, aId: string, aNombre: string): { tituloNuevo: string | null } {
  const db = getDb();
  const f = db.prepare('SELECT objeto, rareza FROM loot WHERE id = ?').get(filaId) as { objeto: string; rareza: Rareza } | undefined;
  if (!f) return { tituloNuevo: null };
  const antes = titulo(aId);
  db.prepare('UPDATE loot SET twitch_id = ?, display_name = ? WHERE id = ?').run(aId, aNombre, filaId);
  db.prepare('INSERT OR IGNORE INTO coleccion (twitch_id, objeto, rareza, first_at) VALUES (?, ?, ?, ?)')
    .run(aId, f.objeto, f.rareza, nowIso());
  const despues = titulo(aId);
  return { tituloNuevo: despues !== antes ? despues : null };
}

/** Quita un objeto de la mochila por su fila (al usarlo). */
export function gastar(filaId: number): void {
  getDb().prepare('DELETE FROM loot WHERE id = ?').run(filaId);
}

/**
 * Alguien que ha tenido botín alguna vez, por su nombre. Hace falta para el
 * canal: nunca se guarda en `users`, pero sí tiene mochila.
 */
export function porNombre(login: string): { twitch_id: string; display_name: string } | null {
  const fila = getDb()
    .prepare('SELECT twitch_id, display_name FROM loot WHERE lower(display_name) = ? ORDER BY id DESC LIMIT 1')
    .get(login.replace(/^@/, '').trim().toLowerCase());
  return (fila as { twitch_id: string; display_name: string } | undefined) ?? null;
}

/**
 * Lo que alguien puede regalar, numerado en el orden en que se enseña en el
 * chat (de peor a mejor): `!dar ana 2` da el segundo de esta lista.
 */
export function regalables(twitchId: string): Array<Botin & { id: number }> {
  return getDb()
    .prepare(`SELECT id, objeto, rareza FROM loot WHERE twitch_id = ? AND maldito = 0 ORDER BY ${ORDEN_RAREZA} ASC, id ASC`)
    .all(twitchId) as unknown as Array<Botin & { id: number }>;
}

/** Todo lo que lleva alguien, lo mejor primero. Para la ficha del panel. */
export function mochila(twitchId: string): Array<Botin & { origen: string; at: string }> {
  const filas = getDb()
    .prepare(`SELECT objeto, rareza, maldito, origen, at FROM loot WHERE twitch_id = ? ORDER BY ${ORDEN_RAREZA} DESC, id DESC`)
    .all(twitchId) as Array<{ objeto: string; rareza: Rareza; maldito: number; origen: string; at: string }>;
  return filas.map((f) => ({ objeto: f.objeto, rareza: f.rareza, maldito: f.maldito === 1, origen: f.origen, at: f.at }));
}
