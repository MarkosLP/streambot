import { config, MAX_MESSAGE_LENGTH } from '../config.js';
import { log } from '../core/logger.js';
import type { Viewer } from '../core/events.js';
import * as cooldowns from '../core/cooldowns.js';
import { send } from '../core/output.js';
import { ask } from '../services/ai/index.js';
import * as interactionLog from '../data/interactions.js';

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

export interface Peticion {
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

/**
 * Cooldowns.
 *
 * Solo se aplican al comando gratuito. Las redenciones de Channel Points ya
 * tienen su propio limitador donde corresponde —el coste en puntos y los
 * límites de la propia recompensa en Twitch—, y bloquear una redención con
 * un cooldown nuestro significaría que alguien paga puntos y no recibe nada.
 *
 * El gasto sigue acotado por el presupuesto de IA y por el techo de mensajes
 * por hora de la policy, que se aplican a los dos disparadores.
 */
function pasaCooldown(peticion: Peticion): { ok: true } | { ok: false; motivo: string } {
  if (peticion.trigger === 'channel-point') return { ok: true };

  const { commandGlobalCooldownMs, commandUserCooldownMs } = config.preguntaIa;
  const claveUsuario = cooldowns.keys.user(NAME, peticion.viewer.id);
  const claveGlobal = cooldowns.keys.interaction(NAME);

  const faltaUsuario = cooldowns.remaining(claveUsuario, commandUserCooldownMs);
  if (faltaUsuario > 0) {
    return { ok: false, motivo: `cooldown de ${peticion.viewer.login}, faltan ${Math.ceil(faltaUsuario / 1000)}s` };
  }

  const faltaGlobal = cooldowns.remaining(claveGlobal, commandGlobalCooldownMs);
  if (faltaGlobal > 0) {
    return { ok: false, motivo: `cooldown global, faltan ${Math.ceil(faltaGlobal / 1000)}s` };
  }

  // Se consumen los dos solo cuando ambos estaban libres.
  cooldowns.tryConsume(claveUsuario, commandUserCooldownMs);
  cooldowns.tryConsume(claveGlobal, commandGlobalCooldownMs);
  return { ok: true };
}

export async function handle(peticion: Peticion): Promise<void> {
  const { viewer, trigger } = peticion;

  const validacion = validarPregunta(peticion.question);
  if (!validacion.ok) {
    log.info(`${NAME}: descartada sin llamar a la IA — ${validacion.motivo}`);
    interactionLog.record({
      interaction: NAME,
      twitchId: viewer.id,
      status: 'skipped',
      detail: `${trigger}: ${validacion.motivo}`,
    });
    return;
  }

  // Todo lo que decide se resuelve de forma síncrona antes del primer await,
  // igual que en primer-mensaje: si no, dos peticiones seguidas podrían
  // intercalarse y saltarse el cooldown.
  const cooldown = pasaCooldown(peticion);
  if (!cooldown.ok) {
    log.info(`${NAME}: ${cooldown.motivo}`);
    interactionLog.record({
      interaction: NAME,
      twitchId: viewer.id,
      status: 'skipped',
      detail: `${trigger}: ${cooldown.motivo}`,
    });
    return;
  }

  const resultado = await ask('pregunta-ia', {
    userMessage: validacion.question,
    username: viewer.displayName,
  });

  // El resultado SIEMPRE trae texto usable: si la IA falló, es el de reserva.
  // El espectador recibe respuesta pase lo que pase; nunca silencio.
  const outcome = await send({
    text: componer(viewer.displayName, resultado.message),
    reason: NAME,
    allowedMentions: [viewer.login],
    // Solo lo que escribió Claude pasa por el modo revisión. El texto de
    // reserva es nuestro y ya sabemos qué dice.
    aiGenerated: resultado.ok,
  });

  const detalle = [
    trigger,
    resultado.ok ? 'ia-ok' : `ia-${resultado.failure}`,
    outcome.sent ? null : `salida-${outcome.rejection}`,
    resultado.usage ? `${resultado.usage.latencyMs}ms` : null,
    resultado.usage?.costUsd != null ? `$${resultado.usage.costUsd.toFixed(6)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  interactionLog.record({
    interaction: NAME,
    twitchId: viewer.id,
    status: outcome.sent ? 'sent' : 'blocked',
    detail: detalle,
  });
}
