import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { configureDatabase, truncateAll } from '../data/db.js';
import * as killswitch from '../core/killswitch.js';
import * as ajustes from '../core/ajustes.js';
import * as review from '../core/review.js';
import * as policy from '../core/policy.js';
import { setSender } from '../core/output.js';
import * as revision from './revision.js';
import { crearServidor, type PuertoStreamerbot, type ConObs } from './server.js';
import { ErrorObs, autenticacion } from '../transport/obs.js';
import { descodificar } from './importar.js';
import { EFECTOS, mismoNombre } from './efectos.js';

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
  };
}

const obsFalso: ConObs = async (trabajo) => {
  if (obsCaido) throw new ErrorObs('No se pudo conectar con OBS');
  let id = 100;
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
        obs.items[d.sceneName].push({ sourceName: d.inputName, sceneItemId: ++id, enabled: d.sceneItemEnabled });
        return {};
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
    ]) {
      const r = await pedir('GET', ruta);
      assert.notEqual(r.status, 200, ruta);
    }
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
    assert.deepEqual(body.existe, { pocion: false, maldicion: false, lag: false });
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
    assert.equal((await pedir('GET', '/api/efectos/importar?ids=terremoto&escena=a&fuente=b')).status, 400);
    assert.equal((await pedir('GET', '/api/efectos/importar?escena=a&fuente=b')).status, 400);
  });
});
