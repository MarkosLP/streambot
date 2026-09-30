import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MusicaOnline, enlaceYoutube } from './musica-online.js';

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
function entorno(fetcher: typeof fetch) {
  let datos: any = {};
  const m = new MusicaOnline({ leer: () => structuredClone(datos), guardar: d => { datos = structuredClone(d); } }, fetcher);
  return { m, leer: () => datos, poner: (v: any) => { datos = v; } };
}
test('solo acepta enlaces oficiales de vídeos de YouTube', () => {
  assert.equal(enlaceYoutube('https://youtu.be/abcdefghijk?t=5'), 'abcdefghijk');
  assert.equal(enlaceYoutube('https://www.youtube.com/watch?v=abcdefghijk&list=otra'), 'abcdefghijk');
  for (const url of ['https://youtube.com.evil.test/watch?v=abcdefghijk', 'javascript:alert(1)', 'https://example.com/a', 'https://youtu.be/abcdefghijk/extra']) assert.throws(() => enlaceYoutube(url));
});
test('YouTube: búsqueda incrustable, caché y claves nunca expuestas en estado', async () => {
  let llamadas = 0;
  const e = entorno(async u => {
    llamadas++; const url = new URL(String(u));
    assert.equal(url.searchParams.get('videoEmbeddable'), 'true');
    assert.equal(url.searchParams.get('q'), 'epic music');
    return json({ items: [{ id: { videoId: 'abcdefghijk' }, snippet: { title: 'Épica', channelTitle: 'Canal' } }] });
  });
  await assert.rejects(e.m.buscarYoutube('epic music'), /clave/);
  e.m.configurar({ youtubeKey: 'clave_de_prueba_larga_123456' });
  const r = await e.m.buscarYoutube('epic music');
  assert.equal(r[0].url, 'https://www.youtube.com/watch?v=abcdefghijk');
  await e.m.buscarYoutube('epic music'); assert.equal(llamadas, 1);
  assert.doesNotMatch(JSON.stringify(e.m.estado()), /clave_de_prueba/);
  e.m.configurar({});
  assert.equal(e.m.estado().youtube.configurado, true);
  e.m.configurar({ youtubeKey: '' }); assert.equal(e.m.estado().youtube.configurado, false);
});
