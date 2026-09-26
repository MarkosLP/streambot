import { randomUUID } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { DIR_BIBLIOTECA } from './biblioteca.js';
import { EFECTOS, type Efecto } from './efectos.js';

/**
 * Genera el código que Streamer.bot acepta en su botón Import, con las
 * acciones de los efectos ya montadas.
 *
 * El formato NO está documentado. Todo lo de aquí sale de exportaciones
 * reales de Streamer.bot 1.0.7 (versión de formato 24): "SBAE" seguido de un
 * JSON comprimido con gzip, todo en base64. Los números de tipo y de estado
 * se comprobaron uno a uno con muestras hechas a propósito en su pantalla.
 * Si una versión nueva de Streamer.bot cambia algo, se vuelve a exportar una
 * muestra y se ajusta aquí.
 *
 * Las acciones salen SIN disparador. El disparador apunta a una recompensa
 * por su id de Twitch, y ese id solo existe cuando la recompensa se crea;
 * se elige a mano después de importar.
 */

const CABECERA = 'SBAE';
const NINGUNO = '00000000-0000-0000-0000-000000000000';

/** Números de tipo de Streamer.bot, sacados de sus exportaciones. */
const TIPO = {
  playSound: 1,
  mensajeChat: 10,
  obsVisibilidad: 30,
  obsFiltro: 35,
  delay: 1002,
} as const;

const VISIBLE = 0;
const OCULTA = 1;
const FILTRO_ENCENDIDO = 0;
/** Lo que guardó Streamer.bot al pedirle apagar el filtro (ver la cabecera). */
const FILTRO_APAGADO = 2;

type SubAccion = Record<string, unknown>;

export interface OpcionesImportar {
  /** Escena de OBS donde está FX Pocion. */
  escena: string;
  /** Fuente de OBS que lleva los filtros FX Maldicion y FX Lag. */
  fuente: string;
  dirBiblioteca?: string;
}

/** Efectos que se saben generar enteros. */
export const IMPORTABLES = ['grito', 'pocion', 'maldicion', 'terremoto', 'lag'] as const;
export type Importable = (typeof IMPORTABLES)[number];

function receta(e: Efecto, o: Required<OpcionesImportar>): SubAccion[] {
  const sonido = (archivo: string): SubAccion => ({
    device: null,
    soundFile: join(o.dirBiblioteca, 'sonidos', archivo),
    finishBeforeContinuing: false,
    volume: 1,
    soundName: null,
    useFileNameAsName: false,
    type: TIPO.playSound,
  });
  const chat = (text: string): SubAccion => ({
    text,
    pin: false,
    pinToStreamEnd: false,
    useBot: true,
    fallback: true,
    type: TIPO.mensajeChat,
  });
  const esperar = (ms: number): SubAccion => ({ value: String(ms), maxValue: null, random: false, type: TIPO.delay });
  const visibilidad = (sourceName: string, state: number): SubAccion => ({
    sceneName: o.escena,
    sourceName,
    state,
    connectionId: NINGUNO,
    type: TIPO.obsVisibilidad,
  });
  const filtro = (filterName: string, state: number): SubAccion => ({
    sceneName: o.escena,
    sourceName: o.fuente,
    filterName,
    state,
    connectionId: NINGUNO,
    type: TIPO.obsFiltro,
  });

  switch (e.id as Importable) {
    case 'grito':
      return [sonido('grito-de-guerra.wav'), chat('%user% lanza un grito de guerra ⚔️')];
    case 'pocion':
      return [sonido('pocion.wav'), visibilidad('FX Pocion', VISIBLE), esperar(5000), visibilidad('FX Pocion', OCULTA)];
    case 'maldicion':
      return [
        sonido('maldicion.wav'),
        filtro('FX Maldicion', FILTRO_ENCENDIDO),
        chat('%user% ha maldecido al streamer 💀'),
        esperar(10000),
        filtro('FX Maldicion', FILTRO_APAGADO),
      ];
    case 'terremoto':
      // El temblor lo hace el bot al ver el canje (interactions/terremoto.ts).
      return [sonido('terremoto.wav'), chat('%user% hace temblar la tierra 🌋')];
    case 'lag':
      return [sonido('lag.wav'), filtro('FX Lag', FILTRO_ENCENDIDO), esperar(5000), filtro('FX Lag', FILTRO_APAGADO)];
    default:
      throw new Error(`no sé generar el efecto ${e.id}`);
  }
}

function accion(e: Efecto, o: Required<OpcionesImportar>) {
  return {
    id: randomUUID(),
    queue: NINGUNO,
    enabled: true,
    excludeFromHistory: false,
    excludeFromPending: false,
    // Con guion normal, como la escribirías tú. El panel la reconoce igual.
    name: e.accion.replace('—', '-'),
    group: 'Efectos',
    alwaysRun: false,
    randomAction: false,
    concurrent: false,
    triggers: [],
    subActions: receta(e, o).map((s, index) => ({
      ...s,
      id: randomUUID(),
      weight: 0,
      parentId: null,
      enabled: true,
      index,
    })),
    collapsedGroups: [],
  };
}

export function exportacion(ids: Importable[], opciones: OpcionesImportar) {
  const o = { dirBiblioteca: DIR_BIBLIOTECA, ...opciones };
  const efectos = ids.map((id) => {
    const e = EFECTOS.find((x) => x.id === id);
    if (!e || !IMPORTABLES.includes(id)) throw new Error(`efecto no importable: ${id}`);
    return e;
  });
  return {
    meta: {
      name: 'Efectos Crid4m',
      author: 'Crid4m',
      version: '1.0.0',
      description: `Generado por el panel: ${efectos.map((e) => e.recompensa).join(', ')}. Falta elegir el disparador de cada una.`,
      autoRunAction: null,
      minimumVersion: null,
    },
    data: {
      actions: efectos.map((e) => accion(e, o)),
      queues: [],
      commands: [],
      websocketServers: [],
      websocketClients: [],
      timers: [],
    },
    version: 24,
    exportedFrom: '1.0.7',
    minimumVersion: '1.0.0-alpha.1',
  };
}

export function codificar(datos: unknown): string {
  const json = Buffer.from(JSON.stringify(datos), 'utf8');
  return Buffer.concat([Buffer.from(CABECERA, 'ascii'), gzipSync(json)]).toString('base64');
}

export function descodificar(codigo: string): any {
  const bytes = Buffer.from(codigo.trim(), 'base64');
  if (bytes.subarray(0, 4).toString('ascii') !== CABECERA) throw new Error('no es un código de Streamer.bot');
  return JSON.parse(gunzipSync(bytes.subarray(4)).toString('utf8'));
}

export function codigoImportacion(ids: Importable[], opciones: OpcionesImportar): string {
  return codificar(exportacion(ids, opciones));
}
