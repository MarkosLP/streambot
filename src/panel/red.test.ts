import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const fuente=readFileSync(new URL('./public/red.js',import.meta.url),'utf8');
function preparar(fetch: (...args:any[])=>any) { const ctx:any={fetch,AbortController,DOMException,setTimeout,clearTimeout,console:{warn(){}}}; runInNewContext(fuente,ctx);return ctx.DirectoRed; }
test('consultas: timeout, recuperación y una sola lectura por ruta',async()=>{
  let llamadas=0, responder=false;
  const red=preparar(async (_:any,{signal}:any)=>{ llamadas++; if(responder)return {ok:true,json:async()=>({bien:true})};return new Promise((_,ko)=>signal.addEventListener('abort',()=>ko(new DOMException('Fin','AbortError')))); });
  const a=red.consultar('/estado',{},20), b=red.consultar('/estado',{},20);
  assert.equal(a,b);await assert.rejects(a,{name:'TimeoutError'});assert.equal(llamadas,1);
  responder=true;assert.equal((await red.consultar('/estado')).bien,true);
});
test('consultas: una lectura tardía no puede sobrescribir una acción ni una vista nueva',async()=>{
  let devolver:any;
  const red=preparar(async (_:any,o:any)=>o.method?{ok:true,json:async()=>({nuevo:true})}:new Promise(r=>devolver=r));
  const vieja=red.consultar('/estado');await red.consultar('/accion',{method:'POST'});
  devolver({ok:true,json:async()=>({antiguo:true})});await assert.rejects(vieja,{name:'AbortError'});
  const otra=red.consultar('/estado');red.cancelarLecturas();devolver({ok:true,json:async()=>({antiguo:true})});await assert.rejects(otra,{name:'AbortError'});
});
test('sondeo: no se solapan trabajos lentos y se puede detener',async()=>{
  const red=preparar(()=>{});let activos=0,maximo=0,veces=0;
  const parar=red.sondear(async()=>{activos++;maximo=Math.max(maximo,activos);veces++;await new Promise(r=>setTimeout(r,15));activos--;},2);
  await new Promise(r=>setTimeout(r,60));parar();assert.equal(maximo,1);assert.ok(veces>=2);
});
