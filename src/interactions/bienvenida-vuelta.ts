import { config } from '../config.js';
import { log } from '../core/logger.js';
import type { ViewerMessageEvent } from '../core/events.js';
import * as cooldowns from '../core/cooldowns.js';
import { send } from '../core/output.js';
import * as interactionLog from '../data/interactions.js';

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

/**
 * @param previousLastSeen cuándo se le vio ANTES de este mensaje. Lo pasa el
 *        manejador, que es quien registra la presencia; si lo consultáramos
 *        aquí leeríamos la escritura que `users.touch()` acaba de hacer y
 *        la ausencia siempre saldría de cero.
 */
export async function handle(
  event: ViewerMessageEvent,
  previousLastSeen: string | null,
  isNew: boolean,
): Promise<void> {
  const { viewer } = event;

  const veredicto = vuelve(previousLastSeen, isNew);
  if (!veredicto.ok) {
    log.debug(`${NAME}: no aplica a ${viewer.login} — ${veredicto.motivo}`);
    return;
  }

  if (!cooldowns.tryConsume(cooldowns.keys.interaction(NAME), COOLDOWN_MS)) {
    const faltan = Math.ceil(
      cooldowns.remaining(cooldowns.keys.interaction(NAME), COOLDOWN_MS) / 1000,
    );
    log.info(`${NAME}: en cooldown, faltan ${faltan}s. No se saluda a ${viewer.displayName}.`);
    interactionLog.record({
      interaction: NAME,
      twitchId: viewer.id,
      status: 'skipped',
      detail: `cooldown, faltan ${faltan}s`,
    });
    return;
  }

  const outcome = await send({
    text: componer(viewer.displayName, veredicto.dias),
    reason: NAME,
    allowedMentions: [viewer.login],
  });

  interactionLog.record({
    interaction: NAME,
    twitchId: viewer.id,
    status: outcome.sent ? 'sent' : 'blocked',
    detail: outcome.sent
      ? `${veredicto.dias} días de ausencia${outcome.dryRun ? ' · dry-run' : ''}`
      : `${outcome.rejection}: ${outcome.detail}`,
  });
}
