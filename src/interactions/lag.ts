import type { ViewerRedeemEvent } from '../core/events.js';
import * as ajustes from '../core/ajustes.js';
import * as consent from '../core/consent.js';
import * as engine from '../core/engine.js';
import type { Ctx, Interaction } from '../core/interaction.js';
import * as streams from '../data/streams.js';
import { adelantarCofre, presente, SIN_DIRECTO_LAG } from './loot/index.js';
import * as jefe from './loot/jefe.js';

/**
 * Lag (28 sep 2026): la imagen se congela 5 s (el filtro Freeze de OBS, en
 * su Action de Streamer.bot). Era la recompensa más cara y en el Loot no
 * pasaba nada. Ahora «congela el tiempo»:
 *   - con un jefe en pie, su reloj se para 30 s (también en la barra de OBS)
 *     y todos siguen pegando;
 *   - sin jefe, el próximo cofre cae ya, en 30 s, para quien esté en el chat.
 */

export const NAME = 'loot-lag';
/** Sin jefe: en cuánto cae el próximo cofre. */
export const COFRE_MS = 30_000;

const limpiar = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();

export const lag: Interaction<Ctx & { trigger: 'channel-point' }> = {
  name: NAME,
  spontaneous: false,
  // Registrados: si la imagen se congela y el bot calla, en el Registro está por qué.
  guards: [
    () => (ajustes.lootActivo() ? { ok: true } : { ok: false, motivo: 'el Loot está apagado', registrar: true }),
    () => (streams.current() ? { ok: true } : { ok: false, motivo: SIN_DIRECTO_LAG, registrar: true }),
    (ctx) => (consent.haPedidoOlvido(ctx.viewer.id) ? { ok: false, motivo: 'pidió el olvido' } : { ok: true }),
  ],
  run: (ctx) => {
    const quien = ctx.viewer.displayName;
    const parado = jefe.congelarReloj();
    if (parado) {
      // Los nombres llevan artículo: «el reloj del Dragón», no «de el Dragón».
      const delJefe = parado.nombre.startsWith('el ') ? `del ${parado.nombre.slice(3)}` : `de ${parado.nombre}`;
      return { text: `📶 ¡El lag de ${quien} congela el tiempo! El reloj ${delJefe} se para ${jefe.CONGELA_MS / 1000} s: ¡seguid pegando! (quedarán ${parado.quedanSeg} s)` };
    }
    const seg = adelantarCofre(COFRE_MS);
    return { text: `📶 ¡El lag de ${quien} descoloca el reloj del servidor! El próximo cofre cae en ${seg} s para quien esté en el chat.` };
  },
};

export const channelPointBinding = {
  matches: (event: ViewerRedeemEvent) => limpiar(event.rewardTitle) === 'lag',
  run: async (event: ViewerRedeemEvent) => {
    presente(event.viewer);
    await engine.run(lag, { viewer: event.viewer, trigger: 'channel-point' as const });
  },
};
