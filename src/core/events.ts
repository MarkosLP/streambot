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

export type Platform = 'twitch';

/** De dónde vino el evento. El simulador produce eventos idénticos salvo por este campo. */
export type EventSource = 'streamerbot' | 'simulator';

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

export type DomainEvent = ViewerMessageEvent | ViewerRedeemEvent | RawEvent;

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

    case 'Twitch.RewardRedemption':
      return {
        ...base,
        type: 'viewer.redeem',
        viewer: normalizeViewer(payload?.user),
        rewardId: text(payload?.reward?.id),
        rewardTitle: text(payload?.reward?.title),
        rewardCost: num(payload?.reward?.cost),
        userInput: text(payload?.userInput),
      };

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
    case 'raw':
      return `evento sin normalizar: ${event.eventName}`;
  }
}
