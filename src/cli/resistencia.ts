/**
 * Prueba de resistencia (26 sep 2026): un directo largo y realista.
 *
 * El laboratorio (laboratorio.ts) fuerza choques concretos en segundos. Esto
 * es lo contrario: horas de chat normal, con gente que entra y sale, cofres
 * automáticos con su reloj de verdad, jefes, canjes y regalos cada pocos
 * minutos. Busca lo que solo sale con el tiempo:
 *   - memoria que crece sin parar
 *   - temporizadores que se quedan abiertos
 *   - objetos que se duplican o se pierden
 *   - errores sueltos
 *
 * Cada 5 minutos, un punto de control. Nada sale a Twitch ni a OBS, y la
 * base de datos es de memoria.
 *
 *   npm run resistencia -- --minutos=90
 *   npm run resistencia -- --minutos=90 --semilla=7 --informe=ruta.md
 *
 * Los cofres automáticos caen cada 3-5 min (en el directo, 20-30): así en
 * una hora y media caen los de un directo largo.
 */

// Antes de cargar nada: la configuración se lee del entorno al importarla.
process.env.LOOT_MINUTOS_MIN = '3';
process.env.LOOT_MINUTOS_MAX = '5';
process.env.LOG_LEVEL = 'warn';
process.env.DRY_RUN = 'false';

const args = process.argv.slice(2);
const flag = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const MINUTOS = Number(flag('minutos') ?? 90);
const SEMILLA = Number(flag('semilla') ?? Date.now() % 100_000);
const INFORME = flag('informe');

let estadoAzar = SEMILLA >>> 0;
function azar(): number {
  estadoAzar = (estadoAzar + 0x6d2b79f5) >>> 0;
  let t = estadoAzar;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
Math.random = azar;
const entre = (a: number, b: number) => a + Math.floor(azar() * (b - a + 1));
const elegir = <T>(l: readonly T[]) => l[entre(0, l.length - 1)]!;
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const { config, MAX_MESSAGE_LENGTH } = await import('../config.js');
  const { normalize } = await import('../core/events.js');
  const { handleEvent } = await import('../core/handler.js');
  const killswitch = await import('../core/killswitch.js');
  const ajustes = await import('../core/ajustes.js');
  const { setSender } = await import('../core/output.js');
  const { setApprover } = await import('../core/review.js');
  const { configureDatabase, getDb } = await import('../data/db.js');
  const streams = await import('../data/streams.js');
  const interactionLog = await import('../data/interactions.js');
  const loot = await import('../interactions/loot/index.js');
  const jefe = await import('../interactions/loot/jefe.js');
  const terremoto = await import('../interactions/terremoto.js');

  // ---------- La consola del bot: los errores cuentan ----------
  const errores: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {};
  console.warn = () => {};
  console.error = (...x: unknown[]) => { errores.push(x.map(String).join(' ')); };
  const lineas: string[] = [];
  const decir = (s: string) => { lineas.push(s); original.log(s); };

  configureDatabase(':memory:');
  killswitch.enable('resistencia');
  ajustes.setLootActivo(true, 'resistencia');
  ajustes.setInteraccionesEspontaneas(false, 'resistencia');
  ajustes.setCanalJuega(true, 'resistencia');

  // ---------- El mundo de mentira ----------
  let enviados = 0;
  let largos = 0;
  const porHora: number[] = [];
  setSender(async (texto) => {
    await esperar(entre(30, 200));
    enviados++;
    porHora.push(Date.now());
    if (texto.length > MAX_MESSAGE_LENGTH) largos++;
  });
  setApprover(async () => ({ approved: true }));
  loot.setPantalla(async () => { await esperar(entre(200, 800)); });
  loot.setLanzarEfecto(async () => { await esperar(entre(50, 300)); return true; });
  terremoto.setTemblor(async () => { await esperar(5000); });

  type Tipo = 'charlatan' | 'competitivo' | 'coleccionista' | 'generoso' | 'miron';
  interface Persona { login: string; tipo: Tipo; dentro: boolean; hasta: number }
  const NOMBRES = ['raftaei', 'crid4n', 'ana_tank', 'luisheals', 'pepe_dps', 'marta', 'sofi_mage', 'dani_rogue', 'kira', 'nacho', 'lucia_pvp', 'bruno'];
  const TIPOS: Tipo[] = ['charlatan', 'competitivo', 'coleccionista', 'generoso', 'miron'];
  const gente: Persona[] = NOMBRES.map((login, i) => ({ login, tipo: TIPOS[i % TIPOS.length]!, dentro: false, hasta: 0 }));
  const dentro = () => gente.filter((p) => p.dentro);

  loot.setChatters(async () => {
    await esperar(entre(20, 120));
    return dentro().map((p) => ({ id: `r-${p.login}`, login: p.login, displayName: p.login, isBroadcaster: false, isModerator: false, isVip: false, isSubscriber: false, rawRole: null }));
  });

  let eventos = 0;
  const latencias: number[] = [];
  const mensaje = (login: string, texto: string) => normalize('Twitch.ChatMessage', {
    messageId: `m-${azar()}`, user: { id: `r-${login}`, login, name: login, role: 1, badges: [], subscribed: false }, text: texto,
    meta: { firstMessage: false, returningChatter: false },
  }, 'streamerbot');
  const canje = (login: string, recompensa: string) => normalize('Twitch.RewardRedemption', {
    id: `c-${azar()}`, user_id: `r-${login}`, user_login: login, user_name: login, user_input: '',
    reward: { id: `rw-${recompensa}`, title: recompensa, cost: 1 },
  }, 'streamerbot');

  /** Sin await, como Streamer.bot: cada evento, por su cuenta. */
  function lanzar(e: ReturnType<typeof mensaje>): void {
    eventos++;
    const t = performance.now();
    handleEvent(e)
      .catch((err) => errores.push(`handleEvent: ${err instanceof Error ? err.stack : String(err)}`))
      .finally(() => latencias.push(performance.now() - t));
  }

  const CHARLA = ['jajaja', 'buenas!', 'qué clase llevas?', 'gg', 'ese jefe estaba roto', 'hoy toca farmear?', 'KEKW', 'vamos!!', 'me voy a por agua', 'qué build es esa'];
  function queDice(p: Persona): string {
    const otro = elegir(dentro().filter((o) => o.login !== p.login).map((o) => o.login).concat([p.login]));
    const r = azar();
    switch (p.tipo) {
      case 'charlatan': return r < 0.8 ? elegir(CHARLA) : elegir(['!inventario', '!top', '!loot']);
      case 'competitivo': return r < 0.3 ? `!duelo ${otro}` : r < 0.45 ? '!acepto' : r < 0.5 ? '!revancha' : r < 0.55 ? '!poder' : r < 0.6 ? '!top' : elegir(CHARLA);
      case 'coleccionista': return r < 0.25 ? '!forjar' : r < 0.45 ? '!coleccion' : r < 0.6 ? '!inventario' : r < 0.7 ? '!usar' : elegir(CHARLA);
      case 'generoso': return r < 0.2 ? `!dar ${otro} ${entre(1, 4)}` : r < 0.3 ? '!dar' : r < 0.4 ? '!presumir' : elegir(CHARLA);
      default: return r < 0.7 ? elegir(CHARLA) : '!inventario';
    }
  }

  // ---------- El directo ----------
  const inicio = Date.now();
  const fin = inicio + MINUTOS * 60_000;
  const quedan = () => fin - Date.now();
  /** Nunca se espera más allá del final: la prueba dura lo que dice. */
  const hasta = (ms: number) => esperar(Math.max(0, Math.min(ms, quedan())));
  streams.open();
  loot.arrancar();
  const memoria0 = process.memoryUsage().heapUsed;
  const handles = () => (process as unknown as { _getActiveHandles(): unknown[] })._getActiveHandles().length;
  const handles0 = handles();
  let malditosCreados = 0;

  decir(`# Prueba de resistencia · ${MINUTOS} min · semilla ${SEMILLA}`);
  decir(`${gente.length} espectadores simulados, cofres cada ${config.loot.minutosMin}-${config.loot.minutosMax} min.\n`);

  // Cada persona, a su ritmo: entra, habla un rato, se va, vuelve.
  const vidas = gente.map(async (p) => {
    await hasta(entre(0, Math.min(5, MINUTOS / 4) * 60_000));
    while (quedan() > 0) {
      p.dentro = true;
      p.hasta = Date.now() + entre(10, 40) * 60_000;
      lanzar(mensaje(p.login, 'hola!'));
      while (Date.now() < p.hasta && quedan() > 0) {
        const pausa = p.tipo === 'miron' ? entre(120, 400) : p.tipo === 'charlatan' ? entre(15, 60) : entre(30, 120);
        await hasta(pausa * 1000);
        if (quedan() <= 0) break;
        // Si hay jefe, los que no son mirones pegan.
        if (jefe.estado() && p.tipo !== 'miron' && azar() < 0.8) lanzar(mensaje(p.login, '!atacar'));
        else lanzar(mensaje(p.login, queDice(p)));
      }
      p.dentro = false;
      await hasta(entre(3, 20) * 60_000);
    }
  });

  // Mientras hay jefe, se pega más a menudo (cada 10-15 s).
  const golpes = (async () => {
    while (quedan() > 0) {
      await hasta(entre(10, 15) * 1000);
      if (!jefe.estado()) continue;
      for (const p of dentro()) if (p.tipo !== 'miron' && azar() < 0.6) lanzar(mensaje(p.login, '!atacar'));
    }
  })();

  // Lo que pasa cada pocos minutos: canjes, jefes, regalos.
  const sucesos = (async () => {
    while (quedan() > 0) {
      await hasta(entre(Math.min(4, MINUTOS / 3), Math.min(9, MINUTOS / 2)) * 60_000);
      if (quedan() <= 0) break;
      const quien = dentro().length ? elegir(dentro()).login : NOMBRES[0]!;
      const r = azar();
      if (r < 0.2) { await jefe.invocar(); }
      else if (r < 0.4) lanzar(canje(quien, 'Grito de guerra'));
      else if (r < 0.55) { lanzar(canje(quien, 'Maldición')); malditosCreados++; }
      else if (r < 0.65) lanzar(canje(quien, 'Poción de vida'));
      else if (r < 0.75) lanzar(canje(quien, 'Terremoto'));
      else if (r < 0.9) lanzar(canje(quien, 'Cofre del tesoro'));
      else await loot.regalarCofre();
    }
  })();

  // ---------- Puntos de control ----------
  const problemas: string[] = [];
  const filas = () => getDb().prepare('SELECT twitch_id, maldito FROM loot').all() as Array<{ twitch_id: string; maldito: number }>;
  function control(final = false): void {
    const min = Math.round((Date.now() - inicio) / 60_000);
    const f = filas();
    const porPersona = new Map<string, { n: number; m: number }>();
    for (const x of f) {
      const v = porPersona.get(x.twitch_id) ?? { n: 0, m: 0 };
      v.n++; v.m += x.maldito;
      porPersona.set(x.twitch_id, v);
    }
    for (const [id, v] of porPersona) if (v.n - v.m > 20) problemas.push(`min ${min}: ${id} lleva ${v.n} objetos`);
    const malditos = f.filter((x) => x.maldito).length;
    // Los malditos solo nacen de la Maldición (y de la Calavera, que se gasta al usarse).
    const calaveras = (getDb().prepare("SELECT COUNT(*) n FROM interactions WHERE interaction = 'loot-usar' AND detail LIKE 'Calavera%'").get() as { n: number }).n;
    if (malditos > malditosCreados + calaveras) problemas.push(`min ${min}: ${malditos} objetos malditos para ${malditosCreados + calaveras} maldiciones`);
    const heap = process.memoryUsage().heapUsed;
    const hora = porHora.filter((t) => Date.now() - t < 3_600_000).length;
    const orden = [...latencias].sort((a, b) => a - b);
    const p95 = orden.length ? orden[Math.floor(orden.length * 0.95)]!.toFixed(0) : '—';
    const bloqueados = (getDb().prepare("SELECT COUNT(*) n FROM interactions WHERE status = 'blocked'").get() as { n: number }).n;
    decir(`[${String(min).padStart(3)} min] eventos ${eventos} · mensajes ${enviados} (${hora} en la última hora, ${bloqueados} frenados) · ` +
      `objetos ${f.length} · malditos ${malditos} · dentro ${dentro().length} · jefe ${jefe.estado() ? 'sí' : 'no'} · ` +
      `memoria ${(heap / 1e6).toFixed(1)} MB · temporizadores ${handles()} · p95 ${p95} ms · errores ${errores.length}`);
    if (final) latencias.length = 0;
  }
  const reloj = setInterval(() => control(), 5 * 60_000);

  await Promise.all([...vidas, golpes, sucesos]);
  clearInterval(reloj);
  loot.parar();
  jefe.reset();
  await esperar(3000);
  control(true);

  // ---------- Informe ----------
  const heapFinal = process.memoryUsage().heapUsed;
  if (largos) problemas.push(`${largos} mensajes de más de ${MAX_MESSAGE_LENGTH} caracteres`);
  for (const e of errores) problemas.push(`[ERROR] ${e.slice(0, 300)}`);
  const crecimiento = (heapFinal - memoria0) / 1e6;
  const porTipo = getDb().prepare('SELECT interaction, status, COUNT(*) n FROM interactions GROUP BY 1, 2 ORDER BY n DESC').all() as Array<{ interaction: string; status: string; n: number }>;
  const origenes = getDb().prepare('SELECT origen, COUNT(*) n FROM loot GROUP BY 1 ORDER BY n DESC').all() as Array<{ origen: string; n: number }>;
  decir(`\n## Resultado: ${problemas.length ? `✘ ${problemas.length} problema(s)` : '✔ sin problemas'}`);
  decir(`- ${eventos} eventos en ${MINUTOS} min; ${enviados} mensajes del bot.`);
  decir(`- Memoria: ${(memoria0 / 1e6).toFixed(1)} → ${(heapFinal / 1e6).toFixed(1)} MB (${crecimiento >= 0 ? '+' : ''}${crecimiento.toFixed(1)} MB).`);
  decir(`- Temporizadores abiertos: ${handles0} al empezar → ${handles()} al acabar.`);
  decir(`- Botín por origen: ${origenes.map((o) => `${o.origen} ${o.n}`).join(' · ')}`);
  decir(`- Interacciones: ${porTipo.slice(0, 14).map((i) => `${i.interaction}/${i.status} ${i.n}`).join(' · ')}`);
  for (const p of problemas.slice(0, 30)) decir(`  ✘ ${p}`);
  if (INFORME) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(INFORME, lineas.join('\n') + '\n');
  }
  process.exit(problemas.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
