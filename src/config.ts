import 'dotenv/config';

/**
 * Configuración del sistema, leída una sola vez al arrancar.
 *
 * Regla del proyecto: ningún otro archivo lee process.env directamente.
 * Si necesitas un valor nuevo, se añade aquí y al .env.example.
 */

function str(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`La variable ${name} debe ser un número entero, y vale "${raw}"`);
  }
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'si', 'sí', 'yes'].includes(raw.toLowerCase());
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelRaw = str('LOG_LEVEL', 'info').toLowerCase();
const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
if (!validLevels.includes(levelRaw as LogLevel)) {
  throw new Error(`LOG_LEVEL debe ser uno de: ${validLevels.join(', ')}. Vale "${levelRaw}".`);
}

export const config = {
  streamerbot: {
    host: str('STREAMERBOT_HOST', '127.0.0.1'),
    port: int('STREAMERBOT_PORT', 8080),
    endpoint: str('STREAMERBOT_ENDPOINT', '/'),
    /** Cadena vacía = autenticación desactivada en Streamer.bot. */
    password: str('STREAMERBOT_PASSWORD', ''),
  },
  logLevel: levelRaw as LogLevel,
  captureRawEvents: bool('CAPTURE_RAW_EVENTS', true),
  broadcasterLogin: str('BROADCASTER_LOGIN', 'crid4m').toLowerCase(),
} as const;
