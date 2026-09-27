import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { mascara } from './png.js';

/** La máscara que se manda a OpenAI: un PNG de verdad, transparente solo dentro de la zona. */
test('máscara: PNG RGBA, transparente dentro de la elipse y opaca fuera', () => {
  const png = mascara(20, 10, [{ x: .5, y: .5, w: .4, h: .6 }]);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), 20);
  assert.equal(png.readUInt32BE(20), 10);
  const idat = png.indexOf('IDAT');
  const filas = inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4)));
  const alfa = (x: number, y: number) => filas[y * (20 * 4 + 1) + 1 + x * 4 + 3];
  assert.equal(alfa(10, 5), 0, 'el centro se puede retocar');
  assert.equal(alfa(0, 0), 255, 'la esquina no');
  assert.equal(alfa(19, 9), 255);
});
