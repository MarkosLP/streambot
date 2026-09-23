import { config } from '../config.js';
import type { ViewerRedeemEvent } from '../core/events.js';
import * as cooldowns from '../core/cooldowns.js';
import * as engine from '../core/engine.js';
import type { Ctx, Interaction } from '../core/interaction.js';

/**
 * #10 Pregunta Incómoda (docs/02 § 3).
 *
 * El bot saca una pregunta personal del banco y te obliga a responderla en
 * voz alta. Sin IA: el banco lo escribes TÚ, y ahí está todo el control del
 * riesgo. Una IA generando preguntas personales sobre ti es exactamente lo
 * que no queremos.
 *
 * Esta interacción es además la prueba del motor de la Fase 7: se escribió
 * entera en este archivo, sin tocar `engine.ts` ni ninguna otra interacción.
 * Lo único que hay fuera es una línea en el registro de `index.ts`.
 */

export const NAME = 'pregunta-incomoda';

/**
 * El banco.
 *
 * CRID4M: esto es tuyo, cámbialo. La regla es que puedas responder cualquiera
 * de estas en directo sin arrepentirte. Si alguna te hace dudar, bórrala: el
 * riesgo de esta interacción es justo ese, y se controla aquí y en ningún
 * otro sitio.
 */
const PREGUNTAS = [
  '¿cuál es la peor compra que has hecho en un videojuego?',
  '¿qué juego has abandonado sin terminar y no piensas retomar?',
  '¿cuánto tiempo llevas sin cambiar las sábanas? Sé sincero',
  '¿cuál es tu placer culpable musical?',
  '¿qué habilidad inútil se te da sorprendentemente bien?',
  '¿cuál ha sido tu mayor ridículo delante de gente?',
  '¿qué cosa de adulto sigues sin saber hacer?',
  '¿cuántas pestañas tienes abiertas ahora mismo?',
  '¿qué opinión tuya te hace perder discusiones siempre?',
  '¿cuál es el mensaje más vergonzoso que has enviado por error?',
  '¿qué comida rara te gusta y nadie te entiende?',
  '¿cuánto tardas de verdad en contestar un mensaje?',
  '¿qué te daba mucha vergüenza de adolescente y ahora te da igual?',
  '¿cuál es tu peor manía cuando juegas?',
  '¿qué película que todo el mundo adora te parece un tostón?',
];

/**
 * Elige de forma determinista a partir de quién canjea y cuándo.
 *
 * Cambia entre canjes pero no usa azar, así que un test puede fijar la
 * entrada y saber qué sale. Mismo criterio que en `#1`.
 */
export function elegirPregunta(semilla: string): string {
  let hash = 0;
  for (let i = 0; i < semilla.length; i += 1) {
    hash = (hash * 31 + semilla.charCodeAt(i)) >>> 0;
  }
  return PREGUNTAS[hash % PREGUNTAS.length]!;
}

export function componer(displayName: string, pregunta: string): string {
  return `@${displayName} pregunta para Crid4m: ${pregunta}`;
}

export interface Contexto extends Ctx {
  /** Qué disparó esto: la recompensa de puntos o el comando de subs. */
  trigger: 'channel-point' | 'command';
  semilla: string;
}

export const interaction: Interaction<Contexto> = {
  name: NAME,
  spontaneous: false,

  describeSkip: (motivo, ctx) => `${ctx.trigger}: ${motivo}`,

  guards: [
    // El comando es solo para subs; el Channel Point ya se paga con puntos.
    // Ninguna de las tres primeras interacciones tenía una guarda de permisos,
    // así que esto es lo que comprueba que el contrato da para más de lo que
    // se escribió pensando en él.
    (ctx) => {
      if (ctx.trigger !== 'command') return { ok: true };
      if (ctx.viewer.isSubscriber || ctx.viewer.isModerator) return { ok: true };
      return { ok: false, motivo: 'el comando es solo para subs', registrar: true };
    },
  ],

  cooldowns: [
    {
      key: () => cooldowns.keys.interaction(NAME),
      ms: config.preguntaIncomoda.cooldownMs,
      motivo: (_ctx, faltan) => `cooldown, faltan ${faltan}s`,
      // Quien paga puntos no espera: mismo criterio que en `#5`.
      applies: (ctx) => ctx.trigger === 'command',
    },
  ],

  run: (ctx) => ({
    text: componer(ctx.viewer.displayName, elegirPregunta(ctx.semilla)),
    allowedMentions: [ctx.viewer.login],
  }),
};

/** ¿Es esta la recompensa de "Pregunta Incómoda"? */
function esRecompensa(event: ViewerRedeemEvent): boolean {
  const { rewardId, rewardTitle } = config.preguntaIncomoda;
  if (rewardId) return event.rewardId === rewardId;
  return event.rewardTitle.trim().toLowerCase() === rewardTitle.trim().toLowerCase();
}

/** Lo que el registro de `index.ts` necesita saber. */
export const channelPointBinding = {
  matches: esRecompensa,
  run: (event: ViewerRedeemEvent) =>
    engine.run(interaction, {
      viewer: event.viewer,
      trigger: 'channel-point' as const,
      semilla: `${event.viewer.id}-${event.id}`,
    }),
};

export const COMMAND = /^!incomoda\b/i;

export function runCommand(viewer: Contexto['viewer'], semilla: string): Promise<void> {
  return engine.run(interaction, { viewer, trigger: 'command', semilla });
}
