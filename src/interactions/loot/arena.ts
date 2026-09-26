/**
 * Los duelos, para el overlay de OBS (biblioteca/overlays/jefe.html, la misma
 * fuente «FX Jefe»: así no hay que montar otra).
 *
 * Solo se guarda lo que ya sale en el chat: quién, su poder, la probabilidad
 * y quién ganó. En memoria: un duelo de hace una hora no le importa a nadie.
 */

export interface Duelo {
  /** Crece con cada duelo: el overlay sabe así cuáles no ha enseñado aún. */
  n: number;
  retador: { nombre: string; titulo: string | null; poder: number };
  rival: { nombre: string; titulo: string | null; poder: number };
  /** Probabilidad de que ganara el retador, 0-1. */
  prob: number;
  ganaRetador: boolean;
  /** El objeto maldito que cambió de manos, si hubo. */
  maldito: string | null;
  at: number;
}

const MAX = 5;
/** Un duelo más viejo que esto ya no se enseña (si el overlay se carga tarde). */
const VIGENCIA_MS = 30_000;

let duelos: Duelo[] = [];
let contador = 0;

export function registrarDuelo(d: Omit<Duelo, 'n' | 'at'>, now = Date.now()): Duelo {
  const duelo = { ...d, n: ++contador, at: now };
  duelos.push(duelo);
  if (duelos.length > MAX) duelos.shift();
  return duelo;
}

/** Los duelos recientes, del más antiguo al más nuevo. */
export function recientes(now = Date.now()): Duelo[] {
  return duelos.filter((d) => now - d.at < VIGENCIA_MS);
}

/** Solo para tests. */
export function reset(): void {
  duelos = [];
  contador = 0;
}
