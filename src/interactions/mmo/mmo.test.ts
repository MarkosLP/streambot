import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDatabase, configureDatabase, getDb, truncateAll } from '../../data/db.js';
import * as streams from '../../data/streams.js';
import * as consent from '../../core/consent.js';
import { normalize } from '../../core/events.js';
import { handleEvent } from '../../core/handler.js';
import { setSender } from '../../core/output.js';
import * as policy from '../../core/policy.js';
import * as killswitch from '../../core/killswitch.js';
import * as mmo from './index.js';
import type { Viewer } from '../../core/events.js';

const carpeta = mkdtempSync(join(tmpdir(), 'crid4m-mmo-'));
const ahora = Date.UTC(2026, 9, 2, 12, 0, 0);
const persona = (id: string): Viewer => ({
  id, login: id, displayName: id, isBroadcaster: false, isModerator: false,
  isVip: false, isSubscriber: false, rawRole: null,
});

before(() => configureDatabase(join(carpeta, 'mmo.sqlite')));
beforeEach(() => {
  truncateAll();
  streams.openAt(new Date(ahora).toISOString());
  mmo.activar(ahora);
});
after(() => {
  mmo.parar();
  closeDatabase();
  rmSync(carpeta, { recursive: true, force: true });
});

describe('El Linde del Velo', () => {
  test('acepta un !explorar copiado con carácter invisible al final', () => {
    const respuesta = mmo.comando('!explorar \u034f', persona('ana'), 'copiado', ahora);
    assert.match(respuesta!, /1\/4/);
    assert.equal(mmo.estado().objetivo.actual, 1);
  });

  test('una persona completa la expedición y cada premio se entrega una vez', () => {
    const ana = persona('ana');
    for (let i = 0; i < 3; i++) {
      const r = mmo.explorar(ana, `a-${i}`, ahora + i * mmo.ACCION_MS);
      assert.equal(r.tipo, 'ok');
      assert.equal(mmo.estado().objetivo.meta, 4);
    }
    const final = mmo.explorar(ana, 'a-3', ahora + 3 * mmo.ACCION_MS);
    assert.deepEqual(final, { tipo: 'ok', progreso: 4, meta: 4, completada: true, renombre: 8,
      inicio: false, region: 'Fronda Ámbar', hallazgo: 'un altar de savia antigua', texto: 'aparta una cortina de raíces', aporte: 4, participantes: 1,
      objetivo: 'Abrir camino entre las raíces', suceso: null, nueva: true, reliquias: 1, capitulo: null,
      encrucijada: null, voto: null, arriesgado: false });
    assert.equal(mmo.estado().fase, 'resultado');
    assert.deepEqual(mmo.estado().resultado, {
      completada: true, hallazgo: 'un altar de savia antigua',
      premios: [{ nombre: 'ana', renombre: 8 }], nueva: true, capitulo: null, arriesgado: false,
    });
    assert.equal(mmo.renombre('ana'), 8);
    assert.deepEqual(mmo.explorar(ana, 'a-3', ahora + 3 * mmo.ACCION_MS), { tipo: 'repetido' });
    assert.equal(mmo.renombre('ana'), 8);
    const premios = getDb().prepare('SELECT COUNT(*) AS n FROM mmo_premios').get() as { n: number };
    assert.equal(premios.n, 1);
    assert.equal(mmo.estado().acciones.filter((a) => a.quien === 'ana').length, 4,
      'el overlay recibe todos los aportes de la expedición para mostrar sus avatares');
    assert.deepEqual(mmo.estado().memoria.regiones, ['bosque']);
    assert.equal(mmo.estado().memoria.piezas[0]?.nombre, 'un altar de savia antigua');
    closeDatabase();
    assert.deepEqual(mmo.estado().memoria.regiones, ['bosque'], 'las pistas sobreviven al reinicio');
  });

  test('al cerrarse el Velo sin completar no se inventa victoria ni premio', () => {
    mmo.explorar(persona('ana'), 'una-salida', ahora);
    mmo.avanzar(ahora + mmo.DURACION_MS);
    assert.equal(mmo.estado().fase, 'resultado');
    assert.deepEqual(mmo.estado().resultado, { completada: false, hallazgo: null, premios: [], nueva: false, capitulo: null, arriesgado: false });
    assert.equal(mmo.renombre('ana'), 0);
  });

  test('la meta crece según participantes y el tiempo de cada acción se guarda', () => {
    const ana = persona('ana');
    const berto = persona('berto');
    mmo.explorar(ana, 'uno', ahora);
    assert.deepEqual(mmo.explorar(ana, 'dos', ahora + 1), { tipo: 'espera', segundos: 120 });
    const b = mmo.explorar(berto, 'tres', ahora + 1);
    assert.equal(b.tipo, 'ok');
    assert.deepEqual(mmo.estado().objetivo, { actual: 2, meta: 6 });
    closeDatabase(); // simula reiniciar el proceso: el estado y el cooldown siguen en SQLite
    assert.deepEqual(mmo.explorar(ana, 'cuatro', ahora + 2), { tipo: 'espera', segundos: 120 });
    assert.deepEqual(mmo.estado().objetivo, { actual: 2, meta: 6 });
  });

  test('con tres o más, el chat confirma la primera aportación de cada uno y el final; el resto va a la escena', () => {
    const [ana, berto, carla] = ['ana', 'berto', 'carla'].map(persona);
    const dice = (v: Viewer, id: string, t: number) => mmo.comando('!explorar', v, id, t);
    assert.match(dice(ana, 'c1', ahora)!, /cruza el Velo/);
    assert.match(dice(berto, 'c2', ahora + 1)!, /\(2\/6\)/);
    // Con dos, todavía se contesta a todo.
    assert.match(dice(ana, 'c3', ahora + mmo.ACCION_MS)!, /\(3\/6\)/);
    assert.match(dice(carla, 'c4', ahora + mmo.ACCION_MS + 1)!, /\(4\/8\)/, 'la primera de Carla sí');
    assert.equal(dice(berto, 'c5', ahora + mmo.ACCION_MS + 2), null, 'la segunda de Berto ya no');
    assert.equal(mmo.estado().objetivo.actual, 5, 'pero cuenta igual');
    assert.equal(dice(carla, 'c6', ahora + 2 * mmo.ACCION_MS + 1), null);
    assert.equal(dice(ana, 'c7', ahora + 2 * mmo.ACCION_MS + 2), null);
    assert.match(dice(berto, 'c8', ahora + 2 * mmo.ACCION_MS + 3)!, /Expedición completada/, 'el final siempre se anuncia');
  });

  test('pausar congela el plazo y no se progresa sin directo', () => {
    const ana = persona('ana');
    mmo.explorar(ana, 'uno', ahora);
    const antes = mmo.estado().hasta!;
    mmo.pausar(ahora + 60_000);
    assert.equal(mmo.estado().hasta, null, 'la escena no muestra una cuenta atrás en pausa');
    assert.match(mmo.comando('!mundo', ana, 'consulta-pausa', ahora + 60_000)!, /está en pausa/);
    mmo.avanzar(ahora + mmo.DURACION_MS + 1);
    assert.equal(mmo.estado().fase, 'expedicion');
    mmo.activar(ahora + 120_000);
    assert.equal(Date.parse(mmo.estado().hasta!), Date.parse(antes) + 60_000);
    streams.close();
    assert.deepEqual(mmo.explorar(ana, 'dos', ahora + mmo.ACCION_MS), { tipo: 'sin-directo' });
    assert.match(mmo.comando('!mundo', ana, 'consulta-sin-directo', ahora + mmo.ACCION_MS)!, /tiempo detenido/);
    assert.doesNotMatch(mmo.comando('!mundo', ana, 'consulta-sin-directo-2', ahora + mmo.ACCION_MS)!, /0 min/);
  });

  test('sin directo, con el bot apagado o cerrado, el plazo se congela y luego se desplaza', () => {
    mmo.explorar(persona('ana'), 'uno', ahora);
    const plazo = Date.parse(mmo.estado().hasta!);
    // Se corta el directo a los 5 min y vuelve a la hora: la expedición no se ha perdido.
    streams.close(new Date(ahora + 5 * 60_000).toISOString());
    mmo.avanzar(ahora + 5 * 60_000);
    assert.equal(mmo.estado().detenido, 'sin-directo');
    assert.equal(mmo.estado().hasta, null, 'sin cuenta atrás mientras está congelado');
    mmo.avanzar(ahora + mmo.DURACION_MS + 1);
    assert.equal(mmo.estado().fase, 'expedicion');
    streams.open(new Date(ahora + 65 * 60_000).toISOString());
    mmo.avanzar(ahora + 65 * 60_000);
    assert.equal(mmo.estado().detenido, null);
    assert.equal(Date.parse(mmo.estado().hasta!), plazo + 60 * 60_000);
    // Bot apagado desde el interruptor: lo mismo.
    killswitch.disable('prueba');
    mmo.avanzar(ahora + 70 * 60_000);
    assert.equal(mmo.estado().detenido, 'bot-apagado');
    killswitch.enable('prueba');
    mmo.avanzar(ahora + 80 * 60_000);
    assert.equal(Date.parse(mmo.estado().hasta!), plazo + 70 * 60_000);
    // Cerrar el bot congela; al arrancar, el tiempo cerrado no cuenta.
    mmo.parar(ahora + 81 * 60_000);
    mmo.avanzar(ahora + 200 * 60_000);
    assert.equal(mmo.estado().fase, 'expedicion');
    assert.equal(Date.parse(mmo.estado().hasta!), plazo + 189 * 60_000);
    // Una pausa encima de un plazo congelado cuenta desde que se congeló.
    streams.close(new Date(ahora + 201 * 60_000).toISOString());
    mmo.avanzar(ahora + 201 * 60_000);
    mmo.pausar(ahora + 210 * 60_000);
    streams.open(new Date(ahora + 220 * 60_000).toISOString());
    mmo.activar(ahora + 221 * 60_000);
    assert.equal(Date.parse(mmo.estado().hasta!), plazo + 209 * 60_000);
  });

  test('si se desconecta Streamer.bot, la expedición conserva el tiempo hasta que vuelve', () => {
    let conectado = true;
    mmo.setChatConectado(() => conectado);
    try {
      mmo.explorar(persona('ana'), 'uno', ahora);
      const plazo = Date.parse(mmo.estado().hasta!);
      conectado = false;
      mmo.avanzar(ahora + 5 * 60_000);
      assert.equal(mmo.estado().detenido, 'sin-chat');
      assert.equal(mmo.estado().hasta, null);
      // Pasa de largo el plazo con el chat caído: la expedición no se cierra.
      mmo.avanzar(ahora + mmo.DURACION_MS + 10 * 60_000);
      assert.equal(mmo.estado().fase, 'expedicion');
      conectado = true;
      mmo.avanzar(ahora + 45 * 60_000);
      assert.equal(mmo.estado().detenido, null);
      assert.equal(Date.parse(mmo.estado().hasta!), plazo + 40 * 60_000, 'conserva los 15 min que quedaban');
      // Y sigue jugable donde estaba.
      assert.equal(mmo.explorar(persona('berto'), 'dos', ahora + 46 * 60_000).tipo, 'ok');
    } finally {
      mmo.setChatConectado(null);
    }
  });

  test('si el bot se cierra de golpe (sin parar), al arrancar no cuenta el tiempo cerrado', () => {
    const ana = persona('ana');
    mmo.explorar(ana, 'uno', ahora);
    const plazo = Date.parse(mmo.estado().hasta!);
    mmo.avanzar(ahora + 60_000); // último latido antes del corte
    closeDatabase(); // corte de luz: ni parar() ni nada
    // Tres horas después arranca otra vez; sin recuperación, el Velo ya se habría cerrado.
    const vuelta = ahora + 3 * 60 * 60_000;
    mmo.recuperar(vuelta);
    mmo.avanzar(vuelta);
    assert.equal(mmo.estado().fase, 'expedicion');
    assert.equal(Date.parse(mmo.estado().hasta!), plazo + 3 * 60 * 60_000 - 60_000);
    assert.equal(mmo.explorar(ana, 'dos', vuelta + 1000).tipo, 'ok');
    assert.equal(mmo.estado().objetivo.actual, 2, 'el progreso de antes del corte sigue ahí');
    // Si se apagó bien (parar), recuperar no vuelve a descontar nada.
    mmo.parar(vuelta + 2000);
    const congelado = mmo.estado();
    mmo.recuperar(vuelta + 60 * 60_000);
    mmo.avanzar(vuelta + 60 * 60_000);
    assert.equal(Date.parse(mmo.estado().hasta!), plazo + 3 * 60 * 60_000 - 60_000 + 60 * 60_000 - 2000);
    assert.equal(congelado.fase, 'expedicion');
  });

  test('un cierre brusco durante el descanso tampoco se salta la vuelta al refugio', () => {
    const ana = persona('ana');
    for (let i = 0; i < 4; i++) mmo.explorar(ana, `r-${i}`, ahora + i * mmo.ACCION_MS);
    assert.equal(mmo.estado().fase, 'resultado');
    const premios = (getDb().prepare('SELECT COUNT(*) AS n FROM mmo_premios').get() as { n: number }).n;
    mmo.avanzar(ahora + 3 * mmo.ACCION_MS + 1000);
    closeDatabase();
    const vuelta = ahora + 5 * 60 * 60_000;
    mmo.recuperar(vuelta);
    mmo.avanzar(vuelta);
    assert.equal(mmo.estado().fase, 'resultado', 'el cartel de resultado sigue su minuto');
    mmo.avanzar(vuelta + mmo.DESCANSO_MS);
    assert.equal(mmo.estado().fase, 'calma');
    assert.equal((getDb().prepare('SELECT COUNT(*) AS n FROM mmo_premios').get() as { n: number }).n, premios, 'ningún premio repetido al recuperar');
  });

  test('el olvido borra el progreso personal y lo retira de la expedición', () => {
    const ana = persona('ana');
    mmo.explorar(ana, 'uno', ahora);
    consent.olvidar(ana.id);
    assert.deepEqual(mmo.estado().participantes, []);
    assert.deepEqual(mmo.estado().objetivo, { actual: 0, meta: 4 });
    assert.deepEqual(mmo.estado().acciones, []);
    assert.deepEqual(mmo.explorar(ana, 'dos', ahora + mmo.ACCION_MS), { tipo: 'olvidado' });
  });

  test('el comando del chat usa el manejador y la salida habitual', async () => {
    const enviados: string[] = [];
    policy.reset();
    setSender(async (texto) => { enviados.push(texto); });
    const evento = normalize('Twitch.ChatMessage', {
      messageId: 'mmo-chat-1',
      user: { id: 'id-ana', login: 'ana', name: 'ana', role: 1, badges: [], subscribed: false },
      text: '!explorar',
      meta: { firstMessage: false, returningChatter: false },
    }, 'simulator');
    await handleEvent(evento);
    assert.equal(mmo.estado().objetivo.actual, 1);
    assert.equal(enviados.length, 1);
    assert.match(enviados[0]!, /cruza el Velo hacia Fronda Ámbar/);
    setSender(null);
  });

  test('el estado para OBS contiene nombres, pero no identificadores de Twitch', () => {
    const ana = { ...persona('id-secreto-42'), login: 'ana', displayName: 'Aventurera' };
    mmo.explorar(ana, 'mensaje-privado', ahora);
    const publico = JSON.stringify(mmo.estado());
    assert.match(publico, /Aventurera/);
    assert.doesNotMatch(publico, /id-secreto-42|mensaje-privado|twitch_id/);
  });
});
