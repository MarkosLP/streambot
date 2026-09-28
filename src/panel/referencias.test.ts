import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { codificar } from '../services/png.js';
import * as imagen from '../services/ia-imagen.js';
import * as refs from './referencias.js';
import * as fondos from './fondos.js';
import * as avatar from './avatar-ia.js';
import { crearServidor } from './server.js';
import { config } from '../config.js';

const png = codificar(128, 128, randomBytes(128 * 128 * 4));
const datos = { nombre: 'Fachada de Aden', juego: 'Lineage 2', png: png.toString('base64') };

test('referencias: subida local, aislamiento, validación y archivos adjuntos en fondos/avatar', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'referencias-test-'));
  const llamadas: imagen.PeticionEdicion[] = [];
  let nuevas = 0;
  imagen.setMotor({ generar: async () => { nuevas++; return png; }, editar: async p => { llamadas.push(p); return png; }, localizarCara: async () => null });
  try {
    assert.deepEqual(await refs.listar(dir), []);
    const a = await refs.subir(datos, dir), b = await refs.subir({ ...datos, nombre: 'Acabado', juego: 'Aniimo' }, dir);
    assert.equal(nuevas + llamadas.length, 0, 'subir no llama a IA');
    assert.equal((await refs.listar(dir)).length, 2);
    assert.deepEqual(await refs.leer(a.ruta, dir), png);
    assert.throws(() => refs.seleccion([{ ruta: '../../.env', uso: 'lugar' }]), /válido/);
    assert.throws(() => refs.seleccion([{ ruta: a.ruta, uso: 'inventado' }]), /válido/);
    assert.throws(() => refs.seleccion(Array(4).fill({ ruta: a.ruta, uso: 'lugar' })), /tres/);
    assert.throws(() => refs.seleccion(Array(2).fill({ ruta: a.ruta, uso: 'lugar' })), /válido/);
    await assert.rejects(refs.subir({ ...datos, png: Buffer.from('<svg/>').toString('base64') }, dir), /PNG/);
    await assert.rejects(refs.subir({ ...datos, juego: '' }, dir), /juego/);
    const corrupto = Buffer.from(png); corrupto.writeUInt32BE(9000, 16);
    await assert.rejects(refs.subir({ ...datos, png: corrupto.toString('base64') }, dir), /2048/);
    await assert.rejects(refs.generar({ prompt: 'Aden', tamano: '1024x1024' }, [{ ruta: a.ruta.replace(/[^/]+$/, '00000000-0000-0000-0000-000000000000.png'), uso: 'lugar' }], dir), /leer/);
    assert.equal(llamadas.length, 0, 'referencia inválida no genera');
    const seleccion: refs.Seleccion[] = [{ ruta: a.ruta, uso: 'lugar' }, { ruta: b.ruta, uso: 'estilo' }];
    const salida = await fondos.generar('inicio', 'Castillo de Aden de Lineage 2', 'oscuro', dir, '', seleccion);
    assert.deepEqual(await readFile(join(dir, salida)), png);
    assert.equal(nuevas, 0, 'con referencias usa entradas visuales');
    assert.deepEqual(llamadas[0]!.base, png);
    assert.deepEqual(llamadas[0]!.referencias, [png]);
    assert.match(llamadas[0]!.prompt, /Image 1: Preserve the visible architecture/);
    assert.match(llamadas[0]!.prompt, /Image 2: Use only rendering style/);
    assert.match(llamadas[0]!.prompt, /Castillo de Aden de Lineage 2/);
    await avatar.generar('Adulto Aniimo', 'oscuro', dir, '', [{ ruta: b.ruta, uso: 'personaje' }]);
    assert.equal(llamadas[1]!.transparente, true);
    assert.match(llamadas[1]!.prompt, /character identity/);
    await refs.generar({ prompt: 'Sin referencias', tamano: '1024x1024' }, [], dir);
    assert.equal(nuevas, 1, 'sin referencias conserva generations');
  } finally { imagen.setMotor(null); await rm(dir, { recursive: true, force: true }); }
});

test('referencias HTTP: subida mayor de 16 KB, listados, imagen y protección de origen', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'referencias-http-'));
  const server = crearServidor({ estado: () => ({ conectado: false, destino: "Prueba", version: null, intentosFallidos: 0 }), acciones: async () => [], ejecutarAccion: async () => {} }, async () => { throw Error('OBS prohibido'); }, dir);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const raiz = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  try {
    const post = (body: unknown, panel = true) => fetch(raiz + '/api/referencias', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(panel ? { 'X-Panel': '1' } : {}) }, body: JSON.stringify(body) });
    assert.equal((await post(datos, false)).status, 403);
    assert.equal((await post({ ...datos, png: 'abc' })).status, 400);
    const r = await post(datos); assert.equal(r.status, 201);
    const ref = await r.json() as refs.Seleccion;
    assert.equal((await (await fetch(raiz + '/api/referencias')).json() as unknown[]).length, 1);
    const img = await fetch(raiz + '/api/referencias/imagen?ruta=' + encodeURIComponent(ref.ruta));
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), png);
    assert.equal((await fetch(raiz + '/api/referencias/imagen?ruta=../../.env')).status, 400);
    assert.equal((await fetch(raiz + '/referencias.js')).status, 200);
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await rm(dir, { recursive: true, force: true }); }
});

test('adaptador OpenAI: envía todas las referencias en orden sin red real', async () => {
  const original = globalThis.fetch, clave = config.imagen.apiKey;
  Reflect.set(config.imagen, 'apiKey', 'clave-falsa-local');
  globalThis.fetch = (async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/images/edits');
    const form = init!.body as FormData;
    const archivos = form.getAll('image[]') as File[];
    assert.equal(archivos.length, 2);
    assert.deepEqual(Buffer.from(await archivos[0]!.arrayBuffer()), png);
    assert.deepEqual(Buffer.from(await archivos[1]!.arrayBuffer()), Buffer.from('segunda'));
    assert.equal(form.get('background'), 'transparent');
    assert.equal(form.get('mask'), null);
    return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), { status: 200 });
  }) as typeof fetch;
  try { await imagen.editar({ prompt: 'Referencias', tamano: '1024x1024', transparente: true, base: png, referencias: [Buffer.from('segunda')] }); }
  finally { globalThis.fetch = original; Reflect.set(config.imagen, 'apiKey', clave); }
});
