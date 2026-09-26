import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, type ViewerMessageEvent, type ChatModeracionEvent } from './events.js';
import * as chatReciente from './chat-reciente.js';

/** El chat en pantalla de la escena Charla: lo que entra, cómo, y lo que se quita. */

function msg(login: string, texto: string, extra: Record<string, unknown> = {}) {
  return normalize('Twitch.ChatMessage', {
    messageId: `id-${login}-${texto}`,
    user: { id: `u-${login}`, login, name: login, role: 1, badges: [], subscribed: false, color: '#1E90FF' },
    text: texto,
    meta: {},
    ...extra,
  }, 'streamerbot') as ViewerMessageEvent;
}

beforeEach(() => chatReciente.reset());

describe('chat en pantalla', () => {
  test('guarda el color y solo los emotes de sitios conocidos', () => {
    const e = msg('ana', 'hola Kappa pwned', {
      emotes: [
        { name: 'Kappa', imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0' },
        { name: 'pwned', imageUrl: 'https://malo.example/x.png' },
        { name: 'raro', imageUrl: 'javascript:alert(1)' },
      ],
    });
    assert.equal(e.color, '#1E90FF');
    assert.deepEqual(e.emotes!.map((x) => x.nombre), ['Kappa']);
  });

  test('un color que no es #RRGGBB no pasa', () => {
    assert.equal(msg('ana', 'hola', { user: { id: 'u', login: 'ana', name: 'ana', color: 'red;background:url(x)' } }).color, undefined);
  });

  test('lo que quita un moderador sale también de aquí', () => {
    chatReciente.apuntar(msg('ana', 'uno'));
    chatReciente.apuntar(msg('troll', 'algo feo'));
    chatReciente.apuntar(msg('troll', 'otra cosa'));
    chatReciente.apuntar(msg('pepe', 'dos'));
    const borrado = normalize('Twitch.ChatMessageDeleted', { messageId: 'id-ana-uno' }, 'streamerbot') as ChatModeracionEvent;
    assert.equal(chatReciente.moderar(borrado), 1);
    const fuera = normalize('Twitch.UserTimedOut', { user_id: 'u-troll', user_login: 'troll' }, 'streamerbot') as ChatModeracionEvent;
    assert.equal(chatReciente.moderar(fuera), 2);
    assert.deepEqual(chatReciente.recientes().map((m) => m.texto), ['dos']);
    chatReciente.moderar(normalize('Twitch.ChatCleared', {}, 'streamerbot') as ChatModeracionEvent);
    assert.equal(chatReciente.recientes().length, 0);
  });

  test('guarda los últimos 30 y corta los mensajes larguísimos', () => {
    for (let i = 0; i < 40; i++) chatReciente.apuntar(msg('ana', `m${i}`));
    assert.equal(chatReciente.recientes(100).length, 30);
    chatReciente.apuntar(msg('ana', 'x'.repeat(500)));
    assert.equal(chatReciente.recientes(1)[0]!.texto.length, 301);
  });
});
