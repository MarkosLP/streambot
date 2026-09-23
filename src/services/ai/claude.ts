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

/**
 * Un 401 puede ser por varias razones, y la más común tiene un síntoma
 * evidente: haber pegado una clave de otro servicio. Distinguirlo ahorra
 * mucho tiempo, porque "la API key no es válida" no dice dónde mirar.
 *
 * Nunca incluye la clave ni ningún fragmento suyo, solo su forma.
 */
export function describeAuthProblem(key = process.env.ANTHROPIC_API_KEY ?? ''): string {
  if (!key.startsWith('sk-ant-')) {
    return (
      `la API key no parece de Anthropic: empieza por "${key.slice(0, 7)}" y tiene ` +
      `${key.length} caracteres, cuando las de Anthropic empiezan por "sk-ant-" y son ` +
      'bastante más largas. Consigue una en console.anthropic.com -> Settings -> API keys'
    );
  }
  return (
    'Anthropic rechaza la API key. Comprueba que no esté revocada y que la cuenta ' +
    'tenga crédito (Plans & Billing en console.anthropic.com)'
  );
}

function extractUsage(usage: any): Usage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage?.cache_creation_input_tokens ?? 0,
  };
}

/**
 * El prompt de sistema, marcado para que Anthropic lo cachee.
 *
 * La personalidad más las reglas de la intención son ~1.200 tokens que van
 * IDÉNTICOS en cada pregunta, mientras que lo único que cambia es el mensaje
 * del espectador, que viaja en el turno de usuario. Es el caso de libro para
 * el caché: leer de caché cuesta 0,1x lo que cuesta la entrada normal.
 *
 * El TTL de 1 hora es deliberado. El caché se mide desde el inicio de la
 * petición y cada lectura reinicia el contador, así que con el TTL de 5
 * minutos por defecto y preguntas separadas por más de 5 minutos —que es lo
 * que imponen los propios cooldowns— la entrada caducaría casi siempre y
 * pagaríamos la escritura una y otra vez sin llegar a leerla nunca.
 * Escribir con TTL de 1 hora cuesta 2x en lugar de 1,25x, así que sale a
 * cuenta a partir de la tercera pregunta de la hora.
 *
 * El mínimo cacheable de Opus 5 son 512 tokens y el prompt los supera de
 * sobra. Si algún día se recorta la personalidad por debajo de ese mínimo,
 * el caché dejaría de aplicarse EN SILENCIO: el síntoma es
 * `cache_read_tokens` siempre a 0 en la tabla `ai_usage`.
 */
function buildSystem(system: string): Anthropic.MessageCreateParams['system'] {
  if (config.ai.cacheTtl === 'off') return system;

  return [
    {
      type: 'text',
      text: system,
      cache_control: { type: 'ephemeral', ttl: config.ai.cacheTtl },
    },
  ];
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
      system: buildSystem(params.system),
      messages: [{ role: 'user', content: params.userContent }],
    });
  } catch (err) {
    if (err instanceof Anthropic.APIConnectionTimeoutError) {
      return { kind: 'timeout', detail: `sin respuesta en ${config.ai.timeoutMs} ms` };
    }
    // Cadena de más específico a menos: no todos los fallos son iguales.
    if (err instanceof Anthropic.AuthenticationError) {
      return { kind: 'error', detail: describeAuthProblem() };
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
