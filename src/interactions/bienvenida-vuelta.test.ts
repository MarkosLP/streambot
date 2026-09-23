import { test, describe, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';

import { configureDatabase, truncateAll, getDb } from '../data/db.js';
import { config } from '../config.js';
import { normalize } from '../core/events.js';
import { handleEvent } from '../core/handler.js';
import { setSender } from '../core/output.js';
import * as cooldowns from '../core/cooldowns.js';
import * as policy from '../core/policy.js';
import * as killswitch from '../core/killswitch.js';
import * as users from '../data/users.js';
import * as streams from '../data/streams.js';
import { NAME, componer, diasDesde, vuelve, umbralDias } from './bienvenida-vuelta.js';

/**
 * #18 Bienvenida de Vuelta.
 *
 * El criterio de hecho de la Fase 6 pide literalmente: "simulas un usuario
 * visto hace 20 días y el bot lo reconoce al volver". Ese es el test de
 * `reconoce a quien vuelve tras 20 días`, y el resto cubre los bordes.
 */

let enviados: string[] = [];

const DIA_MS = 24 * 60 * 60 * 1000;

function mensaje(login: string, texto = 'hola', primerMensaje = false) {
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

/** Deja a alguien registrado como visto hace N días. */
function vistoHace(login: string, dias: number): void {
  const cuando = new Date(Date.now() - dias * DIA_MS).toISOString();
  getDb()
    .prepare(
      'INSERT INTO users (twitch_id, login, display_name, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)',
    )
    .run(`id-${login}`, login, login, cuando, cuando);
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

describe('bienvenida de vuelta', () => {
  describe('el criterio de hecho de la Fase 6', () => {
    test('reconoce a quien vuelve tras 20 días', async () => {
      vistoHace('pepe', 20);

      await handleEvent(mensaje('pepe'));

      assert.equal(enviados.length, 1);
      assert.match(enviados[0]!, /@pepe/);
      assert.match(enviados[0]!, /20 días/);
    });

    test('y deja constancia con los días de ausencia', async () => {
      vistoHace('pepe', 20);

      await handleEvent(mensaje('pepe'));

      const fila = getDb()
        .prepare("SELECT status, detail FROM interactions WHERE interaction = ?")
        .get(NAME) as { status: string; detail: string };

      assert.equal(fila.status, 'sent');
      assert.match(fila.detail, /20 días/);
    });
  });

  describe('cuándo NO se dispara', () => {
    test('quien estuvo ayer no está volviendo', async () => {
      vistoHace('pepe', 1);

      await handleEvent(mensaje('pepe'));

      assert.deepEqual(enviados, []);
    });

    test('justo por debajo del umbral, todavía no', async () => {
      vistoHace('pepe', umbralDias() - 1);

      await handleEvent(mensaje('pepe'));

      assert.deepEqual(enviados, []);
    });

    test('justo en el umbral, sí', async () => {
      vistoHace('pepe', umbralDias());

      await handleEvent(mensaje('pepe'));

      assert.equal(enviados.length, 1);
    });

    test('alguien nuevo no puede "volver"', () => {
      const veredicto = vuelve(null, true);

      assert.equal(veredicto.ok, false);
      assert.match(veredicto.ok === false ? veredicto.motivo : '', /primera vez/);
    });

    test('no saluda dos veces en el mismo mensaje seguido', async () => {
      vistoHace('pepe', 30);

      await handleEvent(mensaje('pepe'));
      await handleEvent(mensaje('pepe', 'sigo aquí'));

      // El segundo mensaje ya tiene last_seen de hace un instante.
      assert.equal(enviados.length, 1);
    });
  });

  describe('convivencia con #1 Primer Mensaje', () => {
    test('un primer mensaje de verdad va a #1, no a #18', async () => {
      await handleEvent(mensaje('nuevo', 'hola', true));

      assert.equal(enviados.length, 1);
      assert.match(enviados[0]!, /primera vez que te leo/);
    });

    test('quien vuelve NO recibe el saludo de primerizo', async () => {
      vistoHace('pepe', 40);

      await handleEvent(mensaje('pepe'));

      assert.equal(enviados.length, 1);
      assert.doesNotMatch(enviados[0]!, /primera vez que te leo/);
    });

    test('las dos interacciones no se disparan a la vez', async () => {
      vistoHace('pepe', 40);

      await handleEvent(mensaje('pepe'));

      const filas = getDb()
        .prepare('SELECT interaction FROM interactions')
        .all() as Array<{ interaction: string }>;

      assert.equal(filas.length, 1);
      assert.equal(filas[0]!.interaction, NAME);
    });
  });

  describe('el cooldown evita el spam de vueltas', () => {
    test('si vuelven dos a la vez, solo habla de uno', async () => {
      vistoHace('pepe', 30);
      vistoHace('ana', 30);

      await handleEvent(mensaje('pepe'));
      await handleEvent(mensaje('ana'));

      assert.equal(enviados.length, 1);
    });
  });

  describe('el texto', () => {
    test('no suena a reproche en ninguno de los tramos', () => {
      for (const dias of [14, 20, 45, 120, 400]) {
        const texto = componer('pepe', dias);
        assert.doesNotMatch(texto, /no vienes|no apareces|abandonad|te has olvidado/i);
        assert.match(texto, /^@pepe /);
      }
    });

    test('el tramo cambia con el tiempo de ausencia', () => {
      assert.notEqual(componer('pepe', 15), componer('pepe', 400));
      assert.match(componer('pepe', 400), /año/);
    });
  });

  describe('cálculo de días', () => {
    test('redondea hacia abajo', () => {
      const casi = new Date(Date.now() - (2 * DIA_MS + 20 * 60 * 60 * 1000)).toISOString();
      assert.equal(diasDesde(casi), 2);
    });

    test('una fecha corrupta no rompe nada', () => {
      assert.equal(diasDesde('esto no es una fecha'), 0);
    });
  });
});

describe('sesiones de directo', () => {
  test('StreamOnline abre una y StreamOffline la cierra', async () => {
    await handleEvent(normalize('Twitch.StreamOnline', {}, 'simulator'));

    const abierto = streams.current();
    assert.ok(abierto);
    assert.equal(abierto!.ended_at, null);

    await handleEvent(normalize('Twitch.StreamOffline', {}, 'simulator'));

    assert.equal(streams.current(), null);
    assert.equal(streams.count(), 1);
  });

  test('dos StreamOnline seguidos no abren dos filas', async () => {
    await handleEvent(normalize('Twitch.StreamOnline', {}, 'simulator'));
    await handleEvent(normalize('Twitch.StreamOnline', {}, 'simulator'));

    assert.equal(streams.count(), 1);
  });

  test('un StreamOffline sin directo abierto no rompe nada', async () => {
    await handleEvent(normalize('Twitch.StreamOffline', {}, 'simulator'));

    assert.equal(streams.count(), 0);
  });

  test('los eventos de directo no escriben en el chat', async () => {
    await handleEvent(normalize('Twitch.StreamOnline', {}, 'simulator'));
    await handleEvent(normalize('Twitch.StreamOffline', {}, 'simulator'));

    assert.deepEqual(enviados, []);
  });
});

describe('users.touch guarda el last_seen anterior', () => {
  test('la segunda aparición recuerda la primera', () => {
    vistoHace('pepe', 20);

    const resultado = users.touch({
      id: 'id-pepe',
      login: 'pepe',
      displayName: 'pepe',
      isBroadcaster: false,
      isModerator: false,
      isVip: false,
      isSubscriber: false,
      rawRole: null,
    });

    assert.equal(resultado.isNew, false);
    assert.ok(resultado.previousLastSeen);
    assert.equal(diasDesde(resultado.previousLastSeen!), 20);
  });

  test('alguien nuevo no tiene anterior', () => {
    const resultado = users.touch({
      id: 'id-nuevo',
      login: 'nuevo',
      displayName: 'nuevo',
      isBroadcaster: false,
      isModerator: false,
      isVip: false,
      isSubscriber: false,
      rawRole: null,
    });

    assert.equal(resultado.isNew, true);
    assert.equal(resultado.previousLastSeen, null);
  });
});

describe('configuración', () => {
  test('el umbral por defecto son los 14 días del catálogo', () => {
    assert.equal(config.bienvenidaVuelta.diasAusencia, 14);
  });
});
