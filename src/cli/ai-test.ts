import { config, MAX_MESSAGE_LENGTH } from '../config.js';
import { log } from '../core/logger.js';
import * as killswitch from '../core/killswitch.js';
import { configureDatabase } from '../data/db.js';
import { ask, buildSystemPrompt, buildUserContent, budget } from '../services/ai/index.js';
import { countSystemTokens } from '../services/ai/claude.js';

/**
 * Prueba la capa de IA de forma aislada.
 *
 *   npm run ai:test "¿mando o teclado?"
 *
 * No toca Twitch, no toca Streamer.bot, no toca la tabla de usuarios.
 * Usa su propia base de datos para no mezclar la contabilidad de las pruebas
 * con la de los directos reales.
 */

configureDatabase('data/crid4m.ai-test.sqlite');

function linea(): void {
  console.log('─'.repeat(72));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const soloTokens = args.includes('--tokens');
  const pregunta = args.filter((a) => !a.startsWith('--')).join(' ');

  if (!process.env.ANTHROPIC_API_KEY) {
    log.error('ANTHROPIC_API_KEY no está definida. Añádela al .env.');
    process.exit(1);
  }

  // Modo "¿merece la pena el caché de prompt?": mide el prompt de sistema.
  if (soloTokens) {
    const system = buildSystemPrompt('pregunta-ia');
    const tokens = await countSystemTokens(system);
    linea();
    console.log(`Prompt de sistema: ${system.length} caracteres, ${tokens} tokens.`);
    console.log('Mínimo para que el caché se active en Opus 5: 512 tokens.');
    console.log(
      tokens >= 512
        ? '-> Es cacheable. Merece la pena evaluarlo.'
        : '-> NO llega al mínimo: poner cache_control no haría nada, y sin avisar.',
    );
    linea();
    return;
  }

  if (!pregunta) {
    console.log('\nUso: npm run ai:test "tu pregunta aquí"');
    console.log('     npm run ai:test -- --tokens   (mide el prompt de sistema)\n');
    process.exit(1);
  }

  const contexto = { userMessage: pregunta, username: 'pepe_de_pruebas' };

  linea();
  console.log(`INTENT      pregunta-ia`);
  console.log(`MODELO      ${config.ai.model}  ·  effort low  ·  timeout ${config.ai.timeoutMs} ms`);
  console.log(`PRESUPUESTO $${budget.summary().budgetUsd} por sesión`);
  console.log(`KILL SWITCH ${killswitch.status()}`);
  linea();
  console.log('ENTRADA DEL USUARIO (así se le pasa a Claude, como datos):');
  console.log(buildUserContent(contexto));
  linea();

  const resultado = await ask('pregunta-ia', contexto);

  console.log(resultado.ok ? 'RESULTADO   válido' : `RESULTADO   RECHAZADO (${resultado.failure})`);
  if (!resultado.ok) console.log(`MOTIVO      ${resultado.detail}`);
  console.log(`MENSAJE     ${resultado.message}`);
  console.log(`LONGITUD    ${resultado.message.length} / ${MAX_MESSAGE_LENGTH} caracteres`);

  if (resultado.usage) {
    const u = resultado.usage;
    linea();
    console.log(`TOKENS      ${u.inputTokens} entrada · ${u.outputTokens} salida · ${u.cacheReadTokens} de caché`);
    console.log(`COSTE       ${u.costUsd === null ? 'desconocido (modelo sin precio en la tabla)' : `$${u.costUsd.toFixed(6)}`}`);
    console.log(`LATENCIA    ${u.latencyMs} ms`);
  }

  const s = budget.summary();
  linea();
  console.log(`SESIÓN      ${s.calls} llamada(s) · $${s.spentUsd.toFixed(6)} gastado · $${s.remainingUsd.toFixed(6)} restante`);
  linea();
  console.log('Nada de esto se ha enviado a Twitch.');
}

await main();
