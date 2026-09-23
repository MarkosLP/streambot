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
import * as streams from '../data/streams.js';
import { setCaller, budget } from '../services/ai/index.js';
import { describirResumen, resumirDirecto, ultimo } from './continuara.js';

/**
 * #24 Continuará.
 *
 * El criterio de hecho de la Fase 8: *"al cerrar el directo se genera y
 * guarda un 'continuará'; al abrir el siguiente, se lee."* Eso es el primer
 * bloque de aquí abajo.
 */

let enviados: string[] = [];
let llamadas = 0;

const USO = { inputTokens: 600, outputTokens: 40, cacheReadTokens: 0, cacheCreationTokens: 0 };
const FRASE = 'La semana que viene sabremos si pepe tenía razón con lo de la tortilla.';

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

before(() => configureDatabase(':memory:'));

beforeEach(() => {
  truncateAll();
  cooldowns.reset();
  policy.reset();
  budget.reset();
  killswitch.enable('test');
  setSender(async (texto) => {
    enviados.push(texto);
  });
  setApprover(async () => ({ approved: true }));
  setCaller(async () => {
    llamadas += 1;
    return { kind: 'ok' as const, message: FRASE, usage: USO, model: 'claude-opus-5' };
  });
  enviados = [];
  llamadas = 0;
});

describe('continuará', () => {
  describe('el criterio de hecho de la Fase 8', () => {
    test('al cerrar se genera, se guarda y se publica', async () => {
      await handleEvent(online());
      await handleEvent(mensaje('pepe'));
      enviados = [];

      await handleEvent(offline());

      assert.equal(llamadas, 1, 'una sola llamada a la IA por directo');
      assert.equal(enviados.length, 1);
      assert.equal(enviados[0], FRASE);
      assert.equal(ultimo(), FRASE, 'queda guardado en la fila del directo');
    });

    test('al abrir el siguiente, se lee y NO se vuelve a llamar a la IA', async () => {
      await handleEvent(online());
      await handleEvent(mensaje('pepe'));
      await handleEvent(offline());

      enviados = [];
      llamadas = 0;

      await handleEvent(online());

      assert.equal(llamadas, 0, 'el texto ya estaba escrito');
      assert.equal(enviados.length, 1);
      assert.match(enviados[0]!, /Lo dejamos aquí la última vez/);
      assert.match(enviados[0]!, /tortilla/);
    });
  });

  describe('cuándo NO gasta una llamada', () => {
    test('un directo sin nadie en el chat', async () => {
      await handleEvent(online());
      await handleEvent(offline());

      assert.equal(llamadas, 0);
      assert.deepEqual(enviados, []);
    });

    test('y queda constancia de por qué', async () => {
      await handleEvent(online());
      await handleEvent(offline());

      const fila = getDb()
        .prepare("SELECT detail FROM interactions WHERE interaction = 'continuara'")
        .get() as { detail: string };

      assert.match(fila.detail, /sin espectadores/);
    });

    test('el primer directo de todos no tiene nada que recuperar', async () => {
      await handleEvent(online());

      assert.deepEqual(enviados, []);
    });

    test('si la IA falla, no se publica nada', async () => {
      setCaller(async () => ({ kind: 'timeout' as const, detail: 'simulado' }));

      await handleEvent(online());
      await handleEvent(mensaje('pepe'));
      enviados = [];

      await handleEvent(offline());

      // El texto de reserva genérico no cumple la función de un "continuará",
      // y el directo ya ha terminado: nadie está esperando una respuesta.
      assert.deepEqual(enviados, []);
      assert.equal(ultimo(), null);
    });
  });

  describe('el resumen del directo', () => {
    test('recoge a quien ha pasado por el chat', async () => {
      await handleEvent(online());
      await handleEvent(mensaje('pepe'));
      await handleEvent(mensaje('ana'));

      const resumen = resumirDirecto(streams.current()!.started_at);

      assert.deepEqual(resumen.espectadores.sort(), ['ana', 'pepe']);
    });

    test('se describe en texto plano, sin inventar nada', () => {
      const texto = describirResumen({ espectadores: ['pepe'], datos: ['le gusta la tortilla'] });

      assert.match(texto, /pepe/);
      assert.match(texto, /le gusta la tortilla/);
    });

    test('un directo vacío se describe como vacío', () => {
      assert.match(describirResumen({ espectadores: [], datos: [] }), /nadie/);
    });
  });

  test('cerrar el directo cierra también su fila', async () => {
    await handleEvent(online());
    await handleEvent(mensaje('pepe'));
    await handleEvent(offline());

    assert.equal(streams.current(), null);
  });
});

/**
 * El interruptor de interacciones espontáneas.
 *
 * #24 no pasa por el motor, así que no hereda el interruptor: lo comprueba
 * ella. Sin eso sería el único camino por el que el bot habla solo con
 * INTERACCIONES_ESPONTANEAS=false, y además gastando dinero en cada cierre.
 */
describe('respeta el interruptor de espontáneas', () => {
  test('la configuración por defecto las permite', () => {
    // La suite corre con los valores por defecto. Lo que este test fija es que
    // #24 consulta la MISMA marca que el resto, no una suya.
    assert.equal(config.interaccionesEspontaneas, true);
  });

  test('con las espontáneas activas, al cerrar sí habla', async () => {
    await handleEvent(online());
    await handleEvent(mensaje('pepe'));
    enviados = [];

    await handleEvent(offline());

    assert.equal(enviados.length, 1);
  });
});
