import type { ChatModeracionEvent, Emote, ViewerMessageEvent } from './events.js';

/**
 * Los últimos mensajes del chat, para el chat en pantalla de la escena
 * Charla (panel → Escenas).
 *
 * SOLO EN MEMORIA, a propósito: el bot no guarda lo que escribe la gente
 * (ver users.ts) y esto no cambia esa regla. Es lo que ya se ve en el chat de
 * Twitch, los últimos minutos, y se pierde al reiniciar.
 *
 * Lo que un moderador quita (mensaje borrado, expulsión, silencio, chat
 * vaciado) sale también de aquí, para que no se quede en el directo.
 */

export interface MensajeChat {
  n: number;
  messageId: string;
  userId: string;
  login: string;
  nombre: string;
  color: string | null;
  texto: string;
  emotes: Emote[];
  sub: boolean;
  mod: boolean;
  canal: boolean;
  at: number;
}

const MAX = 30;
const LARGO_MAX = 300;
let lista: MensajeChat[] = [];
let contador = 0;

export function apuntar(e: ViewerMessageEvent, esCanal = false): void {
  const texto = e.text.trim();
  if (!texto) return;
  lista.push({
    n: ++contador,
    messageId: e.messageId ?? '',
    userId: e.viewer.id,
    login: e.viewer.login,
    nombre: e.viewer.displayName || e.viewer.login,
    color: e.color ?? null,
    texto: texto.length > LARGO_MAX ? `${texto.slice(0, LARGO_MAX)}…` : texto,
    emotes: e.emotes ?? [],
    sub: e.viewer.isSubscriber,
    mod: e.viewer.isModerator && !e.viewer.isBroadcaster,
    canal: esCanal || e.viewer.isBroadcaster,
    at: e.at.getTime(),
  });
  if (lista.length > MAX) lista = lista.slice(-MAX);
}

export function moderar(e: ChatModeracionEvent): number {
  const antes = lista.length;
  if (e.accion === 'vaciado') lista = [];
  else if (e.accion === 'borrado' && e.messageId) lista = lista.filter((m) => m.messageId !== e.messageId);
  else if (e.accion === 'fuera') lista = lista.filter((m) => !((e.userId && m.userId === e.userId) || (e.login && m.login === e.login)));
  return antes - lista.length;
}

/** Quien pide !olvidame desaparece también de aquí. */
export function olvidar(userId: string): void {
  lista = lista.filter((m) => m.userId !== userId);
}

export function recientes(limite = 14): MensajeChat[] {
  return lista.slice(-limite);
}

/** Solo para tests. */
export function reset(): void {
  lista = [];
  contador = 0;
}
