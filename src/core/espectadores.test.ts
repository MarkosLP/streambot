import { test, describe, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';

import { configureDatabase, truncateAll } from '../data/db.js';
import * as streams from '../data/streams.js';
import { normalize } from './events.js';
import { handleEvent } from './handler.js';
import * as espectadores from './espectadores.js';

/** El contador de espectadores de OBS (2 oct 2026). */

before(() => configureDatabase(':memory:'));

beforeEach(() => {
  truncateAll();
  espectadores.reset();
});

const aviso = (n: number) => normalize('Twitch.ViewerCountUpdate', { viewers: n }, 'streamerbot');

describe('contador de espectadores', () => {
  test('lee el aviso de Streamer.bot, con la forma de la librería', () => {
    const e = aviso(12);
    assert.ok(e.type === 'stream.viewers' && e.espectadores === 12);
    const raro = normalize('Twitch.ViewerCountUpdate', { viewerCount: 3 }, 'streamerbot');
    assert.ok(raro.type === 'stream.viewers' && raro.espectadores === 3);
  });

  test('en directo da el último número; sin directo, nada', async () => {
    await handleEvent(aviso(7));
    assert.equal(espectadores.actual(), null, 'sin directo, la placa se oculta');
    streams.open();
    await handleEvent(aviso(9));
    assert.equal(espectadores.actual(), 9);
    await handleEvent(aviso(12));
    assert.equal(espectadores.actual(), 12);
  });

  test('un número viejo caduca, y al terminar el directo se borra', async () => {
    streams.open();
    espectadores.apuntar(5, 1_000);
    assert.equal(espectadores.actual(1_000 + espectadores.CADUCA_MS), 5);
    assert.equal(espectadores.actual(1_001 + espectadores.CADUCA_MS), null);
    await handleEvent(aviso(8));
    await handleEvent(normalize('Twitch.StreamOffline', {}, 'streamerbot'));
    streams.open();
    assert.equal(espectadores.actual(), null, 'el del directo anterior no vale');
  });
});
