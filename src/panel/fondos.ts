import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DIR_BIBLIOTECA } from './biblioteca.js';
import * as imagen from '../services/ia-imagen.js';
import { log } from '../core/logger.js';

/**
 * Fondos de las escenas generados con IA (27 sep 2026).
 *
 * Cada escena tiene una descripción ya preparada (se puede cambiar en
 * castellano en el panel) y una composición que deja sitio a lo que va
 * encima: el título en Empezamos, la cámara en Charla. El estilo es el mismo
 * para todas, para que parezcan del mismo mundo.
 *
 * Se guardan en biblioteca/imagenes/fondos/ y se ven en la Biblioteca.
 */

export type EscenaFondo = 'inicio' | 'charla' | 'pausa' | 'final';

export const DESCRIPCIONES: Record<EscenaFondo, string> = {
  inicio: 'Un castillo gótico sobre un acantilado al anochecer, valles con niebla, una luna baja y ventanas encendidas',
  charla: 'El interior de una taberna medieval acogedora de noche, con chimenea, velas, mapas y armas en las paredes',
  pausa: 'Una hoguera de campamento en un bosque de noche, la tienda de un aventurero, estrellas y luciérnagas',
  final: 'Amanecer sobre un valle con ruinas antiguas y un camino que se pierde entre la niebla',
};

const ESTILO =
  'Cinematic dark fantasy matte painting used as a livestream overlay background. Painterly AAA game key art, ' +
  'rich atmosphere, volumetric light, depth and haze, deep shadows, cohesive muted palette with warm ember-orange accents. ' +
  'No text, no letters, no logos, no watermark, no UI, no people in the foreground.';

const COMPOSICION: Record<EscenaFondo, string> = {
  inicio: 'Wide establishing shot. Keep the upper-center sky calm and darker for a large title; keep the bottom band darker for small text.',
  charla: 'Most of the left two thirds will be covered by a webcam frame, so put the most interesting details on the right side and along the bottom; overall darker and low contrast so white text stays readable.',
  pausa: 'Quiet, restful mood with cooler night tones. Keep the center calm and darker for a large title.',
  final: 'Hopeful, warm soft light. Keep the upper half calm for a large title and the center darker for scrolling credits.',
};

export function prompt(escena: EscenaFondo, descripcion: string): string {
  const que = descripcion.trim().slice(0, 600) || DESCRIPCIONES[escena];
  return `${ESTILO}\nScene (described in Spanish): ${que}\n${COMPOSICION[escena]}`;
}

const carpeta = (dir: string) => join(dir, 'imagenes', 'fondos');

/** Genera un fondo y lo guarda. Devuelve su ruta en la biblioteca ('imagenes/fondos/…'). */
export async function generar(escena: EscenaFondo, descripcion: string, dir = DIR_BIBLIOTECA): Promise<string> {
  const png = await imagen.generar({ prompt: prompt(escena, descripcion), tamano: '1920x1088' });
  await mkdir(carpeta(dir), { recursive: true });
  const nombre = `${escena}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`;
  await writeFile(join(carpeta(dir), nombre), png);
  log.info(`Fondo generado con IA: ${nombre}`);
  return `imagenes/fondos/${nombre}`;
}

/** Los fondos que hay, los más nuevos primero. */
export async function lista(dir = DIR_BIBLIOTECA): Promise<Array<{ ruta: string; escena: string; at: string }>> {
  let nombres: string[];
  try {
    nombres = (await readdir(carpeta(dir))).filter((n) => /\.(png|jpe?g|webp)$/i.test(n));
  } catch {
    return [];
  }
  const filas = await Promise.all(nombres.map(async (n) => ({
    ruta: `imagenes/fondos/${n}`,
    escena: n.split('-')[0] ?? '',
    at: (await stat(join(carpeta(dir), n))).mtime.toISOString(),
  })));
  return filas.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * El fondo más nuevo generado para una escena, o null. Es el que se usa si no
 * has elegido otro: generar uno nuevo ya lo pone. Los nombres llevan la fecha
 * y ordenan solos.
 */
export function ultimoDe(escena: EscenaFondo, dir = DIR_BIBLIOTECA): string | null {
  try {
    const n = readdirSync(carpeta(dir)).filter((x) => x.startsWith(`${escena}-`) && /\.(png|jpe?g|webp)$/i.test(x)).sort().at(-1);
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
