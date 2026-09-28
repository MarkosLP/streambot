import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DIR_BIBLIOTECA } from './biblioteca.js';
import * as imagen from '../services/ia-imagen.js';
import { log } from '../core/logger.js';
import { INFO, POR_DEFECTO, deNombre, info, type Estilo } from './estilos.js';
import * as rotulos from './rotulos.js';

/**
 * Fondos de las escenas generados con IA (27 sep 2026).
 *
 * Cada escena tiene una descripción ya preparada (se puede cambiar en
 * castellano en el panel) y una composición que deja sitio a lo que va
 * encima: el título en Empezamos, la cámara en Charla. El estilo (estilos.ts)
 * es el mismo para las cuatro, para que parezcan del mismo mundo.
 *
 * Se guardan en biblioteca/imagenes/fondos/ y se ven en la Biblioteca.
 */

export type EscenaFondo = 'inicio' | 'charla' | 'pausa' | 'final';

/** Las descripciones de siempre, del estilo oscuro. Cada estilo tiene las suyas en estilos.ts. */
export const DESCRIPCIONES: Record<EscenaFondo, string> = INFO.oscuro.descripciones;

/** Solo dónde va cada cosa: el ambiente lo pone el estilo. */
const COMPOSICION: Record<EscenaFondo, string> = {
  inicio: 'Wide establishing shot. Keep the upper-center sky calm and darker for a large title; keep the bottom band darker for small text.',
  charla: 'Most of the left two thirds will be covered by a webcam frame, so put the most interesting details on the right side and along the bottom.',
  pausa: 'Keep the center calm and darker for a large title.',
  final: 'Keep the upper half calm for a large title and the center darker for scrolling credits.',
};

/**
 * Petición propia literal, sin temática ni ambiente impuestos por el panel.
 * Los estilos predefinidos solo se añaden cuando no hay descripción propia.
 * `detalle` se conserva por compatibilidad y solo complementa el caso vacío.
 */
export function prompt(escena: EscenaFondo, descripcion: string, estilo: Estilo = POR_DEFECTO, detalle: string | null = null): string {
  const e = info(estilo);
  const propia = descripcion.trim().slice(0, 600);
  const que = propia || e.descripciones[escena];
  return [
    `PRIMARY SCENE REQUEST (verbatim, in Spanish): ${que}`,
    'Preserve the exact named game or franchise AND the specific location, building or character. Depict that subject recognizably within its original world, not a generic substitute or a location from another game. Do not invent landmark details you do not know.',
    'The original request above has priority over ALL instructions below, including art style and layout. Preserve its architecture, landmarks, silhouette and materials as well as any specified time of day, weather, colors, mood and people.',
    ...(!propia && detalle ? [`Optional supporting description, subordinate to the original: ${detalle}`] : []),
    propia ? 'Art direction: use the visual identity of the game or style explicitly requested. If none is specified, choose a coherent finish without adding a different franchise, setting or theme. No text, logos or watermarks.' : `Art style: ${e.fondo}`,
    `Layout (only where compatible with the request): ${COMPOSICION[escena]}`,
    ...(!propia ? [`Mood: ${e.tono[escena]}`] : []),
  ].join('\n');
}

const carpeta = (dir: string) => join(dir, 'imagenes', 'fondos');

/**
 * Genera un fondo y lo guarda con su título (el que pongas, o uno sacado de la
 * descripción). Devuelve su ruta en la biblioteca ('imagenes/fondos/…').
 */
export async function generar(escena: EscenaFondo, descripcion: string, estilo: Estilo = POR_DEFECTO, dir = DIR_BIBLIOTECA, titulo = ''): Promise<string> {
  const que = descripcion.trim().slice(0, 600) || info(estilo).descripciones[escena];
  // Sin reescritura intermedia: puede sustituir un lugar concreto por uno inventado.
  const png = await imagen.generar({ prompt: prompt(escena, descripcion, estilo), tamano: '1920x1088' });
  await mkdir(carpeta(dir), { recursive: true });
  const nombre = `${estilo}-${escena}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`;
  await writeFile(join(carpeta(dir), nombre), png);
  const ruta = `imagenes/fondos/${nombre}`;
  await rotulos.escribir(ruta, { titulo: rotulos.limpiarTitulo(titulo) || rotulos.tituloDe(que), descripcion: que }, dir);
  log.info(`Fondo generado con IA: ${nombre}`);
  return ruta;
}

/** Los fondos que hay, los más nuevos primero. */
export async function lista(dir = DIR_BIBLIOTECA): Promise<Array<{ ruta: string; escena: string; estilo: Estilo; titulo: string | null; at: string }>> {
  let nombres: string[];
  try {
    nombres = (await readdir(carpeta(dir))).filter((n) => /\.(png|jpe?g|webp)$/i.test(n));
  } catch {
    return [];
  }
  const filas = await Promise.all(nombres.map(async (n) => ({
    ruta: `imagenes/fondos/${n}`,
    ...partes(n),
    titulo: (await rotulos.leer(`imagenes/fondos/${n}`, dir))?.titulo ?? null,
    at: (await stat(join(carpeta(dir), n))).mtime.toISOString(),
  })));
  return filas.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * De qué estilo y escena es un archivo: 'alegre-inicio-2026….png'. Los de
 * antes de los estilos ('inicio-2026….png') son del oscuro.
 */
export function partes(nombre: string): { estilo: Estilo; escena: string } {
  const estilo = deNombre(nombre);
  const resto = nombre.startsWith(`${estilo}-`) ? nombre.slice(estilo.length + 1) : nombre;
  return { estilo, escena: resto.split('-')[0] ?? '' };
}

/**
 * El fondo más nuevo generado para una escena en un estilo, o null. Es el que
 * se usa si no has elegido otro: generar uno nuevo ya lo pone. Los nombres
 * llevan la fecha y ordenan solos.
 */
export function ultimoDe(escena: EscenaFondo, estilo: Estilo = POR_DEFECTO, dir = DIR_BIBLIOTECA): string | null {
  try {
    const n = readdirSync(carpeta(dir))
      .filter((x) => /\.(png|jpe?g|webp)$/i.test(x))
      .filter((x) => { const p = partes(x); return p.estilo === estilo && p.escena === escena; })
      .sort()
      .at(-1);
    return n ? `imagenes/fondos/${n}` : null;
  } catch {
    return null;
  }
}

/** Elegido a propósito «sin imagen»: el paisaje dibujado. */
export const DIBUJADO = 'dibujado';

/** Solo rutas de esta carpeta: el overlay la pinta como imagen. */
export const rutaValida = (r: unknown): r is string =>
  typeof r === 'string' && /^imagenes\/fondos\/[\w.-]+\.(png|jpe?g|webp)$/i.test(r) && !r.includes('..');

/** Borra un fondo generado y su título. Quien lo tuviera puesto pasa al último que quede. */
export async function borrar(ruta: string, dir = DIR_BIBLIOTECA): Promise<void> {
  if (!rutaValida(ruta)) throw new Error('fondo no válido');
  await rm(join(dir, ruta));
  await rm(join(dir, `${ruta}.json`), { force: true });
  log.info(`Fondo borrado: ${ruta}`);
}
