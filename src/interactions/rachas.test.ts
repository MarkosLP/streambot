import { test, describe, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';

import { configureDatabase, truncateAll } from '../data/db.js';
import { normalize } from '../core/events.js';
import { handleEvent } from '../core/handler.js';
import { setSender } from '../core/output.js';
import { setApprover } from '../core/review.js';
import * as cooldowns from '../core/cooldowns.js';
import * as policy from '../core/policy.js';
import * as killswitch from '../core/killswitch.js';
import * as ajustes from '../core/ajustes.js';
import * as streams from '../data/streams.js';
import * as streaks from '../data/streaks.js';
import { componerHito, mereceAnuncio } from './rachas.js';

/**
 * #19 Rachas.
 *
 * Casi todo lo interesante está en `data/streaks.ts`, y se prueba ahí
 * directamente: montar veinticinco directos por el camino largo para
 * comprobar un hito sería un test lento y difícil de leer.
 *
 * Lo que sí se recorre entero es lo que puede romperse de verdad: que la
 * asistencia se registre aunque no se anuncie nada.
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

const online = () => normalize('Twitch.StreamOnline', {}, 'simulator');
const offline = () => normalize('Twitch.StreamOffline', {}, 'simulator');

/** Simula asistir a `n` directos seguidos. Devuelve el resultado del último. */
function asistirA(n: number, twitchId = 'id-pepe'): streaks.Resultado {
  let ultimo: streaks.Resultado = { tipo: 'primera', racha: 0 };
  for (let i = 0; i < n; i += 1) {
    const s = streams.open();
    ultimo = streaks.registrarAsistencia(twitchId, s.id, streams.previousId(s.id));
    streams.close();
  }
  return ultimo;
}

before(() => configureDatabase(':memory:'));

beforeEach(() => {
  truncateAll();
  cooldowns.reset();
  policy.reset();
  killswitch.enable('test');
  // Aquí se prueban las rachas: el cofre de fidelidad (Loot) tiene sus tests.
  ajustes.setLootActivo(false, 'test');
  setSender(async (texto) => {
    enviados.push(texto);
  });
  setApprover(async () => ({ approved: true }));
  enviados = [];
});

describe('contar la racha', () => {
  test('el primer directo empieza en 1', () => {
    assert.deepEqual(asistirA(1), { tipo: 'primera', racha: 1 });
  });

  test('directos seguidos suman', () => {
    assert.deepEqual(asistirA(3), { tipo: 'continua', racha: 3 });
  });

  test('escribir diez veces en el mismo directo cuenta UNA', () => {
    const s = streams.open();
    streaks.registrarAsistencia('id-pepe', s.id, null);

    for (let i = 0; i < 9; i += 1) {
      const r = streaks.registrarAsistencia('id-pepe', s.id, null);
      assert.equal(r.tipo, 'repetida');
    }

    assert.equal(streaks.find('id-pepe')!.current, 1);
  });

  test('guarda la mejor racha alcanzada', () => {
    asistirA(5);
    // Se salta tres directos: la racha se rompe.
    for (let i = 0; i < 3; i += 1) {
      streams.open();
      streams.close();
    }
    asistirA(1);

    const fila = streaks.find('id-pepe')!;
    assert.equal(fila.current, 1);
    assert.equal(fila.best, 5, 'el récord se conserva');
  });
});

describe('el comodín', () => {
  test('perdona UN directo perdido y la racha sigue', () => {
    asistirA(4);

    // Se pierde uno.
    streams.open();
    streams.close();

    const s = streams.open();
    const r = streaks.registrarAsistencia('id-pepe', s.id, streams.previousId(s.id));

    assert.equal(r.tipo, 'comodin');
    assert.equal(r.racha, 5, 'la racha continúa, no se reinicia');
  });

  test('no perdona dos directos seguidos perdidos', () => {
    asistirA(4);

    for (let i = 0; i < 2; i += 1) {
      streams.open();
      streams.close();
    }

    const s = streams.open();
    const r = streaks.registrarAsistencia('id-pepe', s.id, streams.previousId(s.id));

    assert.equal(r.tipo, 'rota');
    assert.equal(r.racha, 1);
  });

  test('solo se puede gastar una vez al mes', () => {
    asistirA(3);

    // Primera falta: perdonada.
    streams.open();
    streams.close();
    let s = streams.open();
    assert.equal(streaks.registrarAsistencia('id-pepe', s.id, streams.previousId(s.id)).tipo, 'comodin');
    streams.close();

    // Segunda falta el mismo mes: ya no queda comodín.
    streams.open();
    streams.close();
    s = streams.open();
    assert.equal(streaks.registrarAsistencia('id-pepe', s.id, streams.previousId(s.id)).tipo, 'rota');
  });

  test('el comodín se renueva al cambiar de mes', () => {
    // El mes se guarda como YYYY-MM, así que basta con mirar que dos meses
    // distintos no son el mismo valor: no hace falta ninguna tarea que lo
    // reinicie a fin de mes.
    const septiembre = streaks.mesActual(new Date('2026-09-15T12:00:00'));
    const octubre = streaks.mesActual(new Date('2026-10-01T12:00:00'));

    assert.notEqual(septiembre, octubre);
  });
});

describe('qué se anuncia', () => {
  test('los hitos son 3, 5, 10 y 25', () => {
    assert.deepEqual([...streaks.HITOS], [3, 5, 10, 25]);
    for (const n of [3, 5, 10, 25]) assert.ok(streaks.esHito(n));
    for (const n of [1, 2, 4, 7, 11, 24]) assert.ok(!streaks.esHito(n));
  });

  test('una racha normal no se anuncia', () => {
    assert.equal(mereceAnuncio({ tipo: 'continua', racha: 4 }), false);
  });

  test('un hito sí', () => {
    assert.equal(mereceAnuncio({ tipo: 'continua', racha: 5 }), true);
  });

  test('el comodín siempre', () => {
    assert.equal(mereceAnuncio({ tipo: 'comodin', racha: 5, saltados: 1 }), true);
  });

  test('romper la racha NO se anuncia', () => {
    // Deliberado: decirle a alguien "has perdido tu racha de 9" es la
    // frustración que docs/02 pide evitar, no su mitigación.
    assert.equal(mereceAnuncio({ tipo: 'rota', racha: 1, anterior: 9 }), false);
  });

  test('el texto sube de intensidad con la cifra', () => {
    assert.match(componerHito('pepe', 3), /de la casa/);
    assert.match(componerHito('pepe', 25), /VEINTICINCO/);
    assert.notEqual(componerHito('pepe', 3), componerHito('pepe', 10));
  });
});

describe('recorrido por el manejador', () => {
  test('la asistencia se registra aunque no se anuncie nada', async () => {
    await handleEvent(online());
    await handleEvent(mensaje('pepe'));

    assert.deepEqual(enviados, [], 'una racha de 1 no se celebra');
    assert.equal(streaks.find('id-pepe')!.current, 1, 'pero sí se cuenta');
  });

  test('un hito se anuncia en el chat', async () => {
    // Dos directos previos a los que asistió.
    asistirA(2);

    await handleEvent(online());
    await handleEvent(mensaje('pepe'));

    assert.equal(enviados.length, 1);
    assert.match(enviados[0]!, /@pepe/);
    assert.match(enviados[0]!, /tres directos seguidos/);
  });

  test('el cooldown del anuncio NO impide contar la asistencia', async () => {
    // Éste es el fallo que el diseño evita: si registrar dependiera de que la
    // interacción llegue a ejecutarse, el cooldown de un tercero le costaría
    // la racha a otro.
    asistirA(2, 'id-pepe');
    asistirA(2, 'id-ana');

    await handleEvent(online());
    await handleEvent(mensaje('pepe'));
    await handleEvent(mensaje('ana'));

    assert.equal(enviados.length, 1, 'solo se anuncia uno, por el cooldown');
    assert.equal(streaks.find('id-ana')!.current, 3, 'pero a ana se le contó igual');
  });

  test('sin directo abierto no se cuenta nada', async () => {
    await handleEvent(mensaje('pepe'));

    assert.equal(streaks.find('id-pepe'), null);
  });

  test('el directo se cierra sin afectar a las rachas', async () => {
    await handleEvent(online());
    await handleEvent(mensaje('pepe'));
    await handleEvent(offline());

    assert.equal(streaks.find('id-pepe')!.current, 1);
  });
});
