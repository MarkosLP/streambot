import { test, describe, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';

import { configureDatabase, truncateAll } from '../data/db.js';
import { normalize } from '../core/events.js';
import { handleEvent } from '../core/handler.js';
import { setSender } from '../core/output.js';
import * as cooldowns from '../core/cooldowns.js';
import * as policy from '../core/policy.js';
import * as killswitch from '../core/killswitch.js';
import * as users from '../data/users.js';
import * as interactionLog from '../data/interactions.js';
import { NAME, COOLDOWN_MS, elegirPregunta, componerSaludo } from './primer-mensaje.js';

/**
 * Estos tests recorren el camino real completo: normalize -> handleEvent ->
 * SQLite -> interacción -> policy -> output. Lo único falso es el emisor.
 */

let enviados: string[] = [];

before(() => {
  configureDatabase(':memory:');
  setSender(async (text) => {
    enviados.push(text);
  });
});

beforeEach(() => {
  truncateAll();
  cooldowns.reset();
  policy.reset();
  killswitch.enable('test');
  enviados = [];
});

/**
 * Desde la Fase 6 el disparador de #1 es el flag de primer mensaje de
 * Streamer.bot, no "es nuevo en nuestra base de datos". Por eso el flag va a
 * true por defecto aquí: es lo que describe el escenario de casi todos estos
 * tests. Los que simulan un mensaje POSTERIOR lo pasan a false.
 */
function mensajeDe(login: string, text = 'hola', primerMensaje = true) {
  return normalize(
    'Twitch.ChatMessage',
    {
      messageId: `m-${Math.random()}`,
      user: { id: `id-${login}`, login, name: login, role: 1, badges: [], subscribed: false },
      text,
      meta: { firstMessage: primerMensaje, returningChatter: false },
    },
    'simulator',
  );
}

describe('primer-mensaje', () => {
  describe('usuario nuevo', () => {
    test('lo crea, lo saluda y registra la interacción', async () => {
      await handleEvent(mensajeDe('pepe'));

      const fila = users.find('id-pepe');
      assert.ok(fila, 'el usuario debe existir en SQLite');
      assert.equal(fila.login, 'pepe');
      assert.ok(fila.first_seen, 'debe tener first_seen');
      assert.ok(fila.last_seen, 'debe tener last_seen');
      assert.equal(fila.first_seen, fila.last_seen, 'en el alta ambas fechas coinciden');

      assert.equal(enviados.length, 1, 'debe haber enviado exactamente un saludo');
      assert.match(enviados[0], /^@pepe /);

      const registros = interactionLog.findByUser('id-pepe');
      assert.equal(registros.length, 1);
      assert.equal(registros[0].interaction, NAME);
      assert.equal(registros[0].status, 'sent');
    });
  });

  describe('usuario existente', () => {
    test('actualiza last_seen y NO vuelve a saludar', async () => {
      await handleEvent(mensajeDe('pepe'));
      const primera = users.find('id-pepe')!;
      assert.equal(enviados.length, 1);

      // El cooldown global no debe influir en este caso: la razón de no
      // saludar es que ya se le saludó, no que estemos en cooldown.
      cooldowns.reset();

      await handleEvent(mensajeDe('pepe', 'sigo aquí'));

      const segunda = users.find('id-pepe')!;
      assert.equal(segunda.first_seen, primera.first_seen, 'first_seen no debe cambiar');
      assert.ok(segunda.last_seen >= primera.last_seen, 'last_seen debe avanzar o mantenerse');
      assert.equal(enviados.length, 1, 'no debe haber un segundo saludo');
      assert.equal(interactionLog.findByUser('id-pepe').length, 1);
    });
  });

  describe('cooldown', () => {
    test('un segundo usuario nuevo dentro de la ventana no recibe saludo', async () => {
      await handleEvent(mensajeDe('pepe'));
      assert.equal(enviados.length, 1);

      await handleEvent(mensajeDe('ana'));

      assert.equal(enviados.length, 1, 'el cooldown global debe frenar el segundo saludo');
      assert.ok(users.find('id-ana'), 'aun así ana queda registrada');

      const registros = interactionLog.findByUser('id-ana');
      assert.equal(registros.length, 1);
      assert.equal(registros[0].status, 'skipped');
    });

    test('pasado el cooldown, quien se quedó sin saludo lo recibe al volver a escribir', async () => {
      await handleEvent(mensajeDe('pepe'));
      await handleEvent(mensajeDe('ana')); // se queda sin saludo por cooldown
      assert.equal(enviados.length, 1);

      cooldowns.reset(); // equivale a que pase la ventana de 60 s

      await handleEvent(mensajeDe('ana', 'sigo por aquí'));

      assert.equal(enviados.length, 2, 'ana ya no es nueva, pero nunca se la saludó');
      assert.match(enviados[1], /^@ana /);
    });

    test('la ventana declarada son los 60 s documentados', () => {
      assert.equal(COOLDOWN_MS, 60_000);
    });
  });

  describe('interruptor de emergencia', () => {
    test('con el sistema apagado no se envía nada', async () => {
      killswitch.disable('test');

      await handleEvent(mensajeDe('pepe'));

      assert.equal(enviados.length, 0, 'no debe salir ningún mensaje');
      assert.ok(users.find('id-pepe'), 'el usuario sí queda registrado');

      const registros = interactionLog.findByUser('id-pepe');
      assert.equal(registros[0].status, 'blocked');
      assert.match(registros[0].detail ?? '', /killswitch/);
    });
  });

  describe('cuentas ignoradas', () => {
    test('a otro bot ni se le registra ni se le saluda', async () => {
      await handleEvent(mensajeDe('streamelements', 'llevo 2 días en marcha'));

      assert.equal(enviados.length, 0);
      assert.equal(users.find('id-streamelements'), null);
    });

    test('al dueño del canal tampoco', async () => {
      await handleEvent(mensajeDe('crid4m', 'hola'));

      assert.equal(enviados.length, 0);
      assert.equal(users.find('id-crid4m'), null);
    });
  });

  describe('composición del saludo', () => {
    test('es determinista: el mismo id da siempre la misma pregunta', () => {
      assert.equal(elegirPregunta('id-pepe'), elegirPregunta('id-pepe'));
    });

    test('ids distintos reparten entre varias preguntas', () => {
      const obtenidas = new Set(
        Array.from({ length: 60 }, (_, i) => elegirPregunta(`usuario-${i}`)),
      );
      assert.ok(obtenidas.size > 5, `esperaba variedad, salieron ${obtenidas.size}`);
    });

    test('el saludo pasa la policy', () => {
      const texto = componerSaludo('Pepe', 'id-pepe');
      const veredicto = policy.evaluate({ text: texto, reason: NAME, allowedMentions: ['pepe'] });
      assert.equal(veredicto.ok, true, `la policy rechazó el saludo: ${JSON.stringify(veredicto)}`);
    });

    test('ningún saludo posible supera el límite de longitud', () => {
      const nombreLargo = 'a'.repeat(25); // máximo de un login de Twitch
      for (let i = 0; i < 60; i += 1) {
        const texto = componerSaludo(nombreLargo, `usuario-${i}`);
        assert.ok(texto.length <= 480, `saludo demasiado largo: ${texto.length}`);
      }
    });
  });
});

/**
 * El refinamiento de la Fase 6.
 *
 * Antes bastaba con ser nuevo en NUESTRA base de datos. Eso significaba que
 * el primer directo del bot en un canal con historia saludaba a todos los
 * habituales con un "primera vez que te leo por aquí" que era mentira.
 */
describe('refinamiento: el flag manda sobre la base de datos', () => {
  test('un habitual del canal desconocido para nosotros NO recibe saludo', async () => {
    // Nuevo para la base de datos, pero Streamer.bot sabe que lleva años.
    await handleEvent(mensajeDe('habitual', 'buenas otra vez', false));

    assert.deepEqual(enviados, []);
    assert.equal(users.find('id-habitual')?.login, 'habitual', 'su presencia sí se registra');
  });

  test('con el flag puesto sí se le saluda', async () => {
    await handleEvent(mensajeDe('recien', 'hola', true));

    assert.equal(enviados.length, 1);
    assert.match(enviados[0]!, /primera vez que te leo/);
  });

  test('un saludo perdido por el cooldown se recupera en el siguiente mensaje', async () => {
    // Dos personas nuevas a la vez: la segunda se queda sin saludo.
    await handleEvent(mensajeDe('uno', 'hola', true));
    await handleEvent(mensajeDe('dos', 'hola', true));
    assert.equal(enviados.length, 1, 'el cooldown de 60s deja fuera al segundo');

    cooldowns.reset();

    // Su siguiente mensaje YA NO lleva el flag: Streamer.bot solo marca uno.
    // Aun así hay que saludarle, porque se le debía.
    await handleEvent(mensajeDe('dos', 'sigo por aquí', false));

    assert.equal(enviados.length, 2);
    assert.match(enviados[1]!, /@dos/);
  });

  test('a quien ya se saludó no se le vuelve a saludar nunca', async () => {
    await handleEvent(mensajeDe('pepe', 'hola', true));
    cooldowns.reset();
    await handleEvent(mensajeDe('pepe', 'otra vez', true));
    cooldowns.reset();
    await handleEvent(mensajeDe('pepe', 'y otra', false));

    assert.equal(enviados.length, 1);
  });
});
