import { config, MAX_MESSAGE_LENGTH } from '../config.js';
import type { Viewer, ViewerRedeemEvent } from '../core/events.js';
import * as engine from '../core/engine.js';
import * as cooldowns from '../core/cooldowns.js';
import type { Ctx, Interaction } from '../core/interaction.js';
import { ask } from '../services/ai/index.js';

/**
 * #5 Pregunta a Crid4m AI (docs/02 § 3).
 *
 * El espectador pregunta algo y el bot responde con la personalidad del canal.
 *
 * Los DOS disparadores —Channel Point y `!pregunta`— entran por aquí. No hay
 * dos implementaciones: hay una, y el disparador es un parámetro.
 */

export const NAME = 'pregunta-ia';

export type Trigger = 'channel-point' | 'command';

export interface Peticion extends Ctx {
  viewer: Viewer;
  question: string;
  trigger: Trigger;
}

/**
 * Compone la respuesta final.
 *
 * La mención la ponemos NOSOTROS, no Claude. Así la IA nunca decide a quién
 * se menciona y `allowedMentions` de la policy es exacto por construcción.
 *
 * Si el prefijo hiciera que el mensaje pasara de 480, se manda sin mención
 * antes que perder la respuesta entera. Con las respuestas que genera
 * (~150 caracteres) esto no debería ocurrir nunca, pero más vale cubrirlo.
 */
export function componer(displayName: string, respuesta: string): string {
  const conMencion = `@${displayName} ${respuesta}`;
  return conMencion.length <= MAX_MESSAGE_LENGTH ? conMencion : respuesta;
}

/** Comprueba la pregunta ANTES de gastar un céntimo en la IA. */
export function validarPregunta(texto: string): { ok: true; question: string } | { ok: false; motivo: string } {
  const question = texto.trim();

  if (question.length === 0) return { ok: false, motivo: 'pregunta vacía' };
  if (question.length > config.preguntaIa.maxQuestionLength) {
    return {
      ok: false,
      motivo: `pregunta de ${question.length} caracteres, el máximo son ${config.preguntaIa.maxQuestionLength}`,
    };
  }
  return { ok: true, question };
}

export const interaction: Interaction<Peticion> = {
  name: NAME,

  // Nunca habla sola: siempre la invoca alguien, con el comando o pagando
  // puntos de canal. Por eso INTERACCIONES_ESPONTANEAS no la apaga.
  spontaneous: false,

  // Los dos disparadores se distinguen en el registro, que es lo que permite
  // saber después si la gente prefiere el comando o el punto de canal.
  describeSkip: (motivo, ctx) => `${ctx.trigger}: ${motivo}`,

  guards: [
    // Este descarte SÍ se registra: la interacción aplicaba y se ha rechazado
    // la entrada. Es justo lo que quieres poder mirar después, y además
    // demuestra que no se gastó dinero.
    (ctx) => {
      const validacion = validarPregunta(ctx.question);
      return validacion.ok
        ? { ok: true }
        : { ok: false, motivo: validacion.motivo, registrar: true };
    },
  ],

  // Dos cooldowns, y ninguno se aplica al Channel Point: quien paga puntos
  // recibe respuesta. El motor los comprueba los dos antes de consumir
  // ninguno, que es lo que impide que el de usuario se gaste cuando el global
  // va a bloquear igualmente.
  cooldowns: [
    {
      key: (ctx) => cooldowns.keys.user(NAME, ctx.viewer.id),
      ms: config.preguntaIa.commandUserCooldownMs,
      motivo: (ctx, faltan) => `cooldown de ${ctx.viewer.login}, faltan ${faltan}s`,
      applies: (ctx) => ctx.trigger === 'command',
    },
    {
      key: () => cooldowns.keys.interaction(NAME),
      ms: config.preguntaIa.commandGlobalCooldownMs,
      motivo: (_ctx, faltan) => `cooldown global, faltan ${faltan}s`,
      applies: (ctx) => ctx.trigger === 'command',
    },
  ],

  run: async (ctx) => {
    const validacion = validarPregunta(ctx.question);
    // La guarda ya lo comprobó; esto es solo para estrechar el tipo.
    if (!validacion.ok) return null;

    const resultado = await ask(NAME, {
      userMessage: validacion.question,
      username: ctx.viewer.displayName,
    });

    return {
      // El resultado SIEMPRE trae texto usable: si la IA falló, es el de
      // reserva. El espectador recibe respuesta pase lo que pase.
      text: componer(ctx.viewer.displayName, resultado.message),
      allowedMentions: [ctx.viewer.login],
      // Solo lo que escribió Claude pasa por el modo revisión. El texto de
      // reserva es nuestro y ya sabemos qué dice.
      aiGenerated: resultado.ok,
      detail: (outcome) =>
        [
          ctx.trigger,
          resultado.ok ? 'ia-ok' : `ia-${resultado.failure}`,
          outcome.sent ? null : `salida-${outcome.rejection}`,
          resultado.usage ? `${resultado.usage.latencyMs}ms` : null,
          resultado.usage?.costUsd != null ? `$${resultado.usage.costUsd.toFixed(6)}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
    };
  },
};

/** Lo que el registro de `index.ts` necesita saber. Ver `interactions/index.ts`. */
export const channelPointBinding = {
  matches: (event: ViewerRedeemEvent): boolean => {
    const { rewardId, rewardTitle } = config.preguntaIa;
    // El ID es lo fiable: no cambia aunque renombres la recompensa.
    if (rewardId) return event.rewardId === rewardId;
    return event.rewardTitle.trim().toLowerCase() === rewardTitle.trim().toLowerCase();
  },
  run: (event: ViewerRedeemEvent): Promise<void> =>
    engine.run(interaction, {
      viewer: event.viewer,
      question: event.userInput,
      trigger: 'channel-point' as const,
    }),
};
