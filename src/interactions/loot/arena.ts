/**
 * Los duelos, para el overlay de OBS (biblioteca/overlays/jefe.html, la misma
 * fuente «FX Jefe»: así no hay que montar otra).
 *
 * El overlay ve solo los últimos segundos; el panel conserva los 30 últimos
 * duelos de esta sesión para poder explicar el resultado.
 */
import * as consent from '../../core/consent.js';

export interface Duelo {
  /** Crece con cada duelo: el overlay sabe así cuáles no ha enseñado aún. */
  n: number;
  retador: { nombre: string; titulo: string | null; poder: number };
  rival: { nombre: string; titulo: string | null; poder: number };
  /** Probabilidad de que ganara el retador, 0-1. */
  prob: number;
  /** Tirada de 0 a 1: si es menor que prob, gana quien reta. */
  tirada: number;
  ganaRetador: boolean;
  /** El objeto maldito que cambió de manos, si hubo. */
  maldito: string | null;
  at: number;
}

const MAX = 5;
/** Un duelo más viejo que esto ya no se enseña (si el overlay se carga tarde). */
const VIGENCIA_MS = 30_000;

let duelos: Duelo[] = [];
let historial: Array<{ duelo: Duelo; retadorId: string; rivalId: string }> = [];
let contador = 0;

export function registrarDuelo(d: Omit<Duelo, 'n' | 'at'>, now = Date.now(), ids = { retadorId: '', rivalId: '' }): Duelo {
  const duelo = { ...d, n: ++contador, at: now };
  duelos.push(duelo);
  if (duelos.length > MAX) duelos.shift();
  historial.unshift({ duelo, ...ids });
  if (historial.length > 30) historial.pop();
  return duelo;
}

/** Los duelos recientes, del más antiguo al más nuevo. */
export function recientes(now = Date.now()): Duelo[] {
  return duelos.filter((d) => now - d.at < VIGENCIA_MS);
}

/** Los últimos duelos para el panel, ocultando los de quien pidió el olvido. */
export function paraPanel(): Duelo[] {
  return historial
    .filter(({ retadorId, rivalId }) => !consent.haPedidoOlvido(retadorId) && !consent.haPedidoOlvido(rivalId))
    .map(({ duelo }) => duelo);
}

/** Solo para tests. */
export function reset(): void {
  duelos = [];
  historial = [];
  contador = 0;
}
