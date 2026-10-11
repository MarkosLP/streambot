import { test, describe, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';

import { configureDatabase, truncateAll } from '../../data/db.js';
import { normalize } from '../../core/events.js';
import { handleEvent } from '../../core/handler.js';
import { setSender } from '../../core/output.js';
import * as cooldowns from '../../core/cooldowns.js';
import * as policy from '../../core/policy.js';
import * as killswitch from '../../core/killswitch.js';
import * as ajustes from '../../core/ajustes.js';
import * as engine from '../../core/engine.js';
import * as duelos from './duelo.js';
import * as consent from '../../core/consent.js';
import * as streams from '../../data/streams.js';
import * as lootDb from '../../data/loot.js';
import * as interactionLog from '../../data/interactions.js';
import * as loot from './index.js';
import * as comandos from './comandos.js';
import * as arena from './arena.js';
import { MOCHILA_MAX, OBJETOS, esArma, tirar } from './objetos.js';

/**
 * Los efectos del canal conectados con el botín (decidido el 25 sep 2026):
 * Grito de guerra → cofre de guerra; Maldición → objeto maldito que se
 * pierde en los duelos; Poción de vida → purificarlo.
 */

let enviados: string[] = [];
let enPantalla: string[] = [];

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

function canje(login: string, recompensa: string) {
  return normalize(
    'Twitch.RewardRedemption',
    {
      id: `r-${Math.random()}`,
      user_id: `id-${login}`,
      user_login: login,
      user_name: login,
      user_input: '',
      reward: { id: `rw-${recompensa}`, title: recompensa, cost: 1 },
    },
    'simulator',
  );
}

const fijo = (v: number) => () => v;
const pantalla = () => new Promise((r) => setTimeout(r, 10));

before(() => configureDatabase(':memory:'));

beforeEach(() => {
  truncateAll();
  duelos.reset();
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
    enPantalla.push(`${quien}|${botin.rareza}|${origen}|${botin.maldito ? 'maldito' : ''}`);
  });
});

describe('las armas', () => {
  test('todas las rarezas tienen alguna, y la hojalata no cuenta', () => {
    for (const lista of Object.values(OBJETOS)) assert.ok(lista.some(esArma));
    assert.equal(esArma('Colgante de hojalata'), false);
    assert.equal(esArma('Hoja del Rey Caído'), true);
  });

  test('el cofre de guerra solo da armas', () => {
    for (let i = 0; i < 200; i++) assert.ok(esArma(tirar('guerra').objeto));
  });
});

describe('⚔️ Grito de guerra', () => {
  test('con directo, anuncia el cofre de guerra y el siguiente cofre lo es', async () => {
    streams.open();
    await handleEvent(canje('pepe', 'Grito de guerra'));
    assert.match(enviados[0]!, /^⚔️ ¡A las armas! El grito de pepe atrae un cofre de guerra/);
    assert.equal(loot.estado().cofreDeGuerra, 'pepe');
    assert.ok(loot.estado().proximoEnSeg! <= 120, 'adelantado a 1-2 min');

    const r = await loot.soltarCofre({ azar: fijo(0) });
    assert.ok(r.ok && r.reparto.every((x) => esArma(x.botin.objeto)));
    assert.match(enviados[1]!, /^⚔️ ¡Cofre de guerra \(grito de pepe\)!/);
    assert.equal(loot.estado().cofreDeGuerra, null, 'solo un cofre');
  });

  test('quien grita entra en el reparto aunque no haya escrito', async () => {
    streams.open();
    await handleEvent(canje('pepe', 'Grito de guerra'));
    assert.deepEqual(loot.aventureros().map((v) => v.login), ['pepe']);
  });

  test('no se acumula: el segundo grito se suma al que ya viene, y se dice en el chat', async () => {
    streams.open();
    await handleEvent(canje('pepe', 'Grito de guerra'));
    await handleEvent(canje('ana', 'Grito de guerra'));
    assert.equal(enviados.length, 2);
    assert.match(enviados[1]!, /^⚔️ ¡ana se une al grito de pepe! El cofre de guerra ya viene/);
    assert.equal(loot.estado().cofreDeGuerra, 'pepe');
  });

  test('reconoce la recompensa aunque en Twitch lleve emojis, mayúsculas o signos', async () => {
    streams.open();
    await handleEvent(canje('pepe', '⚔️ Grito de GUERRA!'));
    assert.match(enviados[0]!, /^⚔️ ¡A las armas!/);
  });

  test('si se descarta, queda en el Registro con el motivo', async () => {
    await handleEvent(canje('pepe', 'Grito de guerra'));
    const filas = interactionLog.all().filter((r) => r.interaction === 'loot-grito');
    assert.equal(filas[0]?.status, 'skipped');
    assert.match(filas[0]!.detail!, /sin directo/);
  });

  test('sin directo, o con el Loot apagado, el bot no dice nada', async () => {
    await handleEvent(canje('pepe', 'Grito de guerra'));
    streams.open();
    ajustes.setLootActivo(false, 'test');
    await handleEvent(canje('pepe', 'Grito de guerra'));
    assert.equal(enviados.length, 0);
  });
});

describe('💀 Maldición', () => {
  test('da un objeto maldito, con poder doble, en pantalla', async () => {
    await engine.run(loot.maldicion, { viewer: { id: 'id-pepe', login: 'pepe', displayName: 'pepe' } as any, trigger: 'channel-point', azar: fijo(0.5) });
    await pantalla();
    assert.match(enviados[0]!, /^☠️ @pepe maldice al streamer… y la maldición le devuelve ☠️🔵 .+: poder doble/);
    const inv = lootDb.inventario('id-pepe');
    assert.equal(inv.malditos, 1);
    assert.equal(inv.poder, 6, 'un Raro (3) maldito vale 6');
    assert.equal(enPantalla[0], 'pepe|raro|maldicion|maldito');
  });

  test('llega por el manejador con su nombre, tilde incluida', async () => {
    await handleEvent(canje('pepe', 'Maldición'));
    assert.equal(lootDb.inventario('id-pepe').malditos, 1);
  });

  test('entra aunque la mochila esté llena, y no echa a otro maldito', () => {
    for (let i = 0; i < MOCHILA_MAX; i++) lootDb.dar('id-pepe', 'pepe', { objeto: 'x', rareza: 'legendario', maldito: true }, 'maldicion');
    const r = lootDb.dar('id-pepe', 'pepe', { objeto: 'y', rareza: 'comun', maldito: true }, 'maldicion');
    assert.equal(r.guardado, true);
    assert.equal(lootDb.inventario('id-pepe').malditos, MOCHILA_MAX + 1);
  });

  test('con la mochila llena, lo nuevo nunca tira un maldito', () => {
    lootDb.dar('id-pepe', 'pepe', { objeto: 'Mapa arrugado', rareza: 'comun', maldito: true }, 'maldicion');
    for (let i = 1; i < MOCHILA_MAX; i++) lootDb.dar('id-pepe', 'pepe', { objeto: 'Arco de tejo élfico', rareza: 'raro' }, 'cofre');
    const r = lootDb.dar('id-pepe', 'pepe', { objeto: 'Capa de las Sombras', rareza: 'epico' }, 'cofre');
    assert.equal(r.sustituido?.rareza, 'raro', 'se tira un Raro normal, no el Común maldito');
    assert.equal(lootDb.inventario('id-pepe').malditos, 1);
  });

  test('los malditos no se forjan', async () => {
    for (let i = 0; i < 3; i++) lootDb.dar('id-pepe', 'pepe', { objeto: 'Espada oxidada', rareza: 'comun', maldito: true }, 'maldicion');
    await handleEvent(mensaje('pepe', '!forjar'));
    assert.match(enviados[0]!, /hacen falta 3/);
    assert.equal(lootDb.inventario('id-pepe').malditos, 3);
  });

  test('quien pidió el olvido no recibe nada', async () => {
    consent.olvidar('id-pepe');
    await handleEvent(canje('pepe', 'Maldición'));
    assert.equal(enviados.length, 0);
  });
});

describe('☠️ el maldito en los duelos', () => {
  // Pepe reta y Ana acepta: con 0,99 gana Ana todos los asaltos; con 0, Pepe.
  const retar = async (azar: number) => {
    await engine.run(comandos.duelo, { viewer: { id: 'id-pepe', login: 'pepe', displayName: 'pepe' } as any, trigger: 'command', args: 'ana' });
    await engine.run(comandos.acepto, { viewer: { id: 'id-ana', login: 'ana', displayName: 'ana' } as any, trigger: 'command', args: '', azar: fijo(azar) });
  };

  test('quien pierde un duelo pierde su maldito, que pasa al ganador', async () => {
    lootDb.dar('id-pepe', 'pepe', { objeto: 'Corona del Liche', rareza: 'epico', maldito: true }, 'maldicion');
    lootDb.dar('id-ana', 'ana', { objeto: 'Espada oxidada', rareza: 'comun' }, 'cofre');
    await handleEvent(mensaje('ana'));
    await retar(0.99);
    await pantalla();
    assert.match(enviados.at(-1)!, /¡Gana ana 2-0!.*☠️ ☠️🟣 Corona del Liche pasa a ana\./);
    assert.equal(lootDb.inventario('id-pepe').malditos, 0);
    assert.equal(lootDb.inventario('id-ana').malditos, 1);
    assert.equal(lootDb.coleccion('id-ana').porRareza.epico.tiene, 1, 'cuenta para su colección');
    // En pantalla lo cuenta el overlay del duelo, no el banner del botín.
    assert.equal(arena.recientes().at(-1)!.maldito, 'Corona del Liche');
    assert.equal(enPantalla.length, 0);
  });

  test('quien gana conserva el suyo', async () => {
    lootDb.dar('id-pepe', 'pepe', { objeto: 'Corona del Liche', rareza: 'epico', maldito: true }, 'maldicion');
    lootDb.dar('id-ana', 'ana', { objeto: 'Espada oxidada', rareza: 'comun' }, 'cofre');
    await handleEvent(mensaje('ana'));
    await retar(0);
    assert.doesNotMatch(enviados.at(-1)!, /pasa a/);
    assert.equal(lootDb.inventario('id-pepe').malditos, 1);
  });
});

describe('🧪 Poción de vida y !purificar', () => {
  test('sin maldito, la poción es solo "¡Bebe agua!": el bot no dice nada', async () => {
    await handleEvent(canje('pepe', 'Poción de vida'));
    assert.equal(enviados.length, 0);
  });

  test('con maldito, ofrece purificar, y !purificar lo limpia', async () => {
    lootDb.dar('id-pepe', 'pepe', { objeto: 'Corona del Liche', rareza: 'epico', maldito: true }, 'maldicion');
    await handleEvent(canje('pepe', 'Poción de vida'));
    assert.match(enviados[0]!, /^🧪 @pepe la poción puede limpiar tu ☠️🟣 Corona del Liche\. Escribe !purificar en 5 min/);

    await handleEvent(mensaje('pepe', '!purificar'));
    await pantalla();
    assert.match(enviados[1]!, /^🧪 @pepe purifica 🟣 Corona del Liche: ya es suyo para siempre/);
    const inv = lootDb.inventario('id-pepe');
    assert.equal(inv.malditos, 0);
    assert.equal(inv.poder, 8, 'vuelve al poder normal');
    assert.equal(enPantalla.at(-1), 'pepe|epico|purificar|');
  });

  test('!purificar sin poción no hace nada', async () => {
    lootDb.dar('id-pepe', 'pepe', { objeto: 'Corona del Liche', rareza: 'epico', maldito: true }, 'maldicion');
    await handleEvent(mensaje('pepe', '!purificar'));
    assert.match(enviados[0]!, /canjea antes una Poción de vida/);
    assert.equal(lootDb.inventario('id-pepe').malditos, 1);
  });

  test('purificado, ya no se pierde en un duelo', async () => {
    lootDb.dar('id-pepe', 'pepe', { objeto: 'Corona del Liche', rareza: 'epico', maldito: true }, 'maldicion');
    lootDb.purificar('id-pepe');
    lootDb.dar('id-ana', 'ana', { objeto: 'Espada oxidada', rareza: 'comun' }, 'cofre');
    await handleEvent(mensaje('ana'));
    await engine.run(comandos.duelo, { viewer: { id: 'id-pepe', login: 'pepe', displayName: 'pepe' } as any, trigger: 'command', args: 'ana' });
    await engine.run(comandos.acepto, { viewer: { id: 'id-ana', login: 'ana', displayName: 'ana' } as any, trigger: 'command', args: '', azar: fijo(0.99) });
    assert.match(enviados.at(-1)!, /¡Gana ana/);
    assert.equal(lootDb.inventario('id-pepe').porRareza.epico, 1);
  });
});
