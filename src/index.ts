import { config } from './config.js';
import { log } from './core/logger.js';
import * as killswitch from './core/killswitch.js';
import { setSender } from './core/output.js';
import { setApprover } from './core/review.js';
import { consoleApprover, closeApprover } from './core/console-approver.js';
import { getDb, closeDatabase } from './data/db.js';
import * as users from './data/users.js';
import { connect, disconnect, sendChat } from './transport/streamerbot.js';

/**
 * Arranque del sistema.
 *
 * FASE 5: recibe eventos de Twitch, consulta SQLite, llama a la IA cuando
 * corresponde y responde en el chat.
 */

async function main(): Promise<void> {
  log.info('CRID4M Interaction System — Fase 5');
  log.info(`Dueño del canal: ${config.broadcasterLogin} · Interruptor: ${killswitch.status()}`);

  // Abrir la base de datos ANTES de conectar: si el esquema falla, mejor
  // enterarse con el chat aún sin escuchar que a mitad del primer mensaje.
  getDb();
  log.info(`SQLite: ${config.dbPath} · ${users.count()} usuario(s) conocidos`);

  if (config.dryRun) {
    log.warn('DRY_RUN activo: no se enviará nada a Twitch, solo se registrará.');
  }

  if (config.reviewMode) {
    log.warn('MODO REVISIÓN activo: lo que genere la IA esperará tu aprobación por consola.');
    setApprover(consoleApprover);
  }

  // Aquí se enchufa el envío real. output.ts no importa el transporte:
  // así se rompe el ciclo y los tests pueden inyectar un emisor falso.
  setSender(sendChat);

  await connect();

  log.info('Escuchando. Ctrl+C para salir.');
}

async function shutdown(signal: string): Promise<void> {
  log.info(`Recibido ${signal}. Cerrando...`);
  try {
    await disconnect();
    closeApprover();
    closeDatabase();
  } catch (err) {
    log.warn(`Error al cerrar: ${String(err)}`);
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
