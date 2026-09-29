import * as referencias from './referencias.js';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
import { EFECTOS, PREFIJO_ACCION, guia, mismoNombre } from './efectos.js';
import * as biblioteca from './biblioteca.js';
import * as obsSetup from './obs-setup.js';
import * as importar from './importar.js';
import * as loot from '../interactions/loot/index.js';
import * as lootDb from '../data/loot.js';
import * as lootComandos from '../interactions/loot/comandos.js';
import * as jefe from '../interactions/loot/jefe.js';
import * as users from '../data/users.js';
import * as directo from '../core/directo.js';
import { handleEvent } from '../core/handler.js';
import { normalize } from '../core/events.js';
import * as titulos from './titulos.js';
import * as previa from './previa.js';
import * as escenas from './escenas.js';
import * as estilos from './estilos.js';
import * as rotulos from './rotulos.js';
import * as musica from '../core/musica.js';
import * as temas from './temas.js';
import * as alertas from '../core/alertas.js';
import * as fondos from './fondos.js';
import * as avatarIa from './avatar-ia.js';
import * as avatarLocal from './avatar-local.js';
import * as iaImagen from '../services/ia-imagen.js';
import * as eventos from '../interactions/loot/eventos.js';
import * as temporada from '../interactions/loot/temporada.js';
import * as temporadas from '../data/temporadas.js';
import * as iaLocal from '../services/ia-local.js';
import * as arena from '../interactions/loot/arena.js';
import { MOCHILA_MAX, PROBABILIDADES, tirar } from '../interactions/loot/objetos.js';
import * as cooldowns from '../core/cooldowns.js';
import { conObs, type PedirObs } from '../transport/obs.js';
import { probarVisual, EFECTOS_PRUEBA, type EfectoPrueba } from './prueba-efecto.js';

/** Abre una conexión con OBS para un trabajo. Se inyecta para probarlo sin OBS. */
export type ConObs = <T>(trabajo: (pedir: PedirObs) => Promise<T>) => Promise<T>;
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
  ejecutarAccion: (id: string, args?: Record<string, unknown>) => Promise<void>;
}

const PUBLICOS: Record<string, { archivo: string; tipo: string }> = {
  '/': { archivo: 'index.html', tipo: 'text/html; charset=utf-8' },
  '/referencias.js': { archivo: 'referencias.js', tipo: 'text/javascript; charset=utf-8' },
  '/red.js': { archivo: 'red.js', tipo: 'text/javascript; charset=utf-8' },
  '/app.js': { archivo: 'app.js', tipo: 'text/javascript; charset=utf-8' },
  '/avatar-local.js': { archivo: 'avatar-local.js', tipo: 'text/javascript; charset=utf-8' },
  '/styles.css': { archivo: 'styles.css', tipo: 'text/css; charset=utf-8' },
};

const DIR_PUBLICO = new URL('./public/', import.meta.url);
const MAX_BODY = 16 * 1024;
const sesionOverlay = randomUUID();
const arrancado = new Date().toISOString();

class ErrorHttp extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function crearServidor(sb: PuertoStreamerbot, obs: ConObs = conObs, dirReferencias = biblioteca.DIR_BIBLIOTECA): Server {
  const server = createServer((req, res) => {
    atender(server, sb, obs, req, res, dirReferencias).catch((err) => {
      const status = err instanceof ErrorHttp ? err.status : err instanceof referencias.ErrorReferencia ? 400 : 500;
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
      vigilarEscenaParaMusica(conObs);
      resolve(server);
    });
  });
}

/**
 * La música depende de la escena de OBS en emisión: suena solo en las
 * escenas marcadas (y, en automático, cambia de lista). Se pregunta cada 3 s,
 * pero solo mientras la fuente de música esté abierta en OBS y haga falta.
 */
function vigilarEscenaParaMusica(obs: ConObs): void {
  let mirando = false;
  setInterval(async () => {
    const a = musica.leerAjustes();
    if (mirando || !musica.overlayActivo() || (a.modo !== 'auto' && !a.escenas.length)) return;
    mirando = true;
    try {
      const r = await obs((pedir) => pedir<{ currentProgramSceneName?: string; sceneName?: string }>('GetCurrentProgramScene'));
      const escena = r.currentProgramSceneName ?? r.sceneName;
      if (escena) await musica.alCambiarEscena(escena);
    } catch {
      // OBS cerrado: la música sigue con lo que tenía.
    } finally {
      mirando = false;
    }
  }, 3_000).unref();
}

// ---------------------------------------------------------------------------

let laboratorioEnMarcha = false;
let pruebaEfectoEnMarcha = false;
/** El fondo que se está generando con IA (una escena), o null. */
let generandoFondo: string | null = null;

/** npm run laboratorio -- --json, esperando el resultado (unos segundos). */
function lanzarLaboratorio(): Promise<unknown> {
  const raiz = fileURLToPath(new URL('../../', import.meta.url));
  return new Promise((resolve, reject) => {
    const hijo = spawn(process.execPath, ['--import', 'tsx', '--disable-warning=ExperimentalWarning', 'src/cli/laboratorio.ts', '--json'], {
      cwd: raiz, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let salida = '';
    let errores = '';
    hijo.stdout.on('data', (d) => { salida += d; });
    hijo.stderr.on('data', (d) => { errores += d; });
    const reloj = setTimeout(() => { hijo.kill(); reject(new ErrorHttp(504, 'El laboratorio ha tardado demasiado')); }, 180_000);
    hijo.on('close', () => {
      clearTimeout(reloj);
      const linea = salida.trim().split(/\r?\n/).reverse().find((l) => l.startsWith('{'));
      if (!linea) return reject(new ErrorHttp(500, `El laboratorio no ha terminado bien: ${errores.slice(-300) || 'sin detalle'}`));
      try { resolve(JSON.parse(linea)); } catch { reject(new ErrorHttp(500, 'El laboratorio devolvió algo ilegible')); }
    });
  });
}

async function atender(server: Server, sb: PuertoStreamerbot, obs: ConObs, req: IncomingMessage, res: ServerResponse, dirReferencias: string) {
  const puerto = (server.address() as AddressInfo).port;
  const permitidos = [`127.0.0.1:${puerto}`, `localhost:${puerto}`];

  if (!permitidos.includes(req.headers.host ?? '')) {
    throw new ErrorHttp(403, 'host no permitido');
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const metodo = req.method ?? 'GET';
  if (url.pathname.startsWith('/api/overlay/') || url.pathname === '/api/reproductor/musica') {
    res.setHeader('X-Sesion-Overlay', sesionOverlay);
    res.setHeader('Access-Control-Expose-Headers', 'X-Sesion-Overlay');
  }

  // El reproductor aislado solo puede reportar con su credencial privada (27 sep 2026).
  if (metodo === 'POST' && url.pathname === '/api/reproductor/musica') {
    const d = await cuerpo(req);
    if (d.credencial !== musica.credencialReproductor()) throw new ErrorHttp(403, 'reproductor no autorizado');
    if (typeof d.id !== 'string' || !Number.isInteger(d.turno)) throw new ErrorHttp(400, 'reporte inválido');
    if (d.tipo === 'terminada') await musica.terminada(d.id, d.turno as number);
    else if (d.tipo === 'progreso') musica.informarProgreso(d.id, Number(d.pos), Number(d.dur), d.turno as number);
    else throw new ErrorHttp(400, 'reporte inválido');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return json(res, 200, musica.paraOverlay());
  }
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
    let contenido = archivo && (await readFile(archivo.ruta).catch(() => null));
    if (!archivo || !contenido) throw new ErrorHttp(404, 'no existe');
    if (url.pathname === '/biblioteca/overlays/musica.html') contenido = Buffer.from(contenido.toString('utf8').replace('__MUSICA_CREDENCIAL__', musica.credencialReproductor()));
    res.writeHead(200, {
      'Content-Type': archivo.tipo,
      'Content-Length': contenido.length,
      'Cache-Control': 'no-store',
      // Un overlay es una página con scripts. Así corre en un origen propio
      // y no puede usar el panel aunque se abra directamente.
      'Content-Security-Policy': 'sandbox allow-scripts',
      // Las imágenes, legibles desde los overlays (van en su sandbox, con origen propio):
      // el avatar busca dónde tiene los ojos leyendo los píxeles. Solo lectura.
      ...((archivo.tipo.startsWith('image/') || archivo.tipo.startsWith('font/')) && { 'Access-Control-Allow-Origin': '*' }),
    });
    res.end(contenido);
    return;
  }

  const ruta = `${metodo} ${url.pathname}`;

  if (ruta === 'GET /api/overlay/avatar-local') {
    try {
      const png = avatarLocal.variante(url.searchParams.get('personaje') ?? '', url.searchParams.get('paso') ?? 'base');
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end(png); return;
    } catch { throw new ErrorHttp(404, 'Base local no disponible'); }
  }
  if (ruta === 'GET /api/escenas/avatar-local') return json(res, 200, { calibracion: avatarLocal.leer(url.searchParams.get('personaje') ?? '') });
  if (ruta === 'POST /api/escenas/avatar-local/vista' || ruta === 'POST /api/escenas/avatar-local') {
    const b = await cuerpo(req);
    if (!avatarIa.rutaValida(b.personaje)) throw new ErrorHttp(400, 'Personaje no válido');
    try {
      if (ruta.endsWith('/vista')) return json(res, 200, avatarLocal.vista(b.personaje as string, b.calibracion));
      if (b.desactivar === true) { avatarLocal.desactivar(b.personaje as string); return json(res, 200, { desactivado: true }); }
      return json(res, 200, avatarLocal.guardar(b.personaje as string, b.calibracion, b.hash, b.revisado));
    } catch (e) { throw new ErrorHttp(400, e instanceof Error ? e.message : 'Calibración no válida'); }
  }

  // Lo que pinta la barra del jefe en OBS. El overlay corre en un origen
  // propio (el sandbox de arriba), así que necesita CORS para leerlo. Solo se
  // abre ESTA ruta, de lectura, y solo con lo que ya se ve en el chat.
  if (ruta === 'GET /api/overlay/jefe') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ ...jefe.paraOverlay(), duelos: arena.recientes() }));
    return;
  }

  // Lo que pintan las escenas (Empezamos, Charla, Pausa, Final). Como la del
  // jefe: CORS abierto porque el overlay corre en su sandbox, solo lectura y
  // solo lo que ya se ve en el chat.
  if (ruta === 'GET /api/overlay/escena') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(escenas.paraOverlay(url.searchParams.get('tipo') ?? '')));
    return;
  }

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
    const outcome = await send({ text: texto.trim(), reason: 'panel', allowedMentions: menciones, solicitado: true });
    if (!outcome.sent) throw new ErrorHttp(409, `no salió: ${outcome.detail}`);
    return json(res, 200, { ok: true, dryRun: outcome.dryRun });
  }

  if (ruta === 'GET /api/interacciones') return json(res, 200, datos.interacciones());

  if (ruta === 'GET /api/espectadores') return json(res, 200, datos.espectadores());

  const fichaDe = /^GET \/api\/espectadores\/(\w+)\/ficha$/.exec(ruta);
  if (fichaDe) return json(res, 200, datos.ficha(fichaDe[1]!));

  const olvido = /^POST \/api\/espectadores\/(\w+)\/olvidar$/.exec(ruta);
  if (olvido) return json(res, 200, consent.olvidar(olvido[1]));

  if (ruta === 'GET /api/efectos') return json(res, 200, await efectos(sb));

  if (ruta === 'GET /api/efectos/importar') {
    const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean);
    const escena = url.searchParams.get('escena') ?? '';
    const fuente = url.searchParams.get('fuente') ?? '';
    if (!ids.length || !ids.every((id) => (importar.IMPORTABLES as readonly string[]).includes(id))) {
      throw new ErrorHttp(400, 'efectos no válidos');
    }
    if (!escena || !fuente) throw new ErrorHttp(400, 'falta la escena o la fuente del juego');
    return json(res, 200, { codigo: importar.codigoImportacion(ids as importar.Importable[], { escena, fuente }) });
  }

  if (ruta === 'GET /api/acciones') return json(res, 200, await sb.acciones());

  if (ruta === 'GET /api/loot') {
    return json(res, 200, {
      ...loot.estado(),
      pantalla: loot.estadoPantalla(),
      // Para el regalo: todo el que está en el chat, haya escrito o no.
      jefe: jefe.estado(),
      vigilante: directo.estado(),
      jefes: jefe.JEFES,
      enElChat: (await loot.enElChat()).map((v) => ({ login: v.login, nombre: v.displayName })),
      probabilidades: PROBABILIDADES,
      recientes: lootDb.recientes(25),
      mochilas: lootDb.mochilas(10),
      comandos: lootComandos.LISTA,
      mochilaMax: MOCHILA_MAX,
      evento: eventos.estado(),
      temporada: {
        nombre: temporadas.nombre(temporadas.deFecha()),
        diasQuedan: temporadas.diasQuedan(),
        ranking: temporada.rankingActual(10),
        salon: temporadas.salon(12).map((t) => ({ ...t, nombre: temporadas.nombre(t.temporada) })),
      },
    });
  }

  if (ruta === 'POST /api/loot/evento') {
    const { eleccion } = await cuerpo(req);
    if (!eventos.elegir(eleccion, 'desde el panel')) throw new ErrorHttp(400, 'evento no válido');
    return json(res, 200, eventos.estado());
  }

  // El resumen de un directo (sin id, el último) y la lista para elegir.
  if (ruta === 'GET /api/resumen') {
    const id = Number(url.searchParams.get('id')) || undefined;
    return json(res, 200, { directos: datos.directos(), resumen: datos.resumenDirecto(id) });
  }

  // La revisión de antes de empezar: solo lee, no cambia nada.
  if (ruta === 'GET /api/previa') {
    return json(res, 200, await previa.revisar({
      streamerbot: sb.estado,
      efectos: async () => {
        const e = await efectos(sb);
        return e.conectado ? e.efectos.map((x) => ({ nombre: x.recompensa, montado: x.montado })) : null;
      },
      obs,
      iaLocal: iaLocal.estado,
    }));
  }

  if (ruta === 'POST /api/loot/ajustes') {
    const { activo, canalJuega } = await cuerpo(req);
    if (canalJuega !== undefined) {
      if (typeof canalJuega !== 'boolean') throw new ErrorHttp(400, 'canalJuega tiene que ser true o false');
      ajustes.setCanalJuega(canalJuega, 'desde el panel');
      return json(res, 200, { ok: true });
    }
    if (typeof activo !== 'boolean') throw new ErrorHttp(400, 'activo tiene que ser true o false');
    ajustes.setLootActivo(activo, 'desde el panel');
    return json(res, 200, { ok: true });
  }

  if (ruta === 'POST /api/loot/soltar') {
    // Un cofre a mano sale al chat: sin freno, pulsar deprisa sería spam.
    const falta = cooldowns.remaining('panel:soltar-cofre', 60_000);
    if (falta > 0) throw new ErrorHttp(429, `Espera ${Math.ceil(falta / 1000)} s para soltar otro cofre`);
    cooldowns.tryConsume('panel:soltar-cofre', 60_000);
    const r = await loot.soltarCofre({ origen: 'panel' });
    if (!r.ok) throw new ErrorHttp(409, r.motivo);
    return json(res, 200, { enviado: r.enviado, reparto: r.reparto.map((x) => ({ quien: x.viewer.displayName, ...x.botin })) });
  }

  // El jefe de raid: aparece en el chat y se pelea con !atacar.
  if (ruta === 'POST /api/loot/jefe') {
    const { accion, tipo } = await cuerpo(req);
    if (accion === 'retirar') {
      if (!jefe.retirar()) throw new ErrorHttp(409, 'no hay ningún jefe');
      return json(res, 200, { ok: true });
    }
    const r = await jefe.invocar({ tipo: typeof tipo === 'string' ? tipo : undefined });
    if (!r.ok) throw new ErrorHttp(409, r.motivo);
    return json(res, 200, r);
  }

  // Un cofre regalado: para todo el chat o para una persona, haya hablado o no.
  if (ruta === 'POST /api/loot/regalar') {
    const { para, tipo } = await cuerpo(req);
    if (para !== undefined && typeof para !== 'string') throw new ErrorHttp(400, 'para tiene que ser un nombre');
    // Un freno corto: solo contra el doble clic, que regalar es cosa tuya.
    const falta = cooldowns.remaining('panel:regalar-cofre', 10_000);
    if (falta > 0) throw new ErrorHttp(429, `Espera ${Math.ceil(falta / 1000)} s para regalar otro`);
    // Se gasta ANTES del await: si no, dos clics seguidos pasarían los dos.
    cooldowns.tryConsume('panel:regalar-cofre', 10_000);
    const r = await loot.regalarCofre({ para: para ?? '', tipo: tipo === 'oro' ? 'oro' : 'cofre' });
    if (!r.ok) throw new ErrorHttp(409, r.motivo);
    return json(res, 200, { enviado: r.enviado, reparto: r.reparto.map((x) => ({ quien: x.viewer.displayName, ...x.botin })) });
  }

  // Una tirada de mentira: ni se guarda ni sale al chat, pero SÍ sale en OBS,
  // que es justo lo que quieres ver al probar.
  if (ruta === 'POST /api/loot/prueba') {
    const { tipo } = await cuerpo(req);
    const botin = tirar(tipo === 'oro' ? 'oro' : 'cofre');
    const quien = config.broadcasterLogin.charAt(0).toUpperCase() + config.broadcasterLogin.slice(1);
    const enObs = loot.enPantalla(quien, botin, tipo === 'oro' ? 'oro' : 'prueba');
    return json(res, 200, { ...botin, enObs });
  }

  // Si arrancaste el bot con el directo ya empezado, Twitch no vuelve a
  // avisar de que empezó, y sin directo abierto no caen cofres.
  // Y al revés: si el aviso de fin de directo no llegó, o lo marcaste para
  // probar, se cierra a mano. Sin esto se quedaba "en directo" para siempre.
  if (ruta === 'POST /api/loot/directo') {
    const { abierto } = await cuerpo(req);
    // A mano manda lo tuyo: el vigilante de OBS no lo cierra aunque no emitas.
    directo.marcarManual(abierto !== false);
    if (abierto === false) streams.close();
    else streams.open();
    return json(res, 200, { ok: true });
  }


  // Títulos: sugerencias de la IA local. Nada se conecta a Twitch: se copian.
  // El laboratorio de pruebas, en un proceso aparte: cambia la base de datos
  // y el chat por unos de mentira, y eso no puede pasar dentro del bot.
  if (ruta === 'POST /api/laboratorio') {
    if (laboratorioEnMarcha) throw new ErrorHttp(409, 'El laboratorio ya está en marcha');
    laboratorioEnMarcha = true;
    try {
      return json(res, 200, await lanzarLaboratorio());
    } finally {
      laboratorioEnMarcha = false;
    }
  }

  // Pruebas de suscriptores: avisos de mentira por el mismo camino que los de
  // Twitch (normalize + handleEvent), con gente «prueba_…». Streamer.bot 1.0
  // no tiene un botón que mande estos avisos al bot. Los mensajes SÍ salen al
  // chat: se avisa en el panel.
  if (ruta === 'POST /api/pruebas/mecenas') {
    const { tipo } = await cuerpo(req);
    const p = (login: string) => ({ userId: `prueba-${login}`, userName: `prueba_${login}`, displayName: `Prueba_${login}` });
    const receptores = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `prueba-r${i + 1}`, login: `prueba_r${i + 1}`, name: `Prueba_R${i + 1}` }));
    const avisos: Record<string, [string, unknown]> = {
      sub: ['Twitch.Sub', { ...p('sub'), subTier: 1000 }],
      resub12: ['Twitch.ReSub', { ...p('veterano'), cumulativeMonths: 12, subTier: 1000 }],
      regalo: ['Twitch.GiftSub', { ...p('regala'), recipientUserId: 'prueba-r1', recipientUsername: 'prueba_r1', recipientDisplayName: 'Prueba_R1', subTier: 1000 }],
      bomba: ['Twitch.GiftBomb', { ...p('generoso'), gifts: 6, recipients: receptores(6) }],
      raid: ['Twitch.Raid', { from_broadcaster_user_id: 'prueba-canal', from_broadcaster_user_login: 'prueba_canal', from_broadcaster_user_name: 'Prueba_Canal', viewers: 8 }],
      bits: ['Twitch.Cheer', { ...p('bits'), username: 'prueba_bits', bits: 500 }],
    };
    const aviso = typeof tipo === 'string' ? avisos[tipo] : undefined;
    if (!aviso) throw new ErrorHttp(400, 'prueba no válida');
    await handleEvent(normalize(aviso[0], aviso[1], 'simulator'));
    return json(res, 200, { ok: true });
  }

  if (ruta === 'POST /api/pruebas/mecenas/borrar') {
    return json(res, 200, { borrados: datos.borrarPruebas() });
  }

  // Ajustes que se guardan (sobreviven a un reinicio).
  if (ruta === 'GET /api/ajustes') {
    return json(res, 200, {
      ajustes: ajustes.todos(),
      info: {
        mensajesPorHora: config.messagesPerHour,
        respuestasPorHora: config.respuestasPerHour,
        fuenteJuego: config.obs.fuenteJuego,
        obs: config.obs.url,
        iaLocal: await iaLocal.estado(),
        modeloClaude: config.ai.model,
        minutosCofre: `${config.loot.minutosMin}-${config.loot.minutosMax}`,
      },
    });
  }

  if (ruta === 'POST /api/ajustes') {
    const body = await cuerpo(req);
    if (body.volverAlEnv === true) {
      ajustes.volverAlEnv('desde el panel');
      // Su fila también se ha borrado: vuelve a rotar solo.
      eventos.olvidar();
      escenas.olvidar();
      return json(res, 200, { ok: true });
    }
    const setters = {
      espontaneas: ajustes.setInteraccionesEspontaneas,
      revision: ajustes.setModoRevision,
      loot: ajustes.setLootActivo,
      canalJuega: ajustes.setCanalJuega,
    } as const;
    let tocado = false;
    for (const [clave, fn] of Object.entries(setters)) {
      if (typeof body[clave] === 'boolean') { fn(body[clave] as boolean, 'desde el panel'); tocado = true; }
    }
    if (!tocado) throw new ErrorHttp(400, 'nada que cambiar');
    return json(res, 200, { ok: true, ajustes: ajustes.todos() });
  }

  if (ruta === 'GET /api/titulos') {
    return json(res, 200, { ia: await iaLocal.estado(), ...titulos.listado(), contexto: titulos.contextoCanal() });
  }

  if (ruta === 'POST /api/titulos/sugerir') {
    const { juego, sesion, tono, notas, conCanal, emojis } = await cuerpo(req);
    const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
    if (!texto(sesion, 40) || !texto(tono, 40)) throw new ErrorHttp(400, 'falta la sesión o el tono');
    try {
      titulos.podar();
      const r = await titulos.sugerir({
        juego: texto(juego, 80), sesion: texto(sesion, 40), tono: texto(tono, 40), notas: texto(notas, 300), conCanal: conCanal === true,
        emojis: typeof emojis === 'number' ? emojis : 1,
      });
      return json(res, 200, r);
    } catch (err) {
      throw new ErrorHttp(err instanceof iaLocal.ErrorIaLocal ? 503 : 500, err instanceof Error ? err.message : String(err));
    }
  }

  if (ruta === 'POST /api/titulos/marcar') {
    const { id, favorito, usado } = await cuerpo(req);
    if (!Number.isInteger(id)) throw new ErrorHttp(400, 'falta el id');
    titulos.marcar(id as number, { favorito: typeof favorito === "boolean" ? favorito : undefined, usado: usado === true });
    return json(res, 200, { ok: true });
  }

  if (ruta === 'GET /api/escenas') {
    return json(res, 200, {
      config: escenas.leer(),
      escenas: escenas.TIPOS.map((tipo) => ({ tipo, ...obsSetup.ESCENAS_OBS[tipo], url: obsSetup.urlEscena(tipo) })),
      avatar: { fuente: obsSetup.FUENTE_AVATAR, url: obsSetup.urlAvatar() },
      fondos: await fondos.lista(),
      // Los hechos y los propios; de los propios, también lo del formulario para editarlos.
      estilos: [...estilos.ESTILOS, ...estilos.propios().map((e) => e.id)].map((id) => {
        const e = estilos.info(id);
        const propio = estilos.propios().find((x) => x.id === id) ?? null;
        return { id, nombre: e.nombre, icono: e.icono, para: e.para, descripciones: e.descripciones, descripcionAvatar: e.avatar.descripcion, propio };
      }),
      opcionesEstilo: { bases: estilos.BASES, letras: estilos.LETRAS, particulas: estilos.PARTICULAS, max: estilos.MAX_PROPIOS },
      imagenIa: iaImagen.disponible(),
      personajes: await avatarIa.lista(),
      generando: generandoFondo,
    });
  }

  if (ruta === 'POST /api/escenas') {
    return json(res, 200, { config: escenas.cambiar(await cuerpo(req)) });
  }

  // Un estilo propio, del formulario: sin id lo crea, con id lo cambia. Queda elegido.
  if (ruta === 'POST /api/escenas/estilo') {
    const datos = await cuerpo(req);
    const id = typeof datos.id === 'string' && datos.id ? datos.id : undefined;
    const r = escenas.guardarEstilo(datos, id);
    if (!r) throw new ErrorHttp(400, id ? 'Ese estilo ya no existe' : 'Falta el nombre o la temática (o ya hay 20 estilos propios)');
    log.info(`Panel → estilo ${id ? 'cambiado' : 'creado'}: ${r.id}`);
    return json(res, 200, r);
  }

  // Cambiar el título de un fondo o de un personaje generado.
  if (ruta === 'POST /api/escenas/titulo') {
    const { ruta: imagen, titulo } = await cuerpo(req);
    if (!fondos.rutaValida(imagen) && !avatarIa.rutaValida(imagen)) throw new ErrorHttp(400, 'Solo fondos y personajes de la biblioteca');
    try {
      return json(res, 200, { titulo: await rotulos.renombrar(imagen as string, String(titulo ?? '')) });
    } catch (err) {
      throw new ErrorHttp(400, err instanceof Error ? err.message : String(err));
    }
  }

  // Borrar un fondo o un personaje generado (el archivo de verdad). Donde
  // estuviera puesto, sale el último que quede.
  if (ruta === 'POST /api/escenas/imagen/borrar') {
    const { ruta: imagen } = await cuerpo(req);
    const esFondo = fondos.rutaValida(imagen);
    if (!esFondo && !avatarIa.rutaValida(imagen)) throw new ErrorHttp(400, 'Solo fondos y personajes de la biblioteca');
    try {
      await (esFondo ? fondos.borrar(imagen as string) : avatarIa.borrar(imagen as string));
    } catch (err: any) {
      throw new ErrorHttp(err?.code === 'ENOENT' ? 404 : 400, err?.code === 'ENOENT' ? 'Ya no existe' : err instanceof Error ? err.message : String(err));
    }
    return json(res, 200, { config: escenas.olvidarImagen(imagen as string) });
  }

  if (ruta === 'POST /api/escenas/estilo/borrar') {
    const { id } = await cuerpo(req);
    if (typeof id !== 'string' || !estilos.ID_PROPIO.test(id)) throw new ErrorHttp(400, 'Solo se pueden borrar los estilos propios');
    return json(res, 200, { config: escenas.borrarEstilo(id) });
  }

  // Un fondo nuevo con IA (GPT Image): tarda ~30 s y cuesta unos céntimos. Uno
  // a la vez; al terminar se pone en esa escena.
  if (ruta === 'POST /api/escenas/fondo') {
    const { escena, descripcion, titulo, maxImagenes, referencias: refs } = await cuerpo(req);
    if (maxImagenes !== 1) throw new ErrorHttp(400, 'Confirma el máximo de una imagen');
    if (!escenas.TIPOS.includes(escena as escenas.Tipo)) throw new ErrorHttp(400, 'escena no válida');
    if (generandoFondo) throw new ErrorHttp(409, 'Ya se está generando un fondo: espera a que termine');
    generandoFondo = escena as string;
    try {
      // Si cambias de estilo mientras se genera, se queda en el suyo: es el
      // último de ese estilo y sale al volver a él.
      const estilo = escenas.leer().estilo;
      const nueva = await fondos.generar(escena as fondos.EscenaFondo, typeof descripcion === 'string' ? descripcion : '', estilo, undefined, rotulos.limpiarTitulo(titulo), referencias.seleccion(refs), dirReferencias);
      const config = escenas.leer().estilo === estilo ? escenas.cambiar({ fondos: { [escena as string]: nueva } }) : escenas.leer();
      return json(res, 200, { ruta: nueva, config });
    } catch (err) {
      throw new ErrorHttp(err instanceof referencias.ErrorReferencia ? 400 : err instanceof iaImagen.ErrorImagen ? 502 : 500, err instanceof Error ? err.message : String(err));
    } finally {
      generandoFondo = null;
    }
  }

  // Rehace los ojos cerrados y la sonrisa de un personaje retocando solo su cara (3 imágenes, 6 si hay que repetir).
  if (ruta === 'POST /api/escenas/avatar-rehacer') {
    const { ruta: personaje, maxImagenes } = await cuerpo(req);
    if (maxImagenes !== 6) throw new ErrorHttp(400, 'Confirma el máximo de seis imágenes');
    if (!avatarIa.rutaValida(personaje)) throw new ErrorHttp(400, 'personaje no válido');
    if (generandoFondo) throw new ErrorHttp(409, 'Ya se está generando una imagen: espera a que termine');
    generandoFondo = 'avatar';
    try {
      return json(res, 200, await avatarIa.rehacerVariantes(personaje as string));
    } catch (err) {
      throw new ErrorHttp(err instanceof referencias.ErrorReferencia ? 400 : err instanceof iaImagen.ErrorImagen ? 502 : 500, err instanceof Error ? err.message : String(err));
    } finally {
      generandoFondo = null;
    }
  }

  // Un personaje nuevo para el avatar: cuatro imágenes (~1 min, unos céntimos).
  if (ruta === 'POST /api/escenas/avatar-ia') {
    const { descripcion, titulo, maxImagenes, referencias: refs } = await cuerpo(req);
    if (maxImagenes !== 7) throw new ErrorHttp(400, 'Confirma el máximo de siete imágenes');
    if (generandoFondo) throw new ErrorHttp(409, 'Ya se está generando una imagen: espera a que termine');
    generandoFondo = 'avatar';
    try {
      const estilo = escenas.leer().estilo;
      const nuevo = await avatarIa.generar(typeof descripcion === 'string' ? descripcion : '', estilo, undefined, rotulos.limpiarTitulo(titulo), referencias.seleccion(refs), dirReferencias);
      return json(res, 200, { ruta: nuevo, config: escenas.leer().estilo === estilo ? escenas.cambiar({ avatarImagen: nuevo }) : escenas.leer() });
    } catch (err) {
      throw new ErrorHttp(err instanceof referencias.ErrorReferencia ? 400 : err instanceof iaImagen.ErrorImagen ? 502 : 500, err instanceof Error ? err.message : String(err));
    } finally {
      generandoFondo = null;
    }
  }

  // Crea o completa la escena en OBS. Solo cuando lo pulsas; nunca cambia la
  // escena en emisión.
  if (ruta === 'POST /api/escenas/obs') {
    const { tipo, escena } = await cuerpo(req);
    // El avatar suelto va a la escena que elijas (la del juego, por ejemplo).
    if (tipo === 'avatar') {
      if (typeof escena !== 'string' || !escena.trim()) throw new ErrorHttp(400, 'elige la escena');
      const hecho = await obs((pedir) => obsSetup.anadirAvatar(pedir, escena)).catch((err) => {
        throw new ErrorHttp(502, err instanceof Error ? err.message : String(err));
      });
      log.info(`Panel → OBS: ${hecho}`);
      return json(res, 200, { hecho: [hecho] });
    }
    if (!escenas.TIPOS.includes(tipo as escenas.Tipo)) throw new ErrorHttp(400, 'escena no válida');
    const hecho = await obs((pedir) => obsSetup.crearEscena(pedir, tipo as escenas.Tipo)).catch((err) => {
      throw new ErrorHttp(502, err instanceof Error ? err.message : String(err));
    });
    for (const h of hecho) log.info(`Panel → OBS: ${h}`);
    return json(res, 200, { hecho });
  }

  // ---- Música (core/musica.ts) ----
  // La fuente de OBS pregunta qué suena. Como las de arriba, corre en su
  // sandbox: CORS abierto y sin POST posible. Por eso avisa aquí mismo, con
  // ?terminada=<id> o ?id=&pos=&dur=. Lo único que puede hacer es pasar a la
  // siguiente canción, y solo si la que dice es la que suena.
  if (ruta === 'GET /api/overlay/musica') {
    musica.overlayVisto();
    const e = escenas.leer();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ...musica.paraOverlay(), estilo: e.estilo, apariencia: estilos.apariencia(e.estilo) }));
    return;
  }

  // Solo lo que suena (el mini reproductor del panel lo pide cada 2 s).
  if (ruta === 'GET /api/musica/estado') return json(res, 200, musica.estado());

  if (ruta === 'GET /api/musica') {
    const listas = url.searchParams.get('releer') === '1' ? await musica.escanear() : await musica.canciones();
    return json(res, 200, {
      ...musica.estado(),
      listas: musica.LISTAS.map((id) => ({ id, nombre: musica.NOMBRES[id], canciones: listas[id] })),
      carpeta: musica.carpeta(),
      sueltas: await musica.sueltas(),
      fuente: { nombre: obsSetup.FUENTE_MUSICA, url: obsSetup.urlMusica() },
      escenasPorDefecto: musica.ESCENAS_POR_DEFECTO,
    });
  }

  // Lo que se pide desde los botones del panel.
  if (ruta === 'POST /api/musica') {
    const { accion, lista, id, modo, ajustes } = await cuerpo(req);
    if (accion === 'lista') {
      if (!musica.esLista(lista)) throw new ErrorHttp(400, 'lista no válida');
      await musica.ponerLista(lista);
    } else if (accion === 'pista') {
      if (typeof id !== 'string' || !(await musica.ponerPista(id))) throw new ErrorHttp(404, 'Esa canción ya no está en la carpeta');
    } else if (accion === 'siguiente') await musica.siguiente();
    else if (accion === 'anterior') await musica.anterior();
    else if (accion === 'pausar') musica.pausar();
    else if (accion === 'reanudar') await musica.reanudar();
    else if (accion === 'modo') {
      if (modo !== 'auto' && modo !== 'manual') throw new ErrorHttp(400, 'modo no válido');
      await musica.ponerModo(modo);
    } else if (accion === 'ajustes') musica.cambiarAjustes(ajustes);
    else throw new ErrorHttp(400, 'acción no válida');
    return json(res, 200, musica.estado());
  }

  // Añade la fuente de música a las escenas elegidas (con confirmación en el panel).
  if (ruta === 'POST /api/musica/obs') {
    const { escenas: elegidas } = await cuerpo(req);
    if (!Array.isArray(elegidas) || !elegidas.length || !elegidas.every((e) => typeof e === 'string' && e.length <= 200)) {
      throw new ErrorHttp(400, 'elige al menos una escena');
    }
    const hecho = await obs((pedir) => obsSetup.anadirMusica(pedir, elegidas as string[])).catch((err) => {
      throw new ErrorHttp(502, err instanceof Error ? err.message : String(err));
    });
    for (const h of hecho) log.info(`Panel → OBS: ${h}`);
    return json(res, 200, { hecho });
  }

  // ---- Alertas y panel rotativo (core/alertas.ts) ----
  // Como las demás de overlay: CORS abierto (corren en su sandbox) y solo lectura.
  if (ruta === 'GET /api/overlay/alertas' || ruta === 'GET /api/overlay/panel') {
    const e = escenas.leer();
    const comun = { estilo: e.estilo, apariencia: estilos.apariencia(e.estilo) };
    const datos = ruta === 'GET /api/overlay/alertas'
      ? { ...alertas.paraAlertas(), ...comun }
      : {
        ...alertas.paraRotativo(), ...comun,
        top: { nombre: temporadas.nombre(temporadas.deFecha()), podio: temporada.rankingActual(3).map((p) => ({ nombre: p.display_name, puntos: p.puntos })) },
      };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(datos));
    return;
  }

  if (ruta === 'GET /api/overlays') {
    return json(res, 200, {
      ...alertas.estado(),
      fuentes: Object.fromEntries(Object.entries(obsSetup.OVERLAYS_DIRECTO).map(([k, o]) => [k, { nombre: o.fuente, url: obsSetup.urlOverlay(k as obsSetup.OverlayDirecto) }])),
    });
  }

  if (ruta === 'POST /api/overlays') {
    const { accion, tipo, ajustes: cambios, cual, escena } = await cuerpo(req);
    if (accion === 'probar') {
      if (!alertas.TIPOS_PROPIOS.includes(tipo as alertas.TipoAlerta)) throw new ErrorHttp(400, 'tipo de alerta no disponible: follows y suscripciones se gestionan en Streamlabs');
      alertas.probar(tipo as alertas.TipoAlerta);
      return json(res, 200, alertas.estado());
    }
    if (accion === 'ajustes') {
      alertas.cambiarAjustes(cambios);
      return json(res, 200, alertas.estado());
    }
    if (accion === 'obs') {
      if (cual !== 'alertas' && cual !== 'panel') throw new ErrorHttp(400, 'overlay no válido');
      if (typeof escena !== 'string' || !escena.trim()) throw new ErrorHttp(400, 'elige la escena');
      const hecho = await obs((pedir) => obsSetup.anadirOverlay(pedir, cual, escena)).catch((err) => {
        throw new ErrorHttp(502, err instanceof Error ? err.message : String(err));
      });
      log.info(`Panel → OBS: ${hecho}`);
      return json(res, 200, { hecho });
    }
    throw new ErrorHttp(400, 'acción no válida');
  }

  // ---- Temas para hablar (temas.ts) ----
  if (ruta === 'GET /api/temas') {
    const [{ noticias, errores }, ia] = await Promise.all([temas.noticias(url.searchParams.get('forzar') === '1'), iaLocal.estado()]);
    return json(res, 200, {
      noticias: noticias.map((n) => ({ ...n, preparado: temas.preparadoDe(n.id) })),
      errores,
      categorias: temas.CATEGORIAS,
      fuentes: temas.FUENTES.map((f) => ({ nombre: f.nombre, categoria: f.categoria })),
      ...temas.leer(),
      ia,
    });
  }

  if (ruta === 'POST /api/temas') {
    const { accion, id, paso, hecho, pregunta } = await cuerpo(req);
    const idValido = typeof id === 'string' && /^[0-9a-f]{12}$/.test(id);
    if (accion === 'preparar') {
      const n = idValido ? temas.buscar(id as string) : null;
      if (!n) throw new ErrorHttp(404, 'Esa noticia ya no está: actualiza la lista');
      try {
        return json(res, 200, { preparado: await temas.preparar(n), ...temas.leer() });
      } catch (err) {
        throw new ErrorHttp(err instanceof iaLocal.ErrorIaLocal ? 503 : 500, err instanceof Error ? err.message : String(err));
      }
    }
    let r: temas.EstadoTemas | null;
    if (accion === 'vaciar') r = temas.vaciarGuion();
    else if (accion === 'pantalla' && id === null) r = temas.ponerEnPantalla(null);
    else {
      if (!idValido) throw new ErrorHttp(400, 'falta la noticia');
      if (accion === 'apartar') r = temas.apartar(id as string);
      else if (accion === 'quitar') r = temas.quitar(id as string);
      else if (accion === 'hecho') r = temas.marcarHecho(id as string, hecho === true);
      else if (accion === 'mover') r = temas.mover(id as string, paso === -1 ? -1 : 1);
      else if (accion === 'pantalla') r = temas.ponerEnPantalla(id as string, typeof pregunta === 'string' ? pregunta : null);
      else throw new ErrorHttp(400, 'acción no válida');
    }
    if (!r) throw new ErrorHttp(404, 'Esa noticia ya no está, o el guion está lleno (25)');
    return json(res, 200, r);
  }

  if (ruta === 'GET /api/referencias/imagen') {
    const png = await referencias.leer(url.searchParams.get('ruta') ?? '', dirReferencias);
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    res.end(png); return;
  }
  if (ruta === 'GET /api/referencias') return json(res, 200, await referencias.listar(dirReferencias));
  if (ruta === 'POST /api/referencias') return json(res, 201, await referencias.subir(await cuerpo(req, 6 * 1024 * 1024), dirReferencias));

  if (ruta === 'GET /api/biblioteca') return json(res, 200, await biblioteca.listar());

  if (ruta === 'GET /api/obs') {
    const fuente = url.searchParams.get('fuente') || undefined;
    try {
      return json(res, 200, { conectado: true, ...(await obs((pedir) => obsSetup.estado(pedir, fuente))) });
    } catch (err) {
      // Sin OBS no es un error del panel: se enseña el motivo y ya.
      return json(res, 200, { conectado: false, motivo: err instanceof Error ? err.message : String(err) });
    }
  }

  if (ruta === 'POST /api/obs/preparar') {
    const { escena, fuente, efectos } = await cuerpo(req);
    const validos = Object.keys(obsSetup.PREPARABLES);
    if (!Array.isArray(efectos) || !efectos.length || !efectos.every((e) => validos.includes(e))) {
      throw new ErrorHttp(400, 'efectos no válidos');
    }
    const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);
    const resultados = await obs((pedir) =>
      obsSetup.preparar(pedir, { escena: texto(escena), fuente: texto(fuente), efectos: efectos as obsSetup.Preparable[] }),
    ).catch((err) => {
      throw new ErrorHttp(502, err instanceof Error ? err.message : String(err));
    });
    for (const r of resultados) log[r.ok ? 'info' : 'warn'](`Panel → OBS: ${r.mensaje}`);
    return json(res, 200, { resultados });
  }

  if (ruta === 'POST /api/biblioteca/abrir') {
    const { seccion } = await cuerpo(req);
    biblioteca.abrirCarpeta(typeof seccion === 'string' ? (seccion as biblioteca.Seccion) : undefined);
    return json(res, 200, { ok: true });
  }

  if (ruta === 'POST /api/efectos/prueba') {
    const { efecto, escena, fuente } = await cuerpo(req);
    if (!EFECTOS_PRUEBA.includes(efecto as EfectoPrueba)) throw new ErrorHttp(400, 'Efecto no válido');
    if (pruebaEfectoEnMarcha) throw new ErrorHttp(409, 'Ya hay una prueba de efecto en marcha');
    pruebaEfectoEnMarcha = true;
    try {
      await probarVisual(obs, efecto as EfectoPrueba, typeof escena === 'string' ? escena : '', typeof fuente === 'string' ? fuente : '');
      return json(res, 200, { ok: true, aviso: 'Prueba terminada. Sin canjes, mensajes ni cambios en el Loot.' });
    } catch (err) { throw new ErrorHttp(409, err instanceof Error ? err.message : String(err)); }
    finally { pruebaEfectoEnMarcha = false; }
  }

  const ejecutar = /^POST \/api\/acciones\/([\w-]+)\/ejecutar$/.exec(ruta);
  if (ejecutar) {
    const acciones = await sb.acciones();
    const probada = acciones.find(a => a.id === ejecutar[1]);
    if (!probada) throw new ErrorHttp(404, 'La Action ya no existe');
    if (!probada.enabled) throw new ErrorHttp(409, 'La Action está desactivada en Streamer.bot');
    // Como si lo hubieras canjeado tú: sin esto, un %user% en la acción sale
    // tal cual en el chat, porque al probar no hay nadie que haya canjeado.
    const login = config.broadcasterLogin;
    await sb.ejecutarAccion(ejecutar[1], {
      user: login.charAt(0).toUpperCase() + login.slice(1),
      userName: login,
      desdePanel: true,
    });
    log.info(`Panel: acción ${ejecutar[1]} ejecutada a mano.`);
    // 28 sep 2026: la Action a mano solo hacía la parte de Streamer.bot (sonido,
    // OBS). La del bot va con el canje: el cofre del Grito, el objeto de la
    // Maldición, la oferta de la Poción, el temblor del Terremoto. Al probar un
    // efecto del catálogo, el bot recibe un canje tuyo, por el mismo camino.
    const efecto = probada && EFECTOS.find((e) => mismoNombre(probada.name, e.accion));
    if (!efecto) return json(res, 200, { ok: true });
    const yo = users.findByLogin(login);
    if (!yo) return json(res, 200, { ok: true, aviso: 'Ha sonado, pero el bot aún no te conoce: escribe algo en el chat y vuelve a probar.' });
    const parado = loot.motivoEfectoParado(efecto.id, yo.twitch_id);
    await handleEvent(normalize('Twitch.RewardRedemption', {
      id: `panel-${Date.now()}`,
      user_id: yo.twitch_id,
      user_login: yo.login,
      user_name: yo.display_name,
      user_input: '',
      status: 'fulfilled',
      reward: { id: `panel-${efecto.id}`, title: efecto.recompensa, cost: efecto.coste },
      redeemed_at: new Date().toISOString(),
    }, 'simulator'));
    return json(res, 200, { ok: true, aviso: parado && `${efecto.recompensa}: ha sonado, pero en el Loot no pasa nada porque ${parado}.` });
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
      const { obs: _obs, subacciones: _sub, ...resto } = e;
      return {
        ...resto,
        guia: guia(e),
        material: e.material.map((m) => ({ id: m, archivo: enBiblioteca(m) })),
        montado: acciones === null ? null : accion !== null,
        accionId: accion?.id ?? null,
        habilitada: accion?.enabled ?? false,
        requisitoLoot: loot.motivoEfectoParado(e.id, users.findByLogin(config.broadcasterLogin)?.twitch_id ?? ''),
      };
    }),
    // Las Actions del grupo de efectos que no están en el catálogo: las que
    // hayas creado por tu cuenta. Se enseñan para que también puedas probarlas.
    extra: (acciones ?? []).filter(
      (a) => a.name.startsWith(PREFIJO_ACCION) && !EFECTOS.some((e) => mismoNombre(a.name, e.accion)),
    ),
  };
}

async function cuerpo(req: IncomingMessage, limite = MAX_BODY): Promise<Record<string, unknown>> {
  let total = 0;
  const trozos: Buffer[] = [];
  for await (const trozo of req) {
    total += trozo.length;
    if (total > limite) throw new ErrorHttp(413, 'cuerpo demasiado grande');
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
