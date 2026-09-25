import { test, describe, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';

import { configureDatabase, truncateAll, getDb } from '../../data/db.js';
import { normalize } from '../../core/events.js';
import { handleEvent } from '../../core/handler.js';
import { setSender } from '../../core/output.js';
import * as cooldowns from '../../core/cooldowns.js';
import * as policy from '../../core/policy.js';
import * as killswitch from '../../core/killswitch.js';
import * as ajustes from '../../core/ajustes.js';
import * as consent from '../../core/consent.js';
import * as lootDb from '../../data/loot.js';
import * as loot from './index.js';
import { OBJETOS, PROBABILIDADES, RAREZAS, tirar } from './objetos.js';

/**
 * Loot del chat.
 *
 * Lo que más importa: que el botín caiga a quien está hablando y a nadie más,
 * que se guarde aunque el anuncio no salga, que un cofre sea UN mensaje por
 * mucha gente que haya, y que !olvidame también vacíe la mochila.
 */

let enviados: string[] = [];

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

function redencion(login: string, recompensa = 'Cofre del tesoro') {
  return normalize(
    'Twitch.RewardRedemption',
    {
      id: `r-${Math.random()}`,
      user_id: `id-${login}`,
      user_login: login,
      user_name: login,
      user_input: '',
      reward: { id: `rw-${recompensa}`, title: recompensa, cost: 500 },
    },
    'simulator',
  );
}

/** Un azar que devuelve siempre lo mismo: 0 = lo peor, 0.999 = lo mejor. */
const fijo = (v: number) => () => v;

before(() => configureDatabase(':memory:'));

beforeEach(() => {
  truncateAll();
  cooldowns.reset();
  policy.reset();
  killswitch.enable('test');
  ajustes.reset();
  // Con las espontáneas APAGADAS, como en el canal: el Loot va por su cuenta.
  ajustes.setInteraccionesEspontaneas(false, 'test');
  loot.reset();
  setSender(async (texto) => {
    enviados.push(texto);
  });
  enviados = [];
});

describe('catálogo', () => {
  test('las probabilidades suman 100 y ninguna lista está vacía', () => {
    for (const tabla of Object.values(PROBABILIDADES)) {
      assert.equal(RAREZAS.reduce((n, r) => n + tabla[r], 0), 100);
    }
    for (const r of RAREZAS) assert.ok(OBJETOS[r].length > 0, r);
  });

  test('la tirada respeta los tramos', () => {
    assert.equal(tirar('cofre', fijo(0)).rareza, 'comun');
    assert.equal(tirar('cofre', fijo(0.7)).rareza, 'raro');
    assert.equal(tirar('cofre', fijo(0.9)).rareza, 'epico');
    assert.equal(tirar('cofre', fijo(0.999)).rareza, 'legendario');
  });

  test('el Cofre del tesoro es mejor que el gratis', () => {
    // La misma tirada que en el gratis da Común, en el de Oro ya es Raro.
    assert.equal(tirar('cofre', fijo(0.5)).rareza, 'comun');
    assert.equal(tirar('oro', fijo(0.5)).rareza, 'raro');
  });
});

describe('quién recibe botín', () => {
  test('quien escribe en el chat entra, aunque las espontáneas estén apagadas', async () => {
    await handleEvent(mensaje('pepe'));
    assert.deepEqual(loot.aventureros().map((v) => v.login), ['pepe']);
    assert.equal(enviados.length, 0, 'escribir no hace hablar al bot');
  });

  test('quien lleva más de 15 minutos callado ya no', async () => {
    await handleEvent(mensaje('pepe'));
    assert.deepEqual(loot.aventureros(Date.now() + 16 * 60_000), []);
  });

  test('ni los bots ni el propio canal', async () => {
    await handleEvent(mensaje('nightbot'));
    await handleEvent(mensaje('crid4m'));
    assert.deepEqual(loot.aventureros(), []);
  });

  test('ni quien pidió el olvido', async () => {
    await handleEvent(mensaje('pepe'));
    consent.olvidar('id-pepe');
    assert.deepEqual(loot.aventureros(), []);
  });
});

describe('soltar un cofre', () => {
  test('sin nadie hablando no cae nada ni se escribe nada', async () => {
    const r = await loot.soltarCofre();
    assert.equal(r.ok, false);
    assert.equal(enviados.length, 0);
  });

  test('un solo mensaje para todos, y cada uno se lleva lo suyo', async () => {
    await handleEvent(mensaje('pepe'));
    await handleEvent(mensaje('ana'));
    const r = await loot.soltarCofre({ azar: fijo(0) });

    assert.ok(r.ok);
    assert.equal(enviados.length, 1);
    assert.match(enviados[0]!, /^🎁 ¡Ha caído un cofre! pepe → ⚪ .+ · ana → ⚪ /);
    assert.doesNotMatch(enviados[0]!, /@/, 'el anuncio no notifica a nadie');
    assert.equal(lootDb.inventario('id-pepe').total, 1);
    assert.equal(lootDb.inventario('id-ana').total, 1);
  });

  test('el botín se guarda aunque el anuncio no pueda salir', async () => {
    await handleEvent(mensaje('pepe'));
    killswitch.disable('test');
    await loot.soltarCofre({ azar: fijo(0) });
    assert.equal(enviados.length, 0);
    assert.equal(lootDb.inventario('id-pepe').total, 1);
  });

  test('un Legendario se celebra en pantalla; lo demás no', async () => {
    const celebrados: string[] = [];
    loot.setAlLegendario(async (quien, botin) => {
      celebrados.push(`${quien}:${botin.rareza}`);
    });
    await handleEvent(mensaje('pepe'));
    await loot.soltarCofre({ azar: fijo(0) });
    assert.deepEqual(celebrados, []);

    await loot.soltarCofre({ azar: fijo(0.999) });
    assert.deepEqual(celebrados, ['pepe:legendario']);
    assert.match(enviados[1]!, /^✨ ¡Cofre LEGENDARIO!/);
  });

  test('con muchísima gente el mensaje se corta a tiempo y lo dice', () => {
    const reparto = Array.from({ length: 40 }, (_, i) => ({
      viewer: { id: `${i}`, login: `a${i}`, displayName: `Aventurero_numero_${i}` } as any,
      botin: { objeto: 'Espada del Amanecer Eterno', rareza: 'epico' as const },
    }));
    const texto = loot.componerCofre(reparto);
    assert.ok(texto.length <= 480, `${texto.length} caracteres`);
    assert.match(texto, /y \d+ más \(!inventario\)$/);
  });
});

describe('Cofre del tesoro (Oro)', () => {
  test('lo abre al canjearlo, con mención, y va a la mochila', async () => {
    await loot.channelPointBinding.run(redencion('pepe') as any, fijo(0.5));
    assert.equal(enviados.length, 1);
    assert.match(enviados[0]!, /^🗝️ @pepe abre un Cofre del tesoro → 🔵 /);
    const [fila] = lootDb.recientes(1);
    assert.equal(fila!.origen, 'oro');
  });

  test('llega por el manejador como cualquier recompensa', async () => {
    await handleEvent(redencion('pepe'));
    assert.equal(lootDb.inventario('id-pepe').total, 1);
  });

  test('también para el dueño del canal, que así puede probarlo', async () => {
    await handleEvent(redencion('crid4m'));
    assert.equal(enviados.length, 1);
  });

  test('quien pidió el olvido lo abre, pero no se le guarda', async () => {
    consent.olvidar('id-pepe');
    await loot.channelPointBinding.run(redencion('pepe') as any, fijo(0));
    assert.equal(enviados.length, 1);
    assert.equal(lootDb.inventario('id-pepe').total, 0);
  });

  test('otra recompensa no abre cofres', async () => {
    await handleEvent(redencion('pepe', 'Grito de guerra'));
    assert.equal(lootDb.inventario('id-pepe').total, 0);
  });
});

describe('!inventario', () => {
  test('con la mochila vacía, explica cómo conseguir algo', async () => {
    await handleEvent(mensaje('pepe', '!inventario'));
    assert.match(enviados[0]!, /^@pepe tu mochila está vacía/);
  });

  test('cuenta por rareza y enseña la mejor pieza', async () => {
    lootDb.guardar('id-pepe', 'pepe', { objeto: 'Espada oxidada', rareza: 'comun' }, 'cofre');
    lootDb.guardar('id-pepe', 'pepe', { objeto: 'Capa de las Sombras', rareza: 'epico' }, 'cofre');
    lootDb.guardar('id-pepe', 'pepe', { objeto: 'Mapa arrugado', rareza: 'comun' }, 'cofre');
    await handleEvent(mensaje('pepe', '!mochila'));
    assert.equal(enviados[0], '@pepe 🎒 3 objetos: 2 ⚪ 1 🟣 · Tu mejor pieza: 🟣 Capa de las Sombras');
  });

  test('una vez por minuto y persona', async () => {
    await handleEvent(mensaje('pepe', '!inv'));
    await handleEvent(mensaje('pepe', '!inv'));
    await handleEvent(mensaje('ana', '!inv'));
    assert.equal(enviados.length, 2);
  });
});

describe('derecho al olvido', () => {
  test('!olvidame vacía la mochila', async () => {
    lootDb.guardar('id-pepe', 'pepe', { objeto: 'Espada oxidada', rareza: 'comun' }, 'cofre');
    await handleEvent(mensaje('pepe', '!olvidame'));
    assert.equal(lootDb.inventario('id-pepe').total, 0);
    const n = getDb().prepare('SELECT COUNT(*) AS n FROM loot').get() as { n: number };
    assert.equal(n.n, 0);
  });
});
