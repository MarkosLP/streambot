import { config } from '../config.js';
import { log, captureRaw } from './logger.js';
import {
  describe,
  type DomainEvent,
  type Viewer,
  type ViewerMessageEvent,
  type ViewerRedeemEvent,
} from './events.js';
import * as killswitch from './killswitch.js';
import { send } from './output.js';
import * as users from '../data/users.js';
import * as primerMensaje from '../interactions/primer-mensaje.js';
import * as preguntaIa from '../interactions/pregunta-ia.js';

/**
 * Punto único por el que pasan TODOS los eventos, vengan de Streamer.bot
 * o del simulador.
 *
 * Reparto de responsabilidades:
 *  - aquí: ignorar cuentas irrelevantes, registrar la presencia y enrutar.
 *  - en la interacción: decidir si responde y qué dice.
 *
 * El motor de interacciones llega en la Fase 7, cuando haya tres casos
 * reales de los que extraer el patrón. Con uno solo, un `if` es correcto.
 */

/** Quién puede apagar y encender el sistema. */
function canControl(viewer: Viewer): boolean {
  return viewer.isModerator || viewer.login === config.broadcasterLogin;
}

/** Otros bots y el propio canal: ni se registran ni participan en nada. */
function isIgnored(viewer: Viewer): boolean {
  return config.ignoredLogins.includes(viewer.login) || viewer.login === config.broadcasterLogin;
}

export async function handleEvent(event: DomainEvent): Promise<void> {
  log.info(`<${event.type}> ${describe(event)}`);
  log.debug('evento normalizado', event);

  if (event.type === 'raw') {
    captureRaw(event.eventName, event.payload);
    return;
  }

  if (event.type === 'viewer.message') {
    await handleMessage(event);
    return;
  }

  if (event.type === 'viewer.redeem') {
    await handleRedeem(event);
  }
}

/** ¿Es esta la recompensa de "Pregunta a Crid4m AI"? */
function esRecompensaPreguntaIa(event: ViewerRedeemEvent): boolean {
  const { rewardId, rewardTitle } = config.preguntaIa;
  // El ID es lo fiable: no cambia aunque renombres la recompensa.
  if (rewardId) return event.rewardId === rewardId;
  return event.rewardTitle.trim().toLowerCase() === rewardTitle.trim().toLowerCase();
}

async function handleRedeem(event: ViewerRedeemEvent): Promise<void> {
  // El ID en los logs para que puedas copiarlo al .env sin buscarlo.
  log.debug(`Recompensa "${event.rewardTitle}" con id ${event.rewardId}`);

  if (!esRecompensaPreguntaIa(event)) return;

  users.touch(event.viewer);
  await preguntaIa.handle({
    viewer: event.viewer,
    question: event.userInput,
    trigger: 'channel-point',
  });
}

/**
 * IMPORTANTE: desde aquí hasta que la interacción consume su cooldown no hay
 * ni un solo `await`. Node procesa microtareas entre awaits, así que un await
 * colocado antes de esa decisión permitiría que dos mensajes seguidos del
 * mismo usuario se intercalaran y acabaran saludándole dos veces.
 * La parte asíncrona (el envío) va después de que la decisión esté tomada.
 */
async function handleMessage(event: ViewerMessageEvent): Promise<void> {
  const { viewer } = event;
  const text = event.text.trim();

  // Los comandos de control se atienden antes que nada: tienen que funcionar
  // aunque el resto del sistema esté apagado.
  const control = matchControlCommand(text, viewer);
  if (control !== null) {
    // Escribir un comando también es estar presente. Se registra igual, para
    // que quien entre soltando un !ping no se quede fuera de la base de datos.
    if (!isIgnored(viewer)) users.touch(viewer);
    if (control === 'ping') {
      await send({ text: `pong, ${viewer.displayName}`, reason: 'sonda-verificacion' });
    }
    return;
  }

  // !pregunta entra por el MISMO camino que el Channel Point: una sola
  // implementación, dos disparadores.
  //
  // Se comprueba contra la lista de bots, no contra isIgnored(): al dueño del
  // canal SÍ le dejamos usarlo, porque si no no podrías probarlo tú.
  if (/^!pregunta\b/i.test(text)) {
    if (config.ignoredLogins.includes(viewer.login)) return;
    if (!isIgnored(viewer)) users.touch(viewer);
    await preguntaIa.handle({
      viewer,
      question: text.slice('!pregunta'.length),
      trigger: 'command',
    });
    return;
  }

  if (isIgnored(viewer)) {
    log.debug(`${viewer.login} está en la lista de ignorados.`);
    return;
  }

  // Registro de presencia. Ocurre SIEMPRE, dispare o no una interacción:
  // last_seen tiene que reflejar la realidad aunque hoy no respondamos.
  const { isNew } = users.touch(viewer);

  await primerMensaje.handle(event, isNew);
}

type ControlOutcome = 'handled' | 'ping' | null;

/** Síncrono a propósito. Ver el comentario de handleMessage. */
function matchControlCommand(text: string, viewer: Viewer): ControlOutcome {
  const command = text.toLowerCase();

  if (command === '!apagar' || command === '!encender') {
    if (!canControl(viewer)) {
      log.warn(`${viewer.displayName} intentó usar ${command} sin permiso. Ignorado.`);
      return 'handled';
    }
    if (command === '!apagar') killswitch.disable(`!apagar de ${viewer.displayName}`);
    else killswitch.enable(`!encender de ${viewer.displayName}`);
    return 'handled';
  }

  if (command === '!estado') {
    log.info(`Estado del sistema: ${killswitch.status()}`);
    return 'handled';
  }

  // Sonda de verificación. Es la única forma de comprobar bajo demanda el
  // camino completo de envío a Twitch sin depender de que aparezca un
  // espectador nuevo. Pasa por policy y por el transporte igual que todo lo
  // demás. Se retirará cuando haya interacciones que puedas disparar tú.
  if (command === '!ping') return 'ping';

  return null;
}
