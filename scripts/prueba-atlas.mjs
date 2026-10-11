// Prueba del atlas (biblioteca/overlays/mmo-atlas.html) con el motor real del MMO:
// SQLite en memoria, servidor del panel en un puerto efímero y Edge sin interfaz.
// Sin Twitch, Streamer.bot, OBS ni IA de pago; toda petición fuera del servidor local se bloquea.
// Ejecutar: node --import tsx scripts/prueba-atlas.mjs [vivo|demo]   (capturas en $ATLAS_CAPTURAS o en el temporal)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
process.env.NODE_TEST_CONTEXT = 'visuales';
const REPO = fileURLToPath(new URL('..', import.meta.url));
const src = (p) => pathToFileURL(join(REPO, 'src', p)).href;
const { configureDatabase } = await import(src('data/db.ts'));
configureDatabase(':memory:');
const { setMotor } = await import(src('services/ia-imagen.ts'));
const prohibido = async () => { throw new Error('IA de pago bloqueada en pruebas'); };
setMotor({ generar: prohibido, editar: prohibido, localizarCara: prohibido, comprobarVariante: prohibido });
const { crearServidor } = await import(src('panel/server.ts'));
const mmo = await import(src('interactions/mmo/index.ts'));
const streams = await import(src('data/streams.ts'));

const dirReferencias = await mkdtemp(join(tmpdir(), 'atlas-ref-'));
let sbConectado = true;
const server = crearServidor({ estado: () => ({ conectado: sbConectado, destino: 'Prueba aislada', intentosFallidos: 0 }), acciones: async () => [],
  ejecutarAccion: async () => { throw Error('Streamer.bot bloqueado'); } }, async () => { throw Error('OBS bloqueado'); }, dirReferencias);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const raiz = `http://127.0.0.1:${server.address().port}`;
const destino = process.env.ATLAS_CAPTURAS || join(tmpdir(), 'atlas-capturas');
await mkdir(destino, { recursive: true });
const perfil = await mkdtemp(join(tmpdir(), 'atlas-edge-'));
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--remote-debugging-port=0',
  `--user-data-dir=${perfil}`, '--no-first-run', '--mute-audio', '--hide-scrollbars', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let socket, siguiente = 0;
const pendientes = new Map();
const errores = [];
const peticiones = [], bloqueadas = [];
const pedir = (method, params = {}) => new Promise((ok, ko) => { const id = ++siguiente; const t = setTimeout(() => { pendientes.delete(id); ko(Error(`CDP agotado: ${method}`)); }, 15000); pendientes.set(id, { ok, ko, t }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluar(expression) { const r = await pedir('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; }
async function abrir(ruta) { await pedir('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }); await pedir('Page.navigate', { url: raiz + ruta }); await esperar(1500); }
/** Termina las animaciones de una vez (el reloj de Edge sin ventana no siempre avanza) y captura. */
async function captura(nombre) {
  await evaluar("document.getAnimations().forEach(a=>{const t=a.effect?.getComputedTiming();if(t&&t.iterations!==Infinity)a.finish()})");
  await esperar(200);
  const r = await pedir('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(destino, `${nombre}.png`), Buffer.from(r.data, 'base64'));
}
const hasta = async (expr, ms = 10000) => { for (let i = 0; i < ms / 100; i++) { if (await evaluar(expr)) return; await esperar(100); } throw Error(`No llegó: ${expr}`); };
const texto = (sel) => evaluar(`document.querySelector(${JSON.stringify(sel)}).textContent`);
const estadoEs = (t) => hasta(`document.querySelector('#estado').textContent===${JSON.stringify(t)}`);
const visor = (id, nombre) => ({ id, login: id, displayName: nombre, isBroadcaster: false, isModerator: false, isVip: false, isSubscriber: false, rawRole: null });
let pasos = 0;
let cortarApi = false;
/** El elemento cabe entero dentro del lateral y de su bloque. */
const dentro = (sel, caja) => evaluar(`(()=>{document.getAnimations().forEach(a=>{const t=a.effect?.getComputedTiming();if(t&&t.iterations!==Infinity)a.finish()});const c=document.querySelector(${JSON.stringify(caja)}).getBoundingClientRect();return [...document.querySelectorAll(${JSON.stringify(sel)})].every(e=>{const r=e.getBoundingClientRect();return r.right<=c.right+.5&&r.bottom<=c.bottom+.5})})()`);
const ok = (m) => { pasos++; console.log('  ✓', m); };

try {
  let puerto;
  for (let i = 0; i < 100; i++) { try { puerto = Number((await readFile(join(perfil, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await esperar(100); } }
  const paginas = await (await fetch(`http://127.0.0.1:${puerto}/json`)).json();
  socket = new WebSocket(paginas.find((x) => x.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => { socket.onopen = r; });
  socket.onmessage = async (e) => {
    const m = JSON.parse(e.data);
    if (m.id) { const p = pendientes.get(m.id); if (p) { clearTimeout(p.t); pendientes.delete(m.id); m.error ? p.ko(Error(JSON.stringify(m.error))) : p.ok(m.result); } return; }
    if (m.method === 'Runtime.exceptionThrown') errores.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errores.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    if (m.method === 'Network.requestWillBeSent') peticiones.push(`${m.params.request.method} ${m.params.request.url.replace(raiz, '')}`);
    if (m.method === 'Fetch.requestPaused') {
      const { requestId, request } = m.params;
      const local = (request.url.startsWith(raiz + '/') && !(cortarApi && request.url.includes('/api/'))) || request.url.startsWith('data:');
      if (!local && !request.url.startsWith(raiz)) bloqueadas.push(request.url);
      await pedir(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId, ...(!local && { errorReason: 'BlockedByClient' }) }).catch(() => {});
    }
  };
  await pedir('Page.enable'); await pedir('Runtime.enable'); await pedir('Network.enable');
  await pedir('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  const caso = process.argv[2] || 'vivo';

  if (caso === 'vivo') {
    console.log('Atlas con el motor real:');
    // 0. El bot no contesta desde el principio: nada inventado.
    cortarApi = true;
    await abrir('/biblioteca/overlays/mmo-atlas.html');
    await estadoEs('Reconectando');
    assert.equal(await texto('#donde'), 'Esperando al bot');
    assert.equal(await evaluar("getComputedStyle(document.querySelector('.relicario')).display"), 'none');
    assert.equal(await evaluar("getComputedStyle(document.querySelector('#bloque-objetivo')).display"), 'none');
    assert.match(await texto('#paso-cuerpo'), /Sin conexión con el bot/);
    assert.equal(await evaluar("document.querySelector('.region.destino')"), null);
    assert.doesNotMatch(await evaluar('document.body.innerText'), /Fronda Ámbar\n*Tierra|Próxima salida|0 de 3/);
    assert.equal(await evaluar("[...document.querySelectorAll('.estado-region')].map(e=>e.textContent).join('|')"), '|||Refugio de la compañía');
    ok('sin ninguna respuesta: «Esperando al bot», sin próxima salida, cuentas ni relicario inventados');
    await captura('vivo-sin-datos');
    cortarApi = false;
    // 1. El mundo arranca apagado.
    await estadoEs('Cerrado');
    assert.equal(await evaluar("document.body.classList.contains('sin-datos')"), false);
    ok('primera lectura tras el corte: pasa a «Cerrado» sin recargar');
    assert.equal(await evaluar("document.querySelector('#bloque-objetivo').hidden"), true);
    assert.equal(await evaluar("document.querySelector('#bloque-compania').hidden"), true);
    assert.equal(await evaluar("document.querySelector('#demo').hidden"), true, 'sin ?demo no hay botones');
    ok('apagado: «Cerrado», sin objetivo ni compañía, sin panel de demo');
    await captura('vivo-cerrado');

    // 2. Calma sin nadie: todo velado, próxima salida la Fronda.
    let t = Date.now() - 60_000;
    streams.openAt(new Date(t - 60_000).toISOString());
    mmo.setChatConectado(() => sbConectado);
    mmo.setAzar(() => 0.99);
    mmo.activar(t);
    await estadoEs('En calma');
    assert.equal(await texto('#cartografia'), '0 de 3 tierras cartografiadas tras el Velo');
    assert.equal(await texto('#objetivo'), 'Fronda Ámbar');
    assert.equal(await evaluar("document.querySelector('#r-bosque').classList.contains('destino')"), true);
    assert.equal(await evaluar("['bosque','cantera','marisma'].every(id=>document.querySelector('#r-'+id).classList.contains('velada'))"), true);
    assert.equal(await evaluar("document.querySelectorAll('.marca-reliquia.lit').length"), 0);
    assert.equal(await evaluar("document.querySelectorAll('.marca-reliquia').length"), 60);
    assert.match(await texto('#compania'), /Nadie ha salido aún/);
    assert.match(await texto('#cronica-sello'), /Prólogo/);
    ok('calma vacía: 0 de 3, todo velado, próxima salida Fronda Ámbar, 0/60 reliquias, prólogo');
    await captura('vivo-calma-vacia');

    // 3. Expedición con una persona, luego un nombre con HTML.
    const ana = visor('a1', 'Ana');
    const raro = visor('z9', '<img src=x onerror="document.title=1">Zed');
    assert.equal(mmo.explorar(ana, 'm1', t).tipo, 'ok');
    await estadoEs('Expedición');
    assert.equal(await texto('#donde'), 'Fronda Ámbar');
    assert.equal(await texto('#marca-cifra'), '1');
    assert.equal(await texto('#marca-rotulo'), '1 en la salida');
    assert.equal(await evaluar("document.querySelectorAll('#r-bosque .glifo').length"), 4);
    assert.equal(await evaluar("document.querySelectorAll('#r-bosque .glifo.lit').length"), 1);
    assert.match(await evaluar("document.querySelector('#ruta-bosque').getAttribute('class')"), /activa/);
    ok('expedición de una persona: Fronda, estandarte con 1, 1 de 4 glifos encendido, ruta activa');
    assert.equal(mmo.explorar(raro, 'm2', t + 1000).tipo, 'ok');
    await hasta("document.querySelector('#actual').textContent==='2'&&document.querySelector('#meta').textContent==='6'");
    assert.equal(await evaluar("document.querySelectorAll('#lateral img, #mapa image[href=\"x\"]').length"), 0, 'sin HTML inyectado');
    assert.match(await texto('#compania'), /<img src=x/);
    assert.equal(await evaluar('document.title'), 'Atlas del Velo');
    assert.equal(await evaluar("document.querySelectorAll('#r-bosque .glifo').length"), 6, 'la meta sube con la segunda persona');
    assert.ok(Number(await evaluar('document.documentElement.dataset.glifos')) >= 1);
    assert.ok(await dentro('#compania li, #compania li em', '#lateral'), 'los aportes caben en el lateral');
    ok('segunda persona: meta 6, el nombre con <img> sale como texto, se recorta y no se ejecuta');
    await captura('vivo-expedicion');

    // 4. Encrucijada real y voto.
    mmo.setAzar(() => 0.01);
    t += mmo.ACCION_MS;
    assert.equal(mmo.explorar(ana, 'm3', t).tipo, 'ok');
    await estadoEs('Encrucijada');
    assert.equal(await evaluar("document.querySelectorAll('#c-cruce .rama').length"), 2);
    assert.equal(mmo.explorar(raro, 'v1', t + 2000, 2).tipo, 'ok');
    await hasta("[...document.querySelectorAll('#c-cruce .votos-rama')].map(e=>e.textContent).join('|')==='0 votos|1 voto'");
    assert.match(await texto('#paso-cuerpo'), /!explorar 1.*!explorar 2/s);
    assert.match(await texto('#paso-cuerpo'), /La votación cierra en \d+:\d\d/);
    assert.ok(await dentro('#bitacora li', '#bloque-bitacora'), 'la bitácora no se corta');
    ok('encrucijada: dos ramas, voto real reflejado (0 / 1), comandos y reloj; la bitácora cabe entera');
    await captura('vivo-encrucijada');
    t += 3 * 60_000 + 5000;
    mmo.avanzar(t);
    await hasta("document.querySelector('#c-cruce .rama.elegida')!==null");
    assert.equal(await estadoEs('Expedición'), undefined);
    assert.equal(await texto('#meta'), '8', 'el camino arriesgado suma 2');
    assert.match(await texto('#objetivo-nota'), /Camino arriesgado/);
    ok('decisión: rama 2 elegida, meta 6 → 8, nota de camino arriesgado');

    // 5. Victoria.
    mmo.setAzar(() => 0.99);
    for (let i = 0; mmo.estado().fase === 'expedicion' && i < 20; i++) {
      t += mmo.ACCION_MS;
      mmo.explorar(ana, `a${i}`, t);
      if (mmo.estado().fase === 'expedicion') mmo.explorar(raro, `z${i}`, t + 1000);
    }
    assert.equal(mmo.estado().fase, 'resultado');
    await estadoEs('Completada');
    assert.equal(await evaluar("document.querySelector('#cartel').hidden"), false);
    assert.equal(await evaluar("document.body.classList.contains('con-cartel')"), true);
    assert.equal(await evaluar('document.documentElement.dataset.victorias'), '1');
    assert.equal(await evaluar('document.documentElement.dataset.culminaciones'), '1');
    assert.equal(await texto('#cartografia'), '1 de 3 tierras cartografiadas tras el Velo');
    assert.equal(await evaluar("document.querySelectorAll('.marca-reliquia.lit').length"), 1);
    assert.match(await texto('#cartel-chips'), /Camino arriesgado/);
    assert.match(await texto('#compania'), /\+\d+ renombre/);
    assert.equal(await texto('#marca-rotulo'), '');
    assert.ok(await dentro('#compania li em', '#lateral'), 'el renombre cabe en el lateral');
    assert.match(await evaluar("[...document.querySelectorAll('#compania li em')].map(e=>e.textContent).join('|')"), /^\+\d+ renombre\|\+\d+ renombre$/);
    ok('victoria: cartel con camino arriesgado, renombre, 1 de 3, 1/60 reliquias, una sola culminación');
    await captura('vivo-victoria');

    // 6. Descanso → calma con memoria.
    t += mmo.DESCANSO_MS + 1000;
    mmo.avanzar(t);
    await estadoEs('En calma');
    assert.equal(await evaluar("document.querySelector('#r-bosque').classList.contains('descubierta')"), true);
    assert.equal(await texto('#objetivo'), 'Canteras del Eco');
    assert.equal(await evaluar("document.querySelector('#cartel').hidden"), true);
    assert.equal(await evaluar('document.documentElement.dataset.victorias'), '1', 'no vuelve a estallar');
    assert.notEqual(await evaluar("document.querySelector('#piezas').textContent"), 'La colección espera su primer hallazgo.');
    ok('calma con memoria: Fronda cartografiada, próxima Canteras, relicario con la pieza, sin repetir cartel');
    await captura('vivo-calma');

    // 7. Pausa, sin directo, sin chat, sin bot.
    t += 1000;
    mmo.explorar(ana, 'c1', t);
    await estadoEs('Expedición');
    assert.equal(await texto('#donde'), 'Canteras del Eco');
    mmo.pausar(t + 1000);
    await estadoEs('En pausa');
    assert.equal(await texto('#reloj'), 'El tiempo está detenido');
    assert.match(await texto('#paso-cuerpo'), /pausa/);
    ok('pausa: reloj detenido y aviso en el paso del chat');
    await captura('vivo-pausa');
    mmo.activar(t + 2000);
    await estadoEs('Expedición');
    streams.close(); mmo.avanzar();
    await estadoEs('Tiempo detenido');
    assert.match(await texto('#paso-cuerpo'), /espera al directo/);
    assert.equal(await texto('#reloj'), 'El tiempo está detenido');
    ok('sin directo: «Tiempo detenido» y «El Velo espera al directo»');
    streams.open(); mmo.avanzar();
    await estadoEs('Expedición');
    sbConectado = false; mmo.avanzar();
    await hasta("document.querySelector('#paso-cuerpo').textContent.includes('Reconectando con el chat')");
    assert.equal(await texto('#estado'), 'Tiempo detenido');
    ok('sin chat: «Reconectando con el chat», reloj parado');
    sbConectado = true; mmo.avanzar();
    await estadoEs('Expedición');

    // 8. El bot deja de contestar.
    await evaluar("window.fetchReal=window.fetch;window.fetch=async()=>{throw Error('corte simulado')}");
    await estadoEs('Reconectando');
    assert.match(await texto('#paso-cuerpo'), /Sin conexión con el bot/);
    assert.equal(await texto('#donde'), 'Canteras del Eco', 'conserva el último estado');
    assert.equal(await texto('#reloj'), 'Sin reloj hasta que vuelva el bot');
    ok('desconexión: aviso visible, conserva Canteras del Eco, sin reloj');
    await captura('vivo-desconexion');
    await evaluar('window.fetch=window.fetchReal');
    await estadoEs('Expedición');
    assert.doesNotMatch(await texto('#paso-cuerpo'), /Sin conexión/);
    ok('reconexión: vuelve a «Expedición» y quita el aviso');

    // 9. El Velo se cierra sin completar.
    mmo.avanzar(Math.max(t, Date.now()) + mmo.DURACION_MS + 60_000);
    await estadoEs('Fin de salida');
    assert.match(await texto('#cartel-texto'), /Nadie pierde nada/);
    assert.equal(await evaluar('document.documentElement.dataset.cierres'), '1');
    assert.equal(await evaluar('document.documentElement.dataset.victorias'), '1');
    assert.equal(await evaluar("document.querySelector('#r-cantera').classList.contains('descubierta')"), false);
    ok('cierre sin completar: cartel sin destello de victoria, Canteras sigue sin cartografiar');
    await captura('vivo-cierre');

    // 10. Apagar.
    mmo.apagar();
    await estadoEs('Cerrado');
    await hasta("getComputedStyle(document.querySelector('#marca')).opacity==='0'", 3000);
    ok('apagado de nuevo: «Cerrado» y sin estandarte');

    const escrituras = peticiones.filter((p) => !p.startsWith('GET '));
    assert.deepEqual(escrituras, [], 'el atlas no escribe');
    assert.ok(peticiones.filter((p) => p.includes('/api/')).every((p) => p === 'GET /api/mmo/estado'), 'solo lee /api/mmo/estado');
    ok(`peticiones: ${peticiones.filter((p) => p.includes('/api/')).length} lecturas de /api/mmo/estado y ninguna escritura`);
  }

  if (caso === 'demo') {
    console.log('Demo del atlas, recorriendo todos los botones:');
    await abrir('/biblioteca/overlays/mmo-atlas.html?demo=1');
    const pulsar = async (b) => { await evaluar(`document.querySelector('button[data-demo="${b}"]').click()`); await esperar(120); return texto('#estado'); };
    const esperado = [
      ['calma', 'En calma'], ['expedicion', 'Expedición'], ['aporte', 'Expedición'], ['aporte', 'Completada'],
      ['encrucijada', 'Encrucijada'], ['voto1', 'Encrucijada'], ['voto1', 'Encrucijada'], ['decidir', 'Expedición'],
      ['victoria', 'Completada'], ['grupo', 'Expedición'], ['aporte', 'Expedición'], ['pausa', 'En pausa'], ['pausa', 'Expedición'],
      ['sin-directo', 'Tiempo detenido'], ['sin-chat', 'Tiempo detenido'], ['desconexion', 'Reconectando'], ['cerrado', 'Cerrado'],
      ['region', 'En calma'], ['expedicion', 'Expedición'], ['region', 'Expedición'], ['region', 'Expedición'], ['cierre', 'Fin de salida'], ['calma', 'En calma'],
    ];
    for (const [b, e] of esperado) assert.equal(await pulsar(b), e, `botón ${b}`);
    ok(`${esperado.length} pulsaciones con el estado esperado`);
    assert.equal(await evaluar("document.querySelector('#c-cruce').childElementCount"), 0);
    assert.equal(peticiones.filter((p) => p.includes('/api/')).length, 0, 'la demo no consulta el bot');
    ok('la demo no hace ninguna petición a /api');
    // Casos límite pintados con la misma función que usa el bot (pintar es global en el script de la página).
    await pulsar('calma');
    assert.equal(await evaluar("(()=>{const d=structuredClone(ultimo);d.cronica={capitulo:15,total:15,titulo:'Fin',texto:'x',siguienteEn:null};pintar(d);return document.querySelector('#cronica-sello').textContent+' / '+document.querySelector('#cronica-siguiente').textContent})()"),
      'Crónica · Capítulo XV de XV / La crónica está completa: todos los capítulos están escritos.');
    ok('crónica completa: «Capítulo XV de XV» y «La crónica está completa»');
    assert.equal(await evaluar("(()=>{const d=structuredClone(ultimo);d.fase='expedicion';d.region={id:'cumbre',nombre:'Cumbre Rota',objetivo:'Subir'};d.hasta=null;pintar(d);return document.querySelector('#donde').textContent+'|'+document.querySelectorAll('.region.actual').length})()"), 'Cumbre Rota|0');
    ok('región desconocida: el lateral la nombra y el mapa no inventa dónde está');
    // Peor caso real: la encrucijada más larga de contenido.ts, siete personas y nombres de 25 caracteres (máximo de Twitch).
    const saturar = (gente) => evaluar(`(()=>{const d=structuredClone(ultimo);d.encrucijada={pregunta:'A la izquierda se abre un sendero de brasas; a la derecha sigue el camino conocido.',opciones:[{texto:'Seguir el camino conocido',votos:3},{texto:'Tomar el sendero de brasas',votos:4}],hasta:new Date(Date.now()+60000).toISOString(),decision:null};d.participantes=Array.from({length:${gente}},(_,i)=>({nombre:'NombreDeTwitchMuyLargo_'+i,aporte:3-i%3}));d.acciones=Array.from({length:12},(_,i)=>({quien:'NombreDeTwitchMuyLargo_'+i,texto:'arranca un cristal violeta de la pared',at:new Date(Date.now()-i*1000).toISOString()}));pintar(d)})()`);
    await pulsar('grupo');
    for (const gente of [2, 7]) {
      await saturar(gente);
      assert.ok(await dentro('#bitacora li', '#bloque-bitacora'), 'la bitácora no se corta');
      assert.ok(await dentro('#compania li, #compania li em, .opcion b, #paso', '#lateral'), 'nada sale del lateral');
      ok(`peor encrucijada real con ${gente} personas: ${await evaluar("document.querySelectorAll('#compania li').length")} filas de compañía, ${await evaluar("document.querySelector('#bloque-bitacora').hidden?0:document.querySelectorAll('#bitacora li').length")} de bitácora, nada sale del panel`);
      await captura(`demo-lateral-${gente}`);
    }
    // Con la encrucijada normal de la demo, la bitácora conserva entradas enteras.
    await pulsar('encrucijada');
    await evaluar('document.fonts.ready');
    assert.ok(await dentro('#bitacora li', '#bloque-bitacora'));
    assert.ok(await evaluar("document.querySelectorAll('#bitacora li').length") >= 2, 'quedan entradas en una encrucijada normal');
    assert.equal(await evaluar("(()=>{const a=document.querySelector('#demo summary').getBoundingClientRect();return [...document.querySelectorAll('#c-cruce *, .region text, #marca')].filter(e=>{const b=e.getBoundingClientRect();return b.width&&a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom}).length})()"), 0, 'el panel de demo no tapa el mapa');
    ok('el botón de la demo no tapa ramas, votos ni rótulos');
    ok(`encrucijada de la demo: ${await evaluar("document.querySelectorAll('#bitacora li').length")} entradas enteras en la bitácora`);
    await pedir('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await pulsar('victoria');
    assert.equal(await evaluar("getComputedStyle(document.querySelector('#cartel')).animationName"), 'none');
    assert.equal(await evaluar("getComputedStyle(document.querySelector('#marca')).transitionDuration"), '0s');
    assert.equal(await evaluar("getComputedStyle(document.querySelector('#ambiente')).display"), 'none');
    ok('movimiento reducido: sin animaciones de resultado, transiciones ni partículas');
    await pedir('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  }

  assert.deepEqual(errores, [], 'errores en la página');
  ok('sin errores de JavaScript en la página');
  if (bloqueadas.length) console.log('  Peticiones externas bloqueadas:', bloqueadas);
  console.log(`Prueba ${caso}: ${pasos} comprobaciones superadas. Capturas en ${destino}`);
} finally {
  if (socket?.readyState === 1) { await pedir('Browser.close').catch(() => {}); socket.close(); }
  for (const p of pendientes.values()) clearTimeout(p.t);
  edge.kill(); await rm(dirReferencias, { recursive: true, force: true }); await rm(perfil, { recursive: true, force: true }).catch(() => {});
  server.closeAllConnections(); await new Promise((r) => server.close(r));
}
