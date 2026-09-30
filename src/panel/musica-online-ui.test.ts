import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const codigo = readFileSync(new URL('./public/musica-online.js', import.meta.url), 'utf8');
const datos = () => ({ fuente: 'local', youtube: { configurado: true } });
const asentarse = () => new Promise<void>(resolve => setImmediate(resolve));
function entorno(api: (ruta: string, body?: any) => Promise<any>) {
  const nodos = new Map<string, any>(); let sondeo: () => Promise<void>;
  const $ = (id: string) => {
    if (!nodos.has(id)) nodos.set(id, { textContent: '', value: '', hidden: false, disabled: true, checked: false, childElementCount: 0, eventos: {},
      addEventListener(evento: string, fn: () => void) { this.eventos[evento] = fn; },
      querySelectorAll: () => [], replaceChildren() {}, setAttribute() {}, removeAttribute() {},
    });
    return nodos.get(id);
  };
  runInNewContext(codigo, { $, api, URLSearchParams, document: { hidden: false, querySelectorAll: () => [] }, location: { search: '' }, setInterval: (fn: () => Promise<void>) => { sondeo = fn; } });
  return { $, sondear: () => sondeo() };
}
test('guardar conserva la clave escrita aunque haya un sondeo', async () => {
  let enviado: any;
  const e = entorno(async (_ruta, body) => { if (body) enviado = body; return datos(); });
  await asentarse();
  assert.equal(e.$('mo-config-campos').disabled, false);
  e.$('mo-youtube-key').value = 'clave-de-prueba-no-real';
  await e.sondear();
  await e.$('mo-config-form').onsubmit({ preventDefault() {} });
  assert.equal(enviado.youtubeKey, 'clave-de-prueba-no-real');
  assert.match(e.$('mo-config-estado').textContent, /Configuración guardada/);
  assert.equal(e.$('mo-youtube-key').value, '');
});
test('servidor antiguo: bloquea Guardar y explica que hace falta reiniciar', async () => {
  const e = entorno(async () => { throw Error('no existe'); });
  await asentarse();
  assert.equal(e.$('mo-config-campos').disabled, true);
  assert.match(e.$('mo-config-estado').textContent, /Reinicia el bot/);
  const html = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
  assert.match(html, /<fieldset id="mo-config-campos" disabled>/, 'sin cargar el script tampoco se puede enviar el formulario');
});
test('un guardado rechazado deja las entradas intactas y muestra el error junto al botón', async () => {
  const e = entorno(async (_ruta, body) => { if (body) throw Error('Clave no válida'); return datos(); });
  await asentarse();
  e.$('mo-youtube-key').value = 'clave-local';
  await e.$('mo-config-form').onsubmit({ preventDefault() {} });
  assert.match(e.$('mo-config-estado').textContent, /No se ha guardado: Clave no válida/);
  assert.equal(e.$('mo-youtube-key').value, 'clave-local');
  assert.equal(e.$('mo-config-campos').disabled, false);
});
