import { createHash } from 'node:crypto';
import { getDb, nowIso } from '../data/db.js';
import { log } from '../core/logger.js';
import * as iaLocal from '../services/ia-local.js';

/**
 * Temas para hablar (27 sep 2026): titulares del día de juegos, actualidad y
 * ciencia, para los directos de Just Chatting. «Que la gente diga: vamos a
 * ver a Crid4m, que no solo juega, también habla de cosas interesantes.»
 *
 * Los titulares salen de los RSS públicos de cada medio (gratis, sin IA).
 * La IA local (Ollama, gratis) solo entra si pulsas «Preparar»: resume el
 * tema y propone preguntas y una encuesta para el chat, SOLO con lo que dice
 * el titular y su entradilla (se le prohíbe inventar).
 *
 * El guion del directo (los temas que apartas) y el tema que sale en pantalla
 * (escena Charla) se guardan en `ajustes` (clave 'temas').
 *
 * Todo lo que viene de fuera es texto: se limpia de HTML aquí y el panel y
 * el overlay lo pintan con textContent.
 */

export const CATEGORIAS = { juegos: '🎮 Juegos', actualidad: '🌍 Actualidad', ciencia: '🔬 Ciencia y tecnología' } as const;
export type Categoria = keyof typeof CATEGORIAS;

export interface Fuente {
  id: string;
  nombre: string;
  categoria: Categoria;
  url: string;
}

/** Comprobadas el 27 sep 2026 (RTVE se descartó: su RSS da noticias de 2022). */
export const FUENTES: Fuente[] = [
  { id: '3djuegos', nombre: '3DJuegos', categoria: 'juegos', url: 'https://www.3djuegos.com/index.xml' },
  { id: 'ign', nombre: 'IGN España', categoria: 'juegos', url: 'https://es.ign.com/feed.xml' },
  { id: 'eurogamer', nombre: 'Eurogamer', categoria: 'juegos', url: 'https://www.eurogamer.es/feed' },
  { id: 'vidaextra', nombre: 'VidaExtra', categoria: 'juegos', url: 'https://www.vidaextra.com/index.xml' },
  { id: 'elpais', nombre: 'El País', categoria: 'actualidad', url: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada' },
  { id: 'bbc', nombre: 'BBC Mundo', categoria: 'actualidad', url: 'https://feeds.bbci.co.uk/mundo/rss.xml' },
  { id: '20minutos', nombre: '20minutos', categoria: 'actualidad', url: 'https://www.20minutos.es/rss/' },
  { id: 'europapress', nombre: 'Europa Press', categoria: 'actualidad', url: 'https://www.europapress.es/rss/rss.aspx' },
  { id: 'xataka', nombre: 'Xataka', categoria: 'ciencia', url: 'https://www.xataka.com/index.xml' },
  { id: 'hipertextual', nombre: 'Hipertextual', categoria: 'ciencia', url: 'https://hipertextual.com/feed' },
  { id: 'muyinteresante', nombre: 'Muy Interesante', categoria: 'ciencia', url: 'https://www.muyinteresante.com/feed/' },
];

export interface Noticia {
  id: string;
  titulo: string;
  enlace: string;
  resumen: string;
  imagen: string | null;
  fecha: string | null;
  fuente: string;
  categoria: Categoria;
}

// ---------------------------------------------------------------------------
// Leer un RSS (o Atom) sin librerías
// ---------------------------------------------------------------------------

const ENTIDADES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', iexcl: '¡', iquest: '¿', euro: '€', deg: '°', middot: '·',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü', ccedil: 'ç', Ccedil: 'Ç', agrave: 'à', egrave: 'è', ograve: 'ò',
};

export function decodificar(t: string): string {
  return t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (todo, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENTIDADES[e] ?? todo;
  });
}

const sinCdata = (t: string) => t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

/** HTML → texto plano: fuera etiquetas, scripts y entidades; espacios juntos. */
export function aTexto(html: string): string {
  let t = sinCdata(html);
  // Algunos medios escapan el HTML dos veces (&lt;p&gt;): primero se decodifica.
  if (/&lt;\/?[a-z]/i.test(t)) t = decodificar(t);
  t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
  return decodificar(t).replace(/\s+/g, ' ').trim();
}

function campo(xml: string, ...nombres: string[]): string | null {
  for (const n of nombres) {
    const m = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i').exec(xml);
    if (m && m[1]!.trim()) return m[1]!;
  }
  return null;
}

function atributo(xml: string, etiqueta: string, attr: string, filtro?: RegExp): string | null {
  for (const m of xml.matchAll(new RegExp(`<${etiqueta}\\s[^>]*>`, 'gi'))) {
    if (filtro && !filtro.test(m[0])) continue;
    const v = new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, 'i').exec(m[0]);
    if (v) return decodificar(v[1]!);
  }
  return null;
}

const esWeb = (u: string | null): u is string => !!u && /^https?:\/\/[^\s<>"']+$/i.test(u);

/** Las noticias de un RSS/Atom, limpias. Lo que no tenga título o enlace, fuera. */
export function leerFeed(xml: string, fuente: Fuente): Noticia[] {
  const bloques = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]!);
  const noticias: Noticia[] = [];
  for (const b of bloques.slice(0, 40)) {
    const titulo = aTexto(campo(b, 'title') ?? '');
    let enlace = aTexto(campo(b, 'link') ?? '') || atributo(b, 'link', 'href', /rel=["']alternate["']|^(?!.*rel=)/i) || atributo(b, 'link', 'href');
    if (!esWeb(enlace)) enlace = aTexto(campo(b, 'guid') ?? '');
    if (!titulo || !esWeb(enlace)) continue;
    const bruto = campo(b, 'description', 'summary', 'content:encoded', 'content') ?? '';
    const imagen = atributo(b, 'media:content', 'url') ?? atributo(b, 'media:thumbnail', 'url') ?? atributo(b, 'enclosure', 'url', /type=["']image/i)
      ?? (/<img[^>]+src=["']([^"']+)["']/i.exec(decodificar(sinCdata(bruto)))?.[1] ?? null);
    const fechaTexto = aTexto(campo(b, 'pubDate', 'published', 'updated', 'dc:date') ?? '');
    const fecha = fechaTexto && !Number.isNaN(Date.parse(fechaTexto)) ? new Date(fechaTexto).toISOString() : null;
    let resumen = aTexto(bruto).replace(/\s*(Leer la noticia completa|Leer más|Seguir leyendo|Continuar leyendo)\.?\s*$/i, '');
    if (resumen.length > 320) resumen = `${resumen.slice(0, 317).replace(/\s+\S*$/, '')}…`;
    noticias.push({
      id: createHash('sha1').update(enlace).digest('hex').slice(0, 12),
      titulo: titulo.slice(0, 220), enlace, resumen, imagen: esWeb(imagen) ? imagen : null, fecha, fuente: fuente.nombre, categoria: fuente.categoria,
    });
  }
  return noticias;
}

// ---------------------------------------------------------------------------
// Pedirlas (con caché)
// ---------------------------------------------------------------------------

const CADUCA_MS = 20 * 60_000;
/** Más viejo que esto no es «de qué se habla hoy». */
const MAX_EDAD_MS = 3 * 24 * 3600_000;

type Descargador = (url: string) => Promise<string>;
const descargarWeb: Descargador = async (url) => {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (panel de Crid4m; lector RSS)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`respondió ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  // Alguno (Vandal) va en latin1: se mira el XML y la cabecera.
  const cab = `${r.headers.get('content-type') ?? ''} ${buf.subarray(0, 200).toString('latin1')}`;
  return buf.toString(/iso-8859-1|latin1|windows-1252/i.test(cab) ? 'latin1' : 'utf8');
};
let descargar: Descargador = descargarWeb;

/** Solo para tests: otro descargador (sin internet). */
export function setDescargador(d: Descargador | null): void {
  descargar = d ?? descargarWeb;
  cache.clear();
}

const cache = new Map<string, { at: number; noticias: Noticia[]; error: string | null }>();

async function deFuente(f: Fuente, forzar: boolean): Promise<{ noticias: Noticia[]; error: string | null }> {
  const c = cache.get(f.id);
  if (c && !forzar && Date.now() - c.at < CADUCA_MS) return c;
  try {
    const noticias = leerFeed(await descargar(f.url), f);
    const r = { at: Date.now(), noticias, error: null };
    cache.set(f.id, r);
    return r;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.debug(`Temas: ${f.nombre} no se pudo leer: ${error}`);
    // Si falla, se queda con lo último bueno que tuviera.
    const r = { at: Date.now(), noticias: c?.noticias ?? [], error };
    cache.set(f.id, r);
    return r;
  }
}

/** Todas las noticias recientes, las más nuevas primero, sin repetir enlace. */
export async function noticias(forzar = false): Promise<{ noticias: Noticia[]; errores: Array<{ fuente: string; error: string }> }> {
  const resultados = await Promise.all(FUENTES.map(async (f) => ({ f, ...(await deFuente(f, forzar)) })));
  const vistas = new Set<string>();
  const ahora = Date.now();
  const todas = resultados.flatMap((r) => r.noticias)
    .filter((n) => !n.fecha || ahora - Date.parse(n.fecha) < MAX_EDAD_MS)
    .filter((n) => (vistas.has(n.id) ? false : (vistas.add(n.id), true)))
    .sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''));
  ultimas = new Map(todas.map((n) => [n.id, n]));
  return { noticias: todas, errores: resultados.filter((r) => r.error).map((r) => ({ fuente: r.f.nombre, error: r.error! })) };
}

/** Las de la última lectura, por id (para preparar y apartar sin volver a descargar). */
let ultimas = new Map<string, Noticia>();
export const buscar = (id: string): Noticia | null => ultimas.get(id) ?? leer().guion.find((g) => g.noticia.id === id)?.noticia ?? null;

// ---------------------------------------------------------------------------
// Preparar un tema con la IA local
// ---------------------------------------------------------------------------

export interface Preparado {
  resumen: string;
  preguntas: string[];
  encuesta: { pregunta: string; opciones: string[] };
}

const ESQUEMA = {
  type: 'object',
  properties: {
    resumen: { type: 'string' },
    preguntas: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 },
    encuesta: {
      type: 'object',
      properties: { pregunta: { type: 'string' }, opciones: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 } },
      required: ['pregunta', 'opciones'],
    },
  },
  required: ['resumen', 'preguntas', 'encuesta'],
};

const SISTEMA =
  'Ayudas a un streamer español de Twitch (juega a MMOs y hace Just Chatting) a comentar noticias con su chat. ' +
  'Te dan un titular y su entradilla. Devuelves: un resumen de 2 o 3 frases, claro y neutral, para que él lo cuente con sus palabras; ' +
  '3 preguntas cortas y abiertas para lanzar al chat que inviten a opinar o contar experiencias; y una encuesta con 2 a 4 opciones cortas. ' +
  'REGLAS: usa SOLO la información del titular y la entradilla, no inventes datos, cifras, fechas ni nombres. ' +
  'Si es un tema delicado (muertes, guerras, víctimas), tono respetuoso, nada de bromas, y preguntas serias. ' +
  'Castellano de España, tuteando al chat, sin emojis en la encuesta.';

const recortar = (t: unknown, max: number) => (typeof t === 'string' ? t.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Resumen, preguntas y encuesta de una noticia (Ollama). Lanza si la IA local no está. */
export async function preparar(n: Noticia): Promise<Preparado> {
  const r: any = await iaLocal.generarJson({
    sistema: SISTEMA,
    usuario: `Medio: ${n.fuente}\nTitular: ${n.titulo}\nEntradilla: ${n.resumen || '(no hay)'}`,
    esquema: ESQUEMA,
    temperatura: 0.6,
  });
  const preguntas = (Array.isArray(r?.preguntas) ? r.preguntas : []).map((p: unknown) => recortar(p, 200)).filter(Boolean).slice(0, 3);
  const opciones = (Array.isArray(r?.encuesta?.opciones) ? r.encuesta.opciones : []).map((o: unknown) => recortar(o, 60)).filter(Boolean).slice(0, 4);
  const p: Preparado = {
    resumen: recortar(r?.resumen, 600),
    preguntas,
    encuesta: { pregunta: recortar(r?.encuesta?.pregunta, 120), opciones },
  };
  if (!p.resumen || !p.preguntas.length) throw new iaLocal.ErrorIaLocal('La IA local no ha devuelto nada útil. Vuelve a probar.');
  preparados.set(n.id, p);
  // Si ya estaba en el guion, se guarda allí también.
  const g = leer();
  if (g.guion.some((x) => x.noticia.id === n.id)) guardar({ ...g, guion: g.guion.map((x) => (x.noticia.id === n.id ? { ...x, preparado: p } : x)) });
  return p;
}

const preparados = new Map<string, Preparado>();
export const preparadoDe = (id: string): Preparado | null => preparados.get(id) ?? leer().guion.find((g) => g.noticia.id === id)?.preparado ?? null;

// ---------------------------------------------------------------------------
// El guion del directo y el tema en pantalla (se guardan)
// ---------------------------------------------------------------------------

export interface EnGuion {
  noticia: Noticia;
  preparado: Preparado | null;
  /** Ya lo has comentado. */
  hecho: boolean;
}

export interface EstadoTemas {
  guion: EnGuion[];
  /** Lo que sale en la escena Charla: el titular y, si quieres, una pregunta para el chat. */
  pantalla: { titulo: string; fuente: string; pregunta: string | null } | null;
}

const CLAVE = 'temas';
const MAX_GUION = 25;
let actual: EstadoTemas | null = null;

export function leer(): EstadoTemas {
  if (actual) return actual;
  try {
    const f = getDb().prepare('SELECT valor FROM ajustes WHERE clave = ?').get(CLAVE) as { valor: string } | undefined;
    const v = f ? JSON.parse(f.valor) : null;
    actual = { guion: Array.isArray(v?.guion) ? v.guion.slice(0, MAX_GUION) : [], pantalla: v?.pantalla ?? null };
  } catch {
    actual = { guion: [], pantalla: null };
  }
  return actual;
}

function guardar(e: EstadoTemas): EstadoTemas {
  actual = e;
  try {
    getDb()
      .prepare('INSERT INTO ajustes (clave, valor, at) VALUES (?, ?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, at = excluded.at')
      .run(CLAVE, JSON.stringify(e), nowIso());
  } catch (err) {
    log.debug(`Temas sin guardar: ${String(err)}`);
  }
  return e;
}

/** Aparta un tema para el directo (al final del guion). */
export function apartar(id: string): EstadoTemas | null {
  const n = buscar(id);
  if (!n) return null;
  const e = leer();
  if (e.guion.some((g) => g.noticia.id === id)) return e;
  if (e.guion.length >= MAX_GUION) return null;
  return guardar({ ...e, guion: [...e.guion, { noticia: n, preparado: preparadoDe(id), hecho: false }] });
}

export function quitar(id: string): EstadoTemas {
  const e = leer();
  return guardar({ ...e, guion: e.guion.filter((g) => g.noticia.id !== id) });
}

export function marcarHecho(id: string, hecho: boolean): EstadoTemas {
  const e = leer();
  return guardar({ ...e, guion: e.guion.map((g) => (g.noticia.id === id ? { ...g, hecho } : g)) });
}

/** Sube o baja un tema en el guion. */
export function mover(id: string, paso: -1 | 1): EstadoTemas {
  const e = leer();
  const i = e.guion.findIndex((g) => g.noticia.id === id);
  const j = i + paso;
  if (i < 0 || j < 0 || j >= e.guion.length) return e;
  const g = [...e.guion];
  [g[i], g[j]] = [g[j]!, g[i]!];
  return guardar({ ...e, guion: g });
}

export function vaciarGuion(): EstadoTemas {
  return guardar({ ...leer(), guion: [] });
}

/** Pone un tema en la escena Charla (con una de sus preguntas, si quieres), o lo quita con null. */
export function ponerEnPantalla(id: string | null, pregunta: string | null = null): EstadoTemas | null {
  const e = leer();
  if (id === null) return guardar({ ...e, pantalla: null });
  const n = buscar(id);
  if (!n) return null;
  return guardar({ ...e, pantalla: { titulo: n.titulo, fuente: n.fuente, pregunta: recortar(pregunta, 200) || null } });
}

/** Solo para tests. */
export function reset(): void {
  actual = null;
  preparados.clear();
  ultimas = new Map();
  cache.clear();
}
