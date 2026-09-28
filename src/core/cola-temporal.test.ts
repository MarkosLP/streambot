import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ColaTemporal } from './cola-temporal.js';
test('cola: acota ráfagas, caduca lo antiguo y continúa tras un fallo sin solapar', async () => {
  let ahora=0, liberar!:()=>void;const vistos:number[]=[];
  const cola=new ColaTemporal<number>(async n=>{vistos.push(n);if(n===1)await new Promise<void>(r=>liberar=r);if(n===3)throw Error('prueba');},()=>{},2,100,()=>ahora);
  cola.encolar(1);await Promise.resolve();cola.encolar(2);cola.encolar(3);assert.equal(cola.encolar(4),false);assert.equal(cola.pendientes,2);
  ahora=101;liberar();await new Promise(r=>setImmediate(r));assert.deepEqual(vistos,[1]);assert.equal(cola.descartados,3);
  cola.encolar(3);cola.encolar(4);await new Promise(r=>setImmediate(r));assert.deepEqual(vistos,[1,3,4]);
});
