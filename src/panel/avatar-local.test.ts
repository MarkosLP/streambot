import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureDatabase, closeDatabase, getDb } from '../data/db.js';
import { codificar, decodificar } from '../services/png.js';
import { pintar, validar, guardar, leer, configuracion, vista, variante, desactivar } from './avatar-local.js';

configureDatabase(':memory:');
const dir = mkdtempSync(join(tmpdir(), 'avatar-local-'));
after(() => { closeDatabase(); rmSync(dir, { recursive: true }); });
const ruta = 'imagenes/avatar/prueba';mkdirSync(join(dir, ruta), { recursive: true });
const c = { puntos: [{x:.3,y:.3},{x:.4,y:.3},{x:.6,y:.3},{x:.7,y:.3}], altura:.3 };
const px = new Uint8Array(200 * 200 * 4);
for(let y=0;y<200;y++)for(let x=0;x<200;x++){const i=(y*200+x)*4;px[i]=x;px[i+1]=y;px[i+2]=120;px[i+3]=(x+y)%2 ? 254 : 255;}
const png = codificar(200,200,px);writeFileSync(join(dir,ruta,'base.png'),png);
test('parpadeo local: cambia solo las almendras y conserva alfa en todos los píxeles', () => {
  for(const paso of [.5,1] as const) {
    const r=decodificar(pintar(png,c,paso)).rgba;let cambios=0;
    for(let y=0;y<200;y++)for(let x=0;x<200;x++){
      const i=(y*200+x)*4;assert.equal(r[i+3],px[i+3]);
      const dentro=c.puntos.filter((_,k)=>k%2===0).some(p=>{const u=x-p.x*200;return u>0&&u<20&&Math.abs(y-60)<6*Math.sin(Math.PI*u/20);});
      if(!dentro)assert.deepEqual(r.slice(i,i+4),px.slice(i,i+4));
      if(r[i+1]!==px[i+1])cambios++;
    }
    assert.ok(cambios>20);
  }
});
test('parpadeo local: rechaza ojos desordenados, fuera de límites o sin cuatro esquinas', () => {
  for(const mala of [null,{}, {...c,altura:NaN},{...c,puntos:c.puntos.slice(1)},{...c,puntos:[c.puntos[1],c.puntos[0],...c.puntos.slice(2)]},{...c,puntos:[{x:2,y:.3},...c.puntos.slice(1)]}]) assert.throws(()=>validar(mala));
  assert.throws(()=>vista('../fuera',c,dir));
});
test('parpadeo local: revisión explícita, persistencia, cambio de base y fallo seguro', () => {
  const v=vista(ruta,c,dir);
  assert.throws(()=>guardar(ruta,c,v.hash,false,dir));assert.throws(()=>guardar(ruta,c,'obsoleto',true,dir));
  guardar(ruta,c,v.hash,true,dir);assert.deepEqual(leer(ruta,dir),{...c,hash:v.hash});
  assert.notDeepEqual(variante(ruta,'cerrados',dir),png);
  const nueva=codificar(201,200,new Uint8Array(201*200*4));writeFileSync(join(dir,ruta,'base.png'),nueva);
  assert.equal(leer(ruta,dir),null);assert.deepEqual(configuracion(ruta,dir),{invalida:true});assert.deepEqual(variante(ruta,'cerrados',dir),nueva);
  getDb().prepare('UPDATE avatar_local SET valor=? WHERE ruta=?').run('{roto',ruta);
  assert.equal(leer(ruta,dir),null);assert.deepEqual(variante(ruta,'medio',dir),nueva);
  desactivar(ruta);assert.equal(leer(ruta,dir),null);
});
