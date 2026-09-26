/**
 * Catálogo de efectos del chat con Channel Points (docs/07-EFECTOS-CANAL.md).
 *
 * Los efectos viven en Streamer.bot, no aquí. Este catálogo es la lista de
 * lo que QUEREMOS tener montado, y el panel la cruza con las Actions que
 * existen de verdad en Streamer.bot para decirte qué falta. También trae la
 * guía para montar cada uno, que el panel enseña paso a paso.
 *
 * El cruce se hace por el nombre de la Action: `Efecto - Grito de guerra`.
 * Si le pones otro nombre en Streamer.bot, el panel no la encontrará.
 *
 * Formato de los pasos (el panel lo pinta, nunca como HTML):
 *   **Botón**   un botón o menú, escrito tal cual sale en pantalla
 *   `texto`     algo que hay que escribir; en el panel se copia con un clic
 *   [[ruta]]    un archivo de la biblioteca; en el panel copia su ruta completa
 */

export interface Bloque {
  pasos: string[];
  /** Un porqué, un truco o un aviso. Va debajo de los pasos. */
  nota?: string;
}

export interface Fase extends Bloque {
  donde: 'Streamer.bot' | 'OBS' | 'Panel';
  titulo: string;
  /** Si el panel puede hacer esta fase solo, cómo. Va antes de los pasos. */
  atajo?: string;
}

export interface Efecto {
  id: string;
  recompensa: string;
  /** Nombre exacto de la Action en Streamer.bot. */
  accion: string;
  coste: number;
  cooldownSeg: number;
  /** Canjes como máximo por directo, entre todos. null = sin límite. */
  maxPorDirecto: number | null;
  /** Canjes como máximo por persona y directo. */
  maxPorPersona: number | null;
  queHace: string;
  /** null = nada más que OBS y Streamer.bot. */
  necesita: string | null;
  /** Archivos de la biblioteca que usa, como `sonidos/lag.wav`. */
  material: string[];
  /** Lo que hay que preparar en OBS antes, si hace falta. */
  obs: Bloque | null;
  /** Lo que pasa cuando alguien canjea: las Sub-Actions, en orden. */
  subacciones: Bloque;
}

export const PREFIJO_ACCION = 'Efecto — ';

/** El mismo nombre con guion normal, que es lo que se escribe con el teclado. */
const nombreTecleable = (e: Efecto) => e.accion.replace('—', '-');

function efecto(e: Omit<Efecto, 'accion'>): Efecto {
  return { ...e, accion: PREFIJO_ACCION + e.recompensa };
}

const playSound = (archivo: string) =>
  `**Core** → **Sounds** → **Play Sound** (reproducir sonido). En **Sound File** pega la ruta de [[${archivo}]]. Empieza con el volumen a la mitad y ajústalo al probar.`;

const delay = (ms: number) =>
  `**Core** → **Delay** (esperar): \`${ms}\` milisegundos, que son ${ms / 1000} segundos.`;

export const EFECTOS: Efecto[] = [
  efecto({
    id: 'grito',
    recompensa: 'Grito de guerra',
    coste: 750,
    cooldownSeg: 600,
    maxPorDirecto: 4,
    maxPorPersona: 1,
    queHace: 'Suena un grito de guerra: tambores y un cuerno.',
    necesita: null,
    material: ['sonidos/grito-de-guerra.wav'],
    obs: null,
    subacciones: {
      pasos: [
        playSound('sonidos/grito-de-guerra.wav'),
        'Opcional: **Twitch** → **Chat** → **Send Message to Channel** (escribir en el chat) con `%user% lanza un grito de guerra ⚔️`.',
      ],
      nota: '`%user%` lo cambia Streamer.bot solo por el nombre de quien canjeó la recompensa.',
    },
  }),
  efecto({
    id: 'pocion',
    recompensa: 'Poción de vida',
    coste: 500,
    cooldownSeg: 600,
    maxPorDirecto: null,
    maxPorPersona: 2,
    queHace: 'Aparece "¡Bebe agua!" en pantalla 5 segundos, con un frasco animado.',
    necesita: null,
    material: ['overlays/pocion.html', 'sonidos/pocion.wav'],
    obs: {
      pasos: [
        'Selecciona la escena en la que juegas. En **Fuentes**, pulsa **+** → **Navegador**, y llámala `FX Pocion`.',
        'Marca **Archivo local** y elige [[overlays/pocion.html]] (o pega su ruta).',
        'Pon **Ancho** `1920` y **Alto** `1080`.',
        'Marca **Apagar la fuente cuando no esté visible**.',
        'Pulsa **Aceptar**. En la lista de fuentes, déjala por encima del juego.',
        'Ocúltala con el icono del ojo. La enseñará Streamer.bot cuando alguien la canjee.',
      ],
      nota: 'Lo de apagarla cuando no se ve es para que la animación empiece de cero cada vez. Si no, la segunda vez aparecería ya terminada.',
    },
    subacciones: {
      pasos: [
        playSound('sonidos/pocion.wav'),
        '**OBS** → **Sources** → **Set Source Visibility** (mostrar u ocultar una fuente). Elige tu escena del juego, la fuente `FX Pocion` y **Visible**.',
        delay(5000),
        'Otra vez **Set Source Visibility**, igual que antes pero con **Hidden** (oculta).',
      ],
      nota: 'El overlay dura 5 segundos, lo mismo que el Delay. Si algún día cambias uno, cambia el otro.',
    },
  }),
  efecto({
    id: 'maldicion',
    recompensa: 'Maldición',
    coste: 2500,
    cooldownSeg: 1200,
    maxPorDirecto: 2,
    maxPorPersona: 1,
    queHace: 'La pantalla se queda en blanco y negro 10 segundos.',
    necesita: null,
    material: ['sonidos/maldicion.wav'],
    obs: {
      pasos: [
        'Clic derecho en la fuente del juego (la captura del juego, no la escena) → **Filtros**.',
        'En **Filtros de efectos**, pulsa **+** → **Corrección de color**, y llámalo `FX Maldicion`.',
        'Baja la **Saturación** del todo, hasta `-1`. La vista previa se verá en blanco y negro: es lo que buscamos.',
        'Desactiva el filtro con el icono del ojo que tiene al lado del nombre. Lo encenderá Streamer.bot.',
      ],
      nota: 'Truco: si pones el filtro en la escena entera en vez de en el juego, se maldice todo, cámara incluida. Queda más gracioso.',
    },
    subacciones: {
      pasos: [
        playSound('sonidos/maldicion.wav'),
        '**OBS** → **Filters** → **Set Filter State** (encender o apagar un filtro). Elige la fuente del juego, el filtro `FX Maldicion` y **Enabled** (encendido).',
        delay(10000),
        'Otra vez **Set Filter State**, igual que antes pero con **Disabled** (apagado).',
        'Opcional: **Twitch** → **Chat** → **Send Message to Channel** con `%user% ha maldecido al streamer 💀`.',
      ],
    },
  }),
  efecto({
    id: 'terremoto',
    recompensa: 'Terremoto',
    coste: 3000,
    cooldownSeg: 1200,
    maxPorDirecto: 2,
    maxPorPersona: 1,
    queHace: 'La imagen del juego tiembla 5 segundos. El temblor lo hace el bot; la Action solo pone el sonido.',
    necesita: null,
    material: ['sonidos/terremoto.wav'],
    obs: {
      pasos: [
        'Nada que montar en OBS: cuando alguien canjea **Terremoto**, el bot mueve la fuente del juego unos píxeles a un lado y a otro durante 5 segundos, y la deja exactamente donde estaba.',
        'Tiembla la fuente `Captura de ventana`. Si la tuya se llama de otra forma, ponla en el `.env` como `OBS_FUENTE_JUEGO=` y reinicia el bot.',
      ],
      nota: 'Antes se hacía con el plugin Move, pero había que encadenar varios filtros. Así no hace falta ninguno (y si lo tienes instalado, no estorba).',
    },
    subacciones: {
      pasos: [
        playSound('sonidos/terremoto.wav'),
        'Y ya está: el temblor lo pone el bot al ver el canje.',
      ],
    },
  }),
  efecto({
    id: 'lag',
    recompensa: 'Lag',
    coste: 5000,
    cooldownSeg: 1800,
    maxPorDirecto: 1,
    maxPorPersona: 1,
    queHace: 'La imagen del juego se congela 5 segundos, como si fuera lag de verdad.',
    necesita: 'Plugin Freeze Filter (Exeldro)',
    material: ['sonidos/lag.wav'],
    obs: {
      pasos: [
        'Cierra OBS e instala el plugin **Freeze Filter** de Exeldro. Está en obsproject.com, en la sección de plugins. Es gratis.',
        'Abre OBS. Clic derecho en la fuente del juego → **Filtros**.',
        'En **Filtros de efectos**, pulsa **+** → **Freeze**, y llámalo `FX Lag`.',
        'Desactívalo con el icono del ojo. Lo encenderá Streamer.bot.',
      ],
    },
    subacciones: {
      pasos: [
        playSound('sonidos/lag.wav'),
        '**OBS** → **Filters** → **Set Filter State**. Elige la fuente del juego, el filtro `FX Lag` y **Enabled** (encendido).',
        delay(5000),
        'Otra vez **Set Filter State** con **Disabled** (apagado).',
      ],
    },
  }),
];

/**
 * Los límites por directo: son lo que de verdad frena el spam, más que el
 * precio (decidido el 25 sep 2026). Twitch los trae de serie.
 */
function limites(e: Efecto): string {
  const partes = [
    e.maxPorDirecto !== null && `**Max Per Stream** (máximo por directo): \`${e.maxPorDirecto}\``,
    e.maxPorPersona !== null && `**Max Per User Per Stream** (máximo por persona y directo): \`${e.maxPorPersona}\``,
  ].filter(Boolean);
  return partes.length ? `Límites: ${partes.join('. ')}.` : 'Sin límite por directo: basta con el tiempo de espera.';
}

/** La guía completa de un efecto, en el orden en que se hace. */
export function guia(e: Efecto): Fase[] {
  const fases: Fase[] = [
    {
      donde: 'Streamer.bot',
      titulo: 'Crea la recompensa de puntos',
      pasos: [
        'Ve a la pestaña **Platforms** (plataformas) → **Twitch** → **Channel Point Rewards** (recompensas de puntos de canal).',
        'Clic derecho en la lista → **Add** (añadir).',
        `**Title** (nombre): \`${e.recompensa}\`. **Cost** (coste): \`${e.coste}\`. **Global Cooldown** (tiempo entre canjes): \`${e.cooldownSeg}\` segundos.`,
        limites(e),
        'Marca **Skip Queue** (saltar la cola) y comprueba que **Enabled** (activa) está marcada.',
        'Pulsa **OK**. Si abres tu canal en Twitch, ya debería salir entre las recompensas.',
      ],
      nota: 'Créala desde Streamer.bot y no desde la web de Twitch: Twitch solo deja que Streamer.bot active o pause las recompensas que ha creado él. "Saltar la cola" hace que el canje se dé por hecho solo, así no se te acumulan pendientes.',
    },
  ];

  if (e.obs) {
    fases.push({
      donde: 'OBS',
      titulo: 'Prepara OBS',
      ...e.obs,
      // Lo que sabe crear el panel solo (src/panel/obs-setup.ts).
      ...(['pocion', 'maldicion', 'lag'].includes(e.id) && {
        atajo: 'Atajo: cierra esta guía y usa **Preparar en OBS**, arriba en esta misma pestaña. Hace esta fase por ti; luego sigue por la siguiente.',
      }),
    });
  }

  fases.push(
    {
      donde: 'Streamer.bot',
      titulo: 'Crea la acción',
      pasos: [
        'Ve a la pestaña **Actions** (acciones). Clic derecho en la lista de la izquierda → **Add**.',
        `**Name** (nombre): \`${nombreTecleable(e)}\`. **Group** (grupo): \`Efectos\`, para tenerlas todas juntas. Pulsa **OK**.`,
        `Con la acción seleccionada, a la derecha está **Triggers** (disparadores). En su buscador, **Search to add trigger…**, escribe \`Reward Redemption\` y elige **Twitch → Channel Reward → Reward Redemption** (canje de recompensa). En **Reward** elige \`${e.recompensa}\` y pulsa **OK**.`,
      ],
      nota: 'El nombre tiene que ser exactamente ese: es como este panel sabe que el efecto está montado. El disparador es el "cuándo": cada vez que alguien canjee la recompensa, se ejecuta la acción.',
    },
    {
      donde: 'Streamer.bot',
      titulo: 'Di qué pasa al canjearla',
      pasos: [
        'Debajo está **Sub-Actions** (lo que hace la acción). Cada paso se añade escribiendo su nombre en el buscador **Search to add sub-action…** y eligiéndolo en la lista. En este orden:',
        ...e.subacciones.pasos,
      ],
      nota: [
        'Se ejecutan de arriba abajo. Si alguno queda desordenado, arrástralo a su sitio.',
        e.subacciones.nota,
      ].filter(Boolean).join(' '),
    },
    {
      donde: 'Panel',
      titulo: 'Pruébalo',
      pasos: [
        'Vuelve a este panel. En unos segundos este efecto pasará a **Montado** y se encenderá el botón **Probar**.',
        'Pulsa **Probar**: lanza el efecto sin gastar puntos, como si lo hubieras canjeado tú (`%user%` sale con tu nombre). Ajusta el volumen en Streamer.bot hasta que te guste.',
        'Por último, canjéalo de verdad desde tu canal. Así compruebas también que el disparador funciona.',
      ],
      nota: 'Si Probar funciona pero el canje de verdad no, casi siempre es el disparador: revisa que en Reward esté elegida la recompensa correcta.',
    },
  );

  return fases;
}

/**
 * Compara nombres sin que un espacio, una mayúscula o el tipo de guion lo
 * estropee. La raya "—" no está en el teclado: quien escriba "Efecto - Lag"
 * con un guion normal tiene que encontrarse igual su efecto.
 */
export function mismoNombre(a: string, b: string): boolean {
  const norm = (s: string) =>
    s.normalize('NFC').replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
  return norm(a) === norm(b);
}
