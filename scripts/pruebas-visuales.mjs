// Pruebas reales de navegador, siempre con SQLite en memoria y puertos efímeros.
// Ejecutar: node --import tsx scripts/pruebas-visuales.mjs [10|11|14|avatar]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
process.env.NODE_TEST_CONTEXT = 'visuales';
const { configureDatabase } = await import('../src/data/db.ts');
configureDatabase(':memory:');
const { setMotor } = await import('../src/services/ia-imagen.ts');
const prohibido = async () => { throw new Error('IA de pago bloqueada en pruebas'); };
setMotor({generar:prohibido, editar:prohibido, localizarCara:prohibido, comprobarVariante:prohibido});
const { crearServidor } = await import('../src/panel/server.ts');
const dirReferencias = await mkdtemp(join(tmpdir(), 'crid4m-referencias-visuales-'));
const server = crearServidor({estado:()=>({conectado:false,destino:'Prueba aislada',intentosFallidos:0}),acciones:async()=>[],ejecutarAccion:async()=>{throw Error('Streamer.bot bloqueado');}},async()=>{throw Error('OBS bloqueado');},dirReferencias);
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const raiz=`http://127.0.0.1:${server.address().port}`;
const perfil=await mkdtemp(join(tmpdir(),'crid4m-navegador-'));
const destino=resolve('../StreamerBotApi-fase2-capturas');await mkdir(destino,{recursive:true});
const edge=spawn(process.env.EDGE_BIN || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${perfil}`,'--no-first-run','--mute-audio','about:blank'],{windowsHide:true,stdio:'ignore'});
const esperar=ms=>new Promise(r=>setTimeout(r,ms));
let socket, siguiente=0;const pendientes=new Map();
function pedir(method,params={}) { return new Promise((ok,ko)=>{const id=++siguiente;const t=setTimeout(()=>{pendientes.delete(id);ko(Error(`CDP agotado: ${method}`));},15000);pendientes.set(id,{ok,ko,t});socket.send(JSON.stringify({id,method,params}));}); }
async function evaluar(expression) { const r=await pedir('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value; }
async function abrir(ruta,w=1366,h=768) {await pedir('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});await pedir('Page.navigate',{url:raiz+ruta});await esperar(1800);}
async function captura(nombre){const r=await pedir('Page.captureScreenshot',{format:'png'});await writeFile(join(destino,`${nombre}.png`),Buffer.from(r.data,'base64'));}
try {
  let puerto;
  for(let i=0;i<100;i++){try{puerto=Number((await readFile(join(perfil,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await esperar(100);}}
  assert.ok(puerto,'Edge debe abrir su puerto de prueba');
  const paginas=await(await fetch(`http://127.0.0.1:${puerto}/json`)).json();
  socket=new WebSocket(paginas.find(x=>x.type==='page').webSocketDebuggerUrl);await new Promise(r=>socket.onopen=r);
  socket.onmessage=async e=>{const m=JSON.parse(e.data);if(m.id){const p=pendientes.get(m.id);if(p){clearTimeout(p.t);pendientes.delete(m.id);m.error?p.ko(Error(JSON.stringify(m.error))):p.ok(m.result);}}else if(m.method==='Fetch.requestPaused'){const {requestId,request}=m.params;await pedir(request.url.startsWith(raiz+'/')||request.url.startsWith('data:')?'Fetch.continueRequest':'Fetch.failRequest',{requestId,...(!request.url.startsWith(raiz+'/')&&!request.url.startsWith('data:')?{errorReason:'BlockedByClient'}:{})}).catch(e=>{if(!e.message.includes('Invalid InterceptionId'))console.error('Interceptación:',e.message);});}};
  await pedir('Page.enable');await pedir('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  const caso=process.argv[2]||'10';
  if(caso==='referencias') {
    const { codificar } = await import('../src/services/png.ts');
    const px = new Uint8Array(320*180*4);
    for(let y=0;y<180;y++)for(let x=0;x<320;x++){const i=(y*320+x)*4;px[i]=30+x/3;px[i+1]=60+y/2;px[i+2]=160;px[i+3]=255;}
    const archivo=join(dirReferencias,'referencia-prueba.png');await writeFile(archivo,codificar(320,180,px));
    for(const w of [390,1366]) {
      await abrir(`/?refs=${w}#/biblioteca`,w,w===390?844:1000);await evaluar("irA('biblioteca')");await esperar(500);
      await evaluar("document.querySelector('#ref-juego').value='Lineage 2';document.querySelector('#ref-nombre').value='Referencia de prueba local'");
      const doc=await pedir('DOM.getDocument');const nodo=await pedir('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#ref-archivo'});
      await pedir('DOM.setFileInputFiles',{nodeId:nodo.nodeId,files:[archivo]});
      await evaluar("document.querySelector('#ref-subir').requestSubmit()");
      for(let i=0;i<40;i++){if((await evaluar("document.querySelector('#ref-estado').textContent")).includes('guardada'))break;await esperar(100);}
      assert.match(await evaluar("document.querySelector('#ref-estado').textContent"),/guardada/);
      assert.ok(await evaluar('document.documentElement.scrollWidth<=innerWidth'));
      await captura(`referencias-biblioteca-${w}-despues`);
      await evaluar("irA('escenas')");await esperar(600);
      await evaluar("(()=>{const el=document.querySelector('[data-referencias=inicio]');el.parentElement.open=true;el.open=true;const s=el.querySelector('select');s.selectedIndex=1;s.dispatchEvent(new Event('change'));const uso=el.querySelectorAll('select')[1];uso.value='lugar';uso.dispatchEvent(new Event('change'));el.scrollIntoView({block:'center'});})()");await esperar(400);
      assert.equal(await evaluar("seleccionReferencias('inicio')[0].uso"),'lugar');
      assert.deepEqual(await evaluar("seleccionReferencias('avatar')"),[]);
      assert.ok(await evaluar("document.querySelector('[data-referencias=inicio] img').naturalWidth>0"));
      assert.ok(await evaluar('document.documentElement.scrollWidth<=innerWidth'));
      await captura(`referencias-escenas-${w}-despues`);
      await evaluar("(()=>{const el=document.querySelector('[data-referencias=avatar]');for(let p=el;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;const s=el.querySelector('select');s.selectedIndex=1;s.dispatchEvent(new Event('change'));el.scrollIntoView({block:'center'});})()");await esperar(300);await captura(`referencias-avatar-${w}-despues`);
      // Captura el cuerpo de la generación sin autorizar ni llamar a un proveedor.
      await evaluar("window.apiOriginal=api;window.peticionReferencia=null;api=async(r,b)=>{if(r==='/api/escenas/avatar-ia'){window.peticionReferencia=b;throw Error('Generación bloqueada en prueba visual');}return window.apiOriginal(r,b);};document.querySelector('#e-avatar-generar').disabled=false;document.querySelector('#e-avatar-generar').click()");await esperar(100);
      assert.equal(await evaluar('window.peticionReferencia.referencias.length'),1);
      await evaluar("api=async(r,b)=>{if(r==='/api/escenas/fondo'){window.peticionReferencia=b;throw Error('Generación bloqueada en prueba visual');}return window.apiOriginal(r,b);};const botonFondo=[...document.querySelectorAll('[data-tipo=inicio] button')].find(b=>b.textContent.includes('Generar fondo'));botonFondo.disabled=false;botonFondo.click()");await esperar(100);
      assert.equal(await evaluar('window.peticionReferencia.referencias[0].uso'),'lugar');
      await evaluar('api=window.apiOriginal');
    }
  }
  if(caso==='referencias-antes')for(const w of [390,1366]) {
    await abrir(`/?refs=${w}#/biblioteca`,w,w===390?844:1000);await evaluar("irA('biblioteca')");await esperar(500);await captura(`referencias-biblioteca-${w}-antes`);
    await evaluar("irA('escenas')");await esperar(600);await captura(`referencias-escenas-${w}-antes`);
  }
  if(caso.startsWith('biblioteca')) {
    const antes=caso.endsWith('antes');
    for(const w of [390,1366]) {
      await abrir(`/?biblioteca=${w}#/biblioteca`,w,w===390?844:1000);await evaluar("irA('biblioteca')");await esperar(700);
      await evaluar("document.querySelector('#b-overlays').scrollIntoView({block:'start'})");await esperar(2500);await captura(`biblioteca-${w}-${antes?'antes':'despues'}`);
      if(!antes) {
        assert.ok(await evaluar('document.documentElement.scrollWidth<=innerWidth'));
        assert.equal(await evaluar("VARIANTES_OVERLAY['escena.html'].length"),4);
        assert.ok(await evaluar("VARIANTES_OVERLAY['escena.html'].every(v=>!v.q.includes('demo'))"));
      }
    }
    await abrir('/biblioteca/overlays/escena.html?tipo=inicio&demo=1',1920,1080);await esperar(700);await captura(`escena-fondo-${antes?'antes':'despues'}`);
    if(!antes) {
      assert.equal(await evaluar("document.querySelector('#paisaje')"),null);
      await evaluar("pintarFoto('imagenes/fondos/alegre-inicio-2026-09-27T13-58-37.png')");await esperar(900);
      assert.equal(await evaluar("document.body.classList.contains('con-foto')"),true);
      await evaluar("pintarFoto('imagenes/fondos/no-existe.png')");await esperar(300);
      assert.equal(await evaluar("document.body.classList.contains('con-foto')"),false);
    }
  }
  if(caso==='efectos')for(const w of [390,1366]) {
    await abrir(`/?efectos=${w}#/efectos`,w,w===390?844:1000);await evaluar("irA('efectos')");await esperar(600);
    assert.equal(await evaluar("document.querySelectorAll('[data-prueba-efecto]').length"),5);
    assert.equal(await evaluar("document.querySelector('#preparacion-efectos').open"),false);
    assert.ok(await evaluar('document.documentElement.scrollWidth<=innerWidth'));
    await captura(`efectos-pruebas-${w}-despues`);
    await evaluar("window.Audio=class{play(){return Promise.resolve()}pause(){}};datosEfectos.efectos.find(e=>e.id==='grito').material.find(m=>m.archivo).archivo.duracionSeg=.01;document.querySelector('[data-prueba-efecto=grito]').click()");
    await esperar(600);
    assert.match(await evaluar("document.querySelector('#fx-prueba-estado').textContent"),/Prueba terminada/);
    assert.equal(await evaluar('pruebaEfectoActiva'),false);
    await evaluar("document.querySelector('#l-plegable-pruebas').open=true;irA('loot');document.querySelector('#l-plegable-pruebas').scrollIntoView({block:'center'})");await esperar(300);await captura(`loot-pruebas-${w}-despues`);
  }
  if(caso==='efectos-antes')for(const w of [390,1366]) {
    await abrir(`/?efectos=${w}#/efectos`,w,w===390?844:1000);await evaluar("irA('efectos')");await esperar(600);await captura(`efectos-pruebas-${w}-antes`);
  }
  if(caso.startsWith('overlays'))for(const w of [390,1366]) {
    await abrir(`/?overlays=${w}#/overlays`,w,w===390?844:1000);await evaluar("irA('overlays')");await esperar(600);
    await captura(`overlays-streamlabs-${w}-${caso==='overlays-antes'?'antes':'despues'}`);
    if(caso!=='overlays-antes') {
      assert.equal(await evaluar("document.querySelector('#o-tipos').children.length"),2);
      assert.ok(await evaluar("[...document.querySelectorAll('#o-tipos label')].every(x=>!(/Follow|Sub/i.test(x.textContent)))"));
      assert.ok(await evaluar('document.documentElement.scrollWidth<=innerWidth'));
      assert.equal(await evaluar("document.querySelector('#o-rotativo').children.length"),4);
      if(caso==='overlays') {
        const estadoAntes=await evaluar("api('/api/overlays')");
        await evaluar("window.peticionesPrueba=[];window.apiOriginal=api;api=async(r,b)=>{if(b)window.peticionesPrueba.push({r,b});return window.apiOriginal(r,b)};document.querySelector('[data-prueba-alerta=bits]').click()");
        await esperar(900);
        assert.match(await evaluar("document.querySelector('#o-vista-alertas iframe').src"),/tipo=bits/);
        assert.deepEqual(await evaluar('window.peticionesPrueba'),[],'la prueba local no escribe en ninguna API');
        assert.deepEqual(await evaluar("api('/api/overlays')"),estadoAntes);
        await captura(`overlays-local-${w}-despues`);
        await evaluar("document.querySelector('[data-tarjeta=follow] button').click()");await esperar(400);
        assert.deepEqual(await evaluar("api('/api/overlays').then(d=>d.ajustes.rotativo)"),['follow','top','sub','meta']);
        await evaluar("document.querySelector('[data-tarjeta=sub] input').click()");await esperar(300);
        await evaluar("document.querySelector('[data-tarjeta=sub] input').click()");await esperar(300);
        assert.deepEqual(await evaluar("api('/api/overlays').then(d=>d.ajustes.rotativo)"),['follow','top','meta','sub']);
        await evaluar('cargarOverlays()');
        assert.equal(await evaluar("document.querySelector('#o-rotativo').firstChild.dataset.tarjeta"),'follow');
        assert.match(await evaluar("document.querySelector('.ovl-panel-vista iframe').src"),/orden=follow,top,meta,sub/);
        await evaluar("document.querySelector('#o-rotativo').scrollIntoView({block:'center'})");await captura(`overlays-orden-${w}-despues`);
        assert.ok(await evaluar('document.documentElement.scrollWidth<=innerWidth'));
        await evaluar("guardarOverlays({accion:'ajustes',ajustes:{rotativo:['top','follow','sub','meta']}});api=window.apiOriginal");await esperar(300);
      }
    }
  }
  if(caso==='escenas')for(const w of [390,1366]) {
    await abrir(`/?prueba=${w}#/escenas`,w,w===390?844:900);await evaluar("irA('escenas')");await esperar(700);await evaluar('window.scrollTo(0,0)');await esperar(300);
    const antes = await evaluar("api('/api/escenas').then(r=>r.config)");
    for(const tipo of ['inicio','charla','pausa','final']) {
      await evaluar(`document.querySelector('#e-selector [data-tipo=${tipo}]').click()`);await esperar(200);
      const r=await evaluar(`(()=>{const a=document.querySelector('#e-lista > article:not([hidden])'),v=a.querySelector('.overlay-vista'),f=v.querySelector('iframe');return {tipo:a.dataset.tipo,cantidad:document.querySelectorAll('#e-lista > article:not([hidden])').length,scroll:document.documentElement.scrollWidth,ancho:v.clientWidth,marco:f.getBoundingClientRect().width,cuenta:document.querySelector('#e-control-cuenta').hidden,textos:[...document.querySelectorAll('#e-textos label:not([hidden]) input')].map(x=>x.dataset.clave)};})()`);
      assert.equal(r.tipo,tipo);assert.equal(r.cantidad,1);assert.ok(r.scroll<=w,JSON.stringify(r));assert.ok(Math.abs(r.ancho-r.marco)<2,JSON.stringify(r));
      assert.equal(r.cuenta,!['inicio','pausa'].includes(tipo));assert.deepEqual(r.textos,{inicio:['titulo','subtitulo'],charla:['charla'],pausa:['pausa'],final:['final']}[tipo]);
      await captura(`escenas-fase3-${w}-${tipo}-despues`);
    }
    assert.deepEqual(await evaluar("api('/api/escenas').then(r=>r.config)"),antes,'cambiar vista no modifica el directo');
    await evaluar("(()=>{document.querySelector('#e-selector [data-tipo=inicio]').click();const d=document.querySelector('#e-lista > article:not([hidden]) textarea');d.value='Castillo de Aden de Lineage 2';d.closest('details').open=true;document.querySelector('#e-selector [data-tipo=pausa]').click();document.querySelector('#e-selector [data-tipo=inicio]').click()})()");
    assert.equal(await evaluar("document.querySelector('#e-lista > article:not([hidden]) textarea').value"),'Castillo de Aden de Lineage 2');
    await evaluar("document.querySelector('#e-lista > article:not([hidden]) textarea').scrollIntoView({block:'center'})");await captura(`escenas-fase3-${w}-peticion-despues`);
    await evaluar("document.querySelector('#e-control-avatar').scrollIntoView({block:'center'})");await captura(`escenas-fase3-${w}-avatar-despues`);
  }
  if(caso==='escenas-antes')for(const w of [390,1366]) {
    await abrir(`/?prueba=${w}#/escenas`,w,w===390?844:900);await evaluar("irA('escenas')");await esperar(800);await captura(`escenas-fase3-${w}-antes`);
  }
  if(caso==='avatar') {
    for(const [nombre,ruta,puntos,altura] of [
      ['chico','imagenes/avatar/oscuro-2026-09-27T09-12-36',[[413,334],[466,342],[555,342],[614,330]],.22],
      ['magmarex','imagenes/avatar/oscuro-2026-09-27T17-18-25',[[376,383],[435,428],[589,428],[650,378]],.18],
    ]) {
      await abrir('/#/escenas',1440,1080);await evaluar("irA('escenas')");await esperar(900);
      await evaluar(`document.querySelector('#e-avatar-personaje').value=${JSON.stringify(ruta)};document.querySelector('#e-avatar-local').click()`);await esperar(800);
      assert.equal(await evaluar("document.querySelector('#avatar-local').open"),true);
      await captura(`avatar-${nombre}-antes`);
      for (const [x,y] of puntos) {
        const rect = await evaluar("(()=>{const r=document.querySelector('#al-lienzo').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()");
        const pos={x:rect.x+x/1024*rect.w,y:rect.y+y/1024*rect.h};
        await pedir('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...pos});await pedir('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...pos});
      }
      await evaluar(`document.querySelector('#al-altura').value=${altura};document.querySelector('#al-altura').dispatchEvent(new Event('input'));document.querySelector('#al-calcular').click()`);
      for(let i=0;i<60;i++){if(!await evaluar("document.querySelector('[data-paso=medio]').disabled"))break;await esperar(250);}
      assert.equal(await evaluar("document.querySelector('[data-paso=medio]').disabled"),false,await evaluar("document.querySelector('#al-estado').textContent"));
      assert.equal(await evaluar("document.querySelector('#al-guardar').disabled"),true);
      for(const paso of ['base','medio','cerrados']) {
        await evaluar(`document.querySelector('[data-paso=${paso}]').click()`);await esperar(400);
        const congelada = await evaluar("document.querySelector('#al-lienzo').toDataURL()");await esperar(200);
        assert.equal(await evaluar("document.querySelector('#al-lienzo').toDataURL()"),congelada);
        await captura(`avatar-${nombre}-${paso}-despues`);
      }
      await evaluar("document.querySelector('#al-revisado').click();document.querySelector('#al-guardar').click()");await esperar(400);
      assert.match(await evaluar("document.querySelector('#al-estado').textContent"),/guardada y activada/);
      const guardada=await evaluar(`api('/api/escenas/avatar-local?personaje=${encodeURIComponent(ruta)}')`);
      assert.equal(guardada.calibracion.puntos.length,4);
      await writeFile(join(destino,`avatar-${nombre}-calibracion-revisada.json`),JSON.stringify(guardada,null,2));
      await evaluar("document.querySelector('#al-altura').dispatchEvent(new Event('input'))");
      assert.equal(await evaluar("document.querySelector('#al-guardar').disabled"),true);
      assert.equal(await evaluar("document.querySelector('#al-revisado').checked"),false);
      // Solo la base de datos en memoria: comprueba integración del overlay sin activar el bot real.
      await evaluar(`api('/api/escenas', {avatar:true,avatarImagen:${JSON.stringify(ruta)}})`);
      await abrir('/biblioteca/overlays/avatar.html',700,900);await esperar(1000);
      assert.ok(await evaluar("document.querySelector('#r-cerrados').src.includes('/api/overlay/avatar-local')"));
      await captura(`avatar-${nombre}-overlay-despues`);
    }
    await abrir('/#/escenas',390,844);await evaluar("irA('escenas')");await esperar(700);
    await evaluar("document.querySelector('#e-avatar-local').click()");await esperar(500);
    assert.ok(await evaluar("document.querySelector('#avatar-local').scrollWidth<=document.querySelector('#avatar-local').clientWidth"));
    await captura('avatar-herramienta-390-despues');
  }
  if(caso==='10')for(const w of [390,768,1366]){
    await abrir('/#/overlays',w,w===390?844:768);await evaluar("irA('overlays')");await esperar(800);
    const medidas=await evaluar(`(()=>{const v=document.querySelector('.ovl-panel-vista'),f=v.querySelector('iframe');return {ancho:innerWidth,scroll:document.documentElement.scrollWidth,visor:v.clientWidth,marco:f.getBoundingClientRect().width};})()`);
    assert.ok(medidas.scroll<=w,JSON.stringify(medidas));assert.ok(Math.abs(medidas.visor-medidas.marco)<2,JSON.stringify(medidas));
    await evaluar("document.querySelector('.ovl-panel-vista').scrollIntoView({block:'center'})");await captura(`10-overlays-${w}-despues`);
    console.log('Correcto: vista proporcional sin desbordamiento',w);
  }
  if(caso==='14')for(const w of [390,1366]) {
    await abrir('/#/directo',w,w===390?844:768);
    await evaluar("irA('directo');document.querySelector('#tab-directo').focus()");
    await pedir('Input.dispatchKeyEvent',{type:'keyDown',key:w===390?'ArrowRight':'ArrowDown'});
    await esperar(800);
    assert.equal(await evaluar('document.activeElement.id'),'tab-loot');
    assert.equal(await evaluar("document.querySelector('#v-loot').hidden"),false);
    assert.equal(await evaluar("document.querySelectorAll('.pestanas button[tabindex=\"0\"]').length"),1);
    assert.equal(await evaluar("document.querySelector('#v-loot').getAttribute('aria-labelledby')"),'tab-loot');
    await evaluar("document.querySelector('#l-regalo-ayuda').scrollIntoView({block:'center'})");
    await captura(`14-teclado-${w}-despues`);
    await pedir('Input.dispatchKeyEvent',{type:'keyDown',key:'End'});
    assert.equal(await evaluar('document.activeElement.id'),'tab-registro');
    await pedir('Input.dispatchKeyEvent',{type:'keyDown',key:'Home'});
    assert.equal(await evaluar('document.activeElement.id'),'tab-directo');
  }
  if(caso.startsWith('11'))for(const [nombre,ruta] of [['escena','escena.html?tipo=inicio&demo=1'],['avatar','avatar.html?demo=1'],['jefe','jefe.html?demo=1&jefe=liche&volumen=0']]){
    await abrir('/biblioteca/overlays/'+ruta,1920,1080);await esperar(3500);await captura(`11-${nombre}-${caso==='11-antes'?'antes':'despues'}`);
    if(caso!=='11-antes')assert.equal(await evaluar(`[...document.querySelectorAll('*')].filter(e=>getComputedStyle(e).filter.includes('blur(')||getComputedStyle(e).backdropFilter!=='none'||(getComputedStyle(e).mixBlendMode!=='normal'&&!e.classList.contains('brillo-ojos'))).length`),0);
  }
  console.log('Pruebas visuales terminadas:',caso,destino);
} finally {
  if(socket?.readyState===1){await pedir('Browser.close').catch(()=>{});socket.close();}
  for(const p of pendientes.values())clearTimeout(p.t);
  edge.kill();await rm(dirReferencias,{recursive:true,force:true});server.closeAllConnections();await new Promise(r=>server.close(r));
}
