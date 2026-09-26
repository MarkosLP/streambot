import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DIR_BIBLIOTECA } from './biblioteca.js';
import * as imagen from '../services/ia-imagen.js';
import { log } from '../core/logger.js';

/**
 * El personaje del avatar, generado con IA (27 sep 2026).
 *
 * Tres imágenes del MISMO personaje, con fondo transparente: la base, con los
 * ojos cerrados (para parpadear y dormir) y contento (para el botín). Las dos
 * últimas salen editando la base, para que sea el mismo personaje; aun así
 * cambian detalles, por eso avatar.html solo cambia la zona de los ojos.
 *
 * Se guardan en biblioteca/imagenes/avatar/<nombre>/{base,cerrados,contento}.png.
 */

export const DESCRIPCION =
  'Un errante encapuchado de un mundo de fantasía oscura: capucha y capa gris oscuro con morado, un pañuelo rojo oscuro ' +
  'que le tapa la boca, la cara en sombra salvo dos ojos ámbar que brillan, una hombrera de acero gastada con un filo dorado ' +
  'y un correaje de cuero con hebilla de latón cruzando el pecho.';

const ESTILO =
  'Character portrait for a streamer avatar (PNGtuber): bust shot from mid-chest up, centered, facing the viewer, ' +
  'the whole character inside the frame with some margin. Painterly AAA game concept art, high detail, clean readable silhouette, ' +
  'warm rim light from the right and cool rim light from the left. ' +
  'The eyes must be clearly visible and glowing. Transparent background, nothing behind the character, no text, no frame.';

export const VARIANTES = {
  cerrados: 'the eyes are closed: just two thin dim lines, as if blinking or asleep.',
  contento: 'the eyes are happy, curved upward like smiling crescents (^ ^), a bit brighter.',
} as const;

const carpeta = (dir: string) => join(dir, 'imagenes', 'avatar');

/** Crea un personaje nuevo (tres imágenes). Devuelve su carpeta ('imagenes/avatar/…'). */
export async function generar(descripcion: string, dir = DIR_BIBLIOTECA): Promise<string> {
  const que = descripcion.trim().slice(0, 600) || DESCRIPCION;
  const base = await imagen.generar({ prompt: `${ESTILO}\nCharacter (described in Spanish): ${que}`, tamano: '1024x1024', transparente: true });
  const [cerrados, contento] = await Promise.all(
    (Object.values(VARIANTES) as string[]).map((cambio) => imagen.editar({
      base,
      prompt: `Keep this exact same character, pose, framing, colors, lighting and transparent background. Change only this: ${cambio}`,
      tamano: '1024x1024',
      transparente: true,
    })),
  );
  const nombre = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const destino = join(carpeta(dir), nombre);
  await mkdir(destino, { recursive: true });
  await writeFile(join(destino, 'base.png'), base);
  await writeFile(join(destino, 'cerrados.png'), cerrados!);
  await writeFile(join(destino, 'contento.png'), contento!);
  log.info(`Avatar generado con IA: ${nombre}`);
  return `imagenes/avatar/${nombre}`;
}

/** Los personajes que hay, los más nuevos primero. */
export async function lista(dir = DIR_BIBLIOTECA): Promise<Array<{ ruta: string; at: string }>> {
  let nombres: string[];
  try {
    nombres = await readdir(carpeta(dir));
  } catch {
    return [];
  }
  const filas = await Promise.all(nombres.map(async (n) => {
    try {
      const s = await stat(join(carpeta(dir), n, 'base.png'));
      return { ruta: `imagenes/avatar/${n}`, at: s.mtime.toISOString() };
    } catch {
      return null;
    }
  }));
  return filas.filter((f): f is { ruta: string; at: string } => f !== null).sort((a, b) => b.at.localeCompare(a.at));
}

export const rutaValida = (r: unknown): r is string =>
  typeof r === 'string' && /^imagenes\/avatar\/[\w.-]+$/.test(r) && !r.includes('..');
