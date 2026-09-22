import { config } from '../../config.js';
import { log } from '../../core/logger.js';
import { getDb, nowIso } from '../../data/db.js';

/**
 * Presupuesto y contabilidad de la IA.
 *
 * Dos cosas distintas que conviene no confundir:
 *
 *  - El PRESUPUESTO vive en memoria y cubre la sesión actual (un directo).
 *    Reiniciar el proceso empieza una sesión nueva, que es justo lo que
 *    significa "presupuesto por directo".
 *
 *  - La CONTABILIDAD se persiste en SQLite (tabla `ai_usage`), porque sin
 *    datos reales acumulados la revisión de costes de la Fase 12 sería
 *    adivinar. Es una tabla aparte: la IA no toca la tabla `users`.
 */

/**
 * Precios oficiales por millón de tokens.
 *
 * Si algún día usamos un modelo que no esté aquí, el coste se devuelve como
 * `null` en lugar de inventarse un número. Un coste inventado es peor que
 * no tener coste.
 */
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

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
 * Las lecturas de caché cuestan ~0,1× la entrada y las escrituras ~1,25×
 * (TTL de 5 minutos). Devuelve null si no conocemos el precio del modelo.
 */
export function estimateCost(model: string, usage: Usage): number | null {
  const price = PRICES[model];
  if (!price) return null;

  const input = (usage.inputTokens / 1_000_000) * price.input;
  const cacheRead = (usage.cacheReadTokens / 1_000_000) * price.input * 0.1;
  const cacheWrite = (usage.cacheCreationTokens / 1_000_000) * price.input * 1.25;
  const output = (usage.outputTokens / 1_000_000) * price.output;

  return input + cacheRead + cacheWrite + output;
}

export function remainingUsd(): number {
  return config.ai.budgetPerStreamUsd - spentUsd;
}

/** ¿Queda presupuesto para intentar otra llamada? */
export function canSpend(): boolean {
  return remainingUsd() > 0;
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

export function summary(): {
  sessionId: string;
  calls: number;
  spentUsd: number;
  budgetUsd: number;
  remainingUsd: number;
} {
  return {
    sessionId,
    calls,
    spentUsd,
    budgetUsd: config.ai.budgetPerStreamUsd,
    remainingUsd: remainingUsd(),
  };
}

/** Solo para tests. */
export function reset(): void {
  spentUsd = 0;
  calls = 0;
}
