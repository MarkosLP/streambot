import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as imagen from '../services/ia-imagen.js';
import * as fondos from './fondos.js';
import * as avatarIa from './avatar-ia.js';
import * as escenas from './escenas.js';
import { configureDatabase, truncateAll } from '../data/db.js';

/**
 * Fondos y personajes con IA. Con un motor de mentira: ni un céntimo en
 * OpenAI por pasar los tests.
 */

let dir: string;
let pedidas: Array<{ tipo: string; prompt: string; transparente?: boolean; conBase: boolean }> = [];

before(async () => {
  configureDatabase(':memory:');
  dir = await mkdtemp(join(tmpdir(), 'crid4m-fondos-'));
  imagen.setMotor({
    generar: async (p) => { pedidas.push({ tipo: 'generar', prompt: p.prompt, transparente: p.transparente, conBase: false }); return Buffer.from('PNG-generada'); },
    editar: async (p) => { pedidas.push({ tipo: 'editar', prompt: p.prompt, transparente: p.transparente, conBase: p.base.length > 0 }); return Buffer.from('PNG-editada'); },
  });
});
after(async () => {
  imagen.setMotor(null);
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  pedidas = [];
  truncateAll();
  escenas.reset();
});

describe('fondos con IA', () => {
  test('el prompt lleva el estilo común, lo que pides y la composición de la escena', () => {
    const p = fondos.prompt('charla', 'una biblioteca de mago');
    assert.match(p, /dark fantasy matte painting/);
    assert.match(p, /una biblioteca de mago/);
    assert.match(p, /webcam frame/, 'en Charla deja sitio a la cámara');
    assert.match(fondos.prompt('inicio', ''), /castillo gótico/, 'vacío = la descripción de siempre');
  });

  test('genera, guarda en imagenes/fondos y aparece en la lista', async () => {
    const ruta = await fondos.generar('inicio', 'un castillo', dir);
    assert.match(ruta, /^imagenes\/fondos\/inicio-.+\.png$/);
    assert.equal(await readFile(join(dir, ruta), 'utf8'), 'PNG-generada');
    const lista = await fondos.lista(dir);
    assert.equal(lista[0]!.ruta, ruta);
    assert.equal(lista[0]!.escena, 'inicio');
  });

  test('solo se aceptan rutas de la carpeta de fondos', () => {
    assert.equal(fondos.rutaValida('imagenes/fondos/inicio-1.png'), true);
    assert.equal(fondos.rutaValida('imagenes/fondos/../../.env'), false);
    assert.equal(fondos.rutaValida('https://malo.example/x.png'), false);
    assert.equal(fondos.rutaValida('imagenes/otra/x.png'), false);
  });

  test('cambiar el fondo de una escena no borra los de las demás; null lo quita', () => {
    escenas.cambiar({ fondos: { inicio: 'imagenes/fondos/a.png' } });
    escenas.cambiar({ fondos: { pausa: 'imagenes/fondos/b.png', final: '../../x.png' } });
    assert.deepEqual(escenas.leer().fondos, { inicio: 'imagenes/fondos/a.png', pausa: 'imagenes/fondos/b.png' });
    escenas.cambiar({ fondos: { inicio: null } });
    assert.deepEqual(escenas.leer().fondos, { pausa: 'imagenes/fondos/b.png' });
  });
});

describe('personaje del avatar con IA', () => {
  test('tres imágenes del mismo personaje: la base y dos variantes editándola, con fondo transparente', async () => {
    const ruta = await avatarIa.generar('', dir);
    assert.match(ruta, /^imagenes\/avatar\/[\w-]+$/);
    assert.deepEqual((await readdir(join(dir, ruta))).sort(), ['base.png', 'cerrados.png', 'contento.png']);
    assert.equal(pedidas.length, 3);
    assert.ok(pedidas.every((p) => p.transparente), 'todo con fondo transparente');
    assert.equal(pedidas.filter((p) => p.tipo === 'editar' && p.conBase).length, 2, 'las variantes parten de la base');
    assert.match(pedidas[0]!.prompt, /errante encapuchado/, 'vacío = el personaje de siempre');
    assert.equal((await avatarIa.lista(dir))[0]!.ruta, ruta);
  });

  test('el personaje elegido se guarda, y solo si es una carpeta de avatar', () => {
    assert.equal(escenas.leer().avatarImagen, 'imagenes/avatar/errante');
    escenas.cambiar({ avatarImagen: 'imagenes/avatar/otro' });
    assert.equal(escenas.leer().avatarImagen, 'imagenes/avatar/otro');
    escenas.cambiar({ avatarImagen: '../../secretos' });
    assert.equal(escenas.leer().avatarImagen, 'imagenes/avatar/otro');
    escenas.cambiar({ avatarImagen: null });
    assert.equal(escenas.leer().avatarImagen, null);
  });
});
