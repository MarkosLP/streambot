import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const dir = fileURLToPath(new URL('../biblioteca/overlays/empezando-pronto/', import.meta.url));
const salida = fileURLToPath(new URL('../biblioteca/overlays/empezando-pronto.html', import.meta.url));
const tipos = { '.png': 'image/png', '.webp': 'image/webp', '.ttf': 'font/ttf' };
const data = async (nombre) => {
  const ext = nombre.slice(nombre.lastIndexOf('.'));
  if (!tipos[ext]) throw new Error(`Recurso no permitido: ${nombre}`);
  return `data:${tipos[ext]};base64,${(await readFile(join(dir, nombre))).toString('base64')}`;
};

let html = await readFile(join(dir, 'origen.html'), 'utf8');
let css = await readFile(join(dir, 'escena.css'), 'utf8');
for (const nombre of ['habitacion-v9.webp', 'Orbitron-700.ttf', 'Orbitron-900.ttf', 'Rajdhani-600.ttf', 'Rajdhani-700.ttf']) {
  css = css.replaceAll(`url('${nombre}')`, `url('${await data(nombre)}')`);
}
html = html.replace('<link rel="stylesheet" href="empezando-pronto/escena.css">', `<style>${css}</style>`);
html = html.replace('<link rel="stylesheet" href="empezando-pronto/efectos-nuevos.css">', `<style>${await readFile(join(dir, 'efectos-nuevos.css'), 'utf8')}</style>`);
for (const nombre of ['habitacion-v9.webp', 'sonic-estela.png', 'sonic-bola.png', 'goku-carga-frente.png', 'goku-kamehameha.png']) {
  html = html.replaceAll(`src="empezando-pronto/${nombre}"`, `src="${await data(nombre)}"`);
}
html = html.replace('<script src="empezando-pronto/escena.js"></script>', `<script>${await readFile(join(dir, 'escena.js'), 'utf8')}</script>`);
await writeFile(salida, html);
console.log(`Escena autónoma: ${salida}`);
