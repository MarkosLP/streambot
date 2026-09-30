import { getDb } from '../data/db.js';
import { decodeEntities, youtubeCall } from '../services/youtube.js';

type Datos = { youtubeKey?: string };
type Almacen = { leer(): Datos; guardar(datos: Datos): void };
export type ResultadoMusica = { id: string; titulo: string; autor: string; imagen: string; url: string };
const texto = (v: unknown, max = 200) => typeof v === 'string' ? v.trim().slice(0, max) : '';

export function enlaceYoutube(v: unknown): string {
  const s = texto(v, 500);
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:') throw Error();
    const host = u.hostname.replace(/^www\./, '');
    const id = host === 'youtu.be' ? u.pathname.slice(1) : ['youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)
      ? u.pathname === '/watch' ? u.searchParams.get('v') : u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})\/?$/)?.[1] : null;
    if (id && /^[\w-]{11}$/.test(id)) return id;
  } catch {}
  throw Error('Pega un enlace de vídeo de YouTube válido.');
}

/** Credenciales locales: nunca se devuelven en estado ni se incluyen en logs. */
const almacen: Almacen = {
  leer() {
    const db = getDb();
    db.exec('CREATE TABLE IF NOT EXISTS musica_online (id INTEGER PRIMARY KEY CHECK(id=1), datos TEXT NOT NULL)');
    const r = db.prepare('SELECT datos FROM musica_online WHERE id=1').get() as { datos: string } | undefined;
    const d = r ? JSON.parse(r.datos) : {};
    const limpio: Datos = d.youtubeKey ? { youtubeKey: d.youtubeKey } : {};
    if (r && Object.keys(d).some(k => k !== 'youtubeKey')) db.prepare('UPDATE musica_online SET datos=? WHERE id=1').run(JSON.stringify(limpio));
    return limpio;
  },
  guardar(d) {
    this.leer();
    getDb().prepare('INSERT INTO musica_online(id, datos) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET datos=excluded.datos').run(JSON.stringify(d));
  },
};

export class MusicaOnline {
  private cache = new Map<string, { vence: number; items: ResultadoMusica[] }>();
  constructor(private store: Almacen = almacen, private pedir: typeof fetch = fetch) {}

  estado() {
    return { youtube: { configurado: !!this.store.leer().youtubeKey } };
  }
  configurar(b: Record<string, unknown>) {
    const d = this.store.leer();
    if (b.youtubeKey !== undefined) {
      const key = texto(b.youtubeKey, 200);
      if (key && !/^[\w-]{20,200}$/.test(key)) throw Error('La clave de YouTube no tiene un formato válido.');
      d.youtubeKey = key;
      this.cache.clear();
    }
    this.store.guardar({ youtubeKey: d.youtubeKey });
  }
  async buscarYoutube(q: unknown): Promise<ResultadoMusica[]> {
    const query = texto(q), key = this.store.leer().youtubeKey;
    if (!query) throw Error('Escribe qué quieres buscar.');
    if (!key) throw Error('Configura la clave de YouTube para buscar. También puedes pegar directamente un enlace de vídeo.');
    const anterior = this.cache.get(query);
    if (anterior && anterior.vence > Date.now()) return anterior.items;
    const data = await youtubeCall<{ items?: any[] }>(key, 'search', {
      part: 'snippet', type: 'video', videoEmbeddable: 'true', videoSyndicated: 'true',
      maxResults: '12', q: query, relevanceLanguage: 'es',
    }, this.pedir);
    const items = (data.items ?? []).filter((x: any) => /^[\w-]{11}$/.test(x.id?.videoId)).map((x: any) => ({ id: x.id.videoId, titulo: decodeEntities(texto(x.snippet?.title)), autor: decodeEntities(texto(x.snippet?.channelTitle)), imagen: `https://i.ytimg.com/vi/${x.id.videoId}/mqdefault.jpg`, url: `https://www.youtube.com/watch?v=${x.id.videoId}` }));
    this.cache.set(query, { vence: Date.now() + 300_000, items });
    if (this.cache.size > 30) this.cache.delete(this.cache.keys().next().value!);
    return items;
  }
}
export const musicaOnline = new MusicaOnline();
