import { config, MAX_MESSAGE_LENGTH } from '../config.js';
import { normalize, type Viewer } from '../core/events.js';
import { handleEvent } from '../core/handler.js';
import * as killswitch from '../core/killswitch.js';
import * as cooldowns from '../core/cooldowns.js';
import * as policy from '../core/policy.js';
import * as ajustes from '../core/ajustes.js';
import { setSender } from '../core/output.js';
import { setApprover } from '../core/review.js';
import { configureDatabase, truncateAll, getDb } from '../data/db.js';
import * as streams from '../data/streams.js';
import * as lootDb from '../data/loot.js';
import * as interactionLog from '../data/interactions.js';
import * as loot from '../interactions/loot/index.js';
import * as jefe from '../interactions/loot/jefe.js';
import * as arena from '../interactions/loot/arena.js';
import * as mmo from '../interactions/mmo/index.js';
import * as terremoto from '../interactions/terremoto.js';
import type { Rareza } from '../interactions/loot/objetos.js';

/**
 * Laboratorio de pruebas (26 sep 2026).
 *
 * Simula a varias personas en el chat A LA VEZ, usando los comandos de
 * verdad, y comprueba después que no se ha roto nada: objetos duplicados o
 * perdidos, un cofre que se lo llevan dos, un jefe que muere dos veces...
 *
 * Como en el directo:
 *  - Los eventos entran por el MISMO normalize() y handleEvent() que los de
 *    Streamer.bot, y SIN esperar a que acabe el anterior (Streamer.bot los
 *    reparte así: cada mensaje se atiende en paralelo).
 *  - El "chat" tarda 20-150 ms en publicar, como el de verdad. Es en esas
 *    esperas donde dos comandos se pueden cruzar.
 *
 * Nada sale a Twitch ni a OBS, y la base de datos es de memoria: el
 * laboratorio no toca la del canal.
 *
 *   npm run laboratorio               todas las pruebas
 *   npm run laboratorio -- --semilla=42   repetir una ejecución exacta
 *   npm run laboratorio -- --detalle  ver los mensajes del bot
 *   npm run laboratorio -- --json     el resultado en JSON (lo usa el panel)
 */

// ---------------------------------------------------------------------------
// Azar con semilla: una ejecución que falla se puede repetir tal cual
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (n: string) => args.find((a) => a.startsWith(`--${n}`))?.split('=')[1];
const SEMILLA = Number(flag('semilla') ?? Date.now() % 100_000);
const DETALLE = args.includes('--detalle');
/** --json: sin texto, solo el resultado en una línea de JSON (lo usa el panel). */
const JSON_SALIDA = args.includes('--json');

let estadoAzar = SEMILLA >>> 0;
function azar(): number {
  // mulberry32
  estadoAzar = (estadoAzar + 0x6d2b79f5) >>> 0;
  let t = estadoAzar;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
Math.random = azar;
const entre = (a: number, b: number) => a + Math.floor(azar() * (b - a + 1));
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// La consola del bot, capturada: los [ERROR] son fallos del laboratorio
// ---------------------------------------------------------------------------

const errores: string[] = [];
const original = { log: console.log, warn: console.warn, error: console.error };
function silenciar(): void {
  console.log = () => {};
  console.warn = () => {};
  console.error = (...x: unknown[]) => { errores.push(x.map(String).join(' ')); };
}
function hablar(): void {
  Object.assign(console, original);
}
const decir = (...x: unknown[]) => { if (!JSON_SALIDA) original.log(...x); };

// ---------------------------------------------------------------------------
// El chat de mentira
// ---------------------------------------------------------------------------

interface Enviado { at: number; texto: string }
let enviados: Enviado[] = [];
let efectos: string[] = [];
let pantalla: string[] = [];
let latencias: number[] = [];
let reloj0 = Date.now();

const persona = (login: string): Viewer => ({
  id: `lab-${login}`, login, displayName: login,
  isBroadcaster: false, isModerator: false, isVip: false, isSubscriber: false, rawRole: null,
});

function mensaje(login: string, texto: string) {
  return normalize('Twitch.ChatMessage', {
    messageId: `m-${azar()}`,
    user: { id: `lab-${login}`, login, name: login, role: 1, badges: [], subscribed: false },
    text: texto,
    meta: { firstMessage: false, returningChatter: false },
  }, 'streamerbot');
}

function canje(login: string, recompensa: string) {
  return normalize('Twitch.RewardRedemption', {
    id: `r-${azar()}`, user_id: `lab-${login}`, user_login: login, user_name: login, user_input: '',
    reward: { id: `rw-${recompensa}`, title: recompensa, cost: 1 },
  }, 'streamerbot');
}

type Evento = ReturnType<typeof mensaje>;

/**
 * Lanza los eventos casi a la vez (cada uno con 0-`ventana` ms de retraso) y
 * SIN esperar a que acabe el anterior. Espera a que acaben todos.
 */
async function aLaVez(eventos: Evento[], ventana = 60): Promise<void> {
  await Promise.all(eventos.map(async (e) => {
    await esperar(entre(0, ventana));
    const t = performance.now();
    try {
      await handleEvent(e);
    } catch (err) {
      errores.push(`handleEvent lanzó: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    }
    latencias.push(performance.now() - t);
  }));
  // Lo que quede en vuelo (envíos sin await, banners en fila): que termine.
  await esperar(250);
}

function preparar(): void {
  truncateAll();
  cooldowns.reset();
  policy.reset();
  killswitch.enable('laboratorio');
  ajustes.reset();
  ajustes.setLootActivo(true, 'laboratorio');
  ajustes.setInteraccionesEspontaneas(false, 'laboratorio');
  ajustes.setCanalJuega(true, 'laboratorio');
  loot.reset();
  jefe.reset();
  arena.reset();
  enviados = [];
  efectos = [];
  pantalla = [];
  latencias = [];
  errores.length = 0;
  reloj0 = Date.now();
  setSender(async (texto) => {
    // Como Streamer.bot: publicar tarda.
    await esperar(entre(20, 150));
    enviados.push({ at: Date.now() - reloj0, texto });
  });
  setApprover(async () => ({ approved: true }));
  loot.setPantalla(async (quien, botin, origen) => {
    await esperar(entre(5, 30));
    pantalla.push(`${quien}|${botin.rareza}|${origen}`);
  });
  loot.setLanzarEfecto(async (efecto, quien) => {
    await esperar(entre(10, 60));
    efectos.push(`${efecto}:${quien.login}`);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Comprobaciones
// ---------------------------------------------------------------------------

interface Resultado { nombre: string; fallos: string[]; eventos: number; notas: string[] }
const resultados: Resultado[] = [];

const filasLoot = () =>
  getDb().prepare('SELECT id, twitch_id, objeto, rareza, origen, maldito FROM loot').all() as Array<{ id: number; twitch_id: string; objeto: string; rareza: Rareza; origen: string; maldito: number }>;
const cuenta = (twitchId: string) => lootDb.contar(twitchId);
const meter = (login: string, objeto: string, rareza: Rareza, maldito = false) =>
  lootDb.dar(`lab-${login}`, login, { objeto, rareza, maldito }, 'cofre');

/** Lo que vale siempre, pase lo que pase. */
function invariantes(fallos: string[]): void {
  for (const e of errores) fallos.push(`[ERROR] en la consola del bot: ${e.slice(0, 200)}`);
  const porPersona = new Map<string, number>();
  for (const f of filasLoot()) porPersona.set(f.twitch_id, (porPersona.get(f.twitch_id) ?? 0) + 1);
  for (const [id, n] of porPersona) {
    // Los malditos entran aunque la mochila esté llena: se permite pasarse por ellos.
    const malditos = filasLoot().filter((f) => f.twitch_id === id && f.maldito).length;
    if (n - malditos > 20) fallos.push(`${id} lleva ${n} objetos (máximo 20 + malditos)`);
  }
  for (const { texto } of enviados) {
    if (texto.length > MAX_MESSAGE_LENGTH) fallos.push(`mensaje de ${texto.length} caracteres: ${texto.slice(0, 80)}…`);
  }
}

async function prueba(nombre: string, cuerpo: (fallos: string[], notas: string[]) => Promise<number>): Promise<void> {
  preparar();
  const fallos: string[] = [];
  const notas: string[] = [];
  silenciar();
  let eventos = 0;
  try {
    eventos = await cuerpo(fallos, notas);
  } catch (err) {
    fallos.push(`la prueba se cayó: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  } finally {
    hablar();
  }
  invariantes(fallos);
  if (latencias.length) {
    const orden = [...latencias].sort((a, b) => a - b);
    const p = (q: number) => orden[Math.min(orden.length - 1, Math.floor(q * orden.length))]!.toFixed(0);
    notas.push(`tiempo por evento: mediana ${p(0.5)} ms · p95 ${p(0.95)} ms · máx ${p(1)} ms`);
  }
  notas.push(`${enviados.length} mensajes del bot`);
  resultados.push({ nombre, fallos, eventos, notas });
  decir(`${fallos.length ? '✘' : '✔'} ${nombre}`);
  for (const f of fallos) decir(`    ✘ ${f}`);
  for (const n of notas) decir(`    · ${n}`);
  if (DETALLE) for (const e of enviados) decir(`      [${e.at} ms] ${e.texto}`);
}

// ---------------------------------------------------------------------------
// Las pruebas
// ---------------------------------------------------------------------------

const GENTE = ['ana', 'luis', 'pepe', 'marta', 'raftaei', 'crid4n', 'sofia', 'dani'];

async function main(): Promise<void> {
  configureDatabase(':memory:');
  decir(`\n🧪 Laboratorio de pruebas · semilla ${SEMILLA} (repítelo con --semilla=${SEMILLA})\n`);

  await prueba('Charla: 8 personas hablando y usando comandos a la vez', async (fallos, notas) => {
    streams.open();
    for (const p of GENTE) meter(p, 'Mapa arrugado', 'comun');
    const comandos = ['hola', 'jaja', '!inventario', '!poder', '!top', '!loot', '!coleccion', 'gg', '!mochila', 'qué juego es?'];
    const eventos: Evento[] = [];
    for (let r = 0; r < 6; r++) for (const p of GENTE) eventos.push(mensaje(p, comandos[entre(0, comandos.length - 1)]!));
    await aLaVez(eventos, 400);
    const sinRespuesta = interactionLog.all().filter((f) => f.status === 'blocked');
    if (sinRespuesta.length) fallos.push(`${sinRespuesta.length} respuestas bloqueadas: ${sinRespuesta.map((f) => f.detail).slice(0, 3).join(' | ')}`);
    notas.push(`${interactionLog.all().filter((f) => f.status === 'skipped').length} comandos frenados por su espera (normal: evitan spam)`);
    return eventos.length;
  });

  await prueba('Cofre de guerra en el suelo: 8 personas escriben en el mismo instante', async (fallos) => {
    streams.open();
    // Grita el canal, fuera del juego: el cofre cae sin nadie en el chat.
    ajustes.setCanalJuega(false, 'laboratorio');
    await aLaVez([canje(config.broadcasterLogin, 'Grito de guerra')], 0);
    await loot.soltarCofre();
    if (!loot.estado().enElSuelo) fallos.push('el cofre no quedó en el suelo');
    await aLaVez(GENTE.map((p) => mensaje(p, `¡mío! ${p}`)), 5);
    const suyos = filasLoot().filter((f) => f.origen === 'guerra');
    if (suyos.length !== 1) fallos.push(`el cofre del suelo lo abrieron ${suyos.length} personas (debía ser 1)`);
    const avisos = enviados.filter((e) => e.texto.includes('llega el primero'));
    if (avisos.length !== 1) fallos.push(`${avisos.length} mensajes de «llega el primero» (debía ser 1)`);
    return GENTE.length + 1;
  });

  await prueba('!usar: el mismo objeto tres veces a la vez, y dos personas con la pantalla', async (fallos) => {
    streams.open();
    meter('ana', 'Frasco de agua bendita', 'raro');
    meter('luis', 'Calavera que susurra', 'epico');
    await aLaVez([mensaje('ana', '!usar'), mensaje('ana', '!usar frasco'), mensaje('ana', '!usar'), mensaje('luis', '!usar calavera')], 10);
    // Solo los que se pueden usar: los malditos no cuentan (la Calavera puede devolver uno).
    const quedanAna = filasLoot().filter((f) => f.twitch_id === 'lab-ana' && f.objeto === 'Frasco de agua bendita' && !f.maldito).length;
    const quedanLuis = filasLoot().filter((f) => f.twitch_id === 'lab-luis' && f.objeto === 'Calavera que susurra' && !f.maldito).length;
    const usados = (quedanAna === 0 ? 1 : 0) + (quedanLuis === 0 ? 1 : 0);
    if (usados !== 1) fallos.push(`se gastaron ${usados} objetos; con 2 min entre efectos en pantalla debía ser 1`);
    if (efectos.length !== usados) fallos.push(`${efectos.length} efectos lanzados para ${usados} objetos gastados`);
    return 4;
  });

  await prueba('!dar cruzado: regalos a la vez, el mismo objeto dos veces', async (fallos) => {
    streams.open();
    for (const p of ['ana', 'luis', 'pepe']) {
      meter(p, 'Mapa arrugado', 'comun');
      meter(p, 'Arco de tejo élfico', 'raro');
      meter(p, 'Capa de las Sombras', 'epico');
    }
    await aLaVez(['ana', 'luis', 'pepe'].map((p) => mensaje(p, 'hola')), 0);
    const antes = filasLoot().length;
    await aLaVez([
      mensaje('ana', '!dar luis 1'), mensaje('ana', '!dar pepe 1'),
      mensaje('luis', '!dar ana 3'), mensaje('pepe', '!dar ana 2'), mensaje('pepe', '!dar luis 2'),
    ], 20);
    const despues = filasLoot();
    if (despues.length !== antes) fallos.push(`había ${antes} objetos y ahora ${despues.length}: se han creado o perdido`);
    const n = new Set(despues.map((f) => f.id)).size;
    if (n !== despues.length) fallos.push('hay objetos repetidos');
    return 8;
  });

  await prueba('Jefe: 8 personas atacando a la vez hasta tumbarlo', async (fallos, notas) => {
    streams.open();
    await aLaVez(GENTE.map((p) => mensaje(p, 'hola')), 0);
    const r = await jefe.invocar({ tipo: 'tanque' });
    if (!r.ok) { fallos.push(`no se pudo invocar: ${r.motivo}`); return 0; }
    let rondas = 0;
    let eventos = 0;
    while (jefe.estado() && rondas < 60) {
      // Cada ronda, 10 s de juego: todos pueden volver a atacar.
      cooldowns.reset();
      const ronda = GENTE.flatMap((p) => [mensaje(p, '!atacar'), ...(azar() < 0.4 ? [mensaje(p, '!atacar')] : [])]);
      eventos += ronda.length;
      await aLaVez(ronda, 30);
      const v = jefe.paraOverlay().jefe?.vida;
      if (v !== undefined && v < 0) fallos.push(`vida negativa: ${v}`);
      rondas++;
    }
    if (jefe.estado()) fallos.push(`tras ${rondas} rondas el jefe sigue vivo`);
    const finales = enviados.filter((e) => e.texto.includes('ha caído'));
    if (finales.length !== 1) fallos.push(`el mensaje de «ha caído» salió ${finales.length} veces`);
    const botin = filasLoot().filter((f) => f.origen === 'jefe');
    const atacantes = new Set(interactionLog.all().filter((f) => f.interaction === 'loot-atacar' && f.status === 'sent').map((f) => f.twitch_id));
    if (botin.length > GENTE.length) fallos.push(`${botin.length} botines de jefe para ${GENTE.length} personas`);
    const especiales = enviados.filter((e) => e.texto.includes('se da con su propio escudo'));
    if (especiales.length > 1) fallos.push(`el ataque especial salió ${especiales.length} veces`);
    notas.push(`${rondas} rondas, ${botin.length} botines repartidos, ${atacantes.size} personas con mensaje enviado`);
    return eventos;
  });

  await prueba('Duelos cruzados: todos retan a todos a la vez (con un maldito)', async (fallos) => {
    streams.open();
    for (const p of GENTE) meter(p, 'Espada oxidada', 'comun');
    meter('ana', 'Corona del Liche', 'epico', true);
    await aLaVez(GENTE.map((p) => mensaje(p, 'hola')), 0);
    const malditosAntes = filasLoot().filter((f) => f.maldito).length;
    const retos: Evento[] = [];
    for (const a of GENTE) retos.push(mensaje(a, `!duelo ${GENTE[(GENTE.indexOf(a) + 1) % GENTE.length]}`));
    await aLaVez(retos, 10);
    const malditosDespues = filasLoot().filter((f) => f.maldito).length;
    if (malditosDespues !== malditosAntes) fallos.push(`había ${malditosAntes} objeto(s) maldito(s) y ahora ${malditosDespues}`);
    const d = getDb().prepare('SELECT SUM(ganados) g, SUM(perdidos) p FROM duelos').get() as { g: number; p: number };
    if (d.g !== d.p) fallos.push(`duelos ganados (${d.g}) y perdidos (${d.p}) no cuadran`);
    if (arena.recientes().length !== Math.min(5, d.g)) fallos.push(`el overlay tiene ${arena.recientes().length} duelos para ${d.g} jugados`);
    return retos.length;
  });

  await prueba('Regalo a todo el chat + cofre automático + gente hablando, a la vez', async (fallos) => {
    streams.open();
    loot.setChatters(async () => { await esperar(entre(10, 80)); return GENTE.map(persona); });
    await aLaVez(GENTE.map((p) => mensaje(p, 'hola')), 0);
    await Promise.all([
      loot.regalarCofre(),
      loot.soltarCofre(),
      aLaVez(GENTE.map((p) => mensaje(p, 'venga ese cofre')), 50),
    ]);
    await esperar(200);
    for (const p of GENTE) {
      const n = cuenta(`lab-${p}`);
      if (n !== 2) fallos.push(`${p} tiene ${n} objetos (debía tener 2: regalo + cofre)`);
    }
    return GENTE.length * 2 + 2;
  });

  await prueba('!forjar dos veces a la vez, y !forjar + !dar de lo mismo', async (fallos) => {
    streams.open();
    for (let i = 0; i < 3; i++) meter('ana', 'Mapa arrugado', 'comun');
    await aLaVez([mensaje('luis', 'hola')], 0);
    await aLaVez([mensaje('ana', '!forjar'), mensaje('ana', '!forjar'), mensaje('ana', '!dar luis 1')], 5);
    const deAna = filasLoot().filter((f) => f.twitch_id === 'lab-ana');
    const deLuis = filasLoot().filter((f) => f.twitch_id === 'lab-luis');
    const todo = [...deAna, ...deLuis];
    const forjado = todo.filter((f) => f.origen === 'forja').length;
    const comunes = todo.filter((f) => f.rareza === 'comun').length;
    // Dos órdenes posibles, los dos válidos:
    //  - se forja primero: 3 comunes → 1 raro (y quizá se lo da a luis)
    //  - se da primero: luis tiene 1 común y a ana le quedan 2 (no llega a forjar)
    const valido = (forjado === 1 && comunes === 0 && todo.length === 1) || (forjado === 0 && comunes === 3 && deLuis.length === 1);
    if (!valido) fallos.push(`estado imposible: ana ${deAna.map((f) => f.rareza).join(',') || 'nada'} · luis ${deLuis.map((f) => f.rareza).join(',') || 'nada'}`);
    if (forjado > 1) fallos.push('se forjó dos veces con los mismos objetos');
    return 4;
  });

  // 28 sep 2026: el Terremoto trae un jefe, o le tira el techo al que hay.
  await prueba('Terremoto: tres canjes a la vez (un jefe, dos derrumbes)', async (fallos, notas) => {
    streams.open();
    let temblores = 0;
    terremoto.setTemblor(async () => { temblores++; await esperar(300); });
    await aLaVez(['ana', 'luis', 'pepe'].map((p) => canje(p, 'Terremoto')), 20);
    await esperar(400);
    if (temblores !== 1) fallos.push(`tembló ${temblores} veces a la vez (debía ser 1: no se pisan)`);
    const suelos = enviados.filter((e) => e.texto.includes('abre el suelo')).length;
    const techos = enviados.filter((e) => e.texto.includes('techo sobre')).length;
    if (suelos !== 1) fallos.push(`salieron ${suelos} jefes (debía ser 1)`);
    if (techos !== 2) fallos.push(`${techos} derrumbes sobre el jefe (debían ser 2)`);
    // En el chat, primero aparece el jefe y luego le cae el techo.
    const primerTecho = enviados.findIndex((e) => e.texto.includes('techo sobre'));
    if (primerTecho !== -1 && primerTecho < enviados.findIndex((e) => e.texto.includes('abre el suelo'))) {
      fallos.push('el chat ve caer el techo sobre el jefe antes de que aparezca');
    }
    const e = jefe.estado();
    if (!e) fallos.push('el jefe no está en pie');
    else {
      const esperada = e.vidaMax - 2 * Math.round(e.vidaMax * jefe.DERRUMBE);
      if (e.vida !== esperada) fallos.push(`al jefe le quedan ${e.vida} (debían ser ${esperada})`);
      notas.push(`${e.nombre}: ${e.vida}/${e.vidaMax} tras dos derrumbes`);
    }
    terremoto.reset();
    jefe.reset();
    return 3;
  });

  await prueba('Terremotos en plena pelea: 8 atacando y el techo cayendo', async (fallos, notas) => {
    streams.open();
    await aLaVez(GENTE.map((p) => mensaje(p, 'hola')), 0);
    await jefe.invocar({ tipo: 'golem' });
    const mezcla: Evento[] = [];
    for (let r = 0; r < 6; r++) for (const p of GENTE) mezcla.push(mensaje(p, '!atacar'));
    // 5 derrumbes de un cuarto: lo tumban seguro, y alguno llega con el jefe ya caído.
    for (const p of ['ana', 'marta', 'dani', 'sofia', 'luis']) mezcla.push(canje(p, 'Terremoto'));
    await aLaVez(mezcla, 1500);
    const caidas = enviados.filter((e) => /ha caído/.test(e.texto)).length;
    if (caidas > 1) fallos.push(`el jefe cayó ${caidas} veces`);
    // El reparto del que cae va antes de anunciar el siguiente.
    const caida = enviados.findIndex((e) => /ha caído/.test(e.texto));
    const siguiente = enviados.findIndex((e) => e.texto.includes('abre el suelo'));
    if (caida !== -1 && siguiente !== -1 && siguiente < caida) fallos.push('el chat ve el jefe nuevo antes del reparto del que ha caído');
    const v = jefe.paraOverlay().jefe?.vida;
    if (v !== undefined && v < 0) fallos.push(`vida del jefe negativa: ${v}`);
    // Del reparto: un cofre por atacante y, como mucho, el del tesoro del MVP.
    const porPersona = new Map<string, number>();
    for (const f of filasLoot().filter((x) => x.origen === 'jefe')) porPersona.set(f.twitch_id, (porPersona.get(f.twitch_id) ?? 0) + 1);
    for (const [id, n] of porPersona) if (n > 2) fallos.push(`${id} se llevó ${n} premios del mismo jefe`);
    const nuevos = enviados.filter((e) => e.texto.includes('abre el suelo')).length;
    if (nuevos) notas.push(`${nuevos} jefe(s) nuevo(s) tras caer el primero`);
    notas.push(caidas ? 'el jefe cayó una vez' : `el jefe sigue en pie (${v})`);
    jefe.reset();
    return mezcla.length;
  });

  // 28 sep 2026: el Lag congela el reloj del jefe 30 s.
  await prueba('Lag: dos canjes a la vez en plena pelea, con terremotos', async (fallos, notas) => {
    streams.open();
    await aLaVez(GENTE.map((p) => mensaje(p, 'hola')), 0);
    await jefe.invocar({ tipo: 'kraken' });
    const antes = jefe.estado()!.quedanSeg;
    const mezcla: Evento[] = [canje('ana', 'Lag'), canje('luis', 'Lag'), canje('pepe', 'Terremoto')];
    for (const p of GENTE) mezcla.push(mensaje(p, '!atacar'));
    await aLaVez(mezcla, 300);
    const e = jefe.estado();
    const congelados = enviados.filter((x) => x.texto.includes('congela el tiempo')).length;
    if (congelados !== 2) fallos.push(`${congelados} mensajes de congelar (debían ser 2)`);
    if (e) {
      // Dos Lags: la parada se alarga, 60 s en total; mientras, el reloj no baja.
      const quieto = jefe.estado(Date.now() + 45_000)!.quedanSeg;
      if (Math.abs(quieto - e.quedanSeg) > 1) fallos.push(`a los 45 s el reloj ha bajado de ${e.quedanSeg} a ${quieto}: la segunda parada no se sumó`);
      if (e.quedanSeg < antes - 2) fallos.push(`el reloj bajó de ${antes} a ${e.quedanSeg} estando congelado`);
      notas.push(`${e.nombre}: reloj parado en ${e.quedanSeg} s, vida ${e.vida}/${e.vidaMax}`);
    } else notas.push('el jefe cayó durante la prueba');
    jefe.reset();
    return mezcla.length;
  });

  await prueba('Efectos a la vez: 3 Gritos, 2 Maldiciones y 2 Pociones', async (fallos, notas) => {
    streams.open();
    await aLaVez(GENTE.map((p) => mensaje(p, 'hola')), 0);
    meter('sofia', 'Anillo sombrío', 'raro', true);
    const antes = filasLoot().filter((f) => f.maldito).length;
    await aLaVez([
      canje('ana', 'Grito de guerra'), canje('luis', '⚔️ Grito de Guerra!'), canje('pepe', 'grito de guerra'),
      canje('marta', 'Maldición'), canje('dani', 'Maldición'),
      canje('sofia', 'Poción de vida'), canje('raftaei', 'Poción de vida'),
    ], 40);
    const llamadas = enviados.filter((e) => e.texto.includes('A las armas')).length;
    const unidos = enviados.filter((e) => e.texto.includes('se une al grito')).length;
    if (llamadas !== 1 || unidos !== 2) fallos.push(`${llamadas} llamadas a las armas y ${unidos} «se une» (debían ser 1 y 2)`);
    const malditos = filasLoot().filter((f) => f.maldito).length - antes;
    if (malditos !== 2) fallos.push(`las 2 Maldiciones dieron ${malditos} objetos malditos`);
    const ofertas = enviados.filter((e) => e.texto.includes('!purificar')).length;
    if (ofertas !== 1) fallos.push(`${ofertas} ofertas de !purificar (debía ser 1: solo sofia lleva un maldito)`);
    // El cofre de guerra cae una vez, solo armas, para todo el chat.
    const r = await loot.soltarCofre();
    const deGuerra = filasLoot().filter((f) => f.origen === 'guerra').length;
    if (!r.ok || deGuerra !== GENTE.length) fallos.push(`el cofre de guerra dio ${deGuerra} objetos (debían ser ${GENTE.length}, uno por persona)`);
    if (loot.estado().cofreDeGuerra !== null) fallos.push('quedó otro cofre de guerra pendiente');
    notas.push(`cofre de guerra: ${deGuerra} armas repartidas`);
    return 7;
  });

  await prueba('Dos jefes invocados a la vez desde el panel', async (fallos) => {
    streams.open();
    const [a, b] = await Promise.all([jefe.invocar(), jefe.invocar()]);
    const ok = [a, b].filter((r) => r.ok).length;
    if (ok !== 1) fallos.push(`se invocaron ${ok} jefes a la vez (debía ser 1)`);
    jefe.reset();
    return 2;
  });

  await prueba('Todo mezclado: jefe, duelos, !usar, !dar y charla a la vez', async (fallos, notas) => {
    streams.open();
    for (const p of GENTE) { meter(p, 'Espada oxidada', 'comun'); meter(p, 'Arco de tejo élfico', 'raro'); }
    meter('ana', 'Cuerno de guerra', 'epico');
    meter('luis', 'Corona del Liche', 'epico', true);
    await aLaVez(GENTE.map((p) => mensaje(p, 'hola')), 0);
    const objetosAntes = filasLoot().filter((f) => f.origen !== 'jefe').length;
    await jefe.invocar({ tipo: 'arana' });
    const mezcla: Evento[] = [];
    for (let r = 0; r < 5; r++) {
      for (const p of GENTE) {
        const otro = GENTE[entre(0, GENTE.length - 1)]!;
        const opciones = ['!atacar', '!atacar', `!duelo ${otro}`, `!dar ${otro} 1`, '!usar', '!inventario', 'jaja', '!top'];
        mezcla.push(mensaje(p, opciones[entre(0, opciones.length - 1)]!));
      }
    }
    await aLaVez(mezcla, 800);
    const v = jefe.paraOverlay().jefe?.vida;
    if (v !== undefined && v < 0) fallos.push(`vida del jefe negativa: ${v}`);
    // Los objetos no aparecen ni desaparecen solos: solo se gasta el cuerno al usarlo.
    const objetosDespues = filasLoot().filter((f) => f.origen !== 'jefe').length;
    const cuernoGastado = !filasLoot().some((f) => f.objeto === 'Cuerno de guerra');
    if (objetosDespues !== objetosAntes - (cuernoGastado ? 1 : 0)) fallos.push(`había ${objetosAntes} objetos y quedan ${objetosDespues}`);
    if (filasLoot().filter((f) => f.maldito).length !== 1) fallos.push('el objeto maldito se ha duplicado o perdido');
    notas.push(`vida del jefe al final: ${v ?? 'derrotado'}`);
    jefe.reset();
    return mezcla.length;
  });

  await prueba('Ráfaga: 120 mensajes y comandos en un segundo', async (fallos, notas) => {
    streams.open();
    for (const p of GENTE) meter(p, 'Mapa arrugado', 'comun');
    const opciones = ['!inventario', '!poder', '!top', 'jajaja', '!loot', '!duelo ana', '!dar luis', '!usar', '!coleccion', 'hola'];
    const eventos: Evento[] = [];
    for (let i = 0; i < 120; i++) eventos.push(mensaje(GENTE[i % GENTE.length]!, opciones[entre(0, opciones.length - 1)]!));
    await aLaVez(eventos, 1000);
    const bloqueados = interactionLog.all().filter((f) => f.status === 'blocked').length;
    notas.push(`${bloqueados} respuestas frenadas por el techo por hora (${config.respuestasPerHour} respuestas/hora)`);
    if (enviados.length > config.respuestasPerHour + config.messagesPerHour) fallos.push(`el bot mandó ${enviados.length} mensajes: se saltó el techo por hora`);
    return eventos.length;
  });

  await prueba('Mundo y Loot: ocho aventureros exploran mientras pelean, consultan y canjean', async (fallos, notas) => {
    streams.open();
    mmo.activar();
    for (const p of GENTE) meter(p, 'Espada oxidada', 'comun');
    await jefe.invocar({ tipo: 'arana' });
    const primera = mensaje('ana', '!explorar');
    const mezcla = [
      primera, primera, // Streamer.bot puede entregar el mismo mensaje dos veces.
      ...GENTE.slice(1).map((p) => mensaje(p, '!explorar')),
      ...GENTE.map((p) => mensaje(p, '!atacar')),
      mensaje('ana', '!mundo'), mensaje('luis', '!expedicion'),
      mensaje('pepe', '!inventario'), mensaje('marta', '!top'),
      canje('sofia', 'Lag'), canje('dani', 'Terremoto'),
    ];
    await aLaVez(mezcla, 150);
    const estado = mmo.estado();
    if (estado.fase !== 'expedicion' || estado.objetivo.actual !== 8 || estado.objetivo.meta !== 12)
      fallos.push(`mundo en ${estado.fase} ${estado.objetivo.actual}/${estado.objetivo.meta}; se esperaban ocho aportes únicos y meta 12`);
    if (estado.participantes.length !== 8) fallos.push(`${estado.participantes.length} participantes en vez de ocho`);
    const premios = (getDb().prepare('SELECT COUNT(*) n FROM mmo_premios').get() as { n: number }).n;
    if (premios !== 0) fallos.push(`el mundo entregó ${premios} premios antes de completar`);
    if (estado.acciones.length !== 3) fallos.push(`${estado.acciones.length} acciones visibles en vez de tres`);
    notas.push(`mundo ${estado.objetivo.actual}/${estado.objetivo.meta}; ${estado.participantes.length} participantes; Loot y canjes simultáneos`);
    jefe.reset();
    mmo.apagar();
    return mezcla.length;
  });

  await prueba('Mundo: ráfaga repetida, cierre simultáneo y un premio por persona', async (fallos, notas) => {
    streams.open();
    mmo.activar();
    const salida = GENTE.map((p) => mensaje(p, '!explorar'));
    await aLaVez([...salida, ...salida], 20);
    // Avanza el reloj personal de las ocho personas sin esperar dos minutos reales.
    getDb().prepare('UPDATE mmo_participantes SET ultimo_ms = ?').run(Date.now() - mmo.ACCION_MS);
    const cierre = GENTE.flatMap((p) => [mensaje(p, '!explorar'), mensaje(p, '!explorar')]);
    await aLaVez(cierre, 30);
    const estado = mmo.estado();
    const premios = getDb().prepare('SELECT twitch_id, COUNT(*) n FROM mmo_premios GROUP BY twitch_id').all() as Array<{ twitch_id: string; n: number }>;
    if (estado.fase !== 'resultado' || estado.objetivo.actual !== 12 || !estado.resultado?.completada)
      fallos.push(`cierre del mundo en ${estado.fase} ${estado.objetivo.actual}/${estado.objetivo.meta}`);
    if (premios.length !== 8 || premios.some((p) => p.n !== 1)) fallos.push(`${premios.length} personas premiadas; alguna recibió un premio duplicado`);
    const finales = enviados.filter((e) => e.texto.includes('¡Expedición completada')).length;
    if (finales !== 1) fallos.push(`${finales} anuncios finales en lugar de uno`);
    notas.push(`${estado.objetivo.actual}/${estado.objetivo.meta}; ${premios.length} premios únicos; ${finales} anuncio final`);
    mmo.apagar();
    return salida.length * 2 + cierre.length;
  });

  await prueba('Mundo: ocho votos simultáneos, Loot y cierre por el camino arriesgado', async (fallos, notas) => {
    streams.open();
    mmo.activar();
    mmo.setAzar(() => 0); // La encrucijada aparece en esta expedición.
    try {
      for (const p of GENTE) meter(p, 'Espada oxidada', 'comun');
      await jefe.invocar({ tipo: 'arana' });
      const salida = GENTE.map((p) => mensaje(p, '!explorar'));
      await aLaVez(salida, 40);
      const abierta = mmo.estado().encrucijada;
      if (!abierta || abierta.decision !== null) fallos.push('no se abrió la encrucijada tras ocho aportes');
      const votos = GENTE.map((p, i) => mensaje(p, i < 5 ? '!explorar 2' : '!explorar 1'));
      const mezcla = [votos[0]!, ...votos, ...GENTE.map((p) => mensaje(p, '!atacar')),
        mensaje('ana', '!mundo'), mensaje('pepe', '!inventario'), canje('dani', 'Terremoto')];
      await aLaVez(mezcla, 80);
      const encrucijada = mmo.estado().encrucijada;
      const recuento = encrucijada?.opciones.map((o) => o.votos);
      if (recuento?.[0] !== 3 || recuento[1] !== 5) fallos.push(`votos ${recuento?.join(' a ') ?? 'sin votación'} en vez de 3 a 5`);
      if (mmo.estado().objetivo.actual !== 8) fallos.push('votar durante la espera sumó pasos a la expedición');
      getDb().prepare('UPDATE mmo_participantes SET ultimo_ms = ?').run(Date.now() - mmo.ACCION_MS);
      const cierre = GENTE.map((p) => mensaje(p, '!explorar'));
      await aLaVez(cierre, 40);
      const estado = mmo.estado();
      const premios = getDb().prepare('SELECT twitch_id, COUNT(*) n, renombre FROM mmo_premios GROUP BY twitch_id').all() as Array<{ twitch_id: string; n: number; renombre: number }>;
      if (estado.fase !== 'resultado' || estado.objetivo.actual !== 14 || estado.objetivo.meta !== 14 || estado.encrucijada?.decision !== 2)
        fallos.push(`cierre arriesgado en ${estado.fase} ${estado.objetivo.actual}/${estado.objetivo.meta}; decisión ${estado.encrucijada?.decision}`);
      if (premios.length !== 8 || premios.some((p) => p.n !== 1 || p.renombre < 9)) fallos.push(`${premios.length} premios; faltan o hay duplicados o sin bono`);
      const finales = enviados.filter((e) => e.texto.includes('¡Expedición completada')).length;
      if (finales !== 1) fallos.push(`${finales} anuncios finales en lugar de uno`);
      notas.push(`votos ${recuento?.join(' a ') ?? '?'}; ${estado.objetivo.actual}/${estado.objetivo.meta}; ${premios.length} premios únicos`);
      jefe.reset();
      mmo.apagar();
      return salida.length + mezcla.length + cierre.length;
    } finally {
      mmo.setAzar(null);
    }
  });

  // ---------- Resumen ----------
  const malas = resultados.filter((r) => r.fallos.length);
  const eventos = resultados.reduce((n, r) => n + r.eventos, 0);
  decir(`\n${malas.length ? '✘' : '✔'} ${resultados.length - malas.length}/${resultados.length} pruebas bien · ${eventos} eventos simulados · semilla ${SEMILLA}\n`);
  if (JSON_SALIDA) original.log(JSON.stringify({ semilla: SEMILLA, eventos, resultados }));
  jefe.reset();
  process.exit(malas.length ? 1 : 0);
}

main().catch((err) => {
  hablar();
  console.error(err);
  process.exit(1);
});
