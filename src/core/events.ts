/**
 * Eventos de dominio.
 *
 * Esta capa traduce los payloads de Streamer.bot a eventos propios.
 * A partir de aquí, NADIE vuelve a ver un payload de Streamer.bot en crudo:
 * si algún día cambiamos de motor, solo se toca este archivo y el transporte.
 *
 * Formas verificadas contra la documentación de Streamer.bot v1.0.7
 * (tras la migración a EventSub, que eliminó el objeto `message` antiguo).
 */

import { log } from './logger.js';

export type Platform = 'twitch';

/** De dónde vino el evento. El simulador produce eventos idénticos salvo por este campo. */
/** 'obs': el vigilante del directo (core/directo.ts) al ver que OBS empieza o deja de emitir. */
export type EventSource = 'streamerbot' | 'simulator' | 'obs';

export interface Viewer {
  id: string;
  login: string;
  displayName: string;
  isBroadcaster: boolean;
  isModerator: boolean;
  isVip: boolean;
  isSubscriber: boolean;
  /**
   * El entero original de Streamer.bot (0-4). La documentación confirma el rango
   * pero no dice qué significa cada valor, así que NO lo usamos para decidir nada:
   * los permisos salen de los badges, que sí se autodescriben.
   * Lo guardamos para poder confirmar la correspondencia con datos reales.
   */
  rawRole: number | null;
}

interface BaseEvent {
  id: string;
  at: Date;
  platform: Platform;
  source: EventSource;
}

export interface ViewerMessageEvent extends BaseEvent {
  type: 'viewer.message';
  viewer: Viewer;
  text: string;
  /** Primera vez que esta persona escribe en el canal. Streamer.bot lo trackea él mismo. */
  isFirstMessage: boolean;
  isReturningChatter: boolean;
}

export interface ViewerRedeemEvent extends BaseEvent {
  type: 'viewer.redeem';
  viewer: Viewer;
  rewardId: string;
  rewardTitle: string;
  rewardCost: number;
  /** Texto que escribió el espectador. Cadena vacía si la recompensa no pide texto. */
  userInput: string;
}

/**
 * Evento que todavía no sabemos normalizar. No es un error: es la forma
 * de capturar payloads reales para escribir su normalizador en la Fase 3.
 */
export interface RawEvent extends BaseEvent {
  type: 'raw';
  eventName: string;
  payload: unknown;
}

/**
 * El directo empieza o termina.
 *
 * Hasta la Fase 6 estos dos caían en `raw` y solo se guardaban en el log.
 * Ahora abren y cierran una fila en la tabla `streams`, que es lo que
 * permite distinguir "primera vez en este directo" de "primera vez en su
 * vida".
 */
export interface StreamStateEvent extends BaseEvent {
  type: 'stream.online' | 'stream.offline';
}

export type DomainEvent =
  | ViewerMessageEvent
  | ViewerRedeemEvent
  | StreamStateEvent
  | RawEvent;

// ---------------------------------------------------------------------------
// Normalización
// ---------------------------------------------------------------------------

function nextId(): string {
  return globalThis.crypto.randomUUID();
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Los badges de Twitch se autodescriben ("broadcaster", "moderator", "vip",
 * "subscriber"), así que son una fuente más fiable que el entero `role`,
 * cuyo significado la documentación de Streamer.bot no especifica.
 */
function hasBadge(badges: unknown, name: string): boolean {
  if (!Array.isArray(badges)) return false;
  return badges.some(
    (b) => typeof b?.name === 'string' && b.name.toLowerCase() === name,
  );
}

function normalizeViewer(user: any): Viewer {
  const badges = user?.badges;
  const login = text(user?.login).toLowerCase();
  const isBroadcaster = hasBadge(badges, 'broadcaster');
  return {
    id: text(user?.id),
    login,
    displayName: text(user?.name, login),
    isBroadcaster,
    // El dueño del canal manda igual que un moderador, tenga o no el badge.
    isModerator: isBroadcaster || hasBadge(badges, 'moderator'),
    isVip: hasBadge(badges, 'vip'),
    isSubscriber: user?.subscribed === true || hasBadge(badges, 'subscriber'),
    rawRole: typeof user?.role === 'number' ? user.role : null,
  };
}

/**
 * El espectador de una REDENCION de puntos.
 *
 * Streamer.bot no manda aqui la misma forma que en el chat. En la version
 * con EventSub los datos de la persona vienen PLANOS y en snake_case
 * (`user_id`, `user_login`, `user_name`), no dentro de un objeto `user`.
 * Leerlo mal fue el fallo de la Fase 5: la pregunta y el espectador
 * llegaban vacios y la interaccion se descartaba antes de llamar a la IA.
 *
 * Aceptamos LAS DOS formas a proposito. Streamer.bot ya ha cambiado estos
 * payloads entre versiones y nos interesa mas sobrevivir al proximo cambio
 * que apostar por una sola forma.
 *
 * Una redencion no trae badges, asi que ningun permiso se deduce de aqui:
 * todos los flags salen en false, que es el valor seguro.
 */
function normalizeRedeemViewer(payload: any): Viewer {
  // Forma antigua: todo colgando de `user`. Si existe, es la mas completa
  // (trae badges), asi que tiene prioridad.
  if (payload?.user && typeof payload.user === 'object') {
    const viewer = normalizeViewer(payload.user);
    if (viewer.id || viewer.login) return viewer;
  }

  const login = text(payload?.user_login).toLowerCase();
  return {
    id: text(payload?.user_id),
    login,
    displayName: text(payload?.user_name, login),
    isBroadcaster: false,
    isModerator: false,
    isVip: false,
    isSubscriber: false,
    rawRole: null,
  };
}

/**
 * Punto de entrada único de la normalización.
 *
 * Lo llaman TANTO el transporte real COMO el simulador. Esa es la razón de que
 * `npm run simulate` produzca exactamente el mismo evento que Twitch: no hay
 * dos caminos que puedan divergir, hay uno.
 */
export function normalize(
  eventName: string,
  payload: any,
  source: EventSource,
): DomainEvent {
  const base = { id: nextId(), at: new Date(), platform: 'twitch' as const, source };

  switch (eventName) {
    case 'Twitch.ChatMessage':
      return {
        ...base,
        type: 'viewer.message',
        viewer: normalizeViewer(payload?.user),
        text: text(payload?.text),
        isFirstMessage: payload?.meta?.firstMessage === true,
        isReturningChatter: payload?.meta?.returningChatter === true,
      };

    case 'Twitch.RewardRedemption': {
      const viewer = normalizeRedeemViewer(payload);
      const userInput = text(payload?.user_input, text(payload?.userInput));

      // Si no reconocemos al espectador, el payload tiene una forma que no
      // contemplamos. Avisamos con las CLAVES del objeto (nunca su contenido,
      // que incluye lo que escribió la persona) para poder arreglarlo.
      if (!viewer.id && !viewer.login) {
        log.warn(
          'Redencion sin usuario reconocible. Claves del payload: ' +
            Object.keys(payload ?? {}).join(', '),
        );
        log.debug('payload crudo de la redencion', payload);
      }

      return {
        ...base,
        type: 'viewer.redeem',
        viewer,
        rewardId: text(payload?.reward?.id),
        rewardTitle: text(payload?.reward?.title),
        rewardCost: num(payload?.reward?.cost),
        userInput,
      };
    }

    case 'Twitch.StreamOnline':
      return { ...base, type: 'stream.online' };

    case 'Twitch.StreamOffline':
      return { ...base, type: 'stream.offline' };

    default:
      return { ...base, type: 'raw', eventName, payload };
  }
}

/** Resumen de una línea para los logs. Nada de volcar el objeto entero. */
export function describe(event: DomainEvent): string {
  switch (event.type) {
    case 'viewer.message': {
      const flags = [
        event.isFirstMessage ? 'PRIMER MENSAJE' : null,
        event.isReturningChatter ? 'vuelve' : null,
        event.viewer.isModerator ? 'mod' : null,
        event.viewer.isSubscriber ? 'sub' : null,
      ].filter(Boolean);
      const suffix = flags.length ? `  (${flags.join(', ')})` : '';
      return `${event.viewer.displayName}: ${event.text}${suffix}`;
    }
    case 'viewer.redeem':
      return `${event.viewer.displayName} canjeó "${event.rewardTitle}" (${event.rewardCost} pts)` +
        (event.userInput ? ` -> "${event.userInput}"` : '');
    case 'stream.online':
      return 'el directo ha empezado';
    case 'stream.offline':
      return 'el directo ha terminado';
    case 'raw':
      return `evento sin normalizar: ${event.eventName}`;
  }
}
