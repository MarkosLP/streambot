import * as ajustes from '../core/ajustes.js';
import { getDb } from '../data/db.js';
import { log } from '../core/logger.js';
import { send } from '../core/output.js';
import * as streams from '../data/streams.js';
import * as interactionLog from '../data/interactions.js';
import { ask } from '../services/ai/index.js';

/**
 * #24 Continuará (docs/02 § 5).
 *
 * Al cerrar el directo, el bot deja una pregunta abierta que se resuelve en el
 * siguiente. *"El martes descubriremos si @Alex tenía razón."*
 *
 * docs/02 la llama "la mejor relación coste/retención del catálogo": UNA
 * llamada a la IA por directo a cambio de darle a la gente un motivo concreto
 * para volver.
 *
 * No usa el motor de la Fase 7 y es a propósito. El motor está construido
 * alrededor de un espectador —guardas sobre `viewer`, cooldowns por usuario,
 * menciones— y esto no lo dispara nadie: lo dispara el directo al terminar.
 * Forzarlo dentro del contrato pidiendo un `viewer` de mentira sería peor
 * código que estas cincuenta líneas.
 */

export const NAME = 'continuara';

/**
 * Mínimo de gente para que merezca la pena llamar a la IA.
 *
 * Mismo criterio que docs/02 aplica a `#3`: *"si hay menos de 15 mensajes en
 * el buffer, responder una plantilla en vez de llamar a la IA (ahorra dinero
 * y evita ridículos)"*. Un "continuará" sobre un directo en el que no habló
 * nadie no es misterioso, es triste.
 */
const MINIMO_ESPECTADORES = 1;

export interface Resumen {
  espectadores: string[];
  datos: string[];
}

/**
 * Qué ha pasado en el directo.
 *
 * Se arma con lo que SÍ guardamos: quién apareció y qué recuerdos se
 * capturaron. No guardamos los mensajes del chat, así que esto no puede
 * resumir la conversación — y es mejor así: un resumen honesto de poco es
 * más útil que uno inventado de mucho.
 */
export function resumirDirecto(desde: string): Resumen {
  const db = getDb();

  const espectadores = (
    db
      .prepare('SELECT display_name FROM users WHERE last_seen >= ? ORDER BY last_seen')
      .all(desde) as Array<{ display_name: string }>
  ).map((r) => r.display_name);

  const datos = (
    db
      .prepare('SELECT content FROM memories WHERE created_at >= ? ORDER BY created_at')
      .all(desde) as Array<{ content: string }>
  ).map((r) => r.content);

  return { espectadores, datos };
}

/** El resumen, en texto, tal y como se le manda al modelo. */
export function describirResumen(resumen: Resumen): string {
  const partes = [`Han pasado por el chat: ${resumen.espectadores.join(', ') || 'nadie'}.`];

  if (resumen.datos.length > 0) {
    partes.push('Cosas que han contado:');
    for (const dato of resumen.datos) partes.push(`- ${dato}`);
  }

  return partes.join('\n');
}

/** Guarda el "continuará" en la fila del directo. */
export function guardar(streamId: number, texto: string): void {
  getDb().prepare('UPDATE streams SET continuara = ? WHERE id = ?').run(texto, streamId);
}

/** El "continuará" del último directo cerrado que dejó uno. */
export function ultimo(): string | null {
  const row = getDb()
    .prepare(
      'SELECT continuara FROM streams WHERE continuara IS NOT NULL ORDER BY id DESC LIMIT 1',
    )
    .get() as { continuara: string } | undefined;
  return row?.continuara ?? null;
}

/**
 * Al cerrar el directo: genera el "continuará", lo guarda y lo publica.
 *
 * Se llama ANTES de cerrar la fila en `streams`, porque necesita saber cuándo
 * empezó el directo para resumirlo.
 */
export async function alCerrar(stream: streams.StreamRow): Promise<void> {
  // Esta interacción habla sin que nadie la invoque, así que la apaga el mismo
  // interruptor que a las demás. No pasa por el motor —no la dispara un
  // espectador— y por eso hay que comprobarlo aquí a mano: sin esta línea,
  // INTERACCIONES_ESPONTANEAS=false dejaría un único camino por el que el bot
  // habla solo, y encima gastando dinero.
  if (!ajustes.interaccionesEspontaneas()) {
    log.debug(`${NAME}: las interacciones espontáneas están apagadas.`);
    return;
  }

  const resumen = resumirDirecto(stream.started_at);

  if (resumen.espectadores.length < MINIMO_ESPECTADORES) {
    log.info(`${NAME}: directo sin espectadores, no se gasta una llamada a la IA.`);
    interactionLog.record({
      interaction: NAME,
      status: 'skipped',
      detail: 'directo sin espectadores',
    });
    return;
  }

  const resultado = await ask(NAME, {
    userMessage: describirResumen(resumen),
    username: 'el directo',
    label: 'Resumen de lo que ha pasado en el directo de hoy.',
  });

  if (!resultado.ok) {
    // Aquí NO hay texto de reserva que valga. Un "continuará" genérico no
    // cumple su función —dar un motivo concreto de volver— y el directo ya
    // ha terminado, así que nadie se queda esperando una respuesta.
    log.warn(`${NAME}: no se pudo generar (${resultado.failure}). No se publica nada.`);
    interactionLog.record({
      interaction: NAME,
      status: 'skipped',
      detail: `ia-${resultado.failure}`,
    });
    return;
  }

  guardar(stream.id, resultado.message);

  const outcome = await send({
    text: resultado.message,
    reason: NAME,
    aiGenerated: true,
  });

  interactionLog.record({
    interaction: NAME,
    status: outcome.sent ? 'sent' : 'blocked',
    detail: outcome.sent
      ? `${resumen.espectadores.length} espectador(es) · ${resultado.usage.latencyMs}ms`
      : `${outcome.rejection}: ${outcome.detail}`,
  });
}

/**
 * Al abrir el directo: recupera el "continuará" del anterior.
 *
 * No llama a la IA. El texto ya está escrito desde la última vez, que es
 * justo lo que lo hace barato.
 */
export async function alAbrir(): Promise<void> {
  if (!ajustes.interaccionesEspontaneas()) return;

  const pendiente = ultimo();
  if (!pendiente) {
    log.debug(`${NAME}: no hay ningún "continuará" del directo anterior.`);
    return;
  }

  log.info(`${NAME}: recuperado del directo anterior — "${pendiente}"`);

  const outcome = await send({
    text: `Lo dejamos aquí la última vez: ${pendiente}`,
    reason: NAME,
    // El texto lo escribió Claude, pero YA pasó por revisión al publicarse al
    // cerrar el directo anterior. Volver a pedir aprobación por algo que ya
    // aprobaste sería ruido.
    aiGenerated: false,
  });

  interactionLog.record({
    interaction: NAME,
    status: outcome.sent ? 'sent' : 'blocked',
    detail: outcome.sent ? 'recuperado del directo anterior' : `${outcome.rejection}: ${outcome.detail}`,
  });
}
