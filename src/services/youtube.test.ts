import { test } from 'node:test';
import assert from 'node:assert/strict';
import { youtubeCall, decodeEntities } from './youtube.js';

test('Idealflow: títulos legibles sin interpretar el contenido como HTML', () => {
  assert.equal(decodeEntities('Epic &amp; Electronic &quot;Mix&quot; &#39;Live&#39;'), 'Epic & Electronic "Mix" \'Live\'');
  assert.equal(decodeEntities('&lt;script&gt;texto&lt;/script&gt;'), '<script>texto</script>');
});
test('Idealflow: distingue cuota agotada, clave inválida y API sin activar', async () => {
  for (const [reason, status, expected] of [
    ['quotaExceeded', 403, /Cuota diaria/],
    ['dailyLimitExceeded', 403, /Cuota diaria/],
    ['keyInvalid', 400, /clave.*no es válida/],
    ['accessNotConfigured', 403, /activada/],
  ] as const) {
    const pedir: typeof fetch = async () => new Response(JSON.stringify({ error: { message: 'No mostrar clave-secreta', errors: [{ reason }] } }), { status });
    await assert.rejects(youtubeCall('clave-secreta', 'search', { q: 'épica' }, pedir), (e: Error) => {
      assert.match(e.message, expected); assert.doesNotMatch(e.message, /clave-secreta/); return true;
    });
  }
});
test('las excepciones de red y las respuestas ilegibles no filtran URLs con claves', async () => {
  await assert.rejects(youtubeCall('secreto', 'search', {}, async () => { throw Error('https://example/?key=secreto'); }), (e: Error) => {
    assert.match(e.message, /No se pudo conectar/); assert.doesNotMatch(e.message, /secreto/); return true;
  });
  await assert.rejects(youtubeCall('secreto', 'search', {}, async () => new Response('no-json')), /ilegible/);
});
