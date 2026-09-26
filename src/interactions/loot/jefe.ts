import { config } from '../../config.js';
import * as ajustes from '../../core/ajustes.js';
import * as consent from '../../core/consent.js';
import * as cooldowns from '../../core/cooldowns.js';
import type { Interaction, Salida } from '../../core/interaction.js';
import { log } from '../../core/logger.js';
import { send } from '../../core/output.js';
import type { Viewer } from '../../core/events.js';
import * as interactionLog from '../../data/interactions.js';
import * as lootDb from '../../data/loot.js';
import { esBot } from '../../core/bots.js';
import type { CtxComando } from './comandos.js';
import { aventureros, componerCofre, enPantalla, juega, type Reparto } from './index.js';
import { tirar, type Azar } from './objetos.js';

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

export const JEFES = [
  'el Dragón de Escarcha',
  'el Rey Esqueleto',
  'la Hidra del Pantano',
  'el Gólem de Obsidiana',
  'el Liche sin Nombre',
  'la Araña Reina',
  'el Kraken del Foso',
  'el Minotauro con Resaca',
  'el Tanque que no sabe tanquear',
  'el Lag Primigenio',
];

/** Un golpe, para el overlay: los números de daño que saltan. */
export interface Golpe {
  n: number;
  quien: string;
  dano: number;
  critico: boolean;
}

interface Jefe {
  /** Cambia con cada jefe: el overlay sabe así que es uno nuevo. */
  id: number;
  nombre: string;
  golpes: Golpe[];
  vidaMax: number;
  vida: number;
  hasta: number;
  danos: Map<string, { viewer: Viewer; dano: number }>;
  avisoMitad: boolean;
}

let jefe: Jefe | null = null;
let contador = 0;
let golpesTotales = 0;

/** Cómo acabó el último jefe, para el rótulo final del overlay. */
export interface Final {
  id: number;
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

export async function invocar({ azar = Math.random, now = Date.now() }: { azar?: Azar; now?: number } = {}): Promise<ResultadoInvocar> {
  if (!ajustes.lootActivo()) return { ok: false, motivo: 'el Loot está apagado' };
  if (jefe) return { ok: false, motivo: `${jefe.nombre} sigue en pie` };
  const nombre = JEFES[Math.floor(azar() * JEFES.length)]!;
  const vidaMax = VIDA_POR_PERSONA * Math.max(1, aventureros(now).length);
  jefe = { id: ++contador, nombre, golpes: [], vidaMax, vida: vidaMax, hasta: now + DURACION_MS, danos: new Map(), avisoMitad: false };
  final = null;
  reloj = setTimeout(() => void terminarPorTiempo(), DURACION_MS);
  reloj.unref?.();

  const outcome = await send({
    text: `🐉 ¡Aparece ${nombre} con ${vidaMax} de vida! Escribid !atacar para derribarlo: tenéis ${DURACION_MS / 60_000} min. Botín para todos los que peguen.`,
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
    const { dano, critico } = golpe(lootDb.poder(ctx.viewer.id), ctx.azar ?? Math.random);
    j.golpes.push({ n: ++golpesTotales, quien: ctx.viewer.displayName, dano, critico });
    if (j.golpes.length > 20) j.golpes.shift();
    const antes = j.danos.get(ctx.viewer.id)?.dano ?? 0;
    j.danos.set(ctx.viewer.id, { viewer: ctx.viewer, dano: antes + dano });
    j.vida = Math.max(0, j.vida - dano);

    if (j.vida === 0) {
      const { text, resumen } = derrotado(j, ctx.azar ?? Math.random);
      // Queda en el registro con lo que pasó DE VERDAD con el mensaje: antes
      // se apuntaba «enviado» aunque el tope por hora lo hubiera bloqueado.
      return { text, detail: (o) => (o.sent ? resumen : `${resumen} · el mensaje no salió: ${o.detail}`) };
    }
    if (!j.avisoMitad && j.vida <= j.vidaMax / 2) {
      j.avisoMitad = true;
      const quedan = Math.max(0, Math.round((j.hasta - Date.now()) / 1000));
      return { text: `💥 ¡${mayuscula(j.nombre)} está a la mitad (${j.vida}/${j.vidaMax})! Quedan ${quedan} s: ¡!atacar!` };
    }
    return null;
  },
};

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
    const botin = tirar(i === 0 ? 'oro' : 'cofre', azar);
    return { viewer, botin, resultado: lootDb.dar(viewer.id, viewer.displayName, botin, 'jefe') };
  });
  for (const r of reparto) enPantalla(r.viewer.displayName, r.botin, 'jefe');
  const resumen = `jefe derrotado, ${j.nombre}: ${orden.map((o) => `${o.viewer.login}=${o.dano}`).join(', ')}`;

  const mvp = orden[0]!;
  const inicio = `🏆 ¡${mayuscula(j.nombre)} ha caído! MVP ${mvp.viewer.displayName} (${mvp.dano} de daño). `;
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
        nombre: jefe.nombre,
        vida: jefe.vida,
        vidaMax: jefe.vidaMax,
        quedanSeg: Math.max(0, Math.round((jefe.hasta - now) / 1000)),
        golpes: jefe.golpes,
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
    quedanSeg: Math.max(0, Math.round((jefe.hasta - now) / 1000)),
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
