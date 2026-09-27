import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conObs, type PedirObs } from './obs.js';
class SocketFalso extends EventTarget {
  cerrado = false; envios = 0;
  constructor(private responder: boolean) { super(); queueMicrotask(()=>this.mensaje({op:0,d:{}})); }
  mensaje(d: unknown) { this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(d)})); }
  send(texto: string) { const m=JSON.parse(texto); if(m.op===1)queueMicrotask(()=>this.mensaje({op:2,d:{}})); else { this.envios++; if(this.responder)queueMicrotask(()=>this.mensaje({op:7,d:{requestId:m.d.requestId,requestStatus:{result:true},responseData:{bien:true}}})); } }
  close() { this.cerrado=true; }
}
test('OBS: una respuesta ausente cancela pendientes y llamadas tardías; el siguiente trabajo funciona', async () => {
  const socket=new SocketFalso(false); let pedirTarde: PedirObs | undefined;
  await assert.rejects(conObs(async pedir=>{ pedirTarde=pedir; await Promise.all([pedir('Uno'),pedir('Dos')]); },{tiempoMaxMs:15,crearSocket:()=>socket as unknown as WebSocket}),/no respondió/);
  assert.equal(socket.cerrado,true);
  await assert.rejects(pedirTarde!('Tarde'),/no respondió/); assert.equal(socket.envios,2);
  const otro=new SocketFalso(true);
  assert.deepEqual(await conObs(p=>p('Bien'),{tiempoMaxMs:50,crearSocket:()=>otro as unknown as WebSocket}),{bien:true});
  assert.equal(otro.cerrado,true);
});
