import { config, MAX_MESSAGE_LENGTH } from '../../config.js';
import * as ajustes from '../../core/ajustes.js';
import * as cooldowns from '../../core/cooldowns.js';
import { log } from '../../core/logger.js';
import * as streams from '../../data/streams.js';
import type { Ctx, Interaction } from '../../core/interaction.js';
import * as lootDb from '../../data/loot.js';
import {
  ESTILO,
  FORJA_CANTIDAD,
  MOCHILA_MAX,
  OBJETOS,
  RAREZAS,
  etiqueta,
  siguienteRareza,
  tirar,
  type Azar,
  type Botin,
  type Rareza,
} from './objetos.js';
import {
  atraerCofreDeGuerra,
  buscarPresente,
  conTitulo,
  enPantalla,
  gastarPurificacion,
  inventario,
  juega,
  lanzarEfecto,
  notaMochila,
  puedePurificar,
  type EfectoCanal,
} from './index.js';
import * as arena from './arena.js';
import * as jefe from './jefe.js';

const sinTildes = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();

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
    // En pantalla lo enseña el overlay del duelo, maldito incluido: el banner
    // del botín saldría a la vez, en el mismo sitio.
    arena.registrarDuelo({
      retador: { nombre: yo.displayName, titulo: lootDb.titulo(yo.id), poder: pa },
      rival: { nombre: rival.displayName, titulo: lootDb.titulo(rival.id), poder: pb },
      prob,
      ganaRetador: ganaYo,
      maldito: maldito ? maldito.objeto : null,
    });
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
        text: `@${yo.displayName} 🧪 Para purificar un objeto maldito, canjea antes una Poción de vida con Oros.`,
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
// !dar nombre [rareza u objeto]
// ---------------------------------------------------------------------------

const RAREZA_POR_NOMBRE: Record<string, Rareza> = {
  ...NOMBRES_RAREZA,
  legendario: 'legendario', legendarios: 'legendario',
};

/**
 * Regalar un objeto a otra persona del chat (rehecho el 26 sep 2026: con el
 * primero nadie sabía qué estaba dando).
 *
 *   !dar                 cómo se usa, y tus objetos numerados
 *   !dar ana             lo mismo, preguntando qué le das a ana
 *   !dar ana 2           el número 2 de esa lista
 *   !dar ana epico       el más antiguo de esa rareza
 *   !dar ana capa        el que lleve «capa» en el nombre
 *
 * Los malditos no se regalan: solo cambian de manos perdiendo un duelo.
 */
const DAR_COOLDOWN_MS = 30_000;

/** `1 ⚪ Mapa arrugado · 2 🔵 Arco de tejo élfico · …`, hasta donde quepa. */
function listaRegalables(objetos: Array<Botin & { id: number }>, cabe: number): string {
  let texto = '';
  for (let i = 0; i < objetos.length; i++) {
    const trozo = `${i === 0 ? '' : ' · '}${i + 1} ${etiqueta(objetos[i]!)}`;
    const resto = objetos.length - i - 1;
    if (texto.length + trozo.length + (resto ? 12 : 0) > cabe) return `${texto} · y ${objetos.length - i} más`;
    texto += trozo;
  }
  return texto;
}

export const dar: Interaction<CtxComando> = {
  name: 'loot-dar',
  spontaneous: false,
  // Un freno corto contra el spam de la lista. El de verdad (30 s) solo se
  // gasta al regalar: mirar la lista y regalar justo después tiene que poder ser.
  cooldowns: [porPersona('loot-dar', 5_000)],
  run: (ctx) => {
    const yo = ctx.viewer;
    const [nombre = '', ...resto] = ctx.args.trim().split(/\s+/).filter(Boolean);
    const objetos = lootDb.regalables(yo.id);
    const inicio = `@${yo.displayName} 🎁 `;

    if (!objetos.length) {
      return { text: `${inicio}No tienes nada que regalar (los objetos malditos no se regalan). Habla en el chat y caerá algo.`, ...mencion(ctx) };
    }

    const limpio = nombre.replace(/^@/, '');
    if (!limpio) {
      const ayuda = 'Para regalar: !dar nombre número. Tus objetos: ';
      return { text: inicio + ayuda + listaRegalables(objetos, MAX_MESSAGE_LENGTH - inicio.length - ayuda.length), ...mencion(ctx) };
    }

    const para = buscarPresente(limpio);
    if (!para) {
      return { text: `${inicio}No veo a ${limpio} por el chat. Solo puedes dar algo a quien haya escrito hace poco.`, ...mencion(ctx) };
    }
    if (para.id === yo.id) return { text: `${inicio}Pasarte algo de una mano a la otra no cuenta.`, ...mencion(ctx) };
    if (!juega(para.login)) {
      return { text: `${inicio}${para.displayName} no necesita botín: ¡quédatelo tú!`, ...mencion(ctx) };
    }

    const que = resto.join(' ');
    if (!que) {
      const pregunta = `¿Qué le das a ${para.displayName}? Escribe !dar ${para.login} y el número: `;
      return { text: inicio + pregunta + listaRegalables(objetos, MAX_MESSAGE_LENGTH - inicio.length - pregunta.length), ...mencion(ctx) };
    }

    // Por número, por rareza o por parte del nombre.
    const numero = /^\d+$/.test(que) ? Number(que) : null;
    const rareza = RAREZA_POR_NOMBRE[sinTildes(que)];
    const fila = numero !== null
      ? objetos[numero - 1] ?? null
      : lootDb.elegir(yo.id, rareza ? { rareza } : { texto: que });
    if (!fila) {
      const nada = numero !== null ? `No tienes el número ${numero}: van del 1 al ${objetos.length}` : `No llevas nada que encaje con «${que}»`;
      return { text: `${inicio}${nada}. Escribe !dar para ver la lista.`, ...mencion(ctx) };
    }
    if (lootDb.contar(para.id) >= MOCHILA_MAX) {
      return { text: `${inicio}La mochila de ${para.displayName} está llena (${MOCHILA_MAX}).`, ...mencion(ctx) };
    }
    const clave = cooldowns.keys.user('loot-dar-regalo', yo.id);
    const falta = cooldowns.remaining(clave, DAR_COOLDOWN_MS);
    if (falta > 0) return { text: `${inicio}Espera ${Math.ceil(falta / 1000)} s para regalar otra cosa.`, ...mencion(ctx) };
    cooldowns.tryConsume(clave, DAR_COOLDOWN_MS);

    const { tituloNuevo } = lootDb.pasar(fila.id, para.id, para.displayName);
    const titulo = tituloNuevo ? ` · 🏆 ¡${para.displayName} completa una colección: «${tituloNuevo}»!` : '';
    return {
      text: `🎁 @${yo.displayName} le regala ${etiqueta(fila)} a @${para.displayName}${titulo}`,
      allowedMentions: [yo.login, para.login],
    };
  },
};

// ---------------------------------------------------------------------------
// !usar [objeto]
// ---------------------------------------------------------------------------

/**
 * Objetos con efecto de verdad en el directo: al usarlos se gastan y lanzan
 * el efecto de una recompensa (su Action de Streamer.bot), además de su lado
 * del Loot. Los nombres tienen que estar en el catálogo (objetos.ts).
 */
export const USABLES: Record<string, { efecto: EfectoCanal; que: string }> = {
  'Cuerno de guerra': { efecto: 'grito', que: 'suena el Grito de guerra y atrae un cofre de guerra' },
  'Frasco de agua bendita': { efecto: 'pocion', que: '«¡Bebe agua!» en pantalla y purifica tu objeto maldito' },
  'Calavera que susurra': { efecto: 'maldicion', que: 'maldice la pantalla y te da un objeto maldito' },
};

/** Entre dos efectos en pantalla, sean de quien sean. */
const PANTALLA_MS = 2 * 60_000;
const CLAVE_PANTALLA = cooldowns.keys.interaction('loot-usar-pantalla');

const listaUsables = () =>
  Object.keys(USABLES)
    .map((o) => etiqueta({ objeto: o, rareza: (Object.keys(OBJETOS) as Rareza[]).find((r) => OBJETOS[r].includes(o)) ?? 'comun' }))
    .join(', ');

export const usar: Interaction<CtxComando> = {
  name: 'loot-usar',
  spontaneous: false,
  cooldowns: [porPersona('loot-usar', 30_000)],
  run: async (ctx) => {
    const yo = ctx.viewer;
    const que = ctx.args.trim();
    const fila = que
      ? lootDb.elegir(yo.id, { texto: que })
      : Object.keys(USABLES).map((o) => lootDb.elegir(yo.id, { texto: o })).find(Boolean) ?? null;

    if (!fila) {
      return { text: `@${yo.displayName} ✨ No llevas nada que se pueda usar. Salen en los cofres: ${listaUsables()}.`, ...mencion(ctx) };
    }
    const usable = USABLES[fila.objeto];
    if (!usable) {
      return { text: `@${yo.displayName} ✨ ${etiqueta(fila)} no hace nada al usarlo. Los que sí: ${listaUsables()}.`, ...mencion(ctx) };
    }
    const falta = cooldowns.remaining(CLAVE_PANTALLA, PANTALLA_MS);
    if (falta > 0) {
      return { text: `@${yo.displayName} ✨ La pantalla aún se está recuperando del último efecto: prueba en ${Math.ceil(falta / 1000)} s.`, ...mencion(ctx) };
    }
    if (usable.efecto === 'grito' && (!ajustes.lootActivo() || !streams.current())) {
      return { text: `@${yo.displayName} 📯 Sin directo el cuerno no atrae nada: guárdalo para luego.`, ...mencion(ctx) };
    }

    // Todo lo que decide va antes del primer await: dos !usar seguidos no
    // pueden gastar el mismo objeto ni pisarse la pantalla.
    lootDb.gastar(fila.id);
    cooldowns.tryConsume(CLAVE_PANTALLA, PANTALLA_MS);
    let texto: string;
    if (usable.efecto === 'grito') {
      texto = `📯 ${yo.displayName} hace sonar el Cuerno de guerra. ${atraerCofreDeGuerra(yo.displayName, ctx.azar)}`;
    } else if (usable.efecto === 'pocion') {
      const limpio = lootDb.purificar(yo.id);
      if (limpio) enPantalla(yo.displayName, limpio, 'purificar');
      texto = `💧 ${yo.displayName} abre el Frasco de agua bendita: ¡a beber agua todo el mundo!` +
        (limpio ? ` Y de paso purifica ${etiqueta(limpio)}.` : '');
    } else {
      const botin = { ...tirar('oro', ctx.azar), maldito: true };
      lootDb.dar(yo.id, yo.displayName, botin, 'maldicion');
      enPantalla(yo.displayName, botin, 'maldicion');
      texto = `💀 ${yo.displayName} escucha a la Calavera que susurra… la pantalla se maldice y le devuelve ${etiqueta(botin)}.`;
    }
    const lanzado = await lanzarEfecto(usable.efecto, yo);
    if (!lanzado) log.info(`loot-usar: ${fila.objeto} usado, pero su efecto de Streamer.bot no se lanzó (¿está montado y conectado?).`);
    return { text: texto, detail: () => `${fila.objeto}${lanzado ? '' : ' (sin efecto en pantalla)'}` };
  },
};

// ---------------------------------------------------------------------------
// !top
// ---------------------------------------------------------------------------

/** Los tres con más poder, y tu puesto si no estás entre ellos. */
export const top: Interaction<CtxComando> = {
  name: 'loot-top',
  spontaneous: false,
  cooldowns: [
    porPersona('loot-top', 60_000),
    // Una línea cada 20 s como mucho, pida quien la pida: es la misma para todos.
    { key: () => cooldowns.keys.interaction('loot-top'), ms: 20_000, motivo: (_ctx, faltan) => `cooldown, faltan ${faltan}s` },
  ],
  run: (ctx) => {
    const lista = lootDb.mochilas(3);
    if (!lista.length) return { text: '🏆 Todavía nadie tiene botín. ¡El primer cofre marca el ranking!' };
    const medallas = ['🥇', '🥈', '🥉'];
    const podio = lista
      .map((m, i) => `${medallas[i]} ${m.display_name}${m.titulo ? ` «${m.titulo}»` : ''} ⚔️ ${m.poder}`)
      .join(' · ');
    const yo = lista.some((m) => m.twitch_id === ctx.viewer.id) ? null : lootDb.puesto(ctx.viewer.id);
    const tuyo = yo ? ` · Tú: puesto ${yo.puesto} de ${yo.de}` : '';
    return { text: `🏆 Top poder: ${podio}${tuyo}` };
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
      `y con Oros está el ${config.loot.cofreRewardTitle}. Comandos: !inventario !poder !duelo nombre !dar nombre !usar !forjar !presumir !coleccion !top`,
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
  [/^!dar\b/i, dar],
  [/^!usar\b/i, usar],
  [/^!(atacar|atk)\b/i, jefe.atacar],
  [/^!(top|ranking)\b/i, top],
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
  ['!dar nombre nº', 'Regala un objeto a alguien del chat. !dar solo te enseña tus objetos numerados; !dar ana 2 le da el 2'],
  ['!usar', 'Usa un objeto con efecto en el directo: Cuerno de guerra, Frasco de agua bendita, Calavera que susurra'],
  ['!atacar', 'Pega al jefe cuando aparece. Botín para todos si cae; Cofre del tesoro para quien más daño haga'],
  ['!top', 'Los tres con más poder del canal, y tu puesto'],
  ['!purificar', 'Tras canjear una Poción de vida: limpia tu objeto maldito (ya no lo pierdes, pero sin poder doble)'],
] as const;

