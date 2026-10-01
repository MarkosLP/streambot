import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as novedades from './novedades.js';

test('el rotativo solo recibe eventos recientes y no repite identificadores', () => {
  novedades.reset();
  novedades.anotar('botin', 'Cofre', 'Ana', '+8 puntos', 100_000);
  const primera = novedades.recientes(101_000);
  assert.equal(primera.length, 1);
  assert.equal(novedades.recientes(130_000).length, 0);
  novedades.anotar('raid', 'Raid entrante', 'Canal', '3 personas', 140_000);
  assert.ok(novedades.recientes(141_000)[0]!.n > primera[0]!.n);
  novedades.reset();
});
