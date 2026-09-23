import { test, describe, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';

import { configureDatabase, truncateAll, getDb } from '../data/db.js';
import { config } from '../config.js';
import { normalize } from '../core/events.js';
import { handleEvent } from '../core/handler.js';
import { setSender } from '../core/output.js';
import { setApprover } from '../core/review.js';
import * as cooldowns from '../core/cooldowns.js';
import * as policy from '../core/policy.js';
import * as killswitch from '../core/killswitch.js';
import * as memory from '../core/memory.js';
import * as consent from '../core/consent.js';
import { setCaller, setExtractor } from '../services/ai/index.js';
import { budget } from '../services/ai/index.js';
import * as datoInutil from './dato-inutil.js';

/**
 * #15 Dato Inútil.
 *
 * Dos mitades con problemas distintos: guardar (la dispara el chat, y el
 * riesgo es la factura) y sacar (la dispara alguien que vuelve, y el riesgo
 * es el momento).
 *
 * Nada de esto llama a Anthropic: se sustituyen el emisor y el extractor.
 */

const DIA_MS = 24 * 60 * 60 * 1000;

let enviados: string[] = [];
let extracciones = 0;

function mensaje(login: string, texto: string) {
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

const USO = { inputTokens: 500, outputTokens: 30, cacheReadTokens: 0, cacheCreationTokens: 0 };

/** Extractor falso que siempre encuentra algo. */
function extractorEncuentra(tema = 'juegos', dato = 'está atascada con un jefe') {
  setExtractor(async () => {
    extracciones += 1;
    return {
      kind: 'ok' as const,
      dato: { merece_recordarse: true, tema: tema as any, dato },
      usage: USO,
      model: 'claude-opus-5',
    };
  });
}

function extractorNoEncuentra() {
  setExtractor(async () => {
    extracciones += 1;
    return {
      kind: 'ok' as const,
      dato: { merece_recordarse: false, tema: 'ninguno' as const, dato: '' },
      usage: USO,
      model: 'claude-opus-5',
    };
  });
}

/** Deja a alguien visto hace N días, con o sin recuerdo. */
function vistoHace(login: string, dias: number): void {
  const cuando = new Date(Date.now() - dias * DIA_MS).toISOString();
  getDb()
    .prepare(
      'INSERT INTO users (twitch_id, login, display_name, first_seen, last_seen) VALUES (?,?,?,?,?)',
    )
    .run(`id-${login}`, login, login, cuando, cuando);
}

const MENSAJE_LARGO = 'pues llevo toda la semana atascado con el jefe final del juego este';

before(() => configureDatabase(':memory:'));

beforeEach(() => {
  truncateAll();
  cooldowns.reset();
  policy.reset();
  budget.reset();
  killswitch.enable('test');
  datoInutil.olvidarIntentos();
  setSender(async (texto) => {
    enviados.push(texto);
  });
  // El texto de #15 lo escribe Claude, así que pasa por el modo revisión.
  setApprover(async () => ({ approved: true }));
  setCaller(async () => ({
    kind: 'ok' as const,
    message: '¿al final pudiste con ese jefe?',
    usage: USO,
    model: 'claude-opus-5',
  }));
  extractorEncuentra();
  enviados = [];
  extracciones = 0;
});

describe('guardar: mirar el chat sin arruinarse', () => {
  test('un mensaje largo se mira y el dato se guarda', async () => {
    vistoHace('pepe', 1);

    await handleEvent(mensaje('pepe', MENSAJE_LARGO));

    assert.equal(extracciones, 1);
    const suyos = memory.de('id-pepe');
    assert.equal(suyos.length, 1);
    assert.equal(suyos[0]!.kind, 'dato');
    assert.equal(suyos[0]!.content, 'está atascada con un jefe');
  });

  describe('las puertas que evitan la factura', () => {
    test('un mensaje corto no se mira siquiera', async () => {
      vistoHace('pepe', 1);

      await handleEvent(mensaje('pepe', 'jajaja'));

      assert.equal(extracciones, 0, 'no se llamó a la IA');
    });

    test('un comando no se mira', async () => {
      vistoHace('pepe', 1);

      await handleEvent(mensaje('pepe', `!algo ${'x'.repeat(60)}`));

      assert.equal(extracciones, 0);
    });

    test('solo se mira UN mensaje por persona y directo', async () => {
      vistoHace('pepe', 1);

      await handleEvent(mensaje('pepe', MENSAJE_LARGO));
      cooldowns.reset();
      await handleEvent(mensaje('pepe', `${MENSAJE_LARGO} y otra cosa distinta`));

      assert.equal(extracciones, 1);
    });

    test('el cooldown global frena a la segunda persona', async () => {
      vistoHace('pepe', 1);
      vistoHace('ana', 1);

      await handleEvent(mensaje('pepe', MENSAJE_LARGO));
      await handleEvent(mensaje('ana', MENSAJE_LARGO));

      assert.equal(extracciones, 1, 'la segunda espera al cooldown');
    });

    test('a quien pidió el olvido no se le mira nada', async () => {
      consent.olvidar('id-pepe');

      await handleEvent(mensaje('pepe', MENSAJE_LARGO));

      assert.equal(extracciones, 0);
      assert.equal(memory.count(), 0);
    });

    test('el mínimo por defecto son 40 caracteres', () => {
      assert.equal(config.datoInutil.minimoCaracteres, 40);
    });
  });

  describe('lo que propone la IA se vuelve a validar', () => {
    test('un tema fuera de la lista blanca NO se guarda', async () => {
      vistoHace('pepe', 1);
      // El modelo podría devolver cualquier cosa; el código no se fía.
      extractorEncuentra('politica', 'opina de cosas');

      await handleEvent(mensaje('pepe', MENSAJE_LARGO));

      assert.equal(extracciones, 1, 'se llamó');
      assert.equal(memory.count(), 0, 'pero no se guardó nada');
    });

    test('si dice que no hay nada, no se guarda nada', async () => {
      vistoHace('pepe', 1);
      extractorNoEncuentra();

      await handleEvent(mensaje('pepe', MENSAJE_LARGO));

      assert.equal(memory.count(), 0);
    });
  });

  test('guardar no escribe nada en el chat', async () => {
    vistoHace('pepe', 1);

    await handleEvent(mensaje('pepe', MENSAJE_LARGO));

    assert.deepEqual(enviados, []);
  });
});

describe('sacar: cuando alguien vuelve', () => {
  /** Alguien que se fue hace 30 días y dejó un recuerdo. */
  function conRecuerdo(login = 'pepe'): void {
    vistoHace(login, 30);
    memory.guardar({
      twitchId: `id-${login}`,
      kind: 'dato',
      topic: 'juegos',
      content: 'estaba atascado con un jefe',
    });
  }

  test('saca el recuerdo en vez del saludo genérico', async () => {
    conRecuerdo();

    await handleEvent(mensaje('pepe', 'hola'));

    assert.equal(enviados.length, 1);
    assert.match(enviados[0]!, /@pepe/);
    assert.match(enviados[0]!, /jefe/);
  });

  test('si NO hay recuerdo, va la bienvenida genérica de #18', async () => {
    vistoHace('pepe', 30);

    await handleEvent(mensaje('pepe', 'hola'));

    assert.equal(enviados.length, 1);
    assert.match(enviados[0]!, /vuelve|cuánto tiempo/i);
  });

  test('nunca las dos a la vez', async () => {
    conRecuerdo();

    await handleEvent(mensaje('pepe', 'hola'));

    const filas = getDb()
      .prepare("SELECT interaction FROM interactions WHERE status = 'sent'")
      .all() as Array<{ interaction: string }>;

    assert.equal(filas.length, 1);
    assert.equal(filas[0]!.interaction, 'dato-inutil');
  });

  test('el recuerdo no se saca dos veces', async () => {
    conRecuerdo();

    await handleEvent(mensaje('pepe', 'hola'));
    assert.equal(memory.paraSacar('id-pepe'), null, 'queda marcado como usado');
  });

  test('a quien volvió hace poco no se le saca nada', async () => {
    vistoHace('pepe', 2);
    memory.guardar({ twitchId: 'id-pepe', kind: 'dato', topic: 'juegos', content: 'algo' });

    await handleEvent(mensaje('pepe', 'hola'));

    assert.deepEqual(enviados, []);
  });

  test('si la IA falla, el recuerdo se conserva para la próxima', async () => {
    conRecuerdo();
    setCaller(async () => ({ kind: 'timeout' as const, detail: 'simulado' }));

    await handleEvent(mensaje('pepe', 'hola'));

    assert.deepEqual(enviados, [], 'no se publica un texto de reserva sin sentido');
    assert.ok(memory.paraSacar('id-pepe'), 'el recuerdo sigue disponible');
  });
});
