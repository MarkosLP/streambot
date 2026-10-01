import { getDb, nowIso } from '../data/db.js';
import { log } from './logger.js';
import { esBot } from './bots.js';
import type { DomainEvent } from './events.js';

/**
 * Alertas y panel rotativo del directo (27 sep 2026). Dos overlays y nada
 * más, para no llenar la pantalla:
 *
 *  - Alertas (biblioteca/overlays/alertas.html, fuente `OVL Alertas`): un aviso
 *    de unos segundos al mandar bits o traer una raid. Follows y suscripciones
 *    se muestran en Streamlabs. En cola: nunca dos a la vez.
 *  - Panel rotativo (biblioteca/overlays/panel.html, fuente `OVL Panel`): una
 *    caja pequeña que va cambiando entre el top de la temporada, el último
 *    follow, el último sub y una meta del mes.
 *
 * Aquí se guarda lo que tienen que enseñar: las últimas alertas (en memoria,
 * con un número que solo sube, para que el overlay sepa cuáles no ha visto),
 * el último follow y sub, lo que llevamos en el mes para la meta, y los
 * ajustes (en `ajustes`, clave 'overlays').
 */

export const TIPOS = ['follow', 'sub', 'regalo', 'bits', 'raid'] as const;
export type TipoAlerta = (typeof TIPOS)[number];
/** Follows y suscripciones los muestra Streamlabs; se conservan sus contadores. */
export const TIPOS_PROPIOS: readonly TipoAlerta[] = ['bits', 'raid'];

export interface Alerta {
  n: number;
  tipo: TipoAlerta;
  /** Quién (el nombre como se ve en el chat). */
  quien: string;
  /** La línea de debajo: «se suscribe · 6 meses», «trae a 12 personas»… */
  texto: string;
  /** Las de «Probar» del panel: se ven, pero no cuentan para nada. */
  prueba: boolean;
  at: string;
}

export const ROTATIVOS = ['cofre', 'top', 'follow', 'sub', 'meta'] as const;
export type Rotativo = (typeof ROTATIVOS)[number];
export const MARCOS_PANEL = ['pergamino', 'cristal', 'estandarte'] as const;
export type MarcoPanel = (typeof MARCOS_PANEL)[number];

export interface Meta {
  /** Qué se cuenta: follows o subs del mes (desde que el bot los ve), o nada. */
  tipo: 'follows' | 'subs' | 'ninguna';
  objetivo: number;
  /** Lo que ya había antes de contar (lo pones tú): se suma a lo contado. */
  base: number;
  /** El texto de la meta: «Meta de subs», «Hacia los 500»… */
  titulo: string;
}

export interface Ajustes {
  alertas: Record<TipoAlerta, boolean>;
  /** Volumen del sonido de las alertas (0 = sin sonido). */
  volumen: number;
  /** Qué enseña el panel rotativo, en este orden. */
  rotativo: Rotativo[];
  /** Segundos que se queda cada cosa del panel rotativo. */
  segundos: number;
  /** Aspecto y transparencia de la caja pequeña de OBS. */
  marco: MarcoPanel;
  opacidad: number;
  meta: Meta;
}

const POR_DEFECTO: Ajustes = {
  alertas: { follow: false, sub: false, regalo: false, bits: true, raid: true },
  volumen: 0.3,
  rotativo: ['cofre', 'top', 'follow', 'sub', 'meta'],
  segundos: 12,
  marco: 'pergamino',
  opacidad: 0.72,
  meta: { tipo: 'subs', objetivo: 10, base: 0, titulo: 'Meta de subs del mes' },
};

interface Guardado {
  versionRotativo: number;
  ajustes: Ajustes;
  ultimoFollow: { quien: string; at: string } | null;
  ultimoSub: { quien: string; texto: string; at: string } | null;
  /** Lo contado en el mes: se reinicia solo al cambiar de mes. */
  mes: { clave: string; follows: number; subs: number };
}

const CLAVE = 'overlays';
const mesDe = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
let guardado: Guardado | null = null;

const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');
const entero = (v: unknown, min: number, max: number, si: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(max, Math.max(min, v))) : si);

function limpiarAjustes(v: any): Ajustes {
  const a: Ajustes = structuredClone(POR_DEFECTO);
  if (!v || typeof v !== 'object') return a;
  if (v.alertas && typeof v.alertas === 'object') for (const t of TIPOS_PROPIOS) if (typeof v.alertas[t] === 'boolean') a.alertas[t] = v.alertas[t];
  if (typeof v.volumen === 'number' && Number.isFinite(v.volumen)) a.volumen = Math.min(1, Math.max(0, v.volumen));
  if (Array.isArray(v.rotativo)) a.rotativo = [...new Set(v.rotativo.filter((r: unknown): r is Rotativo => (ROTATIVOS as readonly unknown[]).includes(r)))] as Rotativo[];
  a.segundos = entero(v.segundos, 5, 60, a.segundos);
  if (MARCOS_PANEL.includes(v.marco)) a.marco = v.marco;
  if (typeof v.opacidad === 'number' && Number.isFinite(v.opacidad)) a.opacidad = Math.min(0.95, Math.max(0.45, v.opacidad));
  if (v.meta && typeof v.meta === 'object') {
    if (['follows', 'subs', 'ninguna'].includes(v.meta.tipo)) a.meta.tipo = v.meta.tipo;
    a.meta.objetivo = entero(v.meta.objetivo, 1, 100_000, a.meta.objetivo);
    a.meta.base = entero(v.meta.base, 0, 100_000, a.meta.base);
    a.meta.titulo = texto(v.meta.titulo, 40) || a.meta.titulo;
  }
  return a;
}

function leer(): Guardado {
  if (!guardado) {
    let v: any = null;
    try {
      const f = getDb().prepare('SELECT valor FROM ajustes WHERE clave = ?').get(CLAVE) as { valor: string } | undefined;
      v = f ? JSON.parse(f.valor) : null;
    } catch { /* sin guardar: lo de por defecto */ }
    const ajustes = limpiarAjustes(v?.ajustes);
    if (v && v.versionRotativo !== 2 && !ajustes.rotativo.includes('cofre')) ajustes.rotativo.unshift('cofre');
    guardado = {
      versionRotativo: 2,
      ajustes,
      ultimoFollow: v?.ultimoFollow ?? null,
      ultimoSub: v?.ultimoSub ?? null,
      mes: v?.mes && typeof v.mes === 'object' ? { clave: String(v.mes.clave), follows: entero(v.mes.follows, 0, 1e6, 0), subs: entero(v.mes.subs, 0, 1e6, 0) } : { clave: mesDe(), follows: 0, subs: 0 },
    };
  }
  // Mes nuevo: lo contado vuelve a cero (y la base de la meta también, que era del mes pasado).
  if (guardado.mes.clave !== mesDe()) {
    guardado.mes = { clave: mesDe(), follows: 0, subs: 0 };
    guardado.ajustes.meta.base = 0;
    guardar();
  }
  return guardado;
}

function guardar(): void {
  try {
    getDb()
      .prepare('INSERT INTO ajustes (clave, valor, at) VALUES (?, ?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, at = excluded.at')
      .run(CLAVE, JSON.stringify(guardado), nowIso());
  } catch (err) {
    log.debug(`Overlays sin guardar: ${String(err)}`);
  }
}

export const ajustes = (): Ajustes => leer().ajustes;

export function cambiarAjustes(cambios: any): Ajustes {
  const g = leer();
  const c = cambios && typeof cambios === 'object' ? cambios : {};
  g.ajustes = limpiarAjustes({ ...g.ajustes, ...c, alertas: { ...g.ajustes.alertas, ...(c.alertas ?? {}) }, meta: { ...g.ajustes.meta, ...(c.meta ?? {}) } });
  guardar();
  return g.ajustes;
}

// ---------------------------------------------------------------------------
// Las alertas
// ---------------------------------------------------------------------------

const recientes: Alerta[] = [];
let siguiente = 1;
/** Quien ha seguido hace poco: dejar de seguir y volver no repite la alerta. */
const seguidos = new Map<string, number>();
const SIN_REPETIR_FOLLOW_MS = 24 * 3600_000;

function alertar(tipo: TipoAlerta, quien: string, linea: string, prueba = false): Alerta | null {
  if (!TIPOS_PROPIOS.includes(tipo)) return null;
  if (!prueba && !leer().ajustes.alertas[tipo]) return null;
  const a: Alerta = { n: siguiente++, tipo, quien: texto(quien, 40) || 'Alguien', texto: texto(linea, 90), prueba, at: nowIso() };
  recientes.push(a);
  if (recientes.length > 20) recientes.shift();
  return a;
}

/** Lo que llega de Twitch. Devuelve la alerta creada (o null si está apagada o no toca). */
export function alEvento(event: DomainEvent): Alerta | null {
  const g = leer();
  switch (event.type) {
    case 'viewer.follow': {
      const v = event.viewer;
      const clave = v.login || v.id;
      if (!clave || esBot(v.login)) return null;
      const antes = seguidos.get(clave);
      if (antes && Date.now() - antes < SIN_REPETIR_FOLLOW_MS) return null;
      seguidos.set(clave, Date.now());
      g.ultimoFollow = { quien: v.displayName, at: nowIso() };
      g.mes.follows++;
      guardar();
      return alertar('follow', v.displayName, 'ahora te sigue');
    }
    case 'viewer.sub': {
      const linea = event.resub ? `se resuscribe · ${event.meses} ${event.meses === 1 ? 'mes' : 'meses'}` : 'se suscribe';
      g.ultimoSub = { quien: event.viewer.displayName, texto: linea, at: nowIso() };
      g.mes.subs++;
      guardar();
      return alertar('sub', event.viewer.displayName, `${linea}${event.nivel > 1 ? ` · nivel ${event.nivel}` : ''}`);
    }
    case 'viewer.giftsub': {
      // Los de una bomba llegan también sueltos: la alerta es la de la bomba.
      g.mes.subs++;
      g.ultimoSub = { quien: event.recibe.displayName, texto: `recibe un sub de ${event.regala?.displayName ?? 'un anónimo'}`, at: nowIso() };
      guardar();
      if (event.bomba > 1) return null;
      return alertar('regalo', event.regala?.displayName ?? 'Anónimo', `regala un sub a ${event.recibe.displayName}`);
    }
    case 'viewer.giftbomb':
      return alertar('regalo', event.regala?.displayName ?? 'Anónimo', `regala ${event.cantidad} subs a la comunidad`);
    case 'viewer.cheer':
      return event.bits > 0 ? alertar('bits', event.viewer.displayName, `manda ${event.bits} bits`) : null;
    case 'channel.raid':
      return alertar('raid', event.desde.displayName, `llega de raid con ${event.espectadores} ${event.espectadores === 1 ? 'persona' : 'personas'}`);
    default:
      return null;
  }
}

const PRUEBAS: Record<TipoAlerta, [string, string]> = {
  follow: ['raftaei', 'ahora te sigue'],
  sub: ['Ana_la_Tanque', 'se resuscribe · 6 meses'],
  regalo: ['Pepe', 'regala 5 subs a la comunidad'],
  bits: ['Sombra_22', 'manda 500 bits'],
  raid: ['OtroCanal', 'llega de raid con 23 personas'],
};

/** Una alerta de prueba (panel): se ve igual, no cuenta ni cambia el último follow o sub. */
export function probar(tipo: TipoAlerta): Alerta {
  if (!TIPOS_PROPIOS.includes(tipo)) throw new Error('Los avisos de follows y suscripciones se gestionan en Streamlabs');
  const [quien, linea] = PRUEBAS[tipo];
  return alertar(tipo, quien, linea, true)!;
}

// ---------------------------------------------------------------------------
// Para los overlays
// ---------------------------------------------------------------------------

/** Lo que cuenta la meta ahora mismo. */
export function meta(): { titulo: string; actual: number; objetivo: number; tipo: Meta['tipo'] } | null {
  const g = leer();
  const m = g.ajustes.meta;
  if (m.tipo === 'ninguna') return null;
  const contado = m.tipo === 'follows' ? g.mes.follows : g.mes.subs;
  return { titulo: m.titulo, actual: m.base + contado, objetivo: m.objetivo, tipo: m.tipo };
}

/** Para el overlay de alertas: las que hay (él se queda con las que no ha visto por su `n`). */
export function paraAlertas() {
  return { alertas: [...recientes], volumen: leer().ajustes.volumen };
}

/** Para el panel rotativo (el top lo añade quien lo llama: sale del Loot). */
export function paraRotativo() {
  const g = leer();
  return {
    orden: g.ajustes.rotativo,
    segundos: g.ajustes.segundos,
    marco: g.ajustes.marco,
    opacidad: g.ajustes.opacidad,
    ultimoFollow: g.ultimoFollow,
    ultimoSub: g.ultimoSub,
    meta: meta(),
  };
}

/** Para el panel de control. */
export function estado() {
  const g = leer();
  return { ajustes: g.ajustes, ultimoFollow: g.ultimoFollow, ultimoSub: g.ultimoSub, mes: g.mes, meta: meta(), recientes: recientes.filter((a) => !a.prueba).slice(-8).reverse() };
}

/** Solo para tests. */
export function reset(): void {
  guardado = null;
  recientes.length = 0;
  siguiente = 1;
  seguidos.clear();
}
