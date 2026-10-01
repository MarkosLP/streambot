import { getDb, nowIso } from '../../data/db.js';

export type TipoMision = 'jefes' | 'cofres';
interface Estado { activa: boolean; tipo: TipoMision; progreso: number; completada: boolean }
const META: Record<TipoMision, number> = { jefes: 2, cofres: 3 };
const NOMBRE: Record<TipoMision, string> = { jefes: 'Derrotar 2 jefes', cofres: 'Abrir 3 cofres del chat' };
const inicial: Estado = { activa: false, tipo: 'jefes', progreso: 0, completada: false };

function leer(): Estado {
  const fila = getDb().prepare("SELECT valor FROM ajustes WHERE clave = 'mision_directo'").get() as { valor: string } | undefined;
  if (!fila) return { ...inicial };
  try {
    const x = JSON.parse(fila.valor) as Partial<Estado>;
    if (x.tipo !== 'jefes' && x.tipo !== 'cofres') return { ...inicial };
    return { activa: x.activa === true, tipo: x.tipo, progreso: Math.min(META[x.tipo], Math.max(0, Math.floor(Number(x.progreso) || 0))), completada: x.completada === true };
  } catch { return { ...inicial }; }
}

function guardar(e: Estado): void {
  getDb().prepare('INSERT INTO ajustes (clave, valor, at) VALUES (?, ?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, at = excluded.at')
    .run('mision_directo', JSON.stringify(e), nowIso());
}

export function estado() {
  const e = leer();
  return { ...e, meta: META[e.tipo], nombre: NOMBRE[e.tipo] };
}

/** Preparar otra misión la deja siempre apagada; empezar exige pulsar el botón. */
export function preparar(tipo: TipoMision): ReturnType<typeof estado> {
  if (tipo !== 'jefes' && tipo !== 'cofres') throw new Error('Misión no válida');
  guardar({ activa: false, tipo, progreso: 0, completada: false });
  return estado();
}

export function activar(): ReturnType<typeof estado> {
  const e = leer();
  if (e.completada) throw new Error('Prepara otra misión antes de empezar');
  guardar({ ...e, activa: true });
  return estado();
}

export function pausar(): ReturnType<typeof estado> {
  guardar({ ...leer(), activa: false });
  return estado();
}

/** Solo cuentan sucesos reales con participantes; nunca las vistas previas. */
export function registrar(tipo: TipoMision): boolean {
  const e = leer();
  if (!e.activa || e.completada || e.tipo !== tipo) return false;
  e.progreso = Math.min(META[tipo], e.progreso + 1);
  e.completada = e.progreso === META[tipo];
  if (e.completada) e.activa = false;
  guardar(e);
  return e.completada;
}
