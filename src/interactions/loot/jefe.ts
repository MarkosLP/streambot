import { config } from '../../config.js';
import * as ajustes from '../../core/ajustes.js';
import * as consent from '../../core/consent.js';
import * as cooldowns from '../../core/cooldowns.js';
import type { Ctx, Interaction, Salida } from '../../core/interaction.js';
import { log } from '../../core/logger.js';
import { send } from '../../core/output.js';
import type { Viewer } from '../../core/events.js';
import * as interactionLog from '../../data/interactions.js';
import * as lootDb from '../../data/loot.js';
import { esBot } from '../../core/bots.js';
import type { CtxComando } from './comandos.js';
import { aventureros, componerCofre, enPantalla, juega, SIN_DIRECTO_JEFE, type Reparto } from './index.js';
import { tirar, type Azar } from './objetos.js';
import { ESPECIALES, UMBRAL } from './especiales.js';
import * as eventos from './eventos.js';
import * as temporadas from '../../data/temporadas.js';
import * as misiones from './misiones.js';
import * as novedades from './novedades.js';
import * as streams from '../../data/streams.js';
import { PUNTOS_MVP } from './temporada.js';

/**
 * Jefe de raid (26 sep 2026).
 *
 * Lo invocas desde el panel. Aparece con vida según cuánta gente hay
 * hablando, y el chat tiene 3 minutos para derribarlo con `!atacar`. Si cae,
 * cada atacante se lleva un cofre, y quien más daño hizo, un Cofre del
 * tesoro. Si no, se escapa.
 *
 * El bot solo habla TRES veces por jefe (aparece, mitad de vida, final): el
 * tope de mensajes por hora es de 12 y un jefe no puede comérselo. Los
 * ataques no contestan; el ranking de daño sale al final.
 *
 * El canal puede atacar (ayuda a su chat), pero no se lleva botín.
 */

export const NAME = 'loot-jefe';
export const DURACION_MS = 3 * 60_000;
/**
 * Vida por cada persona que está hablando, y espera entre ataques.
 *
 * Ajustado con la prueba del 26 sep 2026: a 100 de vida y 15 s, dos personas
 * lo tumbaban en 73 s de 180, y la mayoría de los !atacar de quien escribía
 * rápido se perdían en la espera. Con 200 y 10 s sale en torno a minuto y
 * medio, y se pega más a menudo.
 */
export const VIDA_POR_PERSONA = 200;
export const ATAQUE_COOLDOWN_MS = 10_000;

/**
 * Los jefes. `tipo` es lo que usa el overlay para su retrato, sus colores y
 * su ambiente (biblioteca/overlays/jefe.html, TEMAS): si añades uno aquí,
 * añádelo allí también, o saldrá con el aspecto genérico.
 */
export const JEFES = [
  { tipo: 'dragon', nombre: 'el Dragón de Escarcha' },
  { tipo: 'esqueleto', nombre: 'el Rey Esqueleto' },
  { tipo: 'hidra', nombre: 'la Hidra del Pantano' },
  { tipo: 'golem', nombre: 'el Gólem de Obsidiana' },
  { tipo: 'liche', nombre: 'el Liche sin Nombre' },
  { tipo: 'arana', nombre: 'la Araña Reina' },
  { tipo: 'kraken', nombre: 'el Kraken del Foso' },
  { tipo: 'minotauro', nombre: 'el Minotauro con Resaca' },
  { tipo: 'tanque', nombre: 'el Tanque que no sabe tanquear' },
  { tipo: 'lag', nombre: 'el Lag Primigenio' },
] as const;
export type TipoJefe = (typeof JEFES)[number]['tipo'];

/**
 * Un golpe, para el overlay: los números de daño que saltan. `tipo` dice si
 * fue un golpe normal, uno que no pudo darse (congelado, atrapado…), un fallo
 * (la vomitona), o la vida que se cura o se quita el propio jefe.
 */
export interface Golpe {
  n: number;
  quien: string;
  dano: number;
  critico: boolean;
  tipo?: 'golpe' | 'bloqueado' | 'fallo' | 'cura' | 'propio';
  icono?: string;
  texto?: string;
}

/** El ataque especial en marcha, para el cartel del overlay. */
export interface EspecialEnCurso {
  n: number;
  icono: string;
  titulo: string;
  texto: string;
  at: number;
}

/**
 * Ataques del chat (2 oct 2026): subs, regalos y bits contra el jefe, cada uno
 * con su efecto pintado en el overlay (imagenes/jefes/aliados/<clase>.png).
 * Pegan fuerte porque el jefe es de todos: ayudan al chat, no compiten con él.
 * En los duelos un sub sigue pesando lo mismo.
 */
export const ALIADOS = {
  grito: { icono: '📯', titulo: 'Grito de guerra' },
  refuerzos: { icono: '🎁', titulo: 'Refuerzos' },
  cristal: { icono: '💎', titulo: 'Golpe de cristal' },
  tormenta: { icono: '⚡', titulo: 'Tormenta de cristal' },
  mecenas: { icono: '🗡️', titulo: 'Golpe del mecenas' },
} as const;
export type ClaseAliado = keyof typeof ALIADOS;

/** El ataque del chat en marcha, para el cartel del overlay. */
export interface AtaqueAliado {
  n: number;
  clase: ClaseAliado;
  icono: string;
  titulo: string;
  quien: string;
  texto: string;
  at: number;
}

/**
 * Lo máximo que quita un ataque pagado, de la vida máxima. Con 1-3 personas,
 * si unos bits lo tumbaran de golpe, el resto del chat se quedaría sin pelea.
 */
export const TOPE_ATAQUE = 0.35;
/** El sub: un golpe de esta parte de la vida máxima, y todo el chat pega más un rato. */
export const GOLPE_SUB = 0.15;
export const GRITO_MS = 20_000;
export const GRITO_FACTOR = 1.5;
/** Golpes como mucho por una tanda de subs regaladas. */
export const TOPE_REFUERZOS = 10;

interface Jefe {
  /** Cambia con cada jefe: el overlay sabe así que es uno nuevo. */
  id: number;
  tipo: TipoJefe;
  nombre: string;
  golpes: Golpe[];
  golpesAcertados: number;
  vidaMax: number;
  vida: number;
  hasta: number;
  danos: Map<string, { viewer: Viewer; dano: number }>;
  avisoMitad: boolean;
  /** El ataque especial (especiales.ts): uno por combate. */
  especialUsado: boolean;
  especial: EspecialEnCurso | null;
  bloqueos: Map<string, { hasta: number; icono: string; texto: string }>;
  debiles: Map<string, { hasta: number; factor: number }>;
  fallan: Set<string>;
  /** El Lag para su reloj hasta aquí (quedanSeg se queda quieto mientras). */
  congeladoHasta?: number;
  /** El último ataque del chat (sub, regalo, bits), para el overlay. */
  aliado: AtaqueAliado | null;
  /** Grito de guerra de un sub: todo el chat pega GRITO_FACTOR hasta entonces. */
  grito: { hasta: number; quien: string } | null;
}

let jefe: Jefe | null = null;

/** Los segundos que le quedan, contando la parada del Lag si la hay. */
function quedan(j: Jefe, now: number): number {
  // Mientras está parado, lo que quedará al volver a andar: no baja.
  const desde = j.congeladoHasta && now < j.congeladoHasta ? j.congeladoHasta : now;
  return Math.max(0, Math.round((j.hasta - desde) / 1000));
}
let contador = 0;
let golpesTotales = 0;
let especialesTotales = 0;
let aliadosTotales = 0;
/** Cuánto se queda el cartel del especial en el overlay. */
const CARTEL_ESPECIAL_MS = 6000;

/** Cómo acabó el último jefe, para el rótulo final del overlay. */
export interface Final {
  id: number;
  tipo: TipoJefe;
  nombre: string;
  resultado: 'derrotado' | 'escapa';
  vida: number;
  vidaMax: number;
  podio: { quien: string; dano: number }[];
  at: number;
}
let final: Final | null = null;
/** Cuánto se queda el rótulo final en pantalla. */
const FINAL_MS = 9000;
let reloj: ReturnType<typeof setTimeout> | null = null;

export type ResultadoInvocar = { ok: true; nombre: string; vida: number; enviado: boolean } | { ok: false; motivo: string };

export async function invocar(
  { azar = Math.random, now = Date.now(), tipo, intro }: { azar?: Azar; now?: number; tipo?: string; intro?: string } = {},
): Promise<ResultadoInvocar> {
  if (!ajustes.lootActivo()) return { ok: false, motivo: 'el Loot está apagado' };
  if (jefe) return { ok: false, motivo: `${jefe.nombre} sigue en pie` };
  // Uno concreto si lo eliges en el panel; si no, al azar.
  const elegido = JEFES.find((x) => x.tipo === tipo) ?? JEFES[Math.floor(azar() * JEFES.length)]!;
  const nombre = elegido.nombre;
  const vidaMax = VIDA_POR_PERSONA * Math.max(1, aventureros(now).length);
  jefe = { id: ++contador, tipo: elegido.tipo, nombre, golpes: [], golpesAcertados: 0, vidaMax, vida: vidaMax, hasta: now + DURACION_MS, danos: new Map(), avisoMitad: false,
    especialUsado: false, especial: null, bloqueos: new Map(), debiles: new Map(), fallan: new Set(), aliado: null, grito: null };
  novedades.anotar('jefe', 'Jefe del chat', nombre, 'Ha aparecido · escribe !atacar');
  final = null;
  reloj = setTimeout(() => void terminarPorTiempo(), DURACION_MS);
  reloj.unref?.();

  const outcome = await send({
    // `intro`: quién lo ha traído, en el mismo mensaje (el Terremoto). Uno menos del tope por hora.
    text: `${intro ? `${intro} ` : ''}🐉 ¡Aparece ${nombre} con ${vidaMax} de vida! Escribid !atacar para derribarlo: tenéis ${DURACION_MS / 60_000} min. Botín para todos los que peguen.`,
    reason: NAME,
    solicitado: true,
  });
  interactionLog.record({ interaction: NAME, status: outcome.sent ? 'sent' : 'blocked', detail: `aparece ${nombre} (${vidaMax})` });
  return { ok: true, nombre, vida: vidaMax, enviado: outcome.sent };
}

/** Cuánto pega alguien: 6-15, más su poder (con techo), y un 10 % de crítico doble. */
export function golpe(poder: number, azar: Azar): { dano: number; critico: boolean } {
  const base = 6 + Math.floor(azar() * 10) + Math.min(15, Math.floor(Math.sqrt(poder) * 2));
  const critico = azar() < 0.1;
  return { dano: critico ? base * 2 : base, critico };
}

/** Poder del dueño del canal: prepara el remate sin repartir botín ni alterar el MVP. */
export const sentencia: Interaction<CtxComando> = {
  name: 'loot-sentencia',
  spontaneous: false,
  guards: [
    () => ajustes.lootActivo() ? { ok: true } : { ok: false, motivo: 'el Loot está apagado', registrar: false },
    ctx => ctx.viewer.login.toLowerCase() === config.broadcasterLogin
      ? { ok: true } : { ok: false, motivo: 'solo el dueño del canal', registrar: false },
    () => jefe && jefe.vida > 1 && jefe.hasta > Date.now()
      ? { ok: true } : { ok: false, motivo: 'no hay un jefe al que sentenciar', registrar: false },
  ],
  run: (ctx): Salida | null => {
    const j = jefe;
    if (!ajustes.lootActivo() || ctx.viewer.login.toLowerCase() !== config.broadcasterLogin || !j || j.vida <= 1 || j.hasta <= Date.now()) return null;
    const dano = j.vida - 1;
    j.vida = 1;
    j.avisoMitad = true;
    j.especialUsado = true;
    apuntarGolpe(j, { quien: ctx.viewer.displayName, dano, critico: true, tipo: 'golpe', icono: '⚡', texto: '¡SENTENCIA!' });
    j.especial = { n: ++especialesTotales, icono: '⚡', titulo: 'Sentencia del canal', texto: `${ctx.viewer.displayName} deja al jefe con 1 de vida. ¡Rematadlo!`, at: Date.now() };
    return { text: `⚡ ¡${ctx.viewer.displayName} lanza SENTENCIA! ${mayuscula(j.nombre)} queda con 1 de vida. ¡Un golpe acertado de !atacar y cae!` };
  },
};

export const atacar: Interaction<CtxComando> = {
  name: 'loot-atacar',
  spontaneous: false,
  // Sin jefe, !atacar no contesta: no es un error, es que ya pasó o no ha empezado.
  guards: [() => (jefe ? { ok: true } : { ok: false, motivo: 'no hay ningún jefe', registrar: false })],
  cooldowns: [
    {
      key: (ctx) => cooldowns.keys.user('loot-atacar', ctx.viewer.id),
      ms: ATAQUE_COOLDOWN_MS,
      motivo: (_ctx, faltan) => `cooldown, faltan ${faltan}s`,
    },
  ],
  run: (ctx): Salida | null => {
    const j = jefe!;
    const azar = ctx.azar ?? Math.random;
    const now = Date.now();
    const yo = ctx.viewer;

    // Congelado, atrapado, desconectado…: el golpe no llega. Se ve en el
    // overlay, no en el chat: el chat ya lo dijo al lanzar el especial.
    const bloqueo = j.bloqueos.get(yo.id);
    if (bloqueo && bloqueo.hasta > now) {
      apuntarGolpe(j, { quien: yo.displayName, dano: 0, critico: false, tipo: 'bloqueado', icono: bloqueo.icono, texto: bloqueo.texto });
      return null;
    }
    if (j.fallan.delete(yo.id)) {
      apuntarGolpe(j, { quien: yo.displayName, dano: 0, critico: false, tipo: 'fallo', icono: '🤢', texto: '¡FALLO!' });
      return null;
    }

    let { dano, critico } = golpe(lootDb.poder(yo.id), azar);
    const debil = j.debiles.get(yo.id);
    if (debil && debil.hasta > now) dano = Math.max(1, Math.round(dano * debil.factor));
    const conGrito = Boolean(j.grito && j.grito.hasta > now);
    if (conGrito) dano = Math.round(dano * GRITO_FACTOR);
    apuntarGolpe(j, { quien: yo.displayName, dano, critico, tipo: 'golpe', icono: debil && debil.hasta > now ? '🐍' : conGrito ? '📯' : undefined });
    const antes = j.danos.get(ctx.viewer.id)?.dano ?? 0;
    j.danos.set(ctx.viewer.id, { viewer: ctx.viewer, dano: antes + dano });
    j.vida = Math.max(0, j.vida - dano);

    if (j.vida === 0) {
      const { text, resumen } = derrotado(j, ctx.azar ?? Math.random);
      // Queda en el registro con lo que pasó DE VERDAD con el mensaje: antes
      // se apuntaba «enviado» aunque el tope por hora lo hubiera bloqueado.
      return { text, detail: (o) => (o.sent ? resumen : `${resumen} · el mensaje no salió: ${o.detail}`) };
    }
    const mensajes: string[] = [];
    const especial = lanzarEspecial(j, azar, now);
    if (especial) mensajes.push(especial);
    if (!j.avisoMitad && j.vida <= j.vidaMax / 2) {
      j.avisoMitad = true;
      const restan = quedan(j, now);
      mensajes.push(`💥 ¡${mayuscula(j.nombre)} está a la mitad (${j.vida}/${j.vidaMax})! Quedan ${restan} s: ¡!atacar!`);
    }
    return mensajes.length ? { text: mensajes.join(' ') } : null;
  },
};

/** Qué ataque lanzan unos bits: 100-499 cristal, 500-999 tormenta, 1000 o más mecenas. */
export function claseDeBits(bits: number): ClaseAliado | null {
  if (bits >= 1000) return 'mecenas';
  if (bits >= 500) return 'tormenta';
  if (bits >= 100) return 'cristal';
  return null;
}

/** Un golpe pagado: pega aunque estés congelado o atrapado, y sin esperar. */
function pegarPagado(j: Jefe, quien: Viewer | null, nombre: string, dano: number, critico: boolean, icono: string, texto?: string): number {
  const d = Math.max(0, Math.min(dano, j.vida));
  if (!d) return 0;
  apuntarGolpe(j, { quien: nombre, dano: d, critico, tipo: 'golpe', icono, texto });
  if (quien?.id) j.danos.set(quien.id, { viewer: quien, dano: (j.danos.get(quien.id)?.dano ?? 0) + d });
  j.vida -= d;
  return d;
}

function anunciarAliado(j: Jefe, clase: ClaseAliado, quien: string, texto: string, now: number): void {
  j.aliado = { n: ++aliadosTotales, clase, icono: ALIADOS[clase].icono, titulo: ALIADOS[clase].titulo, quien, texto, at: now };
}

/** Uno o dos mensajes: el segundo, el reparto si el ataque lo tumba (juntos podrían pasar del largo máximo). */
function trasAtaque(j: Jefe, inicio: string, azar: Azar, cola = `Le quedan ${j.vida}/${j.vidaMax}.`): string[] {
  if (j.vida === 0) return [inicio, derrotado(j, azar).text];
  return [`${inicio} ${cola}`];
}

/**
 * Bits contra el jefe (propuesta S7, con sus ataques desde el 2 oct 2026):
 * 100 bits, un golpe (hasta 4); 500, Tormenta de cristal (5 golpes, el primero
 * crítico); 1000, Golpe del mecenas (TOPE_ATAQUE de la vida de una vez). Nada
 * quita más de TOPE_ATAQUE. Devuelve lo que se dice en el chat, o null si no
 * hay jefe (entonces los bits invocan uno o dan un cofre: mecenas.ts).
 */
export function golpesDeBits(viewer: Viewer, bits: number, azar: Azar = Math.random, now = Date.now()): string[] | null {
  const j = jefe;
  const clase = claseDeBits(bits);
  if (!j || !clase) return null;
  const tope = Math.round(j.vidaMax * TOPE_ATAQUE);
  let total = 0;
  let golpes = 0;
  if (clase === 'mecenas') {
    total = pegarPagado(j, viewer, viewer.displayName, tope, true, '🗡️', '¡MECENAS!');
    golpes = total ? 1 : 0;
  } else {
    const n = clase === 'tormenta' ? 5 : Math.floor(bits / 100);
    for (let i = 0; i < n && j.vida > 0 && total < tope; i++) {
      const g = golpe(lootDb.poder(viewer.id), azar);
      const critico = clase === 'tormenta' && i === 0 ? true : g.critico;
      const dano = critico && !g.critico ? g.dano * 2 : g.dano;
      total += pegarPagado(j, viewer, viewer.displayName, Math.min(dano, tope - total), critico, clase === 'tormenta' ? '⚡' : '💎');
      golpes++;
    }
  }
  const { icono, titulo } = ALIADOS[clase];
  anunciarAliado(j, clase, viewer.displayName, `${bits} bits · −${total}`, now);
  const detalle = clase === 'mecenas' ? '' : `: ${golpes} golpe${golpes === 1 ? '' : 's'}${clase === 'tormenta' ? ' con crítico' : ''}`;
  return trasAtaque(j, `${icono} ¡${viewer.displayName} lanza ${titulo} con ${bits} bits contra ${j.nombre}${detalle}, −${total}!`, azar);
}

/**
 * Un sub con el jefe en pie: Grito de guerra. Un golpe de GOLPE_SUB de la vida
 * y, durante GRITO_MS, los !atacar de todo el chat pegan GRITO_FACTOR.
 */
export function gritoDeSub(viewer: Viewer, azar: Azar = Math.random, now = Date.now()): string[] | null {
  const j = jefe;
  if (!j) return null;
  const dano = pegarPagado(j, viewer, viewer.displayName, Math.max(20, Math.round(j.vidaMax * GOLPE_SUB)), true, '📯', '¡GRITO!');
  j.grito = { hasta: now + GRITO_MS, quien: viewer.displayName };
  const pct = Math.round((GRITO_FACTOR - 1) * 100);
  anunciarAliado(j, 'grito', viewer.displayName, `−${dano} · todo el chat +${pct} % de daño ${GRITO_MS / 1000} s`, now);
  return trasAtaque(j, `📯 ¡${viewer.displayName} lanza un Grito de guerra contra ${j.nombre}: −${dano}!`, azar,
    `Todo el chat pega un ${pct} % más durante ${GRITO_MS / 1000} s: ¡!atacar!`);
}

/**
 * Subs regaladas con el jefe en pie: Refuerzos. Un golpe por sub (hasta
 * TOPE_REFUERZOS), a nombre de quien la recibe, que así entra en el reparto.
 * Sin receptores conocidos (bomba anónima), pegan a nombre de quien regala.
 */
export function refuerzos(regala: Viewer | null, recibe: Viewer[], n: number, azar: Azar = Math.random, now = Date.now()): string[] | null {
  const j = jefe;
  if (!j || n < 1) return null;
  const tope = Math.round(j.vidaMax * TOPE_ATAQUE);
  let total = 0;
  let golpes = 0;
  for (let i = 0; i < Math.min(n, TOPE_REFUERZOS) && j.vida > 0 && total < tope; i++) {
    const quien = recibe[i] ?? regala;
    const g = golpe(quien?.id ? lootDb.poder(quien.id) : 0, azar);
    total += pegarPagado(j, quien, quien?.displayName ?? 'Refuerzo', Math.min(g.dano, tope - total), g.critico, '🎁');
    golpes++;
  }
  const quien = regala?.displayName ?? 'Alguien anónimo';
  anunciarAliado(j, 'refuerzos', quien, `${n === 1 ? '1 sub regalada' : `${n} subs regaladas`} · ${golpes} golpe${golpes === 1 ? '' : 's'} · −${total}`, now);
  return trasAtaque(j, `🎁 ¡Llegan refuerzos! Las subs de ${quien} pegan ${golpes} ${golpes === 1 ? 'vez' : 'veces'} a ${j.nombre}: −${total}!`, azar);
}

/** ¿Hay un jefe en pie? */
export const hayJefe = () => jefe !== null;

// ---------------------------------------------------------------------------
// Terremoto (28 sep 2026)
// ---------------------------------------------------------------------------
//
// La recompensa solo hacía temblar la imagen, y costaba más que la Maldición.
// Ahora el suelo se abre y sale un jefe para todo el chat; si ya hay uno en
// pie, le cae el techo encima, a nombre de quien lo canjea.

/** Lo que para el Lag el reloj del jefe (28 sep 2026). */
export const CONGELA_MS = 30_000;

/**
 * El Lag con un jefe en pie: su reloj se para CONGELA_MS (en la barra de OBS
 * también: quedanSeg no baja) y se alarga lo mismo. Si ya estaba parado, se
 * alarga la parada. Devuelve los segundos que quedarán, o null sin jefe.
 */
export function congelarReloj(now = Date.now()): { nombre: string; quedanSeg: number } | null {
  const j = jefe;
  if (!j) return null;
  j.hasta += CONGELA_MS;
  j.congeladoHasta = Math.max(now, j.congeladoHasta ?? 0) + CONGELA_MS;
  if (reloj) clearTimeout(reloj);
  reloj = setTimeout(() => void terminarPorTiempo(), Math.max(0, j.hasta - now));
  reloj.unref?.();
  return { nombre: j.nombre, quedanSeg: quedan(j, now) };
}

export const NAME_TERREMOTO = 'loot-terremoto';
/** Lo que quita el derrumbe: una parte de la vida máxima del jefe. */
export const DERRUMBE = 0.25;

/**
 * El techo sobre el jefe en pie. Como los bits: pega aunque estés congelado y
 * sin esperar. Uno o dos mensajes (el segundo, el reparto si lo tumba), o
 * null si no hay jefe.
 */
export function derrumbe(viewer: Viewer, azar: Azar = Math.random): string[] | null {
  const j = jefe;
  if (!j) return null;
  const dano = Math.min(j.vida, Math.round(j.vidaMax * DERRUMBE));
  apuntarGolpe(j, { quien: viewer.displayName, dano, critico: true, tipo: 'golpe', icono: '🌋' });
  j.danos.set(viewer.id, { viewer, dano: (j.danos.get(viewer.id)?.dano ?? 0) + dano });
  j.vida = Math.max(0, j.vida - dano);
  const inicio = `🌋 ¡El terremoto de ${viewer.displayName} hace caer el techo sobre ${j.nombre}: −${dano}!`;
  if (j.vida === 0) return [inicio, derrotado(j, azar).text];
  return [`${inicio} Le quedan ${j.vida}/${j.vidaMax}.`];
}

export const terremoto: Interaction<Ctx & { trigger: 'channel-point'; azar: Azar }> = {
  name: NAME_TERREMOTO,
  spontaneous: false,
  // Registrados: si la imagen tiembla y no sale nada, en el Registro está por qué.
  guards: [
    () => (ajustes.lootActivo() ? { ok: true } : { ok: false, motivo: 'el Loot está apagado', registrar: true }),
    () => (streams.current() ? { ok: true } : { ok: false, motivo: SIN_DIRECTO_JEFE, registrar: true }),
    (ctx) => (consent.haPedidoOlvido(ctx.viewer.id) ? { ok: false, motivo: 'pidió el olvido' } : { ok: true }),
  ],
  run: async (ctx) => {
    const golpes = derrumbe(ctx.viewer, ctx.azar);
    if (golpes) {
      if (golpes.length > 1) await send({ text: golpes[0]!, reason: NAME_TERREMOTO, solicitado: true });
      return { text: golpes[golpes.length - 1]! };
    }
    // invocar() dice lo suyo y lo deja en el registro como loot-jefe.
    const r = await invocar({ azar: ctx.azar, intro: `🌋 ¡El terremoto de ${ctx.viewer.displayName} abre el suelo…` });
    if (!r.ok) log.info(`Terremoto: no sale jefe (${r.motivo}).`);
    return null;
  },
};

function apuntarGolpe(j: Jefe, g: Omit<Golpe, 'n'>): void {
  j.golpes.push({ ...g, n: ++golpesTotales });
  if (g.tipo === 'golpe') j.golpesAcertados++;
  if (j.golpes.length > 20) j.golpes.shift();
}

/**
 * El ataque especial: una vez por combate, al bajar del UMBRAL de vida.
 * Le toca a alguien de los que han pegado, al azar. Devuelve lo que se dice
 * en el chat, o null si no toca.
 */
function lanzarEspecial(j: Jefe, azar: Azar, now: number): string | null {
  if (j.especialUsado || j.vida <= 0 || j.vida > j.vidaMax * UMBRAL) return null;
  j.especialUsado = true;
  const esp = ESPECIALES[j.tipo];
  const gente = [...j.danos.values()].map((d) => d.viewer);
  if (!esp || !gente.length) return null;
  const objetivo = gente[Math.min(gente.length - 1, Math.floor(azar() * gente.length))]!;
  const r = esp.aplicar(j, objetivo, mayuscula(j.nombre), now);
  if (r.vida) {
    // Nunca lo mata ni lo deja por encima del máximo: el golpe de gracia es del chat.
    j.vida = Math.min(j.vidaMax, Math.max(1, j.vida + r.vida));
    apuntarGolpe(j, { quien: mayuscula(j.nombre), dano: Math.abs(r.vida), critico: false, tipo: r.vida > 0 ? 'cura' : 'propio', icono: esp.icono });
  }
  j.especial = { n: ++especialesTotales, icono: esp.icono, titulo: r.titulo, texto: r.texto, at: now };
  return r.chat;
}

/** Quién está afectado ahora, para el overlay. */
function afectados(j: Jefe, now: number) {
  const nombre = (id: string) => j.danos.get(id)?.viewer.displayName ?? '?';
  const lista: { quien: string; icono: string; quedanSeg: number | null }[] = [];
  for (const [id, b] of j.bloqueos) if (b.hasta > now) lista.push({ quien: nombre(id), icono: b.icono, quedanSeg: Math.ceil((b.hasta - now) / 1000) });
  for (const [id, d] of j.debiles) if (d.hasta > now) lista.push({ quien: nombre(id), icono: '🐍', quedanSeg: Math.ceil((d.hasta - now) / 1000) });
  for (const id of j.fallan) lista.push({ quien: nombre(id), icono: '🤢', quedanSeg: null });
  if (j.grito && j.grito.hasta > now) {
    lista.unshift({ quien: `Todo el chat +${Math.round((GRITO_FACTOR - 1) * 100)} %`, icono: '📯', quedanSeg: Math.ceil((j.grito.hasta - now) / 1000) });
  }
  return lista;
}

const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function ranking(j: Jefe) {
  return [...j.danos.values()].sort((a, b) => b.dano - a.dano);
}

/** El jefe cae: reparte el botín y devuelve el mensaje. */
function derrotado(j: Jefe, azar: Azar): { text: string; resumen: string } {
  cerrar();
  const orden = ranking(j);
  apuntarFinal(j, 'derrotado', orden);
  const conBotin = orden.filter(
    ({ viewer }) => juega(viewer.login) && !consent.haPedidoOlvido(viewer.id),
  );
  const reparto: Reparto[] = conBotin.map(({ viewer }, i) => {
    // Quien más daño hizo (entre quienes reciben botín), Cofre del tesoro.
    // En la semana de Caza mayor, todos.
    const botin = tirar(i === 0 || eventos.activo('caza-mayor') ? 'oro' : 'cofre', azar);
    return { viewer, botin, resultado: lootDb.dar(viewer.id, viewer.displayName, botin, 'jefe') };
  });
  for (const r of reparto) enPantalla(r.viewer.displayName, r.botin, 'jefe');
  // El MVP suma puntos de temporada (el botín ya suma lo suyo).
  if (reparto[0]) temporadas.sumar(reparto[0].viewer.id, reparto[0].viewer.displayName, PUNTOS_MVP);
  const misionCompletada = reparto.length > 0 && misiones.registrar('jefes');
  const resumen = `jefe derrotado, ${j.nombre}: ${orden.map((o) => `${o.viewer.login}=${o.dano}`).join(', ')}`;

  const mvp = orden[0]!;
  novedades.anotar('jefe', 'Jefe derrotado', mvp.viewer.displayName,
    reparto[0] ? `MVP contra ${j.nombre} · ${reparto[0].viewer.displayName} gana +${PUNTOS_MVP} puntos del mes` : `MVP contra ${j.nombre}`);
  const inicio = `🏆 ¡${mayuscula(j.nombre)} ha caído!${misionCompletada ? ' ¡Misión del directo completada!' : ''} MVP ${mvp.viewer.displayName} (${mvp.dano} de daño). `;
  if (!reparto.length) return { text: `${inicio}Sin nadie más para repartir el botín… ¡a la próxima!`, resumen };
  return { text: componerCofre(reparto, inicio), resumen };
}

async function terminarPorTiempo(): Promise<void> {
  const j = jefe;
  if (!j) return;
  cerrar();
  const orden = ranking(j);
  apuntarFinal(j, 'escapa', orden);
  const mejor = orden[0] ? ` Quien más pegó: ${orden[0].viewer.displayName} (${orden[0].dano}).` : ' Nadie le ha tocado.';
  try {
    const outcome = await send({
      text: `💨 ${mayuscula(j.nombre)} se escapa con ${j.vida}/${j.vidaMax} de vida.${mejor} ¡A la próxima!`,
      reason: NAME,
      solicitado: true,
    });
    interactionLog.record({ interaction: NAME, status: outcome.sent ? 'sent' : 'blocked', detail: `se escapa ${j.nombre} (${j.vida}/${j.vidaMax})` });
  } catch (err) {
    log.error(`Jefe: fallo al anunciar la huida: ${String(err)}`);
  }
}

function apuntarFinal(j: Jefe, resultado: Final['resultado'], orden: ReturnType<typeof ranking>): void {
  final = {
    id: j.id,
    tipo: j.tipo,
    nombre: j.nombre,
    resultado,
    vida: j.vida,
    vidaMax: j.vidaMax,
    podio: orden.slice(0, 3).map((d) => ({ quien: d.viewer.displayName, dano: d.dano })),
    at: Date.now(),
  };
}

/**
 * Lo que pinta el overlay de OBS (biblioteca/overlays/jefe.html). Solo datos
 * que ya salen en el chat: nombres y daño.
 */
export function paraOverlay(now = Date.now()) {
  return {
    jefe: jefe
      ? {
        id: jefe.id,
        tipo: jefe.tipo,
        nombre: jefe.nombre,
        vida: jefe.vida,
        vidaMax: jefe.vidaMax,
        quedanSeg: quedan(jefe, now),
        // El Lag: el reloj de la barra cambia ⏳ por 📶 mientras está parado.
        congelado: Boolean(jefe.congeladoHasta && now < jefe.congeladoHasta),
        golpes: jefe.golpes,
        golpesAcertados: jefe.golpesAcertados,
        especial: jefe.especial && now - jefe.especial.at < CARTEL_ESPECIAL_MS ? jefe.especial : null,
        aliado: jefe.aliado && now - jefe.aliado.at < CARTEL_ESPECIAL_MS ? jefe.aliado : null,
        afectados: afectados(jefe, now),
      }
      : null,
    final: final && now - final.at < FINAL_MS ? final : null,
  };
}

function cerrar(): void {
  if (reloj) clearTimeout(reloj);
  reloj = null;
  jefe = null;
}

/** Lo que enseña el panel. */
export function estado(now = Date.now()) {
  if (!jefe) return null;
  return {
    nombre: jefe.nombre,
    vida: jefe.vida,
    vidaMax: jefe.vidaMax,
    quedanSeg: quedan(jefe, now),
    atacantes: ranking(jefe).map((d) => ({ quien: d.viewer.displayName, dano: d.dano })),
  };
}

/** Desde el panel: se retira sin botín y sin decir nada. */
export function retirar(): boolean {
  if (!jefe) return false;
  cerrar();
  return true;
}

/** Solo para tests. */
export function reset(): void {
  cerrar();
  final = null;
}

/** Solo para tests: que se acabe el tiempo ya. */
export const _terminarPorTiempo = terminarPorTiempo;
