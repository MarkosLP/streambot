import { test, describe, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Interacciones espontáneas apagadas: el bot solo habla si le invocan.
 *
 * La variable se fija ANTES de importar nada, porque `config` se lee una sola
 * vez al cargar el módulo. Por eso este archivo está separado: `node --test`
 * arranca un proceso por archivo, así que aquí la configuración es distinta
 * a la del resto de la suite sin contaminarla.
 */
process.env.INTERACCIONES_ESPONTANEAS = 'false';

const { configureDatabase, truncateAll } = await import('../data/db.js');
const { normalize } = await import('./events.js');
const { handleEvent } = await import('./handler.js');
const { setSender } = await import('./output.js');
const { setApprover } = await import('./review.js');
const cooldowns = await import('./cooldowns.js');
const policy = await import('./policy.js');
const killswitch = await import('./killswitch.js');
const users = await import('../data/users.js');
const { setCaller } = await import('../services/ai/index.js');
const { config } = await import('../config.js');

const RESPUESTA_IA = 'Mando, sin discusión.';
let enviados: string[] = [];

function mensaje(login: string, texto: string) {
  return normalize(
    'Twitch.ChatMessage',
    {
      messageId: `m-${Math.random()}`,
      user: { id: `id-${login}`, login, name: login, role: 1, badges: [], subscribed: false },
      text: texto,
      meta: { firstMessage: true, returningChatter: false },
    },
    'simulator',
  );
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
  setApprover(async () => ({ approved: true }));
  setCaller(async () => ({
    kind: 'ok' as const,
    message: RESPUESTA_IA,
    usage: { inputTokens: 1273, outputTokens: 68, cacheReadTokens: 0, cacheCreationTokens: 0 },
    model: 'claude-opus-5',
  }));
  enviados = [];
});

describe('solo comandos', () => {
  test('la configuración está apagada en este archivo', () => {
    assert.equal(config.interaccionesEspontaneas, false);
  });

  test('un mensaje normal NO provoca respuesta', async () => {
    await handleEvent(mensaje('armifer91', 'hola buenas'));

    assert.deepEqual(enviados, []);
  });

  test('ni siquiera el primer mensaje de alguien nuevo', async () => {
    await handleEvent(mensaje('nuevo', '¡acabo de llegar!'));

    assert.deepEqual(enviados, []);
  });

  test('pero la presencia SÍ se registra', async () => {
    await handleEvent(mensaje('armifer91', 'hola buenas'));

    // Seguimos sabiendo quién estuvo y cuándo, que es gratis y hace falta
    // para la bienvenida de vuelta. Lo que no se guarda es lo que escribió.
    assert.equal(users.count(), 1);
  });

  test('el comando sí responde', async () => {
    await handleEvent(mensaje('armifer91', '!pregunta ¿mando o teclado?'));

    assert.equal(enviados.length, 1);
    assert.match(enviados[0]!, /Mando, sin discusión/);
  });

  test('y el alias con erre también', async () => {
    await handleEvent(mensaje('armifer91', '!preguntar ¿mando o teclado?'));

    assert.equal(enviados.length, 1);
  });
});
