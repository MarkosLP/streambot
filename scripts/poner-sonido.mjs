// Pone un sonido de verdad (mp3, ogg, wav…) en biblioteca/sonidos/<nombre>.wav: sin silencio
// al principio, con el volumen de la poción, un tope de duración con fundido, 44,1 kHz y 16 bits.
// Decodifica Edge sin ventana: no hace falta ffmpeg. De dónde sale cada sonido: docs/SONIDOS.md.
//
//   node scripts/poner-sonido.mjs <nombre> <archivo> [segundos máximos]
//   node scripts/poner-sonido.mjs grito-de-guerra descargas/war-horn.mp3 6
//
// El nombre es el del .wav (grito-de-guerra, maldicion, terremoto, lag, cofre, legendario, pocion):
// las Actions de Streamer.bot y los overlays lo buscan así. Si era sintetizado, añádelo a
// GRABADOS en src/cli/generar-sonidos.ts, o `npm run sonidos` lo pisaría.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SONIDOS = fileURLToPath(new URL('../biblioteca/sonidos/', import.meta.url));
const [nombre, origen, maxTexto] = process.argv.slice(2);
if (!nombre || !origen || !/^[a-z0-9-]+$/.test(nombre)) {
  console.error('Uso: node scripts/poner-sonido.mjs <nombre> <archivo> [segundos máximos]');
  process.exit(1);
}
const MAX = Number(maxTexto) > 0 ? Number(maxTexto) : 6;

const perfil = await mkdtemp(join(tmpdir(), 'crid4m-audio-'));
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${perfil}`, '--no-first-run', '--mute-audio', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let socket, n = 0; const pend = new Map();
const pedir = (method, params = {}) => new Promise((ok, ko) => { const id = ++n; pend.set(id, { ok, ko }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluar(expression) {
  const r = await pedir('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

// Lo que corre dentro de Edge: decodificar, medir, recortar, igualar volumen y escribir el WAV.
const EN_EDGE = `
window.decodificar = async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const ctx = new OfflineAudioContext(2, 1, 44100);
  const buf = await ctx.decodeAudioData(bytes.buffer);
  // Todo a 44,1 kHz y como mucho estéreo.
  const canales = Math.min(2, buf.numberOfChannels);
  const off = new OfflineAudioContext(canales, Math.ceil(buf.duration * 44100), 44100);
  const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
  const r = await off.startRendering();
  return Array.from({ length: canales }, (_, c) => r.getChannelData(c));
};
/** Volumen «de lo que suena»: RMS de los trozos de 50 ms por encima de -40 dB. */
window.volumen = (chs) => {
  const v = 2205; let suma = 0, cuenta = 0;
  for (let i = 0; i + v <= chs[0].length; i += v) {
    let s = 0; for (const ch of chs) for (let j = i; j < i + v; j++) s += ch[j] * ch[j];
    const rms = Math.sqrt(s / (v * chs.length));
    if (rms > 0.01) { suma += rms * rms; cuenta++; }
  }
  return cuenta ? Math.sqrt(suma / cuenta) : 0;
};
window.medir = async (b64) => window.volumen(await window.decodificar(b64));
window.preparar = async (b64, objetivo, max) => {
  let chs = await window.decodificar(b64);
  const len = chs[0].length;
  // Silencio del principio fuera (deja 10 ms).
  let ini = 0; while (ini < len && chs.every((c) => Math.abs(c[ini]) < 0.01)) ini++;
  ini = Math.max(0, ini - 441);
  // Final: tope de duración, y sin la cola en silencio.
  let fin = Math.min(len, ini + Math.round(max * 44100));
  while (fin > ini && chs.every((c) => Math.abs(c[fin - 1]) < 0.003)) fin--;
  chs = chs.map((c) => c.slice(ini, fin));
  const recortado = fin < len && (fin - ini) >= Math.round(max * 44100) - 1;
  // Fundidos: 5 ms al entrar (sin chasquido) y, si se cortó, 600 ms al salir.
  const fe = 220, fs = recortado ? 26460 : 441, L = chs[0].length;
  for (const c of chs) {
    for (let i = 0; i < Math.min(fe, L); i++) c[i] *= i / fe;
    for (let i = 0; i < Math.min(fs, L); i++) c[L - 1 - i] *= i / fs;
  }
  // Mismo volumen que la poción; sin pasar de -1 dB de pico.
  const actual = window.volumen(chs);
  let g = actual ? objetivo / actual : 1;
  let pico = 0; for (const c of chs) for (const x of c) pico = Math.max(pico, Math.abs(x));
  g = Math.min(g, 0.89 / (pico || 1));
  // WAV PCM 16 bits.
  const canales = chs.length, datos = L * canales * 2, b = new DataView(new ArrayBuffer(44 + datos));
  const txt = (o, s) => { for (let i = 0; i < 4; i++) b.setUint8(o + i, s.charCodeAt(i)); };
  txt(0, 'RIFF'); b.setUint32(4, 36 + datos, true); txt(8, 'WAVE'); txt(12, 'fmt '); b.setUint32(16, 16, true);
  b.setUint16(20, 1, true); b.setUint16(22, canales, true); b.setUint32(24, 44100, true); b.setUint32(28, 44100 * canales * 2, true);
  b.setUint16(32, canales * 2, true); b.setUint16(34, 16, true); txt(36, 'data'); b.setUint32(40, datos, true);
  let o = 44;
  for (let i = 0; i < L; i++) for (const c of chs) { const s = Math.max(-1, Math.min(1, c[i] * g)); b.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  let bin = ''; const u = new Uint8Array(b.buffer); for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return { wav: btoa(bin), seg: L / 44100, canales, ganancia: g, recortado };
};
`;

try {
  let puerto; for (let i = 0; i < 100; i++) { try { puerto = Number((await readFile(join(perfil, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await esperar(100); } }
  const pags = await (await fetch(`http://127.0.0.1:${puerto}/json`)).json();
  socket = new WebSocket(pags.find((x) => x.type === 'page').webSocketDebuggerUrl); await new Promise((r) => (socket.onopen = r));
  socket.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.ko(Error(JSON.stringify(m.error))) : p.ok(m.result); } };
  await evaluar(EN_EDGE);
  const pocion = (await readFile(join(SONIDOS, 'pocion.wav'))).toString('base64');
  const objetivo = await evaluar(`window.medir(${JSON.stringify(pocion)})`);
  console.log(`Volumen de referencia (poción): ${(20 * Math.log10(objetivo)).toFixed(1)} dB`);
  const audio = (await readFile(origen)).toString('base64');
  const r = await evaluar(`window.preparar(${JSON.stringify(audio)}, ${objetivo}, ${MAX})`);
  await writeFile(join(SONIDOS, `${nombre}.wav`), Buffer.from(r.wav, 'base64'));
  console.log(`✔ ${nombre}.wav: ${r.seg.toFixed(2)} s, ${r.canales === 2 ? 'estéreo' : 'mono'}, ganancia ${(20 * Math.log10(r.ganancia)).toFixed(1)} dB${r.recortado ? ', recortado con fundido' : ''}`);
} finally {
  if (socket?.readyState === 1) await pedir('Browser.close').catch(() => {});
  edge.kill(); process.exit(0);
}
