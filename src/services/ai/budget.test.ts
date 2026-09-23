import { test, describe, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';

import { configureDatabase, truncateAll, getDb } from '../../data/db.js';
import { config } from '../../config.js';
import * as budget from './budget.js';

/**
 * Topes de gasto.
 *
 * Lo que de verdad hay que demostrar aquí es que los topes SOBREVIVEN a
 * reiniciar el proceso. El tope de sesión vive en memoria, así que por sí
 * solo no protege de nada: trasteando se arranca el bot diez veces en una
 * tarde y cada arranque empezaba el contador a cero.
 */

before(() => configureDatabase(':memory:'));

beforeEach(() => {
  truncateAll();
  budget.reset();
});

/** Mete una llamada ya cobrada en la contabilidad, con la fecha que queramos. */
function gastoRegistrado(costUsd: number | null, at = new Date().toISOString()): void {
  getDb()
    .prepare(
      `INSERT INTO ai_usage
         (session_id, at, intent, model, input_tokens, output_tokens,
          cache_read_tokens, cache_creation_tokens, cost_usd, outcome, latency_ms)
       VALUES ('test', ?, 'pregunta-ia', 'claude-opus-5', 1000, 50, 0, 0, ?, 'ok', 1000)`,
    )
    .run(at, costUsd);
}

/**
 * Un instante que SEGURO cae dentro del día local en curso.
 *
 * Antes esto era `Date.now() - 60_000`, y parecía razonable hasta que la
 * suite se ejecutó a las 00:00:36: "hace un minuto" era ayer, las ventanas
 * diarias no veían las filas y tres tests fallaban. Un test que solo falla
 * durante 60 segundos al día es peor que uno que falla siempre, porque nadie
 * lo reproduce cuando lo reporta.
 *
 * El instante actual siempre está dentro del día actual, por definición.
 */
function hoyMismo(): string {
  return new Date().toISOString();
}

describe('topes de gasto', () => {
  test('sin gasto previo, se puede llamar', () => {
    assert.equal(budget.check().ok, true);
  });

  describe('el tope diario sobrevive a reiniciar el proceso', () => {
    test('un gasto de hoy bloquea aunque la sesión empiece de cero', () => {
      gastoRegistrado(config.ai.budgetPerDayUsd + 1, hoyMismo());

      // Esto es exactamente lo que pasa al reiniciar: memoria a cero,
      // base de datos intacta.
      budget.reset();

      const verdict = budget.check();
      assert.equal(verdict.ok, false);
      assert.match(verdict.ok === false ? verdict.reason : '', /tope de hoy/);
    });

    test('el gasto de ayer no cuenta para hoy', () => {
      const ayer = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
      gastoRegistrado(config.ai.budgetPerDayUsd + 1, ayer);

      assert.equal(budget.check().ok, true);
    });
  });

  describe('tope mensual', () => {
    test('el gasto acumulado de OTROS días del mes bloquea hoy', () => {
      // El reparto importa. Si todo el gasto cayera hoy saltaría el tope
      // diario y no sabríamos si el mensual funciona, así que se coloca en
      // otros días del mes en curso: hoy queda a cero y aun así no se puede
      // llamar, que es justo lo que tiene que demostrar este test.
      const hoy = new Date();
      const diasDelMes = [1, 2, 3, 4, 5, 6].filter((d) => d !== hoy.getDate()).slice(0, 5);
      const trozo = config.ai.budgetPerMonthUsd / diasDelMes.length + 0.01;

      // Cada día por separado se queda por debajo del tope diario.
      assert.ok(trozo < config.ai.budgetPerDayUsd);

      for (const dia of diasDelMes) {
        const at = new Date(hoy.getFullYear(), hoy.getMonth(), dia, 12, 0, 0).toISOString();
        gastoRegistrado(trozo, at);
      }

      assert.equal(budget.since(budget.startOfLocalDay()).spentUsd, 0);

      const verdict = budget.check();
      assert.equal(verdict.ok, false);
      assert.match(verdict.ok === false ? verdict.reason : '', /tope del mes/);
    });

    test('el gasto del mes pasado no cuenta para este', () => {
      const hoy = new Date();
      const mesPasado = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 15, 12, 0, 0);
      gastoRegistrado(config.ai.budgetPerMonthUsd + 10, mesPasado.toISOString());

      assert.equal(budget.check().ok, true);
    });
  });

  describe('tope de llamadas al día', () => {
    test('protege aunque no se conozca el coste', () => {
      // cost_usd a null es lo que pasa con un modelo que no está en la tabla
      // de precios: los topes en dólares no lo ven. Contar llamadas sí.
      for (let i = 0; i < config.ai.maxCallsPerDay; i += 1) {
        gastoRegistrado(null, hoyMismo());
      }

      const verdict = budget.check();
      assert.equal(verdict.ok, false);
      assert.match(verdict.ok === false ? verdict.reason : '', /tope de llamadas/);
    });

    test('una llamada por debajo del tope no bloquea', () => {
      for (let i = 0; i < config.ai.maxCallsPerDay - 1; i += 1) {
        gastoRegistrado(null, hoyMismo());
      }

      assert.equal(budget.check().ok, true);
    });
  });

  describe('tope de sesión', () => {
    test('el gasto en memoria bloquea sin tocar la base de datos', () => {
      budget.record({
        intent: 'pregunta-ia',
        model: 'claude-opus-5',
        outcome: 'ok',
        costUsd: config.ai.budgetPerStreamUsd + 1,
        latencyMs: 100,
        inputTokens: 1000,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      });

      const verdict = budget.check();
      assert.equal(verdict.ok, false);
      assert.match(verdict.ok === false ? verdict.reason : '', /tope de sesión/);
    });
  });

  describe('ventanas de tiempo', () => {
    test('el día empieza a medianoche LOCAL, no UTC', () => {
      const inicio = new Date(budget.startOfLocalDay(new Date('2026-09-23T15:00:00Z')));

      assert.equal(inicio.getHours(), 0);
      assert.equal(inicio.getMinutes(), 0);
      assert.equal(inicio.getSeconds(), 0);
    });

    test('el mes empieza el día 1 local', () => {
      const inicio = new Date(budget.startOfLocalMonth(new Date('2026-09-23T15:00:00Z')));

      assert.equal(inicio.getDate(), 1);
      assert.equal(inicio.getHours(), 0);
    });
  });

  describe('contabilidad', () => {
    test('since() suma el gasto y cuenta las llamadas sin precio', () => {
      gastoRegistrado(0.01, hoyMismo());
      gastoRegistrado(0.02, hoyMismo());
      gastoRegistrado(null, hoyMismo());

      const ventana = budget.since(budget.startOfLocalDay());

      assert.equal(ventana.calls, 3);
      assert.ok(Math.abs(ventana.spentUsd - 0.03) < 1e-9);
      assert.equal(ventana.unknownCostCalls, 1);
    });
  });
});

describe('cálculo del coste', () => {
  test('un modelo desconocido no se inventa un precio', () => {
    const coste = budget.estimateCost('modelo-inventado', {
      inputTokens: 1000,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });

    assert.equal(coste, null);
    assert.equal(budget.modelHasKnownPrice('modelo-inventado'), false);
    assert.equal(budget.modelHasKnownPrice('claude-opus-5'), true);
  });

  test('leer de caché cuesta la décima parte que la entrada normal', () => {
    const normal = budget.estimateCost('claude-opus-5', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    const desdeCache = budget.estimateCost('claude-opus-5', {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
      cacheCreationTokens: 0,
    });

    assert.equal(normal, 5);
    assert.ok(Math.abs(desdeCache! - 0.5) < 1e-9);
  });

  test('escribir en caché con TTL de 1 hora cuesta el doble que la entrada', () => {
    // El TTL por defecto del proyecto es 1h, y su multiplicador de escritura
    // es 2x (con 5m sería 1,25x). Si esto cambia, el gasto registrado dejaría
    // de cuadrar con la factura real.
    assert.equal(config.ai.cacheTtl, '1h');

    const escritura = budget.estimateCost('claude-opus-5', {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 1_000_000,
    });

    assert.equal(escritura, 10);
  });

  test('la salida de Opus 5 cuesta 25 $ el millón', () => {
    const coste = budget.estimateCost('claude-opus-5', {
      inputTokens: 0,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });

    assert.equal(coste, 25);
  });
});
