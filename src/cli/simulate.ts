import { log } from '../core/logger.js';
import { normalize } from '../core/events.js';
import { handleEvent } from '../core/handler.js';
import * as killswitch from '../core/killswitch.js';
import * as cooldowns from '../core/cooldowns.js';
import * as policy from '../core/policy.js';
import { setSender } from '../core/output.js';
import { configureDatabase, truncateAll, getDb } from '../data/db.js';
import * as users from '../data/users.js';
import * as interactionLog from '../data/interactions.js';

/**
 * Consola de simulación.
 *
 * Dispara eventos sin estar en directo y sin Streamer.bot abierto.
 *
 * Dos detalles que hacen que esto valga para algo:
 *
 *  1. NO construye eventos de dominio a mano. Fabrica un payload con la forma
 *     de Streamer.bot y lo pasa por el MISMO normalize() y el MISMO
 *     handleEvent() que el camino real. Recorre policy, cooldowns, SQLite y
 *     la interacción de verdad; lo único falso es el último centímetro.
 *
 *  2. Usa una base de datos aparte (data/crid4m.sim.sqlite) para que trastear
 *     no ensucie los usuarios reales del canal.
 */

const SIM_DB = 'data/crid4m.sim.sqlite';

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
function fakeUser(
  login: string,
  opts: { mod?: boolean; broadcaster?: boolean; sub?: boolean; vip?: boolean },
) {
  const badges: Array<{ name: string; version: string }> = [];
  if (opts.broadcaster) badges.push({ name: 'broadcaster', version: '1' });
  if (opts.mod) badges.push({ name: 'moderator', version: '1' });
  if (opts.vip) badges.push({ name: 'vip', version: '1' });
  if (opts.sub) badges.push({ name: 'subscriber', version: '1' });

  return {
    id: `sim-${login.toLowerCase()}`,
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

async function simulateMessage(flags: Args['flags']): Promise<void> {
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
  await handleEvent(normalize('Twitch.ChatMessage', payload, 'simulator'));
}

async function simulateRedeem(flags: Args['flags']): Promise<void> {
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
  await handleEvent(normalize('Twitch.RewardRedemption', payload, 'simulator'));
}

function step(title: string): void {
  log.info(`\n───── ${title} ─────`);
}

/** El flujo que exige el criterio de hecho 8: usuario nuevo y usuario repetido. */
async function runFlujo(): Promise<void> {
  truncateAll();
  cooldowns.reset();
  policy.reset();
  log.info('Base de datos de simulación vaciada.\n');

  step('1ª ejecución de "pepe" — usuario NUEVO, debe saludar');
  await simulateMessage({ user: 'pepe', text: 'hola' });
  mostrarEstado();

  step('2ª ejecución de "pepe" — usuario EXISTENTE, NO debe saludar');
  await simulateMessage({ user: 'pepe', text: 'sigo por aquí' });
  mostrarEstado();

  step('"ana" entra por primera vez, pero el cooldown global de 60 s está activo');
  await simulateMessage({ user: 'ana', text: 'buenas' });
  mostrarEstado();

  step('StreamElements escribe — se ignora, ni se registra');
  await simulateMessage({ user: 'streamelements', text: 'llevo 2 días en marcha' });
  mostrarEstado();
}

/** Escena que recorre el interruptor de emergencia y la policy. */
async function runDemo(): Promise<void> {
  truncateAll();
  cooldowns.reset();
  policy.reset();

  step('1. Sonda de salida con el sistema ACTIVO');
  await simulateMessage({ user: 'pepe', text: '!ping' });

  step('2. Alguien sin permisos intenta apagar');
  await simulateMessage({ user: 'pepe', text: '!apagar' });

  step('3. El dueño del canal apaga');
  await simulateMessage({ user: 'crid4m', text: '!apagar', broadcaster: true });

  step('4. Sonda con el sistema APAGADO (debe bloquearse)');
  await simulateMessage({ user: 'pepe', text: '!ping' });

  step('5. Usuario nuevo con el sistema APAGADO (tampoco debe salir)');
  await simulateMessage({ user: 'nuevo', text: 'hola' });

  step('6. El dueño del canal reactiva');
  await simulateMessage({ user: 'crid4m', text: '!encender', broadcaster: true });

  step('7. Redención de Channel Point (aún sin interacción asociada)');
  await simulateRedeem({ user: 'pepe', text: '¿mando o teclado?' });

  log.info(`\nEstado final: ${killswitch.status()}`);
  mostrarEstado();
}

function mostrarEstado(): void {
  const db = getDb();
  const filas = db
    .prepare('SELECT login, first_seen, last_seen FROM users ORDER BY first_seen')
    .all() as Array<{ login: string; first_seen: string; last_seen: string }>;

  console.log(`\n  users (${filas.length}):`);
  for (const f of filas) {
    const primeraVez = f.first_seen === f.last_seen ? ' (primera aparición)' : '';
    console.log(`    ${f.login.padEnd(16)} visto por última vez ${f.last_seen}${primeraVez}`);
  }

  const inter = interactionLog.all();
  console.log(`  interactions (${inter.length}):`);
  for (const i of inter) {
    console.log(
      `    ${i.interaction.padEnd(16)} ${String(i.twitch_id).padEnd(20)} ${i.status}` +
        (i.detail ? ` — ${i.detail}` : ''),
    );
  }
  console.log('');
}

function usage(): void {
  console.log(`
Consola de simulación — CRID4M

  npm run simulate -- <comando> [opciones]

Comandos:
  message     Mensaje de chat
  redeem      Redención de Channel Point
  flujo       Usuario nuevo -> saluda; el mismo usuario -> no saluda
  demo        Interruptor de emergencia y policy
  estado      Muestra el contenido de la base de datos de simulación
  reset       Vacía la base de datos de simulación

Opciones de message:
  --user=<login>      quién escribe             (por defecto: pepe)
  --text="<texto>"    qué escribe               (por defecto: hola)
  --first             marcar como primer mensaje según Streamer.bot
  --mod / --broadcaster / --sub / --vip   badges

Opciones de redeem:
  --user=<login>      quién canjea
  --text="<texto>"    texto introducido
  --reward="<nombre>" nombre de la recompensa
  --cost=<n>          coste en puntos

Opción general:
  --reset             vacía la base de datos antes de ejecutar

Ejemplos:
  npm run simulate -- flujo
  npm run simulate -- message --user=pepe --text="hola"
  npm run simulate -- message --user=pepe --text="hola"     (2ª vez: no saluda)
  npm run simulate -- estado

Nota: los dos guiones (--) son necesarios para que npm no se quede las opciones.
La simulación usa ${SIM_DB}, no la base de datos real.
`);
}

async function main(): Promise<void> {
  configureDatabase(SIM_DB);

  // Emisor falso: recorre output.send() y policy igual que el camino real,
  // pero el último centímetro no llega a Twitch.
  setSender(async () => {});

  const { command, flags } = parseArgs(process.argv.slice(2));

  if (command && command !== 'estado') {
    log.info('EMISOR SIMULADO: nada de lo que veas aquí sale a Twitch.\n');
  }
  if (flags.reset === true && command !== 'reset') {
    truncateAll();
    log.info('Base de datos de simulación vaciada.');
  }

  switch (command) {
    case 'message':
      await simulateMessage(flags);
      mostrarEstado();
      break;
    case 'redeem':
      await simulateRedeem(flags);
      break;
    case 'flujo':
      await runFlujo();
      break;
    case 'demo':
      await runDemo();
      break;
    case 'estado':
      mostrarEstado();
      break;
    case 'reset':
      truncateAll();
      log.info('Base de datos de simulación vaciada.');
      break;
    default:
      if (command) console.log(`Comando desconocido: "${command}"`);
      usage();
      process.exitCode = command ? 1 : 0;
  }
}

await main();
