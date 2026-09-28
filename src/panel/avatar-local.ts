import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../data/db.js';
import { codificar, decodificar } from '../services/png.js';
import { DIR_BIBLIOTECA } from './biblioteca.js';
import { rutaValida } from './avatar-ia.js';

type Punto = { x: number; y: number };
export type Calibracion = { puntos: Punto[]; altura: number };
type Guardada = Calibracion & { hash: string };
const bases = new Map<string, { sello: string; png: Buffer; hash: string }>();
const variantes = new Map<string, Buffer>();
const preparadas = new WeakSet<object>();
function tabla() {
  const db = getDb();
  if (!preparadas.has(db)) { db.exec('CREATE TABLE IF NOT EXISTS avatar_local (ruta TEXT PRIMARY KEY, valor TEXT NOT NULL)'); preparadas.add(db); }
  return db;
}
export function validar(v: unknown): Calibracion {
  const c = v as Calibracion;
  if (!c || !Array.isArray(c.puntos) || c.puntos.length !== 4 || !Number.isFinite(c.altura) || c.altura < .05 || c.altura > .5) throw Error('Marca las cuatro esquinas y una altura entre 0,05 y 0,5');
  const puntos = c.puntos.map(p => {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < .02 || p.x > .98 || p.y < .02 || p.y > .98) throw Error('Esquina fuera de la imagen');
    return { x: p.x, y: p.y };
  });
  for (const i of [0, 2]) {
    const a = puntos[i]!, b = puntos[i + 1]!;
    const largo = Math.hypot(b.x - a.x, b.y - a.y);
    if (b.x <= a.x || largo < .01 || largo > .2 || Math.abs(b.y - a.y) > b.x - a.x) throw Error('Marca cada ojo de izquierda a derecha; ancho máximo: 20 %');
  }
  if (puntos[1]!.x >= puntos[2]!.x) throw Error('Los ojos deben estar separados');
  return { puntos, altura: c.altura };
}
function base(ruta: string, dir: string) {
  if (!rutaValida(ruta)) throw Error('Personaje no válido');
  const archivo = join(dir, ruta, 'base.png'), st = statSync(archivo);
  const sello = `${st.mtimeMs}:${st.size}`, anterior = bases.get(archivo);
  if (anterior?.sello === sello) return anterior;
  if (st.size > 20 * 1024 * 1024) throw Error('Base demasiado grande');
  const png = readFileSync(archivo), hash = createHash('sha256').update(png).digest('hex');
  const nueva = { sello, png, hash };
  bases.set(archivo, nueva); if (bases.size > 8) bases.delete(bases.keys().next().value!);
  return nueva;
}
/** Deforma solo la almendra de cada ojo. El párpado usa la piel/escama inmediatamente inferior de la base. */
export function pintar(png: Buffer, datos: unknown, cierre: .5 | 1): Buffer {
  const c = validar(datos);
  if (cierre !== .5 && cierre !== 1) throw Error('Paso no válido');
  // Limitar antes de descomprimir evita asignaciones enormes de una imagen inválida.
  if (png.length < 24 || png.readUInt32BE(16) > 2048 || png.readUInt32BE(20) > 2048) throw Error('Base fuera del límite de 2048 píxeles');
  const { ancho: w, alto: h, rgba: src } = decodificar(png), out = new Uint8Array(src);
  for (const i of [0, 2]) {
    const a = c.puntos[i]!, b = c.puntos[i + 1]!;
    const ax = a.x * w, ay = a.y * h, dx = (b.x - a.x) * w, dy = (b.y - a.y) * h;
    const largo = Math.hypot(dx, dy), ux = dx / largo, uy = dy / largo, radio = largo * c.altura;
    const pixel = (u: number, v: number) => {
      const x = Math.round(ax + u * ux - v * uy), y = Math.round(ay + u * uy + v * ux);
      if (x < 0 || y < 0 || x >= w || y >= h) throw Error('El párpado sale de la imagen; reduce la altura');
      return (y * w + x) * 4;
    };
    const margen = Math.ceil(radio + 3);
    for (let y = Math.max(0, Math.floor(Math.min(ay, ay + dy)) - margen); y < Math.min(h, Math.ceil(Math.max(ay, ay + dy)) + margen); y++) {
      for (let x = Math.max(0, Math.floor(ax) - margen); x < Math.min(w, Math.ceil(ax + dx) + margen); x++) {
        const u = (x - ax) * ux + (y - ay) * uy, v = -(x - ax) * uy + (y - ay) * ux;
        if (u <= 0 || u >= largo) continue;
        const borde = radio * Math.sin(Math.PI * u / largo);
        if (Math.abs(v) >= borde) continue;
        const t = (v + borde) / (2 * borde), idx = (y * w + x) * 4;
        const restante = 1 - cierre;
        // Conserva el borde inferior y comprime la abertura: no dibuja colores nuevos.
        const desde = t < 1 - restante ? pixel(u, radio + 3) : pixel(u, -borde + (t - 1 + restante) / restante * 2 * borde);
        if (!src[desde + 3] || !src[idx + 3]) continue;
        const peso = Math.min(1, borde - Math.abs(v), u, largo - u);
        for (let k = 0; k < 3; k++) out[idx + k] = Math.round(src[idx + k]! * (1 - peso) + src[desde + k]! * peso);
      }
    }
  }
  return codificar(w, h, out);
}
export function leer(ruta: string, dir = DIR_BIBLIOTECA): Guardada | null {
  try {
    const fila = tabla().prepare('SELECT valor FROM avatar_local WHERE ruta = ?').get(ruta) as { valor: string } | undefined;
    if (!fila) return null;
    const c = JSON.parse(fila.valor) as Guardada;
    return c.hash === base(ruta, dir).hash ? { ...validar(c), hash: c.hash } : null;
  } catch { return null; } // Base ausente/cambiada o calibración inválida: nunca activar.
}
/** Una calibración caducada mantiene la base; no reactiva variantes antiguas. */
export function configuracion(ruta: string, dir = DIR_BIBLIOTECA): Guardada | { invalida: true } | null {
  const c = leer(ruta, dir);
  if (c) return c;
  try { return tabla().prepare('SELECT ruta FROM avatar_local WHERE ruta = ?').get(ruta) ? { invalida: true } : null; }
  catch { return null; }
}
export function vista(ruta: string, c: unknown, dir = DIR_BIBLIOTECA) {
  const b = base(ruta, dir);
  return { hash: b.hash, medio: `data:image/png;base64,${pintar(b.png, c, .5).toString('base64')}`, cerrados: `data:image/png;base64,${pintar(b.png, c, 1).toString('base64')}` };
}
export function guardar(ruta: string, c: unknown, hash: unknown, revisado: unknown, dir = DIR_BIBLIOTECA) {
  const datos = validar(c), b = base(ruta, dir);
  if (revisado !== true || hash !== b.hash) throw Error('Revisa los tres pasos de esta base antes de activar');
  pintar(b.png, datos, 1); // Comprueba límites de la zona y PNG antes de persistir.
  const guardada = { ...datos, hash: b.hash };
  tabla().prepare('INSERT INTO avatar_local (ruta, valor) VALUES (?, ?) ON CONFLICT(ruta) DO UPDATE SET valor = excluded.valor').run(ruta, JSON.stringify(guardada));
  return guardada;
}
export function desactivar(ruta: string) { tabla().prepare('DELETE FROM avatar_local WHERE ruta = ?').run(ruta); }
export function variante(ruta: string, paso: string, dir = DIR_BIBLIOTECA): Buffer {
  const b = base(ruta, dir), c = leer(ruta, dir);
  if (!c || !['medio', 'cerrados'].includes(paso)) return b.png;
  const clave = JSON.stringify([ruta, c, paso]);
  let png = variantes.get(clave);
  if (!png) { png = pintar(b.png, c, paso === 'medio' ? .5 : 1); variantes.set(clave, png); if (variantes.size > 8) variantes.delete(variantes.keys().next().value!); }
  return png;
}
