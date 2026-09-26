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
import * as consent from '../../core/consent.js';
import * as streams from '../../data/streams.js';
import * as lootDb from '../../data/loot.js';
import * as suscriptores from '../../data/suscriptores.js';
import * as loot from './index.js';
import * as jefe from './jefe.js';
import * as mecenas from './mecenas.js';
import { OBJETOS, OBJETOS_MECENAS, TITULO_MECENAS, esMecenas } from './objetos.js';

/** Suscriptores, regalos, bits y raids (propuestas S1-S7, 26 sep 2026). */

let enviados: string[] = [];
let pantalla: string[] = [];
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

before(() => configureDatabase(':memory:'));

beforeEach(() => {
  truncateAll();
  cooldowns.reset();
  policy.reset();
  killswitch.enable('test');
  ajustes.reset();
  ajustes.setLootActivo(true, 'test');
  ajustes.setInteraccionesEspontaneas(false, 'test');
  loot.reset();
  jefe.reset();
  suscriptores.reset();
  mecenas.reset({ ventana: 30, jefeRaid: 20 });
  enviados = [];
  pantalla = [];
  setSender(async (t) => { enviados.push(t); });
  loot.setPantalla(async (quien, botin, origen) => { pantalla.push(`${quien}|${botin.rareza}|${origen}`); });
});

// Payloads con la forma de @streamerbot/client (camelCase).
const sub = (login: string) => normalize('Twitch.Sub', { subTier: 1000, userId: `id-${login}`, userName: login, displayName: login, isTest: false }, 'streamerbot');
const resub = (login: string, meses: number) => normalize('Twitch.ReSub', { cumulativeMonths: meses, subTier: 2000, userId: `id-${login}`, userName: login, displayName: login }, 'streamerbot');
const regalo = (de: string | null, para: string, bomba = 0) => normalize('Twitch.GiftSub', {
  isAnonymous: de === null, fromSubBomb: bomba > 0, subBombCount: bomba,
  userId: de ? `id-${de}` : '', userName: de ?? '', displayName: de ?? '',
  recipientUserId: `id-${para}`, recipientUsername: para, recipientDisplayName: para, subTier: 1000,
}, 'streamerbot');
const bits = (login: string, n: number) => normalize('Twitch.Cheer', { userId: `id-${login}`, username: login, displayName: login, bits: n, subscriber: false }, 'streamerbot');
const raid = (desde: string, n: number) => normalize('Twitch.Raid', {
  from_broadcaster_user_id: `id-${desde}`, from_broadcaster_user_login: desde, from_broadcaster_user_name: desde,
  to_broadcaster_user_id: '1', to_broadcaster_user_login: 'crid4m', to_broadcaster_user_name: 'Crid4m', viewers: n,
}, 'streamerbot');
const objetos = (login: string) => lootDb.recientes(100).filter((f) => f.twitch_id === `id-${login}`);

describe('leer los avisos', () => {
  test('sub, resub, regalo, bits y raid: con la forma de la librería', () => {
    const s = sub('ana');
    assert.ok(s.type === 'viewer.sub' && s.viewer.id === 'id-ana' && s.meses === 1 && !s.resub && s.nivel === 1);
    const r = resub('ana', 7);
    assert.ok(r.type === 'viewer.sub' && r.meses === 7 && r.resub && r.nivel === 2);
    const g = regalo('luis', 'ana', 5);
    assert.ok(g.type === 'viewer.giftsub' && g.regala?.id === 'id-luis' && g.recibe.id === 'id-ana' && g.bomba === 5);
    const a = regalo(null, 'ana');
    assert.ok(a.type === 'viewer.giftsub' && a.regala === null && a.recibe.login === 'ana');
    const b = bits('pepe', 300);
    assert.ok(b.type === 'viewer.cheer' && b.bits === 300 && b.viewer.id === 'id-pepe');
    const x = raid('otrocanal', 12);
    assert.ok(x.type === 'channel.raid' && x.desde.login === 'otrocanal' && x.espectadores === 12);
  });

  test('también con snake_case y user anidado, que es como llegaron los canjes', () => {
    const s = normalize('Twitch.Sub', { user: { id: 'id-ana', login: 'Ana', name: 'Ana' }, tier: 3000 }, 'streamerbot');
    assert.ok(s.type === 'viewer.sub' && s.viewer.id === 'id-ana' && s.viewer.login === 'ana' && s.nivel === 3);
    const g = normalize('Twitch.GiftSub', { user: { id: 'id-luis', login: 'luis', name: 'luis' }, recipientUserId: 'id-ana', recipientUsername: 'ana' }, 'streamerbot');
    assert.ok(g.type === 'viewer.giftsub' && g.regala?.id === 'id-luis' && g.recibe.id === 'id-ana', 'quien recibe no se confunde con quien regala');
  });
});

describe('💜 S1 · cofre de suscriptor', () => {
  test('al suscribirse: cofre, banner, gracias en el chat, y queda apuntado', async () => {
    await handleEvent(sub('ana'));
    assert.equal(objetos('ana').length, 1);
    assert.equal(objetos('ana')[0]!.origen, 'suscriptor');
    assert.match(enviados[0]!, /^💜 ¡Gracias por la suscripción, @ana! Cofre de suscriptor → /);
    await esperar(5);
    assert.match(pantalla[0]!, /\|suscriptor$/);
    assert.equal(suscriptores.esSub('id-ana'), true);
  });

  test('aniversario de 6 meses: se dice; a los 12, legendario asegurado', async () => {
    await handleEvent(resub('ana', 6));
    assert.match(enviados[0]!, /lleva 6 meses suscrito!.*aniversario de 6 meses/);
    await handleEvent(resub('luis', 12));
    assert.match(enviados[1]!, /¡un año: legendario asegurado!/);
    assert.equal(objetos('luis')[0]!.rareza, 'legendario');
    assert.equal(mecenas.cofreDeSuscriptor(24, () => 0.99).botin.rareza, 'legendario');
  });

  test('con el Loot apagado se apunta como sub, pero no cae nada', async () => {
    ajustes.setLootActivo(false, 'test');
    await handleEvent(sub('ana'));
    assert.equal(objetos('ana').length, 0);
    assert.equal(suscriptores.esSub('id-ana'), true);
  });
});

describe('🎁 S2 · regalar subs = regalar cofres', () => {
  test('una bomba de 6: un solo mensaje, 5 cofres para quien regala, uno para cada quien recibe, y lluvia', async () => {
    const recibe = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
    loot.setChatters(async () => ['x1', 'x2'].map((l) => ({ id: `id-${l}`, login: l, displayName: l, isBroadcaster: false, isModerator: false, isVip: false, isSubscriber: false, rawRole: null })));
    for (const r of recibe) await handleEvent(regalo('luis', r, 6));
    await esperar(80);
    const anuncios = enviados.filter((t) => t.includes('regala 6 subs'));
    assert.equal(anuncios.length, 1, 'un mensaje, no seis');
    assert.match(anuncios[0]!, /Cofre de bienvenida para 6 · luis se lleva 5 cofres del tesoro/);
    assert.equal(objetos('luis').length, mecenas.TOPE_REGALADOR);
    for (const r of recibe) assert.equal(objetos(r).length, 1, r);
    assert.ok(enviados.some((t) => t.startsWith('🌧️ ¡Lluvia de cofres por las 6 subs de luis!')));
    assert.equal(objetos('x1').length, 1, 'la lluvia es para el chat');
  });

  test('una sola, y anónima: bienvenida con mención, sin cofre para nadie más', async () => {
    await handleEvent(regalo(null, 'ana'));
    await esperar(60);
    assert.match(enviados[0]!, /^🎁 ¡Alguien anónimo regala una sub! Cofre de bienvenida para @ana → /);
    assert.equal(objetos('ana').length, 1);
    assert.equal(suscriptores.esSub('id-ana'), true);
  });
});

describe('💣 bombas de regalos («Gift Bombs: Ignored» en Streamer.bot)', () => {
  const bomba = (de: string, n: number, recibe: string[] = []) => normalize('Twitch.GiftBomb', {
    userId: `id-${de}`, userName: de, displayName: de, gifts: n, id: 'id-del-aviso',
    recipients: recibe.map((r) => ({ id: `id-${r}`, login: r, name: r })),
  }, 'streamerbot');

  test('solo el aviso de bomba, con la lista: igual que los regalos sueltos', async () => {
    await handleEvent(bomba('luis', 3, ['a1', 'a2', 'a3']));
    await esperar(80);
    assert.equal(enviados.filter((t) => t.includes('regala 3 subs')).length, 1);
    assert.equal(objetos('luis').length, 3);
    for (const r of ['a1', 'a2', 'a3']) assert.equal(objetos(r).length, 1, r);
    assert.equal(objetos('id-del-aviso').length, 0, 'el id del aviso no es nadie');
  });

  test('sin lista de receptores: se premia a quien regala y se dice cuántas', async () => {
    await handleEvent(bomba('luis', 2));
    await esperar(80);
    assert.match(enviados[0]!, /^🎁 ¡luis regala 2 subs! luis se lleva 2 cofres del tesoro/);
    assert.equal(objetos('luis').length, 2);
  });

  test('bomba y avisos sueltos de la misma: no se cuenta dos veces', async () => {
    await handleEvent(bomba('luis', 3, ['a1', 'a2', 'a3']));
    for (const r of ['a1', 'a2', 'a3']) await handleEvent(regalo('luis', r, 3));
    await esperar(80);
    assert.equal(enviados.filter((t) => t.includes('regala')).length, 1);
    assert.equal(objetos('luis').length, 3);
    for (const r of ['a1', 'a2', 'a3']) assert.equal(objetos(r).length, 1, `${r}: un cofre, no dos`);
  });

  test('en una prueba del panel la lluvia no reparte a la gente de verdad', async () => {
    loot.setChatters(async () => [{ id: 'id-real', login: 'real', displayName: 'real', isBroadcaster: false, isModerator: false, isVip: false, isSubscriber: false, rawRole: null }]);
    await handleEvent(normalize('Twitch.GiftBomb', { userId: 'id-luis', userName: 'luis', displayName: 'luis', gifts: 6 }, 'simulator'));
    await esperar(80);
    assert.ok(enviados.some((t) => t.includes('Es una prueba')));
    assert.equal(objetos('real').length, 0);
  });
});

describe('⚔️ S3 · raid entrante', () => {
  test('cofre para quien la trae y, con 3 o más, un jefe a los pocos segundos', async () => {
    streams.open();
    await handleEvent(raid('otrocanal', 8));
    assert.match(enviados[0]!, /^⚔️ ¡Llega una incursión de otrocanal con 8 personas! Cofre del tesoro para @otrocanal/);
    assert.match(enviados[0]!, /En 30 s aparece un jefe/);
    assert.equal(objetos('otrocanal').length, 1);
    await esperar(60);
    assert.ok(jefe.hayJefe(), 'ha aparecido el jefe');
  });

  test('una raid pequeña, o sin directo, no trae jefe', async () => {
    streams.open();
    await handleEvent(raid('amigo', 2));
    await esperar(60);
    assert.equal(jefe.hayJefe(), false);
    assert.doesNotMatch(enviados[0]!, /jefe/);
  });
});

describe('💎 S7 · bits', () => {
  test('con jefe: golpes que pegan aunque estés atrapado; 500 con crítico', async () => {
    await jefe.invocar({ tipo: 'tanque' });
    const antes = jefe.paraOverlay().jefe!.vida;
    await handleEvent(bits('pepe', 500));
    const j = jefe.paraOverlay().jefe;
    assert.match(enviados.at(-1)!, /^💎 ¡pepe lanza 500 bits contra el Tanque que no sabe tanquear: 5 golpes con crítico/);
    if (j) {
      assert.ok(j.vida < antes);
      assert.equal(j.golpes.filter((g) => g.icono === '💎').length, 5);
      assert.ok(j.golpes.some((g) => g.critico));
    }
  });

  test('sin jefe: desde 300, un cofre; con menos, nada', async () => {
    await handleEvent(bits('pepe', 100));
    assert.equal(objetos('pepe').length, 0);
    await handleEvent(bits('pepe', 300));
    assert.equal(objetos('pepe').length, 1);
    assert.match(enviados.at(-1)!, /^💎 ¡Gracias por los 300 bits, @pepe! Cofre del tesoro → /);
  });
});

describe('💜 S4-S6 · marca, mochila y colección de mecenas', () => {
  const msg = (login: string, texto: string, subBadge: boolean) => normalize('Twitch.ChatMessage', {
    messageId: `m-${Math.random()}`, text: texto, meta: { firstMessage: false, returningChatter: false },
    user: { id: `id-${login}`, login, name: login, role: 1, badges: subBadge ? [{ name: 'subscriber', version: '6' }] : [], subscribed: subBadge },
  }, 'streamerbot');

  test('la insignia del chat basta para ser sub: 💜 en !poder y en !top', async () => {
    lootDb.dar('id-ana', 'ana', { objeto: 'Mapa arrugado', rareza: 'comun' }, 'cofre');
    await handleEvent(msg('ana', '!poder', true));
    assert.match(enviados.at(-1)!, /^@ana 💜 ⚔️ Poder 1.* · 💜 suscriptor/);
    await handleEvent(msg('ana', '!top', true));
    assert.match(enviados.at(-1)!, /🥇 ana 💜 ⚔️ 1/);
    // Si deja de serlo, la insignia lo dice.
    cooldowns.reset();
    await handleEvent(msg('ana', 'hola', false));
    assert.equal(suscriptores.esSub('id-ana'), false);
  });

  test('mochila de 30 para los subs, de 20 para el resto', () => {
    suscriptores.apuntar('id-ana', 1);
    for (let i = 0; i < 30; i++) lootDb.dar('id-ana', 'ana', { objeto: OBJETOS.comun[i % OBJETOS.comun.length]!, rareza: 'comun' }, 'cofre');
    for (let i = 0; i < 30; i++) lootDb.dar('id-luis', 'luis', { objeto: OBJETOS.comun[i % OBJETOS.comun.length]!, rareza: 'comun' }, 'cofre');
    assert.equal(lootDb.contar('id-ana'), 30);
    assert.equal(lootDb.contar('id-luis'), 20);
  });

  test('los de mecenas no cuentan para las colecciones de rareza, y los seis dan su título', () => {
    for (const m of OBJETOS_MECENAS.slice(0, 5)) lootDb.dar('id-ana', 'ana', m, 'suscriptor');
    assert.equal(lootDb.coleccion('id-ana').porRareza.raro.tiene, 0, 'no inflan la de raros');
    assert.equal(lootDb.titulo('id-ana'), null);
    const r = lootDb.dar('id-ana', 'ana', OBJETOS_MECENAS[5]!, 'suscriptor');
    assert.equal(r.tituloNuevo, TITULO_MECENAS);
    assert.ok(OBJETOS_MECENAS.every((m) => esMecenas(m.objeto)));
  });

  test('!olvidame también borra que es sub', async () => {
    await handleEvent(sub('ana'));
    consent.olvidar('id-ana');
    assert.equal(suscriptores.esSub('id-ana'), false);
  });
});
