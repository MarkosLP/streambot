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
import * as engine from '../../core/engine.js';
import * as lootDb from '../../data/loot.js';
import * as loot from './index.js';
import * as comandos from './comandos.js';
import * as consent from '../../core/consent.js';
import * as arena from './arena.js';
import * as progresion from './progresion.js';
import { MOCHILA_MAX, OBJETOS, type Rareza } from './objetos.js';

/**
 * Para qué sirve el botín: mochila de 20, forja, poder, duelos, presumir y
 * colección con títulos (decidido el 25 sep 2026).
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

const dar = (login: string, rareza: Rareza, n = 1, objeto?: string) => {
  for (let i = 0; i < n; i++) {
    lootDb.dar(`id-${login}`, login, { objeto: objeto ?? OBJETOS[rareza][i % OBJETOS[rareza].length]!, rareza }, 'cofre');
  }
};

const fijo = (v: number) => () => v;

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

const esperarPantalla = () => new Promise((r) => setTimeout(r, 10));

describe('mochila de 20', () => {
  test('con sitio, entra todo', () => {
    dar('pepe', 'comun', MOCHILA_MAX);
    assert.equal(lootDb.contar('id-pepe'), MOCHILA_MAX);
  });

  test('llena, lo igual o mejor sustituye a lo peor y más antiguo', () => {
    dar('pepe', 'raro', MOCHILA_MAX - 1);
    dar('pepe', 'comun', 1, 'Espada oxidada');
    const r = lootDb.dar('id-pepe', 'pepe', { objeto: 'Capa de las Sombras', rareza: 'epico' }, 'cofre');
    assert.equal(r.guardado, true);
    assert.deepEqual(r.sustituido, { objeto: 'Espada oxidada', rareza: 'comun' });
    assert.equal(lootDb.contar('id-pepe'), MOCHILA_MAX);
  });

  test('llena, lo peor se queda en el suelo… pero cuenta para la colección', () => {
    dar('pepe', 'raro', MOCHILA_MAX);
    const r = lootDb.dar('id-pepe', 'pepe', { objeto: 'Mapa arrugado', rareza: 'comun' }, 'cofre');
    assert.equal(r.guardado, false);
    assert.equal(r.nuevoEnColeccion, true);
    assert.equal(lootDb.inventario('id-pepe').porRareza.comun, 0);
  });

  test('el anuncio del cofre lo cuenta', async () => {
    dar('pepe', 'epico', MOCHILA_MAX);
    await handleEvent(mensaje('pepe'));
    await loot.soltarCofre({ azar: fijo(0) });
    assert.match(enviados.at(-1)!, /pepe( «.+»)? → ⚪ .+ \(mochila llena: se queda en el suelo\)/);
  });
});

describe('!forjar', () => {
  test('3 comunes → 1 raro, y sale en pantalla', async () => {
    dar('pepe', 'comun', 3);
    await handleEvent(mensaje('pepe', '!forjar'));
    await esperarPantalla();
    const inv = lootDb.inventario('id-pepe');
    assert.equal(inv.porRareza.comun, 0);
    assert.equal(inv.porRareza.raro, 1);
    assert.match(enviados[0]!, /^🔨 @pepe funde 3 ⚪ y forja → 🔵 /);
    assert.deepEqual(enPantalla, ['pepe|raro|forja']);
  });

  test('se puede elegir la rareza', async () => {
    dar('pepe', 'comun', 3);
    dar('pepe', 'raro', 3);
    await handleEvent(mensaje('pepe', '!forjar raros'));
    const inv = lootDb.inventario('id-pepe');
    assert.equal(inv.porRareza.comun, 3, 'los comunes no se tocan');
    assert.equal(inv.porRareza.epico, 1);
  });

  test('sin bastantes, explica cuántos hacen falta y no quita nada', async () => {
    dar('pepe', 'comun', 2);
    await handleEvent(mensaje('pepe', '!forjar'));
    assert.match(enviados[0]!, /hacen falta 3 objetos de la misma rareza \(tienes 2⚪ 0🔵 0🟣\)/);
    assert.equal(lootDb.contar('id-pepe'), 2);
  });

  test('los Legendarios no se forjan', async () => {
    dar('pepe', 'legendario', 3);
    await handleEvent(mensaje('pepe', '!forjar'));
    assert.equal(lootDb.inventario('id-pepe').porRareza.legendario, 3);
  });

  test('forjar deja sitio: con la mochila llena también funciona', async () => {
    dar('pepe', 'comun', MOCHILA_MAX);
    await handleEvent(mensaje('pepe', '!forjar'));
    assert.equal(lootDb.contar('id-pepe'), MOCHILA_MAX - 2);
  });
});

describe('!poder y !duelo', () => {
  test('el poder suma según la rareza', async () => {
    dar('pepe', 'comun', 2);
    dar('pepe', 'legendario', 1);
    await handleEvent(mensaje('pepe', '!poder'));
    assert.match(enviados[0]!, /^@pepe ⚔️ Poder 22 \(2⚪×1 \+ 1🟠×20\) · puesto 1 de 1/);
  });

  test('la probabilidad es proporcional, entre el 20 y el 80 %', () => {
    assert.equal(comandos.probabilidad(10, 10), 0.5);
    assert.equal(comandos.probabilidad(1, 100), 0.2);
    assert.equal(comandos.probabilidad(100, 1), 0.8);
  });

  test('el poder explica cuándo una pieza maldita cuenta doble', async () => {
    lootDb.dar('id-pepe', 'pepe', { objeto: 'Anillo de plata encantado', rareza: 'raro', maldito: true }, 'maldicion');
    await handleEvent(mensaje('pepe', '!poder'));
    assert.match(enviados[0]!, /Poder 6 \(1🔵×3; 1 maldito cuenta doble\)/);
  });

  test('un duelo tiene ganador y se apunta', async () => {
    dar('pepe', 'epico', 1);
    dar('ana', 'comun', 1);
    await handleEvent(mensaje('ana'));
    await engine.run(comandos.duelo, { viewer: { id: 'id-pepe', login: 'pepe', displayName: 'pepe' } as any, trigger: 'command', args: '@ana', azar: fijo(0) });
    assert.match(enviados[0]!, /^⚔️ @pepe \(poder 8, 80 %\) reta a @ana \(poder 1, 20 %\)\. La suerte decide: ¡Gana pepe! \+5 de temporada$/);
    assert.deepEqual(lootDb.duelos('id-pepe'), { ganados: 1, perdidos: 0 });
    assert.deepEqual(lootDb.duelos('id-ana'), { ganados: 0, perdidos: 1 });
    const registrado = arena.paraPanel()[0]!;
    assert.equal(registrado.retador.poder, 8);
    assert.equal(registrado.rival.poder, 1);
    assert.equal(registrado.prob, 0.8);
    assert.equal(registrado.tirada, 0);
    assert.equal(registrado.ganaRetador, true);
  });

  test('el panel deja de mostrar un duelo si alguien pide el olvido', async () => {
    dar('pepe', 'comun', 1);
    dar('ana', 'comun', 1);
    await handleEvent(mensaje('ana'));
    await engine.run(comandos.duelo, { viewer: { id: 'id-pepe', login: 'pepe', displayName: 'pepe' } as any, trigger: 'command', args: 'ana', azar: fijo(0) });
    assert.equal(arena.paraPanel().length, 1);
    consent.olvidar('id-ana');
    assert.equal(arena.paraPanel().length, 0);
  });

  test('la revisión de progresión enseña la opción mínima del nuevo jugador', () => {
    dar('pepe', 'legendario', 1);
    dar('ana', 'comun', 1);
    const p = progresion.estado();
    assert.equal(p.jugadores, 2);
    assert.equal(p.mediana, 10.5);
    assert.equal(p.nuevoContraLider, 0.2);
  });

  test('el débil puede ganar, y se nota', async () => {
    dar('pepe', 'comun', 1);
    dar('ana', 'legendario', 1);
    await handleEvent(mensaje('ana'));
    await engine.run(comandos.duelo, { viewer: { id: 'id-pepe', login: 'pepe', displayName: 'pepe' } as any, trigger: 'command', args: 'ana', azar: fijo(0.1) });
    assert.match(enviados[0]!, /¡Gana pepe! ¡Sorpresa!/);
  });

  test('solo a quien está en el chat', async () => {
    dar('pepe', 'comun', 1);
    dar('ana', 'comun', 1);
    await handleEvent(mensaje('pepe', '!duelo @ana'));
    assert.match(enviados[0]!, /No veo a ana por el chat/);
  });

  test('al dueño del canal también se le puede retar', async () => {
    dar('pepe', 'comun', 1);
    dar('crid4m', 'comun', 1);
    await handleEvent(mensaje('crid4m', 'buenas'));
    await handleEvent(mensaje('pepe', '!duelo @crid4m'));
    assert.match(enviados[0]!, /reta a @crid4m/);
  });

  test('ni a uno mismo ni con la mochila vacía', async () => {
    await handleEvent(mensaje('pepe', '!duelo @pepe'));
    assert.match(enviados[0]!, /a ti mismo/);
    await handleEvent(mensaje('ana'));
    cooldowns.reset();
    await handleEvent(mensaje('pepe', '!duelo @ana'));
    assert.match(enviados[1]!, /mochila vacía/);
  });
});

describe('!presumir', () => {
  test('tu mejor pieza sale en pantalla y en el chat', async () => {
    dar('pepe', 'comun', 2);
    dar('pepe', 'epico', 1, 'Corona del Liche');
    await handleEvent(mensaje('pepe', '!presumir'));
    await esperarPantalla();
    assert.equal(enviados[0], '💪 @pepe presume de 🟣 Corona del Liche');
    assert.deepEqual(enPantalla, ['pepe|epico|presumir']);
  });

  test('una vez cada 10 minutos por persona', async () => {
    dar('pepe', 'comun', 1);
    await handleEvent(mensaje('pepe', '!presumir'));
    await handleEvent(mensaje('pepe', '!presumir'));
    assert.equal(enviados.length, 1);
  });
});

describe('!coleccion y títulos', () => {
  test('cuenta objetos distintos, no repetidos', async () => {
    dar('pepe', 'comun', 3, 'Espada oxidada');
    dar('pepe', 'raro', 1);
    await handleEvent(mensaje('pepe', '!coleccion'));
    // Con el tamaño real del catálogo: cambia cada vez que se añaden objetos.
    const n = (r: Rareza) => OBJETOS[r].length;
    const de = n('comun') + n('raro') + n('epico') + n('legendario');
    assert.ok(
      enviados[0]!.startsWith(`@pepe 📖 Colección 2/${de}: ⚪ 1/${n('comun')} 🔵 1/${n('raro')} 🟣 0/${n('epico')} 🟠 0/${n('legendario')} · Completa una rareza`),
      enviados[0],
    );
  });

  test('lo forjado o tirado sigue en la colección', async () => {
    dar('pepe', 'comun', 3);
    await handleEvent(mensaje('pepe', '!forjar'));
    assert.equal(lootDb.coleccion('id-pepe').porRareza.comun.tiene, 3);
  });

  test('completar una rareza da su título, y se anuncia', async () => {
    const todos = OBJETOS.comun;
    todos.slice(0, -1).forEach((o) => lootDb.dar('id-pepe', 'pepe', { objeto: o, rareza: 'comun' }, 'cofre'));
    const r = lootDb.dar('id-pepe', 'pepe', { objeto: todos.at(-1)!, rareza: 'comun' }, 'cofre');
    assert.equal(r.tituloNuevo, 'Trotamundos');
    assert.equal(lootDb.titulo('id-pepe'), 'Trotamundos');

    await handleEvent(mensaje('pepe'));
    await loot.soltarCofre({ azar: fijo(0) });
    assert.match(enviados.at(-1)!, /pepe «Trotamundos» → /, 'el título va junto al nombre');
  });
});

describe('!loot y el olvido', () => {
  test('!loot explica los comandos', async () => {
    await handleEvent(mensaje('pepe', '!loot'));
    assert.match(enviados[0]!, /!inventario !poder !duelo nombre !dar nombre !usar !forjar !presumir !coleccion/);
    assert.ok(enviados[0]!.length <= 500, 'la ayuda cabe en un mensaje de Twitch');
  });

  test('!olvidame borra mochila, colección y duelos', async () => {
    dar('pepe', 'comun', 2);
    lootDb.apuntarDuelo('id-pepe', 'id-ana');
    await handleEvent(mensaje('pepe', '!olvidame'));
    for (const tabla of ['loot', 'coleccion']) {
      const n = getDb().prepare(`SELECT COUNT(*) AS n FROM ${tabla} WHERE twitch_id = 'id-pepe'`).get() as { n: number };
      assert.equal(n.n, 0, tabla);
    }
    assert.deepEqual(lootDb.duelos('id-pepe'), { ganados: 0, perdidos: 0 });
  });
});
