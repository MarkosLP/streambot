import type { ViewerRedeemEvent } from '../core/events.js';
import { log } from '../core/logger.js';
import * as engine from '../core/engine.js';
import { presente } from './loot/index.js';
import * as jefe from './loot/jefe.js';

/**
 * Terremoto: al canjear la recompensa, la imagen del juego tiembla 5 s.
 *
 * El sonido lo pone Streamer.bot (su Action «Efecto - Terremoto»); el
 * temblor lo hace el bot moviendo la fuente por el WebSocket de OBS. Sin
 * plugins. El temblor se inyecta desde index.ts, como la pantalla del Loot.
 */

export type Temblor = () => Promise<void>;
let temblor: Temblor | null = null;
let temblando = false;

export function setTemblor(fn: Temblor | null): void {
  temblor = fn;
}

/** Tiembla, si no está temblando ya. Devuelve si ha empezado. */
export function temblar(): boolean {
  if (!temblor || temblando) return false;
  temblando = true;
  temblor()
    .catch((err) => log.warn(`Terremoto: no ha temblado (${err instanceof Error ? err.message : String(err)}).`))
    .finally(() => { temblando = false; });
  return true;
}

const limpiar = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();

/** Los canjes de Terremoto, en fila (ver abajo). */
let fila: Promise<void> = Promise.resolve();

export const channelPointBinding = {
  matches: (event: ViewerRedeemEvent) => limpiar(event.rewardTitle) === 'terremoto',
  // Sin await: el temblor dura 5 s y el resto de eventos no tiene por qué esperarlo.
  run: async (event: ViewerRedeemEvent) => {
    if (temblar()) log.info(`Terremoto de ${event.viewer.displayName}: tiembla la imagen.`);
    // Su lado del Loot (28 sep 2026): sale un jefe, o le cae el techo al que hay.
    presente(event.viewer);
    // De uno en uno, cada uno con sus mensajes ya dichos: el laboratorio vio
    // «el techo cae sobre la Hidra» antes de «¡Aparece la Hidra!», y el jefe
    // nuevo anunciado antes del reparto del que acababa de caer.
    const turno = fila.then(() => engine.run(jefe.terremoto, { viewer: event.viewer, trigger: 'channel-point' as const, azar: Math.random }));
    fila = turno.catch(() => {});
    await turno;
  },
};

/** Solo para tests. */
export function reset(): void {
  temblor = null;
  temblando = false;
  fila = Promise.resolve();
}
