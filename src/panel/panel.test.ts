import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { configureDatabase, truncateAll, getDb } from '../data/db.js';
import * as musica from '../core/musica.js';
import * as killswitch from '../core/killswitch.js';
import * as ajustes from '../core/ajustes.js';
import * as review from '../core/review.js';
import * as policy from '../core/policy.js';
import { setSender } from '../core/output.js';
import * as revision from './revision.js';
import { crearServidor, type PuertoStreamerbot, type ConObs } from './server.js';
import { ErrorObs, autenticacion } from '../transport/obs.js';
import { descodificar } from './importar.js';
import { mostrarBotin, temblar } from './obs-setup.js';
import { EFECTOS, mismoNombre } from './efectos.js';
import * as users from '../data/users.js';
import * as streams from '../data/streams.js';
import * as loot from '../interactions/loot/index.js';

/**
 * Panel de control.
 *
 * Lo que más importa probar aquí no es que pinte bien, es que NADIE que no
 * seas tú pueda tocar el bot a través de él. Por eso la mitad de los tests
 * son de rechazos.
 */

let server: Server;
let puerto: number;
let ejecutadas: string[] = [];
let ultimosArgs: Record<string, unknown> | undefined;
let enviados: string[] = [];

const sbFalso: PuertoStreamerbot = {
  estado: () => ({ conectado: true, destino: 'ws://falso', version: 'Streamer.bot v1.0.7', intentosFallidos: 0 }),
  acciones: async () => [
    { id: 'a1', name: 'Efecto — Grito de guerra', group: 'Efectos', enabled: true },
    { id: 'a2', name: 'Efecto — Baile del chat', group: 'Efectos', enabled: true },
    { id: 'a3', name: 'Otra cosa', group: '', enabled: true },
  ],
  ejecutarAccion: async (id, args) => {
    ejecutadas.push(id);
    ultimosArgs = args;
  },
};

/**
 * Un OBS de mentira, en memoria: lo justo de obs-websocket para preparar
 * efectos. `obsCaido` simula que OBS está cerrado.
 */
let obsCaido = false;
let obs: {
  plugins: string[];
  entradas: { inputName: string; inputKind: string; settings: any }[];
  items: Record<string, { sourceName: string; sceneItemId: number; enabled: boolean }[]>;
  filtros: Record<string, { filterName: string; kind: string; settings: any; enabled: boolean }[]>;
  transformes: Record<number, any>;
};

function reiniciarObs() {
  obsCaido = false;
  obs = {
    plugins: ['color_filter_v2'],
    entradas: [
      { inputName: 'Juego', inputKind: 'game_capture', settings: {} },
      { inputName: 'Micro', inputKind: 'wasapi_input_capture', settings: {} },
    ],
    items: { 'Escena juego': [{ sourceName: 'Juego', sceneItemId: 1, enabled: true }], Charla: [] },
    filtros: { Juego: [] },
    transformes: {},
  };
}

const obsFalso: ConObs = async (trabajo) => {
  if (obsCaido) throw new ErrorObs('No se pudo conectar con OBS');
  let id = Math.max(100, ...Object.values(obs.items).flat().map((i) => i.sceneItemId));
  const yaExiste = () => new ErrorObs('ya existe', 601);
  return trabajo(async (tipo: string, d: any = {}): Promise<any> => {
    switch (tipo) {
      case 'GetSceneList':
        return { scenes: Object.keys(obs.items).reverse().map((sceneName) => ({ sceneName })), currentProgramSceneName: 'Escena juego' };
      case 'GetInputList':
        return { inputs: obs.entradas.map(({ inputName, inputKind }) => ({ inputName, inputKind })) };
      case 'GetSourceFilterKindList':
        return { sourceFilterKinds: obs.plugins };
      case 'GetSourceFilterList':
        return { filters: obs.filtros[d.sourceName] ?? [] };
      case 'CreateInput':
        if (obs.entradas.some((e) => e.inputName === d.inputName)) throw yaExiste();
        obs.entradas.push({ inputName: d.inputName, inputKind: d.inputKind, settings: d.inputSettings });
        obs.filtros[d.inputName] = [];
        obs.items[d.sceneName].push({ sourceName: d.inputName, sceneItemId: ++id, enabled: d.sceneItemEnabled });
        return { sceneItemId: id };
      case 'GetInputSettings':
        return { inputSettings: obs.entradas.find((e) => e.inputName === d.inputName)!.settings };
      case 'SetInputName': {
        const e = obs.entradas.find((x) => x.inputName === d.inputName)!;
        e.inputName = d.newInputName;
        for (const lista of Object.values(obs.items)) {
          for (const i of lista) if (i.sourceName === d.inputName) i.sourceName = d.newInputName;
        }
        return {};
      }
      case 'SetInputSettings':
        obs.entradas.find((e) => e.inputName === d.inputName)!.settings = d.inputSettings;
        return {};
      case 'GetSceneItemList':
        return { sceneItems: obs.items[d.sceneName] };
      case 'SetSceneItemEnabled':
        obs.items[d.sceneName].find((i) => i.sceneItemId === d.sceneItemId)!.enabled = d.sceneItemEnabled;
        return {};
      case 'CreateSceneItem':
        obs.items[d.sceneName].push({ sourceName: d.sourceName, sceneItemId: ++id, enabled: d.sceneItemEnabled });
        return { sceneItemId: id };
      case 'CreateScene':
        if (obs.items[d.sceneName]) throw yaExiste();
        obs.items[d.sceneName] = [];
        obs.filtros[d.sceneName] = [];
        return {};
      case 'RemoveSceneItem':
        obs.items[d.sceneName] = obs.items[d.sceneName]!.filter((i) => i.sceneItemId !== d.sceneItemId);
        return {};
      case 'RemoveInput':
        obs.entradas = obs.entradas.filter((e) => e.inputName !== d.inputName);
        for (const [escena, lista] of Object.entries(obs.items)) obs.items[escena] = lista.filter((i) => i.sourceName !== d.inputName);
        delete obs.filtros[d.inputName];
        return {};
      case 'SetSceneItemIndex': {
        const lista = obs.items[d.sceneName];
        const i = lista.findIndex((x) => x.sceneItemId === d.sceneItemId);
        const [item] = lista.splice(i, 1);
        lista.splice(d.sceneItemIndex, 0, item!);
        return {};
      }
      case 'GetVideoSettings':
        return { baseWidth: 2560, baseHeight: 1440 };
      case 'GetCurrentProgramScene':
        return { currentProgramSceneName: 'Escena juego' };
      case 'GetSceneItemId': {
        const item = obs.items[d.sceneName]?.find((i) => i.sourceName === d.sourceName);
        if (!item) throw new ErrorObs('no existe', 600);
        return { sceneItemId: item.sceneItemId };
      }
      case 'GetSceneItemTransform':
        return { sceneItemTransform: { ...(obs.transformes[d.sceneItemId] ?? { positionX: 0, positionY: 0 }) } };
      case 'SetSceneItemTransform':
        obs.transformes[d.sceneItemId] = d.sceneItemTransform;
        return {};
      case 'CreateSourceFilter': {
        if (!obs.plugins.includes(d.filterKind)) throw new ErrorObs('tipo de filtro desconocido', 605);
        const lista = obs.filtros[d.sourceName];
        if (lista.some((f) => f.filterName === d.filterName)) throw yaExiste();
        lista.push({ filterName: d.filterName, kind: d.filterKind, settings: d.filterSettings, enabled: true });
        return {};
      }
      case 'SetSourceFilterSettings':
        obs.filtros[d.sourceName].find((f) => f.filterName === d.filterName)!.settings = d.filterSettings;
        return {};
      case 'SetSourceFilterEnabled':
        obs.filtros[d.sourceName].find((f) => f.filterName === d.filterName)!.enabled = d.filterEnabled;
        return {};
      default:
        throw new Error(`el OBS de mentira no sabe hacer ${tipo}`);
    }
  });
};

/** Petición cruda: fetch no deja cambiar la cabecera Host, y hay que probarla. */
function pedir(
  metodo: string,
  ruta: string,
  { cuerpo, cabeceras = {} }: { cuerpo?: unknown; cabeceras?: Record<string, string> } = {},
): Promise<{ status: number; body: any; headers: Record<string, any> }> {
  return new Promise((resolve, reject) => {
    const datos = cuerpo === undefined ? undefined : JSON.stringify(cuerpo);
    const req = request(
      {
        host: '127.0.0.1',
        port: puerto,
        path: ruta,
        method: metodo,
        headers: { host: `127.0.0.1:${puerto}`, 'content-type': 'application/json', ...cabeceras },
      },
      (res) => {
        let texto = '';
        res.on('data', (c) => (texto += c));
        res.on('end', () => {
          let body: any = texto;
          try {
            body = JSON.parse(texto);
          } catch {
            /* HTML */
          }
          resolve({ status: res.statusCode ?? 0, body, headers: res.headers });
        });
      },
    );
    req.on('error', reject);
    if (datos) req.write(datos);
    req.end();
  });
}

const post = (ruta: string, cuerpo: unknown = {}) =>
  pedir('POST', ruta, { cuerpo, cabeceras: { 'x-panel': '1' } });

test('música online: configura sin filtrar claves, protege escritura y rechaza proveedores eliminados', async () => {
  assert.equal((await pedir('POST', '/api/musica/online/buscar', { cuerpo: { proveedor: 'youtube', q: 'epic' } })).status, 403);
  assert.equal((await pedir('GET', '/api/musica/online/buscar?proveedor=youtube&q=epic')).status, 404);
  assert.equal((await pedir('POST', '/api/musica/online/configurar', { cuerpo: { youtubeKey: 'clave_de_prueba_1234567890' } })).status, 403);
  const r = await post('/api/musica/online/configurar', { youtubeKey: 'clave_de_prueba_1234567890' });
  assert.equal(r.status, 200);
  assert.equal(r.body.youtube.configurado, true);
  assert.doesNotMatch(JSON.stringify(r.body), /clave_de_prueba/);
  getDb().prepare('UPDATE musica_online SET datos=? WHERE id=1').run(JSON.stringify({ youtubeKey: 'clave_de_prueba_1234567890', clientId: 'antiguo', token: { access: 'antiguo' } }));
  const limpio = await pedir('GET', '/api/musica/online');
  assert.equal(limpio.body.youtube.configurado, true);
  assert.equal(limpio.body.spotify, undefined);
  const guardado = getDb().prepare('SELECT datos FROM musica_online WHERE id=1').get() as { datos: string };
  assert.deepEqual(Object.keys(JSON.parse(guardado.datos)), ['youtubeKey']);
  assert.equal((await pedir('GET', '/spotify/callback?state=inventado&code=falso')).status, 404);
  assert.equal((await post('/api/musica/online/fuente', { fuente: 'spotify' })).status, 400);
  assert.equal((await post('/api/musica/online/spotify/conectar')).status, 400);
  assert.equal((await post('/api/musica/online/youtube/enlace', { url: 'https://youtu.be/abcdefghijk' })).body.id, 'abcdefghijk');
  assert.equal((await post('/api/musica/online/fuente', { fuente: 'youtube' })).body.fuente, 'youtube');
  assert.equal(musica.paraOverlay().sonando, false);
  await post('/api/musica/online/fuente', { fuente: 'local' });
  await post('/api/musica/online/configurar', { youtubeKey: '' });
});

before(async () => {
  configureDatabase(':memory:');
  server = crearServidor(sbFalso, obsFalso);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  puerto = (server.address() as AddressInfo).port;
});

after(() => server.close());

beforeEach(() => {
  truncateAll();
  killswitch.enable('test');
  ajustes.reset();
  policy.reset();
  revision.reset();
  reiniciarObs();
  ejecutadas = [];
  enviados = [];
  setSender(async (t) => {
    enviados.push(t);
  });
});

test('Loot entrega los datos nuevos del panel con la misión apagada por defecto', async () => {
  const r = await pedir('GET', '/api/loot');
  assert.equal(r.status, 200);
  assert.equal(r.body.mision.activa, false);
  assert.ok(Array.isArray(r.body.duelosRecientes));
  assert.equal(r.body.progresion.jugadores, 0);
});

describe('seguridad', () => {
  test('rechaza una cabecera Host ajena (DNS rebinding)', async () => {
    const r = await pedir('GET', '/api/estado', { cabeceras: { host: `malo.example:${puerto}` } });
    assert.equal(r.status, 403);
  });

  test('un POST sin X-Panel no hace nada', async () => {
    const r = await pedir('POST', '/api/interruptor', { cuerpo: { encendido: false } });
    assert.equal(r.status, 403);
    assert.equal(killswitch.isEnabled(), true);
  });

  test('un POST desde otro origen no hace nada aunque traiga X-Panel', async () => {
    const r = await pedir('POST', '/api/interruptor', {
      cuerpo: { encendido: false },
      cabeceras: { 'x-panel': '1', origin: 'https://malo.example' },
    });
    assert.equal(r.status, 403);
    assert.equal(killswitch.isEnabled(), true);
  });

  test('el preflight CORS se deniega', async () => {
    const r = await pedir('OPTIONS', '/api/interruptor');
    assert.equal(r.status, 405);
  });

  test('no sirve archivos fuera de la lista', async () => {
    const r = await pedir('GET', '/../../.env');
    assert.equal(r.status, 404);
  });
});

describe('control del bot', () => {
  test('sirve la página', async () => {
    const r = await pedir('GET', '/');
    assert.equal(r.status, 200);
    assert.match(r.body, /Panel Crid4m/);
  });

  test('el interruptor apaga y enciende', async () => {
    assert.equal((await post('/api/interruptor', { encendido: false })).status, 200);
    assert.equal(killswitch.isEnabled(), false);

    await post('/api/interruptor', { encendido: true });
    assert.equal(killswitch.isEnabled(), true);
  });

  test('los ajustes cambian en caliente', async () => {
    await post('/api/ajustes', { espontaneas: false, revision: false });
    assert.equal(ajustes.interaccionesEspontaneas(), false);
    assert.equal(ajustes.modoRevision(), false);
    // review.ts lee el mismo ajuste: sin revisión, lo de la IA sale sin preguntar.
    assert.deepEqual(await review.review('hola', 'test', true), { approved: true });
  });

  test('el estado lo cuenta todo', async () => {
    const { status, body } = await pedir('GET', '/api/estado');
    assert.equal(status, 200);
    assert.equal(body.bot.interruptor, true);
    assert.equal(body.streamerbot.conectado, true);
    assert.equal(body.directo, null);
    assert.ok(Array.isArray(body.log));
    assert.equal(typeof body.gasto.today.calls, 'number');
  });

  test('escribir en el chat pasa por policy: con el bot apagado no sale', async () => {
    killswitch.disable('test');
    const r = await post('/api/chat', { texto: 'hola chat' });
    assert.equal(r.status, 409);
    assert.deepEqual(enviados, []);
  });

  test('escribir en el chat puede mencionar a quien tú pongas', async () => {
    const r = await post('/api/chat', { texto: '@Armifer91 gracias por venir' });
    assert.equal(r.status, 200);
    assert.deepEqual(enviados, ['@Armifer91 gracias por venir']);
  });
});

describe('efectos', () => {
  test('cruza el catálogo con las Actions de Streamer.bot', async () => {
    const { body } = await pedir('GET', '/api/efectos');
    const grito = body.efectos.find((e: any) => e.id === 'grito');
    const pocion = body.efectos.find((e: any) => e.id === 'pocion');

    assert.equal(body.conectado, true);
    assert.equal(grito.montado, true);
    assert.equal(grito.accionId, 'a1');
    assert.equal(pocion.montado, false);
    assert.equal(body.efectos.length, EFECTOS.length);
    // Las tuyas que no están en el catálogo también salen, y solo esas.
    assert.deepEqual(body.extra.map((a: any) => a.id), ['a2']);
  });

  test('reconoce la Action aunque se escriba con guion normal', () => {
    assert.equal(mismoNombre('efecto - grito de guerra', 'Efecto — Grito de guerra'), true);
    assert.equal(mismoNombre('Efecto — Lag', 'Efecto — Grito de guerra'), false);
  });

  test('probar un efecto ejecuta su Action', async () => {
    const r = await post('/api/acciones/a1/ejecutar');
    assert.equal(r.status, 200);
    assert.deepEqual(ejecutadas, ['a1']);
  });

  test('al probar, la acción recibe un usuario: %user% no sale tal cual en el chat', async () => {
    await post('/api/acciones/a1/ejecutar');
    assert.equal(ultimosArgs?.user, 'Crid4m');
    assert.equal(ultimosArgs?.userName, 'crid4m');
  });

  // 28 sep 2026: «Probar» solo hacía sonar el Grito; el cofre de guerra no caía.
  describe('probar hace también la parte del bot, como un canje tuyo', () => {
    const yo = { id: '1001', login: 'crid4m', displayName: 'Crid4m', isBroadcaster: true, isModerator: false, isVip: false, isSubscriber: false, rawRole: null };
    beforeEach(() => loot.reset());
    after(() => loot.reset());

    test('Grito con directo: el bot llama a las armas en el chat', async () => {
      users.touch(yo);
      ajustes.setLootActivo(true, 'test');
      streams.open();
      const r = await post('/api/acciones/a1/ejecutar');
      assert.equal(r.body.aviso, null);
      assert.equal(enviados.length, 1);
      assert.match(enviados[0]!, /A las armas.*Crid4m.*cofre de guerra/);
    });

    test('Grito sin directo: suena, y el panel dice por qué no cae el cofre', async () => {
      users.touch(yo);
      ajustes.setLootActivo(true, 'test');
      const r = await post('/api/acciones/a1/ejecutar');
      assert.deepEqual(ejecutadas, ['a1']);
      assert.match(r.body.aviso, /Grito de guerra: ha sonado.*sin directo marcado/);
      assert.deepEqual(enviados, []);
    });

    test('si el bot aún no te conoce, lo dice en vez de canjear a nombre de nadie', async () => {
      const r = await post('/api/acciones/a1/ejecutar');
      assert.match(r.body.aviso, /aún no te conoce/);
    });

    test('una Action que no es del catálogo solo se ejecuta', async () => {
      users.touch(yo);
      const r = await post('/api/acciones/a3/ejecutar');
      assert.deepEqual(ejecutadas, ['a3']);
      assert.equal(r.body.aviso, undefined);
    });
  });
});

describe('biblioteca', () => {
  test('todo el material del catálogo existe en la biblioteca', async () => {
    const { body } = await pedir('GET', '/api/efectos');
    const faltan = body.efectos.flatMap((e: any) => e.material.filter((m: any) => !m.archivo).map((m: any) => m.id));
    assert.deepEqual(faltan, [], 'falta material: ¿has ejecutado npm run sonidos?');
  });

  test('lista los archivos con su ruta y quién los usa', async () => {
    const { body } = await pedir('GET', '/api/biblioteca');
    const grito = body.sonidos.find((s: any) => s.nombre === 'grito-de-guerra.wav');
    assert.ok(grito);
    assert.deepEqual(grito.usadoPor, ['Grito de guerra']);
    assert.match(grito.ruta, /biblioteca[\\/]sonidos[\\/]grito-de-guerra\.wav$/);
  });

  test('sirve un sonido con su tipo y encerrado en sandbox', async () => {
    const r = await pedir('GET', '/biblioteca/sonidos/grito-de-guerra.wav');
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'audio/wav');
    assert.equal(r.headers['content-security-policy'], 'sandbox allow-scripts');
  });

  test('no sirve nada fuera de sus carpetas', async () => {
    for (const ruta of [
      '/biblioteca/sonidos/..%2F..%2F.env',
      '/biblioteca/sonidos/%2E%2E%5C%2E%2E%5C.env',
      '/biblioteca/../.env',
      '/biblioteca/secretos/grito-de-guerra.wav',
      '/biblioteca/sonidos/grito-de-guerra.exe',
      '/biblioteca/sonidos/sub/grito-de-guerra.wav',
      '/biblioteca/imagenes/twitch/..%2F..%2F..%2F.env',
      '/biblioteca/imagenes/twitch/%2E%2E/%2E%2E/%2E%2E/.env',
      '/biblioteca/imagenes/../../.env',
      '/biblioteca/imagenes/twitch%2F..%2F..%2Foro-moneda.png',
      '/biblioteca/imagenes/a/b/c/d/icono.png',
      '/biblioteca/imagenes/twitch/cofre-28.exe',
    ]) {
      const r = await pedir('GET', ruta);
      assert.notEqual(r.status, 200, ruta);
    }
  });

  test('las imágenes pueden estar en subcarpetas, y se listan con la suya', async () => {
    const { body } = await pedir('GET', '/api/biblioteca');
    const icono = body.imagenes.find((i: any) => i.carpeta === 'twitch' && i.nombre === 'cofre-28.png');
    assert.ok(icono, 'falta imagenes/twitch/cofre-28.png');
    assert.equal(icono.url, '/biblioteca/imagenes/twitch/cofre-28.png');
    const r = await pedir('GET', icono.url);
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'image/png');
  });

  test('abrir la carpeta exige X-Panel, como todo lo que hace algo', async () => {
    const r = await pedir('POST', '/api/biblioteca/abrir', { cuerpo: {} });
    assert.equal(r.status, 403);
  });
});

describe('revisión desde el panel', () => {
  test('aprobar en el panel publica', async () => {
    const aprobador = revision.aprobadorPanel();
    const veredicto = aprobador('texto de la IA', 'pregunta-ia');

    const { body } = await pedir('GET', '/api/estado');
    assert.equal(body.pendientes.length, 1);
    assert.equal(body.pendientes[0].text, 'texto de la IA');

    await post(`/api/revision/${body.pendientes[0].id}`, { aprobar: true });
    assert.deepEqual(await veredicto, { approved: true });
    assert.equal(revision.lista().length, 0);
  });

  test('decidir dos veces: la segunda da 404', async () => {
    const veredicto = revision.aprobadorPanel()('x', 'y');
    const id = revision.lista()[0].id;
    await post(`/api/revision/${id}`, { aprobar: false });
    assert.equal((await post(`/api/revision/${id}`, { aprobar: true })).status, 404);
    assert.equal((await veredicto).approved, false);
  });

  test('si nadie contesta, NO se publica', async () => {
    const veredicto = await revision.aprobadorPanel(undefined, 20)('x', 'y');
    assert.deepEqual(veredicto, { approved: false, reason: 'sin respuesta a tiempo' });
    assert.equal(revision.lista().length, 0);
  });

  test('si contesta la consola, el panel lo retira', async () => {
    const veredicto = revision.aprobadorPanel(async () => ({ approved: true }))('x', 'y');
    assert.deepEqual(await veredicto, { approved: true });
    assert.equal(revision.lista().length, 0);
  });

  test('si contesta el panel, la consola se retira', async () => {
    let senal: AbortSignal | null = null;
    const consola = (_t: string, _r: string, s: AbortSignal) => {
      senal = s;
      return new Promise<any>(() => {}); // nunca contesta
    };
    const veredicto = revision.aprobadorPanel(consola)('x', 'y');
    revision.decidir(revision.lista()[0].id, true);

    assert.deepEqual(await veredicto, { approved: true });
    assert.equal(senal!.aborted, true);
  });
});

describe('preparar OBS', () => {
  const preparar = (cuerpo: unknown) => post('/api/obs/preparar', cuerpo);

  test('enseña las escenas en el orden de OBS y solo las fuentes que pueden ser el juego', async () => {
    const { body } = await pedir('GET', '/api/obs?fuente=Juego');
    assert.equal(body.conectado, true);
    assert.deepEqual(body.escenas, ['Escena juego', 'Charla']);
    assert.deepEqual(body.fuentes.map((f: any) => f.nombre), ['Juego']);
    assert.deepEqual(body.existe, { pocion: false, botin: false, jefe: false, maldicion: false, lag: false });
    assert.equal(body.pluginFreeze, false);
  });

  test('sin OBS, el panel lo dice y no falla', async () => {
    obsCaido = true;
    const { status, body } = await pedir('GET', '/api/obs');
    assert.equal(status, 200);
    assert.equal(body.conectado, false);
    assert.match(body.motivo, /OBS/);
  });

  test('la poción se crea OCULTA y apuntando al overlay de la biblioteca', async () => {
    const r = await preparar({ escena: 'Escena juego', efectos: ['pocion'] });
    assert.equal(r.body.resultados[0].ok, true);
    const fuente = obs.entradas.find((e) => e.inputName === 'FX Pocion')!;
    assert.equal(fuente.inputKind, 'browser_source');
    assert.match(fuente.settings.local_file, /biblioteca[\\/]overlays[\\/]pocion\.html$/);
    assert.equal(fuente.settings.shutdown, true);
    assert.equal(obs.items['Escena juego'].find((i) => i.sourceName === 'FX Pocion')!.enabled, false);
  });

  test('la barra del jefe se crea VISIBLE (sin jefe es transparente) y servida por el panel', async () => {
    const r = await preparar({ escena: 'Escena juego', efectos: ['jefe'] });
    assert.equal(r.body.resultados[0].ok, true);
    const fuente = obs.entradas.find((e) => e.inputName === 'FX Jefe')!;
    assert.match(fuente.settings.url, /^http:\/\/127\.0\.0\.1:\d+\/biblioteca\/overlays\/jefe\.html$/);
    assert.equal(obs.items['Escena juego'].find((i) => i.sourceName === 'FX Jefe')!.enabled, true);
  });

  test('una fuente nueva ocupa todo el lienzo, sea del tamaño que sea', async () => {
    await preparar({ escena: 'Escena juego', efectos: ['pocion'] });
    const id = obs.items['Escena juego'].find((i) => i.sourceName === 'FX Pocion')!.sceneItemId;
    const t = obs.transformes[id];
    assert.equal(t.positionX, 0);
    assert.equal(t.scaleX, 2560 / 1920);
    assert.equal(t.scaleY, 1440 / 1080);
  });

  test('si ya existía, no se le toca la posición: la puedes haber movido tú', async () => {
    await preparar({ escena: 'Escena juego', efectos: ['pocion'] });
    obs.transformes = {};
    await preparar({ escena: 'Escena juego', efectos: ['pocion'] });
    assert.deepEqual(obs.transformes, {});
  });

  test('pulsar dos veces no duplica nada', async () => {
    await preparar({ escena: 'Escena juego', fuente: 'Juego', efectos: ['pocion', 'maldicion'] });
    const r = await preparar({ escena: 'Escena juego', fuente: 'Juego', efectos: ['pocion', 'maldicion'] });
    assert.ok(r.body.resultados.every((x: any) => x.ok));
    assert.equal(obs.entradas.filter((e) => e.inputName === 'FX Pocion').length, 1);
    assert.equal(obs.items['Escena juego'].filter((i) => i.sourceName === 'FX Pocion').length, 1);
    assert.equal(obs.filtros.Juego.filter((f) => f.filterName === 'FX Maldicion').length, 1);
  });

  test('si la poción ya existe en otra escena, se añade a esta sin duplicar la fuente', async () => {
    await preparar({ escena: 'Charla', efectos: ['pocion'] });
    await preparar({ escena: 'Escena juego', efectos: ['pocion'] });
    assert.equal(obs.entradas.filter((e) => e.inputName === 'FX Pocion').length, 1);
    assert.equal(obs.items['Escena juego'].find((i) => i.sourceName === 'FX Pocion')!.enabled, false);
  });

  test('la maldición queda en blanco y negro y APAGADA', async () => {
    await preparar({ fuente: 'Juego', efectos: ['maldicion'] });
    const filtro = obs.filtros.Juego.find((f) => f.filterName === 'FX Maldicion')!;
    assert.equal(filtro.kind, 'color_filter_v2');
    assert.equal(filtro.settings.saturation, -1);
    assert.equal(filtro.enabled, false);
  });

  test('el lag sin su plugin explica qué falta, y lo demás sigue adelante', async () => {
    const r = await preparar({ escena: 'Escena juego', fuente: 'Juego', efectos: ['lag', 'maldicion'] });
    const [lag, maldicion] = r.body.resultados;
    assert.equal(lag.ok, false);
    assert.match(lag.mensaje, /Freeze Filter/);
    assert.equal(maldicion.ok, true);
  });

  test('sin escena o sin fuente, lo dice en vez de adivinar', async () => {
    const r = await preparar({ efectos: ['pocion', 'maldicion'] });
    assert.deepEqual(r.body.resultados.map((x: any) => x.ok), [false, false]);
    assert.equal(obs.entradas.some((e) => e.inputName === 'FX Pocion'), false);
  });

  test('exige X-Panel y rechaza efectos inventados', async () => {
    assert.equal((await pedir('POST', '/api/obs/preparar', { cuerpo: { efectos: ['pocion'] } })).status, 403);
    assert.equal((await preparar({ efectos: ['borrar-todo'] })).status, 400);
    assert.equal((await preparar({ efectos: [] })).status, 400);
  });

  test('la autenticación sigue la receta de obs-websocket', () => {
    const a = autenticacion('secreto', 'sal', 'reto');
    assert.equal(a, autenticacion('secreto', 'sal', 'reto'));
    assert.notEqual(a, autenticacion('otro', 'sal', 'reto'));
    assert.match(a, /^[A-Za-z0-9+/]{43}=$/);
  });
});

describe('código para importar', () => {
  test('genera el código con la escena y la fuente elegidas', async () => {
    const { status, body } = await pedir('GET', '/api/efectos/importar?ids=pocion,maldicion&escena=EMPEZAMOS&fuente=Captura%20de%20ventana');
    assert.equal(status, 200);
    const datos = descodificar(body.codigo);
    assert.equal(datos.data.actions.length, 2);
    assert.equal(datos.data.actions[0].subActions[1].sceneName, 'EMPEZAMOS');
    assert.equal(datos.data.actions[1].subActions[1].sourceName, 'Captura de ventana');
  });

  test('sin escena o con efectos inventados, no genera nada', async () => {
    assert.equal((await pedir('GET', '/api/efectos/importar?ids=pocion&fuente=x')).status, 400);
    assert.equal((await pedir('GET', '/api/efectos/importar?ids=meteorito&escena=a&fuente=b')).status, 400);
    assert.equal((await pedir('GET', '/api/efectos/importar?escena=a&fuente=b')).status, 400);
  });
});

describe('banner del Loot', () => {
  const item = (nombre = 'FX Botin') => obs.items['Escena juego'].find((i) => i.sourceName === nombre);
  const mostrar = (datos: { quien: string; objeto: string; rareza: string; origen: string }, visto: boolean[] = []) =>
    obsFalso((pedir) => mostrarBotin(pedir, datos, { esperar: async () => { visto.push(item()!.enabled); } }));

  test('Preparar OBS crea FX Botin oculto, servido por el panel y con su audio en OBS', async () => {
    const r = await post('/api/obs/preparar', { escena: 'Escena juego', efectos: ['botin'] });
    assert.equal(r.body.resultados[0].ok, true);
    const fuente = obs.entradas.find((e) => e.inputName === 'FX Botin')!;
    assert.equal(fuente.settings.is_local_file, false);
    assert.match(fuente.settings.url, /^http:\/\/127\.0\.0\.1:\d+\/biblioteca\/overlays\/botin\.html$/);
    assert.equal(fuente.settings.reroute_audio, true);
    assert.equal(item()!.enabled, false);
  });

  test('se enseña con quién, qué, rareza y origen, y se vuelve a esconder', async () => {
    await post('/api/obs/preparar', { escena: 'Escena juego', efectos: ['botin'] });
    const visto: boolean[] = [];
    await mostrar({ quien: 'Pepe & Cía', objeto: 'Ala del Fénix', rareza: 'epico', origen: 'oro' }, visto);
    const url = new URL(obs.entradas.find((e) => e.inputName === 'FX Botin')!.settings.url);
    assert.equal(url.searchParams.get('user'), 'Pepe & Cía');
    assert.equal(url.searchParams.get('item'), 'Ala del Fénix');
    assert.equal(url.searchParams.get('rareza'), 'epico');
    assert.equal(url.searchParams.get('origen'), 'oro');
    assert.doesNotMatch(url.search, /\+/, 'espacios como %20: OBS no siempre entiende el +');
    assert.deepEqual(visto, [true], 'visible mientras espera');
    assert.equal(item()!.enabled, false);
  });

  test('la fuente antigua FX Legendario se renombra sola, sin recolocarla', async () => {
    obs.entradas.push({ inputName: 'FX Legendario', inputKind: 'browser_source', settings: {} });
    obs.items['Escena juego'].push({ sourceName: 'FX Legendario', sceneItemId: 77, enabled: false });
    await mostrar({ quien: 'pepe', objeto: 'x', rareza: 'comun', origen: 'cofre' });
    assert.equal(item('FX Legendario'), undefined);
    assert.equal(item()!.sceneItemId, 77);
    assert.deepEqual(obs.transformes, {}, 'no se le toca el sitio');
  });

  test('con la fuente en varias escenas, sale en la que se emite', async () => {
    // 27 sep: estaba en las cinco escenas y se encendía en «✦ Pausa» (la primera).
    await post('/api/obs/preparar', { escena: 'Escena juego', efectos: ['botin'] });
    // GetSceneList del OBS falso las da al revés: la última añadida sale la primera.
    obs.items = { ...obs.items, '✦ Pausa': [{ sourceName: 'FX Botin', sceneItemId: 90, enabled: false }] };
    const visto: boolean[] = [];
    await mostrar({ quien: 'pepe', objeto: 'x', rareza: 'comun', origen: 'cofre' }, visto);
    assert.deepEqual(visto, [true], 'visible en la escena en emisión');
    assert.equal(obs.items['✦ Pausa']![0]!.enabled, false, 'la de Pausa no se toca');
  });

  test('sin la fuente creada, lo dice en vez de fallar a medias', async () => {
    await assert.rejects(mostrar({ quien: 'pepe', objeto: 'x', rareza: 'comun', origen: 'cofre' }), /Preparar en OBS/);
  });
});

describe('terremoto', () => {
  test('mueve la fuente del juego a un lado y a otro, y la deja donde estaba', async () => {
    const id = obs.items['Escena juego'].find((i) => i.sourceName === 'Juego')!.sceneItemId;
    obs.transformes[id] = { positionX: 100, positionY: 50 };
    const posiciones: Array<[number, number]> = [];
    await obsFalso((pedir) => temblar(pedir, { fuente: 'Juego', ms: 200, paso: 40 }, {
      esperar: async () => { posiciones.push([obs.transformes[id].positionX, obs.transformes[id].positionY]); },
    }));
    assert.equal(posiciones.length, 5);
    assert.ok(posiciones.some(([x, y]) => x !== 100 || y !== 50), 'ha temblado');
    assert.ok(posiciones.every(([x, y]) => Math.abs(x - 100) <= 16 && Math.abs(y - 50) <= 16), 'sin pasarse');
    assert.equal(obs.transformes[id].positionX, 100);
    assert.equal(obs.transformes[id].positionY, 50);
  });

  test('si la fuente no existe, lo dice sin mover nada', async () => {
    await assert.rejects(obsFalso((pedir) => temblar(pedir, { fuente: 'No existe', ms: 100 })), /No encuentro la fuente «No existe»/);
  });
});

describe('pruebas de suscriptores', () => {
  test('la prueba de sub da un cofre a la persona de prueba, y «borrar» lo quita', async () => {
    const { getDb } = await import('../data/db.js');
    const ajustes = await import('../core/ajustes.js');
    ajustes.setLootActivo(true, 'test');
    const r = await post('/api/pruebas/mecenas', { tipo: 'sub' });
    assert.equal(r.status, 200);
    const filas = () => (getDb().prepare("SELECT COUNT(*) n FROM loot WHERE twitch_id LIKE 'prueba-%'").get() as { n: number }).n;
    assert.equal(filas(), 1);
    const b = await post('/api/pruebas/mecenas/borrar', {});
    assert.equal(b.status, 200);
    assert.equal(filas(), 0);
  });

  test('una prueba que no existe, no', async () => {
    assert.equal((await post('/api/pruebas/mecenas', { tipo: 'meteorito' })).status, 400);
  });
});

describe('Inicio: revisión previa y resumen del directo', () => {
  test('la revisión previa lo mira todo y dice qué falta, sin tocar OBS', async () => {
    const antes = JSON.stringify(obs);
    const r = await pedir('GET', '/api/previa');
    assert.equal(r.status, 200);
    const por = (nombre: string) => r.body.find((c: any) => c.nombre === nombre);
    assert.equal(por('Interruptor').nivel, 'ok');
    assert.equal(por('Conexión').nivel, 'ok');
    assert.equal(por('Fuentes de efectos').nivel, 'aviso');
    assert.match(por('Efectos').detalle, /Sin su Action/);
    assert.equal(JSON.stringify(obs), antes, 'solo lee');
  });

  test('sin OBS, la revisión lo marca como fallo y no revienta', async () => {
    obsCaido = true;
    const r = await pedir('GET', '/api/previa');
    const obsFila = r.body.find((c: any) => c.grupo === 'OBS');
    assert.equal(obsFila.nivel, 'fallo');
  });

  test('el resumen cuenta el último directo: gente, usos, bloqueos y botín', async () => {
    const { getDb } = await import('../data/db.js');
    const db = getDb();
    const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    db.prepare('INSERT INTO streams (started_at, ended_at) VALUES (?, ?)').run(hace(90), hace(5));
    db.prepare("INSERT INTO users (twitch_id, login, display_name, first_seen, last_seen) VALUES ('id-ana', 'ana', 'Ana', ?, ?)").run(hace(60), hace(10));
    const reg = db.prepare('INSERT INTO interactions (interaction, twitch_id, at, status, detail) VALUES (?, ?, ?, ?, ?)');
    reg.run('loot-poder', 'id-ana', hace(50), 'sent', null);
    reg.run('loot-poder', 'id-ana', hace(40), 'sent', null);
    reg.run('loot-duelo', 'id-ana', hace(30), 'sent', null);
    reg.run('loot', null, hace(20), 'blocked', 'cofre: ana=raro');
    reg.run('primer-mensaje', 'id-luis', hace(25), 'blocked', 'hourly-budget: tope');
    reg.run('loot-poder', 'id-ana', hace(200), 'sent', null);
    db.prepare("INSERT INTO loot (twitch_id, display_name, objeto, rareza, origen, at) VALUES ('id-ana', 'Ana', 'Filo del Vacío', 'legendario', 'cofre', ?)").run(hace(20));

    const r = await pedir('GET', '/api/resumen');
    assert.equal(r.status, 200);
    const s = r.body.resumen;
    assert.equal(s.minutos, 85);
    assert.equal(s.personas.total, 1, 'luis no tiene ficha ni botín: solo cuenta quien tiene nombre');
    assert.deepEqual(s.personas.nuevos, ['Ana']);
    assert.deepEqual(s.usos[0], { que: '!poder', n: 2 }, 'lo de antes del directo no cuenta');
    assert.equal(s.duelos, 1);
    assert.deepEqual(s.bloqueos, [{ motivo: 'Tope de mensajes por hora', n: 1 }, { motivo: 'Otro motivo (mira el registro)', n: 1 }]);
    assert.equal(s.loot.cofres[0].tipo, 'Del chat (cada 20-30 min)');
    assert.equal(s.loot.destacados[0].objeto, 'Filo del Vacío');
    assert.equal(r.body.directos.length, 1);
  });

  test('el evento de la semana se fija y se quita desde el panel', async () => {
    assert.equal((await post('/api/loot/evento', { eleccion: 'arena' })).body.actual.id, 'arena');
    assert.equal((await post('/api/loot/evento', { eleccion: 'ninguno' })).body.actual, null);
    assert.equal((await post('/api/loot/evento', { eleccion: 'no-existe' })).status, 400);
    await post('/api/loot/evento', { eleccion: 'auto' });
  });
});

describe('Escenas', () => {
  test('el overlay de escena lee sus datos con CORS, sin chat fuera de Charla', async () => {
    const r = await pedir('GET', '/api/overlay/escena?tipo=inicio');
    assert.equal(r.status, 200);
    assert.equal(r.headers['access-control-allow-origin'], '*');
    assert.equal(r.body.config.titulo, 'Empezamos en breve');
    assert.deepEqual(r.body.chat, []);
    assert.equal(r.body.final, null);
    assert.equal((await pedir('GET', '/api/overlay/escena?tipo=final')).body.final, null, 'sin directos, el Final sale a cero');
    const { getDb } = await import('../data/db.js');
    getDb().prepare('INSERT INTO streams (started_at, ended_at) VALUES (?, NULL)').run(new Date(Date.now() - 60 * 60_000).toISOString());
    const fin = await pedir('GET', '/api/overlay/escena?tipo=final');
    assert.equal(fin.body.final.minutos, 60, 'el Final lleva el resumen del directo');
  });

  test('los textos, la cuenta atrás y el avatar se guardan; lo raro se ignora', async () => {
    const hasta = new Date(Date.now() + 5 * 60_000).toISOString();
    const r = await post('/api/escenas', { titulo: 'Hoy raid', hasta, avatar: true, inventado: 1, pausa: 42 });
    assert.equal(r.body.config.titulo, 'Hoy raid');
    assert.equal(r.body.config.hasta, hasta);
    assert.equal(r.body.config.avatar, true);
    assert.equal(r.body.config.pausa, 'Estira las piernas y bebe agua 💧');
    assert.equal((await post('/api/escenas', { titulo: '' })).body.config.titulo, 'Empezamos en breve', 'vacío = por defecto');
    assert.equal((await post('/api/escenas', { hasta: null })).body.config.hasta, null);
    await post('/api/escenas', { avatar: false });
  });

  test('Crear en OBS: escena con overlay, cámara debajo en su hueco, y sin cambiar la escena en emisión', async () => {
    obs.entradas.push({ inputName: 'Cámara', inputKind: 'dshow_input', settings: {} }, { inputName: 'FX Jefe', inputKind: 'browser_source', settings: {} });
    const r = await post('/api/escenas/obs', { tipo: 'charla' });
    assert.equal(r.status, 200);
    const items = obs.items['✦ Charla']!.map((i) => i.sourceName);
    assert.deepEqual(items, ['Cámara', 'ESC Charla', 'FX Jefe'], 'la cámara abajo, el overlay encima y la barra del jefe arriba');
    const cam = obs.items['✦ Charla']!.find((i) => i.sourceName === 'Cámara')!;
    // Lienzo de 2560×1440: el hueco (48, 48, 1280×720) escalado.
    assert.equal(obs.transformes[cam.sceneItemId].positionX, 64);
    assert.equal(obs.transformes[cam.sceneItemId].boundsWidth, 1280 * (2560 / 1920));
    assert.match(obs.entradas.find((e) => e.inputName === 'ESC Charla')!.settings.url, /escena\.html\?tipo=charla$/);

    // Otra vez: no duplica ni mueve nada.
    const otra = await post('/api/escenas/obs', { tipo: 'charla' });
    assert.equal(obs.items['✦ Charla']!.length, 3);
    assert.ok(otra.body.hecho.some((x: string) => /ya existía/.test(x)));
    assert.equal((await post('/api/escenas/obs', { tipo: 'otra' })).status, 400);
  });

  test('Empezando pronto retro se sirve completo y se prepara en OBS una sola vez', async () => {
    for (const ruta of [
      '/biblioteca/overlays/empezando-pronto.html',
      '/biblioteca/overlays/empezando-pronto/escena.css',
      '/biblioteca/overlays/empezando-pronto/escena.js',
      '/biblioteca/overlays/empezando-pronto/habitacion.webp',
      '/biblioteca/overlays/empezando-pronto/erizo.png',
      '/biblioteca/overlays/empezando-pronto/Orbitron-900.ttf',
    ]) assert.equal((await pedir('GET', ruta)).status, 200, ruta);
    assert.equal((await pedir('GET', '/biblioteca/overlays/empezando-pronto/../../server.ts')).status, 404);
    const primera = await post('/api/escenas/obs', { tipo: 'retro' });
    assert.equal(primera.status, 200);
    assert.deepEqual(obs.items['✦ Empezando pronto · Retro']!.map((i) => i.sourceName), ['ESC Empezando pronto Retro']);
    assert.match(obs.entradas.find((e) => e.inputName === 'ESC Empezando pronto Retro')!.settings.url, /\/biblioteca\/overlays\/empezando-pronto\.html$/);
    assert.equal((await post('/api/escenas/obs', { tipo: 'retro' })).status, 200);
    assert.equal(obs.items['✦ Empezando pronto · Retro']!.length, 1);
  });

  test('Charla + compartir usa la captura original dentro de una capa, sin copiarla ni filtrarla', async () => {
    const escena = '✦ Charla + compartir', capa = 'ESC Compartir (capa)';
    obs.entradas.push({ inputName: 'Cámara', inputKind: 'dshow_input', settings: {} });
    obs.entradas.push({ inputName: 'Navegador', inputKind: 'window_capture', settings: {} });
    // Una copia de la versión anterior: se retira.
    obs.entradas.push({ inputName: 'ESC Compartir contenido', inputKind: 'game_capture', settings: {} });
    obs.entradas.find((e) => e.inputName === 'Juego')!.settings = { capture_mode: 'window' };
    const r = await post('/api/escenas/obs', { tipo: 'compartir', fuenteCompartida: 'Juego' });
    assert.equal(r.status, 200);
    assert.deepEqual(obs.items[escena]!.map((i) => i.sourceName), ['Cámara', capa, 'ESC Charla compartir']);
    assert.deepEqual(obs.items[capa]!.map((i) => i.sourceName), ['Juego']);
    assert.ok(!obs.entradas.some((e) => e.inputName === 'ESC Compartir contenido'));
    assert.deepEqual(obs.entradas.find((e) => e.inputName === 'Juego')!.settings, { capture_mode: 'window' });
    assert.equal(obs.filtros['Juego']!.length, 0);
    // Opaca por defecto: ni siquiera hace falta el filtro.
    assert.equal(obs.filtros[capa]!.length, 0);
    const enEscena = obs.items[escena]!.find((i) => i.sourceName === capa)!;
    assert.equal(obs.transformes[enEscena.sceneItemId].boundsWidth, 850 * (2560 / 1920));
    assert.equal(obs.transformes[enEscena.sceneItemId].positionX, 1010 * (2560 / 1920));

    // Cambiar de captura y bajar la opacidad: la capa solo lleva la nueva, y el filtro va en la capa.
    assert.equal((await post('/api/escenas/obs', { tipo: 'compartir', fuenteCompartida: 'Navegador', opacidad: .72 })).status, 200);
    assert.equal(obs.items[escena]!.length, 3);
    assert.deepEqual(obs.items[capa]!.map((i) => i.sourceName), ['Navegador']);
    assert.ok(obs.items['Escena juego']!.some((i) => i.sourceName === 'Juego'), 'la captura sigue en su escena');
    assert.equal(obs.filtros[capa]![0]!.settings.opacity, .72);
    assert.equal(obs.filtros['Navegador'], undefined);
    assert.equal((await post('/api/escenas/obs', { tipo: 'compartir', fuenteCompartida: 'Navegador', opacidad: 1 })).status, 200);
    assert.equal(obs.filtros[capa]![0]!.settings.opacity, 1);
    assert.equal((await post('/api/escenas/obs', { tipo: 'compartir', fuenteCompartida: 'Juego', opacidad: .2 })).status, 400);
    assert.equal((await post('/api/escenas/obs', { tipo: 'compartir', fuenteCompartida: 'ESC Compartir contenido' })).status, 502);
  });
});

describe('Avatar sin cámara', () => {
  test('se añade a la escena elegida, abajo a la derecha, y no se duplica', async () => {
    const r = await post('/api/escenas/obs', { tipo: 'avatar', escena: 'Escena juego' });
    assert.equal(r.status, 200);
    const item = obs.items['Escena juego']!.find((i) => i.sourceName === 'ESC Avatar')!;
    assert.ok(item.enabled, 'visible: la página es transparente mientras el avatar esté apagado');
    assert.equal(obs.transformes[item.sceneItemId].scaleX, 0.5 * (2560 / 1920));
    assert.match(obs.entradas.find((e) => e.inputName === 'ESC Avatar')!.settings.url, /avatar\.html$/);
    const otra = await post('/api/escenas/obs', { tipo: 'avatar', escena: 'Escena juego' });
    assert.match(otra.body.hecho[0], /ya estaba/);
    assert.equal(obs.items['Escena juego']!.filter((i) => i.sourceName === 'ESC Avatar').length, 1);
    assert.equal((await post('/api/escenas/obs', { tipo: 'avatar' })).status, 400);
  });
});

test('música: GET no controla; el reporte exige credencial privada y turno', async () => {
  const raiz = `http://127.0.0.1:${puerto}`;
  const consulta = await fetch(`${raiz}/api/overlay/musica?terminada=falsa`);
  assert.equal(consulta.status, 200);
  assert.equal('credencial' in (await consulta.json() as Record<string, unknown>), false);
  const reporte = (d: object) => fetch(`${raiz}/api/reproductor/musica`, { method:'POST',headers:{'Content-Type':'text/plain',Origin:'null'},body:JSON.stringify(d) });
  assert.equal((await reporte({id:'falsa',turno:0,tipo:'terminada'})).status,403);
  const html = await (await fetch(`${raiz}/biblioteca/overlays/musica.html`)).text();
  const credencial = html.match(/credencial: '([a-f0-9]{64})'/)?.[1];
  assert.ok(credencial);
  assert.equal((await reporte({credencial,id:'falsa',turno:0,tipo:'terminada'})).status,200);
  assert.equal((await reporte({credencial,id:'falsa',turno:'0',tipo:'terminada'})).status,400);
});

test('música: la consulta del reproductor cuenta como abierto aunque no suene nada', async () => {
  // Sin esto, en automático el vigilante de escenas no arrancaba la primera lista.
  musica.reset();
  assert.equal(musica.estado().overlay, false);
  assert.equal((await fetch(`http://127.0.0.1:${puerto}/api/overlay/musica`)).status, 200);
  assert.equal(musica.estado().overlay, true);
});

test('música: la credencial del reproductor sobrevive a reiniciar el bot', async () => {
  // La fuente de OBS no se recarga sola: con una credencial nueva en cada arranque,
  // sus avisos se rechazarían y la música se pararía tras la primera canción.
  musica.olvidarCredencial();
  const antes = musica.credencialReproductor();
  musica.olvidarCredencial();
  assert.equal(musica.credencialReproductor(), antes, 'la misma, leída de la base de datos');
});


test('imágenes: no inicia gasto sin aceptar el máximo de la operación', async () => {
  for(const ruta of ['fondo','avatar-ia','avatar-rehacer']) {
    const r=await fetch(`http://127.0.0.1:${puerto}/api/escenas/${ruta}`, {method:'POST',headers:{'X-Panel':'1','Content-Type':'application/json'},body:'{}'});
    assert.equal(r.status,400);
    assert.match(await r.text(),/Confirma el máximo/);
  }
});

test('avatar local: la escritura exige el panel y rechaza rutas/calibraciones inválidas', async () => {
  const raiz = `http://127.0.0.1:${puerto}`;
  assert.equal((await fetch(`${raiz}/api/escenas/avatar-local`, {method:'POST',body:'{}'})).status,403);
  assert.equal((await post('/api/escenas/avatar-local/vista', {personaje:'../fuera'})).status,400);
  assert.equal((await post('/api/escenas/avatar-local', {personaje:'imagenes/avatar/inexistente',calibracion:{}})).status,400);
  assert.equal((await fetch(`${raiz}/api/overlay/avatar-local?personaje=../fuera`)).status,404);
});

test('overlays: no permite emitir pruebas de subs ni regalos gestionados por Streamlabs', async () => {
  for (const tipo of ['sub', 'regalo']) {
    const r = await post('/api/overlays', { accion: 'probar', tipo });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /Streamlabs/);
  }
});

test('overlays: al añadir un panel ya montado corrige una URL de demo sin moverlo', async () => {
  const primero = await post('/api/overlays', { accion: 'obs', cual: 'panel', escena: 'Escena juego' });
  assert.equal(primero.status, 200);
  const fuente = obs.entradas.find((e) => e.inputName === 'OVL Panel')!;
  const item = obs.items['Escena juego'].find((i) => i.sourceName === 'OVL Panel')!;
  fuente.settings.url += '?demo=1';

  const segundo = await post('/api/overlays', { accion: 'obs', cual: 'panel', escena: 'Escena juego' });
  assert.equal(segundo.status, 200);
  assert.match(segundo.body.hecho, /datos reales/);
  assert.match(fuente.settings.url, /\/biblioteca\/overlays\/panel\.html$/);
  assert.equal(obs.items['Escena juego'].find((i) => i.sourceName === 'OVL Panel')!.sceneItemId, item.sceneItemId);
});

test('overlays: el botín real llega al rotativo con sus puntos del mes', async () => {
  loot.reset();
  loot.enPantalla('Soichen', { objeto: 'Espada de Fuego Eterno', rareza: 'epico' }, 'cofre');
  const r = await pedir('GET', '/api/overlay/panel');
  assert.equal(r.status, 200);
  assert.equal(r.body.novedades.at(-1).quien, 'Soichen');
  assert.match(r.body.novedades.at(-1).detalle, /\+8 puntos del mes/);
  assert.equal(r.body.cofre.activo, false);
  loot.reset();
});

test('efectos: probar sin directo no ejecuta Actions ni manda chat', async () => {
  const n=ejecutadas.length, mensajes=enviados.length;
  const r=await post('/api/efectos/prueba',{efecto:'grito'});
  assert.equal(r.status,200);assert.equal(ejecutadas.length,n);assert.equal(enviados.length,mensajes);
  assert.equal((await post('/api/efectos/prueba',{efecto:'inventado'})).status,400);
});

describe('El Linde del Velo desde el panel', () => {
  test('activar, pausar y apagar; avisa si no hay directo y exige X-Panel', async () => {
    const inicial = await pedir('GET', '/api/mmo');
    assert.equal(inicial.body.estado.modo, 'apagado');
    assert.equal(inicial.body.directo, false);
    assert.equal((await pedir('POST', '/api/mmo', { cuerpo: { accion: 'activar' } })).status, 403);
    assert.equal((await post('/api/mmo', { accion: 'borrar' })).status, 400);

    const activo = await post('/api/mmo', { accion: 'activar' });
    assert.equal(activo.body.estado.modo, 'activo');
    assert.equal(activo.body.directo, false, 'el panel puede avisar de que sin directo no avanza');
    streams.open();
    assert.equal((await pedir('GET', '/api/mmo')).body.directo, true);
    assert.equal((await post('/api/mmo', { accion: 'pausar' })).body.estado.modo, 'pausado');
    assert.equal((await post('/api/mmo', { accion: 'apagar' })).body.estado.modo, 'apagado');
    assert.equal((await pedir('GET', '/api/mmo')).body.chat, true);
    assert.equal((await pedir('GET', '/api/mmo/estado')).body.chatConectado, true, 'la escena sabe si el chat llega');
  });

  test('Crear en OBS: escena del mundo con el overlay y las alertas encima, sin duplicar', async () => {
    obs.entradas.push({ inputName: 'OVL Alertas', inputKind: 'browser_source', settings: {} });
    const r = await post('/api/escenas/obs', { tipo: 'mundo' });
    assert.equal(r.status, 200);
    assert.deepEqual(obs.items['✦ El Linde del Velo']!.map((i) => i.sourceName), ['ESC Linde del Velo', 'OVL Alertas']);
    const fuente = obs.entradas.find((e) => e.inputName === 'ESC Linde del Velo')!;
    assert.match(fuente.settings.url, /\/biblioteca\/overlays\/mmo\.html$/);
    assert.equal(fuente.settings.shutdown, true, 'no gasta mientras la escena no se ve');
    assert.equal(fuente.settings.reroute_audio, true, 'el sonido del inicio se controla en el mezclador de OBS');
    const item = obs.items['✦ El Linde del Velo']![0]!;
    assert.equal(obs.transformes[item.sceneItemId].scaleX, 2560 / 1920);

    // Si alguien sube el mundo por encima de las alertas, al volver a pulsar quedan otra vez encima.
    obs.items['✦ El Linde del Velo']!.reverse();
    const otra = await post('/api/escenas/obs', { tipo: 'mundo' });
    assert.deepEqual(obs.items['✦ El Linde del Velo']!.map((i) => i.sourceName), ['ESC Linde del Velo', 'OVL Alertas']);
    assert.ok(otra.body.hecho.some((x: string) => /ya existía/.test(x)));
    assert.ok(!obs.items['Escena juego']!.some((i) => i.sourceName === 'ESC Linde del Velo'), 'no toca la escena del juego');
  });
});
