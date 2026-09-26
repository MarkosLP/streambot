import * as ajustes from './ajustes.js';
import { log } from './logger.js';
import * as cooldowns from './cooldowns.js';
import { send } from './output.js';
import * as interactionLog from '../data/interactions.js';
import { detalleEstandar, type Ctx, type Interaction } from './interaction.js';

/**
 * Motor de interacciones.
 *
 * Ejecuta una interacción contra su contexto, siempre en el mismo orden:
 *
 *   1. ¿está apagada por ser espontánea?
 *   2. guardas, en orden
 *   3. cooldowns: comprobar TODOS, y solo entonces consumirlos
 *   4. producir el mensaje
 *   5. enviarlo
 *   6. dejar constancia
 *
 * Los pasos 1, 3, 5 y 6 estaban copiados en las tres interacciones. Aquí
 * están una sola vez, y cualquier cambio de política los alcanza a todas.
 *
 * El motor NO decide nada del contenido. No sabe qué es un saludo, ni una
 * pregunta, ni cuántos días son muchos. Si algún día lo supiera, habría
 * dejado de ser un motor.
 */

/**
 * El orden de los pasos 2 y 3 no es casual: primero las guardas, después los
 * cooldowns. Una guarda que descarta (una pregunta vacía, alguien que no
 * vuelve de nada) NO debe gastar el cooldown, porque si no una pregunta mal
 * escrita dejaría a la siguiente persona sin poder preguntar.
 */
export async function run<C extends Ctx>(def: Interaction<C>, ctx: C): Promise<void> {
  if (def.spontaneous && !ajustes.interaccionesEspontaneas()) {
    log.debug(`${def.name}: las interacciones espontáneas están apagadas.`);
    return;
  }

  for (const guard of def.guards ?? []) {
    const veredicto = guard(ctx);
    if (!veredicto.ok) {
      descartar(def, ctx, veredicto.motivo, 'debug', veredicto.registrar === true);
      return;
    }
  }

  const aplicables = (def.cooldowns ?? []).filter((cd) => cd.applies?.(ctx) ?? true);

  // Comprobar todos ANTES de consumir ninguno. Si se consumieran a medida que
  // se comprueban, el primero quedaría gastado aunque el segundo bloqueara.
  for (const cd of aplicables) {
    const falta = cooldowns.remaining(cd.key(ctx), cd.ms);
    if (falta > 0) {
      // Un cooldown SIEMPRE se registra: es la explicación de por qué el bot
      // se quedó callado justo cuando esperabas que hablara.
      descartar(def, ctx, cd.motivo(ctx, Math.ceil(falta / 1000)), 'info', true);
      return;
    }
  }
  for (const cd of aplicables) {
    cooldowns.tryConsume(cd.key(ctx), cd.ms);
  }

  const salida = await def.run(ctx);
  if (salida === null) return;

  const outcome = await send({
    text: salida.text,
    reason: def.name,
    allowedMentions: salida.allowedMentions,
    aiGenerated: salida.aiGenerated,
    solicitado: !def.spontaneous,
  });

  interactionLog.record({
    interaction: def.name,
    twitchId: ctx.viewer.id,
    status: outcome.sent ? 'sent' : 'blocked',
    detail: (salida.detail ?? detalleEstandar)(outcome),
  });
}

/**
 * Un descarte.
 *
 * Las guardas van a `debug` y los cooldowns a `info` porque no son igual de
 * interesantes: que alguien no cumpla una condición es lo normal y llenaría
 * la consola, mientras que un cooldown que bloquea sí explica por qué el bot
 * se ha quedado callado justo cuando esperabas que hablara.
 *
 * Y solo algunos dejan fila en la base de datos. Ver el comentario de
 * `Verdict`: registrar los "no aplica" significaría una fila por cada mensaje
 * del chat.
 */
function descartar<C extends Ctx>(
  def: Interaction<C>,
  ctx: C,
  motivo: string,
  nivel: 'debug' | 'info',
  registrar: boolean,
): void {
  const detalle = def.describeSkip ? def.describeSkip(motivo, ctx) : motivo;

  log[nivel](`${def.name}: ${detalle}`);

  if (!registrar) return;

  interactionLog.record({
    interaction: def.name,
    twitchId: ctx.viewer.id,
    status: 'skipped',
    detail: detalle,
  });
}
