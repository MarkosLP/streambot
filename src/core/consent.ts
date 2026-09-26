import { getDb, nowIso } from '../data/db.js';
import * as suscriptores from '../data/suscriptores.js';
import { log } from './logger.js';

/**
 * Consentimiento y derecho al olvido.
 *
 * docs/03, Fase 8: *"`!olvidame` y opt-out permanente, **obligatorio** para
 * cualquier cosa que recuerde o mencione a alguien"*. Este archivo se escribió
 * ANTES que las interacciones que recuerdan, y no al revés, porque un sistema
 * de memoria sin forma de salir de él no debería llegar a existir.
 *
 * Dos garantías, y conviene no confundirlas:
 *
 *  1. **Borrar** lo que haya de esa persona. Todo, de todas las tablas.
 *  2. **No volver a guardar** nada suyo nunca más.
 *
 * La segunda obliga a conservar UNA fila: su id en la tabla `consent`. Es
 * aparentemente contradictorio —te pido que me olvides y guardas mi id— pero
 * la alternativa es peor: sin esa marca, la persona tendría que repetir la
 * petición cada vez que escribiera, y el bot volvería a recordarla mientras
 * tanto. Se guarda lo mínimo: el id y la fecha. Ni nombre, ni mensajes, nada.
 */

/** Lo que borra un !olvidame, para poder contarlo después. */
export interface Borrado {
  memories: number;
  interactions: number;
  users: number;
  streaks: number;
  loot: number;
}

/** ¿Esta persona ha pedido que no la recordemos? */
export function haPedidoOlvido(twitchId: string): boolean {
  if (!twitchId) return false;
  const row = getDb()
    .prepare('SELECT opted_out FROM consent WHERE twitch_id = ?')
    .get(twitchId) as { opted_out: number } | undefined;
  return row?.opted_out === 1;
}

/**
 * Borra todo rastro de una persona y marca que no se la vuelva a recordar.
 *
 * El orden importa: primero se marca el opt-out y después se borra. Si se
 * hiciera al revés y algo fallara en medio, quedaría la persona borrada pero
 * sin la marca, y el siguiente mensaje suyo la volvería a registrar.
 */
export function olvidar(twitchId: string): Borrado {
  const db = getDb();

  db.prepare(
    'INSERT INTO consent (twitch_id, opted_out, at) VALUES (?, 1, ?) ' +
      'ON CONFLICT(twitch_id) DO UPDATE SET opted_out = 1, at = excluded.at',
  ).run(twitchId, nowIso());

  const memories = db.prepare('DELETE FROM memories WHERE twitch_id = ?').run(twitchId);
  const interactions = db.prepare('DELETE FROM interactions WHERE twitch_id = ?').run(twitchId);
  const users = db.prepare('DELETE FROM users WHERE twitch_id = ?').run(twitchId);
  const streaks = db.prepare('DELETE FROM streaks WHERE twitch_id = ?').run(twitchId);
  // La mochila del Loot del chat también es "algo suyo".
  const loot = db.prepare('DELETE FROM loot WHERE twitch_id = ?').run(twitchId);
  db.prepare('DELETE FROM coleccion WHERE twitch_id = ?').run(twitchId);
  db.prepare('DELETE FROM duelos WHERE twitch_id = ?').run(twitchId);
  db.prepare('DELETE FROM suscriptores WHERE twitch_id = ?').run(twitchId);
  suscriptores.reset();

  const borrado: Borrado = {
    memories: Number(memories.changes),
    interactions: Number(interactions.changes),
    users: Number(users.changes),
    streaks: Number(streaks.changes),
    loot: Number(loot.changes),
  };

  log.info(
    `!olvidame de ${twitchId}: ${borrado.memories} recuerdo(s), ` +
      `${borrado.interactions} interaccion(es) y ${borrado.users} ficha(s) borradas.`,
  );

  return borrado;
}

/**
 * Deshace el olvido.
 *
 * No hay comando de chat para esto a propósito: revertirlo tiene que ser una
 * decisión meditada, no un `!recuerdame` escrito en caliente. Existe para que
 * puedas arreglarlo a mano si alguien se arrepiente.
 */
export function volverARecordar(twitchId: string): void {
  getDb().prepare('DELETE FROM consent WHERE twitch_id = ?').run(twitchId);
  log.info(`${twitchId} vuelve a permitir que le recordemos.`);
}

export function count(): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM consent WHERE opted_out = 1')
    .get() as { n: number };
  return row.n;
}
