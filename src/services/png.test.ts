import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { mascara } from './png.js';
import * as png from './png.js';

/** La máscara que se manda a OpenAI: un PNG de verdad, transparente solo dentro de la zona. */
test('máscara: PNG RGBA, transparente dentro de la elipse y opaca fuera', () => {
  const m = mascara(20, 10, [{ x: .5, y: .5, w: .4, h: .6 }]);
  assert.deepEqual([...m.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(m.readUInt32BE(16), 20);
  assert.equal(m.readUInt32BE(20), 10);
  const idat = m.indexOf('IDAT');
  const filas = inflateSync(m.subarray(idat + 4, idat + 4 + m.readUInt32BE(idat - 4)));
  const alfa = (x: number, y: number) => filas[y * (20 * 4 + 1) + 1 + x * 4 + 3];
  assert.equal(alfa(10, 5), 0, 'el centro se puede retocar');
  assert.equal(alfa(0, 0), 255, 'la esquina no');
  assert.equal(alfa(19, 9), 255);
});

test('decodificar lee lo que codifica', () => {
    const px = new Uint8Array(3 * 2 * 4).map((_, i) => (i * 37) % 256);
    const d = png.decodificar(png.codificar(3, 2, px));
    assert.equal(d.ancho, 3);
    assert.deepEqual([...d.rgba], [...px]);
  });

test('comparar: fuera de lo que cambió de verdad, la base; y cuánto cambió', () => {
    // Base gris; la variante, algo más clara en toda la zona (el tono que cambia la IA)
    // y con una raya oscura en el centro (el párpado).
    const n = 64;
    const base = new Uint8Array(n * n * 4).fill(128);
    const vari = new Uint8Array(n * n * 4).fill(150);
    for (let i = 3; i < base.length; i += 4) { base[i] = 255; vari[i] = 255; }
    for (let x = 20; x < 44; x++) for (let y = 30; y < 34; y++) { const i = (y * n + x) * 4; vari[i] = vari[i + 1] = vari[i + 2] = 0; }
    const zona = { x: .5, y: .5, w: .9, h: .9 };
    const r = png.comparar(png.codificar(n, n, base), png.codificar(n, n, vari), [zona], { crecer: 2, suavizar: 1 });
    const out = png.decodificar(r.png).rgba;
    assert.equal(out[(10 * n + 32) * 4], 128, 'el tono aclarado no pasa: queda la base');
    assert.ok(out[(32 * n + 32) * 4]! < 40, 'el párpado sí');
    assert.ok(r.fraccion > 0 && r.fraccion < .2, `cambió poco (${r.fraccion})`);
  });

test('fundido: conserva exactamente todo el exterior incluso al dilatar cambios de alfa', () => {
  const ancho=64; const base=new Uint8Array(ancho*ancho*4).fill(160);
  for(let i=3;i<base.length;i+=4)base[i]=255;
  const variante=new Uint8Array(base);
  for(let y=20;y<45;y++)for(let x=20;x<45;x++)variante[(y*ancho+x)*4+3]=0;
  const z={x:.5,y:.5,w:.3,h:.3};
  const salida=png.decodificar(png.fundir(png.codificar(ancho,ancho,base),png.codificar(ancho,ancho,variante),[z])).rgba;
  let cambios=0;
  for(let y=0;y<ancho;y++)for(let x=0;x<ancho;x++) {
    const i=(y*ancho+x)*4;
    if(((x/ancho-z.x)/(z.w/2))**2+((y/ancho-z.y)/(z.h/2))**2>=1)assert.deepEqual(salida.slice(i,i+4),base.slice(i,i+4));
    else if(salida[i+3]!==base[i+3])cambios++;
  }
  assert.ok(cambios>0);
});
