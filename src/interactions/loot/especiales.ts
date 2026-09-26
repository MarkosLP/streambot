import type { Viewer } from '../../core/events.js';

/**
 * El ataque especial de cada jefe (decidido el 26 sep 2026).
 *
 * Uno por combate, cuando al jefe le queda el UMBRAL de su vida. Le da a
 * cada jefe personalidad jugable, no solo visual: alguien se queda congelado,
 * el jefe se cura, todos fallan... Sale en el chat (una línea, para que quien
 * lo sufre sepa por qué no pega) y en el overlay.
 *
 * Aquí solo se decide QUÉ pasa. El combate (jefe.ts) lo cumple: mira
 * `bloqueos`, `debiles` y `fallan` en cada !atacar.
 */

/** Cuando al jefe le queda este tanto por uno de vida, ataca. */
export const UMBRAL = 0.6;

/** Lo que el especial toca del combate. */
export interface Combate {
  vida: number;
  vidaMax: number;
  danos: Map<string, { viewer: Viewer; dano: number }>;
  /** Quien no puede atacar hasta `hasta`. `icono` y `texto`, para el overlay. */
  bloqueos: Map<string, { hasta: number; icono: string; texto: string }>;
  /** Quien pega menos (`factor`) hasta `hasta`. */
  debiles: Map<string, { hasta: number; factor: number }>;
  /** Quien falla su siguiente golpe. */
  fallan: Set<string>;
}

export interface Resultado {
  /** Lo que se dice en el chat. Sin @: nadie ha pedido que se le mencione. */
  chat: string;
  /** El cartel del overlay: título grande y una línea debajo. */
  titulo: string;
  texto: string;
  /** Vida que recupera (positiva) o pierde (negativa) el jefe. */
  vida?: number;
}

export interface Especial {
  icono: string;
  aplicar: (c: Combate, objetivo: Viewer, nombreJefe: string, now: number) => Resultado;
}

const S = (ms: number) => `${Math.round(ms / 1000)} s`;

function bloquear(c: Combate, v: Viewer, ms: number, now: number, icono: string, texto: string): void {
  c.bloqueos.set(v.id, { hasta: now + ms, icono, texto });
}

/** A todos los que han pegado hasta ahora. */
const todos = (c: Combate) => [...c.danos.values()].map((d) => d.viewer);

export const ESPECIALES: Record<string, Especial> = {
  dragon: {
    icono: '❄️',
    aplicar: (c, v, jefe, now) => {
      bloquear(c, v, 15_000, now, '❄️', '¡CONGELADO!');
      return {
        chat: `❄️ ¡${jefe} lanza su aliento helado! ${v.displayName} se queda congelado ${S(15_000)}.`,
        titulo: 'Aliento helado', texto: `${v.displayName}, congelado ${S(15_000)}`,
      };
    },
  },
  esqueleto: {
    icono: '💀',
    aplicar: (c, _v, jefe) => {
      const cura = Math.round(c.vidaMax * 0.15);
      return {
        chat: `💀 ¡${jefe} alza a los muertos y recupera ${cura} de vida!`,
        titulo: 'Alzar a los muertos', texto: `+${cura} de vida`, vida: cura,
      };
    },
  },
  hidra: {
    icono: '🐍',
    aplicar: (c, v, jefe, now) => {
      c.debiles.set(v.id, { hasta: now + 20_000, factor: 0.5 });
      return {
        chat: `🐍 ¡${jefe} muerde a ${v.displayName}! Envenenado: pega la mitad durante ${S(20_000)}.`,
        titulo: 'Mordisco venenoso', texto: `${v.displayName}, la mitad de daño ${S(20_000)}`,
      };
    },
  },
  golem: {
    icono: '🗿',
    aplicar: (c, _v, jefe, now) => {
      for (const p of todos(c)) bloquear(c, p, 8_000, now, '💫', '¡ATURDIDO!');
      return {
        chat: `🗿 ¡${jefe} golpea el suelo! Terremoto: todos aturdidos ${S(8_000)}.`,
        titulo: 'Terremoto', texto: `Todos aturdidos ${S(8_000)}`,
      };
    },
  },
  liche: {
    icono: '☠️',
    aplicar: (c, v, jefe) => {
      const hizo = c.danos.get(v.id)?.dano ?? 0;
      const cura = Math.max(10, Math.min(Math.round(c.vidaMax * 0.15), Math.round(hizo * 0.5)));
      return {
        chat: `☠️ ¡${jefe} drena el alma de ${v.displayName} y recupera ${cura} de vida!`,
        titulo: 'Drenar alma', texto: `Le roba ${cura} a ${v.displayName}`, vida: cura,
      };
    },
  },
  arana: {
    icono: '🕸️',
    aplicar: (c, v, jefe, now) => {
      bloquear(c, v, 15_000, now, '🕸️', '¡ATRAPADO!');
      return {
        chat: `🕸️ ¡${jefe} atrapa a ${v.displayName} en su telaraña! ${S(15_000)} sin poder atacar.`,
        titulo: 'Telaraña', texto: `${v.displayName}, atrapado ${S(15_000)}`,
      };
    },
  },
  kraken: {
    icono: '🐙',
    aplicar: (c, v, jefe, now) => {
      bloquear(c, v, 15_000, now, '🐙', '¡AL FONDO!');
      return {
        chat: `🐙 ¡Un tentáculo de ${jefe} arrastra a ${v.displayName} al fondo! ${S(15_000)} sin atacar.`,
        titulo: 'Tentáculo', texto: `${v.displayName}, al fondo ${S(15_000)}`,
      };
    },
  },
  minotauro: {
    icono: '🤢',
    aplicar: (c, _v, jefe) => {
      for (const p of todos(c)) c.fallan.add(p.id);
      return {
        chat: `🤢 ¡${jefe} no aguanta más y vomita! Del asco, todos fallan su siguiente golpe.`,
        titulo: 'Vomitona', texto: 'Todos fallan el siguiente golpe',
      };
    },
  },
  tanque: {
    icono: '🛡️',
    aplicar: (c, _v, jefe) => {
      const dano = Math.round(c.vidaMax * 0.12);
      return {
        chat: `🛡️ ${jefe} intenta provocar… y se da con su propio escudo: pierde ${dano} de vida.`,
        titulo: 'Provocación fallida', texto: `Se pega solo: −${dano}`, vida: -dano,
      };
    },
  },
  lag: {
    icono: '📶',
    aplicar: (c, v, jefe, now) => {
      bloquear(c, v, 15_000, now, '📶', '¡DESCONECTADO!');
      return {
        chat: `📶 ¡${jefe} desconecta a ${v.displayName}! Reconectando… ${S(15_000)} sin atacar.`,
        titulo: 'Desconexión', texto: `${v.displayName}, desconectado ${S(15_000)}`,
      };
    },
  },
};
