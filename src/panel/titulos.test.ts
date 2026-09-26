import { test, describe, beforeEach, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { configureDatabase, truncateAll, getDb } from '../data/db.js';
import * as lootDb from '../data/loot.js';
import * as interactionLog from '../data/interactions.js';
import { setGenerador, type Peticion as PeticionIa } from '../services/ia-local.js';
import * as titulos from './titulos.js';

/** Sugerencias de título con la IA local: aquí, una IA de mentira. */

let pedidos: PeticionIa[] = [];
let respuesta: unknown = {};

before(() => configureDatabase(':memory:'));
after(() => setGenerador(null));

beforeEach(() => {
  truncateAll();
  pedidos = [];
  respuesta = {
    titulos: ['«Raid épica: hoy cae el jefe»', 'Farmeo tranquilo y charla', 'x'.repeat(200), 'Farmeo tranquilo y charla', '  '],
    anuncio: '¡En directo! Raid en WoW #MMO',
    etiquetas: ['Español', 'MMO', 'World of Warcraft', '#raid', 'mmo', 'Épico'],
  };
  // Como la de verdad: si le piden los del chat, contesta con titulos_chat.
  setGenerador(async (p) => {
    pedidos.push(p);
    const r = respuesta as { titulos_chat?: unknown };
    return /minijuego del chat:/.test(p.usuario) ? { titulos: r.titulos_chat ?? [] } : respuesta;
  });
});

const PEDIDO = { juego: 'World of Warcraft', sesion: 'Raid', tono: 'Épico' };

describe('sugerir títulos', () => {
  test('limpia: sin comillas, sin repetidos, nada de más de 140, nada vacío', async () => {
    const r = await titulos.sugerir(PEDIDO);
    assert.deepEqual(r.titulos.map((t) => t.texto), ['Raid épica: hoy cae el jefe', 'Farmeo tranquilo y charla']);
    assert.ok(r.titulos.every((t) => Number.isInteger(t.id)), 'se guardan, con id');
  });

  test('la categoría es el juego; las etiquetas, como las quiere Twitch', async () => {
    const r = await titulos.sugerir(PEDIDO);
    assert.equal(r.categoria, 'World of Warcraft');
    assert.deepEqual(r.etiquetas, ['Espanol', 'MMO', 'WorldofWarcraft', 'raid', 'Epico']);
    assert.equal(r.anuncio, '¡En directo! Raid en WoW #MMO');
  });

  test('lo que ya usaste o marcaste se le pasa a la IA, y si lo repite se descarta', async () => {
    const primera = await titulos.sugerir(PEDIDO);
    titulos.marcar(primera.titulos[0]!.id, { usado: true });
    titulos.marcar(primera.titulos[1]!.id, { favorito: true });
    respuesta = { titulos: ['Raid épica: hoy cae el jefe', 'Uno nuevo'], anuncio: '', etiquetas: [] };
    const segunda = await titulos.sugerir(PEDIDO);
    assert.match(pedidos[1]!.usuario, /no los repitas.*«Raid épica: hoy cae el jefe»/s);
    assert.deepEqual(segunda.titulos.map((t) => t.texto), ['Uno nuevo']);
    const l = titulos.listado();
    assert.deepEqual(l.favoritos.map((t) => t.texto), ['Farmeo tranquilo y charla']);
    assert.deepEqual(l.usados.map((t) => t.texto), ['Raid épica: hoy cae el jefe']);
    assert.deepEqual(l.juegos, ['World of Warcraft']);
  });

  test('emojis: cuenta los compuestos como uno, y recorta los que sobran', () => {
    assert.equal(titulos.contarEmojis('⚔️ Raid 🧙‍♂️ hoy 🔥'), 3);
    assert.equal(titulos.recortarEmojis('⚔️ Raid 🧙‍♂️ hoy 🔥', 1), '⚔️ Raid  hoy ');
    assert.equal(titulos.limpiarTitulo('⚔️ Raid 🧙‍♂️ hoy 🔥', 0), 'Raid hoy');
  });

  test('pide los emojis que toca, con la paleta del tono, y no deja pasar de más', async () => {
    respuesta = { titulos: ['🔥⚔️🐉 Raid épica'], anuncio: '', etiquetas: [] };
    const r = await titulos.sugerir({ ...PEDIDO, emojis: 2 });
    assert.match(pedidos[0]!.usuario, /exactamente 2 emojis.*⚔️/);
    assert.equal(r.titulos[0]!.texto, '🔥⚔️ Raid épica');
    await titulos.sugerir({ ...PEDIDO, emojis: 0 });
    assert.match(pedidos[1]!.usuario, /Sin emojis/);
  });

  test('si no sale ningún título que sirva, lo dice', async () => {
    respuesta = { titulos: ['x'.repeat(300)], anuncio: '', etiquetas: [] };
    await assert.rejects(titulos.sugerir(PEDIDO), /ningún título/);
  });

  test('lo del chat va como MINIJUEGO, no como parte del juego', async () => {
    lootDb.dar('id-ana', 'ana', { objeto: 'Filo del Vacío', rareza: 'legendario' }, 'cofre');
    interactionLog.record({ interaction: 'loot-atacar', twitchId: 'id-ana', status: 'sent', detail: 'jefe derrotado, la Araña Reina: ana=120, luis=80' });
    const r = await titulos.sugerir({ ...PEDIDO, conCanal: true });
    assert.ok(r.contexto.includes('el chat derrotó a la Araña Reina (el que más pegó: ana)'), r.contexto.join(' | '));
    assert.equal(titulos.contextoCanal().length, 3);
    assert.ok(r.contexto.includes('ana consiguió el objeto legendario «Filo del Vacío»'));
    assert.doesNotMatch(pedidos[0]!.usuario, /Araña|Filo del Vacío/, 'los del juego se piden sin nada del chat');
    assert.match(pedidos[1]!.usuario, /minijuego del chat: .*Araña Reina/);
    assert.match(pedidos[1]!.sistema, /NO son del juego/);
  });

  test('los del chat van aparte y marcados; sin nada del chat, se ignoran', async () => {
    respuesta = { titulos: ['Raid de miércoles'], titulos_chat: ['Tras tumbar a la Araña en el chat, a por la raid'], anuncio: '', etiquetas: [] };
    const sinChat = await titulos.sugerir(PEDIDO);
    assert.deepEqual(sinChat.titulos.map((t) => t.delChat), [false], 'sin contexto no se aceptan los del chat');
    lootDb.dar('id-ana', 'ana', { objeto: 'Filo del Vacío', rareza: 'legendario' }, 'cofre');
    respuesta = { titulos: ['Raid de jueves'], titulos_chat: ['Tras tumbar a la Araña en el chat, a por la raid'], anuncio: '', etiquetas: [] };
    const conChat = await titulos.sugerir({ ...PEDIDO, conCanal: true });
    assert.deepEqual(conChat.titulos.map((t) => [t.texto, t.delChat]), [['Raid de jueves', false], ['Tras tumbar a la Araña en el chat, a por la raid', true]]);
  });

  test('sin «usar el chat», no se le cuenta nada del minijuego', async () => {
    lootDb.dar('id-ana', 'ana', { objeto: 'Filo del Vacío', rareza: 'legendario' }, 'cofre');
    await titulos.sugerir(PEDIDO);
    assert.doesNotMatch(pedidos[0]!.usuario, /Filo del Vacío/);
    assert.equal(pedidos.length, 1, 'sin «usar el chat», una sola petición');
  });

  test('la limpieza borra las sugerencias viejas que no marcaste', async () => {
    const r = await titulos.sugerir(PEDIDO);
    titulos.marcar(r.titulos[0]!.id, { favorito: true });
    getDb().prepare('UPDATE titulos SET at = ?').run('2020-01-01T00:00:00.000Z');
    titulos.podar();
    const quedan = getDb().prepare('SELECT texto FROM titulos').all() as Array<{ texto: string }>;
    assert.deepEqual(quedan.map((t) => t.texto), ['Raid épica: hoy cae el jefe']);
  });
});
