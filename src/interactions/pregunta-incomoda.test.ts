import { test, describe, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';

import { configureDatabase, truncateAll, getDb } from '../data/db.js';
import { normalize } from '../core/events.js';
import { handleEvent } from '../core/handler.js';
import { setSender } from '../core/output.js';
import * as cooldowns from '../core/cooldowns.js';
import * as policy from '../core/policy.js';
import * as killswitch from '../core/killswitch.js';
import { NAME, elegirPregunta, componer } from './pregunta-incomoda.js';

/**
 * #10 Pregunta Incómoda: la CUARTA interacción.
 *
 * Existe para responder a la pregunta del criterio de hecho de la Fase 7:
 * ¿se puede añadir una interacción tocando un solo archivo? Todo lo suyo
 * —guardas, permisos, cooldown, texto y el enganche al Channel Point— está
 * en `pregunta-incomoda.ts`. Fuera hay una línea en `interactions/index.ts`.
 *
 * Y trae a propósito algo que ninguna de las tres primeras tenía: una guarda
 * de PERMISOS. Si el contrato solo valiera para lo que ya existía, no sería
 * un motor, sería un molde.
 */

let enviados: string[] = [];

function redencion(login: string, recompensa = 'Pregunta Incómoda') {
  return normalize(
    'Twitch.RewardRedemption',
    {
      id: `r-${Math.random()}`,
      user_id: `id-${login}`,
      user_login: login,
      user_name: login,
      user_input: '',
      reward: { id: `rw-${recompensa}`, title: recompensa, cost: 300 },
    },
    'simulator',
  );
}

function comando(login: string, texto = '!incomoda', opciones: { sub?: boolean; mod?: boolean } = {}) {
  const badges: Array<{ name: string }> = [];
  if (opciones.sub) badges.push({ name: 'subscriber' });
  if (opciones.mod) badges.push({ name: 'moderator' });

  return normalize(
    'Twitch.ChatMessage',
    {
      messageId: `m-${Math.random()}`,
      user: { id: `id-${login}`, login, name: login, role: 1, badges, subscribed: opciones.sub === true },
      text: texto,
      meta: { firstMessage: false, returningChatter: false },
    },
    'simulator',
  );
}

function filas() {
  return getDb()
    .prepare('SELECT status, detail FROM interactions WHERE interaction = ?')
    .all(NAME) as Array<{ status: string; detail: string | null }>;
}

before(() => configureDatabase(':memory:'));

beforeEach(() => {
  truncateAll();
  cooldowns.reset();
  policy.reset();
  killswitch.enable('test');
  setSender(async (texto) => {
    enviados.push(texto);
  });
  enviados = [];
});

describe('pregunta incómoda', () => {
  describe('Channel Point', () => {
    test('la recompensa dispara la pregunta', async () => {
      await handleEvent(redencion('pepe'));

      assert.equal(enviados.length, 1);
      assert.match(enviados[0]!, /^@pepe pregunta para Crid4m: /);
      assert.equal(filas()[0]!.status, 'sent');
    });

    test('otra recompensa cualquiera no la dispara', async () => {
      await handleEvent(redencion('pepe', 'Otra cosa'));

      assert.deepEqual(enviados, []);
      assert.equal(filas().length, 0);
    });

    test('no le afecta el cooldown del comando', async () => {
      await handleEvent(redencion('pepe'));
      await handleEvent(redencion('ana'));

      assert.equal(enviados.length, 2);
    });
  });

  describe('el comando !incomoda es solo para subs', () => {
    test('un sub sí puede', async () => {
      await handleEvent(comando('pepe', '!incomoda', { sub: true }));

      assert.equal(enviados.length, 1);
    });

    test('un moderador también', async () => {
      await handleEvent(comando('mod', '!incomoda', { mod: true }));

      assert.equal(enviados.length, 1);
    });

    test('quien no es sub, no', async () => {
      await handleEvent(comando('pepe', '!incomoda'));

      assert.deepEqual(enviados, []);
    });

    test('y ese rechazo SÍ queda registrado', async () => {
      await handleEvent(comando('pepe', '!incomoda'));

      const fila = filas()[0]!;
      assert.equal(fila.status, 'skipped');
      assert.match(fila.detail!, /command: el comando es solo para subs/);
    });
  });

  describe('cooldown del comando', () => {
    test('el segundo sub seguido se queda sin pregunta', async () => {
      await handleEvent(comando('pepe', '!incomoda', { sub: true }));
      await handleEvent(comando('ana', '!incomoda', { sub: true }));

      assert.equal(enviados.length, 1);
      assert.match(filas()[1]!.detail!, /command: cooldown, faltan \d+s/);
    });
  });

  describe('el banco de preguntas', () => {
    test('la misma semilla da siempre la misma pregunta', () => {
      assert.equal(elegirPregunta('abc'), elegirPregunta('abc'));
    });

    test('semillas distintas reparten', () => {
      const vistas = new Set(Array.from({ length: 40 }, (_, i) => elegirPregunta(`s${i}`)));
      assert.ok(vistas.size > 3, `solo salieron ${vistas.size} preguntas distintas`);
    });

    test('el texto deja claro que la responde el streamer', () => {
      assert.match(componer('pepe', '¿algo?'), /pregunta para Crid4m/);
    });
  });
});
