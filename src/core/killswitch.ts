import { log } from './logger.js';

/**
 * Interruptor de emergencia.
 *
 * Existe desde la Fase 2, antes que cualquier cosa que pueda hablar en el chat,
 * porque el peor escenario del proyecto es un bot diciendo algo raro en directo
 * sin forma rápida de callarlo.
 *
 * Nada sale del sistema sin pasar por aquí: ver core/output.ts.
 *
 * FASE 2: el estado vive en memoria, así que reiniciar el proceso lo reactiva.
 * Es deliberado mientras no haya base de datos (llega en la Fase 3), y por
 * ahora juega a favor: si algo se cuelga, reiniciar deja el sistema operativo.
 */

let enabled = true;
let reason: string | null = null;

export function isEnabled(): boolean {
  return enabled;
}

export function status(): string {
  return enabled ? 'ACTIVO' : `APAGADO (${reason ?? 'sin motivo'})`;
}

export function disable(why: string): void {
  if (!enabled) return;
  enabled = false;
  reason = why;
  log.warn(`INTERRUPTOR DE EMERGENCIA ACCIONADO — ${why}. No saldrá nada al chat.`);
}

export function enable(why: string): void {
  if (enabled) return;
  enabled = true;
  reason = null;
  log.info(`Sistema reactivado — ${why}.`);
}
