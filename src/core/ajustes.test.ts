import { test, describe, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../config.js';
import { configureDatabase, truncateAll } from '../data/db.js';
import * as ajustes from './ajustes.js';

/** Los ajustes del panel se guardan y sobreviven a un reinicio (26 sep 2026). */

before(() => configureDatabase(':memory:'));

beforeEach(() => {
  truncateAll();
  ajustes.reset();
});

describe('ajustes guardados', () => {
  test('lo que cambias en el panel se guarda y vuelve tras un reinicio', () => {
    ajustes.setLootActivo(!config.loot.activo, 'test');
    ajustes.setCanalJuega(!config.loot.canalJuega, 'test');
    // «Reinicio»: la memoria vuelve al .env…
    ajustes.reset();
    assert.equal(ajustes.lootActivo(), config.loot.activo);
    // …y al arrancar se recupera lo guardado.
    ajustes.cargarGuardados();
    assert.equal(ajustes.lootActivo(), !config.loot.activo);
    assert.equal(ajustes.canalJuega(), !config.loot.canalJuega);
    assert.equal(ajustes.modoRevision(), config.reviewMode, 'lo que no tocaste sigue el .env');
  });

  test('el panel ve qué está guardado y qué dice el .env', () => {
    ajustes.setModoRevision(!config.reviewMode, 'test');
    const t = ajustes.todos();
    assert.deepEqual(t.revision, { valor: !config.reviewMode, guardado: true, env: config.reviewMode });
    assert.equal(t.loot.guardado, false);
  });

  test('«volver a lo del .env» lo olvida todo, también tras un reinicio', () => {
    ajustes.setInteraccionesEspontaneas(!config.interaccionesEspontaneas, 'test');
    ajustes.volverAlEnv('test');
    assert.equal(ajustes.interaccionesEspontaneas(), config.interaccionesEspontaneas);
    ajustes.reset();
    ajustes.cargarGuardados();
    assert.equal(ajustes.interaccionesEspontaneas(), config.interaccionesEspontaneas);
  });
});
