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
}

export type Motor = {
  generar: (p: PeticionImagen) => Promise<Buffer>;
  editar: (p: PeticionEdicion) => Promise<Buffer>;
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
  editar: ({ prompt, tamano, transparente, calidad, base }) => {
    const form = new FormData();
    form.append('model', transparente ? config.imagen.modeloTransparente : config.imagen.modelo);
    form.append('prompt', prompt);
    form.append('size', tamano);
    form.append('quality', calidad ?? config.imagen.calidad);
    form.append('output_format', 'png');
    if (transparente) form.append('background', 'transparent');
    form.append('image[]', new Blob([new Uint8Array(base)], { type: 'image/png' }), 'base.png');
    return llamar('edits', { method: 'POST', body: form });
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
