import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as cooldowns from './cooldowns.js';

describe('cooldowns', () => {
  beforeEach(() => cooldowns.reset());

  test('la primera vez siempre pasa', () => {
    assert.equal(cooldowns.tryConsume('k', 1000, 0), true);
  });

  test('impide una segunda ejecución dentro de la ventana', () => {
    assert.equal(cooldowns.tryConsume('k', 1000, 0), true);
    assert.equal(cooldowns.tryConsume('k', 1000, 500), false);
    assert.equal(cooldowns.tryConsume('k', 1000, 999), false);
  });

  test('vuelve a permitir justo al cumplirse la ventana', () => {
    cooldowns.tryConsume('k', 1000, 0);
    assert.equal(cooldowns.tryConsume('k', 1000, 1000), true);
  });

  test('un intento bloqueado no reinicia el contador', () => {
    cooldowns.tryConsume('k', 1000, 0);
    cooldowns.tryConsume('k', 1000, 900); // bloqueado
    // Si el intento fallido hubiera re-marcado, esto seguiría bloqueado.
    assert.equal(cooldowns.tryConsume('k', 1000, 1000), true);
  });

  test('las claves son independientes entre sí', () => {
    assert.equal(cooldowns.tryConsume('a', 1000, 0), true);
    assert.equal(cooldowns.tryConsume('b', 1000, 0), true);
  });

  test('cooldown global y por usuario no se pisan', () => {
    const global = cooldowns.keys.interaction('saludo');
    const pepe = cooldowns.keys.user('saludo', '123');
    assert.notEqual(global, pepe);
    assert.equal(cooldowns.tryConsume(global, 1000, 0), true);
    assert.equal(cooldowns.tryConsume(pepe, 1000, 0), true);
  });

  test('remaining informa de lo que falta', () => {
    cooldowns.tryConsume('k', 1000, 0);
    assert.equal(cooldowns.remaining('k', 1000, 400), 600);
    assert.equal(cooldowns.remaining('k', 1000, 1000), 0);
  });
});
