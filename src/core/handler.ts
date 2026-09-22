import { config } from '../config.js';
import { log, captureRaw } from './logger.js';
import { describe, type DomainEvent, type Viewer } from './events.js';
import * as killswitch from './killswitch.js';
import { send } from './output.js';

/**
 * Punto único por el que pasan TODOS los eventos, vengan de Streamer.bot
 * o del simulador.
 *
 * FASE 2: aquí solo se registran los eventos y se atienden los comandos del
 * interruptor de emergencia. El motor de interacciones llega en la Fase 7;
 * hasta entonces, este archivo se mantiene deliberadamente tonto.
 */

/** Quién puede apagar y encender el sistema. */
function canControl(viewer: Viewer): boolean {
  return viewer.isModerator || viewer.login === config.broadcasterLogin;
}

export function handleEvent(event: DomainEvent): void {
  log.info(`<${event.type}> ${describe(event)}`);
  log.debug('evento normalizado', event);

  if (event.type === 'raw') {
    captureRaw(event.eventName, event.payload);
    return;
  }

  if (event.type === 'viewer.message') {
    handleMessage(event.text.trim(), event.viewer);
  }
}

function handleMessage(text: string, viewer: Viewer): void {
  const command = text.toLowerCase();

  if (command === '!apagar' || command === '!encender') {
    if (!canControl(viewer)) {
      log.warn(`${viewer.displayName} intentó usar ${command} sin permiso. Ignorado.`);
      return;
    }
    if (command === '!apagar') killswitch.disable(`!apagar de ${viewer.displayName}`);
    else killswitch.enable(`!encender de ${viewer.displayName}`);
    return;
  }

  if (command === '!estado') {
    log.info(`Estado del sistema: ${killswitch.status()}`);
    return;
  }

  // Sonda de prueba de la FASE 2.
  // Su único propósito es tener una salida real que verificar contra el
  // interruptor de emergencia. Se elimina en la Fase 3, cuando existan
  // interacciones de verdad.
  if (command === '!ping') {
    send({ kind: 'chat', text: `pong, ${viewer.displayName}`, reason: 'sonda-fase2' });
  }
}
