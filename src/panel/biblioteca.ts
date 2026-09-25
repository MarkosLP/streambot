import { open, readdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EFECTOS } from './efectos.js';

/**
 * Biblioteca de contenido: sonidos, overlays e imágenes para los efectos.
 *
 * Vive en la carpeta `biblioteca/` del proyecto. Lo que metas ahí aparece en
 * el panel, con su ruta lista para pegar en Streamer.bot u OBS.
 *
 * El panel solo sirve archivos de esas tres carpetas, solo con extensiones
 * conocidas y solo por su nombre: nada de subcarpetas ni `..`.
 */

export const DIR_BIBLIOTECA = fileURLToPath(new URL('../../biblioteca/', import.meta.url));

const TIPOS = {
  sonidos: { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' },
  overlays: { '.html': 'text/html; charset=utf-8' },
  imagenes: { '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' },
} as const satisfies Record<string, Record<string, string>>;

export type Seccion = keyof typeof TIPOS;
export const SECCIONES = Object.keys(TIPOS) as Seccion[];

export interface Archivo {
  nombre: string;
  seccion: Seccion;
  ruta: string;
  url: string;
  bytes: number;
  /** Solo para WAV, que lo dice su cabecera. El resto lo averigua el navegador. */
  duracionSeg: number | null;
  /** Efectos del catálogo que lo usan. */
  usadoPor: string[];
}

const NOMBRE_VALIDO = /^[\w][\w .()-]*$/;

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

function usadoPor(seccion: Seccion, nombre: string): string[] {
  return EFECTOS.filter((e) => e.material.includes(`${seccion}/${nombre}`)).map((e) => e.recompensa);
}

export async function listar(dir = DIR_BIBLIOTECA): Promise<{ carpeta: string } & Record<Seccion, Archivo[]>> {
  const resultado = { carpeta: dir } as { carpeta: string } & Record<Seccion, Archivo[]>;
  for (const seccion of SECCIONES) {
    const tipos: Record<string, string> = TIPOS[seccion];
    let nombres: string[] = [];
    try {
      nombres = await readdir(join(dir, seccion));
    } catch {
      // Carpeta que no existe: sección vacía.
    }
    const archivos: Archivo[] = [];
    for (const nombre of nombres.sort((a, b) => a.localeCompare(b, 'es'))) {
      if (!NOMBRE_VALIDO.test(nombre) || !tipos[extname(nombre).toLowerCase()]) continue;
      const ruta = join(dir, seccion, nombre);
      const info = await stat(ruta).catch(() => null);
      if (!info?.isFile()) continue;
      archivos.push({
        nombre,
        seccion,
        ruta,
        url: `/biblioteca/${seccion}/${encodeURIComponent(nombre)}`,
        bytes: info.size,
        duracionSeg: extname(nombre).toLowerCase() === '.wav' ? await duracionWav(ruta) : null,
        usadoPor: usadoPor(seccion, nombre),
      });
    }
    resultado[seccion] = archivos;
  }
  return resultado;
}

/**
 * Traduce `/biblioteca/<seccion>/<nombre>` a un archivo de disco, o null.
 * Cualquier cosa rara (subcarpetas, `..`, extensiones que no toca) es null.
 */
export function resolver(pathname: string, dir = DIR_BIBLIOTECA): { ruta: string; tipo: string } | null {
  const m = /^\/biblioteca\/(\w+)\/([^/]+)$/.exec(pathname);
  if (!m) return null;
  const seccion = m[1] as Seccion;
  if (!SECCIONES.includes(seccion)) return null;
  let nombre: string;
  try {
    nombre = decodeURIComponent(m[2]);
  } catch {
    return null;
  }
  if (!NOMBRE_VALIDO.test(nombre) || nombre.includes('..')) return null;
  const tipo = (TIPOS[seccion] as Record<string, string>)[extname(nombre).toLowerCase()];
  if (!tipo) return null;
  return { ruta: join(dir, seccion, nombre), tipo };
}

/** Abre la carpeta en el Explorador (o lo que toque en cada sistema). */
export function abrirCarpeta(seccion?: Seccion, dir = DIR_BIBLIOTECA): void {
  const destino = seccion && SECCIONES.includes(seccion) ? join(dir, seccion) : dir;
  const programa = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(programa, [destino], { detached: true, stdio: 'ignore' }).unref();
}
