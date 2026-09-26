import { config, MAX_MESSAGE_LENGTH } from '../../config.js';
import * as ajustes from '../../core/ajustes.js';
import { log } from '../../core/logger.js';
import { send } from '../../core/output.js';
import * as interactionLog from '../../data/interactions.js';
import * as lootDb from '../../data/loot.js';
import * as streams from '../../data/streams.js';
import * as temporadas from '../../data/temporadas.js';
import * as eventos from './eventos.js';
import { ESTILO, tirarDe, type Azar, type Rareza } from './objetos.js';

/**
 * Temporadas del Loot y el anuncio del principio del directo (27 sep 2026).
 *
 * Puntos de temporada:
 *   - cada objeto conseguido, lo que vale su poder (data/loot.ts, `dar`)
 *   - cada duelo ganado, PUNTOS_DUELO (el triple en la Semana de la arena)
 *   - el MVP de un jefe, PUNTOS_MVP
 *
 * Al empezar un mes, la temporada anterior se cierra: el podio va al Salón de
 * la Fama, con premio, y el primero gana el título «Campeón de <mes>».
 * El canal no entra en el podio aunque juegue: no se va a ganar a sí mismo.
 */

export const NAME = 'loot-temporada';
export const PUNTOS_DUELO = 5;
export const PUNTOS_MVP = 10;
/** El premio del podio, directo a la mochila. */
export const PREMIOS: Rareza[] = ['legendario', 'epico', 'raro'];

/** Quién no cuenta para el podio: el canal y la gente de prueba del panel. */
const excluidos = () => [config.broadcasterLogin];
const esPrueba = (id: string) => id.startsWith('prueba-');

export function puntosDuelo(ahora = new Date()): number {
  return PUNTOS_DUELO * (eventos.activo('arena', ahora) ? 3 : 1);
}

/** El ranking de la temporada en curso, sin el canal ni la gente de prueba. */
export function rankingActual(limite = 10, ahora = new Date()): temporadas.Puesto[] {
  cerrarPendientes(ahora);
  return temporadas.ranking(temporadas.deFecha(ahora), limite + 50, excluidos()).filter((p) => !esPrueba(p.twitch_id)).slice(0, limite);
}

export function puestoActual(twitchId: string, ahora = new Date()) {
  return temporadas.puesto(temporadas.deFecha(ahora), twitchId, excluidos());
}

// ---------------------------------------------------------------------------
// Cerrar temporadas
// ---------------------------------------------------------------------------

/** El último mes comprobado: cerrar se mira como mucho una vez por mes y proceso. */
let comprobada = '';

/**
 * Cierra las temporadas ya acabadas que sigan abiertas y reparte su premio.
 * Síncrono y barato de llamar a menudo. Devuelve cuántas ha cerrado.
 */
export function cerrarPendientes(ahora = new Date(), azar: Azar = Math.random): number {
  const mes = temporadas.deFecha(ahora);
  if (comprobada === mes) return 0;
  comprobada = mes;
  const pendientes = temporadas.pendientesDeCerrar(ahora);
  for (const t of pendientes) {
    const podio = temporadas.ranking(t, 50, excluidos()).filter((p) => !esPrueba(p.twitch_id)).slice(0, PREMIOS.length);
    temporadas.cerrar(t, podio);
    podio.forEach((p, i) => lootDb.dar(p.twitch_id, p.display_name, tirarDe(PREMIOS[i]!, azar), 'temporada'));
    log.info(`Temporada ${t} cerrada: ${podio.map((p, i) => `${i + 1}º ${p.display_name} (${p.puntos})`).join(', ') || 'sin nadie'}.`);
  }
  return pendientes.length;
}

const MEDALLAS = ['🥇', '🥈', '🥉'];

/** `🏆 ¡Fin de la temporada de septiembre! 🥇 Ana (340) · …`, o null si no hubo nadie. */
export function componerFinal(temporada: string, ahora = new Date()): string | null {
  const podio = temporadas.podio(temporada);
  if (!podio.length) return null;
  const nombre = temporadas.nombre(temporada, ahora);
  const puestos = podio.map((p, i) => `${MEDALLAS[i]} ${p.display_name} (${p.puntos})`).join(' · ');
  const premios = PREMIOS.slice(0, podio.length).map((r) => ESTILO[r].emoji).join('');
  return `🏆 ¡Fin de la temporada de ${nombre}! ${puestos}. ${podio[0]!.display_name} gana el título «Campeón de ${nombre}» y el podio se lleva su premio (${premios}). ¡Empieza una temporada nueva: todos a cero! (!top)`;
}

// ---------------------------------------------------------------------------
// El anuncio del principio del directo
// ---------------------------------------------------------------------------

/** El directo en el que ya se ha anunciado. */
let anunciadoEn: number | null = null;

/** `📅 Esta semana: ☠️ Semana maldita… · Temporada de octubre: quedan 5 días (!top)`. */
export function componerSemana(ahora = new Date()): string {
  const e = eventos.actual(ahora);
  const dias = temporadas.diasQuedan(ahora);
  const temporada = `🏆 Temporada de ${temporadas.nombre(temporadas.deFecha(ahora), ahora)}: ${dias === 1 ? 'último día' : `quedan ${dias} días`} (!top)`;
  return e ? `📅 Esta semana, ${eventos.describir(e)} · ${temporada}` : temporada;
}

/**
 * Con el primer mensaje de una persona en cada directo: cuenta el evento de
 * la semana y, si acaba de cerrarse una temporada, su podio. Se espera a que
 * haya alguien: anunciarlo a un chat vacío no lo lee nadie.
 *
 * La decisión es síncrona (anunciadoEn se marca antes del primer await), así
 * que dos mensajes seguidos no lo anuncian dos veces.
 */
export function alPrimerMensaje(ahora = new Date()): Promise<void> | null {
  const directo = streams.current();
  if (!directo || anunciadoEn === directo.id || !ajustes.lootActivo()) return null;
  anunciadoEn = directo.id;
  cerrarPendientes(ahora);

  const finales = temporadas.sinAnunciar();
  const textos: Array<{ texto: string; temporada?: string }> = [];
  for (const t of finales) {
    const f = componerFinal(t, ahora);
    if (f) textos.push({ texto: f, temporada: t });
    else temporadas.marcarAnunciada(t);
  }
  // Sin evento (lo has quitado en el panel), la temporada sola no merece un
  // mensaje en cada directo: está en !top.
  if (eventos.actual(ahora)) textos.push({ texto: componerSemana(ahora) });
  if (!textos.length) return null;

  return (async () => {
    for (const { texto, temporada } of textos) {
      const o = await send({ text: texto.slice(0, MAX_MESSAGE_LENGTH), reason: NAME });
      if (o.sent && temporada) temporadas.marcarAnunciada(temporada);
      interactionLog.record({ interaction: NAME, status: o.sent ? 'sent' : 'blocked', detail: temporada ? `fin de temporada ${temporada}` : 'anuncio de la semana' });
    }
  })();
}

/** Solo para tests. */
export function reset(): void {
  comprobada = '';
  anunciadoEn = null;
}
