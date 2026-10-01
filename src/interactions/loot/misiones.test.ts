import { before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { configureDatabase, truncateAll } from '../../data/db.js';
import * as misiones from './misiones.js';

before(() => configureDatabase(':memory:'));
beforeEach(() => truncateAll());

test('está apagada por defecto y los sucesos no avanzan hasta activarla', () => {
  assert.equal(misiones.estado().activa, false);
  assert.equal(misiones.registrar('jefes'), false);
  assert.equal(misiones.estado().progreso, 0);
});

test('se prepara apagada, cuenta solo el objetivo elegido y se apaga al completarse', () => {
  misiones.preparar('cofres');
  misiones.activar();
  assert.equal(misiones.registrar('jefes'), false);
  assert.equal(misiones.registrar('cofres'), false);
  misiones.pausar();
  misiones.registrar('cofres');
  assert.equal(misiones.estado().progreso, 1);
  misiones.activar();
  misiones.registrar('cofres');
  assert.equal(misiones.registrar('cofres'), true);
  assert.deepEqual([misiones.estado().progreso, misiones.estado().activa, misiones.estado().completada], [3, false, true]);
  assert.throws(() => misiones.activar());
});
