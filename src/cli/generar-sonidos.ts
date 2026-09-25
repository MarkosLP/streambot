/**
 * Genera los sonidos de los efectos en biblioteca/sonidos/.
 *
 *   npm run sonidos
 *
 * Todo es síntesis: no hay muestras de nadie, así que no hay licencias que
 * mirar. Siempre sale lo mismo (el azar lleva semilla), y si un sonido no te
 * gusta se retoca aquí y se vuelve a generar.
 *
 * Si prefieres un sonido de verdad, déjalo en la misma carpeta con el mismo
 * nombre y no vuelvas a ejecutar esto: lo pisaría.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SR = 44100;
const DESTINO = new URL('../../biblioteca/sonidos/', import.meta.url);

type Senal = Float32Array;

// ---------------------------------------------------------------------------
// Utilidades de síntesis
// ---------------------------------------------------------------------------

let semilla = 0x5eed;
function azar(): number {
  semilla = (Math.imul(semilla, 1664525) + 1013904223) >>> 0;
  return semilla / 4294967296;
}

const muestras = (seg: number) => Math.round(seg * SR);
const vacio = (seg: number): Senal => new Float32Array(muestras(seg));

/** Suma `fuente` dentro de `destino` a partir del segundo `en`. */
function mezclar(destino: Senal, fuente: Senal, en: number, ganancia = 1): void {
  const o = muestras(en);
  for (let i = 0; i < fuente.length && o + i < destino.length; i++) destino[o + i] += fuente[i] * ganancia;
}

/** Filtro biquad (RBJ). `fc` puede cambiar con el tiempo. */
function biquad(x: Senal, tipo: 'bajo' | 'alto' | 'banda', fc: number | ((t: number) => number), q = 0.707): Senal {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  for (let i = 0; i < x.length; i++) {
    if (i % 32 === 0) {
      const f = Math.min(SR * 0.45, Math.max(10, typeof fc === 'number' ? fc : fc(i / SR)));
      const w = (2 * Math.PI * f) / SR;
      const cos = Math.cos(w);
      const alfa = Math.sin(w) / (2 * q);
      const a0 = 1 + alfa;
      if (tipo === 'bajo') {
        b0 = (1 - cos) / 2 / a0; b1 = (1 - cos) / a0; b2 = b0;
      } else if (tipo === 'alto') {
        b0 = (1 + cos) / 2 / a0; b1 = -(1 + cos) / a0; b2 = b0;
      } else {
        b0 = alfa / a0; b1 = 0; b2 = -alfa / a0;
      }
      a1 = (-2 * cos) / a0;
      a2 = (1 - alfa) / a0;
    }
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

/**
 * Oscilador aditivo: suma armónicos con frecuencia y timbre que cambian con el
 * tiempo. Sin aliasing, que es lo que hace que los metales suenen a metal y no
 * a módem.
 */
function aditivo(seg: number, frec: (t: number) => number, armonico: (t: number, k: number) => number, maxK = 32): Senal {
  const y = vacio(seg);
  const fases = new Float64Array(maxK + 1);
  for (let i = 0; i < y.length; i++) {
    const t = i / SR;
    const f = frec(t);
    let v = 0;
    for (let k = 1; k <= maxK; k++) {
      const fk = f * k;
      if (fk > SR * 0.42) break;
      fases[k] += (2 * Math.PI * fk) / SR;
      v += armonico(t, k) * Math.sin(fases[k]);
    }
    y[i] = v;
  }
  return y;
}

function ruido(seg: number): Senal {
  const y = vacio(seg);
  for (let i = 0; i < y.length; i++) y[i] = azar() * 2 - 1;
  return y;
}

/** Envolvente: sube en `ataque`, se mantiene y cae en `caida` al final. */
function envolvente(y: Senal, ataque: number, caida: number): Senal {
  const a = muestras(ataque), c = muestras(caida);
  for (let i = 0; i < y.length; i++) {
    let g = 1;
    if (i < a) g = Math.sin(((i / a) * Math.PI) / 2);
    const resto = y.length - i;
    if (resto < c) g *= Math.pow(resto / c, 1.6);
    y[i] *= g;
  }
  return y;
}

/** Reverberación de Schroeder: da sala sin hacer falta ninguna muestra. */
function reverb(x: Senal, mezcla: number, cola = 1.6, realimentacion = 0.82): Senal {
  const n = x.length + muestras(cola);
  const peines = [1557, 1617, 1491, 1422, 1277, 1356].map((d) => ({ buf: new Float32Array(d), i: 0, f: 0 }));
  const pasatodos = [556, 441, 341].map((d) => ({ buf: new Float32Array(d), i: 0 }));
  const y = new Float32Array(n);
  const amortigua = 0.3;
  for (let s = 0; s < n; s++) {
    const seco = s < x.length ? x[s] : 0;
    const entrada = seco * 0.12;
    let v = 0;
    for (const p of peines) {
      const sal = p.buf[p.i];
      p.f = sal * (1 - amortigua) + p.f * amortigua;
      p.buf[p.i] = entrada + p.f * realimentacion;
      p.i = (p.i + 1) % p.buf.length;
      v += sal;
    }
    for (const a of pasatodos) {
      const sal = a.buf[a.i];
      a.buf[a.i] = v + sal * 0.5;
      a.i = (a.i + 1) % a.buf.length;
      v = sal - v;
    }
    y[s] = seco + mezcla * v;
  }
  return y;
}

/** Saturación suave y normalizado a -1 dBFS, con fundido para que no chasque. */
function masterizar(x: Senal, empuje = 1.2): Senal {
  let pico = 0;
  for (const v of x) pico = Math.max(pico, Math.abs(v));
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = Math.tanh((x[i] / (pico || 1)) * empuje);
  pico = 0;
  for (const v of y) pico = Math.max(pico, Math.abs(v));
  // Fuera la cola que ya no se oye (-50 dB).
  let ultimo = y.length - 1;
  while (ultimo > 0 && Math.abs(y[ultimo]) < pico * 0.003) ultimo--;
  return acabar(y.slice(0, Math.min(y.length, ultimo + muestras(0.1))), pico);
}

function acabar(y: Senal, pico: number): Senal {
  const objetivo = 0.89;
  const fin = muestras(0.05);
  for (let i = 0; i < y.length; i++) {
    y[i] = (y[i] / (pico || 1)) * objetivo;
    const resto = y.length - i;
    if (resto < fin) y[i] *= resto / fin;
  }
  return y;
}

function wav(x: Senal): Buffer {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + x.length * 2, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), 44 + i * 2);
  return b;
}

// ---------------------------------------------------------------------------
// Instrumentos
// ---------------------------------------------------------------------------

/** Tambor de guerra: golpe grave con caída de tono y un chasquido de parche. */
function tambor(f0 = 120, f1 = 46, seg = 1.1): Senal {
  const y = vacio(seg);
  let fase = 0, fase2 = 0;
  for (let i = 0; i < y.length; i++) {
    const t = i / SR;
    const f = f1 + (f0 - f1) * Math.exp(-t * 18);
    fase += (2 * Math.PI * f) / SR;
    fase2 += (2 * Math.PI * f * 1.52) / SR;
    y[i] = Math.sin(fase) * Math.exp(-t * 4.2) + 0.3 * Math.sin(fase2) * Math.exp(-t * 9);
  }
  const parche = biquad(ruido(0.12), 'bajo', 900);
  for (let i = 0; i < parche.length; i++) parche[i] *= Math.exp((-i / SR) * 35);
  mezclar(y, parche, 0, 0.6);
  return y;
}

/**
 * Cuerno de guerra. El truco de los metales: cuanto más fuerte suena, más
 * brillante es. Aquí el número de armónicos sigue a la envolvente.
 */
function cuerno(seg: number, frec: (t: number) => number, desafinado = 0): Senal {
  const ataque = 0.18, caida = 0.55;
  const env = (t: number) => {
    const sube = Math.min(1, t / ataque);
    const baja = Math.min(1, Math.max(0, (seg - t) / caida));
    return Math.pow(sube, 1.5) * Math.pow(baja, 1.4) * (0.9 + 0.1 * Math.sin(t * 2.1));
  };
  const vibrato = (t: number) => 1 + (t > 0.5 ? 0.006 * Math.sin(2 * Math.PI * 5.2 * t) * Math.min(1, (t - 0.5) / 0.6) : 0);
  const f = (t: number) => frec(t) * vibrato(t) * (1 + desafinado);
  const tono = aditivo(seg, f, (t, k) => {
    const e = env(t);
    return (e / k) * Math.exp(-(k - 1) / (1.2 + 9 * e));
  });
  // El soplido: un poco de ruido que sigue a la nota.
  const soplo = biquad(ruido(seg), 'banda', (t) => frec(t) * 3, 2);
  for (let i = 0; i < soplo.length; i++) soplo[i] *= env(i / SR) * 0.05;
  mezclar(tono, soplo, 0);
  return tono;
}

/** Campana: parciales inarmónicos que se apagan a distinto ritmo. */
function campana(f: number, seg = 1.6): Senal {
  const y = vacio(seg);
  const parciales = [
    [1, 1, 3.2],
    [2.76, 0.35, 6],
    [5.4, 0.15, 10],
    [8.93, 0.06, 14],
  ];
  for (let i = 0; i < y.length; i++) {
    const t = i / SR;
    const ataque = Math.min(1, t / 0.003);
    let v = 0;
    for (const [m, a, d] of parciales) v += a * Math.sin(2 * Math.PI * f * m * t) * Math.exp(-t * d);
    y[i] = v * ataque;
  }
  return y;
}

/** Burbuja: un "bloop" que sube de tono muy deprisa. */
function burbuja(f0: number): Senal {
  const y = vacio(0.12);
  let fase = 0;
  for (let i = 0; i < y.length; i++) {
    const t = i / SR;
    fase += (2 * Math.PI * f0 * (1 + 1.4 * (t / 0.07))) / SR;
    y[i] = Math.sin(fase) * Math.min(1, t / 0.004) * Math.exp(-t * 40);
  }
  return y;
}

// ---------------------------------------------------------------------------
// Los sonidos
// ---------------------------------------------------------------------------

const D3 = 146.83, A3 = 220;

function gritoDeGuerra(): Senal {
  const total = vacio(4.4);
  mezclar(total, tambor(125, 44), 0, 1);
  mezclar(total, tambor(118, 42), 0.3, 0.85);

  // Una nota larga y el salto a la quinta, como en las películas.
  const nota = (t: number) => {
    const scoop = t < 0.14 ? 0.92 + 0.08 * (t / 0.14) : 1;
    if (t < 1.25) return D3 * scoop;
    if (t < 1.33) return D3 + (A3 - D3) * ((t - 1.25) / 0.08);
    return A3;
  };
  const inicio = 0.55, dur = 3.1;
  mezclar(total, cuerno(dur, nota), inicio, 0.55);
  mezclar(total, cuerno(dur, nota, 0.004), inicio + 0.02, 0.4);
  mezclar(total, cuerno(dur, (t) => nota(t) / 2, -0.002), inicio, 0.45);

  mezclar(total, tambor(130, 45), inicio + 1.28, 1);
  mezclar(total, tambor(120, 42), inicio + 1.58, 0.7);
  return masterizar(reverb(total, 0.35, 2), 1.4);
}

function pocion(): Senal {
  const total = vacio(1.2);
  const instantes = [0, 0.08, 0.19, 0.26, 0.37, 0.45, 0.56, 0.63];
  for (const t of instantes) mezclar(total, burbuja(380 + azar() * 380), t + azar() * 0.02, 0.5 + azar() * 0.3);

  // El "curado": arpegio de campanas en do mayor.
  const salida = vacio(3);
  mezclar(salida, total, 0);
  const notas = [1046.5, 1318.5, 1568, 2093];
  notas.forEach((f, i) => mezclar(salida, campana(f), 0.78 + i * 0.075, 0.32));
  // Brillo final: la misma armonía, muy suave y temblando.
  const brillo = aditivo(1.3, () => 1046.5, (t, k) => ([1, 2, 3, 4].includes(k) ? 0.08 / k : 0) * (0.6 + 0.4 * Math.sin(t * 40)), 4);
  mezclar(salida, envolvente(brillo, 0.2, 0.9), 1.05);
  return masterizar(reverb(salida, 0.45, 1.8), 1.1);
}

function maldicion(): Senal {
  const seg = 3.4;
  // Semitono y tritono: el intervalo del diablo, literalmente.
  const voces = [55, 58.27, 77.78].map((f, i) =>
    aditivo(seg, (t) => f * (1 + 0.003 * Math.sin(t * (1.3 + i))), (_t, k) => 1 / k, 24),
  );
  const drone = vacio(seg);
  for (const v of voces) mezclar(drone, v, 0, 0.35);
  const filtrado = biquad(drone, 'bajo', (t) => 180 + 900 * Math.sin(Math.min(1, t / seg) * Math.PI), 3);
  envolvente(filtrado, 0.9, 1.1);

  const total = vacio(seg + 0.2);
  mezclar(total, tambor(85, 32, 1.8), 0, 1.1);
  mezclar(total, filtrado, 0.05, 1);

  // Un lamento que cae.
  const lamento = vacio(1.8);
  let fase = 0;
  for (let i = 0; i < lamento.length; i++) {
    const t = i / SR;
    fase += (2 * Math.PI * (880 * Math.pow(0.12, t / 1.8))) / SR;
    lamento[i] = Math.sin(fase) * Math.sin((Math.PI * t) / 1.8) * 0.12;
  }
  mezclar(total, lamento, 0.3);
  return masterizar(reverb(total, 0.5, 2.2, 0.86), 1.5);
}

function terremoto(): Senal {
  const seg = 5.4;
  // Ruido marrón: el retumbar grave de las piedras.
  const marron = vacio(seg);
  let acc = 0;
  for (let i = 0; i < marron.length; i++) {
    acc = acc * 0.995 + (azar() * 2 - 1) * 0.1;
    marron[i] = acc;
  }
  const grave = biquad(marron, 'bajo', 160, 0.9);
  for (let i = 0; i < grave.length; i++) {
    const t = i / SR;
    const sacudida = 0.55 + 0.45 * Math.abs(Math.sin(t * 3.1) * Math.sin(t * 5.7 + 1) + 0.4 * Math.sin(t * 7.9));
    grave[i] *= sacudida * (1 + 0.3 * Math.sin(2 * Math.PI * 41 * t));
  }
  envolvente(grave, 0.5, 1.2);

  const total = vacio(seg);
  mezclar(total, grave, 0, 1);
  mezclar(total, tambor(70, 30, 2), 0, 0.9);

  // Cascotes: golpecitos de ruido repartidos.
  for (let n = 0; n < 34; n++) {
    const t = 0.3 + azar() * (seg - 1.6);
    const trozo = biquad(ruido(0.09), 'bajo', 700 + azar() * 1600);
    for (let i = 0; i < trozo.length; i++) trozo[i] *= Math.exp((-i / SR) * (35 + azar() * 20));
    mezclar(total, trozo, t, 0.12 + azar() * 0.22);
  }
  return masterizar(reverb(total, 0.25, 1.2), 1.6);
}

function lag(): Senal {
  // Un acorde normal que se atasca, se degrada y se corta.
  const acorde = vacio(0.5);
  for (const f of [261.63, 329.63, 392]) {
    mezclar(acorde, aditivo(0.5, () => f, (_t, k) => (k % 2 ? 1 / k : 0.5 / k), 12), 0, 0.3);
  }
  const trozo = acorde.slice(muestras(0.02), muestras(0.1));

  const total = vacio(1.9);
  mezclar(total, envolvente(acorde.slice(0, muestras(0.22)), 0.01, 0.005), 0);
  let t = 0.22;
  for (let r = 0; r < 7; r++) {
    const bits = Math.max(2, 10 - r * 1.3);
    const niveles = Math.pow(2, bits);
    const salto = 1 + r * 2;
    const roto = new Float32Array(trozo.length);
    for (let i = 0; i < trozo.length; i++) {
      const v = trozo[i - (i % salto)];
      roto[i] = Math.round(v * niveles) / niveles;
    }
    mezclar(total, roto, t, 1);
    t += trozo.length / SR;
  }

  // "Desconectado": dos pitidos que bajan.
  for (const [f, en] of [[880, t + 0.08], [440, t + 0.22]] as const) {
    const pitido = vacio(0.1);
    for (let i = 0; i < pitido.length; i++) pitido[i] = (Math.sin((2 * Math.PI * f * i) / SR) > 0 ? 0.25 : -0.25);
    mezclar(total, envolvente(pitido, 0.003, 0.01), en);
  }
  const estatica = biquad(ruido(0.3), 'alto', 2000);
  for (let i = 0; i < estatica.length; i++) estatica[i] *= 0.15 * (1 - i / estatica.length);
  mezclar(total, estatica, t + 0.36);
  return masterizar(total, 1);
}

// ---------------------------------------------------------------------------

const SONIDOS: Record<string, () => Senal> = {
  'grito-de-guerra': gritoDeGuerra,
  pocion,
  maldicion,
  terremoto,
  lag,
};

mkdirSync(DESTINO, { recursive: true });
for (const [nombre, generar] of Object.entries(SONIDOS)) {
  const inicio = Date.now();
  const senal = generar();
  const archivo = new URL(`${nombre}.wav`, DESTINO);
  writeFileSync(archivo, wav(senal));
  console.log(`${nombre}.wav · ${(senal.length / SR).toFixed(1)} s · ${Date.now() - inicio} ms`);
}
console.log(`\nEn ${fileURLToPath(DESTINO)}`);
