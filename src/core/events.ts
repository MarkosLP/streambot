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
  /** El id del mensaje en Twitch: para quitarlo del chat en pantalla si lo borran. */
  messageId?: string;
  /** El color del nombre en Twitch ('#1E90FF'), si llega. */
  color?: string;
  /** Emotes del mensaje, para pintarlos en el chat en pantalla. */
  emotes?: Emote[];
}

export interface Emote {
  nombre: string;
  url: string;
}

/**
 * Moderación del chat: un mensaje borrado, alguien expulsado o silenciado, o
 * el chat vaciado. Solo sirve para que el chat en pantalla (escenas) no
 * enseñe lo que un moderador ya ha quitado.
 */
export interface ChatModeracionEvent extends BaseEvent {
  type: 'chat.moderacion';
  accion: 'borrado' | 'fuera' | 'vaciado';
  messageId: string;
  userId: string;
  login: string;
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

/**
 * Suscripciones, regalos, bits y raids (26 sep 2026, propuestas S1-S7).
 *
 * Hasta entonces caían en `raw`. Su forma sale de los tipos de
 * @streamerbot/client, pero con los canjes esos tipos NO coincidían con lo
 * que llegaba de verdad (Fase 5): se leen de forma tolerante (camelCase,
 * snake_case y `user` anidado) y el primer payload real de cada uno se
 * guarda en logs/raw-events.log para comprobarlo.
 */
export interface ViewerSubEvent extends BaseEvent {
  type: 'viewer.sub';
  viewer: Viewer;
  /** Meses acumulados. 1 en una suscripción nueva. */
  meses: number;
  /** 1, 2 o 3 (Twitch manda 1000/2000/3000; se normaliza). */
  nivel: number;
  resub: boolean;
}

export interface ViewerGiftSubEvent extends BaseEvent {
  type: 'viewer.giftsub';
  /** null si es anónimo. */
  regala: Viewer | null;
  recibe: Viewer;
  /** Cuántas regala de golpe (una bomba de 10 son 10 avisos con esto a 10). */
  bomba: number;
}

/**
 * Una bomba de regalos, de golpe. Con «Gift Bombs: Ignored» en Streamer.bot
 * (como lo tiene Crid4m) es lo ÚNICO que llega: no hay avisos sueltos. Su
 * forma no viene en los tipos de la librería: se lee con cuidado.
 */
export interface ViewerGiftBombEvent extends BaseEvent {
  type: 'viewer.giftbomb';
  regala: Viewer | null;
  cantidad: number;
  /** Quién las recibe, si el aviso lo dice (puede venir vacío). */
  recibe: Viewer[];
}

export interface ViewerCheerEvent extends BaseEvent {
  type: 'viewer.cheer';
  viewer: Viewer;
  bits: number;
}

/** Alguien sigue el canal (Twitch.Follow). Solo para las alertas y el panel de overlays. */
export interface ViewerFollowEvent extends BaseEvent {
  type: 'viewer.follow';
  viewer: Viewer;
}

export interface ChannelRaidEvent extends BaseEvent {
  type: 'channel.raid';
  /** El canal que te trae la raid. */
  desde: Viewer;
  espectadores: number;
}

export type DomainEvent =
  | ViewerMessageEvent
  | ChatModeracionEvent
  | ViewerRedeemEvent
  | StreamStateEvent
  | ViewerSubEvent
  | ViewerGiftSubEvent
  | ViewerGiftBombEvent
  | ViewerCheerEvent
  | ChannelRaidEvent
  | ViewerFollowEvent
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

/** Solo '#RRGGBB': el color va a parar a un estilo del overlay. */
function colorValido(c: string): string | undefined {
  return /^#[0-9a-f]{6}$/i.test(c) ? c : undefined;
}

/** Hosts de los que se aceptan imágenes de emotes: Twitch, 7TV, BTTV y FFZ. */
const HOSTS_EMOTES = ['static-cdn.jtvnw.net', 'cdn.7tv.app', 'cdn.betterttv.net', 'cdn.frankerfacez.com'];

/**
 * Los emotes de un mensaje, vengan como vengan: `emotes` (arriba o dentro de
 * `message`) o `parts` con tipo 'emote'. Nunca se inventa nada: sin datos,
 * lista vacía y el texto sale tal cual.
 */
function emotesDe(payload: any): Emote[] {
  const crudos: any[] = [
    ...(Array.isArray(payload?.emotes) ? payload.emotes : []),
    ...(Array.isArray(payload?.message?.emotes) ? payload.message.emotes : []),
    ...(Array.isArray(payload?.parts) ? payload.parts.filter((p: any) => p?.type === 'emote') : []),
  ];
  const vistos = new Map<string, Emote>();
  for (const e of crudos) {
    const nombre = text(e?.name, text(e?.text));
    const url = text(e?.imageUrl, text(e?.image_url, text(e?.url)));
    if (!nombre || !url || vistos.has(nombre)) continue;
    try {
      const u = new URL(url);
      if (u.protocol === 'https:' && HOSTS_EMOTES.includes(u.hostname)) vistos.set(nombre, { nombre, url: u.href });
    } catch { /* URL rara: fuera */ }
  }
  return [...vistos.values()].slice(0, 40);
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
 * Alguien, desde un payload de sub/regalo/bits: acepta userId / user_id /
 * user.id y compañía. `pre` es el prefijo de otro usuario del mismo payload
 * (recipientUserId, from_broadcaster_user_id…).
 */
function persona(payload: any, pre = ''): Viewer {
  const p = payload ?? {};
  // El `user` anidado es de la persona principal: nunca de quien recibe un regalo.
  const u = pre ? {} : (p.user ?? {});
  const cap = (k: string) => (pre ? pre + k.charAt(0).toUpperCase() + k.slice(1) : k);
  const id = text(p[cap('userId')], text(p[`${pre}${pre ? '_' : ''}user_id`], text(u.id, u.id != null ? String(u.id) : '')));
  const login = text(p[cap('userName')], text(p[cap('username')], text(p[`${pre}${pre ? '_' : ''}user_login`], text(u.login)))).toLowerCase();
  const nombre = text(p[cap('displayName')], text(p[`${pre}${pre ? '_' : ''}user_name`], text(u.name, login)));
  return {
    id, login, displayName: nombre || login,
    isBroadcaster: false, isModerator: false, isVip: false, isSubscriber: true, rawRole: null,
  };
}

/**
 * Alguien de la lista de receptores de una bomba: { id, login, name } o
 * { userId, userName, displayName }. Aparte de persona(): en un aviso normal,
 * `id` suele ser el del propio aviso, no el de nadie.
 */
function personaDeLista(r: any): Viewer {
  const id = text(r?.userId, text(r?.user_id, r?.id != null ? String(r.id) : ''));
  const login = text(r?.userName, text(r?.username, text(r?.user_login, text(r?.login)))).toLowerCase();
  const nombre = text(r?.displayName, text(r?.user_name, text(r?.name, login)));
  return { id, login, displayName: nombre || login, isBroadcaster: false, isModerator: false, isVip: false, isSubscriber: true, rawRole: null };
}

/** 1000/2000/3000 o 1/2/3, o "Prime": al nivel 1-3. */
function nivelSub(v: unknown): number {
  const n = num(v, 1);
  return n >= 1000 ? Math.min(3, Math.round(n / 1000)) : Math.max(1, Math.min(3, n || 1));
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
        messageId: text(payload?.messageId, text(payload?.message?.msgId, text(payload?.id))),
        color: colorValido(text(payload?.user?.color, text(payload?.color, text(payload?.message?.color)))),
        emotes: emotesDe(payload),
      };

    case 'Twitch.ChatMessageDeleted':
    case 'Twitch.UserTimedOut':
    case 'Twitch.UserBanned':
    case 'Twitch.ChatCleared':
      return {
        ...base,
        type: 'chat.moderacion',
        accion: eventName === 'Twitch.ChatMessageDeleted' ? 'borrado' : eventName === 'Twitch.ChatCleared' ? 'vaciado' : 'fuera',
        messageId: text(payload?.messageId, text(payload?.message_id, text(payload?.targetMessageId, text(payload?.target_message_id)))),
        userId: text(payload?.user_id, text(payload?.userId, text(payload?.target_user_id, text(payload?.user?.id)))),
        login: text(payload?.user_login, text(payload?.userName, text(payload?.target_user_login, text(payload?.user?.login)))).toLowerCase(),
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

    case 'Twitch.Sub':
    case 'Twitch.ReSub': {
      const resub = eventName === 'Twitch.ReSub';
      return {
        ...base,
        type: 'viewer.sub',
        viewer: persona(payload),
        meses: resub ? Math.max(1, num(payload?.cumulativeMonths, num(payload?.cumulative_months, 1))) : 1,
        nivel: nivelSub(payload?.subTier ?? payload?.tier),
        resub,
      };
    }

    case 'Twitch.GiftSub': {
      const anonimo = payload?.isAnonymous === true || payload?.is_anonymous === true;
      return {
        ...base,
        type: 'viewer.giftsub',
        regala: anonimo ? null : persona(payload),
        recibe: persona(payload, 'recipient'),
        bomba: payload?.fromSubBomb ? Math.max(1, num(payload?.subBombCount, 1)) : 1,
      };
    }

    case 'Twitch.GiftBomb': {
      const anonimo = payload?.isAnonymous === true || payload?.is_anonymous === true || payload?.anonymous === true;
      const lista: any[] = Array.isArray(payload?.recipients) ? payload.recipients : Array.isArray(payload?.recipientUsers) ? payload.recipientUsers : [];
      const recibe = lista.map(personaDeLista).filter((v) => v.id || v.login);
      return {
        ...base,
        type: 'viewer.giftbomb',
        regala: anonimo ? null : persona(payload),
        cantidad: Math.max(1, num(payload?.gifts, num(payload?.subBombCount, num(payload?.count, num(payload?.total, recibe.length))))),
        recibe,
      };
    }

    case 'Twitch.Cheer':
      return { ...base, type: 'viewer.cheer', viewer: { ...persona(payload), isSubscriber: payload?.subscriber === true }, bits: num(payload?.bits) };

    case 'Twitch.Raid': {
      const desde = persona(payload, 'from_broadcaster');
      return { ...base, type: 'channel.raid', desde: { ...desde, isSubscriber: false }, espectadores: num(payload?.viewers, num(payload?.viewerCount)) };
    }

    case 'Twitch.Follow':
      return { ...base, type: 'viewer.follow', viewer: { ...(payload?.targetUser ? normalizeViewer(payload.targetUser) : persona(payload)), isSubscriber: false } };

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
    case 'chat.moderacion':
      return `moderación: ${event.accion} ${event.login || event.userId || event.messageId}`;
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
    case 'viewer.sub':
      return `${event.viewer.displayName} se ${event.resub ? `resuscribe (${event.meses} meses)` : 'suscribe'}`;
    case 'viewer.giftsub':
      return `${event.regala?.displayName ?? 'un anónimo'} regala una sub a ${event.recibe.displayName}${event.bomba > 1 ? ` (de ${event.bomba})` : ''}`;
    case 'viewer.giftbomb':
      return `${event.regala?.displayName ?? 'un anónimo'} regala ${event.cantidad} subs de golpe`;
    case 'viewer.cheer':
      return `${event.viewer.displayName} manda ${event.bits} bits`;
    case 'channel.raid':
      return `raid de ${event.desde.displayName} con ${event.espectadores} personas`;
    case 'viewer.follow':
      return `${event.viewer.displayName} sigue el canal`;
    case 'stream.online':
      return 'el directo ha empezado';
    case 'stream.offline':
      return 'el directo ha terminado';
    case 'raw':
      return `evento sin normalizar: ${event.eventName}`;
  }
}

/**
 * `describe` para el registro en disco (28 sep 2026): sin lo que escribe la
 * gente. De un comando queda el comando y sus argumentos cortos (`!duelo
 * ana`, `!dar ana 2`), que es lo que hace falta para saber qué pasó; de la
 * charla y de lo escrito en un canje, solo cuánto ocupaba.
 */
export function describePrivado(event: DomainEvent): string {
  if (event.type === 'viewer.message') {
    const texto = event.text.trim();
    if (!texto.startsWith('!')) return `${event.viewer.displayName}: (mensaje de ${texto.length} caracteres)`;
    const [comando = '', ...resto] = texto.split(/\s+/);
    const args = resto.join(' ');
    return `${event.viewer.displayName}: ${comando}${args.length > 24 ? ` (${args.length} caracteres más)` : args ? ` ${args}` : ''}`;
  }
  if (event.type === 'viewer.redeem') {
    return `${event.viewer.displayName} canjeó "${event.rewardTitle}" (${event.rewardCost} pts)` +
      (event.userInput ? ` -> (${event.userInput.length} caracteres)` : '');
  }
  return describe(event);
}
