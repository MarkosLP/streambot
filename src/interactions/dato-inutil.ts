import { config } from '../config.js';
import { log } from '../core/logger.js';
import type { ViewerMessageEvent } from '../core/events.js';
import * as cooldowns from '../core/cooldowns.js';
import type { Ctx, Interaction } from '../core/interaction.js';
import * as memory from '../core/memory.js';
import * as consent from '../core/consent.js';
import { ask, extraerDato } from '../services/ai/index.js';
import { diasDesde, umbralDias } from './bienvenida-vuelta.js';

/**
 * #15 Dato Inútil (docs/02 § 4).
 *
 * Guarda un dato trivial que alguien soltó una vez y lo saca semanas después:
 * *"@Marta, ¿al final pudiste con el jefe ese que te tenía frita en marzo?"*.
 *
 * docs/02 la llama la interacción de mayor potencial del catálogo y la única
 * de complejidad Alta que merece construirse. Usa IA en DOS momentos, y los
 * dos tienen un problema distinto:
 *
 *  - **Al guardar** (`quizaGuardar`): la dispara el CHAT, no una persona. Es
 *    la única llamada del proyecto que podría ejecutarse cientos de veces por
 *    directo, así que está limitada por cuatro puertas antes de gastar nada.
 *  - **Al sacar** (`interaction`): la dispara alguien que vuelve. Aquí el
 *    problema no es el coste sino el momento: sacar un dato en mal momento es
 *    el riesgo que señala el catálogo.
 */

export const NAME = 'dato-inutil';

// ---------------------------------------------------------------------------
// 1. Guardar: mirar el chat sin arruinarse
// ---------------------------------------------------------------------------

/**
 * Las puertas antes de gastar un céntimo.
 *
 * Ninguna es opcional. Sin ellas, un chat animado dispararía una llamada por
 * mensaje: a ~0,003 $ cada una, un directo movido costaría más que un mes
 * entero de todo lo demás.
 *
 *  1. Mensaje lo bastante largo. En "jajaja" no hay nada que extraer.
 *  2. Una extracción por persona y directo. La segunda no aporta y cuesta.
 *  3. Un cooldown global, para que cinco personas hablando a la vez no
 *     disparen cinco llamadas seguidas.
 *  4. Quien pidió el olvido queda fuera antes de nada.
 */
export function puedeIntentar(event: ViewerMessageEvent): { ok: true } | { ok: false; motivo: string } {
  const { viewer } = event;
  const texto = event.text.trim();

  if (consent.haPedidoOlvido(viewer.id)) {
    return { ok: false, motivo: 'pidió que le olvidáramos' };
  }

  if (texto.length < config.datoInutil.minimoCaracteres) {
    return { ok: false, motivo: `mensaje de ${texto.length} car., mínimo ${config.datoInutil.minimoCaracteres}` };
  }

  if (texto.startsWith('!')) return { ok: false, motivo: 'es un comando' };

  if (yaSeIntentoCon(viewer.id)) {
    return { ok: false, motivo: 'ya se le miró un mensaje en este directo' };
  }

  const clave = cooldowns.keys.interaction(`${NAME}-extraccion`);
  if (cooldowns.remaining(clave, config.datoInutil.cooldownExtraccionMs) > 0) {
    return { ok: false, motivo: 'extracción en cooldown' };
  }

  return { ok: true };
}

/**
 * A quién se le ha mirado ya un mensaje en esta sesión.
 *
 * En memoria a propósito: "este directo" es exactamente la vida del proceso, y
 * persistirlo obligaría a una tabla más para un dato que no importa mañana.
 */
const mirados = new Set<string>();

function yaSeIntentoCon(twitchId: string): boolean {
  return mirados.has(twitchId);
}

/** Solo para tests y para el simulador. */
export function olvidarIntentos(): void {
  mirados.clear();
}

/**
 * Mira un mensaje y, si hay algo que merezca recordarse, lo guarda.
 *
 * No escribe en el chat. Nadie se entera de que esto ocurre, que es
 * justamente la gracia: el efecto aparece semanas después.
 */
export async function quizaGuardar(event: ViewerMessageEvent): Promise<void> {
  const puerta = puedeIntentar(event);
  if (!puerta.ok) {
    log.debug(`${NAME}: no se mira el mensaje de ${event.viewer.login} — ${puerta.motivo}`);
    return;
  }

  // Se marcan ANTES de la llamada, no después. Si se marcara al volver, dos
  // mensajes seguidos de la misma persona lanzarían dos llamadas antes de que
  // la primera terminara.
  mirados.add(event.viewer.id);
  cooldowns.tryConsume(
    cooldowns.keys.interaction(`${NAME}-extraccion`),
    config.datoInutil.cooldownExtraccionMs,
  );

  const extraccion = await extraerDato({
    userMessage: event.text,
    username: event.viewer.displayName,
  });

  if (!extraccion.ok) {
    log.debug(`${NAME}: la extracción falló (${extraccion.failure}). No pasa nada.`);
    return;
  }

  if (!extraccion.merece) {
    log.debug(`${NAME}: nada que recordar del mensaje de ${event.viewer.login}.`);
    return;
  }

  // El tema vuelve a pasar por la lista blanca. Que el modelo diga "comida" no
  // lo convierte en comida: `memory.guardar` lo comprueba otra vez y rechaza
  // cualquier cosa que no esté en TEMAS.
  const guardado = memory.guardar({
    twitchId: event.viewer.id,
    kind: 'dato',
    topic: extraccion.tema,
    content: extraccion.dato,
  });

  if (guardado.ok) {
    log.info(`${NAME}: recordado de ${event.viewer.login} (${extraccion.tema}): "${extraccion.dato}"`);
  } else {
    log.warn(`${NAME}: la IA propuso algo que no se puede guardar — ${guardado.motivo}`);
  }
}

// ---------------------------------------------------------------------------
// 2. Sacar: el momento
// ---------------------------------------------------------------------------

export interface Contexto extends Ctx {
  event: ViewerMessageEvent;
  previousLastSeen: string | null;
  isNew: boolean;
}

/** ¿Hay algo guardado que sacarle a esta persona? */
export function tieneAlgoQueSacar(twitchId: string): boolean {
  return memory.paraSacar(twitchId) !== null;
}

export const interaction: Interaction<Contexto> = {
  name: NAME,
  spontaneous: true,

  guards: [
    // Mismo umbral de ausencia que #18. Las dos se disparan cuando alguien
    // vuelve, y el reparto lo hace el manejador: si hay recuerdo va esta, que
    // es mucho más personal, y si no va la bienvenida genérica.
    (ctx) => {
      if (ctx.isNew) return { ok: false, motivo: 'es su primera vez' };
      if (!ctx.previousLastSeen) return { ok: false, motivo: 'sin registro anterior' };
      const dias = diasDesde(ctx.previousLastSeen);
      if (dias < umbralDias()) return { ok: false, motivo: `solo ${dias} día(s) de ausencia` };
      return { ok: true };
    },

    (ctx) =>
      tieneAlgoQueSacar(ctx.viewer.id)
        ? { ok: true }
        : { ok: false, motivo: 'no hay ningún recuerdo suyo sin usar' },
  ],

  cooldowns: [
    {
      key: () => cooldowns.keys.interaction(NAME),
      ms: 60_000,
      motivo: (_ctx, faltan) => `cooldown, faltan ${faltan}s`,
    },
  ],

  run: async (ctx) => {
    const recuerdo = memory.paraSacar(ctx.viewer.id);
    if (!recuerdo) return null;

    const dias = diasDesde(ctx.previousLastSeen!);

    const resultado = await ask('dato-inutil', {
      userMessage: recuerdo.content,
      username: ctx.viewer.displayName,
      label: `Esto es lo que ${ctx.viewer.displayName} contó hace ${dias} días.`,
    });

    if (!resultado.ok) {
      // Sin IA no hay recuerdo que sacar con gracia, y el texto de reserva
      // genérico no vale: perdería todo el sentido de la interacción. Se deja
      // el recuerdo SIN marcar como usado, para poder sacarlo la próxima vez.
      log.warn(`${NAME}: no se pudo redactar el recuerdo (${resultado.failure}).`);
      return null;
    }

    // Se marca aquí y no en el envío: si la policy o la revisión lo tumban, el
    // recuerdo ya se ha "gastado" igual. Sacarlo dos veces sería peor que no
    // sacarlo, porque la segunda vez delataría que es un automatismo.
    memory.marcarUsado(recuerdo.id);

    return {
      text: `@${ctx.viewer.displayName} ${resultado.message}`.slice(0, 480),
      allowedMentions: [ctx.viewer.login],
      aiGenerated: true,
      detail: (outcome) =>
        outcome.sent
          ? `recuerdo #${recuerdo.id} · ${dias} días · ${resultado.usage.latencyMs}ms`
          : `${outcome.rejection}: ${outcome.detail}`,
    };
  },
};
