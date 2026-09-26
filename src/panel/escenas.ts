import { config } from '../config.js';
import { getDb, nowIso } from '../data/db.js';
import * as streams from '../data/streams.js';
import * as lootDb from '../data/loot.js';
import * as chatReciente from '../core/chat-reciente.js';
import { log } from '../core/logger.js';
import * as loot from '../interactions/loot/index.js';
import * as jefe from '../interactions/loot/jefe.js';
import * as eventos from '../interactions/loot/eventos.js';
import * as temporada from '../interactions/loot/temporada.js';
import * as temporadas from '../data/temporadas.js';
import * as datos from './datos.js';
import { DIBUJADO, rutaValida, ultimoDe } from './fondos.js';
import { rutaValida as avatarValido } from './avatar-ia.js';

/**
 * Escenas del directo (27 sep 2026): Empezamos, Charla, Pausa y Final.
 *
 * Un solo overlay (biblioteca/overlays/escena.html?tipo=…) pinta las cuatro.
 * Lo que se puede cambiar sin tocar OBS (textos, la cuenta atrás, el avatar
 * de cuando no hay cámara) vive aquí y se guarda en la tabla `ajustes`
 * (clave 'escenas'): el overlay lo pregunta cada pocos segundos.
 */

export const TIPOS = ['inicio', 'charla', 'pausa', 'final'] as const;
export type Tipo = (typeof TIPOS)[number];

export interface ConfigEscenas {
  /** Empezamos: el título grande y lo de debajo. */
  titulo: string;
  subtitulo: string;
  /** Charla: el rótulo bajo la cámara. */
  charla: string;
  /** Pausa: lo que se dice mientras. */
  pausa: string;
  /** Final: la despedida. */
  final: string;
  /** Hasta cuándo cuenta la cuenta atrás (Empezamos y Pausa), o null. */
  hasta: string | null;
  /** Charla sin cámara: el avatar tapa el hueco de la cámara. */
  avatar: boolean;
  /** Lo que dice el bocadillo del avatar. */
  avatarTexto: string;
  /** El fondo de cada escena ('imagenes/fondos/…'); sin él, el paisaje dibujado. */
  fondos: Partial<Record<Tipo, string>>;
  /** El personaje del avatar generado con IA ('imagenes/avatar/…'); sin él, el dibujado. */
  avatarImagen: string | null;
}

export const POR_DEFECTO: ConfigEscenas = {
  titulo: 'Empezamos en breve',
  subtitulo: 'Coge algo de beber y ponte cómodo',
  charla: 'Just Chatting',
  pausa: 'Estira las piernas y bebe agua 💧',
  final: 'Nos vemos en el próximo directo',
  hasta: null,
  avatar: false,
  avatarTexto: 'Un momento, vuelvo a cámara enseguida 🙈',
  fondos: {},
  avatarImagen: 'imagenes/avatar/errante',
};

const CLAVE = 'escenas';
const LARGO_MAX = 90;
let actual: ConfigEscenas | null = null;

export function leer(): ConfigEscenas {
  if (actual) return actual;
  try {
    const f = getDb().prepare('SELECT valor FROM ajustes WHERE clave = ?').get(CLAVE) as { valor: string } | undefined;
    actual = { ...POR_DEFECTO, ...(f ? limpiar(JSON.parse(f.valor)) : {}) };
  } catch {
    actual = { ...POR_DEFECTO };
  }
  return actual;
}

/** Solo lo que se conoce, con el tipo y el largo que toca. Lo demás se ignora. */
function limpiar(v: any): Partial<ConfigEscenas> {
  const r: Partial<ConfigEscenas> = {};
  if (!v || typeof v !== 'object') return r;
  for (const k of ['titulo', 'subtitulo', 'charla', 'pausa', 'final', 'avatarTexto'] as const) {
    if (typeof v[k] === 'string') r[k] = v[k].replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, LARGO_MAX);
  }
  if (typeof v.avatar === 'boolean') r.avatar = v.avatar;
  if (v.avatarImagen === null || avatarValido(v.avatarImagen)) r.avatarImagen = v.avatarImagen;
  if (v.fondos && typeof v.fondos === 'object') {
    const f: Partial<Record<Tipo, string>> = {};
    for (const t of TIPOS) if (rutaValida(v.fondos[t]) || v.fondos[t] === DIBUJADO) f[t] = v.fondos[t];
    r.fondos = f;
  }
  if (v.hasta === null) r.hasta = null;
  else if (typeof v.hasta === 'string' && !Number.isNaN(Date.parse(v.hasta))) r.hasta = new Date(v.hasta).toISOString();
  return r;
}

/** Cambia lo que venga y lo guarda. Un texto vacío vuelve al de por defecto. */
export function cambiar(cambios: unknown): ConfigEscenas {
  const limpio = limpiar(cambios);
  for (const k of Object.keys(limpio) as Array<keyof ConfigEscenas>) {
    if (limpio[k] === '') (limpio as any)[k] = POR_DEFECTO[k];
  }
  // Los fondos se cambian de uno en uno: { fondos: { inicio: '…' } } no borra los demás.
  // null quita el de esa escena.
  const antes = leer();
  const fondos = { ...antes.fondos, ...(limpio.fondos ?? {}) };
  if (cambios && typeof cambios === 'object' && (cambios as any).fondos) {
    for (const t of TIPOS) if ((cambios as any).fondos[t] === null) delete fondos[t];
  }
  actual = { ...antes, ...limpio, fondos };
  try {
    getDb()
      .prepare('INSERT INTO ajustes (clave, valor, at) VALUES (?, ?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, at = excluded.at')
      .run(CLAVE, JSON.stringify(actual), nowIso());
  } catch (err) {
    log.debug(`Escenas sin guardar: ${String(err)}`);
  }
  return actual;
}

/** Tras «Volver a lo del .env», que borra su fila. */
export function olvidar(): void {
  actual = null;
}

const nombreCanal = () => config.broadcasterLogin.charAt(0).toUpperCase() + config.broadcasterLogin.slice(1);

/**
 * Lo que pinta el overlay. Solo cosas que ya se ven en el chat o en el
 * directo: nombres, botín, el podio. El chat, solo para Charla; el resumen,
 * solo para el Final (es la consulta más cara).
 */
export function paraOverlay(tipo: string) {
  const e = eventos.actual();
  const j = jefe.estado();
  const l = loot.estado();
  const r = tipo === 'final' ? datos.resumenDirecto() : null;
  const directo = streams.current();
  const cfg = leer();
  // Sin fondo elegido, el último generado para esa escena; «dibujado», ninguno.
  const fondos = Object.fromEntries(TIPOS.map((t) => {
    const f = cfg.fondos[t];
    return [t, f === DIBUJADO ? null : f ?? ultimoDe(t)];
  }));
  return {
    ahora: new Date().toISOString(),
    canal: nombreCanal(),
    config: { ...cfg, fondos },
    directo: directo ? { desde: directo.started_at } : null,
    evento: e ? { emoji: e.emoji, nombre: e.nombre, texto: e.texto } : null,
    temporada: {
      nombre: temporadas.nombre(temporadas.deFecha()),
      diasQuedan: temporadas.diasQuedan(),
      podio: temporada.rankingActual(3).map((p) => ({ nombre: p.display_name, puntos: p.puntos })),
    },
    botin: lootDb.recientes(8).map((b) => ({ id: b.id, quien: b.display_name, objeto: b.objeto, rareza: b.rareza, maldito: b.maldito === 1, origen: b.origen })),
    loot: { activo: l.activo, proximoEnSeg: l.directo ? l.proximoEnSeg : null },
    jefe: j ? { nombre: j.nombre, vida: j.vida, vidaMax: j.vidaMax, quedanSeg: j.quedanSeg } : null,
    chat: tipo === 'charla'
      ? chatReciente.recientes(14).map(({ n, nombre, color, texto, emotes, sub, mod, canal }) => ({ n, nombre, color, texto, emotes, sub, mod, canal }))
      : [],
    final: r
      ? {
        minutos: r.minutos,
        personas: r.personas.nombres,
        nuevos: r.personas.nuevos,
        destacados: r.loot.destacados,
        cofres: r.loot.cofres.reduce((n, c) => n + c.n, 0) + r.loot.cofresTesoro,
        jefes: r.jefes.derrotados,
        duelos: r.duelos,
      }
      : null,
  };
}

/** Solo para tests. */
export function reset(): void {
  actual = null;
}
