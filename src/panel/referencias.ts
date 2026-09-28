import { mkdir, readdir, readFile, writeFile, realpath, stat } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { DIR_BIBLIOTECA } from './biblioteca.js';
import * as imagen from '../services/ia-imagen.js';

export const MAX_BYTES = 4 * 1024 * 1024;
export const USOS = ['estilo', 'lugar', 'personaje'] as const;
export type Seleccion = { ruta: string; uso: typeof USOS[number] };
type Referencia = { ruta: string; nombre: string; juego: string };
const patron = /^imagenes\/referencias\/[a-z0-9-]{1,60}\/[a-f0-9-]{36}\.png$/;
const texto = (v: unknown) => typeof v === 'string' ? v.trim().slice(0, 80) : '';
export class ErrorReferencia extends Error {}

// Solo archivos de esta biblioteca, también frente a enlaces de Windows.
async function dentro(ruta: string, dir: string): Promise<string> {
  const base = await realpath(dir), destino = await realpath(join(dir, ruta));
  const rel = relative(base, destino);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new ErrorReferencia('Referencia fuera de la biblioteca');
  return destino;
}

function validarPng(b: Buffer): void {
  if (b.length > MAX_BYTES || b.length < 45 || !b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) || b.toString('ascii', 12, 16) !== 'IHDR') throw new ErrorReferencia('Referencia PNG no válida (máximo 4 MB)');
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20), tipo = b[25];
  if (!w || !h || w > 2048 || h > 2048 || b[24] !== 8 || ![2, 6].includes(tipo!) || b[28] !== 0) throw new ErrorReferencia('Referencia no compatible: súbela desde el panel (máximo 2048 px)');
  const partes: Buffer[] = []; let fin = false;
  for (let p = 8; p + 12 <= b.length;) {
    const n = b.readUInt32BE(p), tipo = b.toString('ascii', p + 4, p + 8);
    if (p + 12 + n > b.length) throw new ErrorReferencia('PNG incompleto');
    if (tipo === 'IDAT') partes.push(b.subarray(p + 8, p + 8 + n));
    if (tipo === 'IEND') { fin = true; break; }
    p += 12 + n;
  }
  const esperado = (w * (tipo === 6 ? 4 : 3) + 1) * h;
  try {
    if (!fin || inflateSync(Buffer.concat(partes), { maxOutputLength: esperado }).length !== esperado) throw new Error();
  } catch { throw new ErrorReferencia('Los datos del PNG no son válidos'); }
}

export async function subir(datos: Record<string, unknown>, dir = DIR_BIBLIOTECA): Promise<Referencia> {
  const nombre = texto(datos.nombre), juego = texto(datos.juego);
  if (!nombre || !juego) throw new ErrorReferencia('Indica el nombre y el juego de la referencia');
  if (typeof datos.png !== 'string' || datos.png.length > Math.ceil(MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(datos.png)) throw new ErrorReferencia('Imagen no válida o demasiado grande');
  const b = Buffer.from(datos.png, 'base64'); validarPng(b);
  const grupo = 'j-' + juego.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 55);
  const carpeta = join(dir, 'imagenes', 'referencias', grupo);
  await mkdir(carpeta, { recursive: true });
  await dentro(`imagenes/referencias/${grupo}`, dir);
  const ruta = `imagenes/referencias/${grupo}/${randomUUID()}.png`;
  const ref = { ruta, nombre, juego };
  await writeFile(join(dir, ruta), b, { flag: 'wx' });
  await writeFile(join(dir, ruta + '.json'), JSON.stringify(ref), { flag: 'wx' });
  return ref;
}

export async function listar(dir = DIR_BIBLIOTECA): Promise<Referencia[]> {
  const raiz = join(dir, 'imagenes', 'referencias');
  const grupos = await readdir(raiz, { withFileTypes: true }).catch(() => []);
  const refs: Referencia[] = [];
  for (const g of grupos) if (g.isDirectory() && /^[a-z0-9-]{1,60}$/.test(g.name)) {
    for (const f of await readdir(join(raiz, g.name))) {
      const ruta = `imagenes/referencias/${g.name}/${f}`;
      if (!patron.test(ruta)) continue;
      try {
        const meta = await dentro(ruta + '.json', dir);
        const d = JSON.parse(await readFile(meta, 'utf8'));
        await dentro(ruta, dir);
        refs.push({ ruta, nombre: texto(d.nombre), juego: texto(d.juego) });
      } catch { /* Ignorar archivos incompletos. */ }
    }
  }
  return refs.sort((a, b) => a.juego.localeCompare(b.juego) || a.nombre.localeCompare(b.nombre));
}

export function seleccion(valor: unknown): Seleccion[] {
  if (valor === undefined) return [];
  if (!Array.isArray(valor) || valor.length > 3) throw new ErrorReferencia('Elige como máximo tres referencias');
  const vistas = new Set<string>();
  return valor.map(v => {
    if (!v || typeof v.ruta !== 'string' || !patron.test(v.ruta) || !USOS.includes(v.uso) || vistas.has(v.ruta)) throw new ErrorReferencia('Referencia o propósito no válido');
    vistas.add(v.ruta);
    return { ruta: v.ruta, uso: v.uso };
  });
}

export async function leer(ruta: string, dir = DIR_BIBLIOTECA): Promise<Buffer> {
  seleccion([{ ruta, uso: 'estilo' }]);
  try {
    const archivo = await dentro(ruta, dir);
    if ((await stat(archivo)).size > MAX_BYTES) throw new Error();
    const b = await readFile(archivo);
    validarPng(b);
    return b;
  } catch { throw new ErrorReferencia('No se puede leer la referencia seleccionada; vuelve a elegirla'); }
}

export async function generar(p: imagen.PeticionImagen, refs: Seleccion[] = [], dir = DIR_BIBLIOTECA): Promise<Buffer> {
  const elegidas = seleccion(refs);
  if (!elegidas.length) return imagen.generar(p);
  const entradas: Buffer[] = [];
  for (const r of elegidas) {
    entradas.push(await leer(r.ruta, dir));
  }
  const instrucciones = { estilo: 'Use only rendering style, palette and materials; do not copy subject identity or scenery.', lugar: 'Preserve the visible architecture, landmarks and spatial relationships of this location.', personaje: 'Preserve this character identity and visible features, except changes explicitly requested in the text.' };
  const prompt = p.prompt + '\nVISUAL REFERENCES (in attachment order):\n' + elegidas.map((r, i) => `Image ${i + 1}: ${instrucciones[r.uso]}`).join('\n') + '\nFor each assigned purpose, visual references take priority over generic default art direction or lore. Use visible evidence rather than guessed franchise details. Ignore screenshot UI, captions and watermarks. Do not make a collage. The written request controls deliberate changes.';
  return imagen.editar({ ...p, prompt, base: entradas[0]!, referencias: entradas.slice(1) });
}
