import { config } from '../config.js';
import { log } from '../core/logger.js';
import type { ViewerMessageEvent } from '../core/events.js';
import type { Ctx, Interaction } from '../core/interaction.js';
import * as memory from '../core/memory.js';
import * as interactionLog from '../data/interactions.js';
import { NAME as PRIMER_MENSAJE, elegirPreguntaCompleta } from './primer-mensaje.js';

/**
 * #2 Ticket de Entrada (docs/02 § 2).
 *
 * `#1` le hace una pregunta de una palabra a quien llega. Esta interacción
 * guarda la RESPUESTA. Sola no hace nada visible; su valor aparece semanas
 * después, cuando `#15` la saca: *"@Dani, sigues siendo de los de mando, ¿no?"*.
 *
 * Es la única interacción del proyecto que **no escribe en el chat**. Convierte
 * un saludo de un solo uso en un dato permanente, y ese es todo su trabajo.
 * Por eso su rastro no está en la tabla `interactions` sino en `memories`:
 * ahí está el dato, con su fecha y su caducidad, que es el registro que de
 * verdad importa.
 *
 * Sin IA. Guardar una palabra no necesita un modelo.
 */

export const NAME = 'ticket-entrada';

/**
 * Ventana tras el saludo en la que una respuesta cuenta como ticket.
 *
 * docs/02 dice dos minutos. Pasado ese rato, lo que escriba la persona
 * probablemente ya no tenga nada que ver con la pregunta, y guardar una frase
 * suelta creyendo que es una respuesta es peor que no guardar nada.
 */
function ventanaMs(): number {
  return config.memoria.ventanaTicketMinutos * 60_000;
}

/** ¿Cuándo se le saludó, si es que se le saludó? */
export function saludadoHace(twitchId: string, ahora = Date.now()): number | null {
  const saludo = interactionLog
    .findByUser(twitchId)
    .filter((row) => row.interaction === PRIMER_MENSAJE && row.status === 'sent')
    .sort((a, b) => b.at.localeCompare(a.at))[0];

  if (!saludo) return null;

  const cuando = new Date(saludo.at).getTime();
  if (Number.isNaN(cuando)) return null;

  return ahora - cuando;
}

/**
 * Limpia la respuesta antes de guardarla.
 *
 * Esto es texto libre de un desconocido, que es el riesgo que docs/02 señala
 * para esta interacción. Se queda con la primera línea, quita menciones y
 * enlaces, y recorta. No pretende ser un saneador universal: pretende que lo
 * que acabe en la base de datos sea una palabra o dos sobre tortillas.
 */
export function sanear(texto: string): string {
  return texto
    .split('\n')[0]!
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[@#]\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, config.memoria.maxLongitud);
}

/** ¿Ya le guardamos su ticket? Solo se guarda una vez por persona. */
export function yaTieneTicket(twitchId: string): boolean {
  return memory.de(twitchId).some((m) => m.kind === 'ticket');
}

export interface Contexto extends Ctx {
  event: ViewerMessageEvent;
}

export const interaction: Interaction<Contexto> = {
  name: NAME,
  spontaneous: true,

  guards: [
    // Todos los descartes son silenciosos: le pasan a casi cada mensaje del
    // chat y ninguno es interesante de mirar después.
    (ctx) => {
      const desde = saludadoHace(ctx.viewer.id);
      if (desde === null) return { ok: false, motivo: 'no se le ha saludado' };
      if (desde > ventanaMs()) {
        return { ok: false, motivo: `el saludo fue hace ${Math.round(desde / 1000)}s` };
      }
      return { ok: true };
    },

    (ctx) => (yaTieneTicket(ctx.viewer.id) ? { ok: false, motivo: 'ya tiene ticket' } : { ok: true }),

    (ctx) =>
      sanear(ctx.event.text).length === 0
        ? { ok: false, motivo: 'la respuesta se queda en nada al sanearla' }
        : { ok: true },
  ],

  run: (ctx) => {
    // El tema sale de la PREGUNTA, no de la respuesta. "Con cebolla" no dice
    // de qué habla; la pregunta que lo provocó, sí.
    const { texto: pregunta, tema } = elegirPreguntaCompleta(ctx.viewer.id);
    const respuesta = sanear(ctx.event.text);

    const guardado = memory.guardar({
      twitchId: ctx.viewer.id,
      kind: 'ticket',
      topic: tema,
      // `sanear` ya acotó la parte ajena; la pregunta es nuestra y es fija.
      content: `${pregunta} -> ${respuesta}`,
    });

    if (guardado.ok) {
      log.info(`${NAME}: guardado el ticket de ${ctx.viewer.login} (${tema}): "${respuesta}"`);
    } else {
      log.debug(`${NAME}: no se guardó el ticket de ${ctx.viewer.login} — ${guardado.motivo}`);
    }

    // No hay nada que decir en el chat. Esta interacción solo escucha.
    return null;
  },
};
