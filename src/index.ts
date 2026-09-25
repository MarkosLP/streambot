import { config } from './config.js';
import { log } from './core/logger.js';
import * as killswitch from './core/killswitch.js';
import { setSender } from './core/output.js';
import { setApprover } from './core/review.js';
import { preguntarEnConsola, closeApprover } from './core/console-approver.js';
import { getDb, closeDatabase } from './data/db.js';
import * as users from './data/users.js';
import * as memory from './core/memory.js';
import * as consent from './core/consent.js';
import { budget } from './services/ai/index.js';
import * as streamerbot from './transport/streamerbot.js';
import { connect, disconnect, sendChat } from './transport/streamerbot.js';
import * as panel from './panel/server.js';
import { aprobadorPanel } from './panel/revision.js';
import * as loot from './interactions/loot/index.js';
import { mostrarLegendario } from './panel/obs-setup.js';
import { conObs } from './transport/obs.js';
import type { Server } from 'node:http';

let panelServer: Server | null = null;

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

  // Los recuerdos caducados se borran al arrancar. Las lecturas ya filtran
  // por fecha, así que esto no arregla nada; lo que evita es guardar para
  // siempre datos de personas que nadie va a volver a leer.
  memory.limpiarCaducados();
  log.info(`Memoria: ${memory.count()} recuerdo(s) · ${consent.count()} persona(s) pidieron el olvido`);

  // El gasto, antes de recibir el primer evento. Los topes de día y mes se
  // leen de la base de datos, así que reiniciar no los borra: si ayer te
  // acercaste al tope, esta línea te lo dice ahora y no a mitad del directo.
  log.info(`IA: ${config.ai.model} · caché ${config.ai.cacheTtl}`);
  log.info(`Gasto — ${budget.describeSpend()}`);

  if (!budget.modelHasKnownPrice()) {
    log.warn(`No conocemos el precio de "${config.ai.model}", así que su gasto NO se puede sumar.`);
    log.warn(`Los topes en dólares quedan ciegos; solo protege el de ${config.ai.maxCallsPerDay} llamadas/día.`);
  }

  const topes = budget.check();
  if (!topes.ok) {
    log.warn(`ATENCIÓN: ya se ha superado un tope (${topes.reason}). La IA no responderá.`);
  }

  if (config.dryRun) {
    log.warn('DRY_RUN activo: no se enviará nada a Twitch, solo se registrará.');
  }

  if (config.reviewMode) {
    log.warn('MODO REVISIÓN activo: lo que genere la IA esperará tu aprobación en la consola o en el panel.');
  }

  // El aprobador se pone SIEMPRE, aunque la revisión arranque apagada: el
  // panel puede activarla en caliente, y review.ts falla cerrado si no hay
  // aprobador. Contesta el primero de los dos, consola o panel.
  setApprover(aprobadorPanel(preguntarEnConsola));

  // Aquí se enchufa el envío real. output.ts no importa el transporte:
  // así se rompe el ciclo y los tests pueden inyectar un emisor falso.
  setSender(sendChat);

  panelServer = await panel.arrancar(streamerbot);

  await connect();

  // Loot del chat. El banner del Legendario va a OBS en fila: si caen dos
  // seguidos, el segundo espera a que termine el primero en vez de pisarlo.
  let fila: Promise<void> = Promise.resolve();
  loot.setAlLegendario((quien, botin) => {
    fila = fila.then(() => conObs((pedir) => mostrarLegendario(pedir, quien, botin.objeto))).catch((err) => {
      log.warn(`Loot: el Legendario de ${quien} no salió en OBS (${err instanceof Error ? err.message : String(err)}).`);
    });
    return fila;
  });
  loot.arrancar();

  log.info('Escuchando. Ctrl+C para salir.');
}

async function shutdown(signal: string): Promise<void> {
  log.info(`Recibido ${signal}. Cerrando...`);
  try {
    loot.parar();
    panelServer?.close();
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
