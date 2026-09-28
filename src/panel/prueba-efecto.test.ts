import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probarVisual, type EfectoPrueba } from './prueba-efecto.js';
import type { PedirObs } from '../transport/obs.js';

function entorno(emitiendo = false) {
  const llamadas: Array<[string, any]> = [];
  let conexiones = 0;
  const pedir: PedirObs = async (tipo, d) => {
    llamadas.push([tipo, d]);
    const respuestas: Record<string, unknown> = {
      GetStreamStatus: { outputActive: emitiendo, outputReconnecting: false },
      GetSceneItemList: { sceneItems: [{ sourceName:'Juego',sceneItemId:1,sceneItemEnabled:true },{ sourceName:'FX Pocion',sceneItemId:2,sceneItemEnabled:false }] },
      GetSceneItemTransform: { sceneItemTransform: { positionX:123,positionY:456 } },
      GetSourceFilter: { filterEnabled:false },
    };
    return respuestas[tipo] as any;
  };
  return { llamadas, conectar: async <T>(fn: (p: PedirObs) => Promise<T>) => { conexiones++;return fn(pedir); }, conexiones: () => conexiones };
}
test('pruebas offline: cada efecto restaura su fuente/filtro sin Actions ni Loot', async () => {
  for (const tipo of ['pocion','maldicion','lag','terremoto'] as EfectoPrueba[]) {
    const e=entorno();await probarVisual(e.conectar,tipo,'Escena elegida','Juego',{esperar:async()=>{},azar:()=>.8});
    const ultima=e.llamadas.at(-1)!;
    assert.equal(e.conexiones(),2);
    if(tipo==='pocion')assert.deepEqual(ultima,['SetSceneItemEnabled',{sceneName:'Escena elegida',sceneItemId:2,sceneItemEnabled:false}]);
    else if(tipo==='terremoto')assert.deepEqual(ultima,['SetSceneItemTransform',{sceneName:'Escena elegida',sceneItemId:1,sceneItemTransform:{positionX:123,positionY:456}}]);
    else assert.equal(ultima[1].filterEnabled,false);
    assert.ok(e.llamadas.every(([op])=>!op.includes('ProgramScene')&&!op.includes('Create')));
  }
});
test('pruebas offline: no cambia nada durante emisión ni con destino incompleto', async () => {
  const e=entorno(true);
  await assert.rejects(probarVisual(e.conectar,'lag','Escena','Juego'),/Detén la emisión/);
  assert.deepEqual(e.llamadas.map(x=>x[0]),['GetStreamStatus']);
  const f=entorno();await assert.rejects(probarVisual(f.conectar,'pocion','',''),/Elige la escena/);assert.equal(f.conexiones(),0);
  await probarVisual(f.conectar,'grito','','');assert.equal(f.conexiones(),0);
});
test('pruebas offline: restaura incluso si el trabajo falla y comunica fallo de restauración', async () => {
  const e=entorno();await assert.rejects(probarVisual(e.conectar,'maldicion','Escena','Juego',{esperar:async()=>{throw Error('corte');}}),/corte/);
  assert.equal(e.llamadas.at(-1)![1].filterEnabled,false);
  let n=0;
  await assert.rejects(probarVisual(async fn=>{if(++n===2)throw Error('sin conexión');return e.conectar(fn);},'pocion','Escena','Juego',{esperar:async()=>{}}),/No se pudo restaurar/);
});
