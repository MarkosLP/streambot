import { config } from '../config.js';
import * as ajustes from '../core/ajustes.js';
import * as killswitch from '../core/killswitch.js';
import * as policy from '../core/policy.js';
import * as streams from '../data/streams.js';
import type { PedirObs } from '../transport/obs.js';
import type { EstadoConexion } from '../transport/streamerbot.js';
import * as eventos from '../interactions/loot/eventos.js';
import * as obsSetup from './obs-setup.js';

/**
 * La revisión de antes de empezar (27 sep 2026): un botón en Inicio que mira
 * todo lo que suele fallar justo al darle a «Iniciar transmisión» y dice qué
 * está bien y qué no.
 *
 * SOLO LEE. No crea ni cambia nada en OBS ni en Streamer.bot: puede que ya
 * estés en directo cuando lo pulses.
 */

export type Nivel = 'ok' | 'aviso' | 'fallo';

export interface Comprobacion {
  grupo: string;
  nombre: string;
  nivel: Nivel;
  detalle: string;
}

export interface Dependencias {
  streamerbot: () => EstadoConexion;
  /** Los efectos del catálogo y si su Action está montada (null = sin Streamer.bot). */
  efectos: () => Promise<Array<{ nombre: string; montado: boolean | null }> | null>;
  obs: <T>(trabajo: (pedir: PedirObs) => Promise<T>) => Promise<T>;
  iaLocal: () => Promise<{ disponible: boolean; modelo: string; motivo?: string }>;
}

const lista = (xs: string[]) => (xs.length <= 3 ? xs.join(', ') : `${xs.slice(0, 3).join(', ')} y ${xs.length - 3} más`);

export async function revisar(d: Dependencias): Promise<Comprobacion[]> {
  const r: Comprobacion[] = [];
  const poner = (grupo: string, nombre: string, nivel: Nivel, detalle: string) => r.push({ grupo, nombre, nivel, detalle });

  // --- El bot -------------------------------------------------------------
  poner('Bot', 'Interruptor', killswitch.isEnabled() ? 'ok' : 'fallo',
    killswitch.isEnabled() ? 'Encendido' : 'Apagado: el bot no escribirá nada. Enciéndelo arriba a la derecha.');
  if (config.dryRun) poner('Bot', 'Chat', 'aviso', 'DRY_RUN activo: el bot hace como que escribe, pero no sale nada al chat.');
  if (ajustes.modoRevision()) poner('Bot', 'Modo revisión', 'aviso', 'Lo que escriba la IA espera a que lo apruebes en Inicio.');
  const resp = policy.remainingRespuestas();
  poner('Bot', 'Mensajes disponibles', resp > 20 ? 'ok' : 'aviso', `${resp} respuestas y ${policy.remainingBudget()} espontáneos en esta hora`);

  // --- Streamer.bot -------------------------------------------------------
  const sb = d.streamerbot();
  poner('Streamer.bot', 'Conexión', sb.conectado ? 'ok' : 'fallo',
    sb.conectado ? (sb.version ?? 'Conectado') : `Sin conexión con ${sb.destino}: sin ella no llega el chat ni se lanzan efectos. ¿Está abierto Streamer.bot con el WebSocket activo?`);
  if (sb.conectado) {
    const efectos = await d.efectos().catch(() => null);
    if (efectos) {
      const faltan = efectos.filter((e) => e.montado === false).map((e) => e.nombre);
      poner('Streamer.bot', 'Efectos', faltan.length ? 'aviso' : 'ok',
        faltan.length ? `Sin su Action: ${lista(faltan)} (pestaña Efectos → Importar)` : `Los ${efectos.length} efectos tienen su Action`);
    }
  }

  // --- OBS ----------------------------------------------------------------
  try {
    const { estado, emision } = await d.obs(async (pedir) => ({
      estado: await obsSetup.estado(pedir, config.obs.fuenteJuego),
      emision: await pedir<{ outputActive: boolean }>('GetStreamStatus').catch(() => null),
    }));
    poner('OBS', 'Conexión', 'ok', `Escena actual: ${estado.escenaActual ?? '—'}${emision?.outputActive ? ' · 🔴 emitiendo' : ''}`);

    const fuenteExiste = estado.fuentes.some((f) => f.nombre === config.obs.fuenteJuego);
    poner('OBS', 'Fuente del juego', fuenteExiste ? 'ok' : 'aviso',
      fuenteExiste ? config.obs.fuenteJuego : `No hay ninguna fuente «${config.obs.fuenteJuego}» (OBS_FUENTE_JUEGO): el Terremoto, la Maldición y el Lag no tendrán dónde actuar.`);

    const nombres: Record<obsSetup.Preparable, string> = { botin: 'Banner del botín', jefe: 'Barra del jefe', pocion: 'Poción', maldicion: 'Filtro Maldición', lag: 'Filtro Lag' };
    const faltan = (Object.keys(nombres) as obsSetup.Preparable[]).filter((k) => estado.existe[k] === false).map((k) => nombres[k]);
    poner('OBS', 'Fuentes de efectos', faltan.length ? 'aviso' : 'ok',
      faltan.length ? `Faltan: ${faltan.join(', ')} (Efectos → Preparar OBS)` : 'Banner, jefe, poción y filtros, todo en su sitio');
    if (estado.pluginFreeze === false) poner('OBS', 'Plugin Freeze', 'aviso', 'Sin el plugin Freeze Filter el Lag no congela la imagen.');
  } catch (err) {
    poner('OBS', 'Conexión', 'fallo', `OBS no contesta (${err instanceof Error ? err.message : String(err)}). Sin él no hay banners, barra del jefe ni temblor.`);
  }

  // --- Loot ---------------------------------------------------------------
  poner('Loot', 'Cofres', ajustes.lootActivo() ? 'ok' : 'aviso', ajustes.lootActivo() ? 'Activos' : 'El Loot está apagado: no caerán cofres.');
  const e = eventos.actual();
  poner('Loot', 'Evento de la semana', 'ok', e ? `${e.emoji} ${e.nombre}` : 'Ninguno esta semana');
  const directo = streams.current();
  poner('Loot', 'Directo', 'ok', directo ? `Marcado desde ${new Date(directo.started_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}` : 'Se marca solo en cuanto OBS empiece a emitir');

  // --- IA local (solo para Títulos) ---------------------------------------
  const ia = await d.iaLocal().catch(() => null);
  poner('Extras', 'IA local (Títulos)', ia?.disponible ? 'ok' : 'aviso',
    ia?.disponible ? ia.modelo : `No disponible: solo afecta a la pestaña Títulos. ${ia?.motivo ?? ''}`.trim());

  return r;
}
