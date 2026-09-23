import { config } from '../config.js';
import * as cooldowns from '../core/cooldowns.js';
import type { Ctx, Interaction } from '../core/interaction.js';

/**
 * #18 Bienvenida de Vuelta (docs/02 § 4).
 *
 * Alguien que no aparecía desde hace semanas vuelve, y el bot lo reconoce.
 *
 * Sin IA. Es la interacción más barata del catálogo con relación al efecto
 * que produce: convierte la base de datos en la sensación de "aquí me
 * conocen", que es lo único que importa cuando llega UNA persona.
 *
 * El riesgo de esta interacción no es técnico, es de tono. "Hace 20 días que
 * no vienes" suena a reproche; "¡cuánto tiempo!" suena a alegrarse. Todos los
 * textos de aquí abajo están escritos para lo segundo, y por eso ninguno
 * menciona la ausencia como si fuera culpa de nadie.
 */

export const NAME = 'bienvenida-vuelta';

/**
 * Cooldown global, igual que en `#1`: si vuelven tres personas a la vez tras
 * un parón, el bot no puede soltar tres mensajes seguidos.
 */
export const COOLDOWN_MS = 60_000;

const DIA_MS = 24 * 60 * 60 * 1000;

/** Días de ausencia a partir de los cuales se considera que alguien "vuelve". */
export function umbralDias(): number {
  return config.bienvenidaVuelta.diasAusencia;
}

/**
 * Días enteros transcurridos entre dos instantes.
 *
 * Se redondea hacia abajo a propósito: decir "llevas 19 días sin aparecer"
 * cuando son 19 días y 20 horas es preferible a exagerar.
 */
export function diasDesde(previo: string, ahora = new Date()): number {
  const desde = new Date(previo).getTime();
  if (Number.isNaN(desde)) return 0;
  return Math.floor((ahora.getTime() - desde) / DIA_MS);
}

/**
 * ¿Le corresponde bienvenida de vuelta?
 *
 * `isNew` la excluye por definición: quien nunca ha estado no puede volver.
 * Ese es el reparto con `#1`, y por eso las dos no pueden dispararse a la vez.
 */
export function vuelve(
  previousLastSeen: string | null,
  isNew: boolean,
  ahora = new Date(),
): { ok: true; dias: number } | { ok: false; motivo: string } {
  if (isNew) return { ok: false, motivo: 'es su primera vez, no una vuelta' };
  if (!previousLastSeen) return { ok: false, motivo: 'sin registro anterior' };

  const dias = diasDesde(previousLastSeen, ahora);
  if (dias < umbralDias()) {
    return { ok: false, motivo: `solo ${dias} día(s) de ausencia, el umbral son ${umbralDias()}` };
  }
  return { ok: true, dias };
}

/**
 * El texto.
 *
 * Varía con los días para que no suene a plantilla, y nunca reprocha. La
 * pregunta final no es decorativa: igual que en `#1`, un mensaje que se puede
 * contestar genera una respuesta, y uno que solo saluda no genera nada.
 */
export function componer(displayName: string, dias: number): string {
  if (dias >= 365) {
    return `@${displayName} ¡pero bueno! Más de un año sin verte por aquí. Cuenta, ¿qué ha sido de tu vida?`;
  }
  if (dias >= 90) {
    return `@${displayName} ¡anda, si has vuelto! Han pasado ${dias} días, esto ha cambiado un poco. ¿Qué te trae de vuelta?`;
  }
  if (dias >= 30) {
    return `@${displayName} ¡cuánto tiempo! ${dias} días sin leerte. ¿Todo bien por ahí?`;
  }
  return `@${displayName} ¡mira quién vuelve! Hacía ${dias} días. Bienvenido de nuevo.`;
}

/** Contexto propio de esta interacción. */
export interface Contexto extends Ctx {
  /**
   * Cuándo se le vio ANTES de este mensaje. Lo calcula el manejador: si se
   * consultara aquí se leería la escritura que `users.touch()` acaba de
   * hacer y la ausencia saldría siempre de cero.
   */
  previousLastSeen: string | null;
  isNew: boolean;
}

export const interaction: Interaction<Contexto> = {
  name: NAME,
  spontaneous: true,

  guards: [
    // Descarte silencioso: esto le pasa a CADA mensaje de CADA persona que no
    // esté volviendo de nada, que son casi todos. Registrarlo sería llenar la
    // tabla de ruido.
    (ctx) => {
      const veredicto = vuelve(ctx.previousLastSeen, ctx.isNew);
      return veredicto.ok ? { ok: true } : { ok: false, motivo: veredicto.motivo };
    },
  ],

  cooldowns: [
    {
      key: () => cooldowns.keys.interaction(NAME),
      ms: COOLDOWN_MS,
      motivo: (_ctx, faltan) => `cooldown, faltan ${faltan}s`,
    },
  ],

  run: (ctx) => {
    // Se recalcula en vez de arrastrarlo desde la guarda. Es una resta de
    // fechas: cuesta menos que el acoplamiento de pasarse estado entre pasos.
    const dias = diasDesde(ctx.previousLastSeen!);

    return {
      text: componer(ctx.viewer.displayName, dias),
      allowedMentions: [ctx.viewer.login],
      detail: (outcome) =>
        outcome.sent
          ? `${dias} días de ausencia${outcome.dryRun ? ' · dry-run' : ''}`
          : `${outcome.rejection}: ${outcome.detail}`,
    };
  },
};
