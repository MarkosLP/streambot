import { test, describe, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';

import { configureDatabase, truncateAll, getDb } from '../data/db.js';
import { config } from '../config.js';
import * as memory from './memory.js';
import * as consent from './consent.js';
import * as interactionLog from '../data/interactions.js';

/**
 * Memoria y consentimiento.
 *
 * Estos dos van juntos a propósito: el criterio de hecho de la Fase 8 pide
 * que `!olvidame` borre todo *"verificado consultando la BD, no supuesto"*,
 * y que *"nada de lo guardado salga de los temas neutros permitidos"*. Las
 * dos cosas se comprueban aquí contra SQLite de verdad.
 */

const DIA_MS = 24 * 60 * 60 * 1000;

before(() => configureDatabase(':memory:'));
beforeEach(() => truncateAll());

function guardar(twitchId = 'id-pepe', overrides: Partial<memory.Guardar> = {}) {
  return memory.guardar({
    twitchId,
    kind: 'ticket',
    topic: 'comida',
    content: 'tortilla con cebolla',
    ...overrides,
  });
}

/** Mete un recuerdo con las fechas que queramos, para simular el paso del tiempo. */
function recuerdoConFechas(twitchId: string, creado: Date, caduca: Date): void {
  getDb()
    .prepare(
      `INSERT INTO memories (twitch_id, kind, topic, content, created_at, expires_at, used_at)
       VALUES (?, 'ticket', 'comida', 'tortilla con cebolla', ?, ?, NULL)`,
    )
    .run(twitchId, creado.toISOString(), caduca.toISOString());
}

describe('memoria', () => {
  test('guarda y recupera', () => {
    const r = guardar();

    assert.equal(r.ok, true);
    const suyos = memory.de('id-pepe');
    assert.equal(suyos.length, 1);
    assert.equal(suyos[0]!.content, 'tortilla con cebolla');
  });

  describe('lista blanca de temas', () => {
    test('acepta los cuatro permitidos', () => {
      for (const tema of memory.TEMAS) {
        truncateAll();
        assert.equal(guardar('id-pepe', { topic: tema }).ok, true, tema);
      }
    });

    test('rechaza cualquier otro', () => {
      const r = guardar('id-pepe', { topic: 'politica' });

      assert.equal(r.ok, false);
      assert.match(r.ok === false ? r.motivo : '', /fuera de la lista blanca/);
      assert.equal(memory.count(), 0);
    });

    test('el tema lo valida el código, no quien llama', () => {
      // Aunque se cuele por el tipo (una IA devolviendo texto libre, por
      // ejemplo), la comprobación en tiempo de ejecución lo para.
      assert.equal(memory.esTemaPermitido('lo que sea'), false);
    });
  });

  describe('límites de tamaño', () => {
    test('rechaza contenido vacío', () => {
      assert.equal(guardar('id-pepe', { content: '   ' }).ok, false);
    });

    test('rechaza lo que pase del tope de la fila', () => {
      const r = guardar('id-pepe', { content: 'a'.repeat(config.memoria.maxContenido + 1) });

      assert.equal(r.ok, false);
      assert.match(r.ok === false ? r.motivo : '', /el máximo son/);
    });
  });

  describe('caducidad', () => {
    test('el criterio de la Fase 8: tres semanas después sigue ahí', () => {
      const hace3Semanas = new Date(Date.now() - 21 * DIA_MS);
      const caduca = new Date(hace3Semanas.getTime() + config.memoria.diasCaducidad * DIA_MS);
      recuerdoConFechas('id-pepe', hace3Semanas, caduca);

      const suyos = memory.de('id-pepe');
      assert.equal(suyos.length, 1, 'un recuerdo de hace 3 semanas sigue vigente');
    });

    test('un recuerdo caducado NO se devuelve, aunque siga en la tabla', () => {
      const viejo = new Date(Date.now() - 200 * DIA_MS);
      recuerdoConFechas('id-pepe', viejo, new Date(Date.now() - DIA_MS));

      assert.equal(memory.de('id-pepe').length, 0, 'no se lee');
      assert.equal(memory.count(), 1, 'pero sigue en la tabla hasta que se limpie');
    });

    test('limpiarCaducados los borra de verdad', () => {
      recuerdoConFechas('id-pepe', new Date(Date.now() - 200 * DIA_MS), new Date(Date.now() - DIA_MS));
      guardar('id-ana');

      assert.equal(memory.limpiarCaducados(), 1);
      assert.equal(memory.count(), 1, 'el vigente se queda');
    });

    test('por defecto caduca a los 90 días', () => {
      assert.equal(config.memoria.diasCaducidad, 90);
    });
  });

  describe('elegir cuál sacar', () => {
    test('prefiere el más antiguo sin usar', () => {
      const ahora = Date.now();
      recuerdoConFechas('id-pepe', new Date(ahora - 30 * DIA_MS), new Date(ahora + 60 * DIA_MS));
      recuerdoConFechas('id-pepe', new Date(ahora - 5 * DIA_MS), new Date(ahora + 85 * DIA_MS));

      const elegido = memory.paraSacar('id-pepe')!;
      const todos = memory.de('id-pepe');
      const masViejo = todos.reduce((a, b) => (a.created_at < b.created_at ? a : b));

      assert.equal(elegido.id, masViejo.id);
    });

    test('no repite uno ya usado', () => {
      guardar('id-pepe');
      const primero = memory.paraSacar('id-pepe')!;
      memory.marcarUsado(primero.id);

      assert.equal(memory.paraSacar('id-pepe'), null);
    });

    test('sin recuerdos, null', () => {
      assert.equal(memory.paraSacar('id-desconocido'), null);
    });
  });
});

describe('consentimiento', () => {
  test('por defecto nadie ha pedido el olvido', () => {
    assert.equal(consent.haPedidoOlvido('id-pepe'), false);
  });

  describe('!olvidame borra todo — verificado en la base de datos', () => {
    test('borra recuerdos, interacciones, ficha y racha', () => {
      guardar('id-pepe');
      getDb()
        .prepare(
          'INSERT INTO streaks (twitch_id, current, best, last_stream_id, comodin_mes, updated_at) ' +
            'VALUES (?, 4, 4, 1, NULL, ?)',
        )
        .run('id-pepe', new Date().toISOString());
      interactionLog.record({ interaction: 'primer-mensaje', twitchId: 'id-pepe', status: 'sent' });
      getDb()
        .prepare(
          'INSERT INTO users (twitch_id, login, display_name, first_seen, last_seen) VALUES (?,?,?,?,?)',
        )
        .run('id-pepe', 'pepe', 'Pepe', new Date().toISOString(), new Date().toISOString());

      const borrado = consent.olvidar('id-pepe');

      assert.deepEqual(borrado, { memories: 1, interactions: 1, users: 1, streaks: 1 });

      // La comprobación que pide el criterio: se consulta la BD, no se supone.
      const cuenta = (tabla: string) =>
        (getDb().prepare(`SELECT COUNT(*) AS n FROM ${tabla} WHERE twitch_id = ?`).get('id-pepe') as {
          n: number;
        }).n;

      assert.equal(cuenta('memories'), 0);
      assert.equal(cuenta('interactions'), 0);
      assert.equal(cuenta('users'), 0);
      assert.equal(cuenta('streaks'), 0);
    });

    test('no toca los datos de otra persona', () => {
      guardar('id-pepe');
      guardar('id-ana');

      consent.olvidar('id-pepe');

      assert.equal(memory.de('id-ana').length, 1);
    });
  });

  describe('el olvido es permanente', () => {
    test('después de olvidar, no se puede volver a guardar nada suyo', () => {
      consent.olvidar('id-pepe');

      const r = guardar('id-pepe');

      assert.equal(r.ok, false);
      assert.match(r.ok === false ? r.motivo : '', /pidió que no la recordáramos/);
      assert.equal(memory.count(), 0);
    });

    test('y leer sus recuerdos devuelve vacío', () => {
      guardar('id-pepe');
      // Se marca el opt-out a mano, sin borrar, para comprobar que la lectura
      // también respeta la decisión y no solo la escritura.
      getDb()
        .prepare('INSERT INTO consent (twitch_id, opted_out, at) VALUES (?, 1, ?)')
        .run('id-pepe', new Date().toISOString());

      assert.deepEqual(memory.de('id-pepe'), []);
      assert.equal(memory.paraSacar('id-pepe'), null);
    });

    test('se puede deshacer a mano si alguien se arrepiente', () => {
      consent.olvidar('id-pepe');
      consent.volverARecordar('id-pepe');

      assert.equal(consent.haPedidoOlvido('id-pepe'), false);
      assert.equal(guardar('id-pepe').ok, true);
    });
  });
});
