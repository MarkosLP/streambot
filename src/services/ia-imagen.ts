import { config } from '../config.js';

/**
 * Imágenes con IA: GPT Image de OpenAI (27 sep 2026).
 *
 * Solo se usa desde el panel y solo cuando lo pides: nunca por su cuenta ni
 * desde el chat. Cada imagen cuesta dinero (céntimos), así que no hay
 * reintentos automáticos.
 */

export class ErrorImagen extends Error {}

export interface PeticionImagen {
  prompt: string;
  /** '1920x1088' (fondos) o '1024x1536' (avatar)… múltiplos de 16. */
  tamano: string;
  /** Fondo transparente (PNG): usa el modelo que lo admite. */
  transparente?: boolean;
  calidad?: 'low' | 'medium' | 'high';
}

export interface PeticionEdicion extends PeticionImagen {
  /** La imagen de partida (PNG), para variaciones coherentes del mismo personaje. */
  base: Buffer;
  /** PNG del mismo tamaño: solo se retoca lo transparente (services/png.ts). */
  mascara?: Buffer;
}

/** Dónde están ojos y boca en un retrato, de 0 a 1 (centro de cada cosa). */
export interface Cara {
  ojos: { x: number; y: number }[];
  boca: { x: number; y: number } | null;
  /** Ancho de un ojo, de 0 a 1. */
  anchoOjo: number;
}

export type Motor = {
  generar: (p: PeticionImagen) => Promise<Buffer>;
  editar: (p: PeticionEdicion) => Promise<Buffer>;
  localizarCara: (png: Buffer) => Promise<Cara | null>;
  /** Tu descripción en castellano → una en inglés, precisa y visual (null si falla). */
  detallar?: (texto: string, que: 'fondo' | 'personaje') => Promise<string | null>;
  /** ¿La variante es el mismo personaje, con la cara visible y el cambio pedido? (null si no se pudo mirar) */
  comprobarVariante?: (base: Buffer, variante: Buffer, pedido: string) => Promise<{ ok: boolean; motivo: string } | null>;
};

const TIEMPO_MAX_MS = 240_000;

async function llamar(ruta: string, init: RequestInit): Promise<Buffer> {
  if (!config.imagen.apiKey) throw new ErrorImagen('Falta OPENAI_API_KEY: añádela al .env (o a las variables de Windows) y reinicia el bot.');
  let r: Response;
  try {
    r = await fetch(`https://api.openai.com/v1/images/${ruta}`, {
      ...init,
      headers: { Authorization: `Bearer ${config.imagen.apiKey}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(TIEMPO_MAX_MS),
    });
  } catch (err) {
    throw new ErrorImagen(err instanceof Error && err.name === 'TimeoutError'
      ? 'OpenAI ha tardado demasiado. Vuelve a probar en un rato.'
      : 'No se pudo conectar con OpenAI. ¿Hay internet?');
  }
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = d?.error?.message ?? `respondió ${r.status}`;
    if (r.status === 401) throw new ErrorImagen('OpenAI no acepta la clave (OPENAI_API_KEY).');
    if (r.status === 429) throw new ErrorImagen('OpenAI dice que vas muy deprisa o que no queda saldo. Mira tu cuenta de OpenAI.');
    if (d?.error?.code === 'moderation_blocked') throw new ErrorImagen('OpenAI ha rechazado la descripción por sus normas. Cámbiala un poco.');
    throw new ErrorImagen(`OpenAI: ${msg}`);
  }
  const b64 = d?.data?.[0]?.b64_json;
  if (typeof b64 !== 'string') throw new ErrorImagen('OpenAI no ha devuelto ninguna imagen.');
  return Buffer.from(b64, 'base64');
}

const openai: Motor = {
  generar: ({ prompt, tamano, transparente, calidad }) =>
    llamar('generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: transparente ? config.imagen.modeloTransparente : config.imagen.modelo,
        prompt,
        size: tamano,
        quality: calidad ?? config.imagen.calidad,
        n: 1,
        output_format: 'png',
        ...(transparente && { background: 'transparent' }),
      }),
    }),
  editar: ({ prompt, tamano, transparente, calidad, base, mascara }) => {
    const form = new FormData();
    form.append('model', transparente ? config.imagen.modeloTransparente : config.imagen.modelo);
    form.append('prompt', prompt);
    form.append('size', tamano);
    form.append('quality', calidad ?? config.imagen.calidad);
    form.append('output_format', 'png');
    if (transparente) form.append('background', 'transparent');
    form.append('image[]', new Blob([new Uint8Array(base)], { type: 'image/png' }), 'base.png');
    if (mascara) form.append('mask', new Blob([new Uint8Array(mascara)], { type: 'image/png' }), 'mascara.png');
    return llamar('edits', { method: 'POST', body: form });
  },
  /**
   * Un modelo que ve (config.imagen.modeloVision) dice dónde están los ojos y
   * la boca. No es exacto al píxel (el 27 sep, gpt-5-mini acertó en horizontal
   * y se fue unos 40 px de 1024 en vertical): quien lo usa deja margen.
   * Si falla, null: el avatar se hace como antes.
   */
  localizarCara: async (png) => {
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.imagen.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.imagen.modeloVision,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: [
            { type: 'text', text: 'This is a 1024x1024 character portrait. Return JSON {"ojo_izq":{"x":..,"y":..},"ojo_der":{"x":..,"y":..},"boca":{"x":..,"y":..},"ancho_ojo":..} with PIXEL coordinates of the CENTER of each eye (as seen in the image), the center of the mouth (null if hidden), and the approximate width of one eye in pixels.' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}`, detail: 'high' } },
          ] }],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      const d: any = await r.json();
      const j = JSON.parse(d?.choices?.[0]?.message?.content ?? 'null');
      const p = (v: any) => (v && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: Math.min(1, Math.max(0, v.x / 1024)), y: Math.min(1, Math.max(0, v.y / 1024)) } : null);
      const ojos = [p(j?.ojo_izq), p(j?.ojo_der)].filter((o): o is { x: number; y: number } => o !== null);
      if (!ojos.length) return null;
      return { ojos, boca: p(j?.boca), anchoOjo: Math.min(.2, Math.max(.03, (Number(j?.ancho_ojo) || 60) / 1024)) };
    } catch {
      return null;
    }
  },
  /**
   * Antes de pintar, un modelo de texto pasa lo que pides a inglés y lo
   * concreta: qué aspecto tiene de verdad un sitio de un juego («Giran de
   * Lineage 2»: el puerto, el castillo, la plaza…), la hora, la gente. El 27 sep
   * un fondo de «Giran de día con personajes» salió de noche, vacío y genérico:
   * el modelo de imagen no conoce bien esos sitios y el estilo pesaba más.
   */
  /**
   * Mira la variante al lado de la original. El 27 sep, con las instrucciones
   * del errante, al Chico de pelo negro y a Magmarex les tapó la cara de negro
   * con una sonrisa brillante, y a Magmarex le cambió la cara al cerrar los ojos.
   */
  comprobarVariante: async (base, variante, pedido) => {
    try {
      const img = (b: Buffer) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${b.toString('base64')}`, detail: 'low' } });
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.imagen.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.imagen.modeloVision,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: [
            { type: 'text', text: 'Image 1 is a character portrait. Image 2 is an edit of it that was asked to show: "' + pedido + '". ' +
              'Answer JSON {"mismo": bool, "cara_visible": bool, "cambio_hecho": bool, "motivo": "short reason in Spanish"}. ' +
              '"mismo": same character with the same face design, colors and style (only the eyes/mouth may differ). ' +
              '"cara_visible": the face is still drawn normally, not blacked out, shadowed over, hidden or replaced by a symbol. ' +
              '"cambio_hecho": the requested change is clearly visible.' },
            img(base), img(variante),
          ] }],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      const d: any = await r.json();
      const j = JSON.parse(d?.choices?.[0]?.message?.content ?? 'null');
      if (!j || !['mismo', 'cara_visible', 'cambio_hecho'].every((k) => typeof j[k] === 'boolean')) return null;
      return { ok: j.mismo && j.cara_visible && j.cambio_hecho, motivo: String(j.motivo ?? '').slice(0, 200) };
    } catch {
      return null;
    }
  },
  detallar: async (texto, que) => {
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.imagen.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.imagen.modeloVision,
          messages: [{ role: 'user', content:
            `Rewrite this ${que === 'fondo' ? 'background scene' : 'character'} request (in Spanish) as a precise English description for an image model, 60 to 120 words. ` +
            'Keep EVERY detail the user asked for, especially time of day, weather, mood, colors and whether there are people. ' +
            'If it names a place, character or creature from a video game, anime or film, describe what it actually looks like there ' +
            '(architecture, landmarks, layout, materials, colors, outfit) so it is recognizable, without using logos or text. ' +
            'Do not add a different time of day or mood. Output only the description.\n\nRequest: ' + texto },
          ],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      const d: any = await r.json();
      const t = String(d?.choices?.[0]?.message?.content ?? '').trim();
      return t.length > 20 ? t.slice(0, 1500) : null;
    } catch {
      return null;
    }
  },
};

let motor: Motor = openai;

/** Para los tests: nada de gastar dinero en OpenAI. */
export function setMotor(m: Motor | null): void {
  motor = m ?? openai;
}

export const disponible = () => Boolean(config.imagen.apiKey);
export const generar = (p: PeticionImagen) => motor.generar(p);
export const editar = (p: PeticionEdicion) => motor.editar(p);
export const localizarCara = (png: Buffer) => motor.localizarCara(png);
export const comprobarVariante = async (base: Buffer, variante: Buffer, pedido: string) =>
  (motor.comprobarVariante ? motor.comprobarVariante(base, variante, pedido) : null);
export const detallar = async (texto: string, que: 'fondo' | 'personaje') => (texto.trim() && motor.detallar ? motor.detallar(texto, que) : null);
