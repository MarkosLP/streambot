import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DIR_BIBLIOTECA } from './biblioteca.js';
import * as imagen from '../services/ia-imagen.js';
import { log } from '../core/logger.js';
import { INFO, POR_DEFECTO, deNombre, info, type Estilo } from './estilos.js';
import * as rotulos from './rotulos.js';
import { comparar, mascara, type Zona } from '../services/png.js';
import type { Cara } from '../services/ia-imagen.js';

/**
 * El personaje del avatar, generado con IA (27 sep 2026).
 *
 * Cuatro imágenes del MISMO personaje, con fondo transparente: la base, con
 * los ojos entornados y cerrados (el parpadeo en tres pasos; cerrados también
 * para dormir) y contento (para el botín). Las tres últimas salen editando la base CON MÁSCARA: un modelo que ve dice dónde
 * están ojos y boca, y la IA solo puede retocar esa zona. Sin máscara (27 sep)
 * redibujaba el personaje entero —la cabeza girada, la taza en otro sitio— y
 * al parpadear «cambiaba hasta el cuerpo». Las zonas se guardan en info.json
 * y avatar.html mezcla exactamente esas.
 *
 * Se guardan en biblioteca/imagenes/avatar/<estilo>-<fecha>/{base,medio,cerrados,contento}.png
 * (medio.png no está en los de antes del 27 sep por la tarde: parpadean en un paso)
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
export function zonasDe(c: Cara): { ojos: Zona; cara: Zona; sueltos: Zona[] } {
  const xs = c.ojos.map((o) => o.x);
  const ys = c.ojos.map((o) => o.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
  const w = Math.min(.6, Math.max(...xs) - Math.min(...xs) + c.anchoOjo * 2.6);
  const ojos = { x: cx, y: cy, w, h: Math.max(.17, c.anchoOjo * 2.6) };
  const abajo = c.boca ? c.boca.y + .07 : cy + .16;
  const arriba = cy - .1;
  // Un óvalo por ojo, con margen vertical por lo que falla el modelo: al
  // entornar y cerrar, la IA no tiene dónde tocar la frente ni la nariz.
  const sueltos = c.ojos.map((o) => ({ x: o.x, y: o.y, w: Math.max(.07, c.anchoOjo * 2.2), h: c.anchoOjo * 1.5 + .08 }));
  return { ojos, cara: { x: cx, y: (arriba + abajo) / 2, w: Math.min(.7, w + .06), h: Math.max(.2, abajo - arriba) }, sueltos };
}

/**
 * Lo que se pide para cada variante, igual para cualquier personaje. Hasta el
 * 27 sep cada estilo tenía las suyas, y las del oscuro eran las del errante
 * («ojos que brillan en una cara en sombra»): al Chico de pelo negro y a
 * Magmarex les tapó la cara de negro. Solo el errante usa las de su estilo.
 */
export const CAMBIOS = {
  medio: 'The eyes are HALF closed, as in the middle of a natural blink: the upper eyelids come halfway down over the eyes, drawn in the same style. Same eye shape and position.',
  cerrados: 'The eyes are fully closed, as in a natural blink: closed eyelids drawn in the same style, in the same place as the eyes. Same eye shape and position.',
  contento: 'The character looks happy: a warm smile and slightly squinted happy eyes, drawn in the same style.',
} as const;
const MISMA_CARA = 'Everything else in the face stays exactly the same: same skin, fur or scales, same colors and brightness, same features. Do not darken, shadow, cover, hide or replace the face.';

type Variante = keyof typeof CAMBIOS;

/**
 * Qué parte de la zona puede cambiar como mucho. Medido el 27 sep: cerrar los
 * ojos bien hecho cambia un 32-35 % de la franja de los ojos; cuando la IA
 * redibujó la cara (los leones, Magmarex), un 46-58 %.
 */
export const LIMITE_CAMBIO = .42;

type Zonas = ReturnType<typeof zonasDe>;

/** La variante fundida sobre la base y cuánto cambió; null si no se puede medir (sin zonas o PNG raro). */
function medir(base: Buffer, png: Buffer, v: Variante, zonas: Zonas | null): { png: Buffer; fraccion: number } | null {
  if (!zonas) return null;
  try {
    return comparar(base, png, [v === 'contento' ? zonas.cara : zonas.ojos]);
  } catch {
    return null;
  }
}

/**
 * Una variante nueva: la IA la pinta retocando solo su zona; se funde sobre la
 * base (solo lo que cambió de verdad, con el tono corregido); si cambió
 * demasiado o el modelo que ve dice que no vale, se repite una vez. Se queda
 * la mejor. `errante`: las instrucciones de su estilo, escritas para él.
 */
async function pintarVariante(base: Buffer, v: Variante, zonas: Zonas | null, errante: { cerrados: string; contento: string } | null) {
  // 27 sep 2026: sin zona comprobable no se edita ni se activa una cara desconocida.
  if (!zonas) return { png: base, fraccion: 0, ok: false };
  const pedido = errante && v !== 'medio' ? errante[v] : `${CAMBIOS[v]} ${MISMA_CARA}`;
  const zonasMascara = !zonas ? [] : v === 'contento' ? [zonas.cara] : zonas.sueltos;
  let mejor: { png: Buffer; fraccion: number; ok: boolean } | null = null;
  let motivo = '';
  for (let intento = 1; intento <= 2; intento++) {
    const png = await imagen.editar({
      base,
      prompt: `Keep this exact same character, pose, framing, colors, lighting and transparent background. Change only this: ${pedido}` +
        (motivo ? ` IMPORTANT: the previous attempt was wrong (${motivo}). Keep the face exactly as in the original.` : ''),
      tamano: '1024x1024',
      transparente: true,
      mascara: zonasMascara.length ? mascara(1024, 1024, zonasMascara) : undefined,
    });
    const m = medir(base, png, v, zonas);
    let ok = false;
    if (!m) return { png: base, fraccion: 0, ok: false };
    if (m && m.fraccion > LIMITE_CAMBIO) {
      ok = false;
      motivo = `the face was redrawn (${Math.round(m.fraccion * 100)} % of the area changed)`;
    } else {
      const vista = await imagen.comprobarVariante(base, m?.png ?? png, CAMBIOS[v]);
      if (!vista) return { png: base, fraccion: 0, ok: false };
      ok = vista.ok === true;
      if (!ok) motivo = vista.motivo;
    }
    const este = { png: m?.png ?? png, fraccion: m?.fraccion ?? 0, ok };
    if (!mejor || (ok && !mejor.ok) || (ok === mejor.ok && este.fraccion < mejor.fraccion)) mejor = este;
    if (ok) break;
    log.warn(`Avatar: la variante «${v}» no vale (${motivo})${intento === 1 ? '; se repite una vez' : ''}.`);
  }
  // Mejor que no parpadee a que se deforme (27 sep): sin una buena, la base.
  return mejor!.ok ? mejor! : { png: base, fraccion: 0, ok: false };
}

/**
 * Las tres variantes de un personaje nuevo. Si la sonrisa sale mal dos veces,
 * se usan los ojos cerrados: con el saltito de alegría también se lee.
 */
async function variantes(base: Buffer, errante: { cerrados: string; contento: string } | null = null) {
  const cara = await imagen.localizarCara(base);
  const zonas = cara ? zonasDe(cara) : null;
  const [medio, cerrados, contento] = await Promise.all((['medio', 'cerrados', 'contento'] as const).map((v) => pintarVariante(base, v, zonas, errante)));
  const dudosas = [medio!.ok ? null : 'medio', cerrados!.ok ? null : 'cerrados'].filter((x): x is string => x !== null);
  return { medio: medio!.png, cerrados: cerrados!.png, contento: contento!.ok ? contento!.png : cerrados!.png, zonas: zonas ? { ojos: zonas.ojos, cara: zonas.cara } : null, dudosas };
}

/**
 * Crea un personaje nuevo (tres imágenes) con su nombre (el que pongas, o uno
 * sacado de la descripción). Devuelve su carpeta ('imagenes/avatar/…').
 */
export async function generar(descripcion: string, estilo: Estilo = POR_DEFECTO, dir = DIR_BIBLIOTECA, titulo = ''): Promise<string> {
  const a = info(estilo).avatar;
  const que = descripcion.trim().slice(0, 600) || a.descripcion;
  // Lo que pides, primero y concretado (como en fondos.ts): si no, el estilo pesa más.
  // Una petición propia no se reescribe ni recibe la temática del estilo del panel.
  const personaje = `PRIMARY CHARACTER REQUEST (verbatim): ${que}`;
  const direccion = descripcion.trim()
    ? 'Follow the requested game or franchise visual identity, age, species, proportions, clothing and colors. The original request has priority. Do not replace a named game with generic fantasy, invent canonical details, or turn an adult into a child or chibi. If no style is specified, choose a coherent finish without adding a different theme.'
    : `Art style: ${a.estilo}`;
  const base = await imagen.generar({ prompt: `${personaje}\n${direccion}\n${ENCUADRE}`, tamano: '1024x1024', transparente: true });
  const { medio, cerrados, contento, zonas, dudosas } = await variantes(base);
  const nombre = `${estilo}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  const destino = join(carpeta(dir), nombre);
  await mkdir(destino, { recursive: true });
  await writeFile(join(destino, 'base.png'), base);
  await writeFile(join(destino, 'medio.png'), medio);
  await writeFile(join(destino, 'cerrados.png'), cerrados);
  await writeFile(join(destino, 'contento.png'), contento);
  const ruta = `imagenes/avatar/${nombre}`;
  if (dudosas.length) log.warn(`Avatar ${nombre}: ${dudosas.join(' y ')} siguen sin convencer; rehazlas con 👁.`);
  await rotulos.escribir(ruta, { titulo: rotulos.limpiarTitulo(titulo) || rotulos.tituloDe(que), descripcion: que, ...(zonas ?? {}) }, dir);
  log.info(`Avatar generado con IA: ${nombre}${zonas ? '' : ' (sin localizar la cara: variantes sin máscara)'}`);
  return ruta;
}

/**
 * Repasa las variantes de un personaje que ya existe (el botón 👁). Lo que se
 * puede salvar se arregla gratis: se funde sobre la base con el tono
 * corregido. Solo se vuelve a pintar lo que la IA redibujó (o lo que falta,
 * como medio.png en los de antes). La base no se toca.
 */
export async function rehacerVariantes(ruta: string, dir = DIR_BIBLIOTECA): Promise<{ zonas: boolean; dudosas: string[]; arregladas: string[]; rehechas: string[] }> {
  if (!rutaValida(ruta)) throw new Error('personaje no válido');
  const destino = join(dir, ruta);
  const base = await readFile(join(destino, 'base.png'));
  const antes = await rotulos.leer(ruta, dir);
  // Sin zonas guardadas (los de antes de las máscaras), se localiza la cara.
  let zonas: Zonas | null = null;
  const cara = await imagen.localizarCara(base);
  if (cara) zonas = zonasDe(cara);
  if (zonas && antes?.ojos && antes.cara) zonas = { ...zonas, ojos: antes.ojos, cara: antes.cara };
  const errante = ruta === ERRANTE ? info('oscuro').avatar : null;
  const arregladas: string[] = [], rehechas: string[] = [], dudosas: string[] = [];
  const hechas: Partial<Record<Variante, { png: Buffer; ok: boolean }>> = {};
  for (const v of ['medio', 'cerrados', 'contento'] as const) {
    const actual = await readFile(join(destino, `${v}.png`)).catch(() => null);
    const m = actual ? medir(base, actual, v, zonas) : null;
    if (actual && (actual.equals(base) || m?.fraccion === 0)) {
      hechas[v] = { png: base, ok: false };
      if (v !== 'contento') dudosas.push(v);
      continue;
    }
    if (actual && m && m.fraccion <= LIMITE_CAMBIO) {
      hechas[v] = { png: m.png, ok: true };
      arregladas.push(v);
      continue;
    }
    const nueva = await pintarVariante(base, v, zonas, errante);
    hechas[v] = nueva;
    rehechas.push(v);
    if (!nueva.ok && v !== 'contento') dudosas.push(v);
  }
  // La sonrisa que no sale bien ni a la segunda: los ojos cerrados.
  if (!hechas.contento!.ok) hechas.contento = hechas.cerrados!;
  for (const v of ['medio', 'cerrados', 'contento'] as const) await writeFile(join(destino, `${v}.png`), hechas[v]!.png);
  await rotulos.escribir(ruta, {
    titulo: antes?.titulo ?? (ruta === ERRANTE ? 'El errante' : 'Personaje'), descripcion: antes?.descripcion,
    ...(zonas ? { ojos: zonas.ojos, cara: zonas.cara } : {}),
  }, dir);
  log.info(`Avatar ${ruta}: ${arregladas.length ? `arregladas sin gastar: ${arregladas.join(', ')}` : ''}${arregladas.length && rehechas.length ? ' · ' : ''}${rehechas.length ? `pintadas de nuevo: ${rehechas.join(', ')}` : ''}`);
  return { zonas: zonas !== null, dudosas, arregladas, rehechas };
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

/** Cambia también al rehacer variantes dentro de la misma carpeta. */
export function version(ruta: string, dir = DIR_BIBLIOTECA): string {
  if (!rutaValida(ruta)) return '';
  return ['base.png', 'medio.png', 'cerrados.png', 'contento.png', 'info.json'].map((n) => {
    try { const s = statSync(join(dir, ruta, n)); return `${s.mtimeMs}-${s.size}`; } catch { return '0'; }
  }).join('_');
}
