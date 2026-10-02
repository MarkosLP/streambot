import { config } from '../../config.js';
import { log } from '../../core/logger.js';
import { getDb, nowIso } from '../../data/db.js';

/**
 * Presupuesto y contabilidad de la IA.
 *
 * Dos cosas distintas que conviene no confundir:
 *
 *  - Los TOPES deciden si se puede llamar a Anthropic. Hay cuatro y se
 *    comprueban todos: sesión, día, mes y número de llamadas al día.
 *
 *  - La CONTABILIDAD se persiste en SQLite (tabla `ai_usage`), porque sin
 *    datos reales acumulados la revisión de costes de la Fase 12 sería
 *    adivinar. Es una tabla aparte: la IA no toca la tabla `users`.
 *
 * El tope de sesión vive en memoria y cubre el directo actual. Los de día y
 * mes se calculan leyendo `ai_usage`, así que reiniciar el proceso NO los
 * borra. Esa diferencia importa: mientras el único tope era el de sesión,
 * "3 $ por directo" significaba en realidad "3 $ por cada arranque", y
 * trasteando se arranca muchas veces al día.
 */

/**
 * Precios oficiales por millón de tokens.
 *
 * Si algún día usamos un modelo que no esté aquí, el coste se devuelve como
 * `null` en lugar de inventarse un número. Un coste inventado es peor que
 * no tener coste. Para ese caso está el tope de llamadas al día, que no
 * depende de conocer el precio.
 */
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

/**
 * Multiplicadores del caché sobre el precio de entrada.
 *
 * Leer de caché cuesta 0,1x. Escribir cuesta 1,25x con TTL de 5 minutos y
 * 2x con TTL de 1 hora. Por eso el multiplicador de escritura depende del
 * TTL configurado y no es una constante.
 */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER: Record<string, number> = { '5m': 1.25, '1h': 2, off: 1.25 };

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface UsageRecord extends Usage {
  intent: string;
  model: string;
  outcome: string;
  /** null cuando no conocemos el precio del modelo. */
  costUsd: number | null;
  latencyMs: number;
}

const sessionId = `${Date.now().toString(36)}`;
let spentUsd = 0;
let calls = 0;

/**
 * Coste en dólares de una llamada.
 *
 * Devuelve null si no conocemos el precio del modelo.
 */
export function estimateCost(model: string, usage: Usage): number | null {
  const price = PRICES[model];
  if (!price) return null;

  const writeMultiplier = CACHE_WRITE_MULTIPLIER[config.ai.cacheTtl] ?? 1.25;

  const input = (usage.inputTokens / 1_000_000) * price.input;
  const cacheRead = (usage.cacheReadTokens / 1_000_000) * price.input * CACHE_READ_MULTIPLIER;
  const cacheWrite = (usage.cacheCreationTokens / 1_000_000) * price.input * writeMultiplier;
  const output = (usage.outputTokens / 1_000_000) * price.output;

  return input + cacheRead + cacheWrite + output;
}

/** ¿Sabemos cuánto cuesta el modelo configurado? */
export function modelHasKnownPrice(model = config.ai.model): boolean {
  return model in PRICES;
}

// ---------------------------------------------------------------------------
// Ventanas de tiempo
// ---------------------------------------------------------------------------

/**
 * Los límites de día y mes usan la hora LOCAL, no UTC.
 *
 * Un directo de 22:00 a 02:00 cruza la medianoche UTC a mitad de sesión, y
 * con ventanas UTC el tope diario se reiniciaría en mitad del directo. Los
 * cortes tienen que caer donde la persona cree que caen.
 *
 * Se convierte a ISO/UTC solo para comparar, porque así es como la columna
 * `at` guarda las fechas.
 */
export function startOfLocalDay(now = new Date()): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

export function startOfLocalMonth(now = new Date()): string {
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

export interface Ventana {
  spentUsd: number;
  calls: number;
  /** Llamadas cuyo coste no se pudo calcular; no suman en spentUsd. */
  unknownCostCalls: number;
}

/** Lo gastado y lo llamado desde un instante dado. */
export function since(iso: string): Ventana {
  try {
    const row = getDb()
      .prepare(
        `SELECT COALESCE(SUM(cost_usd), 0) AS spent,
                COUNT(*)                   AS calls,
                SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unknown
           FROM ai_usage
          WHERE at >= ?`,
      )
      .get(iso) as any;

    return {
      spentUsd: Number(row?.spent ?? 0),
      calls: Number(row?.calls ?? 0),
      unknownCostCalls: Number(row?.unknown ?? 0),
    };
  } catch (err) {
    // Si no se puede leer la contabilidad no sabemos cuánto llevamos gastado.
    // En ese caso NO se llama a la IA: ante la duda, no se gasta.
    log.error(`No se pudo leer el gasto acumulado: ${String(err)}`);
    return {
      spentUsd: Number.POSITIVE_INFINITY,
      calls: Number.POSITIVE_INFINITY,
      unknownCostCalls: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Topes
// ---------------------------------------------------------------------------

export type Verdict = { ok: true } | { ok: false; reason: string };

/**
 * ¿Se puede hacer otra llamada?
 *
 * Se comprueban los cuatro topes y salta el primero que se haya superado.
 * El mensaje dice CUÁL y con qué cifras, para no tener que abrir la base de
 * datos a mano para entender por qué el bot ha dejado de responder.
 */
export function check(now = new Date()): Verdict {
  const { budgetPerStreamUsd, budgetPerDayUsd, budgetPerMonthUsd, maxCallsPerDay } = config.ai;

  if (spentUsd >= budgetPerStreamUsd) {
    return { ok: false, reason: `tope de sesión: $${spentUsd.toFixed(4)} de $${budgetPerStreamUsd}` };
  }

  const hoy = since(startOfLocalDay(now));

  if (hoy.calls >= maxCallsPerDay) {
    return { ok: false, reason: `tope de llamadas de hoy: ${hoy.calls} de ${maxCallsPerDay}` };
  }

  if (hoy.spentUsd >= budgetPerDayUsd) {
    return { ok: false, reason: `tope de hoy: $${hoy.spentUsd.toFixed(4)} de $${budgetPerDayUsd}` };
  }

  const mes = since(startOfLocalMonth(now));

  if (mes.spentUsd >= budgetPerMonthUsd) {
    return { ok: false, reason: `tope del mes: $${mes.spentUsd.toFixed(4)} de $${budgetPerMonthUsd}` };
  }

  return { ok: true };
}

export function remainingUsd(): number {
  return config.ai.budgetPerStreamUsd - spentUsd;
}

export function record(entry: UsageRecord): void {
  calls += 1;
  if (entry.costUsd !== null) spentUsd += entry.costUsd;

  try {
    getDb()
      .prepare(
        `INSERT INTO ai_usage
           (session_id, at, intent, model, input_tokens, output_tokens,
            cache_read_tokens, cache_creation_tokens, cost_usd, outcome, latency_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionId,
        nowIso(),
        entry.intent,
        entry.model,
        entry.inputTokens,
        entry.outputTokens,
        entry.cacheReadTokens,
        entry.cacheCreationTokens,
        entry.costUsd,
        entry.outcome,
        entry.latencyMs,
      );
  } catch (err) {
    // Que falle la contabilidad no puede tumbar el directo.
    log.warn(`No se pudo registrar el uso de IA: ${String(err)}`);
  }
}

export interface Summary {
  sessionId: string;
  calls: number;
  spentUsd: number;
  budgetUsd: number;
  remainingUsd: number;
  today: Ventana;
  month: Ventana;
  budgetTodayUsd: number;
  budgetMonthUsd: number;
  maxCallsPerDay: number;
}

export function summary(): Summary {
  return {
    sessionId,
    calls,
    spentUsd,
    budgetUsd: config.ai.budgetPerStreamUsd,
    remainingUsd: remainingUsd(),
    today: since(startOfLocalDay()),
    month: since(startOfLocalMonth()),
    budgetTodayUsd: config.ai.budgetPerDayUsd,
    budgetMonthUsd: config.ai.budgetPerMonthUsd,
    maxCallsPerDay: config.ai.maxCallsPerDay,
  };
}

/** Una línea para los logs: dónde estamos respecto a los topes. */
export function describeSpend(): string {
  const s = summary();
  return (
    `sesión $${s.spentUsd.toFixed(4)}/$${s.budgetUsd} · ` +
    `hoy $${s.today.spentUsd.toFixed(4)}/$${s.budgetTodayUsd} ` +
    `(${s.today.calls}/${s.maxCallsPerDay} llamadas) · ` +
    `mes $${s.month.spentUsd.toFixed(4)}/$${s.budgetMonthUsd}`
  );
}

/** Solo para tests. Los topes de día y mes salen de la base de datos. */
export function reset(): void {
  spentUsd = 0;
  calls = 0;
}
