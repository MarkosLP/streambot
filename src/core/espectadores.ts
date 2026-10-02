import * as streams from '../data/streams.js';

/**
 * Cuántos miran ahora, para el contador de OBS (biblioteca/overlays/espectadores.html,
 * 2 oct 2026). El número es el de Twitch: llega de Streamer.bot con
 * `Twitch.ViewerCountUpdate`, más o menos cada minuto mientras hay directo.
 * No es la lista del chat: esa incluye bots y no cuenta a quien mira sin estar.
 *
 * Solo en memoria: al reiniciar el bot, el contador espera al siguiente aviso.
 */

/** Sin avisos en este tiempo, el número ya no se da por bueno. */
export const CADUCA_MS = 15 * 60_000;

let ultimo: { n: number; at: number } | null = null;

export function apuntar(n: number, now = Date.now()): void {
  ultimo = { n: Math.max(0, Math.round(n)), at: now };
}

/** El número para el overlay, o null sin directo o sin un aviso reciente (la placa se oculta). */
export function actual(now = Date.now()): number | null {
  if (!ultimo || !streams.current() || now - ultimo.at > CADUCA_MS) return null;
  return ultimo.n;
}

/** Al terminar el directo, el número de hoy no vale para el siguiente. */
export function reset(): void {
  ultimo = null;
}
