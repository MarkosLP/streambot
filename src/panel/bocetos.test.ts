import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, rename, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as bocetos from './bocetos.js';

/**
 * Bocetos (docs/previews): el panel los lista, dice quién los cita y los manda
 * a la papelera. Nunca puede salirse de su carpeta.
 */

let raiz: string;
let dir: string;
let papelera: string;

before(async () => {
  raiz = await mkdtemp(join(tmpdir(), 'bocetos-'));
  dir = join(raiz, 'docs', 'previews');
  papelera = join(raiz, 'papelera');
  await mkdir(join(dir, 'mmo', 'viejo'), { recursive: true });
  await mkdir(join(dir, 'alertas'), { recursive: true });
  await mkdir(papelera);
  await writeFile(join(dir, 'mmo', 'calma.png'), 'png');
  await writeFile(join(dir, 'mmo', 'viejo', 'solo.png'), 'png');
  await writeFile(join(dir, 'alertas', 'escena.html'), '<style>html, body { width: 1920px; height: 1080px; }</style>');
  await writeFile(join(dir, 'alertas', 'pagina.html'), '<meta name="viewport" content="width=device-width">');
  await writeFile(join(dir, 'alertas', 'sonido.mp3'), 'mp3');
  await writeFile(join(dir, 'alertas', '.gitignore'), '*');
  await writeFile(join(dir, 'alertas', 'raro.exe'), 'no');
  await mkdir(join(raiz, 'docs'), { recursive: true });
  await writeFile(join(raiz, 'docs', 'MMO.md'), 'Ver ![](previews/mmo/calma.png). Y un solo.png suelto que no es el boceto.');
  await writeFile(join(dir, 'alertas', 'LEEME.md'), 'escena.html es el bueno');
  // Para los tests: «papelera» = mover a otra carpeta.
  bocetos.setPapelera(async (rutas) => { for (const r of rutas) await rename(r, join(papelera, r.split(/[\\/]/).pop()!)); });
});
afterEach(() => bocetos.setPapelera(async (rutas) => { for (const r of rutas) await rename(r, join(papelera, r.split(/[\\/]/).pop()!)); }));
after(async () => {
  bocetos.setPapelera(null);
  await rm(raiz, { recursive: true, force: true });
});

describe('bocetos', () => {
  test('no sale de su carpeta: nada de .., ocultos ni tipos desconocidos', () => {
    for (const mala of ['../MMO.md', 'mmo/../../MMO.md', '%2e%2e/MMO.md', 'alertas/.gitignore', 'alertas/raro.exe', 'a\\b.png', 'C:/x.png', '', 'mmo//calma.png']) {
      assert.equal(bocetos.resolver(mala, dir), null, mala);
    }
    assert.ok(bocetos.resolver('mmo/calma.png', dir)?.ruta.endsWith(join('mmo', 'calma.png')));
    assert.equal(bocetos.resolver('alertas/sonido.mp3', dir)?.mime, 'audio/mpeg');
  });

  test('lista por carpeta, distingue overlay de página y dice quién lo cita', async () => {
    const { bocetos: lista, bytes } = await bocetos.listar(dir, raiz);
    assert.deepEqual(lista.map((b) => b.ruta), ['alertas/escena.html', 'alertas/LEEME.md', 'alertas/pagina.html', 'alertas/sonido.mp3', 'mmo/calma.png', 'mmo/viejo/solo.png']);
    const por = Object.fromEntries(lista.map((b) => [b.ruta, b]));
    assert.equal(por['alertas/escena.html']!.clase, 'escena');
    assert.deepEqual(por['alertas/escena.html']!.citadoEn, ['docs/previews/alertas/LEEME.md'], 'desde su misma carpeta basta el nombre');
    assert.equal(por['alertas/pagina.html']!.clase, 'pagina');
    assert.equal(por['alertas/sonido.mp3']!.clase, 'audio');
    assert.deepEqual(por['mmo/calma.png']!.citadoEn, ['docs/MMO.md']);
    assert.deepEqual(por['mmo/viejo/solo.png']!.citadoEn, []);
    assert.equal(por['mmo/viejo/solo.png']!.carpeta, 'mmo/viejo');
    assert.equal(bytes, lista.reduce((n, b) => n + b.bytes, 0));
  });

  test('borra varios a la vez, informa de los que no y quita las carpetas que se vacían', async () => {
    const r = await bocetos.borrar(['mmo/viejo/solo.png', 'alertas/sonido.mp3', '../MMO.md', 'mmo/no-existe.png'], dir);
    assert.deepEqual(r.borrados.sort(), ['alertas/sonido.mp3', 'mmo/viejo/solo.png']);
    assert.deepEqual(r.fallos.map((f) => f.error).sort(), ['ruta no permitida', 'ya no existe']);
    assert.deepEqual((await readdir(papelera)).sort(), ['solo.png', 'sonido.mp3']);
    assert.deepEqual(await readdir(join(dir, 'mmo')), ['calma.png'], 'la carpeta vacía «viejo» ya no está');
    assert.ok((await readdir(join(dir, 'alertas'))).includes('.gitignore'), 'no toca lo oculto');
  });

  test('si la papelera falla, el archivo se queda y se dice por qué', async () => {
    bocetos.setPapelera(async () => { throw new Error('papelera llena'); });
    const r = await bocetos.borrar(['mmo/calma.png'], dir);
    assert.deepEqual(r.borrados, []);
    assert.deepEqual(r.fallos, [{ ruta: 'mmo/calma.png', error: 'papelera llena' }]);
  });

  test('pide entre 1 y 500 rutas', async () => {
    await assert.rejects(bocetos.borrar([], dir), /entre 1 y 500/);
    await assert.rejects(bocetos.borrar('mmo/calma.png', dir), /entre 1 y 500/);
  });
});
