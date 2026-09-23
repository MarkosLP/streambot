import { test, describe, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';

import { configureDatabase, truncateAll, getDb } from '../data/db.js';
import { normalize } from '../core/events.js';
import { handleEvent } from '../core/handler.js';
import { setSender } from '../core/output.js';
import * as cooldowns from '../core/cooldowns.js';
import * as policy from '../core/policy.js';
import * as killswitch from '../core/killswitch.js';
import * as memory from '../core/memory.js';
import * as consent from '../core/consent.js';
import * as users from '../data/users.js';
import { sanear } from './ticket-entrada.js';

/**
 * #2 Ticket de Entrada, recorriendo el camino real: llega alguien nuevo, `#1`
 * le pregunta, contesta, y su respuesta acaba en `memories`.
 *
 * Aquí se comprueba también `!olvidame` de punta a punta, porque es donde de
 * verdad importa: no basta con que la función borre, tiene que borrar cuando
 * la persona lo escribe en el chat.
 */

let enviados: string[] = [];

function mensaje(login: string, texto: string, primerMensaje = false) {
  return normalize(
    'Twitch.ChatMessage',
    {
      messageId: `m-${Math.random()}`,
      user: { id: `id-${login}`, login, name: login, role: 1, badges: [], subscribed: false },
      text: texto,
      meta: { firstMessage: primerMensaje, returningChatter: false },
    },
    'simulator',
  );
}

function recuerdosDe(login: string) {
  return memory.de(`id-${login}`);
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

describe('ticket de entrada', () => {
  describe('el recorrido completo', () => {
    test('llega, le preguntan, contesta y se guarda', async () => {
      await handleEvent(mensaje('pepe', 'hola a todos', true));
      assert.equal(enviados.length, 1, '#1 le ha saludado');

      await handleEvent(mensaje('pepe', 'con cebolla, obviamente'));

      const suyos = recuerdosDe('pepe');
      assert.equal(suyos.length, 1);
      assert.equal(suyos[0]!.kind, 'ticket');
      assert.match(suyos[0]!.content, /con cebolla, obviamente$/);
    });

    test('el recuerdo guarda también la pregunta, no solo la respuesta', async () => {
      await handleEvent(mensaje('pepe', 'hola', true));
      await handleEvent(mensaje('pepe', 'mando'));

      // Sin la pregunta, "mando" no significa nada dentro de tres semanas.
      assert.match(recuerdosDe('pepe')[0]!.content, / -> mando$/);
    });

    test('el tema sale de la pregunta y está en la lista blanca', async () => {
      await handleEvent(mensaje('pepe', 'hola', true));
      await handleEvent(mensaje('pepe', 'lo que sea'));

      assert.ok(memory.esTemaPermitido(recuerdosDe('pepe')[0]!.topic));
    });

    test('no escribe nada en el chat: solo escucha', async () => {
      await handleEvent(mensaje('pepe', 'hola', true));
      enviados = [];

      await handleEvent(mensaje('pepe', 'con cebolla'));

      assert.deepEqual(enviados, []);
    });
  });

  describe('cuándo NO guarda', () => {
    test('a quien no se ha saludado', async () => {
      await handleEvent(mensaje('pepe', 'buenas', false));

      assert.equal(recuerdosDe('pepe').length, 0);
    });

    test('solo una vez por persona', async () => {
      await handleEvent(mensaje('pepe', 'hola', true));
      await handleEvent(mensaje('pepe', 'con cebolla'));
      await handleEvent(mensaje('pepe', 'y otra cosa mas'));

      assert.equal(recuerdosDe('pepe').length, 1);
      assert.match(recuerdosDe('pepe')[0]!.content, /con cebolla$/);
    });

    test('pasada la ventana de 2 minutos, ya no cuenta', async () => {
      await handleEvent(mensaje('pepe', 'hola', true));

      // Se envejece el saludo a mano: tres minutos atrás.
      const hace3min = new Date(Date.now() - 3 * 60_000).toISOString();
      getDb()
        .prepare("UPDATE interactions SET at = ? WHERE interaction = 'primer-mensaje'")
        .run(hace3min);

      await handleEvent(mensaje('pepe', 'con cebolla'));

      assert.equal(recuerdosDe('pepe').length, 0);
    });

    test('una respuesta que al sanearla se queda en nada', async () => {
      await handleEvent(mensaje('pepe', 'hola', true));
      await handleEvent(mensaje('pepe', 'https://spam.example/loquesea'));

      assert.equal(recuerdosDe('pepe').length, 0);
    });
  });

  describe('saneado del texto ajeno', () => {
    test('quita enlaces y menciones', () => {
      assert.equal(sanear('mando https://x.example @otro'), 'mando');
    });

    test('se queda con la primera línea', () => {
      assert.equal(sanear('mando\ny más cosas\ny más'), 'mando');
    });

    test('recorta a 60 caracteres', () => {
      assert.equal(sanear('a'.repeat(200)).length, 60);
    });

    test('colapsa los espacios', () => {
      assert.equal(sanear('  con     cebolla  '), 'con cebolla');
    });
  });

  describe('!olvidame, de punta a punta', () => {
    test('borra lo guardado y lo dice', async () => {
      await handleEvent(mensaje('pepe', 'hola', true));
      await handleEvent(mensaje('pepe', 'con cebolla'));
      assert.equal(recuerdosDe('pepe').length, 1);

      enviados = [];
      await handleEvent(mensaje('pepe', '!olvidame'));

      assert.equal(recuerdosDe('pepe').length, 0);
      assert.equal(users.find('id-pepe'), null);
      assert.match(enviados[0]!, /@pepe/);
      assert.match(enviados[0]!, /no guardo nada tuyo/);
    });

    test('después, escribir no le vuelve a registrar', async () => {
      await handleEvent(mensaje('pepe', '!olvidame'));
      await handleEvent(mensaje('pepe', 'hola otra vez', true));

      assert.equal(users.find('id-pepe'), null, 'no se recrea la ficha');
      assert.equal(recuerdosDe('pepe').length, 0);
      assert.equal(consent.haPedidoOlvido('id-pepe'), true);
    });

    test('ni le saluda ni le reconoce nunca más', async () => {
      await handleEvent(mensaje('pepe', '!olvidame'));
      enviados = [];

      await handleEvent(mensaje('pepe', 'hola', true));

      assert.deepEqual(enviados, []);
    });

    test('funciona aunque el sistema esté apagado', async () => {
      await handleEvent(mensaje('pepe', 'hola', true));
      await handleEvent(mensaje('pepe', 'con cebolla'));

      killswitch.disable('test');
      await handleEvent(mensaje('pepe', '!olvidame'));

      // El mensaje de confirmación no sale (el killswitch bloquea la salida),
      // pero el borrado ocurre igual. Nadie debería tener que esperar a que el
      // bot esté encendido para que le olviden.
      assert.equal(recuerdosDe('pepe').length, 0);
      assert.equal(users.find('id-pepe'), null);
    });
  });
});
