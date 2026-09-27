import { config } from '../config.js';
import { log, captureRaw } from './logger.js';
import { esBot } from './bots.js';
import {
  describe,
  type DomainEvent,
  type Viewer,
  type ViewerMessageEvent,
  type ViewerRedeemEvent,
} from './events.js';
import * as killswitch from './killswitch.js';
import * as ajustes from './ajustes.js';
import * as engine from './engine.js';
import * as consent from './consent.js';
import { send } from './output.js';
import * as users from '../data/users.js';
import * as streams from '../data/streams.js';
import * as primerMensaje from '../interactions/primer-mensaje.js';
import * as ticketEntrada from '../interactions/ticket-entrada.js';
import * as continuara from '../interactions/continuara.js';
import * as datoInutil from '../interactions/dato-inutil.js';
import * as rachas from '../interactions/rachas.js';
import * as bienvenidaVuelta from '../interactions/bienvenida-vuelta.js';
import * as preguntaIa from '../interactions/pregunta-ia.js';
import * as preguntaIncomoda from '../interactions/pregunta-incomoda.js';
import * as loot from '../interactions/loot/index.js';
import * as lootComandos from '../interactions/loot/comandos.js';
import * as musicaComando from '../interactions/musica.js';
import * as mecenas from '../interactions/loot/mecenas.js';
import * as temporada from '../interactions/loot/temporada.js';
import * as suscriptores from '../data/suscriptores.js';
import * as chatReciente from './chat-reciente.js';
import * as registry from '../interactions/index.js';
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
  return esBot(viewer.login) || viewer.login === config.broadcasterLogin;
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

  // Lo que quita un moderador sale también del chat en pantalla (escenas).
  if (event.type === 'chat.moderacion') {
    const quitados = chatReciente.moderar(event);
    if (quitados) log.info(`Chat en pantalla: ${quitados} mensaje(s) quitados por moderación.`);
    return;
  }

  if (event.type === 'viewer.redeem') {
    await handleRedeem(event);
    return;
  }

  // Suscripciones, regalos, bits y raids (mecenas.ts). Se guarda también el
  // payload crudo: su forma sale de los tipos de la librería y hay que
  // comprobarla con el primero que llegue de verdad.
  if (event.type === 'viewer.sub' || event.type === 'viewer.giftsub' || event.type === 'viewer.giftbomb' || event.type === 'viewer.cheer' || event.type === 'channel.raid') {
    if (event.type === 'viewer.sub') await mecenas.alSuscribirse(event);
    else if (event.type === 'viewer.giftsub') mecenas.alRegalar(event);
    else if (event.type === 'viewer.giftbomb') mecenas.alBomba(event);
    else if (event.type === 'viewer.cheer') await mecenas.alRecibirBits(event);
    else await mecenas.alRecibirRaid(event);
    return;
  }

  // El principio y el final del directo abren y cierran una fila en `streams`.
  // No producen ningún mensaje en el chat: solo dejan constancia.
  if (event.type === 'stream.online') {
    streams.open();
    // #24: si el directo anterior dejó algo en el aire, se recupera ahora.
    await continuara.alAbrir();
    return;
  }

  if (event.type === 'stream.offline') {
    // El orden importa: #24 necesita saber cuándo empezó el directo para
    // resumirlo, así que se genera ANTES de cerrar la fila.
    const abierto = streams.current();
    if (abierto) await continuara.alCerrar(abierto);
    streams.close();
  }
}

/**
 * Reparto de las redenciones de Channel Point.
 *
 * El manejador ya no sabe qué recompensas existen: recorre el registro y la
 * primera interacción que reconozca la suya se la queda. Añadir otra es
 * escribir su archivo y una línea en `interactions/index.ts`, sin volver por
 * aquí. Esa es la prueba de la Fase 7.
 */
async function handleRedeem(event: ViewerRedeemEvent): Promise<void> {
  // El ID en los logs para que puedas copiarlo al .env sin buscarlo.
  log.debug(`Recompensa "${event.rewardTitle}" con id ${event.rewardId}`);

  for (const binding of registry.channelPoint) {
    if (!binding.matches(event)) continue;
    users.touch(event.viewer);
    await binding.run(event);
    return;
  }
  // Muchas recompensas son solo de Streamer.bot (un sonido, un filtro) y es
  // normal. Pero si esperabas que el bot dijera algo, aquí está el porqué.
  log.info(`Recompensa "${event.rewardTitle}": el bot no la usa para nada (el efecto, si lo tiene, es cosa de Streamer.bot).`);
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

  // Quién anda por el chat, para poder retarle a un duelo. Incluye al dueño
  // del canal; los bots no.
  if (!esBot(viewer.login)) loot.recordarVisto(viewer);
  // El chat en pantalla de la escena Charla: solo en memoria, y nunca de
  // quien pidió el olvido.
  if (!consent.haPedidoOlvido(viewer.id)) chatReciente.apuntar(event, viewer.login === config.broadcasterLogin);
  // La insignia de suscriptor: así el bot sabe quién lo es aunque se
  // suscribiera antes de que llegara ningún aviso (S4, S5).
  // El canal no: Twitch lo marca como «suscrito» a sí mismo, y saldría con 💜.
  if (viewer.id && !esBot(viewer.login) && viewer.login !== config.broadcasterLogin) {
    suscriptores.desdeChat(viewer.id, viewer.isSubscriber);
  }

  // Los comandos de control se atienden antes que nada: tienen que funcionar
  // aunque el resto del sistema esté apagado.
  const control = matchControlCommand(text, viewer);
  if (control !== null) {
    // Escribir un comando también es estar presente. Se registra igual, para
    // que quien entre soltando un !ping no se quede fuera de la base de datos.
    if (control === 'olvidar') {
      // Ojo con el orden: NO se registra la presencia de quien acaba de pedir
      // que le olvidemos. Un users.touch() aquí volvería a crear la ficha que
      // el borrado acaba de eliminar.
      const borrado = consent.olvidar(viewer.id);
      chatReciente.olvidar(viewer.id);
      await send({
        text:
          `@${viewer.displayName} hecho, no guardo nada tuyo y no volveré a hacerlo ` +
          `(${borrado.memories} recuerdo(s) borrados).`,
        reason: 'olvidame',
        allowedMentions: [viewer.login],
        solicitado: true,
      });
      return;
    }

    if (!isIgnored(viewer)) users.touch(viewer);
    if (control === 'ping') {
      await send({ text: `pong, ${viewer.displayName}`, reason: 'sonda-verificacion', solicitado: true });
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
    if (esBot(viewer.login)) return;
    if (!isIgnored(viewer)) users.touch(viewer);
    await engine.run(preguntaIa.interaction, { viewer, question: pregunta, trigger: 'command' });
    return;
  }

  if (preguntaIncomoda.COMMAND.test(text)) {
    if (esBot(viewer.login)) return;
    if (!isIgnored(viewer)) users.touch(viewer);
    await preguntaIncomoda.runCommand(viewer, `${viewer.id}-${event.id}`);
    return;
  }

  // !cancion: qué suena (core/musica.ts). Como los del Loot, también para el canal.
  if (musicaComando.COMANDO.test(text)) {
    if (esBot(viewer.login)) return;
    if (!isIgnored(viewer)) users.touch(viewer);
    await engine.run(musicaComando.cancion, { viewer, trigger: 'command', args: '' });
    return;
  }

  // Comandos del Loot (!inventario, !duelo...): como !incomoda, también para
  // el dueño del canal, que así puede probarlos y aceptar duelos.
  const comandoLoot = lootComandos.buscar(text);
  if (comandoLoot) {
    if (esBot(viewer.login)) return;
    if (!isIgnored(viewer)) users.touch(viewer);
    await engine.run(comandoLoot.def, { viewer, trigger: 'command', args: comandoLoot.args });
    return;
  }

  if (isIgnored(viewer)) {
    // El canal no dispara saludos ni rachas, pero sí juega al Loot como uno
    // más (salvo LOOT_CANAL_JUEGA=false): hablar le hace entrar en los cofres.
    if (loot.juega(viewer.login)) {
      loot.registrarActividad(viewer);
      loot.recogerDelSuelo(viewer)?.catch((err) => log.error(`Loot: fallo al recoger del suelo: ${String(err)}`));
    }
    log.debug(`${viewer.login} está en la lista de ignorados.`);
    return;
  }

  // Quien pidió el olvido no se registra ni dispara nada. Se comprueba aquí,
  // antes del touch, porque si no la ficha se recrearía en cuanto escribiera.
  if (consent.haPedidoOlvido(viewer.id)) {
    log.debug(`${viewer.login} pidió que le olvidáramos; no se registra nada.`);
    return;
  }

  // Registro de presencia. Ocurre SIEMPRE, dispare o no una interacción:
  // last_seen tiene que reflejar la realidad aunque hoy no respondamos.
  // Es gratis y no guarda el texto del mensaje, solo quién y cuándo.
  //
  // `previousLastSeen` se captura AQUÍ porque esta llamada machaca last_seen.
  // Después de esta línea ya no hay forma de saber cuánto llevaba sin venir.
  const { isNew, previousLastSeen } = users.touch(viewer);

  // Estar hablando es lo que hace que te toque un cofre del Loot. Va antes
  // del corte de las espontáneas: el Loot tiene su propio interruptor.
  loot.registrarActividad(viewer);
  // Un cofre de guerra en el suelo es del primero que escriba. Sin await: la
  // decisión ya está tomada dentro, y un await aquí rompería la regla de
  // arriba (nada asíncrono antes de que las interacciones decidan).
  loot.recogerDelSuelo(viewer)?.catch((err) => log.error(`Loot: fallo al recoger del suelo: ${String(err)}`));
  // Con la primera persona que escribe en el directo: el evento de la semana
  // y, si acaba de terminar una temporada, su podio. Sin await, por lo mismo.
  temporada.alPrimerMensaje()?.catch((err) => log.error(`Loot: fallo en el anuncio del directo: ${String(err)}`));

  // La asistencia al directo se registra ANTES que ninguna interacción, y
  // pase lo que pase después, espontáneas o no: si dependiera de que #19
  // llegue a ejecutarse, un cooldown o una guarda de otra cosa (o tener las
  // espontáneas apagadas) podría costarle a alguien su racha.
  const racha = rachas.registrar(viewer.id);
  // Desde el tercer directo seguido, cofre de fidelidad. Es del Loot, que
  // tiene su propio interruptor: no depende de las espontáneas.
  if (racha) loot.cofreFidelidad(viewer, racha)?.catch((err) => log.error(`Loot: fallo en el cofre de fidelidad: ${String(err)}`));

  // A partir de aquí el bot hablaría sin que nadie se lo pida. Con las
  // interacciones espontáneas apagadas, solo responde a comandos.
  if (!ajustes.interaccionesEspontaneas()) return;

  // #1 y #18 son excluyentes por definición: quien nunca ha estado no puede
  // volver, y quien vuelve no es nuevo. Aun así el orden importa, porque las
  // dos comparten el techo de mensajes por hora: si #1 ha saludado, #18 no
  // vuelve a hablar de la misma persona en el mismo mensaje.
  //
  // El motor se encarga de guardas, cooldowns, envío y registro. Aquí solo se
  // decide A CUÁL se le da la oportunidad, que es lo propio del enrutado.
  if (racha) {
    await engine.run(rachas.interaction, { viewer, trigger: 'chat', resultado: racha });
  }

  // #2 va PRIMERO: solo puede aplicar al mensaje siguiente a un saludo, así
  // que si aplica, ni #1 (ya saludó) ni #18 (no vuelve de nada) tenían nada
  // que hacer con este mensaje. Además no escribe en el chat, así que no
  // compite por el techo de mensajes por hora.
  await engine.run(ticketEntrada.interaction, { viewer, trigger: 'chat', event });

  if (primerMensaje.esPrimerMensaje(event, isNew)) {
    await engine.run(primerMensaje.interaction, {
      viewer,
      trigger: 'chat',
      event,
      isNew,
    });
    return;
  }

  // Quien vuelve recibe UNA cosa, no dos. #15 y #18 se disparan en el mismo
  // momento —alguien reaparece tras semanas— así que el reparto se hace aquí:
  // si hay un recuerdo suyo sin usar va #15, que es personal y por tanto mucho
  // mejor; si no, #18, que es el saludo genérico. Nunca las dos.
  if (datoInutil.tieneAlgoQueSacar(viewer.id)) {
    await engine.run(datoInutil.interaction, { viewer, trigger: 'chat', event, previousLastSeen, isNew });
  } else {
    await engine.run(bienvenidaVuelta.interaction, {
      viewer,
      trigger: 'chat',
      previousLastSeen,
      isNew,
    });
  }

  // Y al final, mirar si este mensaje contenía algo que merezca recordarse.
  // Va lo ÚLTIMO a propósito: es la única llamada a la IA que dispara el chat
  // y no una persona, así que no debe retrasar nada de lo que sí se ve.
  await datoInutil.quizaGuardar(event);
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

type ControlOutcome = 'handled' | 'ping' | 'olvidar' | null;

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

  // Derecho al olvido. Va con los comandos de control, no con las
  // interacciones, porque tiene que funcionar SIEMPRE: aunque el sistema esté
  // apagado, aunque haya cooldowns, aunque todo lo demás falle. Nadie debería
  // tener que esperar a que el bot esté de humor para que le olviden.
  if (command === '!olvidame') return 'olvidar';

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
