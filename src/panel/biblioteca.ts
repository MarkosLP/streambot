import { open, readdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EFECTOS } from './efectos.js';
import * as rotulos from './rotulos.js';

/**
 * Biblioteca de contenido: sonidos, overlays e imágenes para los efectos.
 *
 * Vive en la carpeta `biblioteca/` del proyecto. Lo que metas ahí aparece en
 * el panel, con su ruta lista para pegar en Streamer.bot u OBS.
 *
 * El panel solo sirve archivos de esas carpetas, solo con extensiones
 * conocidas y solo por su nombre: nada de `..`. Subcarpetas, solo en
 * imágenes (`imagenes/twitch/paneles/`) y como mucho tres niveles: los
 * sonidos y los overlays se enlazan entre sí con rutas relativas
 * (`../sonidos/x.wav`) que una subcarpeta rompería. La música va en
 * `musica/<lista>/<canción>` (core/musica.ts), con nombres de canción tal cual
 * vienen (tildes, comas, &…): ahí solo se prohíben barras, `..` y los
 * caracteres que Windows no admite.
 */

export const DIR_BIBLIOTECA = fileURLToPath(new URL('../../biblioteca/', import.meta.url));

const TIPOS = {
  sonidos: { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' },
  overlays: { '.html': 'text/html; charset=utf-8' },
  imagenes: { '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' },
  musica: {
    '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav',
    '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.webm': 'audio/webm',
  },
} as const satisfies Record<string, Record<string, string>>;

export type Seccion = keyof typeof TIPOS;
export const SECCIONES = Object.keys(TIPOS) as Seccion[];

/** Niveles de subcarpeta que se admiten en imágenes. */
const PROFUNDIDAD = 3;

export interface Archivo {
  nombre: string;
  seccion: Seccion;
  /** Subcarpeta dentro de la sección, con `/`: '' en la raíz, 'twitch/paneles'... */
  carpeta: string;
  ruta: string;
  url: string;
  bytes: number;
  /** Solo para WAV, que lo dice su cabecera. El resto lo averigua el navegador. */
  duracionSeg: number | null;
  /** Efectos del catálogo que lo usan. */
  usadoPor: string[];
  /** Fondos y personajes generados con IA: su título (rotulos.ts), o null. */
  titulo: string | null;
}

const NOMBRE_VALIDO = /^[\w][\w .()-]*$/;
/** Canciones: como vengan, salvo lo que Windows no admite y lo que podría salirse de la carpeta. */
export const NOMBRE_CANCION = /^[^\\/:*?"<>|\u0000-\u001f.][^\\/:*?"<>|\u0000-\u001f]*$/;

/** Duración de un WAV: bytes del bloque `data` entre bytes por segundo. */
async function duracionWav(ruta: string): Promise<number | null> {
  let fd;
  try {
    fd = await open(ruta, 'r');
    const cab = Buffer.alloc(4096);
    const { bytesRead } = await fd.read(cab, 0, cab.length, 0);
    if (bytesRead < 44 || cab.toString('ascii', 0, 4) !== 'RIFF' || cab.toString('ascii', 8, 12) !== 'WAVE') return null;
    let byteRate = 0;
    // Los bloques van uno tras otro: fmt trae el ritmo, data el tamaño.
    for (let p = 12; p + 8 <= bytesRead; ) {
      const id = cab.toString('ascii', p, p + 4);
      const tam = cab.readUInt32LE(p + 4);
      if (id === 'fmt ' && p + 20 <= bytesRead) byteRate = cab.readUInt32LE(p + 16);
      if (id === 'data') return byteRate ? tam / byteRate : null;
      p += 8 + tam + (tam % 2);
    }
    return null;
  } catch {
    return null;
  } finally {
    await fd?.close();
  }
}

const VARIANTES_AVATAR: Record<string, string> = { 'base.png': '', 'medio.png': ' · ojos entornados', 'cerrados.png': ' · ojos cerrados', 'contento.png': ' · contento' };

/** El título de un fondo o de una imagen de personaje: el del .json de al lado (rotulos.ts). */
async function tituloImagen(sub: string[], nombre: string, dir: string): Promise<string | null> {
  if (sub.length === 1 && sub[0] === 'fondos') return (await rotulos.leer(`imagenes/fondos/${nombre}`, dir))?.titulo ?? null;
  if (sub.length === 2 && sub[0] === 'avatar' && nombre in VARIANTES_AVATAR) {
    const t = (await rotulos.leer(`imagenes/avatar/${sub[1]}`, dir))?.titulo ?? (sub[1] === 'errante' ? 'El errante' : null);
    return t ? t + VARIANTES_AVATAR[nombre] : null;
  }
  return null;
}

function usadoPor(seccion: Seccion, nombre: string): string[] {
  return EFECTOS.filter((e) => e.material.includes(`${seccion}/${nombre}`)).map((e) => e.recompensa);
}

export async function listar(dir = DIR_BIBLIOTECA): Promise<{ carpeta: string } & Record<Seccion, Archivo[]>> {
  const resultado = { carpeta: dir } as { carpeta: string } & Record<Seccion, Archivo[]>;
  for (const seccion of SECCIONES) {
    const archivos: Archivo[] = [];
    await recorrer(dir, seccion, [], archivos);
    resultado[seccion] = archivos;
  }
  return resultado;
}

/** Los archivos de una carpeta de la sección, y los de sus subcarpetas si es de imágenes. */
async function recorrer(dir: string, seccion: Seccion, sub: string[], archivos: Archivo[]): Promise<void> {
  const tipos: Record<string, string> = TIPOS[seccion];
  let nombres: string[] = [];
  try {
    nombres = await readdir(join(dir, seccion, ...sub));
  } catch {
    // Carpeta que no existe: sección vacía.
  }
  const subcarpetas: string[] = [];
  for (const nombre of nombres.sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))) {
    if (!NOMBRE_VALIDO.test(nombre)) continue;
    const ruta = join(dir, seccion, ...sub, nombre);
    const info = await stat(ruta).catch(() => null);
    if (info?.isDirectory()) {
      if (seccion === 'imagenes' && sub.length < PROFUNDIDAD) subcarpetas.push(nombre);
      continue;
    }
    if (!info?.isFile() || !tipos[extname(nombre).toLowerCase()]) continue;
    archivos.push({
      nombre,
      seccion,
      carpeta: sub.join('/'),
      ruta,
      url: `/biblioteca/${seccion}/${[...sub, nombre].map(encodeURIComponent).join('/')}`,
      bytes: info.size,
      duracionSeg: extname(nombre).toLowerCase() === '.wav' ? await duracionWav(ruta) : null,
      usadoPor: sub.length ? [] : usadoPor(seccion, nombre),
      titulo: seccion === 'imagenes' ? await tituloImagen(sub, nombre, dir) : null,
    });
  }
  // Primero lo de esta carpeta, después cada subcarpeta.
  for (const c of subcarpetas) await recorrer(dir, seccion, [...sub, c], archivos);
}

/**
 * Traduce `/biblioteca/<seccion>/<nombre>` a un archivo de disco, o null.
 * Cualquier cosa rara (subcarpetas, `..`, extensiones que no toca) es null.
 */
export function resolver(pathname: string, dir = DIR_BIBLIOTECA): { ruta: string; tipo: string } | null {
  const m = /^\/biblioteca\/(\w+)\/(.+)$/.exec(pathname);
  if (!m) return null;
  const seccion = m[1] as Seccion;
  if (!SECCIONES.includes(seccion)) return null;
  // Cada trozo se decodifica y se comprueba POR SEPARADO: un %2F dentro de un
  // nombre no puede colar una barra, ni un %2E%2E un "..".
  const trozos = m[2].split('/');
  if (seccion === 'musica' ? trozos.length !== 2 : trozos.length > 1 && (seccion !== 'imagenes' || trozos.length > PROFUNDIDAD + 1)) return null;
  const partes: string[] = [];
  for (const t of trozos) {
    let parte: string;
    try {
      parte = decodeURIComponent(t);
    } catch {
      return null;
    }
    if (!(seccion === 'musica' ? NOMBRE_CANCION : NOMBRE_VALIDO).test(parte) || parte.includes('..')) return null;
    partes.push(parte);
  }
  const tipo = (TIPOS[seccion] as Record<string, string>)[extname(partes.at(-1)!).toLowerCase()];
  if (!tipo) return null;
  return { ruta: join(dir, seccion, ...partes), tipo };
}

/** Abre la carpeta en el Explorador (o lo que toque en cada sistema). */
export function abrirCarpeta(seccion?: Seccion, dir = DIR_BIBLIOTECA): void {
  const destino = seccion && SECCIONES.includes(seccion) ? join(dir, seccion) : dir;
  const programa = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(programa, [destino], { detached: true, stdio: 'ignore' }).unref();
}
