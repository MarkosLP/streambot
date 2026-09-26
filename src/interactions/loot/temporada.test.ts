import { test, describe, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../../config.js';
import { configureDatabase, truncateAll, getDb } from '../../data/db.js';
import { normalize } from '../../core/events.js';
import { handleEvent } from '../../core/handler.js';
import { setSender } from '../../core/output.js';
import * as cooldowns from '../../core/cooldowns.js';
import * as policy from '../../core/policy.js';
import * as killswitch from '../../core/killswitch.js';
import * as ajustes from '../../core/ajustes.js';
import * as engine from '../../core/engine.js';
import * as streams from '../../data/streams.js';
import * as lootDb from '../../data/loot.js';
import * as temporadas from '../../data/temporadas.js';
import * as loot from './index.js';
import * as eventos from './eventos.js';
import * as temporada from './temporada.js';
import * as comandos from './comandos.js';

/**
 * Lo del 27 sep 2026: temporadas, el evento de la semana, !pj y !fundir.
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

const persona = (login: string) =>
  ({ id: `id-${login}`, login, displayName: login, isBroadcaster: false, isModerator: false, isVip: false, isSubscriber: false, rawRole: null });
const fijo = (v: number) => () => v;
const esperar = () => new Promise((r) => setTimeout(r, 15));
const SEPTIEMBRE = new Date(2026, 8, 15, 12);
const OCTUBRE = new Date(2026, 9, 2, 12);

before(() => configureDatabase(':memory:'));

beforeEach(() => {
  truncateAll();
  cooldowns.reset();
  policy.reset();
  killswitch.enable('test');
  ajustes.reset();
  ajustes.setInteraccionesEspontaneas(false, 'test');
  loot.reset();
  setSender(async (texto) => {
    enviados.push(texto);
  });
  enviados = [];
});

describe('🏆 temporadas', () => {
  test('cada objeto suma lo que vale su poder; el premio de temporada no', () => {
    lootDb.dar('id-ana', 'ana', { objeto: 'Filo del Vacío', rareza: 'legendario' }, 'cofre');
    lootDb.dar('id-ana', 'ana', { objeto: 'Mapa arrugado', rareza: 'comun', maldito: true }, 'maldicion');
    lootDb.dar('id-ana', 'ana', { objeto: 'Capa de las Sombras', rareza: 'epico' }, 'temporada');
    assert.equal(temporada.puestoActual('id-ana')?.puntos, 22);
  });

  test('!top es el podio del mes, sin el canal, y tu puesto si no estás', async () => {
    const mes = temporadas.deFecha();
    temporadas.sumar('id-ana', 'ana', 50);
    temporadas.sumar('id-luis', 'luis', 30);
    temporadas.sumar('id-canal', config.broadcasterLogin, 999);
    temporadas.sumar('id-pepe', 'pepe', 20);
    temporadas.sumar('id-marta', 'marta', 5);
    await handleEvent(mensaje('marta', '!top'));
    const texto = enviados.at(-1)!;
    assert.match(texto, new RegExp(`^🏆 Temporada de ${temporadas.nombre(mes)}`));
    assert.match(texto, /🥇 ana 50 · 🥈 luis 30 · 🥉 pepe 20 · Tú: 4º con 5/);
    assert.doesNotMatch(texto, new RegExp(config.broadcasterLogin, 'i'));
  });

  test('al cambiar de mes se cierra: podio al Salón de la Fama, premios y título', () => {
    temporadas.sumar('id-ana', 'ana', 80, SEPTIEMBRE);
    temporadas.sumar('id-luis', 'luis', 40, SEPTIEMBRE);
    temporadas.sumar('prueba-x', 'Prueba_x', 500, SEPTIEMBRE);
    temporadas.sumar('id-canal', config.broadcasterLogin, 900, SEPTIEMBRE);

    assert.equal(temporada.cerrarPendientes(OCTUBRE, fijo(0)), 1);
    assert.deepEqual(temporadas.podio('2026-09').map((p) => p.display_name), ['ana', 'luis']);
    assert.equal(lootDb.inventario('id-ana').porRareza.legendario, 1);
    assert.equal(lootDb.inventario('id-luis').porRareza.epico, 1);
    assert.match(lootDb.titulo('id-ana')!, /^Campeón de septiembre/);
    assert.equal(lootDb.titulo('id-luis'), null);
    // El premio no cuenta para la temporada nueva.
    assert.equal(temporadas.ranking('2026-10').length, 0);

    temporada.reset();
    assert.equal(temporada.cerrarPendientes(OCTUBRE), 0, 'no se cierra dos veces');
  });

  test('el primer mensaje del directo cuenta el final de la temporada y el evento, una sola vez', async () => {
    eventos.reset('fiebre-oro');
    temporadas.sumar('id-ana', 'ana', 80, new Date(2020, 0, 10));
    streams.open();
    await handleEvent(mensaje('ana'));
    await esperar();
    assert.equal(enviados.length, 2);
    assert.match(enviados[0]!, /^🏆 ¡Fin de la temporada de enero de 2020! 🥇 ana \(80\)/);
    assert.match(enviados[1]!, /^📅 Esta semana, 🪙 Fiebre del oro/);
    await handleEvent(mensaje('luis'));
    await esperar();
    assert.equal(enviados.length, 2);
    assert.deepEqual(temporadas.sinAnunciar(), []);
  });

  test('!olvidame borra los puntos de temporada', async () => {
    temporadas.sumar('id-ana', 'ana', 10);
    await handleEvent(mensaje('ana', '!olvidame'));
    assert.equal(temporada.puestoActual('id-ana'), null);
  });
});

describe('📅 evento de la semana', () => {
  test('rota cada lunes y es el mismo toda la semana', () => {
    const lunes = eventos.porRotacion(new Date(2026, 8, 28, 9));
    assert.equal(eventos.porRotacion(new Date(2026, 9, 4, 23)).id, lunes.id, 'el domingo sigue siendo el mismo');
    assert.notEqual(eventos.porRotacion(new Date(2026, 9, 5, 9)).id, lunes.id, 'el lunes siguiente cambia');
    assert.equal(eventos.diasParaCambiar(new Date(2026, 9, 4)), 1);
  });

  test('se puede fijar o quitar desde el panel, y se guarda', () => {
    assert.equal(eventos.elegir('arena', 'test'), true);
    assert.equal(eventos.actual()?.id, 'arena');
    assert.equal(eventos.elegir('inventado', 'test'), false);
    eventos.elegir('ninguno', 'test');
    assert.equal(eventos.actual(), null);
    const fila = getDb().prepare("SELECT valor FROM ajustes WHERE clave = 'evento'").get() as { valor: string };
    assert.equal(fila.valor, 'ninguno');
  });

  test('🪙 Fiebre del oro: el cofre del chat tira con la suerte del Cofre del tesoro', async () => {
    loot.registrarActividad(persona('ana'));
    const normal = await loot.soltarCofre({ azar: fijo(0.5) });
    assert.equal(normal.ok && normal.reparto[0]!.botin.rareza, 'comun');
    eventos.reset('fiebre-oro');
    const fiebre = await loot.soltarCofre({ azar: fijo(0.5) });
    assert.equal(fiebre.ok && fiebre.reparto[0]!.botin.rareza, 'raro');
  });

  test('☠️ Semana maldita y 📖 coleccionista cambian la tirada', () => {
    eventos.reset('semana-maldita');
    assert.equal(loot.tirarConEvento('cofre', 'id-ana', fijo(0)).maldito, true);
    assert.equal(loot.tirarConEvento('cofre', 'id-ana', fijo(0.9)).maldito, undefined);

    eventos.reset('coleccionista');
    lootDb.dar('id-ana', 'ana', { objeto: 'Espada oxidada', rareza: 'comun' }, 'cofre');
    const tiradas = [0, 0, 0, 0.1];
    const b = loot.tirarConEvento('cofre', 'id-ana', () => tiradas.shift() ?? 0);
    assert.notEqual(b.objeto, 'Espada oxidada', 'lo repetido se vuelve a tirar');
  });

  test('🔥 Forja al rojo vivo: con 2 basta; 🤺 arena: el triple de puntos', async () => {
    eventos.reset('forja-caliente');
    lootDb.dar('id-ana', 'ana', { objeto: 'Mapa arrugado', rareza: 'comun' }, 'cofre');
    lootDb.dar('id-ana', 'ana', { objeto: 'Flecha torcida', rareza: 'comun' }, 'cofre');
    await handleEvent(mensaje('ana', '!fundir'));
    assert.match(enviados.at(-1)!, /^🔨 @ana funde 2 ⚪ y forja → 🔵/);

    eventos.reset('arena');
    assert.equal(temporada.puntosDuelo(), 15);
  });

  test('!evento dice cuál toca', async () => {
    eventos.reset('caza-mayor');
    await handleEvent(mensaje('ana', '!evento'));
    assert.match(enviados.at(-1)!, /^📅 Evento de la semana, 🐉 Caza mayor/);
  });
});

describe('🧙 !pj', () => {
  test('tu ficha con @; la de otro, sin', async () => {
    lootDb.dar('id-ana', 'ana', { objeto: 'Filo del Vacío', rareza: 'legendario' }, 'cofre');
    await handleEvent(mensaje('luis'));
    await handleEvent(mensaje('ana', '!pj'));
    assert.match(enviados.at(-1)!, /^🧙 @ana · ⚔️ Poder 20 \(1º de 1\) · 🏆 20 pts de temporada \(1º\) · 📖 Colección 1\/\d+ · 🎒 1\/20 · Mejor pieza: 🟠 Filo del Vacío$/);
    cooldowns.reset();
    await engine.run(comandos.pj, { viewer: persona('ana'), trigger: 'command', args: ' luis' });
    assert.match(enviados.at(-1)!, /^🧙 luis · ⚔️ Poder 0/);
  });
});
