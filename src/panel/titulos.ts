import { getDb, nowIso } from '../data/db.js';
import * as lootDb from '../data/loot.js';
import { generarJson } from '../services/ia-local.js';

/**
 * Sugerencias de título para el directo (panel → Títulos, 26 sep 2026).
 *
 * Las escribe la IA local (Ollama): gratis y fuera del directo. Todo son
 * SUGERENCIAS: nada se conecta a Twitch ni a redes. Tú copias lo que te guste.
 *
 * Además de los títulos, un anuncio corto para redes o Discord y etiquetas
 * para Twitch. La categoría no la inventa la IA: es el juego que escribes.
 */

/** Límites de Twitch. */
export const MAX_TITULO = 140;
const MAX_ETIQUETA = 25;
const MAX_ETIQUETAS = 10;

export const SESIONES = ['Raid', 'Mazmorras', 'Farmeo', 'Subir de nivel', 'PvP', 'Evento del juego', 'Primera vez', 'Just Chatting'] as const;
export const TONOS = ['Natural', 'Épico', 'Gracioso', 'Misterioso', 'Tranquilo', 'Competitivo'] as const;

export interface Peticion {
  juego: string;
  sesion: string;
  tono: string;
  /** Lo que quieras añadir: «vuelvo tras una semana», «jefe final»… */
  notas?: string;
  /** Usar lo que ha pasado en el minijuego del chat (jefes, legendarios…). */
  conCanal?: boolean;
  /** Emojis por título, de 0 a 3. Por defecto, 0. */
  emojis?: number;
}

export interface Sugerencia {
  /** `delChat`: menciona algo del minijuego del chat. */
  titulos: Array<{ id: number; texto: string; delChat: boolean }>;
  anuncio: string;
  categoria: string;
  etiquetas: string[];
  /** Lo que se le contó a la IA del canal, para enseñarlo en el panel. */
  contexto: string[];
}

// ---------------------------------------------------------------------------
// Lo que ha pasado en el canal (el minijuego del chat)
// ---------------------------------------------------------------------------

/**
 * Hechos de la última semana en el minijuego del chat, en frases cortas.
 * Se le dicen a la IA como del MINIJUEGO: la primera prueba confundió «la
 * Araña Reina» con un jefe de World of Warcraft.
 */
export function contextoCanal(dias = 7): string[] {
  const db = getDb();
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
  const hechos: string[] = [];

  // Jefes derrotados: el registro los apunta en el ataque que los tumba.
  const jefes = db
    .prepare(`SELECT detail FROM interactions WHERE at >= ? AND detail LIKE '%derrotado%' ORDER BY id DESC LIMIT 5`)
    .all(desde) as Array<{ detail: string }>;
  for (const { detail } of jefes) {
    const m = /derrotado,?\s+(.+?):\s*([\w-]+)=(\d+)/.exec(detail);
    if (m) hechos.push(`el chat derrotó ${alJefe(m[1]!)} (el que más pegó: ${m[2]})`);
  }

  const legendarios = db
    .prepare(`SELECT display_name, objeto FROM loot WHERE at >= ? AND rareza = 'legendario' ORDER BY id DESC LIMIT 3`)
    .all(desde) as Array<{ display_name: string; objeto: string }>;
  for (const l of legendarios) hechos.push(`${l.display_name} consiguió el objeto legendario «${l.objeto}»`);

  const [lider] = lootDb.mochilas(1);
  if (lider) hechos.push(`${lider.display_name} es quien más poder tiene (${lider.poder})`);

  const racha = db
    .prepare('SELECT u.display_name AS nombre, s.current AS racha FROM streaks s JOIN users u ON u.twitch_id = s.twitch_id WHERE s.current >= 3 ORDER BY s.current DESC LIMIT 1')
    .get() as { nombre: string; racha: number } | undefined;
  if (racha) hechos.push(`${racha.nombre} lleva ${racha.racha} directos seguidos`);

  return [...new Set(hechos)].slice(0, 6);
}

/** «a el Lag Primigenio» → «al Lag Primigenio». */
const alJefe = (nombre: string) => (/^el /i.test(nombre) ? `al ${nombre.slice(3)}` : `a ${nombre}`);

// ---------------------------------------------------------------------------
// Limpiar lo que devuelve la IA
// ---------------------------------------------------------------------------

/** Sin comillas alrededor, sin espacios dobles, y dentro del límite de Twitch. */
export function limpiarTitulo(t: string, maxEmojis = 3): string | null {
  const limpio = recortarEmojis(t, maxEmojis).replace(/^["'«“\s]+|["'»”\s]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!limpio || limpio.length > MAX_TITULO) return null;
  return limpio;
}

// ---------------------------------------------------------------------------
// Emojis
// ---------------------------------------------------------------------------

/**
 * En el título de Twitch NO se ven los emotes de Twitch (PogChamp, KEKW): se
 * vería el texto tal cual. Se ven los emojis, y son lo que hace destacar un
 * título en la lista de directos. Estos son los que más se ven en títulos de
 * Twitch en español, por tono; la IA elige de aquí.
 */
export const EMOJIS: Record<string, string[]> = {
  base: ['🔴', '🔥', '‼️', '✨', '🎮'],
  'Épico': ['⚔️', '🛡️', '🐉', '👑', '🏆', '💥', '🔥'],
  Gracioso: ['😂', '🤣', '💀', '🤡', '🫠', '😭', '🙃'],
  Misterioso: ['👀', '🌙', '🔮', '🕯️', '🗝️', '❓'],
  Tranquilo: ['☕', '🌿', '🎧', '🌙', '✨', '🍵'],
  Competitivo: ['🏆', '⚡', '🎯', '💪', '🥇', '🔥'],
};

const segmentos = new Intl.Segmenter('es', { granularity: 'grapheme' });
const esEmoji = (g: string) => /\p{Extended_Pictographic}/u.test(g);

/** Cuántos emojis lleva (⚔️ o 🧙‍♂️ cuentan como uno). */
export function contarEmojis(t: string): number {
  let n = 0;
  for (const { segment } of segmentos.segment(t)) if (esEmoji(segment)) n++;
  return n;
}

/** Deja los primeros `max` emojis y quita el resto. */
export function recortarEmojis(t: string, max: number): string {
  let n = 0;
  let salida = '';
  for (const { segment } of segmentos.segment(t)) {
    if (esEmoji(segment) && ++n > max) continue;
    salida += segment;
  }
  return salida;
}

function reglaEmojis(n: number, tono: string): string {
  if (n <= 0) return 'Sin emojis.';
  const paleta = [...new Set([...(EMOJIS[tono] ?? []), ...EMOJIS.base!])].join(' ');
  return `Cada título lleva exactamente ${n} emoji${n === 1 ? '' : 's'}, al principio o al final, elegidos de estos ` +
    `(los que más llaman la atención en Twitch para este tono): ${paleta}. No repitas la misma combinación en dos títulos seguidos.`;
}

/** Etiquetas de Twitch: una palabra, letras y números, hasta 25 caracteres, 10 como mucho. */
export function limpiarEtiquetas(lista: unknown): string[] {
  if (!Array.isArray(lista)) return [];
  const vistas = new Set<string>();
  const salida: string[] = [];
  for (const e of lista) {
    if (typeof e !== 'string') continue;
    const limpia = e.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, MAX_ETIQUETA);
    if (!limpia || vistas.has(limpia.toLowerCase())) continue;
    vistas.add(limpia.toLowerCase());
    salida.push(limpia);
    if (salida.length === MAX_ETIQUETAS) break;
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Generar
// ---------------------------------------------------------------------------

/**
 * Dos peticiones y no una (26 sep 2026). Con lo del chat en la misma
 * petición, la IA lo metía en todos los títulos aunque se le pidiera que no:
 * los del juego se piden SIN contarle nada del chat, y los del chat, aparte.
 */
const ESQUEMA_JUEGO = {
  type: 'object',
  properties: {
    titulos: { type: 'array', items: { type: 'string' } },
    anuncio: { type: 'string' },
    etiquetas: { type: 'array', items: { type: 'string' } },
  },
  required: ['titulos', 'anuncio', 'etiquetas'],
};
const ESQUEMA_CHAT = {
  type: 'object',
  properties: { titulos: { type: 'array', items: { type: 'string' } } },
  required: ['titulos'],
};

const ESTILO =
  'Escribes títulos de Twitch en español de España para un público adulto. Voz natural, directa y con personalidad. ' +
  'Prioriza qué se va a hacer hoy y los detalles de las notas. Entre 25 y 90 caracteres cuando sea posible, sin rellenar para llegar al mínimo. ' +
  'Nada de lenguaje infantil, diminutivos forzados, chistes aleatorios, rimas ni entusiasmo de anuncio. ' +
  'Evita clichés como «aventura épica», «leyendas», «a conquistar», «que comience la batalla», «risas aseguradas» o «no te lo pierdas». ' +
  'El humor nace de la situación: ironía seca o autocrítica leve, sin convertir cada título en un chiste ni insultar al público. ' +
  'Sin hashtags en los títulos, sin mayúsculas de reclamo ni exclamaciones de relleno. Mayúsculas solo al principio y en nombres propios. ' +
  'No inventes raids, jefes, zonas, rangos, derrotas previas, logros, horarios ni objetivos que no están en los datos. ' +
  'Si faltan detalles, usa la actividad indicada; no finjas una historia. No prometas victorias, premios ni resultados. ' +
  'Cada propuesta debe aportar una idea o enfoque distinto, no cambiar dos palabras de la anterior. ' +
  'Ejemplos de registro, solo si encajan con los datos: «Farmeo y charla, sin prisa», «Primera vez en Lineage 2», ' +
  '«PvP: hoy toca afinar», «Volvemos después de una semana». No copies estos ejemplos por defecto. ' +
  'Antes de responder, revisa y reescribe las propuestas genéricas, infantiles o basadas en hechos inventados. Responde solo con el JSON pedido.';

const MATICES: Record<string, string> = {
  Natural: 'Como lo escribiría el streamer: claro, cercano, sin adornos ni bromas obligatorias.',
  Épico: 'Intensidad contenida y centrada en el objetivo real; sin narrador de fantasía ni grandilocuencia.',
  Gracioso: 'Humor seco y observacional sobre la actividad; sin chistes infantiles, memes metidos a la fuerza ni inventar desastres.',
  Misterioso: 'Curiosidad a partir de un detalle real de las notas; sin secretos inventados ni clickbait.',
  Tranquilo: 'Conversacional y relajado; sin cursilería ni diminutivos.',
  Competitivo: 'Preciso y centrado en mejorar o competir; sin fanfarronería ni prometer ganar.',
};

const SISTEMA = `Escribes los títulos de Crid4m, un streamer de MMOs. ${ESTILO}`;

const SISTEMA_CHAT =
  `Eres el guionista de Crid4m, un canal de Twitch en español de España que juega a MMOs. ${ESTILO} ` +
  'El canal tiene un MINIJUEGO en el chat (cofres de botín, jefes que el chat derrota con !atacar, duelos). Sus jefes y objetos NO son del juego: ' +
  'cuando los menciones, que quede claro que es cosa del chat.';

export async function sugerir(p: Peticion): Promise<Sugerencia> {
  const juego = p.juego.trim();
  const contexto = p.conCanal ? contextoCanal() : [];
  // Para no repetirse: lo que ya usaste o marcaste con la estrella.
  const ya = (getDb()
    .prepare('SELECT texto FROM titulos WHERE favorito = 1 OR usado_at IS NOT NULL ORDER BY COALESCE(usado_at, at) DESC LIMIT 12')
    .all() as Array<{ texto: string }>).map((t) => t.texto);

  const emojis = Math.max(0, Math.min(3, Math.round(p.emojis ?? 0)));
  const sesion = [
    `Juego: ${juego || 'sin decir'}.`,
    `Sesión: ${p.sesion}.`,
    `Tono: ${p.tono}. ${MATICES[p.tono] ?? MATICES.Natural}`,
    reglaEmojis(emojis, p.tono),
    p.notas?.trim() ? `Notas de Crid4m: ${p.notas.trim()}.` : '',
    ya.length ? `Títulos que ya usó: no los repitas ni los copies: ${ya.map((t) => `«${t}»`).join(', ')}.` : '',
  ].filter(Boolean);

  // 1. Los del juego: sin nada del chat a la vista.
  const r = (await generarJson({
    sistema: SISTEMA,
    usuario: [...sesion,
      `Dame 10 títulos distintos sobre esta sesión en ${juego || 'el juego'}, un anuncio corto para redes o Discord ` +
      '(máximo 200 caracteres, puede llevar 2-3 hashtags) y 6 etiquetas de Twitch (una palabra cada una, sin espacios ni #).',
    ].join('\n'),
    esquema: ESQUEMA_JUEGO,
    temperatura: 0.75,
  })) as { titulos?: unknown; anuncio?: unknown; etiquetas?: unknown };

  // 2. Los del chat, aparte y solo si hay algo que contar.
  let delChat: unknown = [];
  if (contexto.length) {
    const c = (await generarJson({
      sistema: SISTEMA_CHAT,
      usuario: [...sesion,
        `Lo que ha pasado esta semana en el minijuego del chat: ${contexto.join('; ')}.`,
        'Dame 3 títulos que mezclen la sesión en el juego con algo de lo que ha pasado en el minijuego del chat.',
      ].join('\n'),
      esquema: ESQUEMA_CHAT,
      temperatura: 0.75,
    })) as { titulos?: unknown };
    delChat = c.titulos;
  }

  const vistos = new Set(ya.map((t) => t.toLowerCase()));
  const textos: Array<{ texto: string; delChat: boolean }> = [];
  const recoger = (lista: unknown, esDelChat: boolean, max: number) => {
    let n = 0;
    for (const t of Array.isArray(lista) ? lista : []) {
      const limpio = typeof t === 'string' ? limpiarTitulo(t, emojis) : null;
      if (!limpio || vistos.has(limpio.toLowerCase()) || n >= max) continue;
      vistos.add(limpio.toLowerCase());
      textos.push({ texto: limpio, delChat: esDelChat });
      n++;
    }
  };
  recoger(r.titulos, false, 10);
  recoger(delChat, true, 3);
  if (!textos.length) throw new Error('La IA no ha devuelto ningún título que sirva. Vuelve a probar.');

  const db = getDb();
  const insertar = db.prepare('INSERT INTO titulos (texto, juego, sesion, at) VALUES (?, ?, ?, ?)');
  const at = nowIso();
  const titulos = textos.map((t) => ({ id: Number(insertar.run(t.texto, juego, p.sesion, at).lastInsertRowid), ...t }));

  return {
    titulos,
    anuncio: typeof r.anuncio === 'string' ? r.anuncio.trim().slice(0, 280) : '',
    categoria: juego || (p.sesion === 'Just Chatting' ? 'Just Chatting' : ''),
    etiquetas: limpiarEtiquetas(r.etiquetas),
    contexto,
  };
}

// ---------------------------------------------------------------------------
// Favoritos e historial
// ---------------------------------------------------------------------------

export interface FilaTitulo { id: number; texto: string; juego: string; sesion: string; at: string; favorito: number; usado_at: string | null }

export function marcar(id: number, { favorito, usado }: { favorito?: boolean; usado?: boolean }): void {
  const db = getDb();
  if (favorito !== undefined) db.prepare('UPDATE titulos SET favorito = ? WHERE id = ?').run(favorito ? 1 : 0, id);
  if (usado) db.prepare('UPDATE titulos SET usado_at = ? WHERE id = ?').run(nowIso(), id);
}

export function listado() {
  const db = getDb();
  const favoritos = db.prepare('SELECT * FROM titulos WHERE favorito = 1 ORDER BY id DESC LIMIT 50').all() as unknown as FilaTitulo[];
  const usados = db.prepare('SELECT * FROM titulos WHERE usado_at IS NOT NULL ORDER BY usado_at DESC LIMIT 15').all() as unknown as FilaTitulo[];
  const juegos = (db.prepare("SELECT juego FROM titulos WHERE juego != '' GROUP BY juego ORDER BY MAX(id) DESC LIMIT 10").all() as Array<{ juego: string }>).map((j) => j.juego);
  return { favoritos, usados, juegos, sesiones: SESIONES, tonos: TONOS };
}

/** Limpieza: las sugerencias que no marcaste ni usaste, de hace más de 30 días. */
export function podar(): void {
  getDb().prepare("DELETE FROM titulos WHERE favorito = 0 AND usado_at IS NULL AND at < ?").run(new Date(Date.now() - 30 * 86_400_000).toISOString());
}
