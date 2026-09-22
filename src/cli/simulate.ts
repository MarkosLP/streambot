import { log } from '../core/logger.js';
import { normalize } from '../core/events.js';
import { handleEvent } from '../core/handler.js';
import * as killswitch from '../core/killswitch.js';

/**
 * Consola de simulación.
 *
 * Permite disparar eventos sin estar en directo y sin Streamer.bot abierto.
 * Sin esto, cada prueba del proyecto costaría un directo entero.
 *
 * Detalle importante: el simulador NO construye eventos de dominio a mano.
 * Construye un payload con la forma de Streamer.bot y lo pasa por el MISMO
 * normalize() que usa el transporte real. Por eso lo que ves aquí es
 * exactamente lo que verás en directo: no hay dos caminos que puedan divergir.
 */

interface Args {
  command: string;
  flags: Record<string, string | true>;
}

function parseArgs(argv: string[]): Args {
  const flags: Record<string, string | true> = {};
  const positional: string[] = [];

  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const eq = body.indexOf('=');
      if (eq === -1) flags[body] = true;
      else flags[body.slice(0, eq)] = body.slice(eq + 1);
    } else {
      positional.push(arg);
    }
  }

  return { command: positional[0] ?? '', flags };
}

function flagStr(flags: Args['flags'], name: string, fallback: string): string {
  const value = flags[name];
  return typeof value === 'string' ? value : fallback;
}

function flagNum(flags: Args['flags'], name: string, fallback: number): number {
  const value = flags[name];
  if (typeof value !== 'string') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** Construye un bloque `user` con la forma exacta que envía Streamer.bot. */
function fakeUser(login: string, opts: { mod?: boolean; broadcaster?: boolean; sub?: boolean; vip?: boolean }) {
  const badges: Array<{ name: string; version: string }> = [];
  if (opts.broadcaster) badges.push({ name: 'broadcaster', version: '1' });
  if (opts.mod) badges.push({ name: 'moderator', version: '1' });
  if (opts.vip) badges.push({ name: 'vip', version: '1' });
  if (opts.sub) badges.push({ name: 'subscriber', version: '1' });

  return {
    id: `sim-${login}`,
    login: login.toLowerCase(),
    name: login,
    role: 1,
    badges,
    color: '#8A2BE2',
    subscribed: opts.sub === true,
    subscriptionTier: null,
    monthsSubscribed: 0,
  };
}

function simulateMessage(flags: Args['flags']): void {
  const login = flagStr(flags, 'user', 'pepe');
  const payload = {
    messageId: `sim-${Date.now()}`,
    user: fakeUser(login, {
      mod: flags.mod === true,
      broadcaster: flags.broadcaster === true,
      sub: flags.sub === true,
      vip: flags.vip === true,
    }),
    text: flagStr(flags, 'text', 'hola'),
    meta: {
      firstMessage: flags.first === true,
      firstMessageTimestamp: new Date().toISOString(),
      returningChatter: flags.returning === true,
      isHighlighted: false,
      isCustomReward: false,
    },
    emotes: [],
    isReply: false,
  };
  handleEvent(normalize('Twitch.ChatMessage', payload, 'simulator'));
}

function simulateRedeem(flags: Args['flags']): void {
  const login = flagStr(flags, 'user', 'pepe');
  const payload = {
    redemptionId: `sim-${Date.now()}`,
    user: fakeUser(login, { sub: flags.sub === true }),
    status: 'unfulfilled',
    userInput: flagStr(flags, 'text', ''),
    reward: {
      id: flagStr(flags, 'reward-id', 'sim-reward'),
      title: flagStr(flags, 'reward', 'Pregunta a Crid4m AI'),
      cost: flagNum(flags, 'cost', 500),
      prompt: '',
      requiresUserInput: true,
    },
    createdAt: new Date().toISOString(),
    isTest: true,
  };
  handleEvent(normalize('Twitch.RewardRedemption', payload, 'simulator'));
}

/**
 * Escena guionizada que recorre el criterio de hecho de la Fase 2 de una vez:
 * un espectador nuevo, una redención, y el interruptor de emergencia
 * bloqueando una salida.
 */
function runDemo(): void {
  const step = (title: string) => log.info(`\n───── ${title} ─────`);

  step('1. Mensaje normal');
  simulateMessage({ user: 'pepe', text: 'buenas' });

  step('2. Primer mensaje de alguien nuevo');
  simulateMessage({ user: 'nuevo_viewer', text: 'hola a todos', first: true });

  step('3. Redención de Channel Point');
  simulateRedeem({ user: 'pepe', text: '¿mando o teclado?' });

  step('4. Sonda de salida con el sistema ACTIVO');
  simulateMessage({ user: 'pepe', text: '!ping' });

  step('5. Alguien sin permisos intenta apagar');
  simulateMessage({ user: 'pepe', text: '!apagar' });

  step('6. El dueño del canal apaga');
  simulateMessage({ user: 'crid4m', text: '!apagar', broadcaster: true });

  step('7. Sonda de salida con el sistema APAGADO (debe bloquearse)');
  simulateMessage({ user: 'pepe', text: '!ping' });

  step('8. El dueño del canal reactiva');
  simulateMessage({ user: 'crid4m', text: '!encender', broadcaster: true });

  step('9. Sonda de salida de nuevo (debe salir)');
  simulateMessage({ user: 'pepe', text: '!ping' });

  log.info(`\nEstado final: ${killswitch.status()}`);
}

function usage(): void {
  console.log(`
Consola de simulación — CRID4M

  npm run simulate -- <comando> [opciones]

Comandos:
  message     Mensaje de chat
  redeem      Redención de Channel Point
  demo        Escena guionizada que recorre el criterio de hecho de la Fase 2

Opciones de message:
  --user=<login>     quién escribe            (por defecto: pepe)
  --text="<texto>"   qué escribe              (por defecto: hola)
  --first            marcarlo como primer mensaje del usuario
  --returning        marcarlo como returning chatter
  --mod              darle badge de moderador
  --broadcaster      darle badge de dueño del canal
  --sub / --vip      darle badge de sub / VIP

Opciones de redeem:
  --user=<login>     quién canjea             (por defecto: pepe)
  --text="<texto>"   texto introducido
  --reward="<nombre>" nombre de la recompensa (por defecto: Pregunta a Crid4m AI)
  --cost=<n>         coste en puntos          (por defecto: 500)

Ejemplos:
  npm run simulate -- message --user=pepe --text="hola"
  npm run simulate -- message --user=nuevo --text="hola" --first
  npm run simulate -- redeem --user=pepe --text="¿mando o teclado?"
  npm run simulate -- demo

Nota: los dos guiones (--) son necesarios para que npm no se quede
las opciones para sí mismo.
`);
}

const { command, flags } = parseArgs(process.argv.slice(2));

switch (command) {
  case 'message':
    simulateMessage(flags);
    break;
  case 'redeem':
    simulateRedeem(flags);
    break;
  case 'demo':
    runDemo();
    break;
  default:
    if (command) console.log(`Comando desconocido: "${command}"`);
    usage();
    process.exitCode = command ? 1 : 0;
}
