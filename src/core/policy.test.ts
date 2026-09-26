import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as policy from './policy.js';
import * as killswitch from './killswitch.js';
import { config, MAX_MESSAGE_LENGTH } from '../config.js';

describe('policy', () => {
  beforeEach(() => {
    killswitch.enable('test');
    policy.reset();
  });

  test('deja pasar un mensaje normal', () => {
    const r = policy.evaluate({ text: 'hola, ¿mando o teclado?', reason: 'test' });
    assert.equal(r.ok, true);
  });

  test('recorta los espacios sobrantes', () => {
    const r = policy.evaluate({ text: '   hola   ', reason: 'test' });
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.text, 'hola');
  });

  test('bloquea un mensaje vacío', () => {
    const r = policy.evaluate({ text: '', reason: 'test' });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.rejection, 'empty');
  });

  test('bloquea un mensaje que solo tiene espacios', () => {
    const r = policy.evaluate({ text: '     ', reason: 'test' });
    assert.equal(!r.ok && r.rejection, 'empty');
  });

  test(`bloquea a partir de ${MAX_MESSAGE_LENGTH + 1} caracteres`, () => {
    const justo = policy.evaluate({ text: 'a'.repeat(MAX_MESSAGE_LENGTH), reason: 'test' });
    assert.equal(justo.ok, true, 'el límite exacto debe pasar');

    const pasado = policy.evaluate({ text: 'a'.repeat(MAX_MESSAGE_LENGTH + 1), reason: 'test' });
    assert.equal(!pasado.ok && pasado.rejection, 'too-long');
  });

  test('bloquea saltos de línea y caracteres de control', () => {
    assert.equal(
      !policy.evaluate({ text: 'hola\nadiós', reason: 'test' }).ok,
      true,
      'el salto de línea debe bloquearse',
    );
    const r = policy.evaluate({ text: 'hola\u0007', reason: 'test' });
    assert.equal(!r.ok && r.rejection, 'control-chars');
  });

  test('bloquea mensajes que Twitch interpretaría como comando', () => {
    for (const texto of ['/ban pepe', '.me hola', '/timeout ana 600']) {
      const r = policy.evaluate({ text: texto, reason: 'test' });
      assert.equal(!r.ok && r.rejection, 'twitch-command', `debería bloquear "${texto}"`);
    }
  });

  test('bloquea enlaces', () => {
    for (const texto of ['mira https://ejemplo.com', 'entra en www.algo.es', 'visita midominio.tv']) {
      const r = policy.evaluate({ text: texto, reason: 'test' });
      assert.equal(!r.ok && r.rejection, 'url', `debería bloquear "${texto}"`);
    }
  });

  test('bloquea menciones a quien no participa', () => {
    const r = policy.evaluate({ text: '@ana mira esto', reason: 'test', allowedMentions: ['pepe'] });
    assert.equal(!r.ok && r.rejection, 'mention-not-allowed');
  });

  test('permite menciones a quien sí participa, sin distinguir mayúsculas', () => {
    const r = policy.evaluate({ text: '@Ana hola', reason: 'test', allowedMentions: ['ana'] });
    assert.equal(r.ok, true);
  });

  test('sin allowedMentions no se puede mencionar a nadie', () => {
    const r = policy.evaluate({ text: '@pepe hola', reason: 'test' });
    assert.equal(!r.ok && r.rejection, 'mention-not-allowed');
  });

  test('bloquea todo cuando el interruptor de emergencia está accionado', () => {
    killswitch.disable('test');
    const r = policy.evaluate({ text: 'hola', reason: 'test' });
    assert.equal(!r.ok && r.rejection, 'killswitch');
  });

  test('bloquea al agotar el techo de mensajes por hora', () => {
    const ahora = Date.now();
    for (let i = 0; i < config.messagesPerHour; i += 1) {
      assert.equal(policy.evaluate({ text: 'hola', reason: 'test' }, ahora).ok, true);
      policy.registerSent(ahora);
    }

    const pasado = policy.evaluate({ text: 'hola', reason: 'test' }, ahora);
    assert.equal(!pasado.ok && pasado.rejection, 'hourly-budget');

    // Una hora después vuelve a haber presupuesto.
    const unaHoraDespues = ahora + 60 * 60 * 1000 + 1;
    assert.equal(policy.evaluate({ text: 'hola', reason: 'test' }, unaHoraDespues).ok, true);
  });

  test('lo que alguien pide tiene su propio techo: el bot callado no deja a nadie sin respuesta', () => {
    const ahora = Date.now();
    for (let i = 0; i < config.messagesPerHour; i += 1) policy.registerSent(ahora);
    assert.equal(policy.evaluate({ text: 'hola', reason: 'test' }, ahora).ok, false, 'el espontáneo, agotado');
    assert.equal(policy.evaluate({ text: 'hola', reason: 'test', solicitado: true }, ahora).ok, true, 'la respuesta, no');
  });

  test('las consultas dejan el final del techo a las acciones', () => {
    const ahora = Date.now();
    const reserva = Math.ceil(config.respuestasPerHour * config.reservaAcciones);
    for (let i = 0; i < config.respuestasPerHour - reserva; i += 1) policy.registerSent(ahora, true);
    const consulta = policy.evaluate({ text: 'hola', reason: 'test', solicitado: true, consulta: true }, ahora);
    assert.equal(!consulta.ok && consulta.rejection, 'hourly-budget', 'una consulta ya no cabe');
    assert.equal(policy.evaluate({ text: 'hola', reason: 'test', solicitado: true }, ahora).ok, true, 'una acción sí');
  });

  test('y las respuestas no gastan del techo espontáneo, pero tienen el suyo', () => {
    const ahora = Date.now();
    for (let i = 0; i < config.respuestasPerHour; i += 1) policy.registerSent(ahora, true);
    const respuesta = policy.evaluate({ text: 'hola', reason: 'test', solicitado: true }, ahora);
    assert.equal(!respuesta.ok && respuesta.rejection, 'hourly-budget');
    assert.equal(policy.evaluate({ text: 'hola', reason: 'test' }, ahora).ok, true);
  });
});
