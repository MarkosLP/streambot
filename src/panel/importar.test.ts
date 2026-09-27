import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { codigoImportacion, codificar, descodificar, exportacion } from './importar.js';

/**
 * El formato de importación de Streamer.bot no está documentado. La única
 * verdad son exportaciones reales, hechas en el Streamer.bot del canal y
 * guardadas en muestras-streamerbot/. Lo generado tiene que coincidir con
 * ellas campo a campo, salvo los ids, que son nuevos en cada acción.
 */

const muestra = (archivo: string) =>
  descodificar(readFileSync(new URL(`./muestras-streamerbot/${archivo}`, import.meta.url), 'utf8'));

const REAL_GRITO = muestra('grito-de-guerra.txt').data.actions[0];
const REAL_OBS = muestra('obs-visibilidad-y-filtro.txt').data.actions[0].subActions;

const OPCIONES = { escena: 'EMPEZAMOS', fuente: 'Captura de ventana', dirBiblioteca: 'D:\\Descargas\\StreamerBotApi\\biblioteca' };

/** Quita lo que cambia en cada exportación aunque la acción sea la misma. */
const sinIds = ({ id: _id, ...resto }: Record<string, unknown>) => resto;

const generada = (id: 'grito' | 'pocion' | 'maldicion' | 'lag'): any => exportacion([id], OPCIONES).data.actions[0];

describe('importar en Streamer.bot', () => {
  test('el código se lee igual que uno de Streamer.bot', () => {
    const datos = { hola: 'mundo ⚔️' };
    const codigo = codificar(datos);
    assert.ok(Buffer.from(codigo, 'base64').subarray(0, 4).toString() === 'SBAE');
    assert.deepEqual(descodificar(codigo), datos);
  });

  test('rechaza lo que no es un código de Streamer.bot', () => {
    assert.throws(() => descodificar(Buffer.from('hola').toString('base64')), /no es un código/);
  });

  test('el grito de guerra sale idéntico al que montaste a mano', () => {
    const nuestra = generada('grito');
    assert.deepEqual(nuestra.subActions.map(sinIds), REAL_GRITO.subActions.map(sinIds));
    // Todo lo de la acción, menos el id y el disparador, que se pone a mano.
    const { id: _a, triggers: _t, subActions: _s, ...resto } = nuestra;
    const { id: _b, triggers: _u, subActions: _v, ...restoReal } = REAL_GRITO;
    assert.deepEqual(resto, restoReal);
  });

  test('la poción aparece (0) y se esconde (1), como en la muestra', () => {
    const [, visible, espera, oculta] = generada('pocion').subActions;
    const { index: _i1, ...v } = sinIds(visible);
    const { index: _i2, ...h } = sinIds(oculta);
    assert.deepEqual(v, (({ index: _, ...r }) => r)(sinIds(REAL_OBS[0])));
    assert.deepEqual(h, (({ index: _, ...r }) => r)(sinIds(REAL_OBS[1])));
    assert.equal(espera.type, 1002);
    assert.equal(espera.value, '5000');
  });

  test('la maldición enciende y apaga el filtro como en la muestra', () => {
    const subs = generada('maldicion').subActions;
    const filtros = subs.filter((s: any) => s.type === 35).map((s: any) => (({ index: _, ...r }) => r)(sinIds(s)));
    const reales = REAL_OBS.slice(2).map((s: any) => (({ index: _, ...r }) => r)(sinIds(s)));
    assert.deepEqual(filtros, reales);
    // Y entre medias, 30 segundos.
    assert.ok(subs.some((s: any) => s.type === 1002 && s.value === '10000'));
  });

  test('los índices van seguidos y los ids no se repiten', () => {
    const datos = exportacion(['grito', 'pocion', 'maldicion', 'lag'], OPCIONES);
    const ids = new Set<string>();
    for (const a of datos.data.actions) {
      ids.add(a.id);
      a.subActions.forEach((s: any, i: number) => {
        assert.equal(s.index, i);
        ids.add(s.id);
      });
    }
    const total = datos.data.actions.reduce((n: number, a: any) => n + 1 + a.subActions.length, 0);
    assert.equal(ids.size, total);
  });

  test('las acciones se llaman como las busca el panel, y sin disparador', () => {
    const datos = descodificar(codigoImportacion(['pocion', 'lag'], OPCIONES));
    assert.deepEqual(datos.data.actions.map((a: any) => a.name), ['Efecto - Poción de vida', 'Efecto - Lag']);
    assert.ok(datos.data.actions.every((a: any) => a.triggers.length === 0 && a.group === 'Efectos'));
  });

  test('no inventa efectos que no sabe generar', () => {
    assert.throws(() => exportacion(['meteorito' as any], OPCIONES), /no importable/);
  });

  test('el Terremoto solo lleva el sonido y el aviso: el temblor lo hace el bot', () => {
    const accion = exportacion(['terremoto'], OPCIONES).data.actions[0];
    assert.equal(accion.name, 'Efecto - Terremoto');
    assert.deepEqual(accion.subActions.map((s: any) => s.type), [1, 10], 'sonido y mensaje, nada de OBS');
  });
});

test('el panel ofrece importar los mismos efectos que sabe generar el servidor', async () => {
  // 27 sep: el Terremoto estaba en importar.ts pero no en la lista del panel.
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
  const lista = /const IMPORTABLES = \[([^\]]*)\]/.exec(app)?.[1]?.match(/'(\w+)'/g)?.map((s) => s.slice(1, -1));
  const { IMPORTABLES } = await import('./importar.js');
  assert.deepEqual(lista, [...IMPORTABLES]);
});
