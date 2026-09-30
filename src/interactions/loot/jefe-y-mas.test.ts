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
import * as interactionLog from '../../data/interactions.js';
import * as loot from './index.js';
import * as jefe from './jefe.js';
import * as arena from './arena.js';
import { ESPECIALES } from './especiales.js';
import { NOMBRES_USABLES, tirarMaldito, type Rareza } from './objetos.js';
import { USABLES } from './comandos.js';

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

describe('⚡ sentencia del dueño del canal', () => {
  test('deja al jefe con 1 de vida; el siguiente ataque lo derrota y conserva el botín del chat', async () => {
    await jefe.invocar({ tipo: 'tanque', azar: () => 0 });
    const vida = jefe.estado()!.vida;
    await handleEvent(mensaje(config.broadcasterLogin, '!sentencia'));
    assert.equal(jefe.estado()!.vida, 1);
    assert.equal(lootDb.recientes(10).length, 0, 'sentenciar no mata ni reparte');
    assert.deepEqual(jefe.estado()!.atacantes, [], 'el daño administrativo no roba el MVP');
    const visual = jefe.paraOverlay().jefe!;
    assert.equal(visual.golpes.at(-1)!.dano, vida - 1);
    assert.equal(visual.especial!.titulo, 'Sentencia del canal');
    assert.match(enviados.at(-1)!, /SENTENCIA.*1 de vida/);
    await handleEvent(mensaje('ana', '!atacar'));
    assert.equal(jefe.estado(), null);
    assert.match(enviados.at(-1)!, /ha caído! MVP ana/);
    assert.equal(lootDb.recientes(10).length, 1);
  });

  test('un espectador o moderador no puede usarla, aunque copie el nombre visible del canal', async () => {
    await jefe.invocar({ tipo: 'liche', azar: () => 0 });
    const vida = jefe.estado()!.vida;
    await handleEvent(mensaje('ana', '!sentencia'));
    const evento = mensaje('mod', '!auntoque');
    if (evento.type !== 'viewer.message') throw Error('Mensaje esperado');
    evento.viewer.isModerator = true;
    evento.viewer.isBroadcaster = true;
    evento.viewer.displayName = config.broadcasterLogin;
    await handleEvent(evento);
    assert.equal(jefe.estado()!.vida, vida);
    assert.equal(jefe.paraOverlay().jefe!.golpes.length, 0);
  });

  test('el alias funciona una vez por jefe y no actúa sin jefe ni con el Loot apagado', async () => {
    await handleEvent(mensaje(config.broadcasterLogin, '!sentencia'));
    assert.equal(enviados.length, 0);
    await jefe.invocar({ tipo: 'liche', azar: () => 0 });
    const vida = jefe.estado()!.vida;
    ajustes.setLootActivo(false, 'test');
    await handleEvent(mensaje(config.broadcasterLogin, '!sentencia'));
    assert.equal(jefe.estado()!.vida, vida);
    ajustes.setLootActivo(true, 'test');
    await handleEvent(mensaje(config.broadcasterLogin, '!auntoque'));
    assert.equal(jefe.estado()!.vida, 1);
    const mensajes = enviados.length;
    await handleEvent(mensaje(config.broadcasterLogin, '!sentencia'));
    assert.equal(enviados.length, mensajes);
    assert.equal(jefe.paraOverlay().jefe!.golpes.length, 1);
    jefe.retirar();
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

describe('🔥 cofre de fidelidad', () => {
  const online = () => normalize('Twitch.StreamOnline', {}, 'simulator');
  const offline = () => normalize('Twitch.StreamOffline', {}, 'simulator');

  /** ana viene a N directos seguidos, un mensaje (o varios) en cada uno. */
  async function directos(n: number, mensajes = 1) {
    for (let i = 0; i < n; i++) {
      await handleEvent(online());
      for (let m = 0; m < mensajes; m++) await handleEvent(mensaje('ana', `hola ${m}`));
      await handleEvent(offline());
    }
  }

  test('desde el tercer directo seguido, un cofre en el primer mensaje de cada directo', async () => {
    await directos(2);
    assert.equal(objetos('ana').length, 0, 'dos seguidos: todavía no');
    await directos(1, 3);
    assert.equal(objetos('ana').length, 1, 'al tercero, uno (aunque escriba tres veces)');
    assert.match(enviados.at(-1)!, /^🔥 @ana, 3 directos seguidos: ¡cofre de fidelidad! → /);
    assert.equal(lootDb.recientes(1)[0]!.origen, 'fidelidad');
    await directos(1);
    assert.equal(objetos('ana').length, 2, 'y otro al cuarto');
  });

  test('con el Loot apagado, no cae', async () => {
    ajustes.setLootActivo(false, 'test');
    await directos(3);
    assert.equal(objetos('ana').length, 0);
  });

  test('las rachas se cuentan aunque las espontáneas estén apagadas', async () => {
    ajustes.setInteraccionesEspontaneas(false, 'test');
    await directos(3);
    assert.equal(objetos('ana').length, 1);
  });
});

describe('🏆 !top poder', () => {
  test('los tres con más poder, y tu puesto si no estás', async () => {
    meter('ana', 'Filo del Vacío', 'legendario');
    meter('luis', 'Capa de las Sombras', 'epico');
    meter('pepe', 'Arco de tejo élfico', 'raro');
    meter('marta', 'Mapa arrugado', 'comun');
    await handleEvent(mensaje('marta', '!top poder'));
    assert.equal(enviados.at(-1), '⚔️ Top poder: 🥇 ana ⚔️ 20 · 🥈 luis ⚔️ 8 · 🥉 pepe ⚔️ 3 · Tú: puesto 4 de 4');
    cooldowns.reset();
    await handleEvent(mensaje('ana', '!ranking poder'));
    assert.doesNotMatch(enviados.at(-1)!, /Tú:/, 'si estás en el podio, no se repite');
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
  test('!dar solo explica cómo se usa y enseña tus objetos numerados', async () => {
    meter('pepe', 'Arco de tejo élfico', 'raro');
    meter('pepe', 'Mapa arrugado', 'comun');
    await handleEvent(mensaje('pepe', '!dar'));
    assert.equal(
      enviados.at(-1),
      '@pepe 🎁 Para regalar: !dar nombre número. Tus objetos: 1 ⚪ Mapa arrugado · 2 🔵 Arco de tejo élfico',
    );
    assert.equal(objetos('pepe').length, 2, 'no regala nada');
  });

  test('!dar ana sin decir qué pregunta, y !dar ana 2 le da el número 2', async () => {
    meter('pepe', 'Arco de tejo élfico', 'raro');
    meter('pepe', 'Mapa arrugado', 'comun');
    await handleEvent(mensaje('ana'));
    await handleEvent(mensaje('pepe', '!dar @ana'));
    assert.match(enviados.at(-1)!, /¿Qué le das a ana\? Escribe !dar ana y el número: 1 ⚪ Mapa arrugado · 2 🔵 Arco/);
    assert.equal(objetos('ana').length, 0, 'preguntar no regala');

    // Justo después de mirar la lista se puede regalar: no espera 30 s.
    cooldowns.reset();
    await handleEvent(mensaje('pepe', '!dar ana 2'));
    assert.match(enviados.at(-1)!, /^🎁 @pepe le regala 🔵 Arco de tejo élfico a @ana/);
    assert.deepEqual(objetos('ana'), ['Arco de tejo élfico']);
    assert.deepEqual(objetos('pepe'), ['Mapa arrugado']);
    assert.equal(lootDb.coleccion('id-ana').total, 1, 'cuenta para su colección');
  });

  test('un número que no existe lo dice', async () => {
    meter('pepe', 'Mapa arrugado', 'comun');
    await handleEvent(mensaje('ana'));
    await handleEvent(mensaje('pepe', '!dar ana 7'));
    assert.match(enviados.at(-1)!, /No tienes el número 7: van del 1 al 1/);
  });

  test('también por rareza o por parte del nombre, sin tildes', async () => {
    meter('pepe', 'Mapa arrugado', 'comun');
    meter('pepe', 'Capa de las Sombras', 'epico');
    meter('pepe', 'Báculo de la Tormenta', 'epico');
    await handleEvent(mensaje('ana'));
    await handleEvent(mensaje('pepe', '!dar ana baculo'));
    cooldowns.reset();
    await handleEvent(mensaje('pepe', '!dar ana épico'));
    assert.deepEqual(objetos('ana').sort(), ['Báculo de la Tormenta', 'Capa de las Sombras']);
  });

  test('los malditos no se regalan, ni se da a quien no está; al canal, sí', async () => {
    meter('pepe', 'Filo del Vacío', 'legendario', true);
    await handleEvent(mensaje('ana'));
    await handleEvent(mensaje(config.broadcasterLogin));
    await handleEvent(mensaje('pepe', '!dar ana'));
    assert.match(enviados.at(-1)!, /No tienes nada que regalar \(los objetos malditos no se regalan\)/);
    meter('pepe', 'Mapa arrugado', 'comun');
    cooldowns.reset();
    await handleEvent(mensaje('pepe', '!dar fantasma 1'));
    assert.match(enviados.at(-1)!, /No veo a fantasma/);
    cooldowns.reset();
    await handleEvent(mensaje('pepe', `!dar ${config.broadcasterLogin} 1`));
    assert.match(enviados.at(-1)!, /le regala ⚪ Mapa arrugado a @/, 'al canal sí se le puede dar');
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

  test('un objeto maldito nunca es de los que se usan (sería un objeto muerto)', () => {
    for (let i = 0; i < 2000; i++) {
      const b = tirarMaldito();
      assert.ok(b.maldito);
      assert.ok(!NOMBRES_USABLES.includes(b.objeto), b.objeto);
    }
    // Y la lista de nombres cuadra con la de !usar.
    assert.deepEqual([...NOMBRES_USABLES].sort(), Object.keys(USABLES).sort());
  });

  test('un objeto normal no hace nada, y lo dice', async () => {
    meter('pepe', 'Mapa arrugado', 'comun');
    await handleEvent(mensaje('pepe', '!usar mapa'));
    assert.match(enviados.at(-1)!, /no hace nada al usarlo/);
  });
});

describe('💥 ataques especiales del jefe', () => {
  /** Pega hasta que el jefe lance su especial (baja del 60 %). */
  async function hastaElEspecial(quien = 'ana') {
    let n = 0;
    while (jefe.paraOverlay().jefe && !jefe.paraOverlay().jefe!.especial && n++ < 100) {
      cooldowns.reset();
      await handleEvent(mensaje(quien, '!atacar'));
    }
    return jefe.paraOverlay().jefe!;
  }

  test('la araña atrapa: el siguiente !atacar no llega, y el overlay lo enseña', async () => {
    await jefe.invocar({ tipo: 'arana', azar: () => 0 });
    const j = await hastaElEspecial();
    assert.equal(j.especial!.titulo, 'Telaraña');
    assert.match(enviados.at(-1)!, /atrapa a ana en su telaraña/);
    assert.deepEqual(j.afectados.map((a) => [a.quien, a.icono]), [['ana', '🕸️']]);
    const vida = j.vida;
    cooldowns.reset();
    await handleEvent(mensaje('ana', '!atacar'));
    const despues = jefe.paraOverlay().jefe!;
    assert.equal(despues.vida, vida, 'atrapada, no quita vida');
    assert.equal(despues.golpes.at(-1)!.tipo, 'bloqueado');
    assert.equal(despues.golpes.at(-1)!.texto, '¡ATRAPADO!');
  });

  test('el esqueleto se cura, y nunca por encima del máximo', async () => {
    await jefe.invocar({ tipo: 'esqueleto', azar: () => 0 });
    const antes = jefe.paraOverlay().jefe!.vidaMax;
    const j = await hastaElEspecial();
    assert.equal(j.golpes.at(-1)!.tipo, 'cura');
    assert.ok(j.vida <= antes);
    assert.match(enviados.at(-1)!, /alza a los muertos y recupera \d+ de vida/);
  });

  test('la vomitona: todos fallan su siguiente golpe, y después vuelven a pegar', async () => {
    await jefe.invocar({ tipo: 'minotauro', azar: () => 0 });
    await hastaElEspecial();
    const vida = jefe.paraOverlay().jefe!.vida;
    const aciertosAntes = jefe.paraOverlay().jefe!.golpesAcertados;
    cooldowns.reset();
    await handleEvent(mensaje('ana', '!atacar'));
    assert.equal(jefe.paraOverlay().jefe!.golpes.at(-1)!.tipo, 'fallo');
    assert.equal(jefe.paraOverlay().jefe!.vida, vida);
    const acertadosTrasFallo = jefe.paraOverlay().jefe!.golpesAcertados;
    assert.equal(acertadosTrasFallo, aciertosAntes);
    cooldowns.reset();
    await handleEvent(mensaje('ana', '!atacar'));
    assert.equal(jefe.paraOverlay().jefe!.golpesAcertados, acertadosTrasFallo + 1);
    assert.ok(jefe.paraOverlay().jefe!.vida < vida, 'el siguiente, sí');
  });

  test('la hidra envenena: pega la mitad', async () => {
    await jefe.invocar({ tipo: 'hidra', azar: () => 0 });
    await hastaElEspecial();
    const vida = jefe.paraOverlay().jefe!.vida;
    cooldowns.reset();
    await handleEvent(mensaje('ana', '!atacar'));
    const j = jefe.paraOverlay().jefe!;
    const g = j.golpes.at(-1)!;
    assert.equal(g.icono, '🐍');
    assert.equal(vida - j.vida, g.dano);
    // Sin poder, un golpe va de 6 a 15 (30 con crítico): envenenada, la mitad.
    assert.ok(g.dano >= 3 && g.dano <= 15, String(g.dano));
    assert.deepEqual(j.afectados.map((a) => a.icono), ['🐍']);
  });

  test('el tanque se pega solo; y el especial sale una sola vez por combate', async () => {
    await jefe.invocar({ tipo: 'tanque', azar: () => 0 });
    const j = await hastaElEspecial();
    assert.equal(j.golpes.at(-1)!.tipo, 'propio');
    const especiales = () => enviados.filter((t) => t.includes('se da con su propio escudo')).length;
    let n = 0;
    while (jefe.estado() && n++ < 100) {
      cooldowns.reset();
      await handleEvent(mensaje('ana', '!atacar'));
    }
    assert.equal(especiales(), 1);
  });

  test('todos los jefes tienen su especial', () => {
    for (const j of jefe.JEFES) assert.ok(ESPECIALES[j.tipo], j.tipo);
  });
});

describe('⚔️ el duelo en el overlay', () => {
  test('cada duelo queda para el overlay: quién, su poder, la probabilidad y quién ganó', async () => {
    meter('pepe', 'Arco de tejo élfico', 'raro');
    meter('ana', 'Mapa arrugado', 'comun');
    await handleEvent(mensaje('ana'));
    await handleEvent(mensaje('pepe', '!duelo ana'));
    const d = arena.recientes().at(-1)!;
    assert.equal(d.retador.nombre, 'pepe');
    assert.equal(d.retador.poder, 3);
    assert.equal(d.rival.nombre, 'ana');
    assert.equal(d.rival.poder, 1);
    assert.equal(d.prob, 0.75);
    assert.equal(typeof d.ganaRetador, 'boolean');
    assert.match(enviados.at(-1)!, d.ganaRetador ? /¡Gana pepe!/ : /¡Gana ana!/, 'el chat y el overlay dicen lo mismo');
  });
});

describe('🐉 jefe de raid', () => {
  test('vida según la gente que habla; cae, y reparte con Cofre del tesoro para el MVP', async () => {
    await handleEvent(mensaje('ana'));
    await handleEvent(mensaje('luis'));
    const r = await jefe.invocar({ azar: () => 0 });
    assert.ok(r.ok);
    assert.equal(r.vida, 2 * jefe.VIDA_POR_PERSONA);
    assert.ok(enviados.at(-1)!.startsWith(`🐉 ¡Aparece el Dragón de Escarcha con ${2 * jefe.VIDA_POR_PERSONA} de vida!`), enviados.at(-1));

    // Ataques silenciosos hasta la mitad; luego un aviso; luego la caída.
    let vueltas = 0;
    while (jefe.estado() && vueltas++ < 100) {
      cooldowns.reset();
      await handleEvent(mensaje(vueltas % 3 ? 'ana' : 'luis', '!atacar'));
    }
    assert.equal(jefe.estado(), null, 'ha caído');
    assert.equal(enviados.length, 4, 'aparece, especial, mitad y final: nada más');
    assert.match(enviados[1]!, /^❄️ ¡El Dragón de Escarcha lanza su aliento helado! (ana|luis) se queda congelado/);
    assert.match(enviados[2]!, /está a la mitad/);
    assert.match(enviados[3]!, /^🏆 ¡El Dragón de Escarcha ha caído! MVP (ana|luis)/);
    const deAna = lootDb.recientes(10).filter((f) => f.twitch_id === 'id-ana');
    assert.equal(deAna.length, 1);
    assert.equal(deAna[0]!.origen, 'jefe');
    assert.equal(objetos('luis').length, 1);
  });

  test('el canal pega y se lleva botín; con LOOT_CANAL_JUEGA=false, solo pega', async () => {
    ajustes.setCanalJuega(false, 'test');
    try {
      await jefe.invocar({ azar: () => 0, tipo: 'tanque' });
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
    const r = await jefe.invocar({ azar: () => 0, tipo: 'tanque' });
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
    await jefe.invocar({ azar: () => 0, tipo: 'tanque' });
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
    assert.match(enviados.at(-1)!, new RegExp(`se escapa con \\d+/${jefe.VIDA_POR_PERSONA} de vida\\. Quien más pegó: ana`));
    assert.equal(lootDb.recientes(10).length, 0);
  });

  test('si el mensaje final no sale, el registro lo dice (antes apuntaba «enviado» igual)', async () => {
    await jefe.invocar({ azar: () => 0, tipo: 'tanque' });
    for (let i = 0; i < config.respuestasPerHour; i++) policy.registerSent(Date.now(), true);
    let n = 0;
    while (jefe.estado() && n++ < 200) {
      cooldowns.reset();
      await handleEvent(mensaje('ana', '!atacar'));
    }
    const fila = interactionLog.all().filter((r) => r.interaction === 'loot-atacar').at(-1)!;
    assert.equal(fila.status, 'blocked');
    assert.match(fila.detail!, /^jefe derrotado, el Tanque que no sabe tanquear: ana=\d+ · el mensaje no salió/);
  });

  test('se puede elegir el jefe, y el overlay sabe cuál es para vestirlo', async () => {
    const r = await jefe.invocar({ tipo: 'arana' });
    assert.ok(r.ok && r.nombre === 'la Araña Reina');
    assert.equal(jefe.paraOverlay().jefe!.tipo, 'arana');
    jefe.retirar();
    const otro = await jefe.invocar({ tipo: 'no-existe', azar: () => 0 });
    assert.ok(otro.ok && otro.nombre === 'el Dragón de Escarcha', 'un tipo raro: al azar');
  });

  test('todos los jefes tienen su aspecto en el overlay', async () => {
    const { readFile } = await import('node:fs/promises');
    const html = await readFile(new URL('../../../biblioteca/overlays/jefe.html', import.meta.url), 'utf8');
    for (const j of jefe.JEFES) assert.match(html, new RegExp(`\n    ${j.tipo}: \{`), `falta el tema de ${j.tipo}`);
  });

  test('sin jefe, !atacar no contesta; y no se invocan dos a la vez', async () => {
    await handleEvent(mensaje('ana', '!atacar'));
    assert.equal(enviados.length, 0);
    await jefe.invocar();
    assert.equal((await jefe.invocar()).ok, false);
  });
});

// 28 sep 2026: el Terremoto solo hacía temblar la imagen.
describe('🌋 el Terremoto trae un jefe', () => {
  test('sin jefe, el suelo se abre y sale uno, en un solo mensaje', async () => {
    streams.open();
    await handleEvent(canje('ana', 'Terremoto'));
    assert.ok(jefe.hayJefe());
    assert.equal(enviados.length, 1);
    assert.match(enviados[0]!, /^🌋 ¡El terremoto de ana abre el suelo… 🐉 ¡Aparece .+ !atacar/);
  });

  test('con un jefe en pie, le cae el techo: un cuarto de su vida, a nombre de quien canjea', async () => {
    streams.open();
    await jefe.invocar();
    const { vidaMax } = jefe.estado()!;
    enviados = [];
    await handleEvent(canje('ana', 'Terremoto'));
    const e = jefe.estado()!;
    assert.equal(e.vida, vidaMax - Math.round(vidaMax * jefe.DERRUMBE));
    assert.deepEqual(e.atacantes, [{ quien: 'ana', dano: Math.round(vidaMax * jefe.DERRUMBE) }]);
    assert.match(enviados[0]!, /techo sobre .+: −\d+! Le quedan/);
  });

  test('si el derrumbe lo tumba, se reparte el botín en un segundo mensaje', async () => {
    streams.open();
    await jefe.invocar();
    for (let i = 0; i < 4 && jefe.hayJefe(); i++) await handleEvent(canje('ana', 'Terremoto'));
    assert.equal(jefe.hayJefe(), false);
    assert.match(enviados.at(-2)!, /techo sobre/);
    assert.ok(enviados.at(-1)!.length > 0);
    assert.doesNotMatch(enviados.at(-1)!, /techo sobre/);
  });

  test('sin directo marcado no sale jefe, y queda en el registro por qué', async () => {
    await handleEvent(canje('ana', 'Terremoto'));
    assert.equal(jefe.hayJefe(), false);
    assert.deepEqual(enviados, []);
    const fila = interactionLog.all().find((f) => f.interaction === jefe.NAME_TERREMOTO);
    assert.equal(fila?.detail, loot.SIN_DIRECTO_JEFE);
  });
});

// 28 sep 2026: el Lag no hacía nada en el Loot.
describe('📶 el Lag congela el tiempo', () => {
  test('con un jefe en pie, su reloj se para 30 s y luego se alarga lo mismo', async () => {
    streams.open();
    const t0 = Date.now();
    await jefe.invocar({ now: t0 });
    const antes = jefe.estado(t0)!.quedanSeg;
    enviados = [];
    await handleEvent(canje('ana', 'Lag'));
    assert.match(enviados[0]!, /^📶 ¡El lag de ana congela el tiempo! El reloj (del [A-ZÁÉÍÓÚ]|de la ).+ se para 30 s/);
    assert.doesNotMatch(enviados[0]!, /de el /);
    // Parado: pasen 10 s o 25 s, le queda lo mismo.
    const parado = jefe.estado(Date.now() + 10_000)!.quedanSeg;
    assert.equal(jefe.estado(Date.now() + 25_000)!.quedanSeg, parado);
    assert.ok(Math.abs(parado - antes) <= 1, `parado en ${parado}, tenía ${antes}`);
    // Al volver a andar, baja otra vez.
    assert.ok(jefe.estado(Date.now() + 40_000)!.quedanSeg < parado);
    assert.equal(jefe.paraOverlay(Date.now() + 10_000).jefe?.quedanSeg, parado);
  });

  test('sin jefe, el próximo cofre cae en 30 s', async () => {
    streams.open();
    await handleEvent(canje('ana', 'Lag'));
    assert.match(enviados[0]!, /^📶 ¡El lag de ana descoloca el reloj del servidor! El próximo cofre cae en 30 s/);
    assert.ok(loot.estado().proximoEnSeg! <= 30);
  });

  test('si el cofre ya iba a caer antes, no lo retrasa', async () => {
    streams.open();
    await handleEvent(canje('ana', 'Lag'));
    const primero = loot.estado().proximoEnSeg!;
    await handleEvent(canje('luis', 'Lag'));
    assert.ok(loot.estado().proximoEnSeg! <= primero);
  });

  test('sin directo marcado no hace nada, y queda en el registro por qué', async () => {
    await handleEvent(canje('ana', 'Lag'));
    assert.deepEqual(enviados, []);
    assert.equal(interactionLog.all().find((f) => f.interaction === 'loot-lag')?.detail, loot.SIN_DIRECTO_LAG);
  });
});
