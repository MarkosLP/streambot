
import { config } from '../config.js';
import type { ViewerMessageEvent } from '../core/events.js';
import * as cooldowns from '../core/cooldowns.js';
import type { Ctx, Interaction } from '../core/interaction.js';
import type { Tema } from '../core/memory.js';
import * as interactionLog from '../data/interactions.js';

/**
 * #1 Primer Mensaje (docs/02 § 2).
 *
 * Cuando alguien escribe por primera vez, el bot NO le da la bienvenida:
 * le hace una pregunta trivial que se contesta con una palabra. "Bienvenido
 * al canal" no genera nada; "¿mando o teclado?" genera un segundo mensaje,
 * que es justo lo que buscamos.
 *
 * Sin IA. La respuesta es determinista.
 */

export const NAME = 'primer-mensaje';

/**
 * Cooldown global de 60 s. Viene de docs/02 § 2: "si entran cinco personas a
 * la vez, el bot spamea. Mitigación: máximo uno cada 60 s". No es un número
 * inventado aquí.
 */
export const COOLDOWN_MS = 60_000;

/**
 * Preguntas que se contestan con una palabra. Todas de temas neutros, según
 * la lista blanca de docs/02: videojuegos, comida y costumbres cotidianas.
 *
 * FASE 8: cada una declara su TEMA. No es decoración. La respuesta que dé el
 * espectador se guarda como recuerdo (`#2 Ticket de Entrada`), y todo lo que
 * se guarda tiene que caer dentro de la lista blanca de `memory.ts`. Atando
 * el tema a la pregunta, el recuerdo nace ya clasificado y no hay que
 * adivinar después de qué hablaba "con cebolla".
 */
const PREGUNTAS: Array<{ texto: string; tema: Tema }> = [
  { texto: '¿mando o teclado?', tema: 'juegos' },
  { texto: '¿café o té?', tema: 'comida' },
  { texto: '¿dulce o salado?', tema: 'comida' },
  { texto: '¿playa o montaña?', tema: 'planes' },
  { texto: '¿perro o gato?', tema: 'costumbres' },
  { texto: '¿piña en la pizza, sí o no?', tema: 'comida' },
  { texto: '¿madrugar o trasnochar?', tema: 'costumbres' },
  { texto: '¿verano o invierno?', tema: 'planes' },
  { texto: '¿libro o película?', tema: 'planes' },
  { texto: '¿tortilla con cebolla o sin?', tema: 'comida' },
  { texto: '¿ducha de mañana o de noche?', tema: 'costumbres' },
  { texto: '¿serie o peli?', tema: 'planes' },
  { texto: '¿chocolate negro o con leche?', tema: 'comida' },
  { texto: '¿ciudad o pueblo?', tema: 'planes' },
  { texto: '¿silencio o música de fondo?', tema: 'costumbres' },
  { texto: '¿modo fácil o modo difícil?', tema: 'juegos' },
  { texto: '¿multijugador o campaña?', tema: 'juegos' },
  { texto: '¿subtítulos sí o no?', tema: 'costumbres' },
  { texto: '¿hamburguesa o kebab?', tema: 'comida' },
  { texto: '¿sofá o silla?', tema: 'costumbres' },
  { texto: '¿guardas cada cinco minutos o vives al límite?', tema: 'juegos' },
  { texto: '¿mapa o perderse?', tema: 'juegos' },
  { texto: '¿correr o andar?', tema: 'planes' },
  { texto: '¿plan en casa o plan fuera?', tema: 'planes' },
];

/**
 * Elige pregunta a partir del ID del usuario.
 *
 * Determinista a propósito: la misma persona recibe siempre la misma pregunta
 * (solo la ve una vez en su vida, así que da igual) y personas distintas
 * reciben preguntas distintas. Al no usar azar, los tests no son frágiles.
 */
export function elegirPreguntaCompleta(twitchId: string): { texto: string; tema: Tema } {
  let hash = 0;
  for (let i = 0; i < twitchId.length; i += 1) {
    hash = (hash * 31 + twitchId.charCodeAt(i)) >>> 0;
  }
  return PREGUNTAS[hash % PREGUNTAS.length]!;
}

export function elegirPregunta(twitchId: string): string {
  return elegirPreguntaCompleta(twitchId).texto;
}

export function componerSaludo(displayName: string, twitchId: string): string {
  return `@${displayName} primera vez que te leo por aquí. Pregunta de rigor: ${elegirPregunta(twitchId)}`;
}

/** ¿Ya se le saludó alguna vez con éxito? */
function yaSaludado(twitchId: string): boolean {
  return interactionLog
    .findByUser(twitchId)
    .some((row) => row.interaction === NAME && row.status === 'sent');
}

/**
 * ¿Se le debía un saludo de una vez anterior?
 *
 * El flag de Streamer.bot marca UN solo mensaje. Si ese mensaje justo cae
 * dentro del cooldown de 60 s —porque entraron tres personas a la vez— la
 * ocasión se pierde para siempre: los mensajes siguientes de esa persona ya
 * no vienen marcados y nunca se le saludaría.
 *
 * La deuda queda anotada sola: el intento fallido deja una fila `skipped` en
 * `interactions`. Si existe esa fila y no hay ninguna `sent`, se le saluda en
 * cuanto vuelva a escribir.
 *
 * Esto NO reabre la puerta a saludar a habituales de toda la vida: solo entra
 * aquí quien en su momento llegó a disparar la interacción de verdad.
 */
function pendienteDeSaludo(twitchId: string): boolean {
  const filas = interactionLog.findByUser(twitchId).filter((row) => row.interaction === NAME);
  if (filas.length === 0) return false;
  return !filas.some((row) => row.status === 'sent');
}

/**
 * ¿Es de verdad su primer mensaje en el canal?
 *
 * FASE 6, refinamiento. Antes bastaba con ser nuevo en NUESTRA base de datos,
 * y eso está mal: el día que el bot se estrena en un canal con historia,
 * todos los habituales aparecen como nuevos y se llevarían un "primera vez
 * que te leo por aquí" que es falso y queda fatal.
 *
 * La fuente buena es el flag de Streamer.bot, que lleva su propio registro
 * del canal entero (EventSub no da este dato). Ver docs/02 § 2, interacción 1.
 *
 * `confiarEnFlag` a false vuelve al criterio antiguo. Está ahí porque la
 * fiabilidad de ese flag no se puede comprobar sin un directo con gente, y
 * más vale un interruptor que un despliegue a ciegas.
 */
export function esPrimerMensaje(event: ViewerMessageEvent, isNew: boolean): boolean {
  if (!config.primerMensaje.confiarEnFlag) return isNew || pendienteDeSaludo(event.viewer.id);
  return event.isFirstMessage || pendienteDeSaludo(event.viewer.id);
}

/** Contexto propio de esta interacción. */
export interface Contexto extends Ctx {
  event: ViewerMessageEvent;
  isNew: boolean;
}

export const interaction: Interaction<Contexto> = {
  name: NAME,
  spontaneous: true,

  guards: [
    // Los dos descartes son silenciosos: le pasan a casi todos los mensajes
    // del chat y registrarlos no aportaría nada que mirar después.
    (ctx) =>
      esPrimerMensaje(ctx.event, ctx.isNew)
        ? { ok: true }
        : { ok: false, motivo: 'no es su primer mensaje' },

    // Segunda red: nadie recibe el saludo de bienvenida dos veces, ni aunque
    // el flag llegara repetido.
    (ctx) =>
      yaSaludado(ctx.viewer.id) ? { ok: false, motivo: 'ya se le saludó' } : { ok: true },
  ],

  cooldowns: [
    {
      key: () => cooldowns.keys.interaction(NAME),
      ms: COOLDOWN_MS,
      motivo: (_ctx, faltan) => `cooldown, faltan ${faltan}s`,
    },
  ],

  run: (ctx) => ({
    text: componerSaludo(ctx.viewer.displayName, ctx.viewer.id),
    allowedMentions: [ctx.viewer.login],
  }),
};
