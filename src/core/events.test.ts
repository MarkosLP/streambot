import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { normalize, type ViewerRedeemEvent } from './events.js';

/**
 * Normalización de payloads de Streamer.bot.
 *
 * Estos tests existen por un fallo real: durante la prueba de la Fase 5 las
 * dos redenciones de Channel Point llegaron con el espectador y la pregunta
 * vacíos, y se descartaron sin llamar a la IA. La causa era que leíamos
 * `payload.user` y `payload.userInput` cuando Streamer.bot manda `user_id`,
 * `user_login`, `user_name` y `user_input` planos.
 */

function redeem(payload: unknown): ViewerRedeemEvent {
  const event = normalize('Twitch.RewardRedemption', payload, 'streamerbot');
  assert.equal(event.type, 'viewer.redeem');
  return event as ViewerRedeemEvent;
}

const RECOMPENSA = { id: '49dd93e7-f9bb-4c9f-9a02-4363922d90e0', title: 'Pregunta a Crid4m AI', cost: 500 };

describe('normalize', () => {
  describe('redención de Channel Point', () => {
    test('lee la forma plana en snake_case (la que manda Streamer.bot)', () => {
      const event = redeem({
        id: 'redemption-1',
        user_id: '125801906',
        user_login: 'crid4m',
        user_name: 'Crid4m',
        user_input: '¿tortilla con cebolla o sin?',
        status: 'unfulfilled',
        reward: RECOMPENSA,
      });

      assert.equal(event.viewer.id, '125801906');
      assert.equal(event.viewer.login, 'crid4m');
      assert.equal(event.viewer.displayName, 'Crid4m');
      assert.equal(event.userInput, '¿tortilla con cebolla o sin?');
      assert.equal(event.rewardId, RECOMPENSA.id);
      assert.equal(event.rewardCost, 500);
    });

    test('sigue leyendo la forma antigua anidada en `user`', () => {
      const event = redeem({
        user: { id: '125801906', login: 'crid4m', name: 'Crid4m', badges: [] },
        userInput: '¿mando o teclado?',
        reward: RECOMPENSA,
      });

      assert.equal(event.viewer.id, '125801906');
      assert.equal(event.viewer.login, 'crid4m');
      assert.equal(event.userInput, '¿mando o teclado?');
    });

    test('un `user` vacío no tapa los campos planos', () => {
      const event = redeem({
        user: {},
        user_id: '125801906',
        user_login: 'crid4m',
        user_input: 'hola',
        reward: RECOMPENSA,
      });

      assert.equal(event.viewer.id, '125801906');
      assert.equal(event.userInput, 'hola');
    });

    test('el login se normaliza a minúsculas', () => {
      const event = redeem({ user_id: '1', user_login: 'CRID4M', reward: RECOMPENSA });
      assert.equal(event.viewer.login, 'crid4m');
    });

    test('sin nombre visible, cae al login', () => {
      const event = redeem({ user_id: '1', user_login: 'pepe', reward: RECOMPENSA });
      assert.equal(event.viewer.displayName, 'pepe');
    });

    test('una redención NO concede permisos: no trae badges', () => {
      const event = redeem({ user_id: '1', user_login: 'pepe', reward: RECOMPENSA });

      assert.equal(event.viewer.isBroadcaster, false);
      assert.equal(event.viewer.isModerator, false);
      assert.equal(event.viewer.isVip, false);
      assert.equal(event.viewer.isSubscriber, false);
    });

    test('recompensa sin texto: userInput vacío, pero el espectador se reconoce', () => {
      const event = redeem({ user_id: '1', user_login: 'pepe', reward: RECOMPENSA });

      assert.equal(event.userInput, '');
      assert.equal(event.viewer.id, '1');
    });

    test('un payload irreconocible no rompe nada', () => {
      const event = redeem({ algo: 'inesperado' });

      assert.equal(event.viewer.id, '');
      assert.equal(event.userInput, '');
      assert.equal(event.rewardId, '');
    });
  });

  describe('mensaje de chat', () => {
    test('lee usuario, texto y badges', () => {
      const event = normalize(
        'Twitch.ChatMessage',
        {
          user: { id: '1', login: 'pepe', name: 'Pepe', badges: [{ name: 'moderator' }] },
          text: 'hola',
          meta: { firstMessage: true },
        },
        'streamerbot',
      );

      assert.equal(event.type, 'viewer.message');
      if (event.type !== 'viewer.message') return;
      assert.equal(event.viewer.login, 'pepe');
      assert.equal(event.text, 'hola');
      assert.equal(event.viewer.isModerator, true);
      assert.equal(event.isFirstMessage, true);
    });
  });

  test('un evento desconocido se guarda en crudo', () => {
    const event = normalize('Twitch.Announcement', { user_login: 'pepe' }, 'streamerbot');
    assert.equal(event.type, 'raw');
  });

  test('follow real de Streamer.bot: el seguidor viene en targetUser', () => {
    const event = normalize('Twitch.Follow', {
      targetUser: { id: '975661956', login: 'h4ppyo4', name: 'h4ppyo4', type: 'twitch' },
      broadcaster: { id: '125801906', login: 'crid4m', name: 'Crid4m', type: 'twitch' },
      followedAt: '2026-09-28T21:47:05.5149917Z', isTest: false,
    }, 'streamerbot');
    assert.equal(event.type, 'viewer.follow');
    if (event.type !== 'viewer.follow') return;
    assert.equal(event.viewer.id, '975661956');
    assert.equal(event.viewer.login, 'h4ppyo4');
    assert.equal(event.viewer.displayName, 'h4ppyo4');
  });
});
