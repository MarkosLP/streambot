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

test('OBS: un error síncrono durante close no vuelve a cerrar ni desborda la pila', async () => {
  class SocketConError extends EventTarget {
    cierres = 0;
    close() {
      this.cierres++;
      // Undici puede emitir error dentro de close durante una conexión fallida.
      // El límite permite que la regresión falle sin desbordar el propio test.
      if (this.cierres < 4) this.dispatchEvent(new Event('error'));
    }
  }
  const socket = new SocketConError();
  let trabajoEjecutado = false;
  const resultado = conObs(async () => { trabajoEjecutado = true; }, {
    tiempoMaxMs: 100,
    crearSocket: () => { queueMicrotask(() => socket.dispatchEvent(new Event('error'))); return socket as unknown as WebSocket; },
  });
  await assert.rejects(resultado, /No se pudo conectar/);
  assert.equal(socket.cierres, 1);
  assert.equal(trabajoEjecutado, false);
});
test('OBS: una respuesta ausente cancela pendientes y llamadas tardías; el siguiente trabajo funciona', async () => {
  const socket=new SocketFalso(false); let pedirTarde: PedirObs | undefined;
  await assert.rejects(conObs(async pedir=>{ pedirTarde=pedir; await Promise.all([pedir('Uno'),pedir('Dos')]); },{tiempoMaxMs:15,crearSocket:()=>socket as unknown as WebSocket}),/no respondió/);
  assert.equal(socket.cerrado,true);
  await assert.rejects(pedirTarde!('Tarde'),/no respondió/); assert.equal(socket.envios,2);
  const otro=new SocketFalso(true);
  assert.deepEqual(await conObs(p=>p('Bien'),{tiempoMaxMs:50,crearSocket:()=>otro as unknown as WebSocket}),{bien:true});
  assert.equal(otro.cerrado,true);
});
