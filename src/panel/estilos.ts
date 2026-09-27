/**
 * Estilos de las escenas (27 sep 2026): no todo el directo es fantasía oscura.
 * Con un juego colorido (Aniimo, por ejemplo) pega más algo alegre.
 *
 * El estilo cambia a la vez el aspecto del overlay (letras, colores,
 * partículas, cajas) y cómo se piden a la IA los fondos y el personaje. Cada
 * estilo guarda sus propios fondos y su personaje: al volver a uno, vuelve
 * todo lo suyo.
 *
 * Hay tres hechos (oscuro, alegre, acogedor) y los que crea Crid4m en el
 * panel con un formulario: temática en castellano, colores, letra, forma y
 * partículas. Los suyos tienen id 'mi…' y se guardan con las escenas
 * (escenas.ts los registra aquí con registrarPropios).
 *
 * En los nombres de archivo va delante del estilo ('alegre-inicio-…png',
 * 'imagenes/avatar/mik3j9x2-…'); lo de antes, sin él, es del oscuro.
 */

/** Los estilos hechos. */
export const ESTILOS = ['oscuro', 'alegre', 'acogedor'] as const;
type Predefinido = (typeof ESTILOS)[number];
/** Un estilo hecho o uno propio ('mi…'). */
export type Estilo = string;
export const POR_DEFECTO: Estilo = 'oscuro';

const esPredefinido = (v: unknown): v is Predefinido => typeof v === 'string' && (ESTILOS as readonly string[]).includes(v);
/** La forma de los ids propios: ninguna escena empieza por 'mi', así el nombre del archivo no engaña. */
export const ID_PROPIO = /^mi[a-z0-9]{5,12}$/;

/** Uno de los hechos o uno propio que existe. */
export const esEstilo = (v: unknown): v is Estilo => esPredefinido(v) || (typeof v === 'string' && registrados.some((e) => e.id === v));

// ---------------------------------------------------------------------------
// Cómo se ve (el overlay)
// ---------------------------------------------------------------------------

export const BASES = ['oscuro', 'redondo'] as const;
export const LETRAS = ['moderna', 'editorial', 'elegante', 'redonda', 'calida', 'futurista', 'pixel', 'comic'] as const;
export const PARTICULAS = ['luces', 'polvo', 'ceniza', 'destellos', 'petalos', 'nieve', 'lluvia', 'ninguna'] as const;

export interface Colores {
  principal: string;
  secundario: string;
  cieloArriba: string;
  cieloAbajo: string;
}

/** Lo que el overlay necesita para pintar un estilo. */
export interface Apariencia {
  /** 'oscuro': líneas finas y serif; 'redondo': la moderna, con paneles de cristal (el nombre es del primer intento). */
  base: (typeof BASES)[number];
  letra: (typeof LETRAS)[number];
  particulas: (typeof PARTICULAS)[number];
  /** Solo los propios: los hechos llevan sus colores en el overlay. */
  colores: Colores | null;
}

export interface EstiloPropio extends Omit<Apariencia, 'colores'> {
  id: string;
  nombre: string;
  icono: string;
  /** Cómo es, en castellano: se usa tal cual para pedir los fondos y el personaje. */
  tematica: string;
  colores: Colores;
}

const APARIENCIAS: Record<Predefinido, Apariencia> = {
  oscuro: { base: 'oscuro', letra: 'elegante', particulas: 'ceniza', colores: null },
  alegre: { base: 'redondo', letra: 'moderna', particulas: 'luces', colores: null },
  acogedor: { base: 'redondo', letra: 'editorial', particulas: 'polvo', colores: null },
};

let registrados: EstiloPropio[] = [];

/** Los estilos propios guardados: escenas.ts los pone aquí al leer y al cambiar. */
export function registrarPropios(lista: EstiloPropio[]): void {
  registrados = lista;
}
export const propios = (): EstiloPropio[] => registrados;
const propio = (id: string) => registrados.find((e) => e.id === id);

export function apariencia(id: Estilo): Apariencia {
  if (esPredefinido(id)) return APARIENCIAS[id];
  const e = propio(id);
  return e ? { base: e.base, letra: e.letra, particulas: e.particulas, colores: e.colores } : APARIENCIAS.oscuro;
}

type Escena = 'inicio' | 'charla' | 'pausa' | 'final';

export interface InfoEstilo {
  nombre: string;
  icono: string;
  /** Para qué juegos o momentos pega, en el panel. */
  para: string;
  /** Lo que se pide a la IA para los fondos, igual en las cuatro escenas. */
  fondo: string;
  /** El ambiente de cada escena dentro del estilo. */
  tono: Record<Escena, string>;
  /** Lo que sale en el panel si no escribes nada. */
  descripciones: Record<Escena, string>;
  /** El personaje del avatar: estilo de dibujo y cómo es por defecto. */
  avatar: { estilo: string; descripcion: string; cerrados: string; contento: string };
}

const SIN_TEXTO = 'No text, no letters, no logos, no watermark, no UI, no people in the foreground.';

export const INFO: Record<Predefinido, InfoEstilo> = {
  oscuro: {
    nombre: 'Fantasía oscura',
    icono: '🌑',
    para: 'MMOs, mazmorras, raids y noches épicas',
    fondo:
      'Cinematic dark fantasy matte painting used as a livestream overlay background. Painterly AAA game key art, ' +
      'rich atmosphere, volumetric light, depth and haze, deep shadows, cohesive muted palette with warm ember-orange accents. ' + SIN_TEXTO,
    tono: {
      inicio: 'Dusk, mysterious and inviting.',
      charla: 'Overall darker and low contrast so white text stays readable.',
      pausa: 'Quiet, restful mood with cooler night tones.',
      final: 'Hopeful, warm soft light of dawn.',
    },
    descripciones: {
      inicio: 'Un castillo gótico sobre un acantilado al anochecer, valles con niebla, una luna baja y ventanas encendidas',
      charla: 'El interior de una taberna medieval acogedora de noche, con chimenea, velas, mapas y armas en las paredes',
      pausa: 'Una hoguera de campamento en un bosque de noche, la tienda de un aventurero, estrellas y luciérnagas',
      final: 'Amanecer sobre un valle con ruinas antiguas y un camino que se pierde entre la niebla',
    },
    avatar: {
      estilo: 'Painterly AAA game concept art, high detail, clean readable silhouette, warm rim light from the right and cool rim light from the left. The eyes must be clearly visible and glowing.',
      descripcion:
        'Un errante encapuchado de un mundo de fantasía oscura: capucha y capa gris oscuro con morado, un pañuelo rojo oscuro ' +
        'que le tapa la boca, la cara en sombra salvo dos ojos ámbar que brillan, una hombrera de acero gastada con un filo dorado ' +
        'y un correaje de cuero con hebilla de latón cruzando el pecho.',
      cerrados: 'the eyes are closed: just two thin dim lines, as if blinking or asleep.',
      contento: 'the eyes are happy, curved upward like smiling crescents (^ ^), a bit brighter.',
    },
  },
  alegre: {
    nombre: 'Vibrante',
    icono: '💠',
    para: 'Aniimo, RPGs de anime y juegos coloridos',
    fondo:
      'High-end anime RPG key art used as a livestream overlay background, like the splash art of a modern open-world anime game. ' +
      'Cinematic composition, luminous atmosphere, rich saturated but sophisticated colors (teal, violet, magenta and gold accents), ' +
      'volumetric light, fine painterly detail, epic scale. Not childish, not chibi, not cartoonish. ' + SIN_TEXTO,
    tono: {
      inicio: 'Golden hour, sweeping and epic.',
      charla: 'Calm, slightly darker and low contrast so white text stays readable.',
      pausa: 'Twilight, serene and quiet.',
      final: 'Dusk with a vivid sky, a satisfying ending.',
    },
    descripciones: {
      inicio: 'Islas flotantes con ruinas antiguas sobre un mar de nubes al atardecer, cascadas de luz y criaturas voladoras a lo lejos',
      charla: 'La sala de un gremio de aventureros de noche, con ventanales a una ciudad flotante iluminada, mapas y cristales que brillan',
      pausa: 'Un mirador sobre un valle con árboles de hojas luminosas al anochecer, luciérnagas y un lago en calma',
      final: 'Una ciudad de fantasía al anochecer vista desde lo alto, con las farolas encendiéndose y aeronaves cruzando el cielo',
    },
    avatar: {
      estilo: 'High-end anime RPG character art, like the splash portrait of a modern open-world anime game: clean lineart, cel shading with soft painterly lighting, sophisticated saturated colors, confident expression. Not chibi, not childish. Eyes clearly visible.',
      descripcion:
        'Un aventurero joven de anime con estilo de RPG moderno: pelo oscuro despeinado con mechones turquesa, chaqueta técnica negra ' +
        'con detalles violeta y dorados, un colgante de cristal que brilla y mirada segura con media sonrisa.',
      cerrados: 'both eyes are calmly closed, as if blinking.',
      contento: 'a confident, happy smile with the eyes slightly narrowed, still in character.',
    },
  },
  acogedor: {
    nombre: 'Cálido',
    icono: '🕯️',
    para: 'Charla relajada, juegos tranquilos, noches lo-fi',
    fondo:
      'Atmospheric painterly illustration used as a livestream overlay background, like a hand-painted anime film background for a mature audience. ' +
      'Warm, intimate evening light, muted warm palette (amber, rust, olive, deep brown), soft volumetric light and dust in the air, calm and grounded. ' +
      'Not cute, not childish. ' + SIN_TEXTO,
    tono: {
      inicio: 'Late afternoon, warm and welcoming.',
      charla: 'Low contrast and slightly dark so the text stays readable.',
      pausa: 'Quiet evening, still and peaceful.',
      final: 'Night falling, lamps lit, a gentle ending.',
    },
    descripciones: {
      inicio: 'Una calle empedrada de un pueblo de montaña al atardecer, con tiendas iluminadas y luz dorada entre los tejados',
      charla: 'Un estudio acogedor de noche con estanterías de libros, plantas, una lámpara cálida y lluvia en el ventanal',
      pausa: 'Un balcón de madera con una taza humeante y una manta, frente a un valle con niebla al caer la tarde',
      final: 'Un café de esquina de noche con las luces encendidas, la calle mojada y reflejos cálidos',
    },
    avatar: {
      estilo: 'Painterly anime film character art for a mature audience: soft warm lighting, muted warm palette, natural proportions, calm and friendly expression. Not chibi, not childish. Eyes clearly visible.',
      descripcion: 'Un chico joven de estilo anime con jersey de punto oscuro y bufanda color óxido, auriculares al cuello, pelo castaño despeinado y expresión tranquila y amable.',
      cerrados: 'both eyes are gently closed, as if blinking or dozing.',
      contento: 'a warm, relaxed smile with softly narrowed eyes.',
    },
  },
};

/**
 * Lo que se pide a la IA para un estilo propio: su temática tal cual, sus
 * colores y un ambiente por escena que vale para cualquier temática.
 */
function infoPropio(e: EstiloPropio): InfoEstilo {
  const t = e.tematica;
  const c = e.colores;
  const oscuro = e.base === 'oscuro';
  return {
    nombre: e.nombre,
    icono: e.icono,
    para: t,
    fondo:
      `Livestream overlay background illustration, high quality key art. Theme and art style (described in Spanish): ${t}. ` +
      `Color palette built around ${c.principal} and ${c.secundario}, with a sky or background going from ${c.cieloArriba} to ${c.cieloAbajo}. ` +
      `${oscuro ? 'Moody, atmospheric lighting with depth.' : 'Vibrant and luminous, polished and cinematic.'} Not childish. ${SIN_TEXTO}`,
    tono: {
      inicio: 'Wide and inviting, the best view of this world.',
      charla: 'Calm and not too busy, low contrast so text stays readable.',
      pausa: 'Quiet and restful.',
      final: 'A warm, happy ending feeling.',
    },
    descripciones: {
      inicio: `La vista más espectacular de este mundo: ${t}`,
      charla: `Un interior acogedor de este mundo, con los detalles a la derecha: ${t}`,
      pausa: `Un rincón tranquilo para descansar en este mundo: ${t}`,
      final: `Un final bonito al atardecer en este mundo: ${t}`,
    },
    avatar: {
      estilo: `Character art in the same art style as this theme (described in Spanish): ${t}. Colors around ${c.principal} and ${c.secundario}. Clean readable silhouette, expressive face with clearly visible eyes.`,
      descripcion: `El protagonista de este mundo, simpático y reconocible, mirando de frente: ${t}`,
      cerrados: 'both eyes are closed in a relaxed way, as if blinking or asleep.',
      contento: 'the character is happy: smiling closed eyes (^ ^) and a smile.',
    },
  };
}

/** Lo que se pide a la IA para un estilo (uno que no existe, como el oscuro). */
export function info(id: Estilo): InfoEstilo {
  if (esPredefinido(id)) return INFO[id];
  const e = propio(id);
  return e ? infoPropio(e) : INFO.oscuro;
}

/** El estilo al principio de un nombre de archivo o carpeta; sin él, el oscuro. */
export function deNombre(nombre: string): Estilo {
  const p = nombre.split('-')[0] ?? '';
  return esPredefinido(p) || ID_PROPIO.test(p) ? p : POR_DEFECTO;
}

// ---------------------------------------------------------------------------
// El formulario
// ---------------------------------------------------------------------------

export const MAX_PROPIOS = 20;
const COLOR = /^#[0-9a-f]{6}$/i;
const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');
const de = <T extends readonly string[]>(lista: T, v: unknown, si: T[number]): T[number] => (lista.includes(v as string) ? (v as T[number]) : si);

export const nuevoId = () => `mi${Date.now().toString(36)}`;

/**
 * Un estilo propio del formulario, limpio, o null si falta lo básico
 * (nombre y temática). Lo que no se entienda toma un valor por defecto.
 */
export function limpiarPropio(v: any, id: string): EstiloPropio | null {
  if (!v || typeof v !== 'object' || !ID_PROPIO.test(id)) return null;
  const nombre = texto(v.nombre, 30);
  const tematica = texto(v.tematica, 400);
  if (!nombre || !tematica) return null;
  const c = v.colores && typeof v.colores === 'object' ? v.colores : {};
  const color = (x: unknown, si: string) => (typeof x === 'string' && COLOR.test(x) ? x.toLowerCase() : si);
  return {
    id,
    nombre,
    icono: Array.from(texto(v.icono, 16)).slice(0, 2).join('') || '✨',
    tematica,
    base: de(BASES, v.base, 'redondo'),
    letra: de(LETRAS, v.letra, 'moderna'),
    particulas: de(PARTICULAS, v.particulas, 'luces'),
    colores: {
      principal: color(c.principal, '#ff5fa8'),
      secundario: color(c.secundario, '#6b4bff'),
      cieloArriba: color(c.cieloArriba, '#5fc8ff'),
      cieloAbajo: color(c.cieloAbajo, '#ffd9f0'),
    },
  };
}
