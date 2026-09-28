import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { configureDatabase, truncateAll, getDb } from '../data/db.js';
import { normalize, type DomainEvent } from './events.js';
import * as alertas from './alertas.js';

/**
 * Alertas y panel rotativo: qué avisos salen, qué se cuenta para la meta y
 * que lo de «Probar» no cuente para nada.
 */

before(() => configureDatabase(':memory:'));
beforeEach(() => {
  truncateAll();
  alertas.reset();
});

const ev = (nombre: string, datos: any): DomainEvent => normalize(nombre, datos, 'simulator');

describe('alertas', () => {
  test('Streamlabs: ajustes antiguos o nuevas peticiones no reactivan follows ni suscripciones', () => {
    getDb().prepare('INSERT INTO ajustes (clave, valor, at) VALUES (?, ?, ?)').run('overlays', JSON.stringify({ ajustes: { alertas: { follow: true, sub: true, regalo: true } } }), new Date().toISOString());
    alertas.reset();
    for (const tipo of ['follow', 'sub', 'regalo'] as const) {
      assert.equal(alertas.ajustes().alertas[tipo], false);
      alertas.cambiarAjustes({ alertas: { [tipo]: true } });
      assert.equal(alertas.ajustes().alertas[tipo], false);
      assert.throws(() => alertas.probar(tipo), /Streamlabs/);
    }
    assert.equal(alertas.paraAlertas().alertas.length, 0);
  });
  test('un follow se cuenta y guarda sin emitir una alerta propia', () => {
    const e = ev('Twitch.Follow', { user_id: '7', user_login: 'raftaei', user_name: 'raftaei' });
    assert.equal(e.type, 'viewer.follow');
    assert.equal(alertas.alEvento(e), null);
    assert.equal(alertas.estado().ultimoFollow?.quien, 'raftaei');
    assert.equal(alertas.estado().mes.follows, 1);
  });

  test('dejar de seguir y volver no repite la alerta; los bots no cuentan', () => {
    const f = ev('Twitch.Follow', { user_id: '7', user_login: 'raftaei', user_name: 'raftaei' });
    alertas.alEvento(f);
    assert.equal(alertas.alEvento(f), null);
    assert.equal(alertas.alEvento(ev('Twitch.Follow', { user_id: '9', user_login: 'streamelements', user_name: 'StreamElements' })), null);
    assert.equal(alertas.estado().mes.follows, 1);
  });

  test('subs, regalos, bomba, bits y raid; los regalos sueltos de una bomba no repiten alerta', () => {
    assert.equal(alertas.alEvento(ev('Twitch.ReSub', { userName: 'ana', displayName: 'Ana', cumulativeMonths: 6 })), null);
    assert.equal(alertas.alEvento(ev('Twitch.GiftBomb', { userName: 'pepe', displayName: 'Pepe', gifts: 5 })), null);
    assert.equal(alertas.alEvento(ev('Twitch.GiftSub', { userName: 'pepe', displayName: 'Pepe', recipientUserName: 'luis', recipientDisplayName: 'Luis', fromSubBomb: true, subBombCount: 5 })), null);
    assert.equal(alertas.alEvento(ev('Twitch.GiftSub', { userName: 'pepe', displayName: 'Pepe', recipientUserName: 'eva', recipientDisplayName: 'Eva' })), null);
    assert.equal(alertas.alEvento(ev('Twitch.Cheer', { userName: 'sombra', displayName: 'Sombra', bits: 500 }))!.texto, 'manda 500 bits');
    assert.equal(alertas.alEvento(ev('Twitch.Raid', { from_broadcaster_user_login: 'otro', from_broadcaster_user_name: 'Otro', viewers: 12 }))!.texto, 'llega de raid con 12 personas');
    assert.equal(alertas.estado().mes.subs, 3, 'el resub y los dos regalos');
  });

  test('una alerta apagada no sale, pero el último sub se sigue guardando', () => {
    alertas.cambiarAjustes({ alertas: { sub: false } });
    assert.equal(alertas.alEvento(ev('Twitch.Sub', { userName: 'ana', displayName: 'Ana' })), null);
    assert.equal(alertas.estado().ultimoSub?.quien, 'Ana');
  });

  test('«Probar» se ve en el overlay pero no cuenta ni cambia el último follow', () => {
    alertas.probar('raid');
    assert.equal(alertas.paraAlertas().alertas.length, 1);
    assert.equal(alertas.estado().ultimoFollow, null);
    assert.equal(alertas.estado().mes.follows, 0);
    assert.equal(alertas.estado().recientes.length, 0, 'el panel no la lista como real');
  });

  test('las alertas llevan un número que solo sube, para que el overlay sepa cuáles no ha visto', () => {
    const a = alertas.probar('bits');
    const b = alertas.probar('raid');
    assert.ok(b.n > a.n);
  });
});

describe('meta y ajustes', () => {
  test('la meta suma lo que ya llevabas y lo que cuenta el bot', () => {
    alertas.cambiarAjustes({ meta: { tipo: 'follows', objetivo: 50, base: 40, titulo: 'Hacia los 50' } });
    alertas.alEvento(ev('Twitch.Follow', { user_id: '1', user_login: 'a', user_name: 'A' }));
    assert.deepEqual(alertas.meta(), { titulo: 'Hacia los 50', actual: 41, objetivo: 50, tipo: 'follows' });
    alertas.cambiarAjustes({ meta: { tipo: 'ninguna' } });
    assert.equal(alertas.meta(), null);
  });

  test('los ajustes se limpian y sobreviven a un reinicio', () => {
    alertas.cambiarAjustes({ volumen: 9, segundos: 1, rotativo: ['meta', 'inventado', 'top', 'meta'], meta: { objetivo: -3 } });
    alertas.reset();
    const a = alertas.ajustes();
    assert.equal(a.volumen, 1);
    assert.equal(a.segundos, 5);
    assert.deepEqual(a.rotativo, ['meta', 'top']);
    assert.equal(a.meta.objetivo, 1);
  });
});
