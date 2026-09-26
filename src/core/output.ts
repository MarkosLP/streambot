import { config } from '../config.js';
import { log } from './logger.js';
import * as policy from './policy.js';
import * as review from './review.js';
import type { OutboundMessage, PolicyRejection } from './policy.js';

/**
 * Única puerta de salida del sistema.
 *
 * Todo lo que llega al chat de Twitch pasa por aquí, y aquí se llama a
 * `policy.evaluate()` SIEMPRE. Que la validación sea obligatoria no depende
 * de que quien escriba una interacción se acuerde de invocarla: no hay otro
 * camino hacia el chat.
 *
 * El envío real se INYECTA (`setSender`) en lugar de importarse. Dos motivos:
 *  1. Rompe el ciclo output -> transport -> handler -> interacción -> output.
 *  2. Los tests y el simulador enchufan un emisor falso y ejercitan
 *     exactamente esta misma función, sin tocar Twitch.
 */

export type Sender = (text: string) => Promise<void>;

let sender: Sender | null = null;

export function setSender(fn: Sender | null): void {
  sender = fn;
}

export type SendOutcome =
  | { sent: true; dryRun: boolean }
  | {
      sent: false;
      rejection: PolicyRejection | 'no-sender' | 'transport-error' | 'not-approved';
      detail: string;
    };

export async function send(message: OutboundMessage): Promise<SendOutcome> {
  const verdict = policy.evaluate(message);

  if (!verdict.ok) {
    log.warn(`SALIDA BLOQUEADA (${verdict.rejection}) en "${message.reason}": ${verdict.detail}`);
    log.debug(`Texto rechazado: ${message.text}`);
    return { sent: false, rejection: verdict.rejection, detail: verdict.detail };
  }

  // Modo revisión: DESPUÉS de policy y ANTES de publicar. Ese orden importa:
  // lo que ya ha rechazado la política no merece ni que lo mires.
  const approval = await review.review(verdict.text, message.reason, message.aiGenerated === true);
  if (!approval.approved) {
    log.warn(`SALIDA NO APROBADA en "${message.reason}": ${approval.reason}`);
    return { sent: false, rejection: 'not-approved', detail: approval.reason };
  }

  if (config.dryRun) {
    log.info(`[SIMULADO · ${message.reason}] ${verdict.text}`);
    policy.registerSent(Date.now(), message.solicitado === true);
    return { sent: true, dryRun: true };
  }

  if (!sender) {
    log.error(`No hay emisor configurado; el mensaje de "${message.reason}" no sale.`);
    return { sent: false, rejection: 'no-sender', detail: 'setSender() no se ha llamado' };
  }

  try {
    await sender(verdict.text);
    policy.registerSent(Date.now(), message.solicitado === true);
    log.info(`[ENVIADO · ${message.reason}] ${verdict.text}`);
    return { sent: true, dryRun: false };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log.error(`Fallo al enviar el mensaje de "${message.reason}": ${detail}`);
    return { sent: false, rejection: 'transport-error', detail };
  }
}
