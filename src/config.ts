/**
 * Configuración del sistema, leída una sola vez al arrancar.
 *
 * Regla del proyecto: ningún otro archivo lee process.env directamente.
 * Si necesitas un valor nuevo, se añade aquí y al .env.example.
 *
 * LOS TESTS NO LEEN EL .env. `node --test` marca sus procesos hijo con
 * NODE_TEST_CONTEXT, y cuando esa marca está presente el .env no se carga:
 * la suite corre siempre contra los valores por defecto.
 *
 * No es cosmético. Cuando el .env se cargaba también en los tests, poner
 * PREGUNTA_IA_REWARD_ID con el ID real de la recompensa tumbaba once tests
 * que no tenían ningún fallo: comprobaban el camino del Channel Point con un
 * ID de mentira que ya no coincidía con el configurado. Un test solo debe
 * ponerse rojo por el código, nunca por la máquina en la que corre.
 */
if (!process.env.NODE_TEST_CONTEXT) {
  await import('dotenv/config');
}

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

export type CacheTtl = '5m' | '1h' | 'off';

const cacheTtlRaw = str('AI_CACHE_TTL', '1h').toLowerCase();
const validTtls: CacheTtl[] = ['5m', '1h', 'off'];
if (!validTtls.includes(cacheTtlRaw as CacheTtl)) {
  throw new Error(`AI_CACHE_TTL debe ser uno de: ${validTtls.join(', ')}. Vale "${cacheTtlRaw}".`);
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

  /**
   * Panel de control web. Solo escucha en 127.0.0.1: se abre desde el PC del
   * directo y desde ningún otro sitio. Ver src/panel/server.ts.
   */
  panel: {
    enabled: bool('PANEL_ENABLED', true),
    port: int('PANEL_PORT', 7070),
  },

  /**
   * WebSocket de OBS. Solo lo usa el panel para crear las fuentes y filtros
   * de los efectos; el directo lo lleva Streamer.bot con su propia conexión.
   * En OBS: Herramientas → Configuración del servidor WebSocket.
   */
  obs: {
    url: str('OBS_WS_URL', 'ws://127.0.0.1:4455'),
    password: str('OBS_WS_PASSWORD', ''),
    /** La fuente del juego: la que tiembla con el Terremoto. */
    fuenteJuego: str('OBS_FUENTE_JUEGO', 'Captura de ventana'),
  },

  /**
   * IA local (Ollama), para lo que se hace FUERA del directo: sugerir títulos
   * y textos. Lo que habla con el chat en directo sigue siendo Claude.
   *
   * qwen3.5:9b, elegido el 26 sep 2026 comparando títulos: qwen2.5:7b (el que
   * cabe entero en la RTX 2060) se inventaba raids y escribía Con Mayúsculas;
   * qwen3.5:9b escribe natural y con gracia, a cambio de ~20 s (la primera
   * vez, ~1 min: carga en la gráfica). keepAlive: cuánto se queda en la
   * gráfica tras usarlo; corto, para que no te quite memoria mientras juegas.
   */
  iaLocal: {
    url: str('OLLAMA_URL', 'http://127.0.0.1:11434'),
    modelo: str('OLLAMA_MODELO', 'qwen3.5:9b'),
    keepAlive: str('OLLAMA_KEEP_ALIVE', '2m'),
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

  /**
   * Techo aparte para lo que alguien PIDE: un comando, un canje, un botón del
   * panel. No es el bot hablando solo, así que no gasta del de arriba (el 26
   * sep 2026, un jefe y unos regalos lo agotaron en 10 minutos y dejaron a la
   * gente sin !inventario).
   *
   * 200 y no 60: la prueba de resistencia (90 min, 6-12 personas) necesitó
   * ~170 por hora y con 60 dejó 115 respuestas sin salir. Twitch admite unos
   * 2.400 por hora; el spam lo frenan las esperas de cada comando.
   */
  respuestasPerHour: int('BOT_RESPUESTAS_PER_HOUR', 200),

  /**
   * Parte del techo de respuestas guardada para lo que CAMBIA algo (!dar,
   * !forjar, duelos, jefes, regalos). Cuando queda menos que esto, las
   * consultas (!inventario, !top…) esperan: que un regalo o una forja nunca
   * pase sin anunciarse porque el hueco se lo comieron los !inventario.
   */
  reservaAcciones: Number(str('BOT_RESERVA_ACCIONES', '0.2')),

  /** true = no envía nada a Twitch, solo registra. Útil para probar en directo sin riesgo. */
  dryRun: bool('DRY_RUN', false),

  /**
   * ¿Puede el bot hablar sin que nadie le invoque?
   *
   * Con `false`, las únicas cosas que le hacen escribir en el chat son los
   * comandos (`!pregunta`, `!preguntar`) y el Channel Point. Sigue recibiendo
   * y registrando la presencia de quien escribe —eso no cuesta dinero y hace
   * falta para `#18 Bienvenida de Vuelta`—, pero no responde por su cuenta.
   *
   * Por defecto `true`, que es el diseño de docs/02: `#1 Primer Mensaje`
   * existe precisamente para romper el hielo sin que nadie tenga que saberse
   * un comando. Apagarlo es una decisión de producto legítima, y por eso es
   * un interruptor y no un borrado; pero deja el proyecto con UNA sola
   * interacción, y la Fase 7 necesita tres para extraer el motor.
   */
  interaccionesEspontaneas: bool('INTERACCIONES_ESPONTANEAS', true),

  /**
   * Modo revisión: lo que genere la IA espera tu aprobación por consola antes
   * de publicarse. Se aplica SOLO a texto generado por Claude; los mensajes
   * deterministas (saludos, textos de reserva) salen directos.
   *
   * Por defecto activado: es la mitigación del riesgo R2 de docs/04, y ante
   * Twitch respondes tú de lo que diga el bot. Se desactiva tras los dos
   * directos de validación.
   */
  reviewMode: bool('REVIEW_MODE', true),

  /**
   * #15 Dato Inútil (docs/02 § 4, interacción 15).
   *
   * Los tres valores existen para lo mismo: que la única llamada a la IA que
   * dispara el CHAT no se convierta en una factura. Ver dato-inutil.ts.
   */
  datoInutil: {
    /** Por debajo de esto no hay nada que extraer. "jajaja" no es un dato. */
    minimoCaracteres: int('DATO_INUTIL_MIN_CARACTERES', 40),
    /** Entre extracción y extracción, sea de quien sea. */
    cooldownExtraccionMs: int('DATO_INUTIL_COOLDOWN_MS', 10 * 60_000),
  },

  /** Sistema de memoria (docs/03, Fase 8). */
  memoria: {
    /**
     * Días que vive un recuerdo. 90 sale de docs/02, como mitigación del
     * riesgo de #15: un dato de hace cuatro meses que la persona ya no
     * recuerda haber dicho desconcierta en vez de agradar.
     */
    diasCaducidad: int('MEMORIA_DIAS_CADUCIDAD', 90),

    /**
     * Tope del TEXTO LIBRE que escribió un desconocido. docs/02, #2:
     * "limitar a 60 caracteres y sanear". Se aplica al fragmento que viene de
     * fuera, no a la fila entera.
     */
    maxLongitud: int('MEMORIA_MAX_LONGITUD', 60),

    /**
     * Tope de la fila completa que se guarda.
     *
     * Es mayor que el anterior porque un recuerdo suele llevar contexto
     * nuestro además del fragmento ajeno: en #2 se guarda la pregunta Y la
     * respuesta, y si el tope fuera 60 para el conjunto, una pregunta larga
     * dejaría sin sitio a la respuesta, que es justo el dato que interesa.
     */
    maxContenido: int('MEMORIA_MAX_CONTENIDO', 200),

    /** Minutos tras el saludo de #1 en los que la respuesta cuenta como ticket. */
    ventanaTicketMinutos: int('TICKET_VENTANA_MINUTOS', 2),
  },

  /** #1 Primer Mensaje (docs/02 § 2, interacción 1). */
  primerMensaje: {
    /**
     * true  = se saluda solo si Streamer.bot marca el mensaje como el primero
     *         del usuario en el canal. Es la fuente correcta.
     * false = se saluda a quien sea nuevo en NUESTRA base de datos, que es el
     *         criterio antiguo y saluda de más en un canal con historia.
     */
    confiarEnFlag: bool('PRIMER_MENSAJE_CONFIA_EN_FLAG', true),
  },

  /** #18 Bienvenida de Vuelta (docs/02 § 4, interacción 18). */
  bienvenidaVuelta: {
    /**
     * Días sin aparecer a partir de los cuales alguien "vuelve".
     *
     * 14 sale de la ficha del catálogo. Por debajo de dos semanas la vuelta
     * no se percibe como tal y el mensaje suena raro: alguien que faltó
     * cuatro días no siente que haya estado fuera.
     */
    diasAusencia: int('BIENVENIDA_VUELTA_DIAS', 14),
  },

  preguntaIa: {
    /** ID de la recompensa. Es lo más fiable: no cambia aunque la renombres. */
    rewardId: str('PREGUNTA_IA_REWARD_ID', ''),
    /** Alternativa por nombre, si no has puesto el ID. */
    rewardTitle: str('PREGUNTA_IA_REWARD_TITLE', 'Pregunta a Crid4m AI'),
    /** Cooldowns del comando gratuito. Vienen de docs/02 § 3, interacción #5. */
    commandGlobalCooldownMs: int('PREGUNTA_IA_COOLDOWN_GLOBAL_MS', 5 * 60_000),
    commandUserCooldownMs: int('PREGUNTA_IA_COOLDOWN_USER_MS', 15 * 60_000),
    /** Preguntas más largas se rechazan ANTES de gastar dinero en la IA. */
    maxQuestionLength: int('PREGUNTA_IA_MAX_INPUT', 300),
  },

  /**
   * Loot del chat. Tiene su propio interruptor, separado de las espontáneas:
   * anunciar un cofre es el bot hablando solo, pero es un juego que eliges
   * activar, no un saludo.
   */
  loot: {
    activo: bool('LOOT_ACTIVO', true),
    /** Entre cofre y cofre, al azar dentro de este margen (decidido: 20-30 min). */
    minutosMin: int('LOOT_MINUTOS_MIN', 20),
    minutosMax: int('LOOT_MINUTOS_MAX', 30),
    /** Solo recibe botín quien ha escrito en el chat en estos últimos minutos. */
    minutosActividad: int('LOOT_MINUTOS_ACTIVIDAD', 15),
    /** El Cofre del tesoro que se compra con Oros. */
    cofreRewardId: str('LOOT_COFRE_REWARD_ID', ''),
    cofreRewardTitle: str('LOOT_COFRE_REWARD_TITLE', 'Cofre del tesoro'),
    /** !inventario, por persona. */
    inventarioCooldownMs: int('LOOT_INVENTARIO_COOLDOWN_MS', 60_000),
    /**
     * El canal juega como uno más: recibe cofres, botín del jefe y regalos
     * (decidido el 26 sep 2026). En false, el Loot es solo para el chat.
     */
    canalJuega: bool('LOOT_CANAL_JUEGA', true),
  },

  /** #10 Pregunta Incómoda (docs/02 § 3, interacción 10). */
  preguntaIncomoda: {
    rewardId: str('PREGUNTA_INCOMODA_REWARD_ID', ''),
    rewardTitle: str('PREGUNTA_INCOMODA_REWARD_TITLE', 'Pregunta Incómoda'),
    /** Solo se aplica al comando !incomoda; el Channel Point se paga con puntos. */
    cooldownMs: int('PREGUNTA_INCOMODA_COOLDOWN_MS', 5 * 60_000),
  },

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

    /**
     * Topes de gasto. Se comprueban TODOS antes de cada llamada y basta con
     * que uno salte para que no se llame a Anthropic.
     *
     * El de sesión vive en memoria y cubre un directo (docs/04 § 1.5). Los de
     * día y mes salen de la tabla `ai_usage` en SQLite, así que SOBREVIVEN a
     * reiniciar el proceso: sin eso, "3 $ por directo" en realidad significaba
     * "3 $ por cada vez que arrancas", que es un tope que no protege de nada.
     */
    budgetPerStreamUsd: num('AI_BUDGET_PER_STREAM_USD', 3),
    budgetPerDayUsd: num('AI_BUDGET_PER_DAY_USD', 5),
    budgetPerMonthUsd: num('AI_BUDGET_PER_MONTH_USD', 20),

    /**
     * Tope de llamadas al día, además del de dinero.
     *
     * No es redundante: el coste solo se conoce si el modelo está en nuestra
     * tabla de precios. Si algún día se configura un modelo que no está,
     * el coste se registra como null y los topes en dólares dejarían de ver
     * el gasto. Contar llamadas funciona siempre.
     */
    maxCallsPerDay: int('AI_MAX_CALLS_PER_DAY', 250),

    /**
     * Caché del prompt de sistema. La personalidad son ~1.200 tokens que se
     * repiten en CADA pregunta; cachearla es el ahorro más grande que hay
     * aquí sin tocar la calidad.
     *
     * '1h' porque las preguntas llegan separadas por minutos, no por
     * segundos: con el TTL de 5 minutos la entrada caducaría entre preguntas
     * y pagaríamos la escritura una y otra vez. Ver docs/04.
     */
    cacheTtl: cacheTtlRaw as CacheTtl,
  },
} as const;

/**
 * Límite duro de Twitch: 500 caracteres por mensaje.
 * Dejamos margen. No es configurable a propósito.
 */
export const MAX_MESSAGE_LENGTH = 480;
