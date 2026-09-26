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
import * as terremoto from '../interactions/terremoto.js';
import * as directo from '../core/directo.js';
import { handleEvent } from '../core/handler.js';
import { normalize } from '../core/events.js';
import * as titulos from './titulos.js';
import * as previa from './previa.js';
import * as eventos from '../interactions/loot/eventos.js';
import * as temporada from '../interactions/loot/temporada.js';
import * as temporadas from '../data/temporadas.js';
import * as iaLocal from '../services/ia-local.js';
import * as arena from '../interactions/loot/arena.js';
import { MOCHILA_MAX, PROBABILIDADES, tirar } from '../interactions/loot/objetos.js';
import * as cooldowns from '../core/cooldowns.js';
import { conObs, type PedirObs } from '../transport/obs.js';

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

export function crearServidor(sb: PuertoStreamerbot, obs: ConObs = conObs): Server {
  const server = createServer((req, res) => {
    atender(server, sb, obs, req, res).catch((err) => {
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

let laboratorioEnMarcha = false;

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

async function atender(server: Server, sb: PuertoStreamerbot, obs: ConObs, req: IncomingMessage, res: ServerResponse) {
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

  const ejecutar = /^POST \/api\/acciones\/([\w-]+)\/ejecutar$/.exec(ruta);
  if (ejecutar) {
    // Como si lo hubieras canjeado tú: sin esto, un %user% en la acción sale
    // tal cual en el chat, porque al probar no hay nadie que haya canjeado.
    const login = config.broadcasterLogin;
    await sb.ejecutarAccion(ejecutar[1], {
      user: login.charAt(0).toUpperCase() + login.slice(1),
      userName: login,
      desdePanel: true,
    });
    log.info(`Panel: acción ${ejecutar[1]} ejecutada a mano.`);
    // El Terremoto es sonido (Streamer.bot) + temblor (el bot): al probarlo, los dos.
    const probada = (await sb.acciones().catch(() => [])).find((a) => a.id === ejecutar[1]);
    const terremotoCat = EFECTOS.find((e) => e.id === 'terremoto');
    if (probada && terremotoCat && mismoNombre(probada.name, terremotoCat.accion)) terremoto.temblar();
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
      const { obs: _obs, subacciones: _sub, ...resto } = e;
      return {
        ...resto,
        guia: guia(e),
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
