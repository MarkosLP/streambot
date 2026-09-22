import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { config } from '../../config.js';
import type { Usage } from './budget.js';

/**
 * Implementación con Claude.
 *
 * ÚNICO archivo del proyecto que importa el SDK de Anthropic. El resto del
 * sistema habla con `services/ai/index.ts` y no sabe qué hay detrás.
 */

/**
 * Esquema de la respuesta. Diminuto a propósito: en esta fase Claude solo
 * genera contenido, no decide acciones.
 *
 * `.strict()` hace que cualquier campo inesperado invalide la respuesta.
 */
export const RespuestaSchema = z.object({ message: z.string() }).strict();

export type RawOutcome =
  | { kind: 'ok'; message: string; usage: Usage; model: string }
  | { kind: 'refusal'; detail: string; usage: Usage; model: string }
  | { kind: 'invalid'; detail: string; usage: Usage; model: string }
  | { kind: 'timeout'; detail: string }
  | { kind: 'error'; detail: string };

export interface CallParams {
  system: string;
  /** Mensaje del espectador, ya envuelto en sus etiquetas por index.ts. */
  userContent: string;
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (client) return client;

  if (!process.env.ANTHROPIC_API_KEY) {
    // Mensaje explícito y sin filtrar nada: el error jamás debe incluir
    // la clave ni un fragmento de ella.
    throw new Error(
      'ANTHROPIC_API_KEY no está definida. Añádela al .env (no se sube a git).',
    );
  }

  client = new Anthropic({
    // maxRetries a 0 a propósito: el SDK reintenta por defecto, y con
    // reintentos el timeout de 8 s se convertiría en 24 s de reloj.
    // En un chat en directo, una respuesta tardía ya no sirve.
    maxRetries: 0,
    timeout: config.ai.timeoutMs, // en TypeScript, milisegundos
  });
  return client;
}

function extractUsage(usage: any): Usage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage?.cache_creation_input_tokens ?? 0,
  };
}

export async function call(params: CallParams): Promise<RawOutcome> {
  const model = config.ai.model;

  let response: Awaited<ReturnType<Anthropic['messages']['parse']>>;
  try {
    response = await getClient().messages.parse({
      model,
      max_tokens: config.ai.maxTokens,
      // Pensamiento activo con esfuerzo bajo. Desactivarlo en Opus 5 tiene
      // modos de fallo conocidos (puede escribir etiquetas internas en la
      // respuesta visible); bajar el esfuerzo es la palanca correcta y
      // además es la más barata. Decidido en docs/01 § 2.3.
      output_config: {
        effort: 'low',
        format: zodOutputFormat(RespuestaSchema),
      },
      system: params.system,
      messages: [{ role: 'user', content: params.userContent }],
    });
  } catch (err) {
    if (err instanceof Anthropic.APIConnectionTimeoutError) {
      return { kind: 'timeout', detail: `sin respuesta en ${config.ai.timeoutMs} ms` };
    }
    // Cadena de más específico a menos: no todos los fallos son iguales.
    if (err instanceof Anthropic.AuthenticationError) {
      return { kind: 'error', detail: 'la API key no es válida' };
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { kind: 'error', detail: 'límite de peticiones alcanzado' };
    }
    if (err instanceof Anthropic.APIError) {
      return { kind: 'error', detail: `error ${err.status} de la API` };
    }
    return { kind: 'error', detail: err instanceof Error ? err.message : String(err) };
  }

  const usage = extractUsage(response.usage);

  // Un rechazo por seguridad llega con HTTP 200: hay que mirar stop_reason
  // ANTES de leer el contenido.
  if (response.stop_reason === 'refusal') {
    const categoria = response.stop_details?.category ?? 'sin categoría';
    return { kind: 'refusal', detail: `rechazo de seguridad (${categoria})`, usage, model };
  }

  if (response.stop_reason === 'max_tokens') {
    return { kind: 'invalid', detail: 'la respuesta se cortó por max_tokens', usage, model };
  }

  // parsed_output viene a null si la salida no encajó con el esquema.
  const parsed = response.parsed_output;
  if (!parsed) {
    return { kind: 'invalid', detail: 'la respuesta no encaja con el esquema', usage, model };
  }

  return { kind: 'ok', message: parsed.message, usage, model };
}

/** Cuenta los tokens de un prompt sin generar nada. Se usa para decidir sobre el caché. */
export async function countSystemTokens(system: string): Promise<number> {
  const result = await getClient().messages.countTokens({
    model: config.ai.model,
    system,
    messages: [{ role: 'user', content: 'x' }],
  });
  return result.input_tokens;
}
