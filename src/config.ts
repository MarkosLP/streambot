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

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseFloat(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`La variable ${name} debe ser un número, y vale "${raw}"`);
  }
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'si', 'sí', 'yes'].includes(raw.toLowerCase());
}

function list(name: string, fallback: string): string[] {
  return str(name, fallback)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
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
    /** Cadena vacía = autenticación desactivada. SendMessage la EXIGE. */
    password: str('STREAMERBOT_PASSWORD', ''),
    /** false = escribir desde la cuenta del canal; true = desde la cuenta de bot. */
    useBotAccount: bool('STREAMERBOT_USE_BOT_ACCOUNT', false),
  },

  logLevel: levelRaw as LogLevel,
  captureRawEvents: bool('CAPTURE_RAW_EVENTS', true),
  broadcasterLogin: str('BROADCASTER_LOGIN', 'crid4m').toLowerCase(),

  /** Archivo SQLite. El simulador y los tests usan otro distinto. */
  dbPath: str('DB_PATH', 'data/crid4m.sqlite'),

  /**
   * Cuentas que el sistema ignora por completo: otros bots y el propio canal.
   * Sin esto, lo primero que haría el bot es dar la bienvenida a StreamElements.
   */
  ignoredLogins: list(
    'IGNORED_LOGINS',
    'streamelements,streamlabs,nightbot,moobot,fossabot,sery_bot,wizebot',
  ),

  /**
   * Techo de mensajes del bot por hora. Viene de docs/04 § R4: el riesgo
   * número uno del producto es que el bot se perciba como spam.
   */
  messagesPerHour: int('BOT_MESSAGES_PER_HOUR', 12),

  /** true = no envía nada a Twitch, solo registra. Útil para probar en directo sin riesgo. */
  dryRun: bool('DRY_RUN', false),

  ai: {
    /**
     * Modelo por defecto, decidido en docs/01 § 4.3. Configurable: el código
     * no debe quedar atado a un modelo concreto.
     */
    model: str('AI_MODEL', 'claude-opus-5'),

    /**
     * Tope de tokens de salida. Tiene que cubrir el razonamiento MÁS la
     * respuesta: en Opus 5 el pensamiento está activo por defecto y cuenta
     * aquí. Una respuesta de chat gasta ~150; el resto es margen para que
     * no se corte a media frase.
     */
    maxTokens: int('AI_MAX_TOKENS', 4000),

    /** docs/01 § 3.3: 8 segundos y respuesta de reserva. El directo no espera. */
    timeoutMs: int('AI_TIMEOUT_MS', 8000),

    /** docs/04 § 1.5: 3 $ por directo. */
    budgetPerStreamUsd: num('AI_BUDGET_PER_STREAM_USD', 3),
  },
} as const;

/**
 * Límite duro de Twitch: 500 caracteres por mensaje.
 * Dejamos margen. No es configurable a propósito.
 */
export const MAX_MESSAGE_LENGTH = 480;
