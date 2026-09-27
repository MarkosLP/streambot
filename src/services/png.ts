import { deflateSync } from 'node:zlib';

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
