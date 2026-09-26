import { getDb } from '../data/db.js';
import * as lootDb from '../data/loot.js';
import * as suscriptores from '../data/suscriptores.js';
import { startOfLocalDay } from '../services/ai/budget.js';
import * as ajustes from '../core/ajustes.js';
import { config } from '../config.js';
import { esBot } from '../core/bots.js';

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
  /** Poder en el Loot (0 sin mochila). */
  poder: number;
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
    poder: lootDb.poder(r.twitch_id),
  }));
}

/** Borra todo lo de la gente de prueba («prueba-…») que crean los botones de suscriptores. */
export function borrarPruebas(): number {
  const db = getDb();
  let n = 0;
  for (const tabla of ['loot', 'coleccion', 'duelos', 'suscriptores', 'temporada_puntos', 'salon_fama']) {
    n += Number(db.prepare(`DELETE FROM ${tabla} WHERE twitch_id LIKE 'prueba-%'`).run().changes);
  }
  suscriptores.reset();
  return n;
}

// ---------------------------------------------------------------------------
// Resumen del directo (27 sep 2026)
// ---------------------------------------------------------------------------

/** Los últimos directos, para elegir cuál resumir. */
export function directos(limite = 15): Array<{ id: number; desde: string; hasta: string | null }> {
  return (getDb().prepare('SELECT id, started_at, ended_at FROM streams ORDER BY id DESC LIMIT ?').all(limite) as Array<{ id: number; started_at: string; ended_at: string | null }>)
    .map((s) => ({ id: s.id, desde: s.started_at, hasta: s.ended_at }));
}

/** Cómo se llama cada cosa del registro en el resumen. */
const ETIQUETAS: Record<string, string> = {
  loot: 'Cofres',
  'loot-cofre-oro': 'Cofre del tesoro',
  'loot-jefe': 'Jefe (aparece o huye)',
  'loot-mecenas': 'Subs, bits y raids',
  'loot-temporada': 'Anuncio del directo',
  'loot-temporada-ver': '!temporada',
  'loot-inventario': '!inventario',
  'loot-grito': 'Grito de guerra',
  'loot-maldicion': 'Maldición',
  'loot-pocion': 'Poción de vida',
  'loot-ayuda': '!loot',
  olvidame: '!olvidame',
  'sonda-verificacion': '!ping',
  panel: 'Escrito desde el panel',
};

export function etiqueta(interaccion: string): string {
  return ETIQUETAS[interaccion]
    ?? FICHAS.find((f) => f.nombre === interaccion)?.titulo
    ?? (interaccion.startsWith('loot-') ? `!${interaccion.slice(5)}` : interaccion);
}

const MOTIVOS: Record<string, string> = {
  'hourly-budget': 'Tope de mensajes por hora',
  'mention-not-allowed': 'Mención no permitida',
  killswitch: 'Bot apagado',
  'too-long': 'Demasiado largo',
  'not-approved': 'No aprobado (modo revisión)',
  'transport-error': 'Fallo al enviar',
  'no-sender': 'Sin conexión con el chat',
};

/**
 * Qué pasó en un directo: quién vino, qué se usó, qué cayó y qué se quedó
 * sin decir. Sin id, el último. Todo sale de tablas que ya existen: el
 * registro de interacciones, las mochilas y los usuarios.
 */
export function resumenDirecto(id?: number) {
  const db = getDb();
  const s = (id
    ? db.prepare('SELECT id, started_at, ended_at FROM streams WHERE id = ?').get(id)
    : db.prepare('SELECT id, started_at, ended_at FROM streams ORDER BY id DESC LIMIT 1').get()) as
    | { id: number; started_at: string; ended_at: string | null }
    | undefined;
  if (!s) return null;
  const desde = s.started_at;
  const hasta = s.ended_at ?? new Date().toISOString();

  const filas = db
    .prepare('SELECT interaction, twitch_id, status, detail FROM interactions WHERE at >= ? AND at <= ?')
    .all(desde, hasta) as Array<{ interaction: string; twitch_id: string | null; status: string; detail: string | null }>;

  const contar = <T>(lista: T[], clave: (x: T) => string) => {
    const m = new Map<string, number>();
    for (const x of lista) m.set(clave(x), (m.get(clave(x)) ?? 0) + 1);
    return [...m.entries()].map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n);
  };

  const enviadas = filas.filter((f) => f.status === 'sent');
  const bloqueadas = filas.filter((f) => f.status === 'blocked');
  const detalle = (f: { detail: string | null }) => f.detail ?? '';

  // Quién vino: quien sale en el registro o recibió botín en ese rato.
  const botin = db
    .prepare('SELECT twitch_id, display_name, objeto, rareza, origen, maldito FROM loot WHERE at >= ? AND at <= ?')
    .all(desde, hasta) as Array<{ twitch_id: string; display_name: string; objeto: string; rareza: string; origen: string; maldito: number }>;
  const ids = new Set<string>([...filas.map((f) => f.twitch_id).filter((x): x is string => !!x), ...botin.map((b) => b.twitch_id)]);
  ids.forEach((x) => { if (x.startsWith('prueba-')) ids.delete(x); });
  const nombre = db.prepare('SELECT display_name FROM users WHERE twitch_id = ?');
  const nombres = [...ids]
    .map((x) => (nombre.get(x) as { display_name: string } | undefined)?.display_name ?? botin.find((b) => b.twitch_id === x)?.display_name)
    .filter((x): x is string => !!x)
    // Ni el canal ni los bots: «quién vino» es el público.
    .filter((n) => n.toLowerCase() !== config.broadcasterLogin && !esBot(n))
    .sort((a, b) => a.localeCompare(b));
  const nuevos = (db.prepare('SELECT display_name FROM users WHERE first_seen >= ? AND first_seen <= ? ORDER BY first_seen').all(desde, hasta) as Array<{ display_name: string }>)
    .map((u) => u.display_name);

  const cofres = filas.filter((f) => f.interaction === 'loot');
  const tipoCofre = (d: string) =>
    d.startsWith('regalo') ? 'Regalados por ti' : d.startsWith('fidelidad') ? 'De fidelidad' : d.startsWith('suelo') || d.startsWith('guerra') ? 'De guerra'
      : d.startsWith('panel') ? 'Soltados desde el panel' : 'Del chat (cada 20-30 min)';

  return {
    id: s.id,
    desde,
    hasta: s.ended_at,
    enCurso: s.ended_at === null,
    minutos: Math.round((new Date(hasta).getTime() - new Date(desde).getTime()) / 60_000),
    personas: { total: nombres.length, nombres, nuevos },
    mensajes: { enviados: enviadas.length, bloqueados: bloqueadas.length },
    // Lo que más se ha usado, con su nombre de verdad.
    usos: contar(enviadas, (f) => f.interaction).slice(0, 12).map(({ k, n }) => ({ que: etiqueta(k), n })),
    bloqueos: contar(bloqueadas, (f) => detalle(f).split(':')[0]!.trim()).map(({ k, n }) => ({ motivo: MOTIVOS[k] ?? 'Otro motivo (mira el registro)', n })),
    bloqueosPor: contar(bloqueadas, (f) => f.interaction).slice(0, 6).map(({ k, n }) => ({ que: etiqueta(k), n })),
    loot: {
      cofres: contar(cofres, (f) => tipoCofre(detalle(f))).map(({ k, n }) => ({ tipo: k, n })),
      cofresTesoro: enviadas.filter((f) => f.interaction === 'loot-cofre-oro').length,
      // Solo lo que sigue en alguna mochila: lo forjado o regalado ya no está.
      destacados: botin
        .filter((b) => b.rareza === 'legendario' || b.rareza === 'epico')
        .sort((a, b) => (a.rareza === b.rareza ? 0 : a.rareza === 'legendario' ? -1 : 1))
        .slice(0, 10)
        .map((b) => ({ quien: b.display_name, objeto: b.objeto, rareza: b.rareza, maldito: b.maldito === 1 })),
    },
    jefes: {
      aparecen: filas.filter((f) => f.interaction === 'loot-jefe' && detalle(f).startsWith('aparece')).length,
      derrotados: filas.filter((f) => detalle(f).startsWith('jefe derrotado')).length,
      escapan: filas.filter((f) => f.interaction === 'loot-jefe' && detalle(f).startsWith('se escapa')).length,
    },
    duelos: enviadas.filter((f) => f.interaction === 'loot-duelo').length,
  };
}

/**
 * La ficha de un espectador en el panel: su mochila, su poder y su puesto,
 * duelos, colección, título y racha. Lo mismo que ve en el chat con sus
 * comandos, junto.
 */
export function ficha(twitchId: string) {
  const racha = getDb().prepare('SELECT current, best FROM streaks WHERE twitch_id = ?').get(twitchId) as { current: number; best: number } | undefined;
  const c = lootDb.coleccion(twitchId);
  return {
    mochila: lootDb.mochila(twitchId),
    poder: lootDb.poder(twitchId),
    puesto: lootDb.puesto(twitchId),
    duelos: lootDb.duelos(twitchId),
    titulo: lootDb.titulo(twitchId),
    coleccion: { tiene: c.total, de: c.de },
    racha: racha?.current ?? 0,
    mejorRacha: racha?.best ?? 0,
  };
}
