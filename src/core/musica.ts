import { randomBytes } from 'node:crypto';
import { open, readdir, stat, mkdir } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { getDb, nowIso } from '../data/db.js';
import { log } from './logger.js';
import { DIR_BIBLIOTECA, NOMBRE_CANCION } from '../panel/biblioteca.js';

/**
 * Música del directo (27 sep 2026): listas para cada momento (Empezamos,
 * Pausa, Final y de fondo mientras juegas) con música libre de derechos
 * (StreamBeats y parecidas). Nada de descargar de YouTube ni Spotify: en
 * Twitch la música con derechos trae avisos DMCA.
 *
 * Quien suena es la fuente de OBS `MUS Música` (biblioteca/overlays/musica.html):
 * pregunta aquí cada segundo qué toca y a qué volumen, y avisa cuando acaba
 * una canción. Aquí se decide todo lo demás: la lista, el orden (aleatorio,
 * sin repetir hasta acabar la lista), el volumen de cada lista y, en modo
 * automático, qué lista va con cada escena de OBS.
 *
 * Las canciones son los archivos de biblioteca/musica/<lista>/. Título y
 * artista salen de las etiquetas del mp3 (ID3) o, si no, del nombre del
 * archivo («Artista - Título.mp3»).
 */

export const LISTAS = ['inicio', 'pausa', 'final', 'fondo'] as const;
export type Lista = (typeof LISTAS)[number];
export const NOMBRES: Record<Lista, string> = { inicio: 'Empezamos', pausa: 'Pausa', final: 'Final', fondo: 'De fondo' };
export const esLista = (v: unknown): v is Lista => typeof v === 'string' && (LISTAS as readonly string[]).includes(v);

/** Lo que va con una escena de OBS: una lista o silencio. */
export type Destino = Lista | 'silencio';
const esDestino = (v: unknown): v is Destino => v === 'silencio' || esLista(v);

const EXTENSIONES = new Set(['.mp3', '.ogg', '.oga', '.opus', '.wav', '.m4a', '.aac', '.flac', '.webm']);

export interface Pista {
  /** 'lista/archivo': único y estable mientras no renombres el archivo. */
  id: string;
  lista: Lista;
  archivo: string;
  titulo: string;
  artista: string | null;
  url: string;
}

// ---------------------------------------------------------------------------
// Las canciones
// ---------------------------------------------------------------------------

export const carpeta = (dir = DIR_BIBLIOTECA) => join(dir, 'musica');

/** Lee un texto de un marco ID3v2 (TIT2, TPE1): latin1, UTF-16 con BOM o UTF-8. */
function textoId3(b: Buffer): string {
  const codif = b[0];
  const resto = b.subarray(1);
  let t: string;
  if (codif === 1 || codif === 2) {
    const le = codif === 1 ? !(resto[0] === 0xfe && resto[1] === 0xff) : false;
    const cuerpo = codif === 1 && ((resto[0] === 0xff && resto[1] === 0xfe) || (resto[0] === 0xfe && resto[1] === 0xff)) ? resto.subarray(2) : resto;
    const par = Buffer.from(cuerpo.subarray(0, cuerpo.length - (cuerpo.length % 2)));
    if (!le) par.swap16();
    t = par.toString('utf16le');
  } else {
    t = resto.toString(codif === 3 ? 'utf8' : 'latin1');
  }
  return t.replace(/\u0000.*$/s, '').trim();
}

/** Título y artista de las etiquetas ID3v2 de un mp3, si las tiene. Solo lee el principio del archivo. */
export async function etiquetas(ruta: string): Promise<{ titulo?: string; artista?: string }> {
  let fd;
  try {
    fd = await open(ruta, 'r');
    const cab = Buffer.alloc(10);
    await fd.read(cab, 0, 10, 0);
    if (cab.toString('latin1', 0, 3) !== 'ID3') return {};
    const version = cab[3]!;
    const tam = ((cab[6]! & 0x7f) << 21) | ((cab[7]! & 0x7f) << 14) | ((cab[8]! & 0x7f) << 7) | (cab[9]! & 0x7f);
    const datos = Buffer.alloc(Math.min(tam, 256 * 1024));
    await fd.read(datos, 0, datos.length, 10);
    const r: { titulo?: string; artista?: string } = {};
    for (let p = 0; p + 10 <= datos.length; ) {
      const id = datos.toString('latin1', p, p + 4);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const t = version === 4
        ? ((datos[p + 4]! & 0x7f) << 21) | ((datos[p + 5]! & 0x7f) << 14) | ((datos[p + 6]! & 0x7f) << 7) | (datos[p + 7]! & 0x7f)
        : datos.readUInt32BE(p + 4);
      if (t <= 0 || p + 10 + t > datos.length) break;
      if (id === 'TIT2') r.titulo = textoId3(datos.subarray(p + 10, p + 10 + t)) || undefined;
      if (id === 'TPE1') r.artista = textoId3(datos.subarray(p + 10, p + 10 + t)) || undefined;
      p += 10 + t;
    }
    return r;
  } catch {
    return {};
  } finally {
    await fd?.close();
  }
}

/** «Artista - Título.mp3» → las dos partes; si no hay guion, todo es el título. */
export function delNombre(archivo: string): { titulo: string; artista: string | null } {
  const sin = basename(archivo, extname(archivo)).replace(/_/g, ' ').replace(/^\d{1,3}[\s.-]+/, '').trim();
  const m = /^(.+?)\s+[-–]\s+(.+)$/.exec(sin);
  return m ? { artista: m[1]!.trim(), titulo: m[2]!.trim() } : { titulo: sin, artista: null };
}

let catalogo: Record<Lista, Pista[]> = { inicio: [], pausa: [], final: [], fondo: [] };
let leidoEn = 0;
let dirActual = DIR_BIBLIOTECA;

/** Solo para tests: otra biblioteca. */
export function usarDir(dir: string): void {
  dirActual = dir;
  leidoEn = 0;
}

/** Vuelve a leer las carpetas. Crea las que falten, para que sepas dónde van. */
export async function escanear(dir = dirActual): Promise<Record<Lista, Pista[]>> {
  const nuevo = { inicio: [], pausa: [], final: [], fondo: [] } as Record<Lista, Pista[]>;
  for (const lista of LISTAS) {
    const c = join(carpeta(dir), lista);
    await mkdir(c, { recursive: true }).catch(() => {});
    let nombres: string[] = [];
    try {
      nombres = await readdir(c);
    } catch {
      continue;
    }
    for (const archivo of nombres.sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))) {
      if (!EXTENSIONES.has(extname(archivo).toLowerCase()) || !NOMBRE_CANCION.test(archivo)) continue;
      const info = await stat(join(c, archivo)).catch(() => null);
      if (!info?.isFile()) continue;
      const id3 = extname(archivo).toLowerCase() === '.mp3' ? await etiquetas(join(c, archivo)) : {};
      const nombre = delNombre(archivo);
      nuevo[lista].push({
        id: `${lista}/${archivo}`, lista, archivo,
        titulo: id3.titulo ?? nombre.titulo,
        artista: id3.artista ?? nombre.artista,
        url: `/biblioteca/musica/${lista}/${encodeURIComponent(archivo)}`,
      });
    }
  }
  catalogo = nuevo;
  leidoEn = Date.now();
  return nuevo;
}

/**
 * Canciones sueltas en musica/, fuera de las cuatro carpetas: no suenan. El 27
 * sep las 30 de StreamBeats acabaron ahí y el panel decía que no había nada.
 */
export async function sueltas(dir = dirActual): Promise<number> {
  try {
    return (await readdir(carpeta(dir))).filter((a) => EXTENSIONES.has(extname(a).toLowerCase())).length;
  } catch {
    return 0;
  }
}

/** Las canciones, leídas hace menos de un minuto (si no, se vuelven a leer). */
export async function canciones(): Promise<Record<Lista, Pista[]>> {
  if (Date.now() - leidoEn > 60_000) await escanear();
  return catalogo;
}

// ---------------------------------------------------------------------------
// Ajustes (se guardan) y estado (solo en memoria: el directo de ahora)
// ---------------------------------------------------------------------------

export interface Ajustes {
  /** 'auto': la lista la decide la escena de OBS; 'manual': la eliges tú. */
  modo: 'auto' | 'manual';
  volumen: Record<Lista, number>;
  /** Escena de OBS → lo que suena en ella. Las que no estén: ESCENAS_POR_DEFECTO, y si no, `otras`. */
  mapa: Record<string, Destino>;
  /** Lo que suena en las escenas que no están en el mapa (las del juego). */
  otras: Destino;
  /** Un aviso pequeño («♪ título — artista») unos segundos al empezar cada canción, en las escenas del juego. */
  aviso: boolean;
}

/** Las escenas que crea el panel (Escenas → Crear en OBS). */
export const ESCENAS_POR_DEFECTO: Record<string, Destino> = {
  '✦ Empezamos': 'inicio', '✦ Pausa': 'pausa', '✦ Final': 'final', '✦ Charla': 'silencio',
};

const AJUSTES_POR_DEFECTO: Ajustes = {
  modo: 'auto',
  // La de fondo, baja: va debajo del juego y de tu voz.
  volumen: { inicio: 0.5, pausa: 0.45, final: 0.5, fondo: 0.2 },
  mapa: {},
  otras: 'fondo',
  aviso: true,
};

const CLAVE = 'musica';
let ajustes: Ajustes | null = null;

function limpiar(v: any): Ajustes {
  const a: Ajustes = { ...AJUSTES_POR_DEFECTO, volumen: { ...AJUSTES_POR_DEFECTO.volumen }, mapa: {} };
  if (!v || typeof v !== 'object') return a;
  if (v.modo === 'auto' || v.modo === 'manual') a.modo = v.modo;
  if (esDestino(v.otras)) a.otras = v.otras;
  if (typeof v.aviso === 'boolean') a.aviso = v.aviso;
  if (v.volumen && typeof v.volumen === 'object') {
    for (const l of LISTAS) if (typeof v.volumen[l] === 'number' && Number.isFinite(v.volumen[l])) a.volumen[l] = Math.min(1, Math.max(0, v.volumen[l]));
  }
  if (v.mapa && typeof v.mapa === 'object') {
    for (const [k, d] of Object.entries(v.mapa).slice(0, 100)) if (typeof k === 'string' && k.length <= 200 && esDestino(d)) a.mapa[k] = d;
  }
  return a;
}

export function leerAjustes(): Ajustes {
  if (ajustes) return ajustes;
  try {
    const f = getDb().prepare('SELECT valor FROM ajustes WHERE clave = ?').get(CLAVE) as { valor: string } | undefined;
    ajustes = limpiar(f ? JSON.parse(f.valor) : null);
  } catch {
    ajustes = limpiar(null);
  }
  return ajustes;
}

/** Cambia lo que venga (modo, volumen de una lista, una escena del mapa, `otras`) y lo guarda. */
export function cambiarAjustes(cambios: any): Ajustes {
  const antes = leerAjustes();
  const c = cambios && typeof cambios === 'object' ? cambios : {};
  ajustes = limpiar({
    ...antes, ...c,
    volumen: { ...antes.volumen, ...(c.volumen ?? {}) },
    mapa: { ...antes.mapa, ...(c.mapa ?? {}) },
  });
  try {
    getDb()
      .prepare('INSERT INTO ajustes (clave, valor, at) VALUES (?, ?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, at = excluded.at')
      .run(CLAVE, JSON.stringify(ajustes), nowIso());
  } catch (err) {
    log.debug(`Música sin guardar: ${String(err)}`);
  }
  // En automático, un cambio del mapa puede cambiar lo que toca ahora mismo.
  if (ajustes.modo === 'auto' && escenaObs !== null) void alCambiarEscena(escenaObs, true);
  return ajustes;
}

/** Lo que suena en una escena de OBS según los ajustes. */
export function destinoDe(escena: string, a = leerAjustes()): Destino {
  return a.mapa[escena] ?? ESCENAS_POR_DEFECTO[escena] ?? a.otras;
}

let lista: Lista | null = null;
let sonando = false;
let pista: Pista | null = null;
/** Sube con cada cambio pedido: el overlay sabe así que tiene que cambiar aunque sea la misma canción. */
let turno = 0;
let escenaObs: string | null = null;
/** El orden de cada lista: se baraja y se va gastando; al acabar, se vuelve a barajar. */
const colas: Record<Lista, string[]> = { inicio: [], pausa: [], final: [], fondo: [] };
const historial: Pista[] = [];
/** Lo que cuenta el overlay: por dónde va y cuánto dura. */
let progreso: { id: string; pos: number; dur: number; at: number } | null = null;
let ultimaVozOverlay = 0;

function barajar<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** La siguiente de una lista, sin repetir hasta haberlas oído todas (ni la que acaba de sonar). */
async function siguienteDe(l: Lista): Promise<Pista | null> {
  const todas = (await canciones())[l];
  if (!todas.length) return null;
  const ids = new Set(todas.map((p) => p.id));
  colas[l] = colas[l].filter((id) => ids.has(id));
  if (!colas[l].length) {
    colas[l] = barajar(todas.map((p) => p.id));
    if (colas[l].length > 1 && colas[l][0] === pista?.id) colas[l].push(colas[l].shift()!);
  }
  const id = colas[l].shift()!;
  return todas.find((p) => p.id === id) ?? null;
}

function poner(p: Pista | null): void {
  if (pista) historial.push(pista);
  if (historial.length > 30) historial.shift();
  pista = p;
  progreso = null;
  turno++;
  if (p) log.info(`Música: ${p.artista ? `${p.artista} — ` : ''}${p.titulo} (${NOMBRES[p.lista]})`);
}

// ---------------------------------------------------------------------------
// Lo que se pide desde el panel, el chat y el overlay
// ---------------------------------------------------------------------------

/** Pone una lista (empieza con una canción al azar). Sin canciones, se queda en silencio. */
export async function ponerLista(l: Lista): Promise<void> {
  lista = l;
  const p = await siguienteDe(l);
  poner(p);
  sonando = p !== null;
}

/** Una canción concreta, ya. */
export async function ponerPista(id: string): Promise<boolean> {
  const l = id.split('/')[0];
  if (!esLista(l)) return false;
  const p = (await canciones())[l].find((x) => x.id === id);
  if (!p) return false;
  lista = l;
  poner(p);
  sonando = true;
  return true;
}

export async function siguiente(): Promise<void> {
  if (!lista) return;
  poner(await siguienteDe(lista));
  sonando = pista !== null;
}

export async function anterior(): Promise<void> {
  const p = historial.pop();
  if (!p) return;
  if (pista) colas[pista.lista].unshift(pista.id);
  pista = p;
  lista = p.lista;
  progreso = null;
  turno++;
  sonando = true;
}

export function pausar(): void {
  sonando = false;
}

export async function reanudar(): Promise<void> {
  if (!pista) {
    if (lista) await ponerLista(lista);
    return;
  }
  sonando = true;
}

/** El overlay dice que una canción ha acabado (o no se pudo leer): la siguiente. Solo cuenta si es la que sonaba. */
export async function terminada(id: string, esperado = turno): Promise<void> {
  if (!sonando || !pista || pista.id !== id || !lista || esperado !== turno) return;
  const reserva = ++turno;
  const nueva = await siguienteDe(lista);
  if (turno !== reserva) return;
  poner(nueva);
  sonando = pista !== null;
}

export function informarProgreso(id: string, pos: number, dur: number, esperado = turno): void {
  if (esperado !== turno || pista?.id !== id || !Number.isFinite(pos) || !Number.isFinite(dur) || pos < 0 || dur <= 0 || pos > dur) return;
  ultimaVozOverlay = Date.now();
  if (pista?.id === id && Number.isFinite(pos) && Number.isFinite(dur)) progreso = { id, pos, dur, at: Date.now() };
}

/**
 * La escena de OBS en emisión (la pregunta el servidor cada pocos segundos).
 * En automático cambia de lista, o calla, según el mapa. Pasar a la misma
 * lista no corta la canción que suena.
 */
export async function alCambiarEscena(escena: string, forzar = false): Promise<void> {
  const cambio = escena !== escenaObs;
  escenaObs = escena;
  if (leerAjustes().modo !== 'auto' || (!cambio && !forzar)) return;
  const d = destinoDe(escena);
  if (d === 'silencio') {
    if (sonando) log.info(`Música: silencio en «${escena}»`);
    sonando = false;
    return;
  }
  if (d === lista && pista) {
    sonando = true;
    return;
  }
  await ponerLista(d);
}

/** Cambiar a automático aplica ya la escena en la que estás. */
export async function ponerModo(modo: 'auto' | 'manual'): Promise<Ajustes> {
  const a = cambiarAjustes({ modo });
  if (modo === 'auto' && escenaObs) await alCambiarEscena(escenaObs, true);
  return a;
}

/** Lo que el overlay necesita para sonar (y para el aviso de canción, que en las escenas del panel ya enseñan ellas). */
export function paraOverlay() {
  const a = leerAjustes();
  const v = lista ? a.volumen[lista] : 0.4;
  const enEscenaDelPanel = escenaObs !== null && escenaObs in ESCENAS_POR_DEFECTO;
  return { sonando: sonando && pista !== null, pista, volumen: v, turno, aviso: a.aviso && !enEscenaDelPanel };
}

/** ¿Está la fuente de OBS pidiendo? (si no, no hace falta preguntar a OBS por la escena). */
/**
 * La credencial con la que el reproductor (musica.html) avisa al bot. Se
 * guarda: si cambiara en cada arranque, la fuente de OBS (que no se apaga ni
 * se recarga sola) seguiría con la vieja, el bot rechazaría sus avisos y la
 * música se pararía al acabar la primera canción tras reiniciar el bot.
 */
let credencial: string | null = null;
/** Solo para tests: como si el bot arrancara de nuevo (la guardada sigue en la base de datos). */
export function olvidarCredencial(): void {
  credencial = null;
}
export function credencialReproductor(): string {
  if (credencial) return credencial;
  const CLAVE_CREDENCIAL = 'musica-credencial';
  try {
    const f = getDb().prepare('SELECT valor FROM ajustes WHERE clave = ?').get(CLAVE_CREDENCIAL) as { valor: string } | undefined;
    const guardada = f ? JSON.parse(f.valor) : null;
    if (typeof guardada === 'string' && /^[a-f0-9]{64}$/.test(guardada)) return (credencial = guardada);
  } catch { /* sin base de datos: una nueva, solo para esta sesión */ }
  credencial = randomBytes(32).toString('hex');
  try {
    getDb()
      .prepare('INSERT INTO ajustes (clave, valor, at) VALUES (?, ?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, at = excluded.at')
      .run(CLAVE_CREDENCIAL, JSON.stringify(credencial), nowIso());
  } catch (err) {
    log.debug(`Credencial de la música sin guardar: ${String(err)}`);
  }
  return credencial;
}

/**
 * El reproductor ha preguntado: está abierto en OBS. Codex (27 sep) quitó esto
 * de paraOverlay() al separar consulta y control, y entonces solo contaba
 * mientras sonaba algo: en automático, sin música aún, el vigilante de escenas
 * no arrancaba nunca la lista de Empezamos. Preguntar no cambia nada más.
 */
export function overlayVisto(): void {
  ultimaVozOverlay = Date.now();
}

export const overlayActivo = () => Date.now() - ultimaVozOverlay < 15_000;

/** Para el panel y para !cancion. */
export function estado() {
  const a = leerAjustes();
  return {
    sonando: sonando && pista !== null,
    lista,
    pista,
    // Entre aviso y aviso del overlay (cada 3 s) se calcula; nunca más allá del final.
    progreso: progreso && pista && progreso.id === pista.id
      ? { pos: Math.min(progreso.dur, progreso.pos + (sonando && overlayActivo() ? Math.min(5, (Date.now() - progreso.at) / 1000) : 0)), dur: progreso.dur }
      : null,
    escenaObs,
    destino: escenaObs ? destinoDe(escenaObs, a) : null,
    overlay: overlayActivo(),
    ajustes: a,
  };
}

/** Solo para tests. */
export function reset(): void {
  ajustes = null;
  lista = null;
  sonando = false;
  pista = null;
  turno = 0;
  escenaObs = null;
  progreso = null;
  ultimaVozOverlay = 0;
  historial.length = 0;
  for (const l of LISTAS) colas[l] = [];
  catalogo = { inicio: [], pausa: [], final: [], fondo: [] };
  leidoEn = 0;
}
