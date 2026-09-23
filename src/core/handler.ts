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
import * as streams from '../data/streams.js';
import * as primerMensaje from '../interactions/primer-mensaje.js';
import * as bienvenidaVuelta from '../interactions/bienvenida-vuelta.js';
import * as preguntaIa from '../interactions/pregunta-ia.js';
import { budget } from '../services/ai/index.js';

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
    return;
  }

  // El principio y el final del directo abren y cierran una fila en `streams`.
  // No producen ningún mensaje en el chat: solo dejan constancia.
  if (event.type === 'stream.online') {
    streams.open();
    return;
  }

  if (event.type === 'stream.offline') {
    streams.close();
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
  const pregunta = matchPreguntaCommand(text);
  if (pregunta !== null) {
    if (config.ignoredLogins.includes(viewer.login)) return;
    if (!isIgnored(viewer)) users.touch(viewer);
    await preguntaIa.handle({ viewer, question: pregunta, trigger: 'command' });
    return;
  }

  if (isIgnored(viewer)) {
    log.debug(`${viewer.login} está en la lista de ignorados.`);
    return;
  }

  // Registro de presencia. Ocurre SIEMPRE, dispare o no una interacción:
  // last_seen tiene que reflejar la realidad aunque hoy no respondamos.
  // Es gratis y no guarda el texto del mensaje, solo quién y cuándo.
  //
  // `previousLastSeen` se captura AQUÍ porque esta llamada machaca last_seen.
  // Después de esta línea ya no hay forma de saber cuánto llevaba sin venir.
  const { isNew, previousLastSeen } = users.touch(viewer);

  // A partir de aquí el bot hablaría sin que nadie se lo pida. Con las
  // interacciones espontáneas apagadas, solo responde a comandos.
  if (!config.interaccionesEspontaneas) return;

  // #1 y #18 son excluyentes por definición: quien nunca ha estado no puede
  // volver, y quien vuelve no es nuevo. Aun así el orden importa, porque las
  // dos comparten el techo de mensajes por hora: si #1 ha saludado, #18 no
  // vuelve a hablar de la misma persona en el mismo mensaje.
  if (primerMensaje.esPrimerMensaje(event, isNew)) {
    await primerMensaje.handle(event, isNew);
    return;
  }

  await bienvenidaVuelta.handle(event, previousLastSeen, isNew);
}

/**
 * Alias del comando de preguntas.
 *
 * Antes solo valía `!pregunta` exacto. En el chat de verdad la gente escribe
 * `!preguntar`, que es el infinitivo y lo que suena natural al anunciarlo, y
 * esas preguntas se caían sin dejar rastro: no coincidían aquí, así que la
 * interacción ni se llamaba y no se registraba nada. Costó una sesión entera
 * de un espectador (Armifer91, 23 sep 2026) darse cuenta.
 *
 * El `\b` del final es lo que impide que `!preguntas` o `!preguntame` que no
 * queramos entren por accidente.
 */
const PREGUNTA_COMMAND = /^!pregunta(r|me)?\b/i;

/**
 * Devuelve la pregunta si el mensaje es el comando, y null si no lo es.
 *
 * La pregunta se recorta por la longitud de LO QUE HA COINCIDIDO, no por una
 * longitud fija: con `!preguntar` un recorte fijo de 9 caracteres dejaría una
 * "r" pegada al principio de la pregunta.
 */
function matchPreguntaCommand(text: string): string | null {
  const match = PREGUNTA_COMMAND.exec(text);
  if (match) return text.slice(match[0].length);

  // Alguien ha intentado preguntar y no le hemos entendido. Se avisa a nivel
  // info, no debug: es raro, y sin esta línea el intento desaparece sin dejar
  // ni una huella en la base de datos.
  if (/^!pregunt/i.test(text)) {
    log.warn(`Comando de pregunta no reconocido: "${text.split(/\s+/)[0]}". Los válidos son !pregunta y !preguntar.`);
  }

  return null;
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
    // El gasto va aquí porque es la pregunta que de verdad se hace uno en
    // mitad del directo: cuánto llevo. Se consulta sin parar nada.
    log.info(`Gasto de IA: ${budget.describeSpend()}`);
    return 'handled';
  }

  // Sonda de verificación. Es la única forma de comprobar bajo demanda el
  // camino completo de envío a Twitch sin depender de que aparezca un
  // espectador nuevo. Pasa por policy y por el transporte igual que todo lo
  // demás. Se retirará cuando haya interacciones que puedas disparar tú.
  if (command === '!ping') return 'ping';

  return null;
}
