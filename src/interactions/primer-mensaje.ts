
import { log } from '../core/logger.js';
import type { ViewerMessageEvent } from '../core/events.js';
import * as cooldowns from '../core/cooldowns.js';
import { send } from '../core/output.js';

import * as interactionLog from '../data/interactions.js';

/**
 * #1 Primer Mensaje (docs/02 § 2).
 *
 * Cuando alguien escribe por primera vez, el bot NO le da la bienvenida:
 * le hace una pregunta trivial que se contesta con una palabra. "Bienvenido
 * al canal" no genera nada; "¿mando o teclado?" genera un segundo mensaje,
 * que es justo lo que buscamos.
 *
 * Sin IA. La respuesta es determinista.
 */

export const NAME = 'primer-mensaje';

/**
 * Cooldown global de 60 s. Viene de docs/02 § 2: "si entran cinco personas a
 * la vez, el bot spamea. Mitigación: máximo uno cada 60 s". No es un número
 * inventado aquí.
 */
export const COOLDOWN_MS = 60_000;

/**
 * Preguntas que se contestan con una palabra. Todas de temas neutros, según
 * la lista blanca de docs/02: videojuegos, comida y costumbres cotidianas.
 */
const PREGUNTAS = [
  '¿mando o teclado?',
  '¿café o té?',
  '¿dulce o salado?',
  '¿playa o montaña?',
  '¿perro o gato?',
  '¿piña en la pizza, sí o no?',
  '¿madrugar o trasnochar?',
  '¿verano o invierno?',
  '¿libro o película?',
  '¿tortilla con cebolla o sin?',
  '¿ducha de mañana o de noche?',
  '¿serie o peli?',
  '¿chocolate negro o con leche?',
  '¿ciudad o pueblo?',
  '¿silencio o música de fondo?',
  '¿modo fácil o modo difícil?',
  '¿multijugador o campaña?',
  '¿subtítulos sí o no?',
  '¿hamburguesa o kebab?',
  '¿sofá o silla?',
  '¿guardas cada cinco minutos o vives al límite?',
  '¿mapa o perderse?',
  '¿correr o andar?',
  '¿plan en casa o plan fuera?',
];

/**
 * Elige pregunta a partir del ID del usuario.
 *
 * Determinista a propósito: la misma persona recibe siempre la misma pregunta
 * (solo la ve una vez en su vida, así que da igual) y personas distintas
 * reciben preguntas distintas. Al no usar azar, los tests no son frágiles.
 */
export function elegirPregunta(twitchId: string): string {
  let hash = 0;
  for (let i = 0; i < twitchId.length; i += 1) {
    hash = (hash * 31 + twitchId.charCodeAt(i)) >>> 0;
  }
  return PREGUNTAS[hash % PREGUNTAS.length];
}

export function componerSaludo(displayName: string, twitchId: string): string {
  return `@${displayName} primera vez que te leo por aquí. Pregunta de rigor: ${elegirPregunta(twitchId)}`;
}

/** ¿Ya se le saludó alguna vez con éxito? */
function yaSaludado(twitchId: string): boolean {
  return interactionLog
    .findByUser(twitchId)
    .some((row) => row.interaction === NAME && row.status === 'sent');
}

/**
 * @param isNew lo decide el manejador, que es quien registra la presencia.
 *              Aquí solo se decide si hay que saludar y qué decir.
 */
export async function handle(event: ViewerMessageEvent, isNew: boolean): Promise<void> {
  const { viewer } = event;

  if (!isNew && yaSaludado(viewer.id)) return;

  if (!cooldowns.tryConsume(cooldowns.keys.interaction(NAME), COOLDOWN_MS)) {
    const faltan = Math.ceil(cooldowns.remaining(cooldowns.keys.interaction(NAME), COOLDOWN_MS) / 1000);
    log.info(`${NAME}: en cooldown, faltan ${faltan}s. No se saluda a ${viewer.displayName} todavía.`);
    interactionLog.record({
      interaction: NAME,
      twitchId: viewer.id,
      status: 'skipped',
      detail: `cooldown, faltan ${faltan}s`,
    });
    return;
  }

  const outcome = await send({
    text: componerSaludo(viewer.displayName, viewer.id),
    reason: NAME,
    allowedMentions: [viewer.login],
  });

  interactionLog.record({
    interaction: NAME,
    twitchId: viewer.id,
    status: outcome.sent ? 'sent' : 'blocked',
    detail: outcome.sent ? (outcome.dryRun ? 'dry-run' : null) : `${outcome.rejection}: ${outcome.detail}`,
  });
}
