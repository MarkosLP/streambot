/**
 * El catálogo del Loot del chat.
 *
 * Fantasía MMO GENÉRICA a propósito: Crid4m juega a varios MMO, así que nada
 * de nombres de un juego concreto. Tono épico con toques de humor (decidido
 * el 25 sep 2026): la mayoría suena seria, y de vez en cuando cae algo que
 * hace gracia.
 *
 * CRID4M: esto es tuyo. Añade, quita o cambia objetos sin miedo; lo único que
 * no debe quedarse vacío es ninguna de las cuatro listas.
 */

export type Rareza = 'comun' | 'raro' | 'epico' | 'legendario';

export const RAREZAS: Rareza[] = ['comun', 'raro', 'epico', 'legendario'];

/** Cómo se ve cada rareza en el chat. Los colores son los del panel. */
export const ESTILO: Record<Rareza, { nombre: string; plural: string; emoji: string }> = {
  comun: { nombre: 'Común', plural: 'comunes', emoji: '⚪' },
  raro: { nombre: 'Raro', plural: 'raros', emoji: '🔵' },
  epico: { nombre: 'Épico', plural: 'épicos', emoji: '🟣' },
  legendario: { nombre: 'Legendario', plural: 'legendarios', emoji: '🟠' },
};

/**
 * Probabilidades, en tanto por ciento.
 *
 * `cofre` es el botín gratis por estar en el chat. Con un cofre cada 20-30
 * minutos y 1-3 personas activas salen unas 10-15 tiradas por directo, así
 * que un 4 % de Legendario da uno cada directo o dos: lo bastante raro para
 * que se celebre y lo bastante frecuente para que alguien lo llegue a ver.
 *
 * `oro` es el Cofre del tesoro que se compra con puntos de canal. Tiene que
 * notarse que es mejor, o nadie gastará sus puntos en él.
 */
export type TipoCofre = 'cofre' | 'oro' | 'guerra';

export const PROBABILIDADES: Record<TipoCofre, Record<Rareza, number>> = {
  cofre: { comun: 60, raro: 26, epico: 10, legendario: 4 },
  oro: { comun: 35, raro: 35, epico: 22, legendario: 8 },
  // El cofre que atrae un Grito de guerra: solo armas, y con algo más de suerte.
  guerra: { comun: 45, raro: 33, epico: 16, legendario: 6 },
};

export const OBJETOS: Record<Rareza, string[]> = {
  comun: [
    'Espada oxidada',
    'Escudo de madera astillado',
    'Botas del novato',
    'Poción de vida menor',
    'Pan duro del tabernero',
    'Daga sin filo',
    'Capucha de lana',
    'Antorcha medio apagada',
    'Cuerda de diez metros',
    'Piedra de afilar',
    'Guantes de cuero gastados',
    'Mapa arrugado',
    'Flecha torcida',
    'Colgante de hojalata',
    'Pergamino en blanco',
    'Martillo de herrero',
    'Calcetín del tanque',
    'Poción de dudosa procedencia',
    'Cuchara de madera (+1 a nada)',
    'Queso rancio del mercado',
  ],
  raro: [
    'Arco de tejo élfico',
    'Anillo de plata encantado',
    'Capa del explorador',
    'Hacha de guerra enana',
    'Tomo de hechizos menores',
    'Yelmo del centinela',
    'Amuleto del lobo',
    'Bastón de roble antiguo',
    'Brazales del duelista',
    'Poción de maná mayor',
    'Lanza de la guardia real',
    'Mochila con bolsillo secreto',
    'Montura: poni cabezota',
    'Dados trucados del pícaro',
  ],
  epico: [
    'Capa de las Sombras',
    'Hoja del Rey Caído',
    'Báculo de la Tormenta',
    'Armadura del Dragón Rojo',
    'Arco del Cazador de Almas',
    'Corona del Liche',
    'Escudo del Último Bastión',
    'Guantes del Archimago',
    'Montura: lobo de escarcha',
    'Lag del servidor, embotellado',
  ],
  legendario: [
    'Espada del Amanecer Eterno',
    'Filo del Vacío',
    'Ala del Fénix',
    'Martillo de los Titanes',
    'Grimorio del Primer Mago',
    'Montura: dragón de ébano',
    'Casco que Crid4m nunca te prestó',
  ],
};

/** Objetos que caben en una mochila (decidido el 25 sep 2026). */
export const MOCHILA_MAX = 20;

/** Cuánto poder da cada objeto. Un Legendario vale lo que 20 Comunes. */
export const PODER: Record<Rareza, number> = { comun: 1, raro: 3, epico: 8, legendario: 20 };

/** Cuántos objetos de una rareza se funden en uno de la siguiente. */
export const FORJA_CANTIDAD = 3;

export function siguienteRareza(r: Rareza): Rareza | null {
  const i = RAREZAS.indexOf(r);
  return i < RAREZAS.length - 1 ? RAREZAS[i + 1]! : null;
}

/** Orden para comparar: más alto, mejor. */
export const NIVEL: Record<Rareza, number> = { comun: 1, raro: 2, epico: 3, legendario: 4 };

/**
 * El título que da completar la colección de una rareza (todos sus objetos
 * distintos, alguna vez). Se enseña el más alto que tengas.
 */
export const TITULOS: Record<Rareza, string> = {
  comun: 'Trotamundos',
  raro: 'Cazatesoros',
  epico: 'Señor del Botín',
  legendario: 'Leyenda Viviente',
};

/** Un número entre 0 (incluido) y 1 (excluido). Se inyecta en los tests. */
export type Azar = () => number;

export interface Botin {
  objeto: string;
  rareza: Rareza;
  /**
   * Objeto maldito (lo da la Maldición): el doble de poder, pero si pierdes
   * un duelo pasa a quien te ha ganado. Una Poción de vida lo purifica.
   */
  maldito?: boolean;
}

/** Qué objetos son armas. Por el nombre, para que valga con los que añadas. */
// Palabra completa: "Colgante de hojalata" no es un arma aunque lleve "hoja".
const ARMA = /(?<!\p{L})(espada|daga|hacha|arco|lanza|martillo|hoja|filo|báculo|bastón|flecha)(?!\p{L})/iu;
export const esArma = (objeto: string) => ARMA.test(objeto);

export function tirar(tipo: TipoCofre, azar: Azar = Math.random): Botin {
  const tabla = PROBABILIDADES[tipo];
  let tirada = azar() * 100;
  let rareza: Rareza = 'comun';
  for (const r of RAREZAS) {
    if (tirada < tabla[r]) {
      rareza = r;
      break;
    }
    tirada -= tabla[r];
  }
  // En el cofre de guerra solo hay armas. Si alguien deja una rareza sin
  // ninguna, se tira de la lista entera antes que no dar nada.
  const armas = OBJETOS[rareza].filter(esArma);
  const lista = tipo === 'guerra' && armas.length ? armas : OBJETOS[rareza];
  const objeto = lista[Math.min(lista.length - 1, Math.floor(azar() * lista.length))]!;
  return { objeto, rareza };
}

/** `🟣 Capa de las Sombras`, como se escribe en el chat. Maldito: `☠️🟣 …`. */
export function etiqueta(b: Botin): string {
  return `${b.maldito ? '☠️' : ''}${ESTILO[b.rareza].emoji} ${b.objeto}`;
}

/** El poder de un objeto: el doble si está maldito. */
export const poderDe = (b: Botin) => PODER[b.rareza] * (b.maldito ? 2 : 1);
