import { config, MAX_MESSAGE_LENGTH } from '../config.js';
import * as killswitch from './killswitch.js';

/**
 * Policy: el último filtro antes de que algo salga hacia Twitch.
 *
 * Nada llega al chat sin pasar por `evaluate()`. No porque lo pida un
 * comentario, sino porque `output.send()` es la única salida del sistema y
 * llama aquí siempre (ver output.ts).
 *
 * Deliberadamente pequeña. NO es un sistema de moderación: es una lista corta
 * de cosas que no deben poder ocurrir nunca, cada una comprobable con un test.
 */

export interface OutboundMessage {
  /** Texto a publicar. */
  text: string;
  /** Qué interacción lo pide. Va a los logs y a la tabla `interactions`. */
  reason: string;
  /**
   * Logins que este mensaje tiene permitido mencionar con @.
   * Vacío = no puede mencionar a nadie. Impide que el sistema arrastre
   * a terceros a una interacción en la que no han entrado.
   */
  allowedMentions?: string[];
  /**
   * true si el texto lo escribió Claude. Decide si pasa por el modo revisión:
   * lo determinista ya sabemos qué dice, lo generado no.
   */
  aiGenerated?: boolean;
}

export type PolicyRejection =
  | 'killswitch'
  | 'empty'
  | 'too-long'
  | 'control-chars'
  | 'twitch-command'
  | 'url'
  | 'mention-not-allowed'
  | 'hourly-budget';

export type PolicyResult =
  | { ok: true; text: string }
  | { ok: false; rejection: PolicyRejection; detail: string };

/** Marcas de tiempo de los mensajes enviados, para el techo por hora. */
let sentTimestamps: number[] = [];

const HOUR_MS = 60 * 60 * 1000;

// Caracteres de control: romperían el mensaje o permitirían inyectar líneas.
// Incluye \n y \r a propósito: el chat de Twitch es de una sola línea.
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

// Deliberadamente simple. No pretende atrapar todo dominio posible: pretende
// que el sistema no publique enlaces, que es algo que nunca debería hacer.
const URL_PATTERN = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|es|tv|io|gg|ly|me|co|dev|app)\b)/i;

// Un mensaje que empiece por / o por . lo interpreta Twitch como comando
// (/ban, /timeout, .me...). Jamás debe salir de aquí.
const TWITCH_COMMAND = /^[/.]/;

const MENTION_PATTERN = /@([a-zA-Z0-9_]{3,25})/g;

export function evaluate(message: OutboundMessage, now = Date.now()): PolicyResult {
  if (!killswitch.isEnabled()) {
    return { ok: false, rejection: 'killswitch', detail: killswitch.status() };
  }

  const text = message.text.trim();

  if (text.length === 0) {
    return { ok: false, rejection: 'empty', detail: 'el mensaje está vacío' };
  }

  if (CONTROL_CHARS.test(text)) {
    return { ok: false, rejection: 'control-chars', detail: 'contiene caracteres de control o saltos de línea' };
  }

  if (text.length > MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      rejection: 'too-long',
      detail: `${text.length} caracteres, el máximo es ${MAX_MESSAGE_LENGTH}`,
    };
  }

  if (TWITCH_COMMAND.test(text)) {
    return { ok: false, rejection: 'twitch-command', detail: 'empieza por / o por . y Twitch lo tomaría por un comando' };
  }

  if (URL_PATTERN.test(text)) {
    return { ok: false, rejection: 'url', detail: 'contiene algo que parece un enlace' };
  }

  const allowed = new Set((message.allowedMentions ?? []).map((m) => m.toLowerCase()));
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const mentioned = match[1].toLowerCase();
    if (!allowed.has(mentioned)) {
      return { ok: false, rejection: 'mention-not-allowed', detail: `menciona a @${match[1]}, que no participa` };
    }
  }

  if (remainingBudget(now) <= 0) {
    return {
      ok: false,
      rejection: 'hourly-budget',
      detail: `ya se han enviado ${config.messagesPerHour} mensajes en la última hora`,
    };
  }

  return { ok: true, text };
}

/** Lo llama output.send() cuando un mensaje se ha enviado de verdad. */
export function registerSent(now = Date.now()): void {
  sentTimestamps.push(now);
}

export function remainingBudget(now = Date.now()): number {
  sentTimestamps = sentTimestamps.filter((t) => now - t < HOUR_MS);
  return config.messagesPerHour - sentTimestamps.length;
}

/** Solo para tests y para el simulador. */
export function reset(): void {
  sentTimestamps = [];
}
