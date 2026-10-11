import type { Dirent } from 'node:fs';
import { open, readdir, readFile, rmdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Bocetos y ejemplos (11 oct 2026): lo que hay en `docs/previews/`. Capturas,
 * pruebas de diseño, candidatos de sonido… El panel (Biblioteca → Bocetos) los
 * enseña todos, dice dónde se citan y deja borrarlos de uno en uno o en grupo.
 *
 * Borrar no es definitivo: va a la Papelera de Windows. Solo dentro de
 * `docs/previews/`, solo archivos y sin `..`, carpetas ni nombres ocultos.
 */

export const DIR_BOCETOS = fileURLToPath(new URL('../../docs/previews/', import.meta.url));
const RAIZ = fileURLToPath(new URL('../../', import.meta.url));

export type Clase = 'imagen' | 'escena' | 'pagina' | 'audio' | 'texto' | 'otro';

const TIPOS: Record<string, { clase: Clase; mime: string }> = {
  '.png': { clase: 'imagen', mime: 'image/png' },
  '.jpg': { clase: 'imagen', mime: 'image/jpeg' },
  '.jpeg': { clase: 'imagen', mime: 'image/jpeg' },
  '.webp': { clase: 'imagen', mime: 'image/webp' },
  '.gif': { clase: 'imagen', mime: 'image/gif' },
  '.html': { clase: 'pagina', mime: 'text/html; charset=utf-8' },
  '.mp3': { clase: 'audio', mime: 'audio/mpeg' },
  '.wav': { clase: 'audio', mime: 'audio/wav' },
  '.ogg': { clase: 'audio', mime: 'audio/ogg' },
  '.md': { clase: 'texto', mime: 'text/plain; charset=utf-8' },
  '.txt': { clase: 'texto', mime: 'text/plain; charset=utf-8' },
  '.json': { clase: 'texto', mime: 'text/plain; charset=utf-8' },
  '.jsonl': { clase: 'texto', mime: 'text/plain; charset=utf-8' },
};

export interface Boceto {
  /** Ruta dentro de docs/previews, con barras normales: «alertas/arte-generado/x.png». */
  ruta: string;
  carpeta: string;
  nombre: string;
  /** escena = overlay de 1920×1080 fijo (se ve encogido); pagina = web normal. */
  clase: Clase;
  bytes: number;
  modificado: string;
  /** Documentos o código que lo nombran (fuera de sí mismo). Vacío = nadie lo cita. */
  citadoEn: string[];
}

const PROFUNDIDAD = 6;

/** La ruta absoluta de un boceto, o null si se sale de la carpeta o no es un tipo conocido. */
export function resolver(ruta: string, dir = DIR_BOCETOS): { ruta: string; mime: string } | null {
  if (typeof ruta !== 'string' || ruta.length > 400) return null;
  let partes: string[];
  try {
    partes = ruta.split('/').map((p) => decodeURIComponent(p));
  } catch {
    return null;
  }
  if (!partes.length || partes.length > PROFUNDIDAD) return null;
  // Nada de «..», ocultos, barras invertidas ni caracteres que Windows no admite.
  if (partes.some((p) => !p || p.startsWith('.') || /[\\:*?"<>|\u0000-\u001f]/.test(p))) return null;
  const tipo = TIPOS[extname(partes.at(-1)!).toLowerCase()];
  if (!tipo) return null;
  const abs = resolve(dir, ...partes);
  if (!abs.startsWith(resolve(dir) + sep)) return null;
  return { ruta: abs, mime: tipo.mime };
}

async function recorrer(dir: string, base: string, nivel = 0): Promise<string[]> {
  if (nivel >= PROFUNDIDAD) return [];
  const entradas = await readdir(dir, { withFileTypes: true }).catch(() => [] as Dirent[]);
  const hijos = await Promise.all(entradas.filter((e) => !e.name.startsWith('.')).map(async (e) => {
    const abs = join(dir, e.name);
    if (e.isDirectory()) return recorrer(abs, base, nivel + 1);
    return e.isFile() && TIPOS[extname(e.name).toLowerCase()] ? [abs] : [];
  }));
  return hijos.flat();
}

/** Un overlay a 1920×1080 fijo se ve encogido entero; una página normal, como web. */
async function claseHtml(abs: string): Promise<Clase> {
  const f = await open(abs, 'r').catch(() => null);
  if (!f) return 'pagina';
  try {
    const { buffer, bytesRead } = await f.read(Buffer.alloc(6000), 0, 6000, 0);
    const inicio = buffer.subarray(0, bytesRead).toString('utf8');
    return /width\s*[:=]\s*1920(px)?\b/.test(inicio) ? 'escena' : 'pagina';
  } finally {
    await f.close();
  }
}

/** Dónde buscar si alguien nombra un boceto: documentación, código y overlays. */
const DONDE_SE_CITA: { dir: string; ext: RegExp }[] = [
  { dir: 'docs', ext: /\.(md|html|mjs|mts|js|json)$/i },
  { dir: 'src', ext: /\.(ts|js|html|css)$/i },
  { dir: 'biblioteca/overlays', ext: /\.html$/i },
  { dir: 'scripts', ext: /\.(mjs|ts|js|py|ps1)$/i },
];

async function textosQueCitan(raiz: string): Promise<{ ruta: string; texto: string }[]> {
  const salida: { ruta: string; texto: string }[] = [];
  const leer = async (dir: string, ext: RegExp, nivel = 0): Promise<void> => {
    if (nivel > 8) return;
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [] as Dirent[])) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const abs = join(dir, e.name);
      if (e.isDirectory()) await leer(abs, ext, nivel + 1);
      else if (ext.test(e.name)) {
        const texto = await readFile(abs, 'utf8').catch(() => '');
        if (texto) salida.push({ ruta: relative(raiz, abs).split(sep).join('/'), texto });
      }
    }
  };
  for (const d of DONDE_SE_CITA) await leer(join(raiz, d.dir), d.ext);
  return salida;
}

export async function listar(dir = DIR_BOCETOS, raiz = RAIZ): Promise<{ bocetos: Boceto[]; bytes: number }> {
  const archivos = await recorrer(dir, dir);
  const textos = await textosQueCitan(raiz);
  const bocetos = await Promise.all(archivos.map(async (abs): Promise<Boceto> => {
    const ruta = relative(dir, abs).split(sep).join('/');
    const nombre = basename(abs);
    const st = await stat(abs);
    const propia = relative(raiz, abs).split(sep).join('/');
    let clase = TIPOS[extname(nombre).toLowerCase()]!.clase;
    if (clase === 'pagina') clase = await claseHtml(abs);
    // Con su carpeta («mmo/calma.png»): un nombre suelto como «calma.png» saldría en
    // cualquier sitio. Solo desde su misma carpeta (un README, un boceto vecino)
    // basta el nombre.
    const conCarpeta = `${basename(dirname(abs))}/${nombre}`;
    const suCarpeta = dirname(propia);
    const cita = (t: { ruta: string; texto: string }) => t.texto.includes(conCarpeta) || (dirname(t.ruta) === suCarpeta && t.texto.includes(nombre));
    return {
      ruta,
      carpeta: dirname(ruta) === '.' ? '' : dirname(ruta),
      nombre,
      clase,
      bytes: st.size,
      modificado: st.mtime.toISOString(),
      citadoEn: textos.filter((t) => t.ruta !== propia && cita(t)).map((t) => t.ruta),
    };
  }));
  bocetos.sort((a, b) => a.carpeta.localeCompare(b.carpeta, 'es') || a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
  return { bocetos, bytes: bocetos.reduce((n, b) => n + b.bytes, 0) };
}

// ---------------------------------------------------------------------------
// Borrar: a la Papelera de Windows
// ---------------------------------------------------------------------------

type Papelera = (rutas: string[]) => Promise<void>;

/** Manda archivos a la Papelera con la API de Windows (se pueden recuperar). */
const papeleraWindows: Papelera = async (rutas) => {
  // De 40 en 40: la línea de órdenes tiene un límite de longitud.
  for (let i = 0; i < rutas.length; i += 40) {
    const lista = rutas.slice(i, i + 40).map((r) => `'${r.replaceAll("'", "''")}'`).join(',');
    const orden = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName Microsoft.VisualBasic; foreach ($p in @(${lista})) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }`;
    await new Promise<void>((ok, ko) => {
      const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(orden, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let error = '';
      ps.stderr.on('data', (d) => { error += String(d); });
      ps.on('error', ko);
      ps.on('close', (codigo) => (codigo === 0 ? ok() : ko(new Error(error.trim().split('\n')[0] || `PowerShell terminó con ${codigo}`))));
    });
  }
};

let papelera: Papelera = papeleraWindows;
/** Solo para tests: otra papelera (null = la de Windows). */
export function setPapelera(fn: Papelera | null): void {
  papelera = fn ?? papeleraWindows;
}

const existe = (abs: string) => stat(abs).then((s) => s.isFile(), () => false);

export async function borrar(rutas: unknown, dir = DIR_BOCETOS): Promise<{ borrados: string[]; fallos: { ruta: string; error: string }[] }> {
  if (!Array.isArray(rutas) || !rutas.length || rutas.length > 500) throw new Error('elige entre 1 y 500 archivos');
  const fallos: { ruta: string; error: string }[] = [];
  const validos: { ruta: string; abs: string }[] = [];
  for (const ruta of new Set(rutas.map(String))) {
    const r = resolver(ruta, dir);
    if (!r) fallos.push({ ruta, error: 'ruta no permitida' });
    else if (!(await existe(r.ruta))) fallos.push({ ruta, error: 'ya no existe' });
    else validos.push({ ruta, abs: r.ruta });
  }
  if (validos.length) {
    try {
      await papelera(validos.map((v) => v.abs));
    } catch (err) {
      // Si falla a mitad, lo que ya no está sí se borró.
      for (const v of validos) if (await existe(v.abs)) fallos.push({ ruta: v.ruta, error: String((err as Error).message ?? err) });
    }
  }
  const borrados: string[] = [];
  for (const v of validos) if (!(await existe(v.abs))) borrados.push(v.ruta);
  // Carpetas que se quedan vacías, fuera (rmdir no borra si queda algo).
  const carpetas = [...new Set(borrados.map((b) => dirname(resolve(dir, b))))].sort((a, b) => b.length - a.length);
  for (let c of carpetas) {
    while (c.startsWith(resolve(dir) + sep)) {
      if (await rmdir(c).then(() => false, () => true)) break;
      c = dirname(c);
    }
  }
  return { borrados, fallos };
}
