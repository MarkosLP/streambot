import type { Ctx, Interaction } from '../core/interaction.js';
import * as cooldowns from '../core/cooldowns.js';
import * as streams from '../data/streams.js';
import * as streaks from '../data/streaks.js';

/**
 * #19 Rachas (docs/02 § 5).
 *
 * Cuenta directos consecutivos a los que asiste alguien y lo celebra en los
 * hitos: 3, 5, 10 y 25.
 *
 * El catálogo avisa de que el riesgo de esta interacción no es técnico:
 * *"romper una racha larga genera frustración real"*. De ahí salen las dos
 * decisiones menos obvias de este archivo:
 *
 *  1. **El comodín**, que perdona UN directo al mes. Es la mitigación que
 *     pide docs/02.
 *  2. **Romper una racha no se anuncia.** El dato está ahí y podríamos
 *     decirlo, pero soltarle a alguien "has perdido tu racha de 9" es
 *     exactamente la frustración que intentamos evitar. Se reinicia en
 *     silencio. La única vez que se menciona una ausencia es para perdonarla.
 *
 * **La asistencia se registra FUERA de esta interacción**, en el manejador, y
 * llega aquí ya calculada. No es un capricho de estilo: el motor comprueba los
 * cooldowns ANTES de ejecutar la interacción, así que si el registro viviera
 * en `run`, un cooldown activo —porque otra persona acaba de llegar a un
 * hito— haría que a esta no se le contara el directo. Perder una racha por el
 * cooldown de un tercero sería un fallo grave y silencioso.
 *
 * Sin IA.
 */

export const NAME = 'rachas';

export interface Contexto extends Ctx {
  /** Qué le ha pasado a la racha. Lo calcula el manejador al registrar. */
  resultado: streaks.Resultado;
}

/**
 * El texto del hito.
 *
 * Sube de intensidad con la cifra. La gracia no está en el número: está en que
 * la persona note que alguien lleva la cuenta.
 */
export function componerHito(displayName: string, racha: number): string {
  if (racha >= 25) {
    return `@${displayName} VEINTICINCO directos seguidos. A estas alturas esto es más tu canal que mío.`;
  }
  if (racha >= 10) {
    return `@${displayName} diez directos seguidos. Ya tendría que darte una llave de casa.`;
  }
  if (racha >= 5) {
    return `@${displayName} cinco seguidos. Esto ya no es casualidad.`;
  }
  return `@${displayName} tres directos seguidos, empiezas a ser de la casa.`;
}

/** El texto de cuando se gasta el comodín. */
export function componerComodin(displayName: string, racha: number): string {
  return `@${displayName} te faltaste al anterior, pero por esta vez hago la vista gorda: sigues con ${racha}.`;
}

/**
 * Registra la asistencia de alguien al directo en curso.
 *
 * Se llama en CADA mensaje y no pasa nada: en cuanto ya se contó a esa persona
 * en este directo devuelve "repetida" sin tocar la base de datos, así que el
 * segundo mensaje y los mil siguientes son una consulta y punto.
 *
 * Devuelve null si no hay ningún directo abierto, que es lo que ocurre cuando
 * el bot se arranca a mitad de emisión. Sin saber en qué directo estamos no se
 * puede contar nada, y es preferible no contar a contar mal.
 */
export function registrar(twitchId: string): streaks.Resultado | null {
  const stream = streams.current();
  if (!stream) return null;

  return streaks.registrarAsistencia(twitchId, stream.id, streams.previousId(stream.id));
}

/** ¿Este resultado merece un mensaje en el chat? */
export function mereceAnuncio(resultado: streaks.Resultado): boolean {
  if (resultado.tipo === 'comodin') return true;
  if (resultado.tipo === 'continua') return streaks.esHito(resultado.racha);
  return false;
}

export const interaction: Interaction<Contexto> = {
  name: NAME,
  spontaneous: true,

  guards: [
    // Descarte silencioso: la inmensa mayoría de los mensajes no son ni un
    // hito ni un comodín, y registrarlos sería llenar la tabla de ruido.
    (ctx) =>
      mereceAnuncio(ctx.resultado)
        ? { ok: true }
        : { ok: false, motivo: `nada que anunciar (${ctx.resultado.tipo})` },
  ],

  cooldowns: [
    // Solo frena el ANUNCIO. La asistencia ya está registrada antes de llegar
    // aquí, así que este cooldown no puede costarle la racha a nadie.
    {
      key: () => cooldowns.keys.interaction(NAME),
      ms: 60_000,
      motivo: (_ctx, faltan) => `cooldown, faltan ${faltan}s`,
    },
  ],

  run: (ctx) => {
    const { resultado } = ctx;

    if (resultado.tipo === 'comodin') {
      return {
        text: componerComodin(ctx.viewer.displayName, resultado.racha),
        allowedMentions: [ctx.viewer.login],
        detail: (o) =>
          o.sent ? `comodín · racha ${resultado.racha}` : `${o.rejection}: ${o.detail}`,
      };
    }

    if (resultado.tipo === 'continua') {
      return {
        text: componerHito(ctx.viewer.displayName, resultado.racha),
        allowedMentions: [ctx.viewer.login],
        detail: (o) => (o.sent ? `hito ${resultado.racha}` : `${o.rejection}: ${o.detail}`),
      };
    }

    return null;
  },
};
