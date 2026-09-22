import { log } from './logger.js';
import * as killswitch from './killswitch.js';

/**
 * Única puerta de salida del sistema.
 *
 * Todo lo que algún día llegue al chat de Twitch pasa por aquí. Tenerlo
 * centralizado desde la Fase 2 es lo que permite que el interruptor de
 * emergencia sea de verdad un interruptor y no una sugerencia.
 *
 * FASE 2: no se envía nada a Twitch. Solo se registra lo que se enviaría.
 * FASE 3: el cuerpo de send() pasa a llamar a SendMessage de Streamer.bot,
 *         y se añade aquí la validación de la capa `policy`.
 */

export interface ChatAction {
  kind: 'chat';
  /** Texto a publicar. En la Fase 3 la capa policy impondrá el límite de 480 caracteres. */
  text: string;
  /** Para los logs y, más adelante, para analytics: quién pidió esta salida. */
  reason: string;
}

export type OutboundAction = ChatAction;

export type SendResult =
  | { sent: true }
  | { sent: false; blocked: 'killswitch' };

export function send(action: OutboundAction): SendResult {
  if (!killswitch.isEnabled()) {
    log.warn(`SALIDA BLOQUEADA por el interruptor de emergencia: "${action.text}"`);
    return { sent: false, blocked: 'killswitch' };
  }

  // FASE 2: nada sale a Twitch todavía. Esto es lo que se enviaría.
  log.info(`[SALIDA · ${action.reason}] ${action.text}`);
  return { sent: true };
}
