import * as streams from '../data/streams.js';
import { log } from './logger.js';

/**
 * ¿Estás en directo? Se lo pregunta a OBS cada minuto (26 sep 2026).
 *
 * Antes solo lo decían los avisos de Twitch (StreamOnline / StreamOffline),
 * y si uno no llegaba el bot se quedaba "en directo" para siempre: el 25 sep
 * se quedó abierto toda la noche, con cofres que podían caer sin emitir.
 *
 * OBS sabe si está emitiendo. Con eso:
 *   - emitiendo y sin directo abierto → se abre
 *   - sin emitir y con directo abierto → se cierra
 *   - OBS no contesta un rato (lo has cerrado) → se cierra
 *
 * Abrir y cerrar va por el MISMO camino que los avisos de Twitch (`emitir`),
 * así #24 Continuará y lo demás se enteran igual.
 *
 * Marcado a mano desde el panel («El directo ya ha empezado»): se respeta
 * aunque OBS no emita, para poder probar cosas sin estar en directo. Dura
 * hasta que lo cierres tú o hasta que empiece y acabe una emisión de verdad.
 */

export type Preguntar = () => Promise<{ emitiendo: boolean }>;
export type Emitir = (evento: 'online' | 'offline') => Promise<void>;

/** Cada cuánto se pregunta. */
export const CADA_MS = 60_000;
/** Preguntas seguidas sin respuesta de OBS para dar el directo por terminado. */
export const FALLOS_PARA_CERRAR = 5;

let preguntar: Preguntar | null = null;
let emitir: Emitir | null = null;
let reloj: ReturnType<typeof setInterval> | null = null;
let fallos = 0;
/** OBS ha contestado alguna vez: si nunca lo hace (sin WebSocket), no se cierra nada por su silencio. */
let contesto = false;
let manual = false;
let ultimo: { emitiendo: boolean | null; at: number } | null = null;

export function configurar(p: Preguntar, e: Emitir): void {
  preguntar = p;
  emitir = e;
}

/** Desde el panel: lo has abierto o cerrado tú. */
export function marcarManual(abierto: boolean): void {
  manual = abierto;
}

/** Una comprobación. La llama el reloj; en los tests, a mano. */
export async function comprobar(): Promise<void> {
  if (!preguntar || !emitir) return;
  let emitiendo: boolean;
  try {
    ({ emitiendo } = await preguntar());
    fallos = 0;
    contesto = true;
  } catch (err) {
    fallos++;
    ultimo = { emitiendo: null, at: Date.now() };
    if (fallos === FALLOS_PARA_CERRAR && contesto && streams.current() && !manual) {
      log.info(`Directo: OBS no contesta desde hace ${FALLOS_PARA_CERRAR} comprobaciones; lo doy por terminado.`);
      await emitir('offline');
    } else if (fallos === 1) {
      log.debug(`Directo: OBS no contesta (${err instanceof Error ? err.message : String(err)}).`);
    }
    return;
  }
  ultimo = { emitiendo, at: Date.now() };

  const abierto = streams.current() !== null;
  if (emitiendo) {
    // Una emisión de verdad: a partir de aquí manda OBS, también al acabar.
    manual = false;
    if (!abierto) {
      log.info('Directo: OBS está emitiendo; abro el directo.');
      await emitir('online');
    }
  } else if (abierto && !manual) {
    log.info('Directo: OBS ya no emite; cierro el directo.');
    await emitir('offline');
  }
}

export function arrancar(): void {
  if (reloj) return;
  // Una al arrancar: si el bot se enciende con el directo ya empezado, se entera.
  void comprobar();
  reloj = setInterval(() => void comprobar(), CADA_MS);
  reloj.unref?.();
}

export function parar(): void {
  if (reloj) clearInterval(reloj);
  reloj = null;
}

/** Lo que enseña el panel. */
export function estado() {
  return { manual, obs: ultimo?.emitiendo ?? null };
}

/** Solo para tests. */
export function reset(): void {
  parar();
  preguntar = null;
  emitir = null;
  fallos = 0;
  contesto = false;
  manual = false;
  ultimo = null;
}
