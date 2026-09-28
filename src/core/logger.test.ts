import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activarArchivo, archivoDeHoy, desactivarArchivo, log } from './logger.js';
import { describePrivado, normalize } from './events.js';

/** El registro en disco (28 sep 2026): uno por día, 14 días, sin lo que escribe la gente. */

afterEach(() => desactivarArchivo());

const carpeta = () => mkdtempSync(join(tmpdir(), 'crid4m-logs-'));
const mensaje = (text: string) => normalize('Twitch.ChatMessage', {
  messageId: 'm1', user: { id: 'u1', login: 'ana', name: 'Ana', role: 1, badges: [], subscribed: false }, text, meta: {},
}, 'simulator');

test('sin activar, no se escribe nada en disco', () => {
  const dir = carpeta();
  log.info('esto solo va a la consola');
  assert.deepEqual(readdirSync(dir), []);
});

test('activado, cada línea va al archivo del día; los eventos, sin lo que escribe la gente', () => {
  const dir = carpeta();
  activarArchivo({ carpeta: dir });
  log.info('arranca el bot');
  log.evento('<viewer.message> Ana: mi secreto', '<viewer.message> Ana: (mensaje de 10 caracteres)');
  const texto = readFileSync(archivoDeHoy(), 'utf8');
  assert.match(texto, /\[info \] arranca el bot/);
  assert.match(texto, /Ana: \(mensaje de 10 caracteres\)/);
  assert.doesNotMatch(texto, /secreto/);
});

test('borra los días de hace más de 14 y deja los recientes', () => {
  const dir = carpeta();
  for (const d of ['2026-09-01', '2026-09-13', '2026-09-20']) writeFileSync(join(dir, `bot-${d}.log`), 'x');
  writeFileSync(join(dir, 'raw-events.log'), 'x');
  activarArchivo({ carpeta: dir, ahora: new Date('2026-09-28T12:00:00') });
  assert.deepEqual(readdirSync(dir).sort(), ['bot-2026-09-20.log', 'raw-events.log']);
});

test('del chat queda el comando y sus argumentos cortos, no la charla ni lo largo', () => {
  assert.equal(describePrivado(mensaje('hola, qué tal todo')), 'Ana: (mensaje de 18 caracteres)');
  assert.equal(describePrivado(mensaje('!dar ana 2')), 'Ana: !dar ana 2');
  assert.equal(describePrivado(mensaje('!pregunta ¿qué opinas de mi ex y de su nueva pareja?')), 'Ana: !pregunta (42 caracteres más)');
});

test('de un canje queda qué y cuánto, no lo que escribió', () => {
  const canje = normalize('Twitch.RewardRedemption', {
    id: 'r1', user_id: 'u1', user_login: 'ana', user_name: 'Ana', user_input: 'algo muy personal',
    reward: { id: 'x', title: 'Pregunta a Crid4m AI', cost: 500 },
  }, 'simulator');
  assert.equal(describePrivado(canje), 'Ana canjeó "Pregunta a Crid4m AI" (500 pts) -> (17 caracteres)');
});
