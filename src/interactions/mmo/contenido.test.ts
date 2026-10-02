import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDatabase, configureDatabase, getDb, truncateAll } from '../../data/db.js';
import * as streams from '../../data/streams.js';
import * as killswitch from '../../core/killswitch.js';
import { MAX_MESSAGE_LENGTH } from '../../config.js';
import { CAPITULO_CADA, CLIMAS, CRONICA, REGIONES, TOTAL_RELIQUIAS } from './contenido.js';
import * as mmo from './index.js';
import type { Viewer } from '../../core/events.js';

/**
 * El contenido tiene que aguantar muchos días sin Crid4m: se juegan 200
 * expediciones seguidas y se comprueba que no se repite antes de tiempo.
 */

const carpeta = mkdtempSync(join(tmpdir(), 'crid4m-mmo-contenido-'));
const INICIO = Date.UTC(2026, 9, 3, 8, 0, 0);
const ana: Viewer = { id: 'ana', login: 'ana', displayName: 'Ana', isBroadcaster: false, isModerator: false, isVip: false, isSubscriber: false, rawRole: null };

before(() => configureDatabase(join(carpeta, 'mmo.sqlite')));
beforeEach(() => {
  truncateAll();
  killswitch.enable('contenido');
  streams.openAt(new Date(INICIO).toISOString());
  mmo.activar(INICIO);
});
after(() => {
  mmo.setAzar(null);
  closeDatabase();
  rmSync(carpeta, { recursive: true, force: true });
});

test('el catálogo está completo y sin duplicados', () => {
  const ids = new Set<string>();
  const reliquias = new Set<string>();
  for (const r of REGIONES) {
    assert.equal(r.misiones.length, 10, r.id);
    assert.ok(r.sucesos.length >= 8, r.id);
    assert.equal(new Set(r.sucesos).size, r.sucesos.length, `${r.id}: sucesos repetidos`);
    for (const m of r.misiones) {
      assert.ok(!ids.has(`${r.id}.${m.id}`));
      ids.add(`${r.id}.${m.id}`);
      for (const x of m.reliquias) {
        assert.ok(!reliquias.has(x), `reliquia repetida: ${x}`);
        reliquias.add(x);
      }
      assert.equal(new Set(m.acciones).size, 3, `${m.id}: acciones repetidas`);
    }
  }
  assert.equal(TOTAL_RELIQUIAS, 60);
  assert.equal(CRONICA.length, 16);
});

/** Completa expediciones de una en una, con Ana sola y el reloj avanzando lo justo. */
function jugar(expediciones: number) {
  const mensajes: string[] = [];
  let t = INICIO;
  let id = 0;
  for (let hechas = 0; hechas < expediciones; hechas++) {
    for (;;) {
      const respuesta = mmo.comando('!explorar', ana, `m-${id++}`, t);
      if (respuesta) mensajes.push(respuesta);
      t += mmo.ACCION_MS;
      if (mmo.estado().fase === 'resultado') break;
    }
    t += mmo.DESCANSO_MS;
    mmo.avanzar(t);
  }
  return mensajes;
}

test('200 expediciones: misiones sin repetir antes de tiempo, colección completa y crónica hasta el final', () => {
  let semilla = 7;
  mmo.setAzar(() => (semilla = (semilla * 16807) % 2147483647) / 2147483647);
  const mensajes = jugar(200);

  const filas = getDb().prepare('SELECT expedicion_id, region_id, mision_id, clima, suceso FROM mmo_expediciones ORDER BY expedicion_id')
    .all() as Array<{ expedicion_id: number; region_id: string; mision_id: string; clima: string; suceso: string | null }>;
  assert.equal(filas.length, 200);
  for (const region of REGIONES) {
    const suyas = filas.filter((f) => f.region_id === region.id).map((f) => f.mision_id);
    // Cada tanda de diez visitas a la región recorre sus diez misiones.
    for (let i = 0; i + 10 <= suyas.length; i += 10) {
      assert.equal(new Set(suyas.slice(i, i + 10)).size, 10, `${region.id}: tanda ${i / 10 + 1} repite misión`);
    }
    assert.equal(suyas[0], region.misiones[0]!.id, 'la primera visita es la misión de presentación');
  }
  // Nunca el mismo cielo dos veces seguidas, y salen todos.
  for (let i = 1; i < filas.length; i++) assert.notEqual(filas[i]!.clima, filas[i - 1]!.clima);
  assert.equal(new Set(filas.map((f) => f.clima)).size, CLIMAS.length);
  // Hay suceso en todas (Ana sola: meta 4, el suceso cae en el segundo paso) y salen todos los de cada región.
  assert.ok(filas.every((f) => f.suceso));
  for (const region of REGIONES) {
    assert.equal(new Set(filas.filter((f) => f.region_id === region.id).map((f) => f.suceso)).size, region.sucesos.length, region.id);
  }

  const e = mmo.estado();
  assert.deepEqual(e.reliquias, { halladas: TOTAL_RELIQUIAS, total: TOTAL_RELIQUIAS }, 'con 200 expediciones se completa la colección');
  // Hasta completar cada misión dos veces, todas las reliquias son nuevas: 60 de las primeras 60 de cada… sin repetidas antes de tiempo.
  const nuevas = getDb().prepare('SELECT expedicion_id FROM mmo_expediciones WHERE reliquia_nueva = 1 ORDER BY expedicion_id').all() as Array<{ expedicion_id: number }>;
  assert.equal(nuevas.length, TOTAL_RELIQUIAS);
  assert.equal(nuevas.at(-1)!.expedicion_id, TOTAL_RELIQUIAS, 'las 60 primeras expediciones traen las 60 reliquias');
  assert.equal(e.cronica.capitulo, CRONICA.length - 1);
  assert.equal(e.cronica.siguienteEn, null);

  // Un anuncio por capítulo, en la expedición que lo desbloquea, y todos caben en un mensaje.
  const capitulos = mensajes.filter((m) => m.includes('Nuevo capítulo'));
  assert.equal(capitulos.length, CRONICA.length - 1);
  assert.match(capitulos[0]!, new RegExp(`«${CRONICA[1]!.titulo}»`));
  assert.ok(mensajes.every((m) => m.length <= MAX_MESSAGE_LENGTH));
  assert.ok(Math.max(...mensajes.map((m) => m.length)) < 300, 'margen de sobra');
  assert.equal(CAPITULO_CADA * (CRONICA.length - 1), 90);
});

test('el estado público lleva misión, clima, reliquias y crónica para la escena', () => {
  mmo.setAzar(() => 0);
  const vacio = mmo.estado();
  assert.equal(vacio.cronica.capitulo, 0);
  assert.equal(vacio.cronica.titulo, CRONICA[0]!.titulo);
  assert.equal(vacio.cronica.siguienteEn, CAPITULO_CADA);
  assert.deepEqual(vacio.reliquias, { halladas: 0, total: TOTAL_RELIQUIAS });
  mmo.explorar(ana, 'uno', INICIO);
  mmo.explorar(ana, 'dos', INICIO + mmo.ACCION_MS);
  const e = mmo.estado();
  assert.equal(e.region.objetivo, 'Abrir camino entre las raíces');
  assert.equal(e.clima, 'dia', 'la primera expedición de todas, de día');
  assert.equal(e.acciones[0]!.suceso, true, 'el suceso de mitad de camino entra en las acciones, sin nombre');
  assert.equal(e.acciones[0]!.quien, '');
  assert.equal(e.ultimoSuceso, e.acciones[0]!.texto);
});
