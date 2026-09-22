import { createInterface, type Interface } from 'node:readline/promises';
import { log } from './logger.js';
import type { Approver, Verdict } from './review.js';

/**
 * Aprobador por consola: te enseña lo que la IA quiere decir y espera tu "s" o "n".
 *
 * Vive aparte de `review.ts` para que esa capa siga siendo comprobable sin
 * tocar stdin. Aquí está todo lo que huele a terminal.
 */

/** Si no contestas en este tiempo, se descarta. Un directo no puede quedarse colgado. */
const TIMEOUT_MS = 90_000;

let rl: Interface | null = null;

/**
 * Las aprobaciones se encadenan. Sin esto, dos preguntas casi simultáneas
 * dejarían dos prompts compitiendo por la misma tecla.
 */
let queue: Promise<unknown> = Promise.resolve();

function getInterface(): Interface {
  rl ??= createInterface({ input: process.stdin, output: process.stdout });
  return rl;
}

export function closeApprover(): void {
  rl?.close();
  rl = null;
}

async function prompt(text: string, reason: string): Promise<Verdict> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  console.log('\n┌─ REVISIÓN ──────────────────────────────────────────────────');
  console.log(`│ Interacción: ${reason}`);
  console.log('│');
  for (const linea of partir(text, 58)) console.log(`│   ${linea}`);
  console.log('│');
  console.log(`└─ ¿Se publica en Twitch?  s = sí · n = no  (${TIMEOUT_MS / 1000}s)`);

  try {
    const respuesta = await getInterface().question('> ', { signal: controller.signal });
    const limpia = respuesta.trim().toLowerCase();

    if (limpia === 's' || limpia === 'si' || limpia === 'sí') {
      log.info('Revisión: APROBADO, se publica.');
      return { approved: true };
    }

    log.warn('Revisión: RECHAZADO, no se publica.');
    return { approved: false, reason: 'rechazado en revisión' };
  } catch (err) {
    if (controller.signal.aborted) {
      log.warn(`Revisión: sin respuesta en ${TIMEOUT_MS / 1000}s. No se publica.`);
      return { approved: false, reason: 'sin respuesta a tiempo' };
    }
    log.error(`Revisión: fallo leyendo la consola: ${String(err)}. No se publica.`);
    return { approved: false, reason: 'error leyendo la consola' };
  } finally {
    clearTimeout(timer);
  }
}

/** Parte el texto en líneas para que quepa en el recuadro. */
function partir(text: string, ancho: number): string[] {
  const palabras = text.split(' ');
  const lineas: string[] = [];
  let actual = '';

  for (const palabra of palabras) {
    if (actual.length + palabra.length + 1 > ancho) {
      if (actual) lineas.push(actual);
      actual = palabra;
    } else {
      actual = actual ? `${actual} ${palabra}` : palabra;
    }
  }
  if (actual) lineas.push(actual);
  return lineas;
}

export const consoleApprover: Approver = (text, reason) => {
  const siguiente = queue.then(() => prompt(text, reason));
  // La cola no debe romperse si una aprobación falla.
  queue = siguiente.catch(() => undefined);
  return siguiente;
};
