import { StreamerbotClient, type StreamerbotEventsSubscription } from '@streamerbot/client';
import { config } from '../config.js';
import { log } from '../core/logger.js';
import { normalize } from '../core/events.js';
import { handleEvent } from '../core/handler.js';

/**
 * Único archivo que sabe que Streamer.bot existe.
 *
 * Se conecta como CLIENTE a su servidor WebSocket (por defecto
 * ws://127.0.0.1:8080/). Esa dirección de conexión es deliberada: el
 * sub-action "Fetch URL" de Streamer.bot solo soporta GET, así que el
 * camino contrario obligaría a escribir C# dentro de su interfaz gráfica
 * por cada interacción. Ver docs/01-ARQUITECTURA.md § 1.
 */

/**
 * Eventos a los que nos suscribimos.
 *
 * ChatMessage y RewardRedemption están normalizados. Los demás llegan como
 * eventos `raw` y se guardan en logs/raw-events.log: es la forma de tener
 * payloads reales con los que escribir sus normalizadores en la Fase 3,
 * en vez de deducirlos de la documentación.
 */
// El tipo no es decorativo: si escribes mal un nombre de evento,
// `npm run typecheck` lo caza antes de llegar al directo.
const SUBSCRIPTIONS: StreamerbotEventsSubscription = {
  Twitch: [
    'ChatMessage',
    'RewardRedemption',
    'Follow',
    'Sub',
    'ReSub',
    'GiftSub',
    'Cheer',
    'Raid',
    'StreamOnline',
    'StreamOffline',
  ],
};

let client: StreamerbotClient | null = null;

/** Estado de la conexión, solo para que los logs de reconexión sean legibles. */
let connected = false;
let failedAttempts = 0;

export async function connect(): Promise<void> {
  const { host, port, endpoint, password } = config.streamerbot;
  const target = `ws://${host}:${port}${endpoint}`;

  log.info(`Conectando a Streamer.bot en ${target} ...`);
  if (!password) {
    log.warn(
      'STREAMERBOT_PASSWORD está vacío. Funciona, pero conviene activar la ' +
        'autenticación en Streamer.bot (Servers/Clients -> WebSocket Server).',
    );
  }

  client = new StreamerbotClient({
    host,
    port,
    endpoint,
    password: password || undefined,

    // Reconexión: Streamer.bot se cierra y se abre a menudo mientras trasteas.
    // El sistema tiene que sobrevivir a eso sin intervención.
    autoReconnect: true,
    retries: -1, // reintentos infinitos

    // La librería vuelca su propia traza completa en cada reintento. Con
    // Streamer.bot cerrado eso inunda la terminal y tapa los eventos del chat,
    // así que la silenciamos y damos nosotros la información, resumida.
    logLevel: 'none',

    subscribe: SUBSCRIPTIONS,

    onConnect: (info) => {
      connected = true;
      if (failedAttempts > 0) {
        log.info(`Reconectado con Streamer.bot tras ${failedAttempts} intento(s).`);
      }
      failedAttempts = 0;
      log.info(`Conectado a ${info.name} v${info.version} (${info.os}).`);
      log.info(`Suscrito a: ${Object.values(SUBSCRIPTIONS).flat().join(', ')}`);
    },

    onDisconnect: () => {
      connected = false;
      failedAttempts += 1;

      if (failedAttempts === 1) {
        log.warn('Conexión con Streamer.bot perdida. Reintentando en segundo plano...');
      } else if (failedAttempts % 20 === 0) {
        log.warn(
          `Streamer.bot sigue sin responder (${failedAttempts} intentos). ` +
            '¿Está abierto y con el WebSocket Server activo?',
        );
      } else {
        log.debug(`Reintento ${failedAttempts} fallido.`);
      }
    },

    onError: (err) => {
      const message = err?.message ?? String(err);
      // Dentro del bucle de reconexión este error se repite en cada intento y
      // no añade nada: onDisconnect ya está contando la historia.
      if (connected) log.error(`Error del cliente de Streamer.bot: ${message}`);
      else log.debug(`Error durante la reconexión: ${message}`);
    },
  });

  // Un único manejador para todos los eventos suscritos: normaliza y entrega.
  client.on('*', (payload: any) => {
    const eventName = `${payload?.event?.source}.${payload?.event?.type}`;
    try {
      handleEvent(normalize(eventName, payload?.data, 'streamerbot'));
    } catch (err) {
      // Un evento malformado nunca debe tumbar el proceso en mitad de un directo.
      log.error(`Fallo procesando ${eventName}: ${String(err)}`);
    }
  });
}

export async function disconnect(): Promise<void> {
  if (!client) return;
  await client.disconnect();
  client = null;
  log.info('Desconectado de Streamer.bot.');
}
