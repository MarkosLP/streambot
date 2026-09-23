import { test, describe, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';

import { configureDatabase, truncateAll } from '../data/db.js';
import * as cooldowns from './cooldowns.js';
import * as policy from './policy.js';
import * as killswitch from './killswitch.js';
import { setSender } from './output.js';
import * as interactionLog from '../data/interactions.js';
import * as engine from './engine.js';
import type { Ctx, Interaction } from './interaction.js';

/**
 * El motor, probado solo.
 *
 * Las interacciones de verdad tienen sus propios tests. Estos comprueban el
 * contrato en sí con interacciones de mentira, que es la única forma de fijar
 * las reglas que TODAS heredan sin depender de ninguna concreta.
 */

let enviados: string[] = [];

const VIEWER = {
  id: 'id-pepe',
  login: 'pepe',
  displayName: 'Pepe',
  isBroadcaster: false,
  isModerator: false,
  isVip: false,
  isSubscriber: false,
  rawRole: null,
};

const CTX: Ctx = { viewer: VIEWER, trigger: 'test' };

/** Interacción mínima que siempre quiere decir algo. */
function habla(overrides: Partial<Interaction<Ctx>> = {}): Interaction<Ctx> {
  return {
    name: 'de-prueba',
    spontaneous: false,
    run: () => ({ text: 'hola' }),
    ...overrides,
  };
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

describe('motor', () => {
  test('sin guardas ni cooldowns, envía y registra', async () => {
    await engine.run(habla(), CTX);

    assert.deepEqual(enviados, ['hola']);
    assert.equal(interactionLog.all()[0]!.status, 'sent');
  });

  test('run() que devuelve null no envía nada', async () => {
    await engine.run(habla({ run: () => null }), CTX);

    assert.deepEqual(enviados, []);
    assert.equal(interactionLog.all().length, 0);
  });

  describe('guardas', () => {
    test('la primera que falla descarta', async () => {
      await engine.run(habla({ guards: [() => ({ ok: false, motivo: 'porque no' })] }), CTX);

      assert.deepEqual(enviados, []);
    });

    test('se comprueban en orden y no se sigue tras la primera que falla', async () => {
      const llamadas: string[] = [];
      await engine.run(
        habla({
          guards: [
            () => {
              llamadas.push('primera');
              return { ok: false, motivo: 'corta aquí' };
            },
            () => {
              llamadas.push('segunda');
              return { ok: true };
            },
          ],
        }),
        CTX,
      );

      assert.deepEqual(llamadas, ['primera']);
    });

    test('un descarte NO se registra por defecto', async () => {
      // "No aplica" le pasa a cada mensaje del chat: registrarlo llenaría la
      // tabla de ruido hasta hacerla inútil.
      await engine.run(habla({ guards: [() => ({ ok: false, motivo: 'no aplica' })] }), CTX);

      assert.equal(interactionLog.all().length, 0);
    });

    test('con registrar:true sí deja constancia', async () => {
      await engine.run(
        habla({ guards: [() => ({ ok: false, motivo: 'entrada inválida', registrar: true })] }),
        CTX,
      );

      const fila = interactionLog.all()[0]!;
      assert.equal(fila.status, 'skipped');
      assert.equal(fila.detail, 'entrada inválida');
    });
  });

  describe('cooldowns', () => {
    const conCooldown = (ms: number) =>
      habla({
        cooldowns: [
          {
            key: () => cooldowns.keys.interaction('de-prueba'),
            ms,
            motivo: (_c, faltan) => `cooldown, faltan ${faltan}s`,
          },
        ],
      });

    test('el segundo intento seguido se bloquea', async () => {
      await engine.run(conCooldown(60_000), CTX);
      await engine.run(conCooldown(60_000), CTX);

      assert.equal(enviados.length, 1);
      assert.match(interactionLog.all()[1]!.detail!, /cooldown, faltan \d+s/);
    });

    test('un cooldown bloqueado SIEMPRE se registra', async () => {
      await engine.run(conCooldown(60_000), CTX);
      await engine.run(conCooldown(60_000), CTX);

      assert.equal(interactionLog.all()[1]!.status, 'skipped');
    });

    test('applies:false lo exime por completo', async () => {
      const def = habla({
        cooldowns: [
          {
            key: () => cooldowns.keys.interaction('de-prueba'),
            ms: 60_000,
            motivo: () => 'nunca',
            applies: (ctx) => ctx.trigger === 'command',
          },
        ],
      });

      await engine.run(def, { ...CTX, trigger: 'channel-point' });
      await engine.run(def, { ...CTX, trigger: 'channel-point' });

      assert.equal(enviados.length, 2);
    });

    test('con dos cooldowns, si el segundo bloquea el primero NO se gasta', async () => {
      // Este es el error clásico y la razón de que el motor los compruebe
      // todos antes de consumir ninguno.
      const def = (): Interaction<Ctx> =>
        habla({
          cooldowns: [
            { key: () => 'libre', ms: 60_000, motivo: () => 'a' },
            { key: () => 'ocupado', ms: 60_000, motivo: () => 'b' },
          ],
        });

      cooldowns.tryConsume('ocupado', 60_000); // el segundo ya está pillado

      await engine.run(def(), CTX);
      assert.deepEqual(enviados, [], 'la llamada se bloquea');

      // Si "libre" se hubiera consumido, esto seguiría a 0.
      assert.equal(cooldowns.remaining('libre', 60_000), 0, 'el primero sigue sin gastar');
    });

    test('una guarda que descarta no gasta el cooldown', async () => {
      const def = habla({
        guards: [() => ({ ok: false, motivo: 'no' })],
        cooldowns: [{ key: () => 'k', ms: 60_000, motivo: () => 'x' }],
      });

      await engine.run(def, CTX);

      assert.equal(cooldowns.remaining('k', 60_000), 0);
    });
  });

  describe('interacciones espontáneas', () => {
    test('una NO espontánea se ejecuta aunque estén apagadas', async () => {
      // La suite corre con los valores por defecto (espontáneas activas), así
      // que esto comprueba lo que sí se puede comprobar aquí: que el motor
      // mira la marca del contrato y no otra cosa.
      await engine.run(habla({ spontaneous: false }), CTX);

      assert.equal(enviados.length, 1);
    });
  });

  describe('describeSkip', () => {
    test('adorna el motivo que se registra', async () => {
      await engine.run(
        habla({
          describeSkip: (motivo, ctx) => `${ctx.trigger}: ${motivo}`,
          guards: [() => ({ ok: false, motivo: 'vacía', registrar: true })],
        }),
        CTX,
      );

      assert.equal(interactionLog.all()[0]!.detail, 'test: vacía');
    });
  });

  describe('registro del envío', () => {
    test('si la salida se bloquea, queda como blocked con el motivo', async () => {
      killswitch.disable('test');

      await engine.run(habla(), CTX);

      const fila = interactionLog.all()[0]!;
      assert.equal(fila.status, 'blocked');
      assert.match(fila.detail!, /killswitch/);
    });

    test('la interacción puede escribir su propio detalle', async () => {
      await engine.run(habla({ run: () => ({ text: 'hola', detail: () => 'lo que yo diga' }) }), CTX);

      assert.equal(interactionLog.all()[0]!.detail, 'lo que yo diga');
    });
  });
});
