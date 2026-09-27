import { deflateSync, inflateSync } from 'node:zlib';

/**
 * PNG mínimo (RGBA de 8 bits), sin librerías: para las máscaras que se le
 * pasan a OpenAI al retocar solo una zona de una imagen (avatar-ia.ts).
 */

const TABLA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = TABLA[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloque(tipo: string, datos: Buffer): Buffer {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const td = Buffer.concat([Buffer.from(tipo, 'latin1'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([largo, td, crc]);
}

/** Codifica píxeles RGBA (ancho × alto × 4 bytes) como PNG. */
export function codificar(ancho: number, alto: number, rgba: Uint8Array): Buffer {
  const cab = Buffer.alloc(13);
  cab.writeUInt32BE(ancho, 0);
  cab.writeUInt32BE(alto, 4);
  cab[8] = 8; // bits por canal
  cab[9] = 6; // RGBA
  const filas = Buffer.alloc((ancho * 4 + 1) * alto);
  for (let y = 0; y < alto; y++) {
    filas[y * (ancho * 4 + 1)] = 0; // sin filtro
    Buffer.from(rgba.buffer, rgba.byteOffset + y * ancho * 4, ancho * 4).copy(filas, y * (ancho * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloque('IHDR', cab),
    bloque('IDAT', deflateSync(filas)),
    bloque('IEND', Buffer.alloc(0)),
  ]);
}

/** Una zona en coordenadas de 0 a 1: centro y tamaño. */
export interface Zona { x: number; y: number; w: number; h: number }

/**
 * La máscara de OpenAI para editar solo unas zonas: negra y opaca en todo,
 * transparente (se puede retocar) dentro de cada elipse.
 */
export function mascara(ancho: number, alto: number, zonas: Zona[]): Buffer {
  const px = new Uint8Array(ancho * alto * 4);
  for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) {
    const dentro = zonas.some((z) => ((x / ancho - z.x) / (z.w / 2)) ** 2 + ((y / alto - z.y) / (z.h / 2)) ** 2 <= 1);
    px[(y * ancho + x) * 4 + 3] = dentro ? 0 : 255;
  }
  return codificar(ancho, alto, px);
}

/** Lee un PNG de 8 bits (RGBA o RGB, sin entrelazar), como los que da OpenAI. */
export function decodificar(png: Buffer): { ancho: number; alto: number; rgba: Uint8Array } {
  let p = 8;
  let ancho = 0, alto = 0, tipo = 0;
  const idat: Buffer[] = [];
  while (p < png.length) {
    const largo = png.readUInt32BE(p);
    const nombre = png.toString('latin1', p + 4, p + 8);
    const datos = png.subarray(p + 8, p + 8 + largo);
    if (nombre === 'IHDR') {
      ancho = datos.readUInt32BE(0);
      alto = datos.readUInt32BE(4);
      tipo = datos[9]!;
      if (datos[8] !== 8 || (tipo !== 6 && tipo !== 2) || datos[12] !== 0) throw new Error('PNG no soportado (solo RGB/RGBA de 8 bits sin entrelazar)');
    } else if (nombre === 'IDAT') idat.push(datos);
    else if (nombre === 'IEND') break;
    p += 12 + largo;
  }
  const bpp = tipo === 6 ? 4 : 3;
  const fila = ancho * bpp;
  const crudo = inflateSync(Buffer.concat(idat));
  const px = new Uint8Array(fila * alto);
  for (let y = 0; y < alto; y++) {
    const f = crudo[y * (fila + 1)]!;
    const src = y * (fila + 1) + 1;
    const dst = y * fila;
    for (let i = 0; i < fila; i++) {
      const a = i >= bpp ? px[dst + i - bpp]! : 0;
      const b = y > 0 ? px[dst - fila + i]! : 0;
      const c = i >= bpp && y > 0 ? px[dst - fila + i - bpp]! : 0;
      let v = crudo[src + i]!;
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const q = a + b - c; const pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + i] = v & 255;
    }
  }
  if (bpp === 4) return { ancho, alto, rgba: px };
  const rgba = new Uint8Array(ancho * alto * 4);
  for (let i = 0, j = 0; i < px.length; i += 3, j += 4) { rgba[j] = px[i]!; rgba[j + 1] = px[i + 1]!; rgba[j + 2] = px[i + 2]!; rgba[j + 3] = 255; }
  return { ancho, alto, rgba };
}

/** Desenfoque de caja separable (radio r) sobre un mapa de 0 a 1. */
function desenfocar(m: Float32Array, ancho: number, alto: number, r: number): Float32Array {
  const tmp = new Float32Array(m.length);
  const out = new Float32Array(m.length);
  const n = 2 * r + 1;
  for (let y = 0; y < alto; y++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += m[y * ancho + Math.min(ancho - 1, Math.max(0, x))]!;
    for (let x = 0; x < ancho; x++) {
      tmp[y * ancho + x] = s / n;
      s += m[y * ancho + Math.min(ancho - 1, x + r + 1)]! - m[y * ancho + Math.max(0, x - r)]!;
    }
  }
  for (let x = 0; x < ancho; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(alto - 1, Math.max(0, y)) * ancho + x]!;
    for (let y = 0; y < alto; y++) {
      out[y * ancho + x] = s / n;
      s += tmp[Math.min(alto - 1, y + r + 1) * ancho + x]! - tmp[Math.max(0, y - r) * ancho + x]!;
    }
  }
  return out;
}

/**
 * La variante de un personaje, pero solo con lo que cambió DE VERDAD respecto a
 * la base (los párpados, la boca), y dentro de las zonas; lo demás, píxel a
 * píxel de la base. La IA repinta toda la zona que se le deja y cambia tonos
 * y detalles (27 sep: la piel del Chico más pálida, la estrella del león).
 * `umbral`: cuánto tiene que cambiar un píxel (0-255) para contar.
 */
export function fundir(base: Buffer, variante: Buffer, zonas: Zona[], opciones: { umbral?: number; crecer?: number; suavizar?: number } = {}): Buffer {
  return comparar(base, variante, zonas, opciones).png;
}

/**
 * Lo mismo que fundir, y además qué parte de las zonas cambió de verdad (de 0
 * a 1). Cerrar los ojos cambia poco (los párpados); si cambia mucho, la IA ha
 * redibujado la cara (27 sep: el león sin su estrella, Magmarex con otra cara).
 */
export function comparar(base: Buffer, variante: Buffer, zonas: Zona[], { umbral = 55, crecer = 10, suavizar = 7 } = {}): { png: Buffer; fraccion: number } {
  const b = decodificar(base);
  const v = decodificar(variante);
  if (b.ancho !== v.ancho || b.alto !== v.alto) return { png: variante, fraccion: 1 };
  const { ancho, alto } = b;
  const dentro = (x: number, y: number) => zonas.some((z) => ((x / ancho - z.x) / (z.w / 2)) ** 2 + ((y / alto - z.y) / (z.h / 2)) ** 2 <= 1);
  // Primero el tono: la IA aclara u oscurece toda la zona. Por canal, la recta
  // que mejor lleva la variante a la base con los píxeles que casi no cambian
  // (tres pasadas quitando los que más se alejan: los párpados, la boca).
  const idx: number[] = [];
  for (let y = 0; y < alto; y += 2) for (let x = 0; x < ancho; x += 2) if (dentro(x, y) && b.rgba[(y * ancho + x) * 4 + 3]! > 200) idx.push((y * ancho + x) * 4);
  const ajuste = [0, 1, 2].map((c) => {
    let usar = idx;
    let k = 1, m = 0;
    for (let pasada = 0; pasada < 3 && usar.length > 50; pasada++) {
      let sv = 0, sb = 0, svv = 0, svb = 0;
      for (const i of usar) { const vv = v.rgba[i + c]!, bb = b.rgba[i + c]!; sv += vv; sb += bb; svv += vv * vv; svb += vv * bb; }
      const n = usar.length;
      const varv = svv / n - (sv / n) ** 2;
      k = varv > 1 ? Math.min(2, Math.max(.5, (svb / n - (sv / n) * (sb / n)) / varv)) : 1;
      m = sb / n - k * (sv / n);
      const errores = usar.map((i) => Math.abs(k * v.rgba[i + c]! + m - b.rgba[i + c]!)).sort((p, q) => p - q);
      const corte = errores[Math.floor(errores.length * .75)]!;
      usar = usar.filter((i) => Math.abs(k * v.rgba[i + c]! + m - b.rgba[i + c]!) <= corte);
    }
    return { k, m };
  });
  for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) {
    if (!dentro(x, y)) continue;
    const i = (y * ancho + x) * 4;
    for (let c = 0; c < 3; c++) v.rgba[i + c] = Math.min(255, Math.max(0, Math.round(ajuste[c]!.k * v.rgba[i + c]! + ajuste[c]!.m)));
  }
  const cambio = new Float32Array(ancho * alto);
  let enZona = 0;
  for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) {
    if (!dentro(x, y)) continue;
    enZona++;
    const i = (y * ancho + x) * 4;
    const d = Math.max(Math.abs(b.rgba[i]! - v.rgba[i]!), Math.abs(b.rgba[i + 1]! - v.rgba[i + 1]!), Math.abs(b.rgba[i + 2]! - v.rgba[i + 2]!), Math.abs(b.rgba[i + 3]! - v.rgba[i + 3]!));
    cambio[y * ancho + x] = d > umbral ? 1 : 0;
  }
  // Fuera las motas sueltas; lo que queda se agranda un poco y se difumina el borde.
  const limpio = desenfocar(cambio, ancho, alto, 2).map((x) => (x > .45 ? 1 : 0));
  const fraccion = enZona ? limpio.reduce((a, x) => a + x, 0) / enZona : 0;
  const grande = desenfocar(limpio, ancho, alto, crecer).map((x) => (x > 0.02 ? 1 : 0));
  const peso = desenfocar(grande, ancho, alto, suavizar);
  const out = new Uint8Array(b.rgba.length);
  for (let i = 0; i < peso.length; i++) {
    const x = i % ancho, y = Math.floor(i / ancho);
    // 27 sep 2026: la dilatación no autoriza tocar el exterior de la máscara.
    const borde = Math.max(0, ...zonas.map((z) => {
      const radio = Math.sqrt(((x / ancho - z.x) / (z.w / 2)) ** 2 + ((y / alto - z.y) / (z.h / 2)) ** 2);
      return Math.min(1, Math.max(0, (1 - radio) * Math.min(z.w * ancho, z.h * alto) / 2 / Math.max(1, suavizar)));
    }));
    const w = peso[i]! * borde;
    const j = i * 4;
    if (!w) { out.set(b.rgba.subarray(j, j + 4), j); continue; }
    const ab = b.rgba[j + 3]! / 255, av = v.rgba[j + 3]! / 255;
    const alfa = ab * (1 - w) + av * w;
    for (let c = 0; c < 3; c++) out[j + c] = alfa ? Math.round((b.rgba[j + c]! * ab * (1 - w) + v.rgba[j + c]! * av * w) / alfa) : 0;
    out[j + 3] = Math.round(alfa * 255);
  }
  return { png: codificar(ancho, alto, out), fraccion };
}
