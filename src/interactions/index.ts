import type { ViewerRedeemEvent } from '../core/events.js';
import * as preguntaIa from './pregunta-ia.js';
import * as preguntaIncomoda from './pregunta-incomoda.js';

/**
 * Registro de interacciones de Channel Point.
 *
 * FASE 7. Añadir una interacción de puntos de canal es escribir su archivo y
 * añadir UNA línea a la lista de abajo. El manejador no se toca, el motor no
 * se toca, y las demás interacciones no se enteran.
 *
 * Cada interacción trae su propio `matches` porque solo ella sabe con qué
 * recompensa se corresponde y de dónde sale ese dato: `#5` lo lee del `.env`
 * por ID, y otra podría mirar el coste o el título.
 */
export interface ChannelPointBinding {
  matches: (event: ViewerRedeemEvent) => boolean;
  run: (event: ViewerRedeemEvent) => Promise<void>;
}

export const channelPoint: ChannelPointBinding[] = [
  preguntaIa.channelPointBinding,
  preguntaIncomoda.channelPointBinding,
];
