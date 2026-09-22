import { appendFileSync, mkdirSync } from 'node:fs';
import { config, type LogLevel } from '../config.js';

/**
 * Logger mínimo. Sin dependencias, sin colores (la consola de Windows
 * los maneja de forma inconsistente y aquí no aportan nada).
 */

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = ORDER[config.logLevel];

function stamp(): string {
  // Hora local en HH:MM:SS — durante un directo la fecha sobra.
  return new Date().toLocaleTimeString('es-ES', { hour12: false });
}

function write(level: LogLevel, label: string, msg: string, extra?: unknown): void {
  if (ORDER[level] < threshold) return;
  const line = `${stamp()} ${label} ${msg}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  if (extra !== undefined) console.log(inspect(extra));
}

function inspect(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export const log = {
  debug: (msg: string, extra?: unknown) => write('debug', '[debug]', msg, extra),
  info: (msg: string, extra?: unknown) => write('info', '[info ]', msg, extra),
  warn: (msg: string, extra?: unknown) => write('warn', '[WARN ]', msg, extra),
  error: (msg: string, extra?: unknown) => write('error', '[ERROR]', msg, extra),
};

/**
 * Guarda en logs/raw-events.log los payloads de eventos que todavía no
 * normalizamos. No es un log de depuración: es materia prima para escribir
 * los normalizadores de la Fase 3 contra datos reales en vez de contra
 * la documentación.
 */
export function captureRaw(eventName: string, payload: unknown): void {
  if (!config.captureRawEvents) return;
  try {
    mkdirSync('logs', { recursive: true });
    const entry = { at: new Date().toISOString(), event: eventName, payload };
    appendFileSync('logs/raw-events.log', JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    // Nunca dejamos que un fallo de escritura tumbe el proceso durante un directo.
    log.warn(`No se pudo guardar el payload de ${eventName}: ${String(err)}`);
  }
}
