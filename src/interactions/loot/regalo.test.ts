import { test, describe, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../../config.js';
import { configureDatabase, truncateAll } from '../../data/db.js';
import { normalize, type Viewer } from '../../core/events.js';
import { handleEvent } from '../../core/handler.js';
import { setSender } from '../../core/output.js';
import * as cooldowns from '../../core/cooldowns.js';
import * as policy from '../../core/policy.js';
import * as killswitch from '../../core/killswitch.js';
import * as ajustes from '../../core/ajustes.js';
import * as consent from '../../core/consent.js';
import * as users from '../../data/users.js';
import * as lootDb from '../../data/loot.js';
import * as loot from './index.js';

/**
 * Regalar un cofre desde el panel (26 sep 2026): cuando quieras, haya hablado
 * alguien o no, para todo el chat o para una persona. Nunca a los bots.
 */

let enviados: string[] = [];
let enPantalla: string[] = [];

const persona = (login: string): Viewer => ({
  id: `id-${login}`,
  login,
  displayName: login,
  isBroadcaster: false,
  isModerator: false,
  isVip: false,
  isSubscriber: false,
  rawRole: null,
});

function mensaje(login: string, texto = 'hola') {
  return normalize(
    'Twitch.ChatMessage',
    {
      messageId: `m-${Math.random()}`,
      user: { id: `id-${login}`, login, name: login, role: 1, badges: [], subscribed: false },
      text: texto,
      meta: { firstMessage: false, returningChatter: false },
    },
    'simulator',
  );
}

const fijo = (v: number) => () => v;
const streamer = config.broadcasterLogin.charAt(0).toUpperCase() + config.broadcasterLogin.slice(1);

before(() => configureDatabase(':memory:'));

beforeEach(() => {
  truncateAll();
  cooldowns.reset();
  policy.reset();
  killswitch.enable('test');
  ajustes.reset();
  ajustes.setInteraccionesEspontaneas(false, 'test');
  loot.reset();
  enviados = [];
  enPantalla = [];
  setSender(async (t) => {
    enviados.push(t);
  });
  loot.setPantalla(async (quien, botin, origen) => {
    enPantalla.push(`${quien}|${botin.rareza}|${origen}`);
  });
});

describe('🎁 regalar a todo el chat', () => {
  test('le toca a quien está en el chat aunque no haya escrito, canal incluido, sin bots', async () => {
    loot.setChatters(async () => [persona('ana'), persona('luis'), persona('streamelements'), persona(config.broadcasterLogin)]);
    const r = await loot.regalarCofre({ azar: fijo(0) });
    assert.ok(r.ok);
    assert.deepEqual(r.reparto.map((x) => x.viewer.login).sort(), ['ana', config.broadcasterLogin, 'luis'].sort());
    assert.ok(enviados[0]!.startsWith(`🎁 ¡${streamer} regala un cofre a todo el chat! `), enviados[0]);
    assert.equal(lootDb.recientes(5)[0]!.origen, 'regalo');
    await new Promise((res) => setTimeout(res, 10));
    assert.ok(enPantalla.every((p) => p.endsWith('|regalo')));
  });

  test('tampoco a quien pidió el olvido', async () => {
    loot.setChatters(async () => [persona('ana'), persona('luis')]);
    consent.olvidar('id-luis');
    const r = await loot.regalarCofre({ azar: fijo(0) });
    assert.ok(r.ok);
    assert.deepEqual(r.reparto.map((x) => x.viewer.login), ['ana']);
  });

  test('si Streamer.bot no contesta, vale con quien ha escrito', async () => {
    loot.setChatters(async () => {
      throw new Error('sin conexión');
    });
    await handleEvent(mensaje('pepe'));
    const r = await loot.regalarCofre({ azar: fijo(0) });
    assert.ok(r.ok);
    assert.deepEqual(r.reparto.map((x) => x.viewer.login), ['pepe']);
  });

  test('sin nadie en el chat, lo dice y no reparte nada', async () => {
    loot.setChatters(async () => [persona('nightbot')]);
    const r = await loot.regalarCofre();
    assert.equal(r.ok, false);
    assert.equal(enviados.length, 0);
  });

  test('el Cofre del tesoro usa sus probabilidades', async () => {
    loot.setChatters(async () => [persona('ana')]);
    // 50 %: Común en el cofre normal (60), Raro en el del tesoro (35 + 35).
    const normal = await loot.regalarCofre({ azar: fijo(0.5) });
    cooldowns.reset();
    const tesoro = await loot.regalarCofre({ azar: fijo(0.5), tipo: 'oro' });
    assert.ok(normal.ok && tesoro.ok);
    assert.equal(normal.reparto[0]!.botin.rareza, 'comun');
    assert.equal(tesoro.reparto[0]!.botin.rareza, 'raro');
    assert.match(enviados[1]!, /regala un Cofre del tesoro/);
  });
});

describe('🎁 regalar a una persona', () => {
  test('a quien está en el chat, con mención', async () => {
    loot.setChatters(async () => [persona('ana'), persona('luis')]);
    const r = await loot.regalarCofre({ para: '@Ana', azar: fijo(0) });
    assert.ok(r.ok);
    assert.equal(r.reparto.length, 1);
    assert.ok(enviados[0]!.startsWith(`🎁 ${streamer} le regala un cofre a @ana → `), enviados[0]);
  });

  test('a quien pasó por el chat otro día', async () => {
    users.touch(persona('marta'));
    const r = await loot.regalarCofre({ para: 'marta', azar: fijo(0) });
    assert.ok(r.ok);
    assert.equal(lootDb.inventario('id-marta').total, 1);
  });

  test('a ti también, si estás en el chat', async () => {
    loot.setChatters(async () => [persona(config.broadcasterLogin)]);
    const r = await loot.regalarCofre({ para: config.broadcasterLogin, azar: fijo(0) });
    assert.ok(r.ok);
  });

  test('ni a un bot, ni a alguien desconocido, ni al canal con LOOT_CANAL_JUEGA=false', async () => {
    ajustes.setCanalJuega(false, 'test');
    try {
      assert.equal((await loot.regalarCofre({ para: config.broadcasterLogin })).ok, false);
    } finally {
      ajustes.setCanalJuega(true, 'test');
    }
    for (const para of ['StreamElements', 'nadie_conocido']) {
      const r = await loot.regalarCofre({ para });
      assert.equal(r.ok, false, para);
    }
    assert.equal(enviados.length, 0);
  });
});
