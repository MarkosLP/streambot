import { config } from '../../config.js';
import * as ajustes from '../../core/ajustes.js';
import * as consent from '../../core/consent.js';
import type { ChannelRaidEvent, Viewer, ViewerCheerEvent, ViewerGiftBombEvent, ViewerGiftSubEvent, ViewerSubEvent } from '../../core/events.js';
import { log } from '../../core/logger.js';
import { send } from '../../core/output.js';
import * as interactionLog from '../../data/interactions.js';
import * as lootDb from '../../data/loot.js';
import * as streams from '../../data/streams.js';
import * as suscriptores from '../../data/suscriptores.js';
import { anunciosDeTitulo, conTitulo, enPantalla, juega, notaMochila, regalarCofre, type Reparto } from './index.js';
import * as jefe from './jefe.js';
import { OBJETOS_MECENAS, etiqueta, tirar, tirarDe, type Azar, type Botin } from './objetos.js';

/**
 * Suscriptores, regalos, bits y raids (26 sep 2026, propuestas S1-S7).
 *
 * La regla: que suscribirse se note y luzca, sin dar fuerza. Con 1-3
 * espectadores, si un sub ganara siempre los duelos, el resto dejaría de
 * jugar. Así que: cofres, marca 💜, mochila de 30 y una colección propia
 * (cosmética). Nada que cambie las probabilidades de un duelo.
 *
 *  S1  Sub / resub → Cofre de suscriptor. Aniversarios (3, 6, 9 meses) con
 *      mejor suerte; cada 12 meses, legendario asegurado.
 *  S2  Regalar subs → cofre para quien regala (hasta 5) y uno de bienvenida
 *      para cada quien la recibe. 5 o más de golpe: lluvia de cofres.
 *  S3  Raid entrante → Cofre del tesoro para quien la trae y, con 3 o más
 *      personas, un jefe a los 30 s para que jueguen nada más llegar.
 *  S7  Bits → golpes al jefe (jefe.ts) o, sin jefe, un cofre desde 300.
 *
 * Todo con el Loot activo. Los mensajes son «solicitados» (alguien ha hecho
 * algo), así que van por el techo de respuestas.
 */

/** Probabilidad de que un cofre de suscriptor suelte un objeto de mecenas (S6). */
export const PROB_MECENAS = 0.35;

const activo = () => ajustes.lootActivo();

/** Un objeto de mecenas de la misma rareza, a veces (S6). */
function quizaMecenas(botin: Botin, azar: Azar): Botin {
  const deSuRareza = OBJETOS_MECENAS.filter((m) => m.rareza === botin.rareza);
  if (!deSuRareza.length || azar() >= PROB_MECENAS) return botin;
  return { ...deSuRareza[Math.floor(azar() * deSuRareza.length)]! };
}

function decir(texto: string, menciones: string[], detalle: string, twitchId?: string): Promise<void> {
  return send({ text: texto, reason: 'loot-mecenas', allowedMentions: menciones, solicitado: true }).then((o) => {
    interactionLog.record({ interaction: 'loot-mecenas', twitchId, status: o.sent ? 'sent' : 'blocked', detail: o.sent ? detalle : `${detalle} · ${o.detail}` });
  });
}

function puedeRecibir(v: Viewer): boolean {
  return Boolean(v.id) && juega(v.login) && !consent.haPedidoOlvido(v.id);
}

// ---------------------------------------------------------------------------
// S1 · Cofre de suscriptor
// ---------------------------------------------------------------------------

/** El cofre según los meses: 12, 24… legendario; 3, 6, 9… aniversario; si no, del tesoro. */
export function cofreDeSuscriptor(meses: number, azar: Azar = Math.random): { botin: Botin; motivo: string } {
  if (meses >= 12 && meses % 12 === 0) {
    return { botin: quizaMecenas(tirarDe('legendario', azar), azar), motivo: `¡${meses / 12 === 1 ? 'un año' : `${meses / 12} años`}: legendario asegurado!` };
  }
  if (meses >= 3 && meses % 3 === 0) return { botin: quizaMecenas(tirar('aniversario', azar), azar), motivo: `aniversario de ${meses} meses, con más suerte` };
  return { botin: quizaMecenas(tirar('oro', azar), azar), motivo: '' };
}

export async function alSuscribirse(e: ViewerSubEvent, azar: Azar = Math.random): Promise<void> {
  const v = e.viewer;
  if (v.id) suscriptores.apuntar(v.id, e.meses, e.nivel);
  if (!activo() || !puedeRecibir(v)) return;
  const { botin, motivo } = cofreDeSuscriptor(e.meses, azar);
  const resultado = lootDb.dar(v.id, v.displayName, botin, 'suscriptor');
  enPantalla(v.displayName, botin, 'suscriptor');
  const inicio = e.resub
    ? `💜 ¡${conTitulo(v)} lleva ${e.meses} meses suscrito!`
    : `💜 ¡Gracias por la suscripción, @${v.displayName}!`;
  await decir(
    `${inicio} Cofre de suscriptor${motivo ? ` (${motivo})` : ''} → ${etiqueta(botin)}${notaMochila(resultado)}` +
      anunciosDeTitulo([{ viewer: v, botin, resultado }]),
    [v.login],
    `${e.resub ? 'resub' : 'sub'} ${e.meses}: ${botin.rareza} ${botin.objeto}`,
    v.id,
  );
}

// ---------------------------------------------------------------------------
// S2 · Regalar subs = regalar cofres
// ---------------------------------------------------------------------------

/** Lo máximo que se lleva quien regala, por tanda. */
export const TOPE_REGALADOR = 5;
/** Desde cuántas de golpe llueven cofres para todo el chat. */
export const LLUVIA_DESDE = 5;
/**
 * Una bomba llega como UN aviso de bomba, como N avisos sueltos, o como las
 * dos cosas (según «Gift Bombs» en Streamer.bot). Todo lo de la misma
 * persona se junta en una tanda, que se cierra cuando pasan estos ms sin
 * nada nuevo: así no se cuenta dos veces ni sale un mensaje por regalo.
 */
const VENTANA_MS = 5000;

interface Tanda { regala: Viewer | null; recibe: Viewer[]; bomba: number; prueba: boolean; reloj: ReturnType<typeof setTimeout> }
const tandas = new Map<string, Tanda>();
let ventanaMs = VENTANA_MS;

export function alRegalar(e: ViewerGiftSubEvent, azar: Azar = Math.random): void {
  sumarATanda(e.regala, [e.recibe], e.bomba, e.source === 'simulator', azar);
}

export function alBomba(e: ViewerGiftBombEvent, azar: Azar = Math.random): void {
  sumarATanda(e.regala, e.recibe, e.cantidad, e.source === 'simulator', azar);
}

function sumarATanda(regala: Viewer | null, recibe: Viewer[], bomba: number, prueba: boolean, azar: Azar): void {
  for (const v of recibe) if (v.id) suscriptores.apuntar(v.id, 1);
  const clave = regala?.id || 'anonimo';
  let t = tandas.get(clave);
  if (t) clearTimeout(t.reloj);
  else {
    t = { regala, recibe: [], bomba: 0, prueba, reloj: setTimeout(() => {}, 0) };
    tandas.set(clave, t);
  }
  // Sin repetir a nadie: el aviso de bomba y los sueltos pueden traer a los mismos.
  for (const v of recibe) if (!t.recibe.some((x) => (x.id && x.id === v.id) || (x.login && x.login === v.login))) t.recibe.push(v);
  t.bomba = Math.max(t.bomba, bomba);
  const tanda = t;
  tanda.reloj = setTimeout(() => { tandas.delete(clave); void cerrarTanda(tanda, azar); }, ventanaMs);
  tanda.reloj.unref?.();
}

async function cerrarTanda(t: Tanda, azar: Azar): Promise<void> {
  if (!activo()) return;
  const n = Math.max(t.recibe.length, t.bomba);
  const quien = t.regala ? conTitulo(t.regala) : 'Alguien anónimo';

  // Un cofre de bienvenida para cada quien la recibe.
  const bienvenida: Reparto[] = [];
  for (const v of t.recibe) {
    if (!puedeRecibir(v)) continue;
    const botin = tirar('cofre', azar);
    bienvenida.push({ viewer: v, botin, resultado: lootDb.dar(v.id, v.displayName, botin, 'suscriptor') });
    enPantalla(v.displayName, botin, 'suscriptor');
  }

  // Y para quien regala, un Cofre del tesoro por sub (hasta TOPE_REGALADOR).
  const suyos: Botin[] = [];
  if (t.regala && puedeRecibir(t.regala)) {
    for (let i = 0; i < Math.min(n, TOPE_REGALADOR); i++) {
      const botin = quizaMecenas(tirar('oro', azar), azar);
      lootDb.dar(t.regala.id, t.regala.displayName, botin, 'suscriptor');
      suyos.push(botin);
    }
    const mejor = [...suyos].sort((a, b) => rango(b) - rango(a))[0];
    if (mejor) enPantalla(t.regala.displayName, mejor, 'suscriptor');
  }

  const para = bienvenida.length === 1 ? `Cofre de bienvenida para @${bienvenida[0]!.viewer.displayName} → ${etiqueta(bienvenida[0]!.botin)}` :
    bienvenida.length ? `Cofre de bienvenida para ${bienvenida.length}` : '';
  // El aviso de bomba puede no decir quién las recibe: entonces solo se nombra a quien regala.
  const recompensa = suyos.length ? `${t.regala!.displayName} se lleva ${suyos.length === 1 ? `→ ${etiqueta(suyos[0]!)}` : `${suyos.length} cofres del tesoro (el mejor: ${etiqueta([...suyos].sort((a, b) => rango(b) - rango(a))[0]!)})`}` : '';
  await decir(
    `🎁 ¡${quien} regala ${n === 1 ? 'una sub' : `${n} subs`}! ${[para, recompensa].filter(Boolean).join(' · ')}`.trim(),
    [...(t.regala ? [t.regala.login] : []), ...(bienvenida.length === 1 ? [bienvenida[0]!.viewer.login] : [])],
    `regalo ${n}: ${t.regala?.login ?? 'anónimo'}`,
    t.regala?.id,
  );

  // Muchas de golpe: que llueva para todo el chat.
  if (n >= LLUVIA_DESDE) {
    // En una prueba del panel, no se reparte nada a la gente de verdad del chat.
    if (t.prueba) {
      await decir(`🌧️ ¡Lluvia de cofres por las ${n} subs de ${t.regala?.displayName ?? 'alguien anónimo'}! (Es una prueba: en un regalo de verdad, cofre para todo el chat.)`, [], `lluvia de prueba ${n}`);
    } else {
      const r = await regalarCofre({ azar, inicio: `🌧️ ¡Lluvia de cofres por las ${n} subs de ${t.regala?.displayName ?? 'alguien anónimo'}! ` });
      if (!r.ok) log.info(`Lluvia de cofres: ${r.motivo}`);
    }
  }
}

const rango = (b: Botin) => ({ comun: 1, raro: 2, epico: 3, legendario: 4 })[b.rareza];

// ---------------------------------------------------------------------------
// S3 · Raid entrante
// ---------------------------------------------------------------------------

/** Con cuántas personas una raid trae jefe. */
export const JEFE_RAID_DESDE = 3;
/** Espera antes del jefe: que la gente de la raid llegue al chat. */
const JEFE_RAID_MS = 30_000;
let jefeRaidMs = JEFE_RAID_MS;

export async function alRecibirRaid(e: ChannelRaidEvent, azar: Azar = Math.random): Promise<void> {
  if (!activo()) return;
  const v = e.desde;
  let premio = '';
  if (puedeRecibir(v)) {
    const botin = tirar('oro', azar);
    const resultado = lootDb.dar(v.id, v.displayName, botin, 'raid');
    enPantalla(v.displayName, botin, 'raid');
    premio = ` Cofre del tesoro para @${v.displayName} por traerla → ${etiqueta(botin)}${notaMochila(resultado)}.`;
  }
  const conJefe = e.espectadores >= JEFE_RAID_DESDE && streams.current() !== null;
  await decir(
    `⚔️ ¡Llega una incursión de ${v.displayName} con ${e.espectadores} ${e.espectadores === 1 ? 'persona' : 'personas'}!${premio}` +
      (conJefe ? ' En 30 s aparece un jefe: escribid !atacar cuando salga.' : ''),
    [v.login],
    `raid ${v.login}: ${e.espectadores}`,
    v.id,
  );
  if (conJefe) {
    const reloj = setTimeout(() => {
      if (jefe.hayJefe()) return;
      jefe.invocar().then((r) => { if (!r.ok) log.info(`Jefe de la raid: ${r.motivo}`); }).catch((err) => log.error(`Jefe de la raid: ${String(err)}`));
    }, jefeRaidMs);
    reloj.unref?.();
  }
}

// ---------------------------------------------------------------------------
// S7 · Bits
// ---------------------------------------------------------------------------

/** Bits a partir de los que, sin jefe, cae un cofre. */
export const COFRE_BITS_DESDE = 300;

export async function alRecibirBits(e: ViewerCheerEvent, azar: Azar = Math.random): Promise<void> {
  const v = e.viewer;
  if (!activo() || !v.id || consent.haPedidoOlvido(v.id)) return;
  const contraJefe = jefe.golpesDeBits(v, e.bits, azar);
  if (contraJefe) {
    for (const texto of contraJefe) await decir(texto, [], `bits ${e.bits} al jefe`, v.id);
    return;
  }
  if (e.bits < COFRE_BITS_DESDE || !juega(v.login)) return;
  const botin = tirar('oro', azar);
  const resultado = lootDb.dar(v.id, v.displayName, botin, 'bits');
  enPantalla(v.displayName, botin, 'bits');
  await decir(
    `💎 ¡Gracias por los ${e.bits} bits, @${v.displayName}! Cofre del tesoro → ${etiqueta(botin)}${notaMochila(resultado)}`,
    [v.login],
    `bits ${e.bits}: ${botin.rareza}`,
    v.id,
  );
}

/** Solo para tests. */
export function reset({ ventana = VENTANA_MS, jefeRaid = JEFE_RAID_MS } = {}): void {
  for (const t of tandas.values()) clearTimeout(t.reloj);
  tandas.clear();
  ventanaMs = ventana;
  jefeRaidMs = jefeRaid;
}

export { config as _config };
