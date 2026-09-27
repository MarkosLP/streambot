import { readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIR_BIBLIOTECA } from './biblioteca.js';

/**
 * Títulos de las imágenes generadas con IA (27 sep 2026): con varios fondos y
 * personajes, «Creado el 27 sep, 12:04» no dice cuál es cuál.
 *
 * El título va en un .json al lado de la imagen, para que viaje con ella:
 *   imagenes/fondos/<archivo>.png  →  imagenes/fondos/<archivo>.png.json
 *   imagenes/avatar/<carpeta>/     →  imagenes/avatar/<carpeta>/info.json
 * Si no lo pones, sale de la descripción. Lo de antes, sin .json, no tiene.
 */

export interface Rotulo {
  titulo: string;
  descripcion?: string;
}

export const LARGO_TITULO = 40;

/**
 * Un título corto a partir de la descripción: hasta la primera coma, punto o
 * dos puntos, sin el artículo del principio y cortado en una palabra.
 * «Un cachorro de león amarillo, pequeño…» → «Cachorro de león amarillo».
 */
export function tituloDe(descripcion: string): string {
  let t = descripcion.trim().split(/[,.:;\n(]/)[0]!.trim();
  t = t.replace(/^(un|una|unos|unas|el|la|los|las)\s+/i, '');
  if (t.length > LARGO_TITULO) {
    const corte = t.slice(0, LARGO_TITULO + 1);
    t = corte.slice(0, Math.max(corte.lastIndexOf(' '), 12)).trim();
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export const limpiarTitulo = (v: unknown): string =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, LARGO_TITULO) : '';

/** El .json de una ruta de la biblioteca ('imagenes/fondos/x.png' o 'imagenes/avatar/x'). */
function archivo(ruta: string, dir: string): string {
  return ruta.startsWith('imagenes/avatar/') ? join(dir, ruta, 'info.json') : join(dir, `${ruta}.json`);
}

export async function escribir(ruta: string, r: Rotulo, dir = DIR_BIBLIOTECA): Promise<void> {
  await writeFile(archivo(ruta, dir), JSON.stringify(r, null, 2));
}

function desde(texto: string): Rotulo | null {
  try {
    const v = JSON.parse(texto);
    return typeof v?.titulo === 'string' && v.titulo ? { titulo: limpiarTitulo(v.titulo), descripcion: typeof v.descripcion === 'string' ? v.descripcion : undefined } : null;
  } catch {
    return null;
  }
}

export async function leer(ruta: string, dir = DIR_BIBLIOTECA): Promise<Rotulo | null> {
  try {
    return desde(await readFile(archivo(ruta, dir), 'utf8'));
  } catch {
    return null;
  }
}

export function leerSync(ruta: string, dir = DIR_BIBLIOTECA): Rotulo | null {
  try {
    return desde(readFileSync(archivo(ruta, dir), 'utf8'));
  } catch {
    return null;
  }
}

/** Cambia el título y deja la descripción que hubiera. */
export async function renombrar(ruta: string, titulo: string, dir = DIR_BIBLIOTECA): Promise<string> {
  const t = limpiarTitulo(titulo);
  if (!t) throw new Error('El título no puede ir vacío');
  const antes = await leer(ruta, dir);
  await escribir(ruta, { ...antes, titulo: t }, dir);
  return t;
}
