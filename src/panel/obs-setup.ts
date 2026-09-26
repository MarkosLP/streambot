import { join } from 'node:path';
import { ErrorObs, type PedirObs } from '../transport/obs.js';
import { DIR_BIBLIOTECA } from './biblioteca.js';
import { config } from '../config.js';

/**
 * Prepara en OBS lo que necesitan los efectos, para que no haya que hacerlo
 * a mano: la fuente del overlay de la poción y los filtros de maldición y lag.
 *
 * Todo se crea OCULTO o DESACTIVADO. Crear algo visible en mitad de un
 * directo sería lanzar el efecto sin que nadie lo haya canjeado. La única
 * excepción es «FX Jefe»: sin jefe es transparente, y tiene que estar visible
 * para poder aparecer cuando lo invoques.
 *
 * Si ya existe, se actualiza en vez de duplicarse: se puede pulsar el botón
 * tantas veces como se quiera.
 */

/** Lo que el panel puede preparar, y el nombre que tendrá en OBS. */
export const PREPARABLES = {
  pocion: { nombre: 'FX Pocion', tipo: 'fuente', donde: 'escena' },
  maldicion: { nombre: 'FX Maldicion', tipo: 'filtro', donde: 'fuente' },
  lag: { nombre: 'FX Lag', tipo: 'filtro', donde: 'fuente', plugin: 'Freeze Filter' },
  botin: { nombre: 'FX Botin', tipo: 'fuente', donde: 'escena' },
  jefe: { nombre: 'FX Jefe', tipo: 'fuente', donde: 'escena' },
} as const;

/** La barra del jefe: la sirve el panel, porque pregunta al bot cómo va el combate. */
export const urlJefe = () => `http://127.0.0.1:${config.panel.port}/biblioteca/overlays/jefe.html`;

/**
 * El banner del Loot lo sirve el panel y no un archivo local: así el bot
 * puede pasarle en la dirección quién ha ganado qué. Un archivo local de OBS
 * no admite parámetros.
 */
export const urlBotin = (params = '') =>
  `http://127.0.0.1:${config.panel.port}/biblioteca/overlays/botin.html${params}`;

/** Nombre que tuvo la fuente cuando solo salía con los Legendarios. */
const NOMBRE_ANTIGUO_BOTIN = 'FX Legendario';

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
      botin: entradas.inputs.some((i) => i.inputName === PREPARABLES.botin.nombre || i.inputName === NOMBRE_ANTIGUO_BOTIN),
      jefe: entradas.inputs.some((i) => i.inputName === PREPARABLES.jefe.nombre),
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
  if (efecto === 'botin') await renombrarAntigua(pedir);
  if (efecto === 'pocion' || efecto === 'botin' || efecto === 'jefe') {
    if (!escena) throw new ErrorObs('Elige la escena del juego.');
    const nombre = PREPARABLES[efecto].nombre;
    const comunes = {
      width: 1920,
      height: 1080,
      // "Apagar la fuente cuando no esté visible": la animación empieza de cero cada vez.
      shutdown: true,
      restart_when_active: true,
    };
    // Sin jefe, su overlay es transparente: se queda visible siempre.
    const visible = efecto === 'jefe';
    const ajustes = efecto === 'pocion'
      ? { ...comunes, is_local_file: true, local_file: join(dirBiblioteca, 'overlays', 'pocion.html') }
      : efecto === 'jefe'
      ? { ...comunes, shutdown: false, is_local_file: false, url: urlJefe(), reroute_audio: true }
      // La fanfarria la toca el propio overlay: con "controlar el audio desde
      // OBS" suena en el directo como una fuente más del mezclador.
      : { ...comunes, is_local_file: false, url: urlBotin(), reroute_audio: true };
    try {
      const { sceneItemId } = await pedir<{ sceneItemId: number }>('CreateInput', {
        sceneName: escena, inputName: nombre, inputKind: 'browser_source', inputSettings: ajustes, sceneItemEnabled: visible,
      });
      await pantallaCompleta(pedir, escena, sceneItemId);
      return `Fuente «${nombre}» creada en «${escena}», ${visible ? 'visible (sin jefe no se ve nada)' : 'oculta'}.`;
    } catch (err) {
      if (!(err instanceof ErrorObs) || err.codigo !== YA_EXISTE) throw err;
      await pedir('SetInputSettings', { inputName: nombre, inputSettings: ajustes, overlay: true });
      // Existe, pero puede que no en esta escena.
      const items = await pedir<{ sceneItems: { sourceName: string; sceneItemId: number }[] }>('GetSceneItemList', { sceneName: escena });
      const item = items.sceneItems.find((i) => i.sourceName === nombre);
      if (item) {
        await pedir('SetSceneItemEnabled', { sceneName: escena, sceneItemId: item.sceneItemId, sceneItemEnabled: visible });
        return `«${nombre}» ya existía en «${escena}»: actualizada y ${visible ? 'visible' : 'oculta'}.`;
      }
      const { sceneItemId } = await pedir<{ sceneItemId: number }>('CreateSceneItem', { sceneName: escena, sourceName: nombre, sceneItemEnabled: visible });
      await pantallaCompleta(pedir, escena, sceneItemId);
      return `«${nombre}» ya existía: actualizada y añadida a «${escena}», ${visible ? 'visible' : 'oculta'}.`;
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

/**
 * Coloca una fuente recién creada ocupando todo el lienzo. Los overlays miden
 * 1920×1080 y colocan su contenido dentro; si la fuente queda más pequeña o
 * movida, el banner sale diminuto en una esquina.
 *
 * Solo se hace al CREARLA: si ya existía y la has movido tú, se respeta.
 */
async function pantallaCompleta(pedir: PedirObs, escena: string, sceneItemId: number): Promise<void> {
  const v = await pedir<{ baseWidth: number; baseHeight: number }>('GetVideoSettings');
  await pedir('SetSceneItemTransform', {
    sceneName: escena,
    sceneItemId,
    sceneItemTransform: { positionX: 0, positionY: 0, rotation: 0, alignment: 5, scaleX: v.baseWidth / 1920, scaleY: v.baseHeight / 1080 },
  });
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
 * La fuente se llamó «FX Legendario» mientras el banner era solo para los
 * Legendarios. Si queda una con ese nombre, se renombra: así nadie tiene que
 * volver a crearla ni recolocarla.
 */
async function renombrarAntigua(pedir: PedirObs): Promise<void> {
  const { inputs } = await pedir<{ inputs: { inputName: string }[] }>('GetInputList');
  const nueva = inputs.some((i) => i.inputName === PREPARABLES.botin.nombre);
  const vieja = inputs.some((i) => i.inputName === NOMBRE_ANTIGUO_BOTIN);
  if (vieja && !nueva) {
    await pedir('SetInputName', { inputName: NOMBRE_ANTIGUO_BOTIN, newInputName: PREPARABLES.botin.nombre });
  }
}

/** Cuánto se queda el banner en pantalla. Lo mismo mide la animación del overlay. */
export const DURACION_BANNER_MS: Record<string, number> = { comun: 5000, raro: 5000, epico: 6500, legendario: 8000 };

/**
 * Enseña el banner de un botín con quién, qué y de qué rareza, y lo vuelve a
 * esconder. Si la fuente no existe, lo dice y no hace nada más: el botín ya
 * se ha anunciado en el chat.
 */
export async function mostrarBotin(
  pedir: PedirObs,
  { quien, objeto, rareza, origen, maldito = false }: { quien: string; objeto: string; rareza: string; origen: string; maldito?: boolean },
  { esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) } = {},
): Promise<void> {
  await renombrarAntigua(pedir);
  const nombre = PREPARABLES.botin.nombre;
  const dondeEsta = await buscar(pedir, nombre);
  if (!dondeEsta) throw new ErrorObs(`No existe la fuente «${nombre}». Créala con «Preparar en OBS».`);

  const params = new URLSearchParams({ user: quien, item: objeto, rareza, origen, ...(maldito && { maldito: '1' }) }).toString().replace(/\+/g, '%20');
  await pedir('SetInputSettings', { inputName: nombre, inputSettings: { url: urlBotin(`?${params}`) }, overlay: true });
  await pedir('SetSceneItemEnabled', { sceneName: dondeEsta.escena, sceneItemId: dondeEsta.id, sceneItemEnabled: true });
  try {
    await esperar(maldito ? 6500 : (DURACION_BANNER_MS[rareza] ?? 5000));
  } finally {
    await pedir('SetSceneItemEnabled', { sceneName: dondeEsta.escena, sceneItemId: dondeEsta.id, sceneItemEnabled: false });
  }
}

// ---------------------------------------------------------------------------
// Terremoto: la fuente del juego tiembla
// ---------------------------------------------------------------------------

/**
 * Hace temblar una fuente moviéndola unos píxeles a un lado y a otro, y la
 * deja EXACTAMENTE donde estaba (26 sep 2026: con el plugin Move había que
 * encadenar varios filtros; así no hace falta ninguno).
 *
 * Tiembla en la escena que está en emisión; si la fuente no está ahí, en la
 * primera que la tenga. La vuelta a su sitio va en un finally: aunque OBS
 * falle a mitad, lo último que se intenta es colocarla bien.
 */
export async function temblar(
  pedir: PedirObs,
  { fuente, ms = 5000, amplitud = 16, paso = 40 }: { fuente: string; ms?: number; amplitud?: number; paso?: number },
  { esperar = (t: number) => new Promise<void>((r) => setTimeout(r, t)), azar = Math.random } = {},
): Promise<void> {
  const { currentProgramSceneName: enEmision } = await pedir<{ currentProgramSceneName: string }>('GetCurrentProgramScene');
  let donde: { escena: string; id: number } | null = null;
  try {
    const { sceneItemId } = await pedir<{ sceneItemId: number }>('GetSceneItemId', { sceneName: enEmision, sourceName: fuente });
    donde = { escena: enEmision, id: sceneItemId };
  } catch {
    donde = await buscar(pedir, fuente);
  }
  if (!donde) throw new ErrorObs(`No encuentro la fuente «${fuente}» en ninguna escena. Cámbiala con OBS_FUENTE_JUEGO en el .env.`);

  const { sceneItemTransform: t } = await pedir<{ sceneItemTransform: { positionX: number; positionY: number } }>(
    'GetSceneItemTransform', { sceneName: donde.escena, sceneItemId: donde.id },
  );
  const mover = (x: number, y: number) => pedir('SetSceneItemTransform', {
    sceneName: donde!.escena, sceneItemId: donde!.id, sceneItemTransform: { positionX: x, positionY: y },
  });
  try {
    for (let hecho = 0; hecho < ms; hecho += paso) {
      // Fuerte al principio y se va calmando en el último tercio.
      const fuerza = hecho < ms * 0.66 ? 1 : 1 - (hecho - ms * 0.66) / (ms * 0.34);
      const a = amplitud * fuerza;
      await mover(t.positionX + (azar() * 2 - 1) * a, t.positionY + (azar() * 2 - 1) * a);
      await esperar(paso);
    }
  } finally {
    await mover(t.positionX, t.positionY);
  }
}

// ---------------------------------------------------------------------------
// Escenas del directo: Empezamos, Charla, Pausa y Final (panel → Escenas)
// ---------------------------------------------------------------------------

export type TipoEscena = 'inicio' | 'charla' | 'pausa' | 'final';

export const ESCENAS_OBS: Record<TipoEscena, { escena: string; fuente: string }> = {
  inicio: { escena: '✦ Empezamos', fuente: 'ESC Empezamos' },
  charla: { escena: '✦ Charla', fuente: 'ESC Charla' },
  pausa: { escena: '✦ Pausa', fuente: 'ESC Pausa' },
  final: { escena: '✦ Final', fuente: 'ESC Final' },
};

/** El hueco de la cámara en el overlay de Charla, en píxeles de 1920×1080. Lo mismo que CAM en escena.html. */
export const HUECO_CAMARA = { x: 48, y: 48, ancho: 1280, alto: 720 };

export const urlEscena = (tipo: TipoEscena) =>
  `http://127.0.0.1:${config.panel.port}/biblioteca/overlays/escena.html?tipo=${tipo}`;

/** Tipos de fuente de OBS que son una cámara (Windows, Mac, Linux). */
const KINDS_CAMARA = ['dshow_input', 'av_capture_input', 'macos-avcapture', 'v4l2_input'];

/**
 * Crea (o completa) la escena de un tipo: el overlay a pantalla completa y,
 * en Charla, tu cámara en el hueco del marco y la barra del jefe encima.
 *
 * Nunca cambia la escena en emisión ni borra nada: si la escena ya existe, se
 * le añade lo que falte y lo que ya estaba no se mueve.
 */
export async function crearEscena(pedir: PedirObs, tipo: TipoEscena): Promise<string[]> {
  const { escena, fuente } = ESCENAS_OBS[tipo];
  const hecho: string[] = [];
  try {
    await pedir('CreateScene', { sceneName: escena });
    hecho.push(`Escena «${escena}» creada.`);
  } catch (err) {
    if (!(err instanceof ErrorObs) || err.codigo !== YA_EXISTE) throw err;
    hecho.push(`La escena «${escena}» ya existía: se completa sin quitar nada.`);
  }
  const items = async () =>
    (await pedir<{ sceneItems: { sourceName: string; sceneItemId: number }[] }>('GetSceneItemList', { sceneName: escena })).sceneItems;
  const { inputs } = await pedir<{ inputs: { inputName: string; inputKind: string }[] }>('GetInputList');

  // El overlay, encima de lo que haya.
  const ajustes = { width: 1920, height: 1080, is_local_file: false, url: urlEscena(tipo), shutdown: false, restart_when_active: false, reroute_audio: false };
  let overlayId: number;
  if (!inputs.some((i) => i.inputName === fuente)) {
    ({ sceneItemId: overlayId } = await pedir<{ sceneItemId: number }>('CreateInput', {
      sceneName: escena, inputName: fuente, inputKind: 'browser_source', inputSettings: ajustes, sceneItemEnabled: true,
    }));
    await pantallaCompleta(pedir, escena, overlayId);
    hecho.push(`Overlay «${fuente}» creado a pantalla completa.`);
  } else {
    await pedir('SetInputSettings', { inputName: fuente, inputSettings: ajustes, overlay: true });
    const ya = (await items()).find((i) => i.sourceName === fuente);
    if (ya) {
      overlayId = ya.sceneItemId;
      hecho.push(`Overlay «${fuente}» actualizado.`);
    } else {
      ({ sceneItemId: overlayId } = await pedir<{ sceneItemId: number }>('CreateSceneItem', { sceneName: escena, sourceName: fuente, sceneItemEnabled: true }));
      await pantallaCompleta(pedir, escena, overlayId);
      hecho.push(`Overlay «${fuente}» añadido a pantalla completa.`);
    }
  }

  if (tipo === 'charla') {
    // Tu cámara, DEBAJO del overlay y encajada en el hueco del marco.
    const cam = inputs.find((i) => KINDS_CAMARA.some((k) => i.inputKind.startsWith(k)));
    if (!cam) {
      hecho.push('No he encontrado ninguna cámara en OBS: añádela a esta escena, debajo del overlay, en el hueco del marco. O usa el avatar.');
    } else if ((await items()).some((i) => i.sourceName === cam.inputName)) {
      hecho.push(`Tu cámara «${cam.inputName}» ya estaba en la escena: no la he movido.`);
    } else {
      const { sceneItemId } = await pedir<{ sceneItemId: number }>('CreateSceneItem', { sceneName: escena, sourceName: cam.inputName, sceneItemEnabled: true });
      await pedir('SetSceneItemIndex', { sceneName: escena, sceneItemId, sceneItemIndex: 0 });
      await encajarEnHueco(pedir, escena, sceneItemId);
      hecho.push(`Tu cámara «${cam.inputName}» colocada en el hueco del marco.`);
    }
    // La barra del jefe también aquí: sin jefe es transparente.
    const barra = PREPARABLES.jefe.nombre;
    if (inputs.some((i) => i.inputName === barra) && !(await items()).some((i) => i.sourceName === barra)) {
      const { sceneItemId } = await pedir<{ sceneItemId: number }>('CreateSceneItem', { sceneName: escena, sourceName: barra, sceneItemEnabled: true });
      await pantallaCompleta(pedir, escena, sceneItemId);
      hecho.push('Barra del jefe añadida encima: si aparece un jefe, se verá también aquí.');
    }
  }
  return hecho;
}

/** Coloca la cámara en el hueco del marco, llenándolo (lo que sobre se recorta). */
async function encajarEnHueco(pedir: PedirObs, escena: string, sceneItemId: number): Promise<void> {
  const v = await pedir<{ baseWidth: number; baseHeight: number }>('GetVideoSettings');
  const sx = v.baseWidth / 1920;
  const sy = v.baseHeight / 1080;
  const { x, y, ancho, alto } = HUECO_CAMARA;
  await pedir('SetSceneItemTransform', {
    sceneName: escena,
    sceneItemId,
    sceneItemTransform: {
      positionX: x * sx, positionY: y * sy, alignment: 5, rotation: 0,
      boundsType: 'OBS_BOUNDS_SCALE_OUTER', boundsAlignment: 0, boundsWidth: ancho * sx, boundsHeight: alto * sy, cropToBounds: true,
    },
  });
}

/** El avatar suelto (sin marco ni fondo), para ponerlo en cualquier escena. */
export const FUENTE_AVATAR = 'ESC Avatar';
export const urlAvatar = () => `http://127.0.0.1:${config.panel.port}/biblioteca/overlays/avatar.html`;

/**
 * Añade el avatar a una escena (la del juego, por ejemplo), abajo a la
 * derecha y a 400×400. Queda VISIBLE en OBS, pero la página es transparente
 * mientras el avatar esté apagado en el panel: se enciende desde allí.
 * Si ya estaba en esa escena, no se mueve.
 */
export async function anadirAvatar(pedir: PedirObs, escena: string): Promise<string> {
  const ajustes = { width: 800, height: 800, is_local_file: false, url: urlAvatar(), shutdown: false, restart_when_active: false, reroute_audio: false };
  const { inputs } = await pedir<{ inputs: { inputName: string }[] }>('GetInputList');
  let sceneItemId: number;
  if (!inputs.some((i) => i.inputName === FUENTE_AVATAR)) {
    ({ sceneItemId } = await pedir<{ sceneItemId: number }>('CreateInput', {
      sceneName: escena, inputName: FUENTE_AVATAR, inputKind: 'browser_source', inputSettings: ajustes, sceneItemEnabled: true,
    }));
  } else {
    await pedir('SetInputSettings', { inputName: FUENTE_AVATAR, inputSettings: ajustes, overlay: true });
    const { sceneItems } = await pedir<{ sceneItems: { sourceName: string; sceneItemId: number }[] }>('GetSceneItemList', { sceneName: escena });
    if (sceneItems.some((i) => i.sourceName === FUENTE_AVATAR)) return `El avatar ya estaba en «${escena}»: no lo he movido.`;
    ({ sceneItemId } = await pedir<{ sceneItemId: number }>('CreateSceneItem', { sceneName: escena, sourceName: FUENTE_AVATAR, sceneItemEnabled: true }));
  }
  const v = await pedir<{ baseWidth: number; baseHeight: number }>('GetVideoSettings');
  const sx = v.baseWidth / 1920;
  const sy = v.baseHeight / 1080;
  await pedir('SetSceneItemTransform', {
    sceneName: escena,
    sceneItemId,
    sceneItemTransform: { positionX: (1920 - 440) * sx, positionY: (1080 - 420) * sy, alignment: 5, rotation: 0, scaleX: .5 * sx, scaleY: .5 * sy },
  });
  return `Avatar añadido a «${escena}», abajo a la derecha. Muévelo y cámbialo de tamaño como quieras en OBS.`;
}
