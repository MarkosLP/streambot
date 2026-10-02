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
      ...FPS,
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
 * La fuente en la escena que se está emitiendo; si no está ahí, en la primera
 * que la tenga. El 27 sep «FX Botin» estaba en las cinco escenas y se
 * encendía en «✦ Pausa» (la primera) mientras se emitía «Principal»: los
 * cofres salían en el chat y no en pantalla.
 */
async function enEmision(pedir: PedirObs, fuente: string): Promise<{ escena: string; id: number } | null> {
  try {
    const { currentProgramSceneName: escena } = await pedir<{ currentProgramSceneName: string }>('GetCurrentProgramScene');
    const { sceneItemId } = await pedir<{ sceneItemId: number }>('GetSceneItemId', { sceneName: escena, sourceName: fuente });
    if (typeof sceneItemId === 'number') return { escena, id: sceneItemId };
  } catch {
    // No está en la que se emite (o OBS no lo sabe): la primera que la tenga.
  }
  return buscar(pedir, fuente);
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
  const dondeEsta = await enEmision(pedir, nombre);
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
  const donde = await enEmision(pedir, fuente);
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

/**
 * Nuestras fuentes de navegador van a 30 fotogramas por segundo: para un
 * overlay sobra, y OBS dibuja la mitad (por defecto van a los de OBS, 60).
 */
export const FPS = { fps_custom: true, fps: 30 } as const;

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
  // Apagada mientras su escena no está en pantalla: así no gasta mientras juegas. Al volver, carga en un momento.
  const ajustes = { width: 1920, height: 1080, ...FPS, is_local_file: false, url: urlEscena(tipo), shutdown: true, restart_when_active: false, reroute_audio: false };
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

/**
 * Charla con la cámara a pantalla completa y tu captura a la derecha.
 * La captura no se copia: va dentro de una escena auxiliar («capa») y el
 * filtro de opacidad se pone a esa escena. Así, si cambias de ventana en la
 * captura original, aquí se ve lo mismo, y la original no lleva filtros nuevos.
 */
export const ESCENA_COMPARTIDA = { escena: '✦ Charla + compartir', fuente: 'ESC Charla compartir', capa: 'ESC Compartir (capa)' } as const;
/** La copia que se hacía antes (2 oct 2026); si queda, se retira. */
const COPIA_ANTIGUA = 'ESC Compartir contenido';
export const urlCharlaCompartida = () =>
  `http://127.0.0.1:${config.panel.port}/biblioteca/overlays/charla-compartida.html`;
export const HUECO_COMPARTIDO = { x: 1010, y: 150, ancho: 850, alto: 478 };
const KINDS_COMPARTIR = ['monitor_capture', 'window_capture', 'game_capture', 'screen_capture', 'xcomposite_input', 'pipewire'];
const FILTRO_COMPARTIR = 'ESC Transparencia de compartir';

export async function crearCharlaCompartida(pedir: PedirObs, origen?: string, opacidad = 1): Promise<string[]> {
  const { escena, fuente, capa } = ESCENA_COMPARTIDA;
  const { inputs } = await pedir<{ inputs: { inputName: string; inputKind: string }[] }>('GetInputList');
  if (origen === COPIA_ANTIGUA || origen === fuente) throw new ErrorObs('Elige la captura original, no una fuente de esta escena.');
  const origenInput = origen ? inputs.find((i) => i.inputName === origen && KINDS_COMPARTIR.some((k) => i.inputKind.startsWith(k))) : null;
  if (origen && !origenInput) throw new ErrorObs('Elige una captura de pantalla, ventana o juego que exista en OBS.');

  const hecho: string[] = [];
  const crearEscenaSiFalta = async (nombre: string) => {
    try {
      await pedir('CreateScene', { sceneName: nombre });
      return true;
    } catch (err) {
      if (!(err instanceof ErrorObs) || err.codigo !== YA_EXISTE) throw err;
      return false;
    }
  };
  hecho.push(await crearEscenaSiFalta(escena) ? `Escena «${escena}» creada.` : `La escena «${escena}» ya existía: se completa sin mover tus fuentes.`);
  const itemsDe = async (nombre: string) => (await pedir<{ sceneItems: { sourceName: string; sceneItemId: number }[] }>('GetSceneItemList', { sceneName: nombre })).sceneItems;
  const items = () => itemsDe(escena);
  const ajustes = { width: 1920, height: 1080, ...FPS, is_local_file: false, url: urlCharlaCompartida(), shutdown: true, restart_when_active: false, reroute_audio: false };
  let overlayId = (await items()).find((i) => i.sourceName === fuente)?.sceneItemId;
  if (inputs.some((i) => i.inputName === fuente)) {
    await pedir('SetInputSettings', { inputName: fuente, inputSettings: ajustes, overlay: true });
    if (overlayId === undefined) ({ sceneItemId: overlayId } = await pedir<{ sceneItemId: number }>('CreateSceneItem', { sceneName: escena, sourceName: fuente, sceneItemEnabled: true }));
  } else {
    ({ sceneItemId: overlayId } = await pedir<{ sceneItemId: number }>('CreateInput', { sceneName: escena, inputName: fuente, inputKind: 'browser_source', inputSettings: ajustes, sceneItemEnabled: true }));
  }
  await pantallaCompleta(pedir, escena, overlayId);
  hecho.push('Rótulos y marco añadidos.');

  const cam = inputs.find((i) => KINDS_CAMARA.some((k) => i.inputKind.startsWith(k)));
  if (!cam) hecho.push('No encuentro una webcam en OBS: añádela a pantalla completa, debajo de las demás fuentes.');
  else if ((await items()).some((i) => i.sourceName === cam.inputName)) hecho.push(`Webcam «${cam.inputName}» ya presente: conservo su posición.`);
  else {
    const { sceneItemId } = await pedir<{ sceneItemId: number }>('CreateSceneItem', { sceneName: escena, sourceName: cam.inputName, sceneItemEnabled: true });
    await pedir('SetSceneItemIndex', { sceneName: escena, sceneItemId, sceneItemIndex: 0 });
    const { baseWidth, baseHeight } = await pedir<{ baseWidth: number; baseHeight: number }>('GetVideoSettings');
    await pedir('SetSceneItemTransform', { sceneName: escena, sceneItemId, sceneItemTransform: {
      positionX: 0, positionY: 0, alignment: 5, rotation: 0,
      boundsType: 'OBS_BOUNDS_SCALE_OUTER', boundsAlignment: 0, boundsWidth: baseWidth, boundsHeight: baseHeight, cropToBounds: true,
    } });
    hecho.push(`Webcam «${cam.inputName}» a pantalla completa.`);
  }

  // La copia de antes la creaba este panel y no la usa nada más: fuera, para no capturar dos veces.
  if (inputs.some((i) => i.inputName === COPIA_ANTIGUA)) {
    await pedir('RemoveInput', { inputName: COPIA_ANTIGUA });
    hecho.push(`Quitada la copia antigua «${COPIA_ANTIGUA}»: ahora se usa tu captura original.`);
  }

  if (!origenInput) hecho.push('Selecciona una captura de OBS para mostrarla a la derecha.');
  else {
    const { baseWidth, baseHeight } = await pedir<{ baseWidth: number; baseHeight: number }>('GetVideoSettings');
    // En la capa solo va la captura elegida, llenando el lienzo.
    await crearEscenaSiFalta(capa);
    let idEnCapa: number | undefined;
    for (const i of await itemsDe(capa)) {
      if (i.sourceName === origenInput.inputName && idEnCapa === undefined) idEnCapa = i.sceneItemId;
      else await pedir('RemoveSceneItem', { sceneName: capa, sceneItemId: i.sceneItemId });
    }
    if (idEnCapa === undefined) ({ sceneItemId: idEnCapa } = await pedir<{ sceneItemId: number }>('CreateSceneItem', { sceneName: capa, sourceName: origenInput.inputName, sceneItemEnabled: true }));
    await pedir('SetSceneItemTransform', { sceneName: capa, sceneItemId: idEnCapa, sceneItemTransform: {
      positionX: 0, positionY: 0, alignment: 5, rotation: 0,
      boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsAlignment: 0, boundsWidth: baseWidth, boundsHeight: baseHeight,
    } });
    const { filters } = await pedir<{ filters: { filterName: string }[] }>('GetSourceFilterList', { sourceName: capa });
    if (filters.some((f) => f.filterName === FILTRO_COMPARTIR)) {
      await pedir('SetSourceFilterSettings', { sourceName: capa, filterName: FILTRO_COMPARTIR, filterSettings: { opacity: opacidad }, overlay: true });
    } else if (opacidad < 1) {
      await pedir('CreateSourceFilter', { sourceName: capa, filterName: FILTRO_COMPARTIR, filterKind: KIND_COLOR, filterSettings: { opacity: opacidad } });
    }

    let id = (await items()).find((i) => i.sourceName === capa)?.sceneItemId;
    if (id === undefined) ({ sceneItemId: id } = await pedir<{ sceneItemId: number }>('CreateSceneItem', { sceneName: escena, sourceName: capa, sceneItemEnabled: true }));
    const sx = baseWidth / 1920, sy = baseHeight / 1080;
    const r = HUECO_COMPARTIDO;
    await pedir('SetSceneItemTransform', { sceneName: escena, sceneItemId: id, sceneItemTransform: {
      positionX: r.x * sx, positionY: r.y * sy, alignment: 5, rotation: 0,
      boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsAlignment: 0, boundsWidth: r.ancho * sx, boundsHeight: r.alto * sy,
    } });
    await pedir('SetSceneItemIndex', { sceneName: escena, sceneItemId: id, sceneItemIndex: cam ? 1 : 0 });
    hecho.push(opacidad < 1
      ? `«${origenInput.inputName}» a la derecha con ${Math.round(opacidad * 100)} % de opacidad. Sigue a tu captura original.`
      : `«${origenInput.inputName}» a la derecha, opaca. Sigue a tu captura original.`);
  }
  await pedir('SetSceneItemIndex', { sceneName: escena, sceneItemId: overlayId, sceneItemIndex: (await items()).length - 1 });
  return hecho;
}

/**
 * El Linde del Velo (interactions/mmo): la escena para cuando Crid4m está
 * ausente. Solo el overlay del mundo a pantalla completa y, si ya existen, las
 * alertas encima. La música no se añade sola: se marca la escena en Música.
 */
export const ESCENA_MUNDO = { escena: '✦ El Linde del Velo', fuente: 'ESC Linde del Velo' } as const;
export const urlMundo = () => `http://127.0.0.1:${config.panel.port}/biblioteca/overlays/mmo.html`;

/** Crea o completa la escena del mundo. Nunca cambia la escena en emisión ni mueve lo que ya había. */
export async function crearEscenaMundo(pedir: PedirObs): Promise<string[]> {
  const { escena, fuente } = ESCENA_MUNDO;
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
  const { inputs } = await pedir<{ inputs: { inputName: string }[] }>('GetInputList');

  // Apagada mientras la escena no está en pantalla: no gasta mientras juegas.
  const ajustes = { width: 1920, height: 1080, ...FPS, is_local_file: false, url: urlMundo(), shutdown: true, restart_when_active: false, reroute_audio: false };
  if (!inputs.some((i) => i.inputName === fuente)) {
    const { sceneItemId } = await pedir<{ sceneItemId: number }>('CreateInput', {
      sceneName: escena, inputName: fuente, inputKind: 'browser_source', inputSettings: ajustes, sceneItemEnabled: true,
    });
    await pantallaCompleta(pedir, escena, sceneItemId);
    hecho.push(`Overlay «${fuente}» creado a pantalla completa.`);
  } else {
    await pedir('SetInputSettings', { inputName: fuente, inputSettings: ajustes, overlay: true });
    if ((await items()).some((i) => i.sourceName === fuente)) hecho.push(`Overlay «${fuente}» actualizado; conserva su posición.`);
    else {
      const { sceneItemId } = await pedir<{ sceneItemId: number }>('CreateSceneItem', { sceneName: escena, sourceName: fuente, sceneItemEnabled: true });
      await pantallaCompleta(pedir, escena, sceneItemId);
      hecho.push(`Overlay «${fuente}» añadido a pantalla completa.`);
    }
  }

  // Subs, bits y raids también se ven mientras estás ausente.
  const alertas = OVERLAYS_DIRECTO.alertas.fuente;
  if (inputs.some((i) => i.inputName === alertas) && !(await items()).some((i) => i.sourceName === alertas)) {
    const { sceneItemId } = await pedir<{ sceneItemId: number }>('CreateSceneItem', { sceneName: escena, sourceName: alertas, sceneItemEnabled: true });
    await pantallaCompleta(pedir, escena, sceneItemId);
    hecho.push(`Alertas «${alertas}» añadidas encima.`);
  }
  hecho.push('No cambia la escena que emites. Para que suene música aquí, márcala en Música.');
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
  const ajustes = { width: 800, height: 800, ...FPS, is_local_file: false, url: urlAvatar(), shutdown: false, restart_when_active: false, reroute_audio: false };
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

// ---------------------------------------------------------------------------
// Música (core/musica.ts)
// ---------------------------------------------------------------------------

export const FUENTE_MUSICA = 'MUS Música';
export const urlMusica = () => `http://127.0.0.1:${config.panel.port}/biblioteca/overlays/musica.html`;

/**
 * La fuente de la música en las escenas que elijas. Es UNA sola fuente
 * compartida: al cambiar de escena la canción sigue, no vuelve a empezar.
 * Su audio va por OBS (sale en el mezclador como «MUS Música») y también a
 * tus cascos (monitorizar y enviar), para que oigas lo mismo que el directo.
 * Solo añade: donde ya está, no se toca.
 */
export async function anadirMusica(pedir: PedirObs, escenas: string[]): Promise<string[]> {
  const ajustes = { width: 1920, height: 1080, ...FPS, is_local_file: false, url: urlMusica(), shutdown: false, restart_when_active: false, reroute_audio: true };
  const hecho: string[] = [];
  const { inputs } = await pedir<{ inputs: { inputName: string }[] }>('GetInputList');
  let existe = inputs.some((i) => i.inputName === FUENTE_MUSICA);
  if (existe) await pedir('SetInputSettings', { inputName: FUENTE_MUSICA, inputSettings: ajustes, overlay: true });
  for (const escena of escenas) {
    const { sceneItems } = await pedir<{ sceneItems: { sourceName: string }[] }>('GetSceneItemList', { sceneName: escena });
    if (sceneItems.some((i) => i.sourceName === FUENTE_MUSICA)) {
      hecho.push(`«${escena}»: ya tenía la música.`);
      continue;
    }
    let sceneItemId: number;
    if (!existe) {
      ({ sceneItemId } = await pedir<{ sceneItemId: number }>('CreateInput', {
        sceneName: escena, inputName: FUENTE_MUSICA, inputKind: 'browser_source', inputSettings: ajustes, sceneItemEnabled: true,
      }));
      existe = true;
      await pedir('SetInputAudioMonitorType', { inputName: FUENTE_MUSICA, monitorType: 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT' }).catch(() => {});
      hecho.push(`Fuente «${FUENTE_MUSICA}» creada: su volumen está en el mezclador de OBS.`);
    } else {
      ({ sceneItemId } = await pedir<{ sceneItemId: number }>('CreateSceneItem', { sceneName: escena, sourceName: FUENTE_MUSICA, sceneItemEnabled: true }));
    }
    await pantallaCompleta(pedir, escena, sceneItemId);
    hecho.push(`«${escena}»: música añadida.`);
  }
  return hecho;
}

// ---------------------------------------------------------------------------
// Alertas y panel rotativo (core/alertas.ts)
// ---------------------------------------------------------------------------

export const OVERLAYS_DIRECTO = {
  alertas: { fuente: 'OVL Alertas', archivo: 'alertas.html', ancho: 1920, alto: 1080 },
  // Del tamaño justo de la caja: se coloca donde quieras arrastrándola en OBS.
  panel: { fuente: 'OVL Panel', archivo: 'panel.html', ancho: 480, alto: 140 },
} as const;
export type OverlayDirecto = keyof typeof OVERLAYS_DIRECTO;
export const urlOverlay = (cual: OverlayDirecto) => `http://127.0.0.1:${config.panel.port}/biblioteca/overlays/${OVERLAYS_DIRECTO[cual].archivo}`;

/**
 * Añade las alertas (a pantalla completa, encima de todo) o el panel rotativo
 * (arriba a la izquierda, a su tamaño) a una escena. Una sola fuente de cada:
 * si ya existe en otra escena, se reutiliza. Donde ya está, no se toca.
 */
export async function anadirOverlay(pedir: PedirObs, cual: OverlayDirecto, escena: string): Promise<string> {
  const o = OVERLAYS_DIRECTO[cual];
  const ajustes = { width: o.ancho, height: o.alto, ...FPS, is_local_file: false, url: urlOverlay(cual), shutdown: false, restart_when_active: false, reroute_audio: cual === 'alertas' };
  const { inputs } = await pedir<{ inputs: { inputName: string }[] }>('GetInputList');
  const { sceneItems } = await pedir<{ sceneItems: { sourceName: string }[] }>('GetSceneItemList', { sceneName: escena });
  // Una fuente existente puede conservar una URL antigua con ?demo=1.
  // Actualizarla también cuando ya está en la escena, sin moverla.
  if (sceneItems.some((i) => i.sourceName === o.fuente)) {
    await pedir('SetInputSettings', { inputName: o.fuente, inputSettings: ajustes, overlay: true });
    return `«${o.fuente}» en «${escena}» actualizado con datos reales; conserva su posición.`;
  }
  let sceneItemId: number;
  if (!inputs.some((i) => i.inputName === o.fuente)) {
    ({ sceneItemId } = await pedir<{ sceneItemId: number }>('CreateInput', {
      sceneName: escena, inputName: o.fuente, inputKind: 'browser_source', inputSettings: ajustes, sceneItemEnabled: true,
    }));
    if (cual === 'alertas') await pedir('SetInputAudioMonitorType', { inputName: o.fuente, monitorType: 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT' }).catch(() => {});
  } else {
    await pedir('SetInputSettings', { inputName: o.fuente, inputSettings: ajustes, overlay: true });
    ({ sceneItemId } = await pedir<{ sceneItemId: number }>('CreateSceneItem', { sceneName: escena, sourceName: o.fuente, sceneItemEnabled: true }));
  }
  if (cual === 'alertas') {
    await pantallaCompleta(pedir, escena, sceneItemId);
    return `Alertas añadidas a «${escena}», encima de todo. Su sonido está en el mezclador («${o.fuente}»).`;
  }
  const v = await pedir<{ baseWidth: number; baseHeight: number }>('GetVideoSettings');
  const sx = v.baseWidth / 1920;
  const sy = v.baseHeight / 1080;
  await pedir('SetSceneItemTransform', {
    sceneName: escena, sceneItemId,
    sceneItemTransform: { positionX: 24 * sx, positionY: 24 * sy, alignment: 5, rotation: 0, scaleX: sx, scaleY: sy },
  });
  return `Panel rotativo añadido a «${escena}», arriba a la izquierda. Arrástralo en OBS a donde mejor quede.`;
}
