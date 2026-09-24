import { getDb } from '../data/db.js';
import { startOfLocalDay } from '../services/ai/budget.js';
import * as ajustes from '../core/ajustes.js';

/**
 * Consultas de solo lectura para el panel.
 *
 * Viven aquí y no en `data/` porque son vistas para una pantalla: juntan
 * tablas que el resto del sistema mantiene separadas a propósito.
 */

interface FichaInteraccion {
  nombre: string;
  numero: number;
  titulo: string;
  disparador: string;
  usaIa: boolean;
  espontanea: boolean;
}

/**
 * Las interacciones construidas.
 *
 * Es una lista escrita a mano, no se deduce del código: el panel necesita el
 * número de docs/02 y una frase legible, y eso no está en ningún otro sitio.
 */
const FICHAS: FichaInteraccion[] = [
  { nombre: 'pregunta-ia', numero: 5, titulo: 'Pregunta a Crid4m AI', disparador: '!pregunta / Channel Point', usaIa: true, espontanea: false },
  { nombre: 'pregunta-incomoda', numero: 10, titulo: 'Pregunta Incómoda', disparador: '!incomoda (subs) / Channel Point', usaIa: false, espontanea: false },
  { nombre: 'primer-mensaje', numero: 1, titulo: 'Primer Mensaje', disparador: 'Primer mensaje en el canal', usaIa: false, espontanea: true },
  { nombre: 'ticket-entrada', numero: 2, titulo: 'Ticket de Entrada', disparador: 'Respuesta al saludo', usaIa: false, espontanea: true },
  { nombre: 'bienvenida-vuelta', numero: 18, titulo: 'Bienvenida de Vuelta', disparador: 'Vuelve tras 14+ días', usaIa: false, espontanea: true },
  { nombre: 'dato-inutil', numero: 15, titulo: 'Dato Inútil', disparador: 'Vuelve y hay un recuerdo suyo', usaIa: true, espontanea: true },
  { nombre: 'rachas', numero: 19, titulo: 'Rachas', disparador: 'Directos seguidos', usaIa: false, espontanea: true },
  { nombre: 'continuara', numero: 24, titulo: 'Continuará', disparador: 'Fin del directo', usaIa: true, espontanea: true },
];

export interface VistaInteraccion extends FichaInteraccion {
  activa: boolean;
  hoy: { enviadas: number; descartadas: number };
  ultima: { at: string; status: string; detail: string | null } | null;
}

export function interacciones(): VistaInteraccion[] {
  const db = getDb();
  const desde = startOfLocalDay();

  const hoy = db
    .prepare(
      `SELECT interaction,
              SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS enviadas,
              SUM(CASE WHEN status != 'sent' THEN 1 ELSE 0 END) AS descartadas
         FROM interactions WHERE at >= ? GROUP BY interaction`,
    )
    .all(desde) as Array<{ interaction: string; enviadas: number; descartadas: number }>;

  const ultimaStmt = db.prepare(
    'SELECT at, status, detail FROM interactions WHERE interaction = ? ORDER BY id DESC LIMIT 1',
  );

  return FICHAS.map((f) => {
    const h = hoy.find((r) => r.interaction === f.nombre);
    const u = ultimaStmt.get(f.nombre) as { at: string; status: string; detail: string | null } | undefined;
    return {
      ...f,
      activa: !f.espontanea || ajustes.interaccionesEspontaneas(),
      hoy: { enviadas: Number(h?.enviadas ?? 0), descartadas: Number(h?.descartadas ?? 0) },
      ultima: u ?? null,
    };
  });
}

export interface VistaEspectador {
  twitchId: string;
  login: string;
  nombre: string;
  primeraVez: string;
  ultimaVez: string;
  racha: number;
  mejorRacha: number;
  recuerdos: number;
}

export function espectadores(): VistaEspectador[] {
  const rows = getDb()
    .prepare(
      `SELECT u.twitch_id, u.login, u.display_name, u.first_seen, u.last_seen,
              COALESCE(s.current, 0) AS racha,
              COALESCE(s.best, 0)    AS mejor,
              (SELECT COUNT(*) FROM memories m
                WHERE m.twitch_id = u.twitch_id AND m.expires_at > ?) AS recuerdos
         FROM users u
         LEFT JOIN streaks s ON s.twitch_id = u.twitch_id
        ORDER BY u.last_seen DESC`,
    )
    .all(new Date().toISOString()) as any[];

  return rows.map((r) => ({
    twitchId: r.twitch_id,
    login: r.login,
    nombre: r.display_name,
    primeraVez: r.first_seen,
    ultimaVez: r.last_seen,
    racha: Number(r.racha),
    mejorRacha: Number(r.mejor),
    recuerdos: Number(r.recuerdos),
  }));
}
