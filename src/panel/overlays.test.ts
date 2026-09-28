import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// DOM mínimo: las pruebas comprueban transiciones y conservación de nodos.
export function entorno() {
  let ahora = 0, id = 0;
  const relojes = new Map<number, { fn: () => void; hasta: number }>();
  const nodo = () => {
    const clases = new Set<string>();
    const n: any = { hidden: true, dataset: {}, children: [], style: { setProperty() {} }, textContent: '', innerHTML: '',
      classList: { add: (...xs: string[]) => xs.forEach(x => clases.add(x)), remove: (...xs: string[]) => xs.forEach(x => clases.delete(x)), contains: (x: string) => clases.has(x), toggle: (x: string, v: boolean) => v ? clases.add(x) : clases.delete(x) },
      append(...xs: any[]) { for (const x of xs) { if (typeof x === 'object') x.padre = n; n.children.push(x); } },
      replaceChildren(...xs: any[]) { for (const x of [...n.children]) x.remove?.(); n.children = []; n.append(...xs); },
      remove() { if (n.padre) n.padre.children = n.padre.children.filter((x: any) => x !== n); },
      getBoundingClientRect: () => ({ width: 100 }), setAttribute(k: string, v: any) { if(k === 'data-n') n.dataset.n = v; },
    };
    Object.defineProperty(n, 'firstChild', { get: () => n.children[0] });
    return n;
  };
  const nodos = new Map<string, any>();
  const $ = (id: string) => { if (!nodos.has(id)) nodos.set(id, nodo()); return nodos.get(id); };
  const ctx: any = { $, document: { body: nodo(), getElementById: $, createElement: nodo },
    setTimeout: (fn: () => void, ms: number) => { relojes.set(++id, { fn, hasta: ahora + ms }); return id; },
    clearTimeout: (n: number) => relojes.delete(n), clearInterval() {}, setInterval() {},
    Date: { now: () => ahora }, console, URL, URLSearchParams, location: { href: 'http://prueba/', search: '?volumen=0' },
    Image: class {}, Audio: class { play() { return Promise.resolve(); } }, fetch: () => new Promise(() => {}), DirectoRed: { overlay() {}, alReiniciar() {} },
  };
  return { ctx, $, nodo, avanzar(ms: number) { const fin = ahora + ms; for (;;) { const siguiente = [...relojes].filter(([,r]) => r.hasta <= fin).sort((a,b)=>a[1].hasta-b[1].hasta)[0]; if(!siguiente) break; ahora=siguiente[1].hasta; relojes.delete(siguiente[0]); siguiente[1].fn(); } ahora = fin; } };
}
const html = readFileSync(new URL('../../biblioteca/overlays/jefe.html', import.meta.url), 'utf8');
const codigo = html.split('<script>')[1]!.split('</script>')[0]!;
test('jefe: una retirada pendiente no oculta ni vacía el ambiente del siguiente', () => {
  const e = entorno(); runInNewContext(codigo, e.ctx);
  const jefe = (id: number) => ({ id, tipo: 'dragon', nombre: 'Prueba', vida: 100, vidaMax: 100, quedanSeg: 80, golpes: [], afectados: [] });
  e.ctx.pintar({ jefe: jefe(1) }); e.ctx.pintar({ jefe: null });
  e.avanzar(500); e.ctx.pintar({ jefe: jefe(2) }); e.avanzar(1300);
  assert.equal(e.$('jefe').hidden, false); assert.equal(e.$('jefe').classList.contains('sale'), false);
  assert.ok(e.$('ambiente').children.length > 0);
  e.ctx.quitarCartel(); e.ctx.especial({ n: 2, icono: '', titulo: 'Nuevo', texto: '' }); e.avanzar(500);
  assert.equal(e.$('cartel-especial').hidden, false);
});

test('chat: conserva los nueve nodos, respeta su edad y retira los moderados', () => {
  const e = entorno();
  e.ctx.h = (_: string, attrs: any, ...hijos: any[]) => { const n = e.nodo(); for(const [k,v] of Object.entries(attrs)) n.setAttribute(k,v); n.append(...hijos.flat().filter(Boolean)); return n; };
  e.ctx.colorDe = () => '#ffffff';
  const fuente = readFileSync(new URL('../../biblioteca/overlays/escena.html', import.meta.url), 'utf8');
  runInNewContext(fuente.slice(fuente.indexOf('const pintados ='), fuente.indexOf('// ======================= Aviso de botín')), e.ctx);
  const chat = Array.from({length:30}, (_,n)=>({n, nombre:'Ana',texto:'Mensaje',at:0}));
  e.ctx.pintarChat(chat); const antes = [...e.$('mensajes').children];
  e.avanzar(70_000); e.ctx.pintarChat(chat);
  assert.deepEqual(e.$('mensajes').children, antes);
  e.avanzar(5_000); assert.ok(antes.every(n=>n.classList.contains('viejo')));
  e.ctx.pintarChat([]); assert.equal(e.$('mensajes').children.length, 0);
  e.ctx.pintarChat(chat); assert.ok(e.$('mensajes').children.every((n:any)=>n.classList.contains('viejo')));
});

test('avatar: un 404 conserva el retrato y permite reintentar la misma ruta', async () => {
  const e=entorno(); let falla=true, cambios=0;
  for(const id of ['r-base','r-medio','r-cerrados','r-contento']) { const n=e.$(id);n.id=id;n.replaceWith=()=>cambios++; }
  e.ctx.Image=class { onload?:()=>void; onerror?:()=>void; classList=e.nodo().classList; set src(_: string) { queueMicrotask(()=>falla?this.onerror?.():this.onload?.()); } };
  e.ctx.pixeles=()=>null; e.ctx.zonaQueCambia=()=>null; e.ctx.ojosBrillantes=()=>null;
  e.ctx.elipse=()=>'';
  const fuente=readFileSync(new URL('../../biblioteca/overlays/avatar.html',import.meta.url),'utf8');
  runInNewContext(fuente.slice(fuente.indexOf('let retratoPuesto'),fuente.indexOf('// Parpadea solo')),e.ctx);
  await e.ctx.ponerRetrato('imagenes/avatar/prueba'); assert.equal(cambios,0);
  falla=false; await e.ctx.ponerRetrato('imagenes/avatar/prueba'); assert.equal(cambios,4);
  await e.ctx.ponerRetrato('imagenes/avatar/prueba'); assert.equal(cambios,4);
  await e.ctx.ponerRetrato('imagenes/avatar/prueba',null,'nueva'); assert.equal(cambios,8);
});
