import { config } from '../../config.js';
import * as cooldowns from '../../core/cooldowns.js';
import type { Ctx, Interaction } from '../../core/interaction.js';
import * as lootDb from '../../data/loot.js';
import {
  ESTILO,
  FORJA_CANTIDAD,
  OBJETOS,
  RAREZAS,
  etiqueta,
  siguienteRareza,
  type Azar,
  type Rareza,
} from './objetos.js';
import { buscarPresente, conTitulo, enPantalla, gastarPurificacion, inventario, notaMochila, puedePurificar } from './index.js';

/**
 * Para qué sirve el botín (decidido el 25 sep 2026: los cuatro usos).
 *
 *   !poder             tu poder, tu puesto y tus duelos
 *   !duelo nombre      gana quien más poder tenga, con algo de azar (vale con o sin @)
 *   !forjar [rareza]   3 de una rareza → 1 de la siguiente
 *   !presumir          tu mejor pieza, en la pantalla del directo
 *   !coleccion         cuántos objetos distintos has conseguido; títulos
 *   !loot              la ayuda
 *
 * Todos son comandos: el bot contesta a quien le habla, nunca por su cuenta.
 */

export interface CtxComando extends Ctx {
  trigger: 'command';
  /** Lo que va detrás del comando. */
  args: string;
  azar?: Azar;
}

const porPersona = (nombre: string, ms: number, texto = 'cooldown') => ({
  key: (ctx: CtxComando) => cooldowns.keys.user(nombre, ctx.viewer.id),
  ms,
  motivo: (_ctx: CtxComando, faltan: number) => `${texto}, faltan ${faltan}s`,
});

const mencion = (ctx: CtxComando) => ({ allowedMentions: [ctx.viewer.login] });

// ---------------------------------------------------------------------------
// !poder
// ---------------------------------------------------------------------------

export const poder: Interaction<CtxComando> = {
  name: 'loot-poder',
  spontaneous: false,
  cooldowns: [porPersona('loot-poder', 60_000)],
  run: (ctx) => {
    const inv = lootDb.inventario(ctx.viewer.id);
    if (inv.total === 0) {
      return { text: `@${ctx.viewer.displayName} ⚔️ Poder 0: tu mochila está vacía. Habla en el chat y caerá algo 🎁`, ...mencion(ctx) };
    }
    const p = lootDb.puesto(ctx.viewer.id);
    const d = lootDb.duelos(ctx.viewer.id);
    const puesto = p ? ` · puesto ${p.puesto} de ${p.de}` : '';
    const duelos = d.ganados + d.perdidos > 0 ? ` · duelos ${d.ganados}-${d.perdidos}` : '';
    return { text: `@${conTitulo(ctx.viewer)} ⚔️ Poder ${inv.poder}${puesto}${duelos}`, allowedMentions: [ctx.viewer.login] };
  },
};

// ---------------------------------------------------------------------------
// !duelo @alguien
// ---------------------------------------------------------------------------

/**
 * Probabilidad de que gane quien reta. Proporcional al poder, pero nunca por
 * debajo del 20 % ni por encima del 80 %: con 1-3 personas en el chat, un
 * duelo que el débil no puede ganar nunca deja de hacer gracia muy rápido.
 */
export function probabilidad(poderA: number, poderB: number): number {
  const p = poderA / (poderA + poderB);
  return Math.min(0.8, Math.max(0.2, p));
}

export const duelo: Interaction<CtxComando> = {
  name: 'loot-duelo',
  spontaneous: false,
  guards: [
    (ctx) => (ctx.args.trim() ? { ok: true } : { ok: false, motivo: 'sin rival', registrar: false }),
  ],
  cooldowns: [porPersona('loot-duelo', 3 * 60_000)],
  run: (ctx) => {
    const yo = ctx.viewer;
    const nombreRival = ctx.args.trim().split(/\s+/)[0]!.replace(/^@/, '');
    const rival = buscarPresente(nombreRival);

    if (!rival) {
      return { text: `@${yo.displayName} ⚔️ No veo a ${nombreRival} por el chat. Solo puedes retar a alguien que haya escrito hace poco.`, ...mencion(ctx) };
    }
    if (rival.id === yo.id) {
      return { text: `@${yo.displayName} ⚔️ Retarte a ti mismo es valiente, pero no cuenta.`, ...mencion(ctx) };
    }
    const pa = lootDb.poder(yo.id);
    const pb = lootDb.poder(rival.id);
    if (pa === 0) {
      return { text: `@${yo.displayName} ⚔️ Con la mochila vacía no se reta a nadie. Habla en el chat y caerá algo 🎁`, ...mencion(ctx) };
    }
    if (pb === 0) {
      return { text: `@${yo.displayName} ⚔️ ${rival.displayName} no tiene nada con qué defenderse. Déjale que consiga algo primero.`, ...mencion(ctx) };
    }

    const prob = probabilidad(pa, pb);
    const ganaYo = (ctx.azar ?? Math.random)() < prob;
    const [ganador, perdedor] = ganaYo ? [yo, rival] : [rival, yo];
    lootDb.apuntarDuelo(ganador.id, perdedor.id);
    // La patata caliente: el maldito más fuerte del perdedor cambia de manos.
    const maldito = lootDb.traspasarMaldito(perdedor.id, ganador.id, ganador.displayName);
    if (maldito) enPantalla(ganador.displayName, maldito, 'maldicion');
    const sorpresa = (ganaYo ? prob : 1 - prob) < 0.4 ? ' ¡Sorpresa!' : '';
    const traspaso = maldito ? ` ☠️ ${etiqueta(maldito)} pasa a ${ganador.displayName}.` : '';
    return {
      text:
        `⚔️ @${yo.displayName} (poder ${pa}) reta a @${rival.displayName} (poder ${pb})… ` +
        `¡Gana ${conTitulo(ganador)}!${sorpresa} (${Math.round(prob * 100)} % para quien retaba)${traspaso}`,
      allowedMentions: [yo.login, rival.login],
    };
  },
};

// ---------------------------------------------------------------------------
// !forjar [rareza]
// ---------------------------------------------------------------------------

const NOMBRES_RAREZA: Record<string, Rareza> = {
  comun: 'comun', comunes: 'comun', común: 'comun',
  raro: 'raro', raros: 'raro',
  epico: 'epico', epicos: 'epico', épico: 'epico', épicos: 'epico',
};

/** La rareza a forjar: la que se pida, o la más baja de la que haya bastantes. */
function rarezaAForjar(args: string, porRareza: Record<Rareza, number>): Rareza | null {
  const pedida = NOMBRES_RAREZA[args.trim().toLowerCase()];
  if (pedida) return pedida;
  return (['comun', 'raro', 'epico'] as Rareza[]).find((r) => porRareza[r] >= FORJA_CANTIDAD) ?? null;
}

export const forjar: Interaction<CtxComando> = {
  name: 'loot-forjar',
  spontaneous: false,
  cooldowns: [porPersona('loot-forjar', 30_000)],
  run: (ctx) => {
    const yo = ctx.viewer;
    const inv = lootDb.inventario(yo.id);
    // Solo cuenta lo que se puede fundir: los malditos no entran en la forja.
    const rareza = rarezaAForjar(ctx.args, inv.forjables);
    const cuenta = RAREZAS.filter((r) => r !== 'legendario').map((r) => `${inv.forjables[r]}${ESTILO[r].emoji}`).join(' ');
    const fundidos = rareza && inv.forjables[rareza] >= FORJA_CANTIDAD ? lootDb.consumir(yo.id, rareza, FORJA_CANTIDAD) : null;

    if (!rareza || !fundidos) {
      return {
        text: `@${yo.displayName} 🔨 Para forjar hacen falta ${FORJA_CANTIDAD} objetos de la misma rareza (tienes ${cuenta}).`,
        ...mencion(ctx),
      };
    }
    const destino = siguienteRareza(rareza)!;
    const lista = OBJETOS[destino];
    const objeto = lista[Math.floor((ctx.azar ?? Math.random)() * lista.length)]!;
    const botin = { objeto, rareza: destino };
    const resultado = lootDb.dar(yo.id, yo.displayName, botin, 'forja');
    enPantalla(yo.displayName, botin, 'forja');
    const titulo = resultado.tituloNuevo ? ` · 🏆 ¡Colección completa: «${resultado.tituloNuevo}»!` : '';
    return {
      text: `🔨 @${yo.displayName} funde ${fundidos.length} ${ESTILO[rareza].emoji} y forja → ${etiqueta(botin)}${notaMochila(resultado)}${titulo}`,
      ...mencion(ctx),
    };
  },
};

// ---------------------------------------------------------------------------
// !presumir
// ---------------------------------------------------------------------------

export const presumir: Interaction<CtxComando> = {
  name: 'loot-presumir',
  spontaneous: false,
  cooldowns: [
    // En pantalla: 10 minutos por persona, y un minuto entre quien sea.
    porPersona('loot-presumir', 10 * 60_000),
    {
      key: () => cooldowns.keys.interaction('loot-presumir'),
      ms: 60_000,
      motivo: (_ctx, faltan) => `la pantalla está ocupada, faltan ${faltan}s`,
    },
  ],
  run: (ctx) => {
    const yo = ctx.viewer;
    const mejor = lootDb.inventario(yo.id).mejor;
    if (!mejor) {
      return { text: `@${yo.displayName} 💪 Aún no tienes nada de lo que presumir. Habla en el chat y caerá algo 🎁`, ...mencion(ctx) };
    }
    enPantalla(conTitulo(yo), mejor, 'presumir');
    return { text: `💪 @${conTitulo(yo)} presume de ${etiqueta(mejor)}`, ...mencion(ctx) };
  },
};

// ---------------------------------------------------------------------------
// !purificar (tras canjear una Poción de vida)
// ---------------------------------------------------------------------------

export const purificar: Interaction<CtxComando> = {
  name: 'loot-purificar',
  spontaneous: false,
  cooldowns: [porPersona('loot-purificar', 10_000)],
  run: (ctx) => {
    const yo = ctx.viewer;
    if (!puedePurificar(yo.id)) {
      return {
        text: `@${yo.displayName} 🧪 Para purificar un objeto maldito, canjea antes una Poción de vida con Oro.`,
        ...mencion(ctx),
      };
    }
    const limpio = lootDb.purificar(yo.id);
    gastarPurificacion(yo.id);
    if (!limpio) return { text: `@${yo.displayName} 🧪 Ya no llevas nada maldito.`, ...mencion(ctx) };
    enPantalla(yo.displayName, limpio, 'purificar');
    return {
      text: `🧪 @${yo.displayName} purifica ${etiqueta(limpio)}: ya es suyo para siempre (sin el poder doble).`,
      ...mencion(ctx),
    };
  },
};

// ---------------------------------------------------------------------------
// !coleccion
// ---------------------------------------------------------------------------

export const coleccion: Interaction<CtxComando> = {
  name: 'loot-coleccion',
  spontaneous: false,
  cooldowns: [porPersona('loot-coleccion', 60_000)],
  run: (ctx) => {
    const c = lootDb.coleccion(ctx.viewer.id);
    const t = lootDb.titulo(ctx.viewer.id);
    const partes = RAREZAS.map((r) => `${ESTILO[r].emoji} ${c.porRareza[r].tiene}/${c.porRareza[r].de}`).join(' ');
    const final = t ? ` · Título: «${t}»` : ' · Completa una rareza para ganar un título';
    return { text: `@${ctx.viewer.displayName} 📖 Colección ${c.total}/${c.de}: ${partes}${final}`, ...mencion(ctx) };
  },
};

// ---------------------------------------------------------------------------
// !loot (ayuda)
// ---------------------------------------------------------------------------

export const ayuda: Interaction<CtxComando> = {
  name: 'loot-ayuda',
  spontaneous: false,
  cooldowns: [
    { key: () => cooldowns.keys.interaction('loot-ayuda'), ms: 2 * 60_000, motivo: (_c, f) => `cooldown, faltan ${f}s` },
  ],
  run: () => ({
    text:
      `🎁 Loot: cada ${config.loot.minutosMin}-${config.loot.minutosMax} min cae un cofre para quien hable en el chat, ` +
      // Sin @ en el ejemplo del duelo: policy bloquea mencionar a quien no participa.
      `y con Oro está el ${config.loot.cofreRewardTitle}. Comandos: !inventario !poder !duelo nombre !forjar !presumir !coleccion`,
  }),
};

// ---------------------------------------------------------------------------
// El reparto de comandos
// ---------------------------------------------------------------------------

const COMANDOS: Array<[RegExp, Interaction<CtxComando>]> = [
  [/^!(inventario|inv|mochila)\b/i, inventario as unknown as Interaction<CtxComando>],
  [/^!poder\b/i, poder],
  [/^!duelo\b/i, duelo],
  [/^!forjar\b/i, forjar],
  [/^!presumir\b/i, presumir],
  [/^!colecci[oó]n\b/i, coleccion],
  [/^!purificar\b/i, purificar],
  [/^!loot\b/i, ayuda],
];

/** El comando del Loot que es este mensaje, con lo que va detrás; o null. */
export function buscar(texto: string): { def: Interaction<CtxComando>; args: string } | null {
  for (const [re, def] of COMANDOS) {
    const m = re.exec(texto);
    if (m) return { def, args: texto.slice(m[0].length) };
  }
  return null;
}

/** Para el panel: los comandos, tal cual se anuncian. */
export const LISTA = [
  ['!loot', 'Explica el Loot y sus comandos'],
  ['!inventario', 'Tu mochila (máx. 20), tu poder y tu mejor pieza. También !mochila e !inv'],
  ['!poder', 'Tu poder, tu puesto y tus duelos ganados'],
  ['!duelo nombre', 'Reta a quien esté en el chat (con o sin @). Más poder, más posibilidades (20-80 %)'],
  ['!forjar', `${FORJA_CANTIDAD} objetos de una rareza → 1 de la siguiente. Se puede elegir: !forjar raros`],
  ['!presumir', 'Tu mejor pieza, en la pantalla del directo'],
  ['!coleccion', 'Cuántos objetos distintos has conseguido. Completar una rareza da título'],
  ['!purificar', 'Tras canjear una Poción de vida: limpia tu objeto maldito (ya no lo pierdes, pero sin poder doble)'],
] as const;

