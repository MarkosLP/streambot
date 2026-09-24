import { randomUUID } from 'node:crypto';
import { log } from '../core/logger.js';
import type { Approver, Verdict } from '../core/review.js';

/**
 * Revisión desde el panel.
 *
 * Cada texto de la IA que espera aprobación queda aquí como "pendiente"
 * hasta que alguien decide. Puede decidir el panel o la consola, y gana el
 * primero: el otro se retira. Así puedes tener el panel abierto en una
 * pantalla y la terminal en otra, sin que ninguno de los dos se quede
 * esperando algo que ya se resolvió.
 *
 * Las reglas de siempre no cambian: si nadie contesta a tiempo, NO se
 * publica. Fallar cerrado.
 */

export const TIMEOUT_MS = 90_000;

/** Pregunta a la consola, cancelable. La inyecta index.ts; los tests no la usan. */
export type PreguntaConsola = (text: string, reason: string, signal: AbortSignal) => Promise<Verdict>;

interface Pendiente {
  id: string;
  text: string;
  reason: string;
  creado: string;
  caduca: string;
  decidir: (v: Verdict) => void;
}

const pendientes = new Map<string, Pendiente>();

export interface PendienteVista {
  id: string;
  text: string;
  reason: string;
  creado: string;
  caduca: string;
}

export function lista(): PendienteVista[] {
  return [...pendientes.values()].map(({ id, text, reason, creado, caduca }) => ({
    id,
    text,
    reason,
    creado,
    caduca,
  }));
}

/** Devuelve false si el id no existe: ya se decidió, o caducó. */
export function decidir(id: string, aprobado: boolean): boolean {
  const p = pendientes.get(id);
  if (!p) return false;

  if (aprobado) log.info('Revisión (panel): APROBADO, se publica.');
  else log.warn('Revisión (panel): RECHAZADO, no se publica.');

  p.decidir(aprobado ? { approved: true } : { approved: false, reason: 'rechazado en revisión' });
  return true;
}

export function aprobadorPanel(consola?: PreguntaConsola, timeoutMs = TIMEOUT_MS): Approver {
  return (text, reason) =>
    new Promise<Verdict>((resolve) => {
      const id = randomUUID();
      const retirarConsola = new AbortController();
      let resuelto = false;

      const terminar = (v: Verdict) => {
        if (resuelto) return;
        resuelto = true;
        clearTimeout(timer);
        pendientes.delete(id);
        retirarConsola.abort();
        resolve(v);
      };

      const timer = setTimeout(() => {
        log.warn(`Revisión: sin respuesta en ${timeoutMs / 1000}s. No se publica.`);
        terminar({ approved: false, reason: 'sin respuesta a tiempo' });
      }, timeoutMs);

      const ahora = Date.now();
      pendientes.set(id, {
        id,
        text,
        reason,
        creado: new Date(ahora).toISOString(),
        caduca: new Date(ahora + timeoutMs).toISOString(),
        decidir: terminar,
      });

      consola?.(text, reason, retirarConsola.signal).then(
        // Si la consola contesta porque la hemos retirado, su respuesta no cuenta.
        (v) => {
          if (!retirarConsola.signal.aborted) terminar(v);
        },
        () => {
          if (!retirarConsola.signal.aborted) {
            terminar({ approved: false, reason: 'error leyendo la consola' });
          }
        },
      );
    });
}

/** Solo para tests. */
export function reset(): void {
  for (const p of pendientes.values()) p.decidir({ approved: false, reason: 'reset' });
  pendientes.clear();
}
