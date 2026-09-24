/**
 * Catálogo de efectos del chat con Channel Points (docs/07-EFECTOS-CANAL.md).
 *
 * Los efectos viven en Streamer.bot, no aquí. Este catálogo es la lista de
 * lo que QUEREMOS tener montado, y el panel la cruza con las Actions que
 * existen de verdad en Streamer.bot para decirte qué falta.
 *
 * El cruce se hace por el nombre de la Action: `Efecto — Grito de guerra`.
 * Si le pones otro nombre en Streamer.bot, el panel no la encontrará.
 */

export interface Efecto {
  id: string;
  recompensa: string;
  /** Nombre exacto de la Action en Streamer.bot. */
  accion: string;
  coste: number;
  cooldownSeg: number;
  queHace: string;
  /** null = nada más que OBS y Streamer.bot. */
  necesita: string | null;
  pasos: string[];
}

export const PREFIJO_ACCION = 'Efecto — ';

function efecto(e: Omit<Efecto, 'accion'>): Efecto {
  return { ...e, accion: PREFIJO_ACCION + e.recompensa };
}

export const EFECTOS: Efecto[] = [
  efecto({
    id: 'grito',
    recompensa: 'Grito de guerra',
    coste: 300,
    cooldownSeg: 60,
    queHace: 'Suena un grito de guerra.',
    necesita: null,
    pasos: [
      'Sub-action: Core → Sounds → Play Sound. Elige el archivo y el volumen.',
      'Opcional: Twitch → Chat → Send Message to Channel → "%user% lanza un grito de guerra ⚔️".',
    ],
  }),
  efecto({
    id: 'pocion',
    recompensa: 'Poción de vida',
    coste: 300,
    cooldownSeg: 300,
    queHace: 'Aparece "¡Bebe agua!" en pantalla 5 segundos.',
    necesita: null,
    pasos: [
      'En OBS: fuente Imagen o GIF llamada "FX Pocion" en la escena del juego, oculta.',
      'Sub-action: OBS → Sources → Set Source Visibility → FX Pocion → Visible.',
      'Sub-action: Core → Delay → 5000 ms.',
      'Sub-action: OBS → Sources → Set Source Visibility → FX Pocion → Hidden.',
    ],
  }),
  efecto({
    id: 'maldicion',
    recompensa: 'Maldición',
    coste: 800,
    cooldownSeg: 300,
    queHace: 'La pantalla se queda en blanco y negro 30 segundos.',
    necesita: null,
    pasos: [
      'En OBS: filtro "Corrección de color" en la fuente del juego, llamado "FX Maldicion", saturación -1, desactivado.',
      'Sub-action: OBS → Filters → Set Filter State → FX Maldicion → Enabled.',
      'Sub-action: Core → Delay → 30000 ms.',
      'Sub-action: OBS → Filters → Set Filter State → FX Maldicion → Disabled.',
    ],
  }),
  efecto({
    id: 'terremoto',
    recompensa: 'Terremoto',
    coste: 1000,
    cooldownSeg: 300,
    queHace: 'La cámara tiembla 5 segundos.',
    necesita: 'Plugin Move (Exeldro)',
    pasos: [
      'Instala el plugin Move de OBS.',
      'Filtro "Move Value" en la cámara que haga oscilar la posición, desactivado.',
      'Mismo patrón que Maldición: activar, Delay 5000 ms, desactivar.',
    ],
  }),
  efecto({
    id: 'lag',
    recompensa: 'Lag',
    coste: 1500,
    cooldownSeg: 600,
    queHace: 'La imagen se congela 5 segundos.',
    necesita: 'Plugin Freeze Filter (Exeldro)',
    pasos: [
      'Instala el plugin Freeze Filter de OBS.',
      'Filtro "Freeze" en la fuente del juego, desactivado.',
      'Mismo patrón que Maldición: activar, Delay 5000 ms, desactivar.',
    ],
  }),
];

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
