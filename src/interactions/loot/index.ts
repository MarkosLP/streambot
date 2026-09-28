import { ColaTemporal } from '../../core/cola-temporal.js';
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
import * as users from '../../data/users.js';
import * as suscriptores from '../../data/suscriptores.js';
import { esBot } from '../../core/bots.js';
import * as arena from './arena.js';
import { ESTILO, MOCHILA_MAX, NOMBRES_USABLES, RAREZAS, etiqueta, tirar, tirarMaldito, type Azar, type Botin, type TipoCofre } from './objetos.js';
import * as eventos from './eventos.js';
import * as temporada from './temporada.js';

/**
 * Loot del chat.
 *
 * Tres maneras de conseguir botín:
 *
 *  1. **Cofre**: cada 20-30 minutos de directo cae uno para quien haya escrito
 *     en el chat hace poco. Premia estar y hablar, no solo mirar.
 *  2. **Cofre del tesoro**: se compra con Oros (puntos de canal) y tiene mejores
 *     probabilidades.
 *  3. **Panel**: el botón "Soltar cofre ahora", para cuando quieras tú.
 *
 * Y `!inventario` para ver la mochila. Cada botín sale además en pantalla, con
 * el color de su rareza (ver `setPantalla`).
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

/**
 * Todo el que escribe, INCLUIDO el dueño del canal. No recibe cofres (para eso
 * está `actividad`), pero sí se le puede retar a un duelo.
 */
const vistos = new Map<string, { viewer: Viewer; at: number }>();

export function recordarVisto(viewer: Viewer, now = Date.now()): void {
  vistos.set(viewer.login.toLowerCase(), { viewer, at: now });
}

/** Alguien que ha escrito en la ventana de actividad, buscado por su login. */
export function buscarPresente(login: string, now = Date.now()): Viewer | null {
  const v = vistos.get(login.replace(/^@/, '').toLowerCase());
  if (!v || v.at < now - config.loot.minutosActividad * 60_000) return null;
  if (consent.haPedidoOlvido(v.viewer.id)) return null;
  return v.viewer;
}

/**
 * Quién está en el chat AHORA, haya escrito o no. Se lo pregunta a
 * Streamer.bot (sus "Active Viewers"). Se inyecta desde index.ts, como la
 * pantalla, para que el Loot no dependa del transporte.
 */
export type Chatters = () => Promise<Viewer[]>;
let chatters: Chatters | null = null;

export function setChatters(fn: Chatters | null): void {
  chatters = fn;
}

/**
 * Quién juega al Loot: nadie que sea un bot, y el canal solo si
 * LOOT_CANAL_JUEGA (por defecto sí).
 */
export function juega(login: string): boolean {
  const l = login.replace(/^@/, '').trim().toLowerCase();
  if (esBot(l)) return false;
  return l !== config.broadcasterLogin || ajustes.canalJuega();
}

/** Una persona que juega y no ha pedido el olvido. */
function esPersona(v: Viewer): boolean {
  if (!v.id || !v.login) return false;
  if (!juega(v.login)) return false;
  return !consent.haPedidoOlvido(v.id);
}

/**
 * Todo el que está en el chat: lo que diga Streamer.bot, más quien ha escrito
 * hace poco (por si Streamer.bot no contesta o aún no le ha visto).
 */
export async function enElChat(now = Date.now()): Promise<Viewer[]> {
  const gente = new Map<string, Viewer>();
  if (chatters) {
    try {
      for (const v of await chatters()) gente.set(v.id, v);
    } catch (err) {
      log.warn(`Loot: Streamer.bot no dijo quién está en el chat (${err instanceof Error ? err.message : String(err)}).`);
    }
  }
  const limite = now - config.loot.minutosActividad * 60_000;
  for (const { viewer, at } of vistos.values()) if (at >= limite) gente.set(viewer.id, viewer);
  for (const v of aventureros(now)) gente.set(v.id, v);
  return [...gente.values()].filter(esPersona);
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
    // Se mira ahora, no al apuntarle: si apagas «Yo también juego» después de
    // haber escrito, el canal no puede seguir recibiendo cofres 15 minutos.
    // (Lo encontró el laboratorio de pruebas, 26 sep 2026.)
    if (!juega(a.viewer.login)) continue;
    resultado.push(a.viewer);
  }
  return resultado;
}

// ---------------------------------------------------------------------------
// El botín en pantalla
// ---------------------------------------------------------------------------

export type OrigenPantalla = 'cofre' | 'oro' | 'panel' | 'regalo' | 'jefe' | 'fidelidad' | 'suscriptor' | 'raid' | 'bits' | 'prueba' | 'forja' | 'presumir' | 'guerra' | 'maldicion' | 'purificar';
export type Pantalla = (quien: string, botin: Botin, origen: OrigenPantalla) => Promise<void>;
let pantalla: Pantalla | null = null;
const fila = new ColaTemporal<() => Promise<void>>((mostrar) => mostrar(), (err) => log.warn(`Loot: el botín no salió en pantalla (${String(err)}).`));
export const estadoPantalla = () => ({ pendientes: fila.pendientes, descartados: fila.descartados });

/**
 * Cómo se enseña un botín en pantalla. Se inyecta desde index.ts (el banner
 * de OBS) para que el Loot no dependa de OBS: sin OBS, el botín se anuncia en
 * el chat igual.
 */
export function setPantalla(fn: Pantalla | null): void {
  pantalla = fn;
  fila.vaciar();
}

/**
 * Enseña un botín en pantalla. Van EN FILA: si un cofre toca a tres, salen
 * los tres banners uno detrás de otro, sin pisarse.
 *
 * Sin await para quien llama: el banner dura segundos y el chat no tiene por
 * qué esperarlo. Devuelve si había pantalla a la que mandarlo.
 */
export function enPantalla(quien: string, botin: Botin, origen: OrigenPantalla): boolean {
  if (!pantalla) return false;
  const mostrar = pantalla;
  const aceptado = fila.encolar(() => mostrar(quien, botin, origen));
  if (!aceptado && fila.descartados % 20 === 1) log.warn('Loot: cola de pantalla llena; los objetos siguen guardados en la mochila.');
  return aceptado;
}

// ---------------------------------------------------------------------------
// Soltar un cofre
// ---------------------------------------------------------------------------

export interface Reparto {
  viewer: Viewer;
  botin: Botin;
  /** Qué pasó al meterlo en la mochila. Sin él, se da por guardado sin más. */
  resultado?: lootDb.Resultado;
}

/** `crid4n «Cazatesoros»`: el nombre con su título, si lo tiene. */
/** `crid4n 💜 «Cazatesoros»`: el nombre, la marca de suscriptor (S4) y el título. */
export function conTitulo(viewer: Viewer): string {
  const t = lootDb.titulo(viewer.id);
  const sub = suscriptores.esSub(viewer.id) ? ' 💜' : '';
  return `${viewer.displayName}${sub}${t ? ` «${t}»` : ''}`;
}

/** Lo que hay que contar además del objeto: mochila llena, lo que se tiró. */
export function notaMochila(r?: lootDb.Resultado): string {
  if (!r) return '';
  if (!r.guardado) return ' (mochila llena: se queda en el suelo)';
  if (r.sustituido) return ` (tira ${etiqueta(r.sustituido)} para hacer sitio)`;
  return '';
}

/** `🏆 crid4n gana el título «Cazatesoros»`, si alguien lo acaba de ganar. */
export function anunciosDeTitulo(reparto: Reparto[]): string {
  return reparto
    .filter((r) => r.resultado?.tituloNuevo)
    .map((r) => ` · 🏆 ${r.viewer.displayName} completa una colección: «${r.resultado!.tituloNuevo}»`)
    .join('');
}

/**
 * El mensaje de un cofre. Uno solo aunque toque a varios: con tres personas,
 * tres mensajes seguidos serían spam.
 *
 * Sin @: el anuncio no debe notificar a nadie. Si no cabe en un mensaje, se
 * corta y se dice cuántos faltan.
 */
export function componerCofre(reparto: Reparto[], inicioPropio?: string): string {
  const hayLegendario = reparto.some((r) => r.botin.rareza === 'legendario');
  const inicio = inicioPropio ?? (hayLegendario ? '✨ ¡Cofre LEGENDARIO! ' : '🎁 ¡Ha caído un cofre! ');
  const partes = reparto.map((r) => `${conTitulo(r.viewer)} → ${etiqueta(r.botin)}${notaMochila(r.resultado)}`);
  const titulos = anunciosDeTitulo(reparto);

  let texto = inicio;
  for (let i = 0; i < partes.length; i++) {
    const siguiente = (i === 0 ? '' : ' · ') + partes[i];
    const resto = partes.length - i - 1;
    const cola = resto > 0 ? ` · y ${resto} más (!inventario)` : '';
    if ((texto + siguiente + cola + titulos).length > MAX_MESSAGE_LENGTH) {
      return `${texto} · y ${partes.length - i} más (!inventario)`;
    }
    texto += siguiente;
  }
  return texto + titulos;
}

// ---------------------------------------------------------------------------
// El cofre en el suelo
// ---------------------------------------------------------------------------

/** Un cofre de guerra que cayó sin nadie en el chat. */
let enElSuelo: { de: string; hasta: number } | null = null;
const SUELO_MS = 10 * 60_000;

/**
 * Lo llama el manejador con cada mensaje de una persona (nunca bots ni el
 * canal). Si hay un cofre en el suelo, se lo lleva ella.
 *
 * La decisión es síncrona: el cofre sale del suelo ANTES del primer await,
 * así que dos mensajes seguidos no se lo pueden llevar los dos.
 */
export function recogerDelSuelo(viewer: Viewer, azar: Azar = Math.random, now = Date.now()): Promise<void> | null {
  if (!enElSuelo) return null;
  if (enElSuelo.hasta < now) {
    enElSuelo = null;
    return null;
  }
  if (!ajustes.lootActivo() || consent.haPedidoOlvido(viewer.id)) return null;
  const { de } = enElSuelo;
  enElSuelo = null;
  const botin = tirar('guerra', azar);
  const resultado = lootDb.dar(viewer.id, viewer.displayName, botin, 'guerra');
  enPantalla(viewer.displayName, botin, 'guerra');
  return send({
    text: `⚔️ @${viewer.displayName} llega el primero y abre el cofre de guerra de ${de} → ${etiqueta(botin)}${notaMochila(resultado)}${anunciosDeTitulo([{ viewer, botin, resultado }])}`,
    reason: NAME,
    allowedMentions: [viewer.login],
    solicitado: true,
  }).then((o) => {
    interactionLog.record({ interaction: NAME, twitchId: viewer.id, status: o.sent ? 'sent' : 'blocked', detail: `suelo: ${botin.rareza}` });
  });
}

// ---------------------------------------------------------------------------
// Cofre de fidelidad
// ---------------------------------------------------------------------------

/** Directos seguidos a partir de los que cae el cofre de fidelidad. */
export const RACHA_FIDELIDAD = 3;

/**
 * Premio por venir seguido (26 sep 2026): desde el tercer directo seguido,
 * el primer mensaje de cada directo trae un cofre con la suerte del Cofre
 * del tesoro. Con pocos espectadores, lo que más importa es que vuelvan.
 *
 * Solo en el PRIMER mensaje del directo: la racha llega como 'continua' o
 * 'comodin' una vez por directo; los siguientes mensajes son 'repetida'.
 * Decisión síncrona, envío después (mismo motivo que recogerDelSuelo).
 */
export function cofreFidelidad(
  viewer: Viewer,
  racha: { tipo: string; racha: number },
  azar: Azar = Math.random,
): Promise<void> | null {
  if (racha.tipo !== 'continua' && racha.tipo !== 'comodin') return null;
  if (racha.racha < RACHA_FIDELIDAD) return null;
  if (!ajustes.lootActivo() || !esPersona(viewer)) return null;
  const botin = tirar('oro', azar);
  const resultado = lootDb.dar(viewer.id, viewer.displayName, botin, 'fidelidad');
  enPantalla(viewer.displayName, botin, 'fidelidad');
  return send({
    text: `🔥 @${viewer.displayName}, ${racha.racha} directos seguidos: ¡cofre de fidelidad! → ${etiqueta(botin)}` +
      `${botin.rareza === 'legendario' ? ' ✨✨✨' : ''}${notaMochila(resultado)}${anunciosDeTitulo([{ viewer, botin, resultado }])}`,
    reason: NAME,
    allowedMentions: [viewer.login],
  }).then((o) => {
    interactionLog.record({ interaction: NAME, twitchId: viewer.id, status: o.sent ? 'sent' : 'blocked', detail: `fidelidad ${racha.racha}: ${botin.rareza}` });
  });
}

/**
 * Una tirada de cofre con el evento de la semana aplicado (eventos.ts):
 * la Semana del coleccionista vuelve a tirar una vez lo repetido, y la
 * Semana maldita maldice 1 de cada 6 (nunca un usable: sería un objeto muerto).
 */
export function tirarConEvento(tipo: TipoCofre, twitchId: string, azar: Azar = Math.random): Botin {
  let botin = tirar(tipo, azar);
  if (eventos.activo('coleccionista') && lootDb.loTuvo(twitchId, botin.objeto)) botin = tirar(tipo, azar);
  if (eventos.activo('semana-maldita') && !NOMBRES_USABLES.includes(botin.objeto) && azar() < 1 / 6) botin = { ...botin, maldito: true };
  return botin;
}

export type ResultadoCofre =
  | { ok: true; reparto: Reparto[]; enviado: boolean }
  | { ok: false; motivo: string };

export async function soltarCofre(
  { origen = 'cofre', azar = Math.random, now = Date.now() }: { origen?: 'cofre' | 'panel'; azar?: Azar; now?: number } = {},
): Promise<ResultadoCofre> {
  const gente = aventureros(now);
  if (!gente.length) {
    // Un cofre normal sin nadie se pierde en silencio: anunciarlo cada 20
    // minutos a un chat vacío sería spam. Pero el de guerra lo ha pagado
    // alguien con Oros: se queda en el suelo para el primero que escriba.
    if (cofreDeGuerra) {
      const de = cofreDeGuerra;
      cofreDeGuerra = null;
      enElSuelo = { de, hasta: now + SUELO_MS };
      const outcome = await send({
        solicitado: true,
        text: `⚔️ El cofre de guerra de ${de} ha caído… y no hay nadie para abrirlo. El primero que escriba en el chat en los próximos ${SUELO_MS / 60_000} min se lo lleva.`,
        reason: NAME,
      });
      interactionLog.record({ interaction: NAME, status: outcome.sent ? 'sent' : 'blocked', detail: `guerra de ${de}: al suelo` });
      return { ok: false, motivo: 'no había nadie: el cofre de guerra se queda en el suelo' };
    }
    return { ok: false, motivo: `nadie ha escrito en el chat en los últimos ${config.loot.minutosActividad} minutos` };
  }

  // Si alguien lanzó un Grito de guerra, este es el cofre de guerra: solo armas.
  const guerra = cofreDeGuerra;
  cofreDeGuerra = null;
  // Fiebre del oro: el cofre de siempre, con la suerte del Cofre del tesoro.
  const tipo: TipoCofre = guerra ? 'guerra' : eventos.activo('fiebre-oro') ? 'oro' : 'cofre';
  const origenFinal = guerra ? 'guerra' : origen;

  // Se guarda ANTES de anunciar: si el mensaje no sale (tope por hora, un
  // corte), el botín ya es de quien le tocó y lo verá en !inventario.
  const reparto: Reparto[] = gente.map((viewer) => {
    const botin = tirarConEvento(tipo, viewer.id, azar);
    return { viewer, botin, resultado: lootDb.dar(viewer.id, viewer.displayName, botin, origenFinal) };
  });

  const texto = componerCofre(reparto);
  const outcome = await send({
    text: guerra ? texto.replace(/^(🎁 ¡Ha caído un cofre!|✨ ¡Cofre LEGENDARIO!)/, `⚔️ ¡Cofre de guerra (grito de ${guerra})!`) : texto,
    reason: NAME,
    solicitado: origen === 'panel' || guerra !== null,
  });
  interactionLog.record({
    interaction: NAME,
    status: outcome.sent ? 'sent' : 'blocked',
    detail: `${origen}: ${reparto.map((r) => `${r.viewer.login}=${r.botin.rareza}`).join(', ')}`,
  });

  for (const r of reparto) enPantalla(r.viewer.displayName, r.botin, origenFinal);
  ultimoCofre = now;
  return { ok: true, reparto, enviado: outcome.sent };
}

// ---------------------------------------------------------------------------
// Regalar un cofre (desde el panel)
// ---------------------------------------------------------------------------

/** `Crid4m`, como se escribe en el chat. */
const streamer = () => config.broadcasterLogin.charAt(0).toUpperCase() + config.broadcasterLogin.slice(1);

/**
 * Busca a alguien por su login: primero en el chat, después entre quien ha
 * pasado alguna vez (o, como el canal, tiene mochila). Hace falta su id de Twitch para guardarle el botín, así
 * que a quien nunca ha pasado por el chat no se le puede regalar nada.
 */
async function buscarPersona(login: string, now: number): Promise<Viewer | null> {
  const l = login.replace(/^@/, '').trim().toLowerCase();
  const enChat = (await enElChat(now)).find((v) => v.login.toLowerCase() === l);
  if (enChat) return enChat;
  const visto = vistos.get(l)?.viewer;
  if (visto) return esPersona(visto) ? visto : null;
  const fila = users.findByLogin(l) ?? (() => {
    const m = lootDb.porNombre(l);
    return m ? { twitch_id: m.twitch_id, login: l, display_name: m.display_name } : null;
  })();
  if (!fila) return null;
  const v: Viewer = {
    id: fila.twitch_id,
    login: fila.login,
    displayName: fila.display_name,
    isBroadcaster: false,
    isModerator: false,
    isVip: false,
    isSubscriber: false,
    rawRole: null,
  };
  return esPersona(v) ? v : null;
}

/**
 * Un cofre cuando tú quieras, haya hablado alguien o no.
 *
 * - Sin `para`: uno para cada persona que esté en el chat (sin bots ni tú).
 * - Con `para`: solo para esa persona.
 *
 * `tipo` elige las probabilidades: cofre normal o Cofre del tesoro. No usa el
 * cofre de guerra pendiente: ese es de quien gritó, no tuyo.
 */
export async function regalarCofre(
  { para = '', tipo = 'cofre', azar = Math.random, now = Date.now(), inicio }: { para?: string; tipo?: 'cofre' | 'oro'; azar?: Azar; now?: number; inicio?: string } = {},
): Promise<ResultadoCofre> {
  let gente: Viewer[];
  if (para.trim()) {
    if (esBot(para)) return { ok: false, motivo: `${para.trim()} es un bot` };
    if (!juega(para)) return { ok: false, motivo: 'el canal no juega al Loot (LOOT_CANAL_JUEGA=false)' };
    const v = await buscarPersona(para, now);
    if (!v) return { ok: false, motivo: `no conozco a ${para.trim()}: tiene que haber escrito en el chat alguna vez` };
    gente = [v];
  } else {
    gente = await enElChat(now);
    if (!gente.length) return { ok: false, motivo: 'no hay nadie en el chat (sin contar bots ni a ti)' };
  }

  const reparto: Reparto[] = gente.map((viewer) => {
    const botin = tirarConEvento(tipo, viewer.id, azar);
    return { viewer, botin, resultado: lootDb.dar(viewer.id, viewer.displayName, botin, 'regalo') };
  });

  const nombreCofre = tipo === 'oro' ? 'un Cofre del tesoro' : 'un cofre';
  const uno = reparto.length === 1 && para.trim() ? reparto[0]! : null;
  const texto = uno
    ? `🎁 ${streamer()} le regala ${nombreCofre} a @${uno.viewer.displayName} → ${etiqueta(uno.botin)}` +
      `${uno.botin.rareza === 'legendario' ? ' ✨✨✨' : ''}${notaMochila(uno.resultado)}${anunciosDeTitulo(reparto)}`
    : componerCofre(reparto, inicio ?? `🎁 ¡${streamer()} regala ${nombreCofre} a todo el chat! `);

  const outcome = await send({ text: texto, reason: NAME, allowedMentions: uno ? [uno.viewer.login] : undefined, solicitado: true });
  interactionLog.record({
    interaction: NAME,
    status: outcome.sent ? 'sent' : 'blocked',
    detail: `regalo ${tipo}: ${reparto.map((r) => `${r.viewer.login}=${r.botin.rareza}`).join(', ')}`,
  });

  for (const r of reparto) enPantalla(r.viewer.displayName, r.botin, 'regalo');
  return { ok: true, reparto, enviado: outcome.sent };
}

// ---------------------------------------------------------------------------
// Cofre del tesoro (Oros)
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
    const resultado = guarda ? lootDb.dar(ctx.viewer.id, ctx.viewer.displayName, botin, 'oro') : undefined;
    enPantalla(ctx.viewer.displayName, botin, 'oro');
    const brillo = botin.rareza === 'legendario' ? ' ✨✨✨' : '';
    const titulo = resultado?.tituloNuevo ? ` · 🏆 ¡Colección completa: «${resultado.tituloNuevo}»!` : '';
    return {
      text: `🗝️ @${ctx.viewer.displayName} abre un Cofre del tesoro → ${etiqueta(botin)}${brillo}${notaMochila(resultado)}${titulo}`,
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
// Los efectos del canal, conectados con el botín
// ---------------------------------------------------------------------------
//
// Los efectos siguen viviendo en Streamer.bot (sonido, OBS). Aquí solo se
// añade su lado del Loot, y solo con el Loot activo:
//
//   ⚔️ Grito de guerra  → "¡A las armas!": el próximo cofre cae en 1-2 min
//                         y es de guerra (solo armas, algo más de suerte).
//                         Para todo el chat activo, no solo para quien grita.
//   💀 Maldición        → quien maldice recibe un objeto maldito: poder
//                         doble, pero si pierde un duelo pasa al ganador.
//   🧪 Poción de vida   → si llevas un maldito, te ofrece purificarlo
//                         (!purificar): ya no se pierde, pero pierde el doble.

/**
 * El título de la recompensa, sin tildes, mayúsculas, emojis ni signos: en la
 * web de Twitch es fácil llamarla "⚔️ Grito de Guerra!" y tiene que valer.
 */
const limpiarTitulo = (t: string) =>
  t.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
const mismoTitulo = (a: string, b: string) => limpiarTitulo(a) === limpiarTitulo(b);

interface CtxEfecto extends Ctx {
  trigger: 'channel-point';
  azar: Azar;
}

/** El que canjea un efecto está en el directo: cuenta como activo para los cofres. */
export function presente(viewer: Viewer): void {
  if (!juega(viewer.login)) return;
  if (consent.haPedidoOlvido(viewer.id)) return;
  registrarActividad(viewer);
}

const SIN_DIRECTO = 'sin directo marcado no caen cofres (panel → Loot → El directo ya ha empezado)';
/** El del Terremoto (jefe.ts): sin directo no sale ningún jefe. */
export const SIN_DIRECTO_JEFE = 'sin directo marcado no salen jefes (panel → Loot → El directo ya ha empezado)';
/** El del Lag (interactions/lag.ts): sin directo no hay reloj que congelar ni cofre que adelantar. */
export const SIN_DIRECTO_LAG = 'sin directo marcado no hay jefe ni cofre que congelar (panel → Loot → El directo ya ha empezado)';

/**
 * Por qué el canje de un efecto no hará nada en el Loot ahora mismo, o null.
 * Son las mismas condiciones que sus guards: el «Probar» del panel lo usa
 * para decirte por qué no ha pasado nada (28 sep 2026).
 */
export function motivoEfectoParado(efecto: string, twitchId: string): string | null {
  if (!['grito', 'maldicion', 'pocion', 'terremoto', 'lag'].includes(efecto)) return null;
  if (!ajustes.lootActivo()) return 'el Loot está apagado';
  if (efecto === 'grito' && !streams.current()) return SIN_DIRECTO;
  if (efecto === 'terremoto' && !streams.current()) return SIN_DIRECTO_JEFE;
  if (efecto === 'lag' && !streams.current()) return SIN_DIRECTO_LAG;
  if (efecto === 'pocion' && !lootDb.tieneMaldito(twitchId)) return 'no llevas nada maldito, así que la Poción no ofrece !purificar';
  return null;
}

export const grito: Interaction<CtxEfecto> = {
  name: 'loot-grito',
  spontaneous: false,
  // Los descartes se registran: si el grito suena y el bot calla, en el
  // Registro del panel está por qué.
  guards: [
    () => (ajustes.lootActivo() ? { ok: true } : { ok: false, motivo: 'el Loot está apagado', registrar: true }),
    () => (streams.current() ? { ok: true } : { ok: false, motivo: SIN_DIRECTO, registrar: true }),
  ],
  run: (ctx) => ({ text: atraerCofreDeGuerra(ctx.viewer.displayName, ctx.azar) }),
};

/**
 * El lado del Loot de un Grito de guerra: el próximo cofre cae en 1-2 min y
 * es de guerra. Lo usan la recompensa y el Cuerno de guerra (`!usar`).
 * Devuelve lo que hay que decir en el chat.
 */
export function atraerCofreDeGuerra(quien: string, azar: Azar = Math.random): string {
  // No se acumula: si ya viene uno de guerra, el grito se suma al que viene.
  if (cofreDeGuerra !== null) {
    const falta = proximo ? Math.max(0, Math.round((proximo - Date.now()) / 1000)) : null;
    return `⚔️ ¡${quien} se une al grito de ${cofreDeGuerra}! El cofre de guerra ya viene` +
      `${falta !== null ? ` (${falta < 60 ? `${falta} s` : `${Math.ceil(falta / 60)} min`})` : ''}: quédate en el chat.`;
  }
  cofreDeGuerra = quien;
  programarEn((60 + azar() * 60) * 1000);
  return `⚔️ ¡A las armas! El grito de ${quien} atrae un cofre de guerra: cae en 1-2 min para quien esté en el chat.`;
}

/**
 * Lanza en el directo el efecto de una recompensa (su Action de Streamer.bot:
 * sonido, filtro de OBS), como si `quien` la hubiera canjeado. Se inyecta
 * desde index.ts. Devuelve si se lanzó.
 */
export type EfectoCanal = 'grito' | 'pocion' | 'maldicion';
export type LanzarEfecto = (efecto: EfectoCanal, quien: Viewer) => Promise<boolean>;
let lanzador: LanzarEfecto | null = null;

export function setLanzarEfecto(fn: LanzarEfecto | null): void {
  lanzador = fn;
}

export async function lanzarEfecto(efecto: EfectoCanal, quien: Viewer): Promise<boolean> {
  if (!lanzador) return false;
  try {
    return await lanzador(efecto, quien);
  } catch (err) {
    log.warn(`Loot: el efecto ${efecto} no se lanzó (${err instanceof Error ? err.message : String(err)}).`);
    return false;
  }
}

export const maldicion: Interaction<CtxEfecto> = {
  name: 'loot-maldicion',
  spontaneous: false,
  guards: [
    () => (ajustes.lootActivo() ? { ok: true } : { ok: false, motivo: 'el Loot está apagado', registrar: true }),
    (ctx) => (consent.haPedidoOlvido(ctx.viewer.id) ? { ok: false, motivo: 'pidió el olvido' } : { ok: true }),
  ],
  run: (ctx) => {
    const botin = tirarMaldito(ctx.azar);
    lootDb.dar(ctx.viewer.id, ctx.viewer.displayName, botin, 'maldicion');
    enPantalla(ctx.viewer.displayName, botin, 'maldicion');
    return {
      text:
        `☠️ @${ctx.viewer.displayName} maldice al streamer… y la maldición le devuelve ${etiqueta(botin)}: ` +
        `poder doble, pero si pierde un duelo pasa al ganador.`,
      allowedMentions: [ctx.viewer.login],
    };
  },
};

/** Quién puede purificar ahora mismo, y hasta cuándo. */
const purificaciones = new Map<string, number>();
const VENTANA_PURIFICAR_MS = 5 * 60_000;

export function puedePurificar(twitchId: string, now = Date.now()): boolean {
  const hasta = purificaciones.get(twitchId);
  return hasta !== undefined && hasta >= now;
}

export function gastarPurificacion(twitchId: string): void {
  purificaciones.delete(twitchId);
}

export const pocion: Interaction<CtxEfecto> = {
  name: 'loot-pocion',
  spontaneous: false,
  guards: [
    () => (ajustes.lootActivo() ? { ok: true } : { ok: false, motivo: 'el Loot está apagado' }),
    // Sin maldito, la poción es solo "¡Bebe agua!" y el bot no dice nada.
    (ctx) => (lootDb.tieneMaldito(ctx.viewer.id) ? { ok: true } : { ok: false, motivo: 'no lleva nada maldito' }),
  ],
  run: (ctx) => {
    const maldito = lootDb.tieneMaldito(ctx.viewer.id)!;
    purificaciones.set(ctx.viewer.id, Date.now() + VENTANA_PURIFICAR_MS);
    return {
      text:
        `🧪 @${ctx.viewer.displayName} la poción puede limpiar tu ${etiqueta(maldito)}. ` +
        `Escribe !purificar en 5 min: será tuyo para siempre, pero pierde el poder doble.`,
      allowedMentions: [ctx.viewer.login],
    };
  },
};

function efectoBinding(titulo: string, def: Interaction<CtxEfecto>) {
  return {
    matches: (event: ViewerRedeemEvent) => mismoTitulo(event.rewardTitle, titulo),
    run: (event: ViewerRedeemEvent, azar: Azar = Math.random) => {
      presente(event.viewer);
      return engine.run(def, { viewer: event.viewer, trigger: 'channel-point' as const, azar });
    },
  };
}

export const efectosBindings = [
  efectoBinding('Grito de guerra', grito),
  efectoBinding('Maldición', maldicion),
  efectoBinding('Poción de vida', pocion),
];

// ---------------------------------------------------------------------------
// !inventario
// ---------------------------------------------------------------------------


export function componerInventario(displayName: string, inv: lootDb.Inventario, capacidad = MOCHILA_MAX): string {
  if (inv.total === 0) {
    return `@${displayName} tu mochila está vacía 🎒 Quédate por el chat: cada 20-30 min cae un cofre para quien esté hablando.`;
  }
  const cuenta = RAREZAS.filter((r) => inv.porRareza[r] > 0)
    .map((r) => `${inv.porRareza[r]} ${ESTILO[r].emoji}`)
    .join(' ');
  const mejor = inv.mejor ? ` · Tu mejor pieza: ${etiqueta(inv.mejor)}` : '';
  const malditos = inv.malditos ? ` · ☠️ ${inv.malditos} maldito${inv.malditos === 1 ? '' : 's'}` : '';
  return `@${displayName} 🎒 ${inv.total}/${capacidad}: ${cuenta} · ⚔️ Poder ${inv.poder}${malditos}${mejor}`;
}

export const inventario: Interaction<Ctx> = {
  name: NAME_INVENTARIO,
  spontaneous: false,
  consulta: true,
  cooldowns: [
    {
      key: (ctx) => cooldowns.keys.user(NAME_INVENTARIO, ctx.viewer.id),
      ms: config.loot.inventarioCooldownMs,
      motivo: (_ctx, faltan) => `cooldown, faltan ${faltan}s`,
    },
  ],
  run: (ctx) => ({
    text: componerInventario(conTitulo(ctx.viewer), lootDb.inventario(ctx.viewer.id), lootDb.capacidad(ctx.viewer.id)),
    allowedMentions: [ctx.viewer.login],
  }),
};

// ---------------------------------------------------------------------------
// El reloj de los cofres
// ---------------------------------------------------------------------------

let reloj: ReturnType<typeof setTimeout> | null = null;
let proximo: number | null = null;
let ultimoCofre: number | null = null;
/** Quién lanzó el Grito de guerra que ha convertido el próximo cofre en uno de guerra. */
let cofreDeGuerra: string | null = null;

/**
 * El Lag sin jefe (28 sep 2026): el próximo cofre cae en `ms`, o antes si ya
 * tocaba antes (nunca lo retrasa). Devuelve en cuántos segundos cae.
 */
export function adelantarCofre(ms: number, now = Date.now()): number {
  if (!proximo || proximo - now > ms) programarEn(ms);
  return Math.max(0, Math.round((proximo! - now) / 1000));
}

/** Cambia cuándo cae el próximo cofre. Lo usa el Grito de guerra para adelantarlo. */
function programarEn(ms: number): void {
  if (reloj) clearTimeout(reloj);
  proximo = Date.now() + ms;
  reloj = setTimeout(() => void tic(), ms);
  reloj.unref?.();
}

/** Programa el siguiente cofre dentro del margen de minutos, al azar. */
function programar(azar: Azar = Math.random): void {
  const { minutosMin, minutosMax } = config.loot;
  programarEn((minutosMin + azar() * Math.max(0, minutosMax - minutosMin)) * 60_000);
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
    canalJuega: ajustes.canalJuega(),
    directo: streams.current() !== null,
    proximoEnSeg: proximo ? Math.max(0, Math.round((proximo - now) / 1000)) : null,
    ultimoCofre: ultimoCofre ? new Date(ultimoCofre).toISOString() : null,
    aventureros: aventureros(now).map((v) => v.displayName),
    cofreDeGuerra,
    enElSuelo: enElSuelo && enElSuelo.hasta >= now ? { de: enElSuelo.de, quedanSeg: Math.round((enElSuelo.hasta - now) / 1000) } : null,
    minutosActividad: config.loot.minutosActividad,
  };
}

/** Solo para tests. */
export function reset(): void {
  actividad.clear();
  vistos.clear();
  parar();
  ultimoCofre = null;
  cofreDeGuerra = null;
  purificaciones.clear();
  pantalla = null;
  arena.reset();
  chatters = null;
  lanzador = null;
  enElSuelo = null;
  fila.vaciar();
  eventos.reset();
  temporada.reset();
}
