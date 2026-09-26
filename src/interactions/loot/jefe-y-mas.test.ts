import { test, describe, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../../config.js';
import { configureDatabase, truncateAll } from '../../data/db.js';
import { normalize } from '../../core/events.js';
import { handleEvent } from '../../core/handler.js';
import { setSender } from '../../core/output.js';
import * as cooldowns from '../../core/cooldowns.js';
import * as policy from '../../core/policy.js';
import * as killswitch from '../../core/killswitch.js';
import * as ajustes from '../../core/ajustes.js';
import * as streams from '../../data/streams.js';
import * as lootDb from '../../data/loot.js';
import * as loot from './index.js';
import * as jefe from './jefe.js';
import type { Rareza } from './objetos.js';

/**
 * Lo del 26 sep 2026: el cofre de guerra que cae sin nadie, !dar, !usar y el
 * jefe de raid.
 */

let enviados: string[] = [];
let efectos: string[] = [];

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

const meter = (login: string, objeto: string, rareza: Rareza, maldito = false) =>
  lootDb.dar(`id-${login}`, login, { objeto, rareza, maldito }, 'cofre');
const objetos = (login: string) =>
  lootDb.recientes(100).filter((f) => f.twitch_id === `id-${login}`).map((f) => f.objeto);
const esperar = () => new Promise((r) => setTimeout(r, 15));

before(() => configureDatabase(':memory:'));

beforeEach(() => {
  truncateAll();
  cooldowns.reset();
  policy.reset();
  killswitch.enable('test');
  ajustes.reset();
  ajustes.setInteraccionesEspontaneas(false, 'test');
  loot.reset();
  jefe.reset();
  enviados = [];
  efectos = [];
  setSender(async (t) => {
    enviados.push(t);
  });
  loot.setPantalla(async () => {});
  loot.setLanzarEfecto(async (efecto, quien) => {
    efectos.push(`${efecto}:${quien.login}`);
    return true;
  });
});

describe('⚔️ el cofre de guerra sin nadie en el chat', () => {
  test('se queda en el suelo, se dice, y se lo lleva el primero que escribe', async () => {
    streams.open();
    // Quien grita es el canal: no cuenta para los cofres.
    // Grita el canal con LOOT_CANAL_JUEGA=false: no entra en el reparto.
    ajustes.setCanalJuega(false, 'test');
    await handleEvent(canje(config.broadcasterLogin, 'Grito de guerra'));
    ajustes.setCanalJuega(true, 'test');
    const r = await loot.soltarCofre();
    assert.equal(r.ok, false);
    assert.match(enviados.at(-1)!, /ha caído… y no hay nadie para abrirlo\. El primero que escriba/);
    assert.ok(loot.estado().enElSuelo);
    assert.equal(loot.estado().cofreDeGuerra, null);

    await handleEvent(mensaje('ana'));
    await handleEvent(mensaje('luis'));
    await esperar();
    assert.match(enviados.at(-1)!, /^⚔️ @ana llega el primero y abre el cofre de guerra/);
    assert.equal(objetos('ana').length, 1);
    assert.equal(objetos('luis').length, 0, 'solo uno se lo lleva');
    assert.equal(loot.estado().enElSuelo, null);
  });

  test('pasados 10 minutos, ya no está', async () => {
    streams.open();
    ajustes.setCanalJuega(false, 'test');
    await handleEvent(canje(config.broadcasterLogin, 'Grito de guerra'));
    ajustes.setCanalJuega(true, 'test');
    await loot.soltarCofre();
    const ana = { id: 'id-ana', login: 'ana', displayName: 'ana', isBroadcaster: false, isModerator: false, isVip: false, isSubscriber: false, rawRole: null };
    assert.equal(loot.recogerDelSuelo(ana, Math.random, Date.now() + 11 * 60_000), null);
  });

  test('un cofre normal sin nadie no dice nada (sería spam)', async () => {
    streams.open();
    await loot.soltarCofre();
    assert.equal(enviados.length, 0);
    assert.equal(loot.estado().enElSuelo, null);
  });
});

describe('📨 los dos techos de mensajes', () => {
  test('con el techo espontáneo agotado, !inventario sigue contestando (lo del 26 sep)', async () => {
    for (let i = 0; i < config.messagesPerHour; i++) policy.registerSent();
    meter('ana', 'Mapa arrugado', 'comun');
    await handleEvent(mensaje('ana', '!inventario'));
    assert.match(enviados.at(-1)!, /^@ana 🎒/);
  });
});

describe('🎁 !dar', () => {
  test('sin decir qué, da el peor objeto', async () => {
    meter('pepe', 'Arco de tejo élfico', 'raro');
    meter('pepe', 'Mapa arrugado', 'comun');
    await handleEvent(mensaje('ana'));
    await handleEvent(mensaje('pepe', '!dar @ana'));
    assert.match(enviados.at(-1)!, /^🎁 @pepe le da ⚪ Mapa arrugado a @ana/);
    assert.deepEqual(objetos('ana'), ['Mapa arrugado']);
    assert.deepEqual(objetos('pepe'), ['Arco de tejo élfico']);
    assert.equal(lootDb.coleccion('id-ana').total, 1, 'cuenta para su colección');
  });

  test('por rareza o por parte del nombre, sin tildes', async () => {
    meter('pepe', 'Mapa arrugado', 'comun');
    meter('pepe', 'Capa de las Sombras', 'epico');
    meter('pepe', 'Báculo de la Tormenta', 'epico');
    await handleEvent(mensaje('ana'));
    await handleEvent(mensaje('pepe', '!dar ana baculo'));
    cooldowns.reset();
    await handleEvent(mensaje('pepe', '!dar ana épico'));
    assert.deepEqual(objetos('ana').sort(), ['Báculo de la Tormenta', 'Capa de las Sombras']);
  });

  test('los malditos no se regalan, ni se da a quien no está, ni al canal', async () => {
    meter('pepe', 'Filo del Vacío', 'legendario', true);
    await handleEvent(mensaje('ana'));
    await handleEvent(mensaje(config.broadcasterLogin));
    await handleEvent(mensaje('pepe', '!dar ana'));
    assert.match(enviados.at(-1)!, /no se regalan/);
    meter('pepe', 'Mapa arrugado', 'comun');
    cooldowns.reset();
    await handleEvent(mensaje('pepe', '!dar fantasma'));
    assert.match(enviados.at(-1)!, /No veo a fantasma/);
    cooldowns.reset();
    await handleEvent(mensaje('pepe', `!dar ${config.broadcasterLogin}`));
    assert.match(enviados.at(-1)!, /le da ⚪ Mapa arrugado a @/, 'al canal sí se le puede dar');
    assert.equal(objetos('pepe').length, 1);
  });
});

describe('✨ !usar', () => {
  test('el Cuerno de guerra se gasta, lanza el efecto y atrae un cofre de guerra', async () => {
    streams.open();
    meter('pepe', 'Cuerno de guerra', 'epico');
    await handleEvent(mensaje('pepe', '!usar'));
    assert.match(enviados.at(-1)!, /^📯 pepe hace sonar el Cuerno de guerra\. ⚔️ ¡A las armas!/);
    assert.deepEqual(efectos, ['grito:pepe']);
    assert.equal(loot.estado().cofreDeGuerra, 'pepe');
    assert.deepEqual(objetos('pepe'), []);
  });

  test('sin directo, el cuerno no se gasta', async () => {
    meter('pepe', 'Cuerno de guerra', 'epico');
    await handleEvent(mensaje('pepe', '!usar cuerno'));
    assert.match(enviados.at(-1)!, /Sin directo/);
    assert.deepEqual(objetos('pepe'), ['Cuerno de guerra']);
    assert.deepEqual(efectos, []);
  });

  test('el Frasco purifica; y la pantalla necesita 2 min entre efectos', async () => {
    meter('pepe', 'Filo del Vacío', 'legendario', true);
    meter('pepe', 'Frasco de agua bendita', 'raro');
    meter('ana', 'Calavera que susurra', 'epico');
    await handleEvent(mensaje('pepe', '!usar frasco'));
    assert.match(enviados.at(-1)!, /Y de paso purifica 🟠 Filo del Vacío/);
    assert.equal(lootDb.tieneMaldito('id-pepe'), null);
    await handleEvent(mensaje('ana', '!usar calavera'));
    assert.match(enviados.at(-1)!, /La pantalla aún se está recuperando/);
    assert.deepEqual(objetos('ana'), ['Calavera que susurra'], 'no se gasta');
  });

  test('un objeto normal no hace nada, y lo dice', async () => {
    meter('pepe', 'Mapa arrugado', 'comun');
    await handleEvent(mensaje('pepe', '!usar mapa'));
    assert.match(enviados.at(-1)!, /no hace nada al usarlo/);
  });
});

describe('🐉 jefe de raid', () => {
  test('vida según la gente que habla; cae, y reparte con Cofre del tesoro para el MVP', async () => {
    await handleEvent(mensaje('ana'));
    await handleEvent(mensaje('luis'));
    const r = await jefe.invocar({ azar: () => 0 });
    assert.ok(r.ok);
    assert.equal(r.vida, 2 * jefe.VIDA_POR_PERSONA);
    assert.match(enviados.at(-1)!, /^🐉 ¡Aparece el Dragón de Escarcha con 200 de vida!/);

    // Ataques silenciosos hasta la mitad; luego un aviso; luego la caída.
    let vueltas = 0;
    while (jefe.estado() && vueltas++ < 100) {
      cooldowns.reset();
      await handleEvent(mensaje(vueltas % 3 ? 'ana' : 'luis', '!atacar'));
    }
    assert.equal(jefe.estado(), null, 'ha caído');
    assert.equal(enviados.length, 3, 'aparece, mitad y final: nada más');
    assert.match(enviados[1]!, /está a la mitad/);
    assert.match(enviados[2]!, /^🏆 ¡El Dragón de Escarcha ha caído! MVP ana/);
    const deAna = lootDb.recientes(10).filter((f) => f.twitch_id === 'id-ana');
    assert.equal(deAna.length, 1);
    assert.equal(deAna[0]!.origen, 'jefe');
    assert.equal(objetos('luis').length, 1);
  });

  test('el canal pega y se lleva botín; con LOOT_CANAL_JUEGA=false, solo pega', async () => {
    ajustes.setCanalJuega(false, 'test');
    try {
      await jefe.invocar({ azar: () => 0 });
      let n = 0;
      while (jefe.estado() && n++ < 100) {
        cooldowns.reset();
        await handleEvent(mensaje(config.broadcasterLogin, '!atacar'));
      }
      assert.match(enviados.at(-1)!, /Sin nadie más para repartir el botín/);
      assert.equal(lootDb.recientes(10).length, 0);
    } finally {
      ajustes.setCanalJuega(true, 'test');
    }
  });

  test('el canal juega: se lleva el Cofre del tesoro si es el MVP', async () => {
    const r = await jefe.invocar({ azar: () => 0 });
    assert.ok(r.ok);
    let vueltas = 0;
    while (jefe.estado() && vueltas++ < 100) {
      cooldowns.reset();
      await handleEvent(mensaje(config.broadcasterLogin, '!atacar'));
    }
    assert.match(enviados.at(-1)!, /ha caído! MVP /);
    const botin = lootDb.recientes(10);
    assert.equal(botin.length, 1);
    assert.equal(botin[0]!.origen, 'jefe');
  });

  test('el overlay ve la vida, cada golpe y, al final, el podio', async () => {
    await handleEvent(mensaje('ana'));
    await jefe.invocar({ azar: () => 0 });
    cooldowns.reset();
    await handleEvent(mensaje('ana', '!atacar'));
    const durante = jefe.paraOverlay();
    assert.equal(durante.jefe!.golpes.length, 1);
    assert.equal(durante.jefe!.golpes[0]!.quien, 'ana');
    assert.equal(durante.jefe!.vida, durante.jefe!.vidaMax - durante.jefe!.golpes[0]!.dano);
    let n = 0;
    while (jefe.estado() && n++ < 100) {
      cooldowns.reset();
      await handleEvent(mensaje('ana', '!atacar'));
    }
    const despues = jefe.paraOverlay();
    assert.equal(despues.jefe, null);
    assert.equal(despues.final!.resultado, 'derrotado');
    assert.equal(despues.final!.podio[0]!.quien, 'ana');
    assert.equal(jefe.paraOverlay(Date.now() + 20_000).final, null, 'el rótulo final se va solo');
  });

  test('si se acaba el tiempo, se escapa sin botín', async () => {
    await handleEvent(mensaje('ana'));
    await jefe.invocar();
    cooldowns.reset();
    await handleEvent(mensaje('ana', '!atacar'));
    await jefe._terminarPorTiempo();
    assert.match(enviados.at(-1)!, /se escapa con \d+\/100 de vida\. Quien más pegó: ana/);
    assert.equal(lootDb.recientes(10).length, 0);
  });

  test('sin jefe, !atacar no contesta; y no se invocan dos a la vez', async () => {
    await handleEvent(mensaje('ana', '!atacar'));
    assert.equal(enviados.length, 0);
    await jefe.invocar();
    assert.equal((await jefe.invocar()).ok, false);
  });
});
