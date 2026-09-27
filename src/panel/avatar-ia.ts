import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DIR_BIBLIOTECA } from './biblioteca.js';
import * as imagen from '../services/ia-imagen.js';
import { log } from '../core/logger.js';
import { INFO, POR_DEFECTO, deNombre, info, type Estilo } from './estilos.js';
import * as rotulos from './rotulos.js';

/**
 * El personaje del avatar, generado con IA (27 sep 2026).
 *
 * Tres imágenes del MISMO personaje, con fondo transparente: la base, con los
 * ojos cerrados (para parpadear y dormir) y contento (para el botín). Las dos
 * últimas salen editando la base, para que sea el mismo personaje; aun así
 * cambian detalles, por eso avatar.html solo cambia la zona de los ojos.
 *
 * Se guardan en biblioteca/imagenes/avatar/<estilo>-<fecha>/{base,cerrados,contento}.png
 * (el errante, el primero, no lleva estilo: es del oscuro).
 */

/** El personaje de siempre, del estilo oscuro. Cada estilo tiene el suyo en estilos.ts. */
export const DESCRIPCION = INFO.oscuro.avatar.descripcion;

const ENCUADRE =
  'Character portrait for a streamer avatar (PNGtuber): bust shot from mid-chest up, centered, facing the viewer, ' +
  'the whole character inside the frame with some margin. Transparent background, nothing behind the character, no text, no frame.';

const carpeta = (dir: string) => join(dir, 'imagenes', 'avatar');

/**
 * Crea un personaje nuevo (tres imágenes) con su nombre (el que pongas, o uno
 * sacado de la descripción). Devuelve su carpeta ('imagenes/avatar/…').
 */
export async function generar(descripcion: string, estilo: Estilo = POR_DEFECTO, dir = DIR_BIBLIOTECA, titulo = ''): Promise<string> {
  const a = info(estilo).avatar;
  const que = descripcion.trim().slice(0, 600) || a.descripcion;
  const base = await imagen.generar({ prompt: `${ENCUADRE} ${a.estilo}\nCharacter (described in Spanish): ${que}`, tamano: '1024x1024', transparente: true });
  const [cerrados, contento] = await Promise.all(
    [a.cerrados, a.contento].map((cambio) => imagen.editar({
      base,
      prompt: `Keep this exact same character, pose, framing, colors, lighting and transparent background. Change only this: ${cambio}`,
      tamano: '1024x1024',
      transparente: true,
    })),
  );
  const nombre = `${estilo}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  const destino = join(carpeta(dir), nombre);
  await mkdir(destino, { recursive: true });
  await writeFile(join(destino, 'base.png'), base);
  await writeFile(join(destino, 'cerrados.png'), cerrados!);
  await writeFile(join(destino, 'contento.png'), contento!);
  const ruta = `imagenes/avatar/${nombre}`;
  await rotulos.escribir(ruta, { titulo: rotulos.limpiarTitulo(titulo) || rotulos.tituloDe(que), descripcion: que }, dir);
  log.info(`Avatar generado con IA: ${nombre}`);
  return ruta;
}

/** Los personajes que hay, los más nuevos primero. */
/** El nombre de un personaje: el suyo, o «El errante» para el primero. */
export async function titulo(ruta: string, dir = DIR_BIBLIOTECA): Promise<string | null> {
  return (await rotulos.leer(ruta, dir))?.titulo ?? (ruta === ERRANTE ? 'El errante' : null);
}

export async function lista(dir = DIR_BIBLIOTECA): Promise<Array<{ ruta: string; estilo: Estilo; titulo: string | null; at: string }>> {
  let nombres: string[];
  try {
    nombres = await readdir(carpeta(dir));
  } catch {
    return [];
  }
  const filas = await Promise.all(nombres.map(async (n) => {
    try {
      const s = await stat(join(carpeta(dir), n, 'base.png'));
      const ruta = `imagenes/avatar/${n}`;
      return { ruta, estilo: deNombre(n), titulo: await titulo(ruta, dir), at: s.mtime.toISOString() };
    } catch {
      return null;
    }
  }));
  return filas.filter((f): f is { ruta: string; estilo: Estilo; titulo: string | null; at: string } => f !== null).sort((a, b) => b.at.localeCompare(a.at));
}

/** El primer personaje: el que sale si un estilo aún no tiene el suyo. */
export const ERRANTE = 'imagenes/avatar/errante';

/**
 * El personaje más nuevo de un estilo, o null. Es el que se usa si no has
 * elegido otro: crear uno nuevo ya lo pone. Los nombres llevan la fecha.
 */
export function ultimoDe(estilo: Estilo, dir = DIR_BIBLIOTECA): string | null {
  try {
    const n = readdirSync(carpeta(dir))
      .filter((x) => x.startsWith(`${estilo}-`) && existsSync(join(carpeta(dir), x, 'base.png')))
      .sort()
      .at(-1);
    return n ? `imagenes/avatar/${n}` : null;
  } catch {
    return null;
  }
}

export const rutaValida = (r: unknown): r is string =>
  typeof r === 'string' && /^imagenes\/avatar\/[\w.-]+$/.test(r) && !r.includes('..');
