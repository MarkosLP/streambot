import { config } from './config.js';
import { log } from './core/logger.js';
import * as killswitch from './core/killswitch.js';
import { connect, disconnect } from './transport/streamerbot.js';

/**
 * Arranque del sistema.
 *
 * FASE 2: conecta con Streamer.bot, normaliza los eventos que llegan y los
 * imprime. Todavía no responde en el chat (ver core/output.ts).
 */

async function main(): Promise<void> {
  log.info('CRID4M Interaction System — Fase 2 (esqueleto)');
  log.info(`Dueño del canal: ${config.broadcasterLogin} · Interruptor: ${killswitch.status()}`);
  log.info('Salida al chat DESACTIVADA en esta fase: solo se registra lo que se enviaría.');

  await connect();

  log.info('Escuchando. Ctrl+C para salir.');
}

async function shutdown(signal: string): Promise<void> {
  log.info(`Recibido ${signal}. Cerrando...`);
  try {
    await disconnect();
  } catch (err) {
    log.warn(`Error al desconectar: ${String(err)}`);
  }
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// Una promesa sin capturar nunca debe tumbar el proceso en mitad de un directo.
process.on('unhandledRejection', (err) => {
  log.error(`Promesa sin capturar: ${String(err)}`);
});

main().catch((err) => {
  log.error(`No se pudo arrancar: ${String(err)}`);
  process.exit(1);
});
