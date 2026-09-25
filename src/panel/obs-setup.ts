import { join } from 'node:path';
import { ErrorObs, type PedirObs } from '../transport/obs.js';
import { DIR_BIBLIOTECA } from './biblioteca.js';
import { config } from '../config.js';

/**
 * Prepara en OBS lo que necesitan los efectos, para que no haya que hacerlo
 * a mano: la fuente del overlay de la poción y los filtros de maldición y lag.
 *
 * Todo se crea OCULTO o DESACTIVADO. Crear algo visible en mitad de un
 * directo sería lanzar el efecto sin que nadie lo haya canjeado.
 *
 * Si ya existe, se actualiza en vez de duplicarse: se puede pulsar el botón
 * tantas veces como se quiera.
 */

/** Lo que el panel puede preparar, y el nombre que tendrá en OBS. */
export const PREPARABLES = {
  pocion: { nombre: 'FX Pocion', tipo: 'fuente', donde: 'escena' },
  maldicion: { nombre: 'FX Maldicion', tipo: 'filtro', donde: 'fuente' },
  lag: { nombre: 'FX Lag', tipo: 'filtro', donde: 'fuente', plugin: 'Freeze Filter' },
  legendario: { nombre: 'FX Legendario', tipo: 'fuente', donde: 'escena' },
} as const;

/**
 * El banner del Loot Legendario lo sirve el panel y no un archivo local:
 * así el bot puede pasarle en la dirección quién ha ganado qué. Un archivo
 * local de OBS no admite parámetros.
 */
export const urlLegendario = (params = '') =>
  `http://127.0.0.1:${config.panel.port}/biblioteca/overlays/legendario.html${params}`;

export type Preparable = keyof typeof PREPARABLES;

const KIND_COLOR = 'color_filter_v2';
const KIND_FREEZE = 'freeze_filter';
const YA_EXISTE = 601;

export interface EstadoObs {
  escenas: string[];
  escenaActual: string | null;
  /** Fuentes de vídeo que pueden ser "el juego". */
  fuentes: { nombre: string; tipo: string }[];
  /** Qué hay ya creado. Los filtros solo se saben si se indica la fuente. */
  existe: Record<Preparable, boolean | null>;
  /** null = OBS no deja preguntarlo (versiones antiguas del WebSocket). */
  pluginFreeze: boolean | null;
}

/** Las fuentes que tiene sentido proponer como "la del juego". */
const TIPOS_JUEGO = ['game_capture', 'window_capture', 'monitor_capture', 'dshow_input', 'ffmpeg_source', 'av_capture_input', 'screen_capture', 'xcomposite_input', 'pipewire'];
const pareceJuego = (tipo: string) => TIPOS_JUEGO.some((t) => tipo.startsWith(t));

export async function estado(pedir: PedirObs, fuenteJuego?: string): Promise<EstadoObs> {
  const escenas = await pedir<{ scenes: { sceneName: string }[]; currentProgramSceneName: string }>('GetSceneList');
  const entradas = await pedir<{ inputs: { inputName: string; inputKind: string }[] }>('GetInputList');

  let pluginFreeze: boolean | null = null;
  try {
    const kinds = await pedir<{ sourceFilterKinds: string[] }>('GetSourceFilterKindList');
    pluginFreeze = kinds.sourceFilterKinds.includes(KIND_FREEZE);
  } catch {
    // obs-websocket < 5.4 no tiene esta petición.
  }

  let filtros: string[] | null = null;
  if (fuenteJuego) {
    try {
      const r = await pedir<{ filters: { filterName: string }[] }>('GetSourceFilterList', { sourceName: fuenteJuego });
      filtros = r.filters.map((f) => f.filterName);
    } catch {
      filtros = null;
    }
  }

  return {
    // OBS las da de abajo arriba; en su interfaz se ven al revés.
    escenas: escenas.scenes.map((s) => s.sceneName).reverse(),
    escenaActual: escenas.currentProgramSceneName ?? null,
    fuentes: entradas.inputs
      .filter((i) => pareceJuego(i.inputKind))
      .map((i) => ({ nombre: i.inputName, tipo: i.inputKind })),
    existe: {
      pocion: entradas.inputs.some((i) => i.inputName === PREPARABLES.pocion.nombre),
      legendario: entradas.inputs.some((i) => i.inputName === PREPARABLES.legendario.nombre),
      maldicion: filtros ? filtros.includes(PREPARABLES.maldicion.nombre) : null,
      lag: filtros ? filtros.includes(PREPARABLES.lag.nombre) : null,
    },
    pluginFreeze,
  };
}

export interface Resultado {
  efecto: Preparable;
  ok: boolean;
  mensaje: string;
}

export async function preparar(
  pedir: PedirObs,
  { escena, fuente, efectos }: { escena?: string; fuente?: string; efectos: Preparable[] },
  dirBiblioteca = DIR_BIBLIOTECA,
): Promise<Resultado[]> {
  const resultados: Resultado[] = [];
  for (const efecto of efectos) {
    try {
      const mensaje = await prepararUno(pedir, efecto, { escena, fuente }, dirBiblioteca);
      resultados.push({ efecto, ok: true, mensaje });
    } catch (err) {
      resultados.push({ efecto, ok: false, mensaje: err instanceof Error ? err.message : String(err) });
    }
  }
  return resultados;
}

async function prepararUno(
  pedir: PedirObs,
  efecto: Preparable,
  { escena, fuente }: { escena?: string; fuente?: string },
  dirBiblioteca: string,
): Promise<string> {
  if (efecto === 'pocion' || efecto === 'legendario') {
    if (!escena) throw new ErrorObs('Elige la escena del juego.');
    const nombre = PREPARABLES[efecto].nombre;
    const comunes = {
      width: 1920,
      height: 1080,
      // "Apagar la fuente cuando no esté visible": la animación empieza de cero cada vez.
      shutdown: true,
      restart_when_active: true,
    };
    const ajustes = efecto === 'pocion'
      ? { ...comunes, is_local_file: true, local_file: join(dirBiblioteca, 'overlays', 'pocion.html') }
      // La fanfarria la toca el propio overlay: con "controlar el audio desde
      // OBS" suena en el directo como una fuente más del mezclador.
      : { ...comunes, is_local_file: false, url: urlLegendario(), reroute_audio: true };
    try {
      await pedir('CreateInput', { sceneName: escena, inputName: nombre, inputKind: 'browser_source', inputSettings: ajustes, sceneItemEnabled: false });
      return `Fuente «${nombre}» creada en «${escena}», oculta.`;
    } catch (err) {
      if (!(err instanceof ErrorObs) || err.codigo !== YA_EXISTE) throw err;
      await pedir('SetInputSettings', { inputName: nombre, inputSettings: ajustes, overlay: true });
      // Existe, pero puede que no en esta escena.
      const items = await pedir<{ sceneItems: { sourceName: string; sceneItemId: number }[] }>('GetSceneItemList', { sceneName: escena });
      const item = items.sceneItems.find((i) => i.sourceName === nombre);
      if (item) {
        await pedir('SetSceneItemEnabled', { sceneName: escena, sceneItemId: item.sceneItemId, sceneItemEnabled: false });
        return `«${nombre}» ya existía en «${escena}»: actualizada y oculta.`;
      }
      await pedir('CreateSceneItem', { sceneName: escena, sourceName: nombre, sceneItemEnabled: false });
      return `«${nombre}» ya existía: actualizada y añadida a «${escena}», oculta.`;
    }
  }

  if (!fuente) throw new ErrorObs('Elige la fuente del juego.');
  const { nombre } = PREPARABLES[efecto];
  const [kind, ajustes] = efecto === 'maldicion'
    ? [KIND_COLOR, { saturation: -1 }]
    : [KIND_FREEZE, {}];

  try {
    await pedir('CreateSourceFilter', { sourceName: fuente, filterName: nombre, filterKind: kind, filterSettings: ajustes });
  } catch (err) {
    if (err instanceof ErrorObs && err.codigo === YA_EXISTE) {
      await pedir('SetSourceFilterSettings', { sourceName: fuente, filterName: nombre, filterSettings: ajustes, overlay: true });
    } else if (efecto === 'lag' && err instanceof ErrorObs) {
      throw new ErrorObs('No se pudo crear: parece que falta el plugin Freeze Filter. Instálalo y vuelve a probar.');
    } else {
      throw err;
    }
  }
  // Recién creado, un filtro está encendido: se apaga YA, o el efecto se quedaría
  // puesto. Da tiempo a un parpadeo de milisegundos; mejor prepararlo sin emitir.
  await pedir('SetSourceFilterEnabled', { sourceName: fuente, filterName: nombre, filterEnabled: false });
  return `Filtro «${nombre}» listo en «${fuente}», apagado.`;
}

/** Dónde está una fuente: la primera escena que la contenga. */
async function buscar(pedir: PedirObs, fuente: string): Promise<{ escena: string; id: number } | null> {
  const { scenes } = await pedir<{ scenes: { sceneName: string }[] }>('GetSceneList');
  for (const { sceneName } of scenes) {
    const { sceneItems } = await pedir<{ sceneItems: { sourceName: string; sceneItemId: number }[] }>('GetSceneItemList', { sceneName });
    const item = sceneItems.find((i) => i.sourceName === fuente);
    if (item) return { escena: sceneName, id: item.sceneItemId };
  }
  return null;
}

/**
 * Enseña el banner del Loot Legendario con el nombre y el objeto, y lo
 * vuelve a esconder. Si la fuente no existe, lo dice y no hace nada más:
 * el Legendario ya se ha anunciado en el chat.
 */
export async function mostrarLegendario(
  pedir: PedirObs,
  quien: string,
  objeto: string,
  { duracionMs = 8000, esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) } = {},
): Promise<void> {
  const nombre = PREPARABLES.legendario.nombre;
  const dondeEsta = await buscar(pedir, nombre);
  if (!dondeEsta) throw new ErrorObs(`No existe la fuente «${nombre}». Créala con «Preparar en OBS».`);

  const params = `?user=${encodeURIComponent(quien)}&item=${encodeURIComponent(objeto)}`;
  await pedir('SetInputSettings', { inputName: nombre, inputSettings: { url: urlLegendario(params) }, overlay: true });
  await pedir('SetSceneItemEnabled', { sceneName: dondeEsta.escena, sceneItemId: dondeEsta.id, sceneItemEnabled: true });
  try {
    await esperar(duracionMs);
  } finally {
    await pedir('SetSceneItemEnabled', { sceneName: dondeEsta.escena, sceneItemId: dondeEsta.id, sceneItemEnabled: false });
  }
}
