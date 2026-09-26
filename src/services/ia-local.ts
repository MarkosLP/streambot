import { config } from '../config.js';

/**
 * IA local con Ollama (26 sep 2026).
 *
 * Para lo que se hace FUERA del directo: sugerir títulos, anuncios, ideas.
 * Es gratis e ilimitado, y no sale de tu PC. Lo que habla con el chat en
 * directo sigue siendo Claude (services/ai): responde mejor y tiene sus topes
 * de gasto y su revisión.
 *
 * Ojo con la gráfica: mientras genera la usa a tope. Por eso `keep_alive` es
 * corto (config.iaLocal.keepAlive): a los pocos minutos Ollama la suelta y no
 * te quita memoria de vídeo si te pones a jugar.
 *
 * Siempre pide JSON con un esquema (el `format` de Ollama): así la respuesta
 * se puede leer sin adivinar, y si el modelo se inventa otra cosa se rechaza.
 */

export class ErrorIaLocal extends Error {}

export interface Estado {
  disponible: boolean;
  modelo: string;
  /** Por qué no, en castellano, para enseñarlo en el panel. */
  motivo?: string;
}

/** La primera vez hay que cargar el modelo en la gráfica: puede tardar. */
const TIEMPO_MAX_MS = 180_000;

async function pedir(ruta: string, cuerpo?: unknown, tiempoMs = 5_000): Promise<any> {
  let r: Response;
  try {
    r = await fetch(new URL(ruta, config.iaLocal.url), {
      method: cuerpo ? 'POST' : 'GET',
      headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined,
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(tiempoMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new ErrorIaLocal('La IA local no ha contestado a tiempo. ¿Está la gráfica ocupada con un juego?');
    }
    throw new ErrorIaLocal('Ollama no está abierto. Ábrelo (o ejecuta «ollama serve») y vuelve a probar.');
  }
  const datos: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErrorIaLocal(datos?.error ? `Ollama: ${datos.error}` : `Ollama respondió ${r.status}`);
  return datos;
}

/** ¿Está Ollama abierto y tiene el modelo? */
export async function estado(): Promise<Estado> {
  const modelo = config.iaLocal.modelo;
  try {
    const { models = [] } = await pedir('/api/tags');
    const tiene = (models as Array<{ name: string }>).some((m) => m.name === modelo || m.name === `${modelo}:latest`);
    return tiene
      ? { disponible: true, modelo }
      : { disponible: false, modelo, motivo: `Falta el modelo ${modelo}. En una terminal: ollama pull ${modelo}` };
  } catch (err) {
    return { disponible: false, modelo, motivo: err instanceof Error ? err.message : String(err) };
  }
}

export interface Peticion {
  sistema: string;
  usuario: string;
  /** Esquema JSON de la respuesta. */
  esquema: Record<string, unknown>;
  temperatura?: number;
}

/**
 * Pide una respuesta en JSON. Se puede sustituir en los tests (setGenerador)
 * para no depender de tener Ollama abierto.
 */
export type Generador = (p: Peticion) => Promise<unknown>;

const ollama: Generador = async ({ sistema, usuario, esquema, temperatura = 0.9 }) => {
  const r = await pedir('/api/chat', {
    model: config.iaLocal.modelo,
    stream: false,
    keep_alive: config.iaLocal.keepAlive,
    // Los modelos que "piensan" (qwen3) tardarían el triple: para títulos no hace falta.
    think: false,
    format: esquema,
    options: { temperature: temperatura },
    messages: [
      { role: 'system', content: sistema },
      { role: 'user', content: usuario },
    ],
  }, TIEMPO_MAX_MS);
  const texto = r?.message?.content;
  if (typeof texto !== 'string') throw new ErrorIaLocal('La IA local no ha devuelto texto.');
  try {
    return JSON.parse(texto);
  } catch {
    throw new ErrorIaLocal('La IA local ha devuelto algo que no es JSON. Vuelve a probar.');
  }
};

let generador: Generador = ollama;

export function setGenerador(fn: Generador | null): void {
  generador = fn ?? ollama;
}

export function generarJson(p: Peticion): Promise<unknown> {
  return generador(p);
}
