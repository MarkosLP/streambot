import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DIR_BIBLIOTECA } from './biblioteca.js';
import * as imagen from '../services/ia-imagen.js';
import { log } from '../core/logger.js';
import { INFO, POR_DEFECTO, deNombre, info, type Estilo } from './estilos.js';
import * as rotulos from './rotulos.js';
import { mascara, type Zona } from '../services/png.js';
import type { Cara } from '../services/ia-imagen.js';

/**
 * El personaje del avatar, generado con IA (27 sep 2026).
 *
 * Tres imágenes del MISMO personaje, con fondo transparente: la base, con los
 * ojos cerrados (para parpadear y dormir) y contento (para el botín). Las dos
 * últimas salen editando la base CON MÁSCARA: un modelo que ve dice dónde
 * están ojos y boca, y la IA solo puede retocar esa zona. Sin máscara (27 sep)
 * redibujaba el personaje entero —la cabeza girada, la taza en otro sitio— y
 * al parpadear «cambiaba hasta el cuerpo». Las zonas se guardan en info.json
 * y avatar.html mezcla exactamente esas.
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
 * Las zonas a retocar a partir de dónde dice el modelo que están ojos y boca.
 * Con margen de sobra en vertical: el modelo acierta en horizontal pero puede
 * irse unos 40 px de 1024 arriba o abajo.
 */
export function zonasDe(c: Cara): { ojos: Zona; cara: Zona } {
  const xs = c.ojos.map((o) => o.x);
  const ys = c.ojos.map((o) => o.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
  const w = Math.min(.6, Math.max(...xs) - Math.min(...xs) + c.anchoOjo * 2.6);
  const ojos = { x: cx, y: cy, w, h: Math.max(.17, c.anchoOjo * 2.6) };
  const abajo = c.boca ? c.boca.y + .07 : cy + .16;
  const arriba = cy - .1;
  return { ojos, cara: { x: cx, y: (arriba + abajo) / 2, w: Math.min(.7, w + .06), h: Math.max(.2, abajo - arriba) } };
}

/**
 * Los ojos cerrados y la sonrisa de un personaje, retocando solo su cara si se
 * sabe dónde está. Devuelve las dos imágenes y las zonas (o null si no se supo).
 */
async function variantes(base: Buffer, a: { cerrados: string; contento: string }) {
  const cara = await imagen.localizarCara(base);
  const zonas = cara ? zonasDe(cara) : null;
  const edicion = (cambio: string, zona: Zona | undefined) => imagen.editar({
    base,
    prompt: `Keep this exact same character, pose, framing, colors, lighting and transparent background. Change only this: ${cambio}`,
    tamano: '1024x1024',
    transparente: true,
    mascara: zona ? mascara(1024, 1024, [zona]) : undefined,
  });
  const [cerrados, contento] = await Promise.all([edicion(a.cerrados, zonas?.ojos), edicion(a.contento, zonas?.cara)]);
  return { cerrados, contento, zonas };
}

/**
 * Crea un personaje nuevo (tres imágenes) con su nombre (el que pongas, o uno
 * sacado de la descripción). Devuelve su carpeta ('imagenes/avatar/…').
 */
export async function generar(descripcion: string, estilo: Estilo = POR_DEFECTO, dir = DIR_BIBLIOTECA, titulo = ''): Promise<string> {
  const a = info(estilo).avatar;
  const que = descripcion.trim().slice(0, 600) || a.descripcion;
  // Lo que pides, primero y concretado (como en fondos.ts): si no, el estilo pesa más.
  const detalle = await imagen.detallar(descripcion.trim().slice(0, 600), 'personaje');
  const personaje = detalle ? `CHARACTER (follow it exactly): ${detalle}\n(Original request in Spanish: ${que})` : `CHARACTER (described in Spanish, follow it exactly): ${que}`;
  const base = await imagen.generar({ prompt: `${personaje}\n${ENCUADRE}\nArt style: ${a.estilo}`, tamano: '1024x1024', transparente: true });
  const { cerrados, contento, zonas } = await variantes(base, a);
  const nombre = `${estilo}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  const destino = join(carpeta(dir), nombre);
  await mkdir(destino, { recursive: true });
  await writeFile(join(destino, 'base.png'), base);
  await writeFile(join(destino, 'cerrados.png'), cerrados!);
  await writeFile(join(destino, 'contento.png'), contento!);
  const ruta = `imagenes/avatar/${nombre}`;
  await rotulos.escribir(ruta, { titulo: rotulos.limpiarTitulo(titulo) || rotulos.tituloDe(que), descripcion: que, ...(zonas ?? {}) }, dir);
  log.info(`Avatar generado con IA: ${nombre}${zonas ? '' : ' (sin localizar la cara: variantes sin máscara)'}`);
  return ruta;
}

/**
 * Rehace los ojos cerrados y la sonrisa de un personaje que ya existe (2
 * imágenes), retocando solo su cara. Para los hechos antes de las máscaras.
 * La base no se toca.
 */
export async function rehacerVariantes(ruta: string, dir = DIR_BIBLIOTECA): Promise<{ zonas: boolean }> {
  if (!rutaValida(ruta)) throw new Error('personaje no válido');
  const destino = join(dir, ruta);
  const base = await readFile(join(destino, 'base.png'));
  const estilo = deNombre(ruta.split('/').at(-1) ?? '');
  const { cerrados, contento, zonas } = await variantes(base, info(estilo).avatar);
  await writeFile(join(destino, 'cerrados.png'), cerrados);
  await writeFile(join(destino, 'contento.png'), contento);
  const antes = await rotulos.leer(ruta, dir);
  await rotulos.escribir(ruta, { titulo: antes?.titulo ?? (ruta === ERRANTE ? 'El errante' : 'Personaje'), descripcion: antes?.descripcion, ...(zonas ?? {}) }, dir);
  log.info(`Avatar: ojos y sonrisa rehechos en ${ruta}${zonas ? ' (solo la cara)' : ' (sin localizar la cara)'}`);
  return { zonas: zonas !== null };
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

/** Borra un personaje (su carpeta entera). El errante no: es el de reserva de todos los estilos. */
export async function borrar(ruta: string, dir = DIR_BIBLIOTECA): Promise<void> {
  if (!rutaValida(ruta)) throw new Error('personaje no válido');
  if (ruta === ERRANTE) throw new Error('El errante no se borra: es el que sale cuando un estilo no tiene personaje');
  await rm(join(dir, ruta), { recursive: true });
  log.info(`Personaje borrado: ${ruta}`);
}
