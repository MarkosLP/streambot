import { config } from '../config.js';
import { log } from './logger.js';

/**
 * Ajustes que se pueden cambiar con el bot en marcha, desde el panel.
 *
 * Arrancan con el valor del `.env` y viven en memoria, igual que el
 * interruptor de emergencia: reiniciar el proceso los devuelve a lo que diga
 * el `.env`. Es deliberado. El `.env` sigue siendo la configuración de
 * verdad, y un cambio hecho con prisas en mitad de un directo no debería
 * sobrevivir a un reinicio sin que nadie lo decida.
 *
 * Todo el código que antes leía `config.interaccionesEspontaneas` o
 * `config.reviewMode` lee ahora de aquí. `config` no se toca: sigue siendo lo
 * que se leyó al arrancar.
 */

let espontaneas: boolean = config.interaccionesEspontaneas;
let revision: boolean = config.reviewMode;

export function interaccionesEspontaneas(): boolean {
  return espontaneas;
}

export function modoRevision(): boolean {
  return revision;
}

export function setInteraccionesEspontaneas(valor: boolean, quien: string): void {
  if (espontaneas === valor) return;
  espontaneas = valor;
  log.warn(`Interacciones espontáneas ${valor ? 'ENCENDIDAS' : 'APAGADAS'} — ${quien}.`);
}

export function setModoRevision(valor: boolean, quien: string): void {
  if (revision === valor) return;
  revision = valor;
  log.warn(`Modo revisión ${valor ? 'ACTIVADO' : 'DESACTIVADO'} — ${quien}.`);
}

/** Solo para tests: vuelve a los valores del `.env`. */
export function reset(): void {
  espontaneas = config.interaccionesEspontaneas;
  revision = config.reviewMode;
}
