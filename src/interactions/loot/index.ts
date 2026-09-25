import { config, MAX_MESSAGE_LENGTH } from '../../config.js';
import type { Viewer, ViewerRedeemEvent } from '../../core/events.js';
import * as ajustes from '../../core/ajustes.js';
import * as consent from '../../core/consent.js';
import * as cooldowns from '../../core/cooldowns.js';
import * as engine from '../../core/engine.js';
import * as killswitch from '../../core/killswitch.js';
import { log } from '../../core/logger.js';
import { send } from '../../core/output.js';
import type { Ctx, Interaction } from '../../core/interaction.js';
import * as interactionLog from '../../data/interactions.js';
import * as lootDb from '../../data/loot.js';
import * as streams from '../../data/streams.js';
import { ESTILO, RAREZAS, etiqueta, tirar, type Azar, type Botin } from './objetos.js';

/**
 * Loot del chat.
 *
 * Tres maneras de conseguir botín:
 *
 *  1. **Cofre**: cada 20-30 minutos de directo cae uno para quien haya escrito
 *     en el chat hace poco. Premia estar y hablar, no solo mirar.
 *  2. **Cofre del tesoro**: se compra con Oro (puntos de canal) y tiene mejores
 *     probabilidades.
 *  3. **Panel**: el botón "Soltar cofre ahora", para cuando quieras tú.
 *
 * Y `!inventario` para ver la mochila. Un Legendario, además, sale en pantalla
 * (ver `setAlLegendario`).
 *
 * Con 1-3 espectadores todo esto tiene sentido desde el primer día: no hace
 * falta gente para que caiga un cofre, basta con una persona hablando.
 */

export const NAME = 'loot';
export const NAME_COFRE_ORO = 'loot-cofre-oro';
export const NAME_INVENTARIO = 'loot-inventario';

// ---------------------------------------------------------------------------
// Quién está activo
// ---------------------------------------------------------------------------

/**
 * Última vez que cada persona escribió. En memoria a propósito: solo importa
 * "ahora", y perderlo al reiniciar no le quita nada a nadie.
 */
const actividad = new Map<string, { viewer: Viewer; at: number }>();

/** Lo llama el manejador con cada mensaje de alguien que cuenta. */
export function registrarActividad(viewer: Viewer, now = Date.now()): void {
  actividad.set(viewer.id, { viewer, at: now });
}

/** Quien ha escrito dentro de la ventana de actividad, y no ha pedido el olvido. */
export function aventureros(now = Date.now()): Viewer[] {
  const limite = now - config.loot.minutosActividad * 60_000;
  const resultado: Viewer[] = [];
  for (const [id, a] of actividad) {
    if (a.at < limite) {
      actividad.delete(id);
      continue;
    }
    if (consent.haPedidoOlvido(id)) continue;
    resultado.push(a.viewer);
  }
  return resultado;
}

// ---------------------------------------------------------------------------
// El Legendario en pantalla
// ---------------------------------------------------------------------------

export type AlLegendario = (quien: string, botin: Botin) => Promise<void>;
let alLegendario: AlLegendario | null = null;

/**
 * Qué hacer cuando cae un Legendario. Se inyecta desde index.ts (enseña el
 * banner en OBS) para que el Loot no dependa de OBS: sin OBS, el Legendario
 * se anuncia en el chat igual.
 */
export function setAlLegendario(fn: AlLegendario | null): void {
  alLegendario = fn;
}

function celebrar(quien: string, botin: Botin): void {
  if (botin.rareza !== 'legendario' || !alLegendario) return;
  // Sin await: el banner dura segundos y el chat no tiene por qué esperarlo.
  alLegendario(quien, botin).catch((err) => log.warn(`Loot: no se pudo enseñar el Legendario (${String(err)})`));
}

// ---------------------------------------------------------------------------
// Soltar un cofre
// ---------------------------------------------------------------------------

export interface Reparto {
  viewer: Viewer;
  botin: Botin;
}

/**
 * El mensaje de un cofre. Uno solo aunque toque a varios: con tres personas,
 * tres mensajes seguidos serían spam.
 *
 * Sin @: el anuncio no debe notificar a nadie. Si no cabe en un mensaje, se
 * corta y se dice cuántos faltan.
 */
export function componerCofre(reparto: Reparto[]): string {
  const hayLegendario = reparto.some((r) => r.botin.rareza === 'legendario');
  const inicio = hayLegendario ? '✨ ¡Cofre LEGENDARIO! ' : '🎁 ¡Ha caído un cofre! ';
  const partes = reparto.map((r) => `${r.viewer.displayName} → ${etiqueta(r.botin)}`);

  let texto = inicio;
  for (let i = 0; i < partes.length; i++) {
    const siguiente = (i === 0 ? '' : ' · ') + partes[i];
    const resto = partes.length - i - 1;
    const cola = resto > 0 ? ` · y ${resto} más (!inventario)` : '';
    if ((texto + siguiente + cola).length > MAX_MESSAGE_LENGTH) {
      return `${texto} · y ${partes.length - i} más (!inventario)`;
    }
    texto += siguiente;
  }
  return texto;
}

export type ResultadoCofre =
  | { ok: true; reparto: Reparto[]; enviado: boolean }
  | { ok: false; motivo: string };

export async function soltarCofre(
  { origen = 'cofre', azar = Math.random, now = Date.now() }: { origen?: 'cofre' | 'panel'; azar?: Azar; now?: number } = {},
): Promise<ResultadoCofre> {
  const gente = aventureros(now);
  if (!gente.length) {
    return { ok: false, motivo: `nadie ha escrito en el chat en los últimos ${config.loot.minutosActividad} minutos` };
  }

  const reparto = gente.map((viewer) => ({ viewer, botin: tirar('cofre', azar) }));
  // Se guarda ANTES de anunciar: si el mensaje no sale (tope por hora, un
  // corte), el botín ya es de quien le tocó y lo verá en !inventario.
  for (const r of reparto) lootDb.guardar(r.viewer.id, r.viewer.displayName, r.botin, origen);

  const outcome = await send({ text: componerCofre(reparto), reason: NAME });
  interactionLog.record({
    interaction: NAME,
    status: outcome.sent ? 'sent' : 'blocked',
    detail: `${origen}: ${reparto.map((r) => `${r.viewer.login}=${r.botin.rareza}`).join(', ')}`,
  });

  for (const r of reparto) celebrar(r.viewer.displayName, r.botin);
  ultimoCofre = now;
  return { ok: true, reparto, enviado: outcome.sent };
}

// ---------------------------------------------------------------------------
// Cofre del tesoro (Oro)
// ---------------------------------------------------------------------------

interface CtxCofreOro extends Ctx {
  trigger: 'channel-point';
  azar: Azar;
}

export const cofreOro: Interaction<CtxCofreOro> = {
  name: NAME_COFRE_ORO,
  spontaneous: false,
  // Sin cooldown: ya lo pone la recompensa en Twitch, y quien paga no espera.
  run: (ctx) => {
    const botin = tirar('oro', ctx.azar);
    // Quien pidió el olvido abre su cofre igual, pero no se le guarda nada.
    const guarda = !consent.haPedidoOlvido(ctx.viewer.id);
    if (guarda) lootDb.guardar(ctx.viewer.id, ctx.viewer.displayName, botin, 'oro');
    celebrar(ctx.viewer.displayName, botin);
    const brillo = botin.rareza === 'legendario' ? ' ✨✨✨' : '';
    return {
      text: `🗝️ @${ctx.viewer.displayName} abre un Cofre del tesoro → ${etiqueta(botin)}${brillo}`,
      allowedMentions: [ctx.viewer.login],
      detail: (o) => (o.sent ? `${botin.rareza}: ${botin.objeto}${guarda ? '' : ' (sin guardar)'}` : `${o.rejection}: ${o.detail}`),
    };
  },
};

function esCofreOro(event: ViewerRedeemEvent): boolean {
  const { cofreRewardId, cofreRewardTitle } = config.loot;
  if (cofreRewardId) return event.rewardId === cofreRewardId;
  return event.rewardTitle.trim().toLowerCase() === cofreRewardTitle.trim().toLowerCase();
}

export const channelPointBinding = {
  matches: esCofreOro,
  run: (event: ViewerRedeemEvent, azar: Azar = Math.random) =>
    engine.run(cofreOro, { viewer: event.viewer, trigger: 'channel-point' as const, azar }),
};

// ---------------------------------------------------------------------------
// !inventario
// ---------------------------------------------------------------------------

export const COMANDO_INVENTARIO = /^!(inventario|inv|mochila)\b/i;

export function componerInventario(displayName: string, inv: lootDb.Inventario): string {
  if (inv.total === 0) {
    return `@${displayName} tu mochila está vacía 🎒 Quédate por el chat: cada 20-30 min cae un cofre para quien esté hablando.`;
  }
  const cuenta = RAREZAS.filter((r) => inv.porRareza[r] > 0)
    .map((r) => `${inv.porRareza[r]} ${ESTILO[r].emoji}`)
    .join(' ');
  const mejor = inv.mejor ? ` · Tu mejor pieza: ${etiqueta(inv.mejor)}` : '';
  return `@${displayName} 🎒 ${inv.total} objeto${inv.total === 1 ? '' : 's'}: ${cuenta}${mejor}`;
}

export const inventario: Interaction<Ctx> = {
  name: NAME_INVENTARIO,
  spontaneous: false,
  cooldowns: [
    {
      key: (ctx) => cooldowns.keys.user(NAME_INVENTARIO, ctx.viewer.id),
      ms: config.loot.inventarioCooldownMs,
      motivo: (_ctx, faltan) => `cooldown, faltan ${faltan}s`,
    },
  ],
  run: (ctx) => ({
    text: componerInventario(ctx.viewer.displayName, lootDb.inventario(ctx.viewer.id)),
    allowedMentions: [ctx.viewer.login],
  }),
};

// ---------------------------------------------------------------------------
// El reloj de los cofres
// ---------------------------------------------------------------------------

let reloj: ReturnType<typeof setTimeout> | null = null;
let proximo: number | null = null;
let ultimoCofre: number | null = null;

/** Programa el siguiente cofre dentro del margen de minutos, al azar. */
function programar(azar: Azar = Math.random): void {
  const { minutosMin, minutosMax } = config.loot;
  const ms = (minutosMin + azar() * Math.max(0, minutosMax - minutosMin)) * 60_000;
  proximo = Date.now() + ms;
  reloj = setTimeout(() => void tic(), ms);
  reloj.unref?.();
}

async function tic(): Promise<void> {
  try {
    const motivo = !ajustes.lootActivo()
      ? 'el Loot está apagado'
      : !killswitch.isEnabled()
        ? 'el bot está apagado'
        : !streams.current()
          ? 'no hay directo en marcha'
          : null;
    if (motivo) {
      log.debug(`Loot: no cae cofre (${motivo}).`);
      return;
    }
    const r = await soltarCofre();
    if (!r.ok) log.info(`Loot: no cae cofre (${r.motivo}).`);
  } catch (err) {
    log.error(`Loot: fallo al soltar un cofre: ${String(err)}`);
  } finally {
    programar();
  }
}

export function arrancar(): void {
  if (reloj) return;
  programar();
  log.info(`Loot del chat: un cofre cada ${config.loot.minutosMin}-${config.loot.minutosMax} min de directo · ${ajustes.lootActivo() ? 'activo' : 'apagado'}.`);
}

export function parar(): void {
  if (reloj) clearTimeout(reloj);
  reloj = null;
  proximo = null;
}

/** Lo que enseña el panel. */
export function estado(now = Date.now()) {
  return {
    activo: ajustes.lootActivo(),
    directo: streams.current() !== null,
    proximoEnSeg: proximo ? Math.max(0, Math.round((proximo - now) / 1000)) : null,
    ultimoCofre: ultimoCofre ? new Date(ultimoCofre).toISOString() : null,
    aventureros: aventureros(now).map((v) => v.displayName),
    minutosActividad: config.loot.minutosActividad,
  };
}

/** Solo para tests. */
export function reset(): void {
  actividad.clear();
  parar();
  ultimoCofre = null;
  alLegendario = null;
}
