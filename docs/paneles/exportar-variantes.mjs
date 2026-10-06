// Renderiza los paneles con texto exacto y los deja listos para subir a Twitch.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const edgeBin = process.env.EDGE_BIN || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const perfil = await mkdtemp(join(tmpdir(), 'crid4m-paneles-'));
const destino = resolve('biblioteca/imagenes/twitch/paneles');
const origen = pathToFileURL(resolve('docs/paneles/variantes-epicas.html')).href;
const alturas = { comandos: 1070, recompensas: 840, loot: 1000, jefes: 920, mundo: 840 };
const arte = resolve('docs/paneles/arte');
const edge = spawn(edgeBin, ['--headless=new', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${perfil}`, '--no-first-run', '--mute-audio', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const esperar = ms => new Promise(r => setTimeout(r, ms));
let socket;
let siguiente = 0;
const pendientes = new Map();
function pedir(method, params = {}) {
  return new Promise((ok, ko) => {
    const id = ++siguiente;
    const timer = setTimeout(() => { pendientes.delete(id); ko(Error(`CDP agotado: ${method}`)); }, 15000);
    pendientes.set(id, { ok, ko, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluar(expression) {
  const r = await pedir('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.text);
  return r.result.value;
}
try {
  let puerto;
  for (let i = 0; i < 100; i++) {
    try { puerto = Number((await readFile(join(perfil, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; }
    catch { await esperar(100); }
  }
  if (!puerto) throw Error('Edge no abrió el puerto de depuración');
  const paginas = await (await fetch(`http://127.0.0.1:${puerto}/json`)).json();
  socket = new WebSocket(paginas.find(p => p.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => { socket.onopen = r; });
  socket.onmessage = event => {
    const m = JSON.parse(event.data);
    if (!m.id) return;
    const p = pendientes.get(m.id);
    if (!p) return;
    clearTimeout(p.timer); pendientes.delete(m.id);
    m.error ? p.ko(Error(JSON.stringify(m.error))) : p.ok(m.result);
  };
  await pedir('Page.enable');
  await mkdir(destino, { recursive: true });
  for (const tema of ['cielo', 'velo']) {
    for (const panel of Object.keys(alturas)) {
      const altura = alturas[panel];
      const trozos = ['superior', 'centro', 'inferior'].map(nombre => join(perfil, `${tema}-${panel}-${nombre}.png`));
      const fuente = join(arte, `${tema}-marco.jpg`);
      execFileSync('magick', [fuente, '-crop', '640x270+0+0', '+repage', trozos[0]]);
      execFileSync('magick', [fuente, '-crop', '640x660+0+270', '+repage', '-resize', `640x${altura - 410}!`, trozos[1]]);
      execFileSync('magick', [fuente, '-crop', '640x140+0+930', '+repage', trozos[2]]);
      execFileSync('magick', [...trozos, '-append', '-strip', '-quality', '94', join(arte, `${tema}-marco-${panel}.jpg`)]);
      await pedir('Emulation.setDeviceMetricsOverride', { width: 640, height: 1800, deviceScaleFactor: 1, mobile: false });
      await pedir('Page.navigate', { url: `${origen}?tema=${tema}&panel=${panel}` });
      for (let i = 0; i < 50; i++) {
        if (await evaluar('document.readyState === "complete" && !!document.querySelector(".panel")')) break;
        await esperar(100);
      }
      await evaluar('Promise.all([...document.images].map(img => img.decode().catch(() => {})))');
      const validacion = await evaluar('({imagenes: [...document.images].every(img => img.naturalWidth > 0), desborde: [...document.querySelectorAll(".panel *")].some(e => e.getBoundingClientRect().right > 640 || e.getBoundingClientRect().left < 0)})');
      if (!validacion.imagenes || validacion.desborde) throw Error(`${tema}/${panel}: falta una imagen o hay contenido fuera del marco`);
      const medidas = await evaluar('(() => { const p = document.querySelector(".panel"); const e = [...document.querySelectorAll(".contenido *")].map(x => x.getBoundingClientRect()); return {alto:p.offsetHeight, fondo:p.getBoundingClientRect().bottom, ultimo:Math.max(...e.map(x => x.bottom)), izquierda:Math.min(...e.map(x => x.left)), derecha:Math.max(...e.map(x => x.right))}; })()');
      if (medidas.alto !== altura || medidas.ultimo > medidas.fondo - 105 || medidas.izquierda < 40 || medidas.derecha > 600)
        throw Error(`${tema}/${panel}: el contenido no cabe en ${altura}px (${JSON.stringify(medidas)})`);
      const captura = await pedir('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 640, height: altura, scale: 1 } });
      const carpeta = join(destino, tema);
      await mkdir(carpeta, { recursive: true });
      const temporal = join(perfil, `${tema}-${panel}.png`);
      const jpg = join(carpeta, `${panel}.jpg`);
      await writeFile(temporal, Buffer.from(captura.data, 'base64'));
      execFileSync('magick', [temporal, '-strip', '-sampling-factor', '4:4:4', '-quality', '90', jpg]);
      const bytes = (await stat(jpg)).size;
      if (bytes > 1_000_000) throw Error(`${jpg}: ${bytes} bytes; Twitch admite hasta 1 MB`);
      console.log(`${tema}/${panel}.jpg · 640x${altura} · ${Math.round(bytes / 1024)} KB`);
    }
  }
} finally {
  socket?.close();
  edge.kill();
  await esperar(300);
  await rm(perfil, { recursive: true, force: true });
}
