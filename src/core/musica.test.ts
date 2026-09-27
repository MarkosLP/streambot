import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureDatabase, truncateAll } from '../data/db.js';
import * as musica from './musica.js';
import { resolver } from '../panel/biblioteca.js';

/**
 * Música del directo: listas, orden, escenas de OBS. Con archivos de mentira
 * (no hace falta que suenen: aquí solo se decide qué toca).
 */

let dir: string;

/** Un «mp3» con etiquetas ID3v2.3 de título y artista, y nada de sonido. */
function mp3(titulo: string, artista: string): Buffer {
  const marco = (id: string, texto: string) => {
    const cuerpo = Buffer.concat([Buffer.from([3]), Buffer.from(texto, 'utf8')]);
    const cab = Buffer.alloc(10);
    cab.write(id, 0, 'latin1');
    cab.writeUInt32BE(cuerpo.length, 4);
    return Buffer.concat([cab, cuerpo]);
  };
  const marcos = Buffer.concat([marco('TIT2', titulo), marco('TPE1', artista)]);
  const t = marcos.length;
  const cab = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, (t >> 21) & 0x7f, (t >> 14) & 0x7f, (t >> 7) & 0x7f, t & 0x7f]);
  return Buffer.concat([cab, marcos, Buffer.alloc(64)]);
}

before(async () => {
  configureDatabase(':memory:');
  dir = await mkdtemp(join(tmpdir(), 'crid4m-musica-'));
  const c = (l: string) => join(dir, 'musica', l);
  for (const l of musica.LISTAS) await mkdir(c(l), { recursive: true });
  await writeFile(join(c('inicio'), 'uno.mp3'), mp3('Level Up', 'StreamBeats'));
  await writeFile(join(c('inicio'), 'Harris Heller - Canción número dos.mp3'), Buffer.alloc(64));
  await writeFile(join(c('inicio'), '03 - Tres.ogg'), Buffer.alloc(64));
  await writeFile(join(c('inicio'), 'notas.txt'), 'esto no es música');
  await writeFile(join(c('fondo'), 'lofi.mp3'), mp3('Lofi', 'StreamBeats'));
  await writeFile(join(c('fondo'), 'lofi 2.mp3'), mp3('Lofi 2', 'StreamBeats'));
  musica.usarDir(dir);
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  truncateAll();
  musica.reset();
  musica.usarDir(dir);
});

describe('las canciones', () => {
  test('título y artista: de las etiquetas del mp3, o del nombre del archivo', async () => {
    const l = (await musica.escanear(dir)).inicio;
    assert.equal(l.length, 3, 'el .txt no cuenta');
    const uno = l.find((p) => p.archivo === 'uno.mp3')!;
    assert.deepEqual([uno.titulo, uno.artista], ['Level Up', 'StreamBeats']);
    const dos = l.find((p) => p.archivo.startsWith('Harris'))!;
    assert.deepEqual([dos.titulo, dos.artista], ['Canción número dos', 'Harris Heller']);
    assert.equal(dos.url, `/biblioteca/musica/inicio/${encodeURIComponent('Harris Heller - Canción número dos.mp3')}`);
    assert.deepEqual(musica.delNombre('03 - Tres.ogg'), { titulo: 'Tres', artista: null }, 'el número de pista fuera');
  });

  test('las carpetas vacías se crean solas, para que sepas dónde va cada cosa', async () => {
    const otro = await mkdtemp(join(tmpdir(), 'crid4m-musica-vacia-'));
    const l = await musica.escanear(otro);
    assert.deepEqual(Object.values(l).map((x) => x.length), [0, 0, 0, 0]);
    await rm(otro, { recursive: true, force: true });
  });

  test('el panel sirve las canciones con tildes y espacios, pero nada fuera de la carpeta', () => {
    assert.ok(resolver(`/biblioteca/musica/inicio/${encodeURIComponent('Harris Heller - Canción número dos.mp3')}`));
    assert.equal(resolver('/biblioteca/musica/inicio/..%2F..%2F.env'), null);
    assert.equal(resolver('/biblioteca/musica/uno.mp3'), null, 'siempre dentro de una lista');
    assert.equal(resolver('/biblioteca/musica/inicio/notas.txt'), null, 'solo audio');
    assert.equal(resolver('/biblioteca/musica/inicio/.oculto.mp3'), null);
  });
});

describe('qué suena', () => {
  test('una lista suena entera, al azar y sin repetir, antes de volver a empezar', async () => {
    await musica.ponerLista('inicio');
    const vistas = [musica.estado().pista!.id];
    for (let i = 0; i < 2; i++) {
      await musica.terminada(musica.estado().pista!.id);
      vistas.push(musica.estado().pista!.id);
    }
    assert.equal(new Set(vistas).size, 3);
    await musica.terminada(musica.estado().pista!.id);
    assert.notEqual(musica.estado().pista!.id, vistas[2], 'al volver a barajar, no repite la última');
  });

  test('un «terminada» de una canción que ya no suena no salta otra', async () => {
    await musica.ponerLista('inicio');
    const antes = musica.estado().pista!.id;
    await musica.terminada('inicio/otra.mp3');
    assert.equal(musica.estado().pista!.id, antes);
  });

  test('pausar, reanudar, anterior', async () => {
    await musica.ponerLista('fondo');
    const primera = musica.estado().pista!.id;
    musica.pausar();
    assert.equal(musica.estado().sonando, false);
    assert.equal(musica.paraOverlay().sonando, false);
    await musica.reanudar();
    assert.equal(musica.estado().pista!.id, primera, 'reanudar sigue con la misma');
    await musica.siguiente();
    await musica.anterior();
    assert.equal(musica.estado().pista!.id, primera);
  });

  test('una lista vacía no suena', async () => {
    await musica.ponerLista('final');
    assert.equal(musica.estado().sonando, false);
  });

  test('el overlay recibe el volumen de la lista que suena', async () => {
    musica.cambiarAjustes({ volumen: { fondo: 0.15 } });
    await musica.ponerLista('fondo');
    assert.equal(musica.paraOverlay().volumen, 0.15);
    musica.cambiarAjustes({ volumen: { fondo: 7 } });
    assert.equal(musica.paraOverlay().volumen, 1, 'entre 0 y 1');
  });
});

describe('según la escena de OBS', () => {
  test('las escenas del panel llevan su lista; las demás, la de fondo; Charla calla', async () => {
    await musica.alCambiarEscena('✦ Empezamos');
    assert.equal(musica.estado().lista, 'inicio');
    assert.equal(musica.estado().sonando, true);
    await musica.alCambiarEscena('Juego');
    assert.equal(musica.estado().lista, 'fondo');
    await musica.alCambiarEscena('✦ Charla');
    assert.equal(musica.estado().sonando, false);
  });

  test('volver a una escena de la misma lista no corta la canción', async () => {
    await musica.alCambiarEscena('Juego');
    const id = musica.estado().pista!.id;
    const turno = musica.paraOverlay().turno;
    await musica.alCambiarEscena('✦ Charla');
    await musica.alCambiarEscena('Otro juego');
    assert.equal(musica.estado().pista!.id, id);
    assert.equal(musica.paraOverlay().turno, turno);
    assert.equal(musica.estado().sonando, true);
  });

  test('el mapa se cambia por escena y se guarda; en manual la escena no manda', async () => {
    musica.cambiarAjustes({ mapa: { Juego: 'silencio' }, otras: 'inicio' });
    await musica.alCambiarEscena('Juego');
    assert.equal(musica.estado().sonando, false);
    await musica.alCambiarEscena('Minecraft');
    assert.equal(musica.estado().lista, 'inicio');
    musica.reset();
    assert.equal(musica.leerAjustes().mapa.Juego, 'silencio', 'sobrevive a un reinicio');
    await musica.ponerModo('manual');
    await musica.ponerLista('fondo');
    await musica.alCambiarEscena('✦ Pausa');
    assert.equal(musica.estado().lista, 'fondo');
  });

  test('el aviso de canción no sale en las escenas del panel (ya lo enseñan ellas)', async () => {
    await musica.alCambiarEscena('Juego');
    assert.equal(musica.paraOverlay().aviso, true);
    await musica.alCambiarEscena('✦ Empezamos');
    assert.equal(musica.paraOverlay().aviso, false);
    musica.cambiarAjustes({ aviso: false });
    await musica.alCambiarEscena('Juego');
    assert.equal(musica.paraOverlay().aviso, false);
  });
});

test('música: finales duplicados y atrasados no saltan otra canción', async () => {
  await musica.ponerLista('inicio');
  const antes = musica.paraOverlay();
  await Promise.all([musica.terminada(antes.pista!.id, antes.turno),musica.terminada(antes.pista!.id, antes.turno)]);
  const despues = musica.paraOverlay();
  await musica.terminada(despues.pista!.id, antes.turno);
  assert.equal(musica.paraOverlay().turno, despues.turno);
  assert.equal(despues.turno, antes.turno + 2, 'una reserva y un único cambio');
});
