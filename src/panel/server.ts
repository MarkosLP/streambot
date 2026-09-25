import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { config } from '../config.js';
import { log, recientes } from '../core/logger.js';
import * as killswitch from '../core/killswitch.js';
import * as ajustes from '../core/ajustes.js';
import * as consent from '../core/consent.js';
import { send } from '../core/output.js';
import * as streams from '../data/streams.js';
import { budget } from '../services/ai/index.js';
import * as revision from './revision.js';
import * as datos from './datos.js';
import { EFECTOS, PREFIJO_ACCION, mismoNombre } from './efectos.js';
import * as biblioteca from './biblioteca.js';
import type { AccionSB, EstadoConexion } from '../transport/streamerbot.js';

/**
 * Panel de control.
 *
 * Un servidor HTTP mínimo, sin framework, que sirve una página y una API JSON.
 * Corre DENTRO del proceso del bot porque lo que controla —el interruptor, los
 * ajustes, la cola de revisión— vive en su memoria.
 *
 * SEGURIDAD. Escucha solo en 127.0.0.1, pero eso no basta: cualquier web que
 * tengas abierta en el navegador puede intentar hablar con 127.0.0.1. Dos
 * defensas, baratas y suficientes para un panel local:
 *
 *  1. La cabecera Host tiene que ser 127.0.0.1 o localhost. Corta el ataque
 *     de "DNS rebinding", en el que una web maliciosa hace que su dominio
 *     apunte a tu 127.0.0.1.
 *  2. Todo lo que cambia algo (POST) exige la cabecera `X-Panel: 1`. Una web
 *     ajena no puede mandar una cabecera propia sin pedir permiso antes al
 *     servidor (preflight CORS), y este servidor nunca lo concede.
 *
 * Si el panel falla, el bot sigue funcionando igual: ningún error de aquí
 * sale de este archivo.
 */

/** Lo que el panel necesita de Streamer.bot. Se inyecta para poder probarlo sin él. */
export interface PuertoStreamerbot {
  estado: () => EstadoConexion;
  acciones: () => Promise<AccionSB[]>;
  ejecutarAccion: (id: string) => Promise<void>;
}

const PUBLICOS: Record<string, { archivo: string; tipo: string }> = {
  '/': { archivo: 'index.html', tipo: 'text/html; charset=utf-8' },
  '/app.js': { archivo: 'app.js', tipo: 'text/javascript; charset=utf-8' },
  '/styles.css': { archivo: 'styles.css', tipo: 'text/css; charset=utf-8' },
};

const DIR_PUBLICO = new URL('./public/', import.meta.url);
const MAX_BODY = 16 * 1024;
const arrancado = new Date().toISOString();

class ErrorHttp extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function crearServidor(sb: PuertoStreamerbot): Server {
  const server = createServer((req, res) => {
    atender(server, sb, req, res).catch((err) => {
      const status = err instanceof ErrorHttp ? err.status : 500;
      if (status === 500) log.error(`Panel: ${String(err)}`);
      json(res, status, { error: err instanceof Error ? err.message : String(err) });
    });
  });
  return server;
}

export async function arrancar(sb: PuertoStreamerbot): Promise<Server | null> {
  if (!config.panel.enabled) return null;

  const server = crearServidor(sb);
  return new Promise((resolve) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      // Un puerto ocupado no puede impedir que el bot arranque.
      const motivo = err.code === 'EADDRINUSE' ? `el puerto ${config.panel.port} está ocupado` : String(err);
      log.warn(`Panel no disponible: ${motivo}. Cambia PANEL_PORT en el .env. El bot sigue funcionando.`);
      resolve(null);
    });
    server.listen(config.panel.port, '127.0.0.1', () => {
      log.info(`Panel de control: http://127.0.0.1:${config.panel.port}`);
      resolve(server);
    });
  });
}

// ---------------------------------------------------------------------------

async function atender(server: Server, sb: PuertoStreamerbot, req: IncomingMessage, res: ServerResponse) {
  const puerto = (server.address() as AddressInfo).port;
  const permitidos = [`127.0.0.1:${puerto}`, `localhost:${puerto}`];

  if (!permitidos.includes(req.headers.host ?? '')) {
    throw new ErrorHttp(403, 'host no permitido');
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const metodo = req.method ?? 'GET';

  if (metodo === 'POST') {
    if (req.headers['x-panel'] !== '1') throw new ErrorHttp(403, 'falta la cabecera X-Panel');
    const origen = req.headers.origin;
    if (origen && !permitidos.some((p) => origen === `http://${p}`)) {
      throw new ErrorHttp(403, 'origen no permitido');
    }
  } else if (metodo !== 'GET') {
    // Incluye OPTIONS: el preflight CORS se contesta que no, siempre.
    throw new ErrorHttp(405, 'método no permitido');
  }

  if (metodo === 'GET' && PUBLICOS[url.pathname]) {
    const { archivo, tipo } = PUBLICOS[url.pathname];
    const contenido = await readFile(new URL(archivo, DIR_PUBLICO));
    res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'no-store' });
    res.end(contenido);
    return;
  }

  if (metodo === 'GET' && url.pathname.startsWith('/biblioteca/')) {
    const archivo = biblioteca.resolver(url.pathname);
    const contenido = archivo && (await readFile(archivo.ruta).catch(() => null));
    if (!archivo || !contenido) throw new ErrorHttp(404, 'no existe');
    res.writeHead(200, {
      'Content-Type': archivo.tipo,
      'Content-Length': contenido.length,
      'Cache-Control': 'no-store',
      // Un overlay es una página con scripts. Así corre en un origen propio
      // y no puede usar el panel aunque se abra directamente.
      'Content-Security-Policy': 'sandbox allow-scripts',
    });
    res.end(contenido);
    return;
  }

  const ruta = `${metodo} ${url.pathname}`;

  if (ruta === 'GET /api/estado') {
    const desde = Number(url.searchParams.get('log') ?? 0) || 0;
    return json(res, 200, estado(sb, desde));
  }

  if (ruta === 'POST /api/interruptor') {
    const { encendido } = await cuerpo(req);
    if (typeof encendido !== 'boolean') throw new ErrorHttp(400, 'encendido tiene que ser true o false');
    if (encendido) killswitch.enable('desde el panel');
    else killswitch.disable('desde el panel');
    return json(res, 200, { ok: true });
  }

  if (ruta === 'POST /api/ajustes') {
    const body = await cuerpo(req);
    if (typeof body.espontaneas === 'boolean') ajustes.setInteraccionesEspontaneas(body.espontaneas, 'desde el panel');
    if (typeof body.revision === 'boolean') ajustes.setModoRevision(body.revision, 'desde el panel');
    return json(res, 200, { ok: true });
  }

  const decision = /^POST \/api\/revision\/([\w-]+)$/.exec(ruta);
  if (decision) {
    const { aprobar } = await cuerpo(req);
    if (typeof aprobar !== 'boolean') throw new ErrorHttp(400, 'aprobar tiene que ser true o false');
    if (!revision.decidir(decision[1], aprobar)) throw new ErrorHttp(404, 'ya se decidió o caducó');
    return json(res, 200, { ok: true });
  }

  if (ruta === 'POST /api/chat') {
    const { texto } = await cuerpo(req);
    if (typeof texto !== 'string' || !texto.trim()) throw new ErrorHttp(400, 'el mensaje está vacío');
    // Lo escribes tú, así que puedes mencionar a quien quieras. Pasa por
    // policy como todo lo demás: interruptor, longitud y techo por hora.
    const menciones = [...texto.matchAll(/@(\w+)/g)].map((m) => m[1].toLowerCase());
    const outcome = await send({ text: texto.trim(), reason: 'panel', allowedMentions: menciones });
    if (!outcome.sent) throw new ErrorHttp(409, `no salió: ${outcome.detail}`);
    return json(res, 200, { ok: true, dryRun: outcome.dryRun });
  }

  if (ruta === 'GET /api/interacciones') return json(res, 200, datos.interacciones());

  if (ruta === 'GET /api/espectadores') return json(res, 200, datos.espectadores());

  const olvido = /^POST \/api\/espectadores\/(\w+)\/olvidar$/.exec(ruta);
  if (olvido) return json(res, 200, consent.olvidar(olvido[1]));

  if (ruta === 'GET /api/efectos') return json(res, 200, await efectos(sb));

  if (ruta === 'GET /api/acciones') return json(res, 200, await sb.acciones());

  if (ruta === 'GET /api/biblioteca') return json(res, 200, await biblioteca.listar());

  if (ruta === 'POST /api/biblioteca/abrir') {
    const { seccion } = await cuerpo(req);
    biblioteca.abrirCarpeta(typeof seccion === 'string' ? (seccion as biblioteca.Seccion) : undefined);
    return json(res, 200, { ok: true });
  }

  const ejecutar = /^POST \/api\/acciones\/([\w-]+)\/ejecutar$/.exec(ruta);
  if (ejecutar) {
    await sb.ejecutarAccion(ejecutar[1]);
    log.info(`Panel: acción ${ejecutar[1]} ejecutada a mano.`);
    return json(res, 200, { ok: true });
  }

  throw new ErrorHttp(404, 'no existe');
}

function estado(sb: PuertoStreamerbot, desdeLog: number) {
  const directo = streams.current();
  return {
    bot: {
      arrancado,
      interruptor: killswitch.isEnabled(),
      interruptorDetalle: killswitch.status(),
      espontaneas: ajustes.interaccionesEspontaneas(),
      revision: ajustes.modoRevision(),
      dryRun: config.dryRun,
      modelo: config.ai.model,
    },
    streamerbot: sb.estado(),
    directo: directo ? { desde: directo.started_at } : null,
    gasto: budget.summary(),
    pendientes: revision.lista(),
    log: recientes(desdeLog),
  };
}

async function efectos(sb: PuertoStreamerbot) {
  let acciones: AccionSB[] | null = null;
  try {
    acciones = await sb.acciones();
  } catch {
    // Sin Streamer.bot el catálogo se enseña igual, sin saber qué está montado.
  }

  const lib = await biblioteca.listar();
  const enBiblioteca = (m: string) => {
    const [seccion, nombre] = m.split('/') as [biblioteca.Seccion, string];
    return lib[seccion]?.find((a) => a.nombre === nombre) ?? null;
  };

  return {
    conectado: acciones !== null,
    prefijo: PREFIJO_ACCION,
    efectos: EFECTOS.map((e) => {
      const accion = acciones?.find((a) => mismoNombre(a.name, e.accion)) ?? null;
      return {
        ...e,
        material: e.material.map((m) => ({ id: m, archivo: enBiblioteca(m) })),
        montado: acciones === null ? null : accion !== null,
        accionId: accion?.id ?? null,
      };
    }),
    // Las Actions del grupo de efectos que no están en el catálogo: las que
    // hayas creado por tu cuenta. Se enseñan para que también puedas probarlas.
    extra: (acciones ?? []).filter(
      (a) => a.name.startsWith(PREFIJO_ACCION) && !EFECTOS.some((e) => mismoNombre(a.name, e.accion)),
    ),
  };
}

async function cuerpo(req: IncomingMessage): Promise<Record<string, unknown>> {
  let total = 0;
  const trozos: Buffer[] = [];
  for await (const trozo of req) {
    total += trozo.length;
    if (total > MAX_BODY) throw new ErrorHttp(413, 'cuerpo demasiado grande');
    trozos.push(trozo);
  }
  if (total === 0) return {};
  try {
    const valor = JSON.parse(Buffer.concat(trozos).toString('utf8'));
    return valor && typeof valor === 'object' ? valor : {};
  } catch {
    throw new ErrorHttp(400, 'JSON no válido');
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
