/** Noticias breves del Loot para el panel de OBS. Solo viven mientras corre el bot. */
export interface Novedad {
  n: number;
  at: number;
  tipo: 'botin' | 'canje' | 'jefe' | 'raid';
  titulo: string;
  quien: string;
  detalle: string;
}

const fila: Novedad[] = [];
let siguiente = 1;
const VIGENCIA_MS = 30_000;

export function anotar(tipo: Novedad['tipo'], titulo: string, quien: string, detalle: string, now = Date.now()): void {
  fila.push({ n: siguiente++, at: now, tipo, titulo: titulo.slice(0, 42), quien: quien.slice(0, 40), detalle: detalle.slice(0, 100) });
  if (fila.length > 20) fila.shift();
}

export function recientes(now = Date.now()): Novedad[] {
  return fila.filter((e) => now - e.at >= 0 && now - e.at < VIGENCIA_MS);
}

export function reset(): void {
  fila.length = 0;
  siguiente = 1;
}
