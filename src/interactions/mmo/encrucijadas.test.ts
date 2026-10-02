import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDatabase, configureDatabase, getDb, truncateAll } from '../../data/db.js';
import * as streams from '../../data/streams.js';
import * as killswitch from '../../core/killswitch.js';
import { BONO_ARRIESGADO, CRONICA, META_ARRIESGADA, VOTO_MS } from './contenido.js';
import * as mmo from './index.js';
import type { Viewer } from '../../core/events.js';

/** Encrucijadas: el chat vota con !explorar 1 o !explorar 2 a mitad de camino. */

const carpeta = mkdtempSync(join(tmpdir(), 'crid4m-mmo-encrucijadas-'));
const T = Date.UTC(2026, 9, 3, 18, 0, 0);
const MIN = 60_000;
const persona = (id: string): Viewer => ({
  id, login: id, displayName: id[0]!.toUpperCase() + id.slice(1), isBroadcaster: false, isModerator: false, isVip: false, isSubscriber: false, rawRole: null,
});
const [ana, berto, carla] = ['ana', 'berto', 'carla'].map(persona) as [Viewer, Viewer, Viewer];
let id = 0;
const dice = (v: Viewer, texto: string, t: number) => mmo.comando(texto, v, `m-${id++}`, t);

before(() => configureDatabase(join(carpeta, 'mmo.sqlite')));
beforeEach(() => {
  truncateAll();
  killswitch.enable('encrucijadas');
  streams.openAt(new Date(T - MIN).toISOString());
  mmo.activar(T);
  mmo.setAzar(() => 0); // siempre encrucijada (0 < 40 %) y la primera de la región
});
after(() => {
  mmo.setAzar(null);
  closeDatabase();
  rmSync(carpeta, { recursive: true, force: true });
});

/** Ana sale y da el segundo paso: con meta 4, ahí se abre la encrucijada. */
function hastaLaEncrucijada(): string {
  dice(ana, '!explorar', T);
  return dice(ana, '!explorar', T + 2 * MIN)!;
}

describe('Encrucijadas', () => {
  test('se abre a mitad de camino y se anuncia en el chat', () => {
    const aviso = hastaLaEncrucijada();
    assert.match(aviso, /⚔ Encrucijada: .+ Votad !explorar 1 \(Seguir el camino conocido\) o !explorar 2 \(Tomar el sendero de brasas\)\./);
    const e = mmo.estado().encrucijada!;
    assert.equal(e.decision, null);
    assert.equal(Date.parse(e.hasta!), T + 2 * MIN + VOTO_MS);
    assert.deepEqual(e.opciones.map((o) => o.votos), [0, 0]);
    assert.equal(mmo.estado().acciones[0]!.suceso, true);
    assert.match(dice(berto, '!mundo', T + 2 * MIN + 1)!, /Encrucijada abierta: !explorar 1 .+ o !explorar 2/);
  });

  test('se vota aunque toque esperar, se puede cambiar el voto y gana la mayoría: el camino arriesgado', () => {
    hastaLaEncrucijada();
    // Ana acaba de explorar: su voto cuenta igual y se confirma una vez.
    assert.match(dice(ana, '!explorar 2', T + 2 * MIN + 10_000)!, /Ana vota «Tomar el sendero de brasas» \(0 a 1\)\. Podrás explorar en \d+ s\./);
    assert.equal(dice(ana, '!explorar 2', T + 2 * MIN + 20_000), null, 'repetir el mismo voto no hace hablar al bot');
    // Berto se une votando 1 y luego cambia de idea: un voto por persona.
    assert.match(dice(berto, '!explorar 1', T + 2 * MIN + 30_000)!, /Vota «Seguir el camino conocido» \(1 a 1\)/);
    dice(berto, '!explorar 2', T + 2 * MIN + 40_000);
    assert.deepEqual(mmo.estado().encrucijada!.opciones.map((o) => o.votos), [0, 2]);
    const metaAntes = mmo.estado().objetivo.meta;
    // Vence la votación sin que nadie escriba: el reloj del mundo la decide.
    mmo.avanzar(T + 2 * MIN + VOTO_MS);
    const e = mmo.estado();
    assert.equal(e.encrucijada!.decision, 2);
    assert.equal(e.encrucijada!.hasta, null);
    assert.equal(e.objetivo.meta, metaAntes + META_ARRIESGADA);
    assert.match(e.ultimoSuceso, /La compañía elige: Tomar el sendero de brasas\. El camino será más largo/);
    // Se completa y cada uno se lleva el extra.
    let t = T + 2 * MIN + VOTO_MS;
    while (mmo.estado().fase === 'expedicion') {
      t += 2 * MIN;
      dice(ana, '!explorar', t);
      dice(berto, '!explorar', t + 1);
    }
    const r = mmo.estado().resultado!;
    assert.equal(r.arriesgado, true);
    for (const p of r.premios) assert.ok(p.renombre >= 5 + 1 + BONO_ARRIESGADO, `${p.nombre}: ${p.renombre}`);
  });

  test('sin votos o con empate gana el camino prudente, y la meta no cambia', () => {
    hastaLaEncrucijada();
    dice(berto, '!explorar 1', T + 2 * MIN + 1000);
    dice(carla, '!explorar 2', T + 2 * MIN + 2000);
    const meta = mmo.estado().objetivo.meta;
    mmo.avanzar(T + 2 * MIN + VOTO_MS + 1);
    assert.equal(mmo.estado().encrucijada!.decision, 1);
    assert.equal(mmo.estado().objetivo.meta, meta);
    assert.match(mmo.estado().ultimoSuceso, /elige: Seguir el camino conocido\.$/);
  });

  test('si la barra se llena con la votación abierta y gana el riesgo, la expedición se alarga', () => {
    // Dos personas: meta 6, la encrucijada se abre en el 3/6 (T + 2 min) y se vota hasta T + 5 min.
    dice(ana, '!explorar', T);
    dice(berto, '!explorar', T + 1000);
    dice(ana, '!explorar', T + 2 * MIN);
    assert.ok(mmo.estado().encrucijada);
    dice(berto, '!explorar 2', T + 2 * MIN + 1000); // 4/6 y vota el riesgo
    dice(ana, '!explorar', T + 4 * MIN); // 5/6
    const r = mmo.explorar(berto, 'llena', T + 4 * MIN + 1000); // 6/6 con la votación aún abierta
    assert.equal(r.tipo, 'ok');
    assert.equal(r.tipo === 'ok' && r.completada, false, 'el camino arriesgado sigue');
    assert.equal(mmo.estado().encrucijada!.decision, 2);
    assert.equal(mmo.estado().objetivo.meta, 6 + META_ARRIESGADA);
    assert.equal(mmo.estado().fase, 'expedicion');
  });

  test('con el tiempo congelado la votación tampoco corre', () => {
    hastaLaEncrucijada();
    const hasta = Date.parse(mmo.estado().encrucijada!.hasta!);
    streams.close(new Date(T + 3 * MIN).toISOString());
    mmo.avanzar(T + 3 * MIN);
    assert.equal(mmo.estado().encrucijada!.hasta, null, 'sin cuenta atrás mientras está congelado');
    mmo.avanzar(T + 30 * MIN);
    assert.equal(mmo.estado().encrucijada!.decision, null, 'no se decide sin directo');
    streams.open(new Date(T + 33 * MIN).toISOString());
    mmo.avanzar(T + 33 * MIN);
    assert.equal(Date.parse(mmo.estado().encrucijada!.hasta!), hasta + 30 * MIN);
  });

  test('!olvidame retira también el voto', () => {
    hastaLaEncrucijada();
    dice(berto, '!explorar 2', T + 2 * MIN + 1000);
    mmo.olvidar(berto.id);
    assert.deepEqual(mmo.estado().encrucijada!.opciones.map((o) => o.votos), [0, 0]);
    assert.equal((getDb().prepare("SELECT COUNT(*) AS n FROM mmo_votos WHERE twitch_id = 'berto'").get() as { n: number }).n, 0);
  });

  test('sin encrucijada, «!explorar 2» es un !explorar normal', () => {
    mmo.setAzar(() => 0.99);
    const r = mmo.explorar(ana, 'sin', T, 2);
    assert.equal(r.tipo, 'ok');
    assert.equal(r.tipo === 'ok' && r.voto, null);
    assert.equal(mmo.estado().encrucijada, null);
  });

  test('una compañía audaz cambia el final de la crónica', () => {
    // Ana sola y siempre «!explorar 2»: todas las encrucijadas por el camino arriesgado.
    // Ojo: tras completar, el minuto de descanso pasa en el mismo avance de 2 min; se cuentan resultados.
    const resultados = () => (getDb().prepare('SELECT COUNT(*) AS n FROM mmo_resultados').get() as { n: number }).n;
    let t = T;
    while (resultados() < 90) {
      dice(ana, '!explorar 2', t);
      t += 2 * MIN;
      mmo.avanzar(t);
    }
    const e = mmo.estado();
    assert.equal(e.cronica.capitulo, CRONICA.length - 1);
    assert.equal(e.cronica.titulo, CRONICA.at(-1)!.audaz!.titulo);
    const decisiones = getDb().prepare('SELECT decision, COUNT(*) AS n FROM mmo_expediciones WHERE decision IS NOT NULL GROUP BY decision').all() as Array<{ decision: number; n: number }>;
    assert.deepEqual(decisiones.map((d) => d.decision), [2], 'todas arriesgadas');
  });
});
