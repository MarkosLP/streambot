import { getDb, nowIso } from '../../data/db.js';
import * as cooldowns from '../../core/cooldowns.js';
import type { Ctx, Interaction } from '../../core/interaction.js';
import type { Viewer } from '../../core/events.js';
import * as lootDb from '../../data/loot.js';
import * as temporadas from '../../data/temporadas.js';
import { log } from '../../core/logger.js';
import { ESTILO, PODER, etiqueta, type Azar, type Rareza } from './objetos.js';
import { buscarPresente, conTitulo } from './index.js';
import * as arena from './arena.js';
import * as temporada from './temporada.js';

/**
 * Duelos del chat (11 oct 2026). Antes eran una sola tirada que caía encima
 * del retado sin que hiciera nada. Ahora:
 *
 *   !duelo nombre   reta; el retado tiene RETO_MS para contestar
 *   !acepto         pelea: tres asaltos con objetos sacados de cada mochila
 *   !huyo           rechaza; nadie pierde nada (también si no contesta)
 *   !revancha       quien pierde, durante REVANCHA_MS: +10 % y puntos dobles
 *
 * Lo justo no cambia: el poder de toda la mochila fija la probabilidad
 * (20-80 %) y cada asalto se calibra para que el mejor de tres la respete.
 * Los objetos que salen en cada asalto la mueven un poco, y se ven.
 *
 * En pantalla (fuente «FX Jefe») solo sale la pelea, nunca la espera, y como
 * mucho unos 10 s; el panel puede dejarla en corta (5 s) o solo en el chat.
 */

export const RETO_MS = 60_000;
export const REVANCHA_MS = 2 * 60_000;
/** Tras pelear, cuánto hay que esperar para retar a otro (la revancha no espera). */
export const DESCANSO_MS = 3 * 60_000;
export const BONO_REVANCHA = 0.1;
/** Cuánto mueve un asalto la diferencia de poder entre los dos objetos que salen. */
const PESO_OBJETOS = 0.08;

export interface CtxComando extends Ctx {
  trigger: 'command';
  args: string;
  azar?: Azar;
}

/**
 * Probabilidad de que gane quien reta. Proporcional al poder, pero nunca por
 * debajo del 20 % ni por encima del 80 %: con 1-3 personas en el chat, un
 * duelo que el débil no puede ganar nunca deja de hacer gracia muy rápido.
 */
export function probabilidad(poderA: number, poderB: number): number {
  const p = poderA / (poderA + poderB);
  return Math.min(0.8, Math.max(0.2, p));
}

/** La probabilidad de ganar UN asalto para que ganar dos de tres sea `p`: q²(3 − 2q) = p. */
export function probAsalto(p: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (m * m * (3 - 2 * m) < p) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

export interface Pieza { objeto: string; rareza: Rareza; maldito: boolean }
export interface Asalto { a: Pieza; b: Pieza; prob: number; ganaRetador: boolean }

const fuerza = (p: Pieza) => PODER[p.rareza] * (p.maldito ? 2 : 1);

/** Los tres asaltos (o dos, si alguien gana los dos primeros). */
export function combatir(prob: number, mochilaA: Pieza[], mochilaB: Pieza[], azar: Azar): { asaltos: Asalto[]; ganaRetador: boolean } {
  const q = probAsalto(prob);
  const asaltos: Asalto[] = [];
  let ganadosA = 0;
  let ganadosB = 0;
  const sacar = (m: Pieza[]) => m[Math.min(m.length - 1, Math.floor(azar() * m.length))]!;
  while (ganadosA < 2 && ganadosB < 2) {
    const a = sacar(mochilaA);
    const b = sacar(mochilaB);
    const p = Math.min(0.9, Math.max(0.1, q + PESO_OBJETOS * (fuerza(a) - fuerza(b)) / (fuerza(a) + fuerza(b))));
    const ganaRetador = azar() < p;
    if (ganaRetador) ganadosA++;
    else ganadosB++;
    asaltos.push({ a, b, prob: p, ganaRetador });
  }
  return { asaltos, ganaRetador: ganadosA === 2 };
}

// ---------------------------------------------------------------------------
// En pantalla: completo · corto · solo chat (se guarda en `ajustes`)
// ---------------------------------------------------------------------------

export const MODOS_PANTALLA = ['completo', 'corto', 'chat'] as const;
export type ModoPantalla = (typeof MODOS_PANTALLA)[number];
const CLAVE = 'duelos';
let modo: ModoPantalla | null = null;

export function pantalla(): ModoPantalla {
  if (modo) return modo;
  try {
    const f = getDb().prepare('SELECT valor FROM ajustes WHERE clave = ?').get(CLAVE) as { valor: string } | undefined;
    const v = f ? JSON.parse(f.valor)?.pantalla : null;
    modo = MODOS_PANTALLA.includes(v) ? v : 'completo';
  } catch {
    modo = 'completo';
  }
  return modo!;
}

export function setPantalla(valor: unknown): ModoPantalla {
  if (!MODOS_PANTALLA.includes(valor as ModoPantalla)) throw new Error('modo de pantalla no válido');
  modo = valor as ModoPantalla;
  try {
    getDb()
      .prepare('INSERT INTO ajustes (clave, valor, at) VALUES (?, ?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, at = excluded.at')
      .run(CLAVE, JSON.stringify({ pantalla: modo }), nowIso());
  } catch (err) {
    log.debug(`Duelos sin guardar: ${String(err)}`);
  }
  return modo;
}

// ---------------------------------------------------------------------------
// Retos pendientes, revanchas y descansos (en memoria: un reinicio los olvida)
// ---------------------------------------------------------------------------

interface Reto { retador: Viewer; rival: Viewer; at: number; revancha: boolean }
/** Por id del retado: cada uno tiene como mucho un reto esperándole. */
const retos = new Map<string, Reto>();
/** Por id de quien perdió: a quién puede pedirle la revancha y desde cuándo. */
const revanchas = new Map<string, { ganador: Viewer; at: number }>();
/** Por id: cuándo peleó por última vez. */
const ultimoDuelo = new Map<string, number>();

function limpiar(now: number): void {
  for (const [id, r] of retos) if (now - r.at >= RETO_MS) retos.delete(id);
  for (const [id, r] of revanchas) if (now - r.at >= REVANCHA_MS) revanchas.delete(id);
}

/** Solo para tests. */
export function reset(): void {
  retos.clear();
  revanchas.clear();
  ultimoDuelo.clear();
  modo = null;
}

/** Para el panel o las pruebas: los retos que esperan respuesta. */
export function pendientes(now = Date.now()): Array<{ retador: string; rival: string; quedanSeg: number; revancha: boolean }> {
  limpiar(now);
  return [...retos.values()].map((r) => ({ retador: r.retador.displayName, rival: r.rival.displayName, quedanSeg: Math.ceil((RETO_MS - (now - r.at)) / 1000), revancha: r.revancha }));
}

// ---------------------------------------------------------------------------
// Los comandos
// ---------------------------------------------------------------------------

const antiSpam = (nombre: string) => ({
  key: (ctx: CtxComando) => cooldowns.keys.user(nombre, ctx.viewer.id),
  ms: 5_000,
  motivo: (_ctx: CtxComando, faltan: number) => `cooldown, faltan ${faltan}s`,
});
const ahora = (ctx: CtxComando) => (ctx as { now?: number }).now ?? Date.now();
const piezas = (id: string): Pieza[] => lootDb.mochila(id).map((p) => ({ objeto: p.objeto, rareza: p.rareza, maldito: p.maldito === true }));

/** El retado ya tiene un reto de otra persona: no se le amontonan. */
function ocupado(rival: Viewer, retador: Viewer): string | null {
  const r = retos.get(rival.id);
  if (!r || r.retador.id === retador.id) return null;
  return `@${retador.displayName} ⚔️ ${rival.displayName} ya tiene un reto de ${r.retador.displayName} esperando. Prueba en un momento.`;
}

function abrirReto(retador: Viewer, rival: Viewer, revancha: boolean, now: number): void {
  // Un reto saliente por persona: el nuevo sustituye al anterior.
  for (const [id, r] of retos) if (r.retador.id === retador.id) retos.delete(id);
  retos.set(rival.id, { retador, rival, at: now, revancha });
}

export const duelo: Interaction<CtxComando> = {
  name: 'loot-duelo-reto',
  spontaneous: false,
  guards: [(ctx) => (ctx.args.trim() ? { ok: true } : { ok: false, motivo: 'sin rival', registrar: false })],
  cooldowns: [antiSpam('loot-duelo-reto')],
  run: (ctx) => {
    const now = ahora(ctx);
    limpiar(now);
    const yo = ctx.viewer;
    const nombreRival = ctx.args.trim().split(/\s+/)[0]!.replace(/^@/, '');
    const rival = buscarPresente(nombreRival, now);
    const solo = { allowedMentions: [yo.login] };
    if (!rival) return { text: `@${yo.displayName} ⚔️ No veo a ${nombreRival} por el chat. Solo puedes retar a alguien que haya escrito hace poco.`, ...solo };
    if (rival.id === yo.id) return { text: `@${yo.displayName} ⚔️ Retarte a ti mismo es valiente, pero no cuenta.`, ...solo };
    const pa = lootDb.poder(yo.id);
    const pb = lootDb.poder(rival.id);
    if (pa === 0) return { text: `@${yo.displayName} ⚔️ Con la mochila vacía no se reta a nadie. Habla en el chat y caerá algo 🎁`, ...solo };
    if (pb === 0) return { text: `@${yo.displayName} ⚔️ ${rival.displayName} no tiene nada con qué defenderse. Déjale que consiga algo primero.`, ...solo };
    const descanso = DESCANSO_MS - (now - (ultimoDuelo.get(yo.id) ?? -Infinity));
    if (descanso > 0) return { text: `@${yo.displayName} ⚔️ Aún te recuperas del último duelo: podrás retar en ${Math.ceil(descanso / 1000)} s.`, ...solo };
    if (retos.get(yo.id)?.retador.id === rival.id) return { text: `@${yo.displayName} ⚔️ ${rival.displayName} ya te ha retado a ti: escribe !acepto.`, ...solo };
    const lleno = ocupado(rival, yo);
    if (lleno) return { text: lleno, ...solo };
    abrirReto(yo, rival, false, now);
    const prob = probabilidad(pa, pb);
    return {
      text: `⚔️ @${yo.displayName} (poder ${pa}, ${Math.round(prob * 100)} %) reta a @${rival.displayName} (poder ${pb}, ${Math.round((1 - prob) * 100)} %). ` +
        `@${rival.displayName}: !acepto para luchar o !huyo para escapar (${RETO_MS / 1000} s).`,
      allowedMentions: [yo.login, rival.login],
    };
  },
};

export const revancha: Interaction<CtxComando> = {
  name: 'loot-duelo-revancha',
  spontaneous: false,
  cooldowns: [antiSpam('loot-duelo-revancha')],
  run: (ctx) => {
    const now = ahora(ctx);
    limpiar(now);
    const yo = ctx.viewer;
    const solo = { allowedMentions: [yo.login] };
    const r = revanchas.get(yo.id);
    if (!r) return { text: `@${yo.displayName} ⚔️ La revancha se pide en los ${REVANCHA_MS / 60_000} minutos siguientes a perder un duelo.`, ...solo };
    const rival = buscarPresente(r.ganador.login, now) ?? r.ganador;
    if (lootDb.poder(yo.id) === 0 || lootDb.poder(rival.id) === 0) {
      revanchas.delete(yo.id);
      return { text: `@${yo.displayName} ⚔️ Para la revancha hace falta que los dos tengáis objetos.`, ...solo };
    }
    const lleno = ocupado(rival, yo);
    if (lleno) return { text: lleno, ...solo };
    revanchas.delete(yo.id);
    abrirReto(yo, rival, true, now);
    return {
      text: `🔥 @${yo.displayName} pide la revancha a @${rival.displayName}: +${Math.round(BONO_REVANCHA * 100)} % y puntos dobles si gana. ` +
        `@${rival.displayName}: !acepto o !huyo (${RETO_MS / 1000} s).`,
      allowedMentions: [yo.login, rival.login],
    };
  },
};

export const huyo: Interaction<CtxComando> = {
  name: 'loot-duelo-huye',
  spontaneous: false,
  cooldowns: [antiSpam('loot-duelo-huye')],
  run: (ctx) => {
    const now = ahora(ctx);
    limpiar(now);
    const yo = ctx.viewer;
    const r = retos.get(yo.id);
    if (!r) return null; // Nada que rechazar: sin respuesta, como cualquier comando suelto.
    retos.delete(yo.id);
    return { text: `🏃 @${yo.displayName} huye del duelo contra @${r.retador.displayName}. Nadie pierde nada.`, allowedMentions: [yo.login, r.retador.login] };
  },
};

/**
 * !acepto: aquí se pelea. Se llama `loot-duelo` porque es el duelo jugado
 * (las estadísticas del panel cuentan los duelos por este nombre).
 */
export const acepto: Interaction<CtxComando> = {
  name: 'loot-duelo',
  spontaneous: false,
  cooldowns: [antiSpam('loot-duelo')],
  run: (ctx) => {
    const now = ahora(ctx);
    limpiar(now);
    const yo = ctx.viewer;
    const r = retos.get(yo.id);
    if (!r) return { text: `@${yo.displayName} ⚔️ No tienes ningún reto pendiente (caducan a los ${RETO_MS / 1000} s).`, allowedMentions: [yo.login] };
    retos.delete(yo.id);
    return pelear(r, ctx.azar ?? Math.random, now);
  },
};

function pelear(r: Reto, azar: Azar, now: number) {
  const a = r.retador;
  const b = r.rival;
  const pa = lootDb.poder(a.id);
  const pb = lootDb.poder(b.id);
  if (pa === 0 || pb === 0) {
    return { text: `⚔️ El duelo entre @${a.displayName} y @${b.displayName} se anula: alguien se ha quedado sin objetos.`, allowedMentions: [a.login, b.login] };
  }
  const prob = Math.min(0.85, probabilidad(pa, pb) + (r.revancha ? BONO_REVANCHA : 0));
  const { asaltos, ganaRetador } = combatir(prob, piezas(a.id), piezas(b.id), azar);
  const [ganador, perdedor] = ganaRetador ? [a, b] : [b, a];
  lootDb.apuntarDuelo(ganador.id, perdedor.id);
  const puntos = temporada.puntosDuelo() * (r.revancha && ganaRetador ? 2 : 1);
  temporadas.sumar(ganador.id, ganador.displayName, puntos);
  // La patata caliente: el maldito más fuerte del perdedor cambia de manos.
  const maldito = lootDb.traspasarMaldito(perdedor.id, ganador.id, ganador.displayName);
  ultimoDuelo.set(a.id, now);
  ultimoDuelo.set(b.id, now);
  // Revancha solo tras un duelo normal: la revancha de la revancha no existe.
  if (!r.revancha) revanchas.set(perdedor.id, { ganador, at: now });
  // Se apunta siempre (el panel lo lista); con «solo chat», el overlay se lo salta.
  {
    arena.registrarDuelo({
      retador: { nombre: a.displayName, titulo: lootDb.titulo(a.id), poder: pa },
      rival: { nombre: b.displayName, titulo: lootDb.titulo(b.id), poder: pb },
      prob,
      tirada: asaltos.at(-1)!.ganaRetador ? 0 : 1,
      ganaRetador,
      maldito: maldito ? maldito.objeto : null,
      asaltos,
      revancha: r.revancha,
      pantalla: pantalla(),
    }, now, { retadorId: a.id, rivalId: b.id });
  }
  const ganadosA = asaltos.filter((x) => x.ganaRetador).length;
  const marcador = ganaRetador ? `${ganadosA}-${asaltos.length - ganadosA}` : `${asaltos.length - ganadosA}-${ganadosA}`;
  const resumen = asaltos.map((x) => `${x.ganaRetador ? a.displayName : b.displayName} ${ESTILO[(x.ganaRetador ? x.a : x.b).rareza].emoji}`).join(' · ');
  const sorpresa = (ganaRetador ? prob : 1 - prob) < 0.4 ? ' ¡Sorpresa!' : '';
  const traspaso = maldito ? ` ☠️ ${etiqueta(maldito)} pasa a ${ganador.displayName}.` : '';
  const otra = r.revancha ? '' : ` @${perdedor.displayName}: !revancha en ${REVANCHA_MS / 60_000} min.`;
  return {
    text: `⚔️ ${r.revancha ? 'Revancha' : 'Duelo'}: ${resumen} → ¡Gana ${conTitulo(ganador)} ${marcador}!${sorpresa} +${puntos} de temporada.${traspaso}${otra}`,
    allowedMentions: [a.login, b.login],
  };
}
