import { config } from '../config.js';
import { getDb, nowIso } from '../data/db.js';
import * as streams from '../data/streams.js';
import * as lootDb from '../data/loot.js';
import * as chatReciente from '../core/chat-reciente.js';
import * as musica from '../core/musica.js';
import * as temas from './temas.js';
import * as rotulos from './rotulos.js';
import { log } from '../core/logger.js';
import * as loot from '../interactions/loot/index.js';
import * as jefe from '../interactions/loot/jefe.js';
import * as eventos from '../interactions/loot/eventos.js';
import * as temporada from '../interactions/loot/temporada.js';
import * as temporadas from '../data/temporadas.js';
import * as datos from './datos.js';
import { DIBUJADO, rutaValida, ultimoDe } from './fondos.js';
import { ERRANTE, rutaValida as avatarValido, ultimoDe as ultimoAvatar } from './avatar-ia.js';
import * as estilos from './estilos.js';
import { ESTILOS, ID_PROPIO, POR_DEFECTO as ESTILO_POR_DEFECTO, esEstilo, type Estilo, type EstiloPropio } from './estilos.js';

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

/** Lo que cada estilo guarda para sí: al volver a él, vuelve todo lo suyo. */
export interface Tema {
  /** El fondo elegido de cada escena ('imagenes/fondos/…' o 'dibujado'); sin él, el último generado. */
  fondos: Partial<Record<Tipo, string>>;
  /** El personaje elegido ('imagenes/avatar/…'); null, el último creado en este estilo (o el errante). */
  avatarImagen: string | null;
}

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
  /** El estilo de las escenas (estilos.ts). */
  estilo: Estilo;
  /** Fondos y personaje de cada estilo. */
  temas: Partial<Record<Estilo, Tema>>;
  /** Los estilos creados en el panel (estilos.ts). */
  propios: EstiloPropio[];
  /** Los del estilo actual (sale de `temas`; se cambian con cambiar({ fondos }) y cambiar({ avatarImagen })). */
  fondos: Partial<Record<Tipo, string>>;
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
  estilo: ESTILO_POR_DEFECTO,
  temas: {},
  propios: [],
  fondos: {},
  avatarImagen: null,
};

const CLAVE = 'escenas';
const LARGO_MAX = 90;
let actual: ConfigEscenas | null = null;

const TEMA_VACIO: Tema = { fondos: {}, avatarImagen: null };

/** Con `fondos` y `avatarImagen` del estilo que toca. Registra los propios en estilos.ts. */
function conVista(c: Omit<ConfigEscenas, 'fondos' | 'avatarImagen'>): ConfigEscenas {
  estilos.registrarPropios(c.propios);
  const estilo = esEstilo(c.estilo) ? c.estilo : ESTILO_POR_DEFECTO;
  const t = c.temas[estilo] ?? TEMA_VACIO;
  return { ...c, estilo, fondos: { ...t.fondos }, avatarImagen: t.avatarImagen };
}

export function leer(): ConfigEscenas {
  if (actual) return actual;
  try {
    const f = getDb().prepare('SELECT valor FROM ajustes WHERE clave = ?').get(CLAVE) as { valor: string } | undefined;
    actual = conVista({ ...POR_DEFECTO, ...(f ? guardado(JSON.parse(f.valor)) : {}) });
  } catch {
    actual = conVista({ ...POR_DEFECTO });
  }
  return actual;
}

const limpiarFondos = (v: any): Partial<Record<Tipo, string>> => {
  const f: Partial<Record<Tipo, string>> = {};
  if (v && typeof v === 'object') for (const t of TIPOS) if (rutaValida(v[t]) || v[t] === DIBUJADO) f[t] = v[t];
  return f;
};
const limpiarAvatar = (v: unknown): string | null | undefined => (v === null || avatarValido(v) ? v : undefined);

/** Solo lo que se conoce, con el tipo y el largo que toca. Lo demás se ignora. */
function limpiar(v: any): Partial<ConfigEscenas> {
  const r: Partial<ConfigEscenas> = {};
  if (!v || typeof v !== 'object') return r;
  for (const k of ['titulo', 'subtitulo', 'charla', 'pausa', 'final', 'avatarTexto'] as const) {
    if (typeof v[k] === 'string') r[k] = v[k].replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, LARGO_MAX);
  }
  if (typeof v.avatar === 'boolean') r.avatar = v.avatar;
  if (typeof v.estilo === 'string' && (esEstilo(v.estilo) || ID_PROPIO.test(v.estilo))) r.estilo = v.estilo;
  if (v.hasta === null) r.hasta = null;
  else if (typeof v.hasta === 'string' && !Number.isNaN(Date.parse(v.hasta))) r.hasta = new Date(v.hasta).toISOString();
  return r;
}

/**
 * Lo guardado en la base de datos. Lo de antes de los estilos (fondos y
 * personaje sueltos, sin `temas`) pasa al oscuro, que era el único.
 */
function guardado(v: any): Partial<ConfigEscenas> {
  const r = limpiar(v);
  r.propios = Array.isArray(v?.propios)
    ? v.propios.map((e: any) => estilos.limpiarPropio(e, e?.id)).filter((e: EstiloPropio | null): e is EstiloPropio => e !== null).slice(0, estilos.MAX_PROPIOS)
    : [];
  const temas: Partial<Record<Estilo, Tema>> = {};
  if (v?.temas && typeof v.temas === 'object') {
    for (const e of Object.keys(v.temas).filter((k) => (ESTILOS as readonly string[]).includes(k) || ID_PROPIO.test(k))) {
      const t = v.temas[e];
      if (t && typeof t === 'object') temas[e] = { fondos: limpiarFondos(t.fondos), avatarImagen: limpiarAvatar(t.avatarImagen) ?? null };
    }
  } else if (v && (v.fondos || v.avatarImagen !== undefined)) {
    temas.oscuro = { fondos: limpiarFondos(v.fondos), avatarImagen: limpiarAvatar(v.avatarImagen) ?? null };
  }
  r.temas = temas;
  return r;
}

/**
 * Cambia lo que venga y lo guarda. Un texto vacío vuelve al de por defecto.
 * `fondos` y `avatarImagen` son del estilo actual (o del que llegue en el
 * mismo cambio): los de los demás estilos no se tocan.
 */
export function cambiar(cambios: unknown): ConfigEscenas {
  const limpio = limpiar(cambios);
  for (const k of Object.keys(limpio) as Array<keyof ConfigEscenas>) {
    if (limpio[k] === '') (limpio as any)[k] = POR_DEFECTO[k];
  }
  const antes = leer();
  if (limpio.estilo && !esEstilo(limpio.estilo)) delete limpio.estilo;
  const estilo = limpio.estilo ?? antes.estilo;
  const tema: Tema = { ...TEMA_VACIO, ...antes.temas[estilo] };
  const c = (cambios && typeof cambios === 'object' ? cambios : {}) as any;
  // Los fondos se cambian de uno en uno: { fondos: { inicio: '…' } } no borra los demás.
  // null quita el de esa escena.
  if (c.fondos && typeof c.fondos === 'object') {
    tema.fondos = { ...tema.fondos, ...limpiarFondos(c.fondos) };
    for (const t of TIPOS) if (c.fondos[t] === null) delete tema.fondos[t];
  }
  const av = limpiarAvatar(c.avatarImagen);
  if (av !== undefined) tema.avatarImagen = av;
  return guardar(conVista({ ...antes, ...limpio, estilo, temas: { ...antes.temas, [estilo]: tema } }));
}

function guardar(c: ConfigEscenas): ConfigEscenas {
  actual = c;
  try {
    const { fondos: _f, avatarImagen: _a, ...paraGuardar } = actual;
    getDb()
      .prepare('INSERT INTO ajustes (clave, valor, at) VALUES (?, ?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, at = excluded.at')
      .run(CLAVE, JSON.stringify(paraGuardar), nowIso());
  } catch (err) {
    log.debug(`Escenas sin guardar: ${String(err)}`);
  }
  return actual;
}

/**
 * Crea un estilo propio (sin id) o cambia uno que existe. Queda elegido.
 * Devuelve null si falta el nombre o la temática.
 */
export function guardarEstilo(datos: unknown, id?: string): { config: ConfigEscenas; id: string } | null {
  const antes = leer();
  const existe = id ? antes.propios.some((e) => e.id === id) : false;
  if (id && !existe) return null;
  if (!existe && antes.propios.length >= estilos.MAX_PROPIOS) return null;
  const nuevo = estilos.limpiarPropio(datos, existe ? id! : estilos.nuevoId());
  if (!nuevo) return null;
  const propios = existe ? antes.propios.map((e) => (e.id === nuevo.id ? nuevo : e)) : [...antes.propios, nuevo];
  return { id: nuevo.id, config: guardar(conVista({ ...antes, propios, estilo: nuevo.id })) };
}

/** Quita un estilo propio. Sus imágenes se quedan en la Biblioteca. Si era el elegido, vuelve el oscuro. */
export function borrarEstilo(id: string): ConfigEscenas {
  const antes = leer();
  const temas = { ...antes.temas };
  delete temas[id];
  const propios = antes.propios.filter((e) => e.id !== id);
  return guardar(conVista({ ...antes, propios, temas, estilo: antes.estilo === id ? ESTILO_POR_DEFECTO : antes.estilo }));
}

/** Tras borrar una imagen: donde estuviera puesta (en cualquier estilo), vuelve a «el último». */
export function olvidarImagen(ruta: string): ConfigEscenas {
  const antes = leer();
  const temas: Record<string, Tema> = {};
  for (const [id, t] of Object.entries(antes.temas)) {
    if (!t) continue;
    const fondos = Object.fromEntries(Object.entries(t.fondos).filter(([, r]) => r !== ruta));
    temas[id] = { fondos, avatarImagen: t.avatarImagen === ruta ? null : t.avatarImagen };
  }
  return guardar(conVista({ ...antes, temas }));
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
  // Sin fondo elegido, el último generado para esa escena en este estilo;
  // «dibujado», ninguno. Sin personaje elegido, el último de este estilo, y
  // si aún no hay, el errante: el avatar siempre es una imagen.
  const fondos = Object.fromEntries(TIPOS.map((t) => {
    const f = cfg.fondos[t];
    return [t, f === DIBUJADO ? null : f ?? ultimoDe(t, cfg.estilo)];
  }));
  const { temas: _t, propios: _p, ...resto } = cfg;
  const avatarImagen = cfg.avatarImagen ?? ultimoAvatar(cfg.estilo) ?? ERRANTE;
  // Dónde están sus ojos y su cara (si se hizo con máscara): avatar.html mezcla exactamente eso.
  const zonas = rotulos.leerSync(avatarImagen);
  return {
    ahora: new Date().toISOString(),
    canal: nombreCanal(),
    config: { ...resto, fondos, avatarImagen, avatarZonas: zonas?.ojos ? { ojos: zonas.ojos, cara: zonas.cara ?? null } : null, apariencia: estilos.apariencia(cfg.estilo) },
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
    // El tema del que hablas (panel → Temas → En pantalla): solo en Charla.
    tema: tipo === 'charla' ? temas.leer().pantalla : null,
    musica: (() => {
      const m = musica.estado();
      return m.sonando && m.pista ? { titulo: m.pista.titulo, artista: m.pista.artista } : null;
    })(),
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
