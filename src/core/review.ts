import * as ajustes from './ajustes.js';
import { log } from './logger.js';

/**
 * Modo revisión: aprobación manual antes de publicar.
 *
 * Mitigación del riesgo R2 de docs/04: ante Twitch, de lo que diga el bot
 * respondes tú. Durante los primeros directos, nada de lo que genere Claude
 * sale al chat sin que lo veas.
 *
 * Se aplica SOLO a texto generado por IA. Los mensajes deterministas —el
 * saludo de `primer-mensaje`, los textos de reserva— salen directos: ya
 * sabemos exactamente qué dicen, revisarlos no aporta nada y haría el
 * directo insoportable.
 *
 * El aprobador se INYECTA, igual que el emisor de `output.ts`. Así los tests
 * y el simulador recorren este mismo código sin tocar la consola.
 */

export type Verdict = { approved: true } | { approved: false; reason: string };

/** Recibe el texto y quién lo pide; decide si se publica. */
export type Approver = (text: string, reason: string) => Promise<Verdict>;

let approver: Approver | null = null;

export function setApprover(fn: Approver | null): void {
  approver = fn;
}

export function isEnabled(): boolean {
  return ajustes.modoRevision();
}

/**
 * Pide aprobación si procede.
 *
 * Sin modo revisión, o si el texto no lo generó la IA, aprueba sin preguntar.
 */
export async function review(
  text: string,
  reason: string,
  aiGenerated: boolean,
): Promise<Verdict> {
  if (!ajustes.modoRevision() || !aiGenerated) return { approved: true };

  if (!approver) {
    // Fallar cerrado, no abierto: si el modo revisión está activo y no hay
    // nadie que apruebe, NO se publica. Lo contrario sería que la protección
    // desapareciera justo cuando está mal configurada.
    log.error('Modo revisión activo pero no hay aprobador configurado. No se publica.');
    return { approved: false, reason: 'sin aprobador configurado' };
  }

  return approver(text, reason);
}
