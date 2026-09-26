import { test, describe, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';

import { configureDatabase, truncateAll } from '../data/db.js';
import * as streams from '../data/streams.js';
import * as directo from './directo.js';

/**
 * El vigilante del directo (26 sep 2026): OBS dice si se emite, y con eso se
 * abre o se cierra. El 25 sep el directo se quedó abierto toda la noche
 * porque el aviso de Twitch no llegó.
 */

let obs: { emitiendo: boolean } | 'caido' = { emitiendo: false };
let eventos: string[] = [];

before(() => configureDatabase(':memory:'));

beforeEach(() => {
  truncateAll();
  directo.reset();
  obs = { emitiendo: false };
  eventos = [];
  directo.configurar(
    async () => {
      if (obs === 'caido') throw new Error('OBS cerrado');
      return obs;
    },
    // Como el manejador de verdad: abrir y cerrar la fila de streams.
    async (evento) => {
      eventos.push(evento);
      if (evento === 'online') streams.open();
      else streams.close();
    },
  );
});

describe('el directo según OBS', () => {
  test('OBS empieza a emitir: se abre; deja de emitir: se cierra', async () => {
    obs = { emitiendo: true };
    await directo.comprobar();
    assert.ok(streams.current());
    await directo.comprobar();
    assert.deepEqual(eventos, ['online'], 'no se abre dos veces');
    obs = { emitiendo: false };
    await directo.comprobar();
    assert.equal(streams.current(), null);
    assert.deepEqual(eventos, ['online', 'offline']);
  });

  test('lo de anoche: abierto sin emitir, se cierra en la primera comprobación', async () => {
    streams.open();
    await directo.comprobar();
    assert.equal(streams.current(), null);
  });

  test('marcado a mano para probar: no se cierra aunque OBS no emita', async () => {
    directo.marcarManual(true);
    streams.open();
    for (let i = 0; i < 3; i++) await directo.comprobar();
    assert.ok(streams.current());
    assert.equal(directo.estado().manual, true);
  });

  test('una emisión de verdad quita el modo manual: al acabar, se cierra solo', async () => {
    directo.marcarManual(true);
    streams.open();
    obs = { emitiendo: true };
    await directo.comprobar();
    obs = { emitiendo: false };
    await directo.comprobar();
    assert.equal(streams.current(), null);
  });

  test('OBS cerrado un rato: al quinto silencio se da por terminado', async () => {
    obs = { emitiendo: true };
    await directo.comprobar();
    obs = 'caido';
    for (let i = 0; i < directo.FALLOS_PARA_CERRAR - 1; i++) await directo.comprobar();
    assert.ok(streams.current(), 'un corte corto no lo cierra');
    await directo.comprobar();
    assert.equal(streams.current(), null);
  });

  test('si OBS nunca ha contestado (sin WebSocket), no cierra nada por su silencio', async () => {
    streams.open();
    obs = 'caido';
    for (let i = 0; i < directo.FALLOS_PARA_CERRAR + 2; i++) await directo.comprobar();
    assert.ok(streams.current());
  });
});
