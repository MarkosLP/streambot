/**
 * Contenido de El Linde del Velo: lo que hace que el mundo aguante muchos días
 * sin repetirse aunque Crid4m no esté (2 oct 2026).
 *
 * - Cada región tiene diez misiones; se reparten sin repetir hasta agotarlas.
 * - Cada misión guarda dos reliquias: la Lumbre las colecciona (60 en total).
 * - A mitad de expedición ocurre un suceso de la región (solo narrativo).
 * - La Crónica del Velo avanza un capítulo cada CAPITULO_CADA expediciones completadas.
 * - A veces, en vez del suceso, una encrucijada: el chat vota con !explorar 1 o 2.
 *   Lo que elija la compañía decide el final de la crónica.
 *
 * Solo texto: las imágenes son los cuatro fondos de biblioteca/imagenes/mmo y
 * el clima se pinta con CSS. Las acciones van en tercera persona tras el
 * nombre («Ana aparta…»); las reliquias, con su artículo («un altar…»).
 */

export interface Mision {
  id: string;
  objetivo: string;
  acciones: readonly [string, string, string];
  reliquias: readonly [string, string];
}

/** Una decisión del chat a mitad de camino. La opción 1 es la prudente; la 2, la arriesgada. */
export interface Encrucijada {
  id: string;
  pregunta: string;
  opciones: readonly [string, string];
}

export interface Region {
  id: 'bosque' | 'cantera' | 'marisma';
  nombre: string;
  misiones: readonly Mision[];
  sucesos: readonly string[];
  encrucijadas: readonly Encrucijada[];
}

export const REGIONES: readonly Region[] = [
  {
    id: 'bosque',
    nombre: 'Fronda Ámbar',
    misiones: [
      { id: 'raices', objetivo: 'Abrir camino entre las raíces',
        acciones: ['aparta una cortina de raíces', 'sigue un rastro de brasas', 'trepa a un tronco caído para mirar lejos'],
        reliquias: ['un altar de savia antigua', 'una semilla que late como un corazón'] },
      { id: 'santuario', objetivo: 'Despertar el santuario dormido',
        acciones: ['limpia el musgo de una estatua sin rostro', 'enciende un cuenco de resina', 'recita una oración olvidada'],
        reliquias: ['una campana de madera petrificada', 'el rosario de un guardián del bosque'] },
      { id: 'ciervo', objetivo: 'Seguir al ciervo de ámbar',
        acciones: ['sigue huellas que brillan en el barro', 'espera en silencio entre los helechos', 'cruza un arroyo de luz líquida'],
        reliquias: ['una cornamenta de ámbar vivo', 'un cascabel de hueso tallado'] },
      { id: 'avispas', objetivo: 'Cruzar el claro de las avispas de cobre',
        acciones: ['avanza agachado bajo los panales', 'esparce humo de hojas secas', 'esquiva un enjambre metálico'],
        reliquias: ['un panal de cera dorada que no se derrite', 'un aguijón de cobre largo como una daga'] },
      { id: 'arbol-madre', objetivo: 'Escalar el Árbol Madre',
        acciones: ['clava un garfio en la corteza', 'descansa en una rama ancha como un puente', 'ata una cuerda para los que vienen detrás'],
        reliquias: ['una hoja de oro con las venas grabadas', 'un nido de cuervo lleno de monedas antiguas'] },
      { id: 'ermitano', objetivo: 'Encontrar la cabaña del ermitaño',
        acciones: ['lee marcas talladas en los troncos', 'sigue el olor de un guiso lejano', 'sortea trampas cubiertas de hojas'],
        reliquias: ['el diario del último ermitaño', 'una lámpara de aceite que nunca se apaga'] },
      { id: 'raiz-negra', objetivo: 'Cortar la raíz que pudre el bosque',
        acciones: ['quema una raíz negra con su antorcha', 'aguanta el hedor dulce de la podredumbre', 'encuentra el corazón de la plaga'],
        reliquias: ['un frasco de savia purificada', 'una espina negra encerrada en cristal'] },
      { id: 'lago', objetivo: 'Cruzar el lago de hojas',
        acciones: ['salta de nenúfar en nenúfar', 'rema en una balsa de corteza', 'oye cantar algo bajo el agua'],
        reliquias: ['una perla de resina con un insecto dentro', 'un remo tallado con runas de los primeros pueblos'] },
      { id: 'festival', objetivo: 'Reavivar las linternas del festival perdido',
        acciones: ['cuelga una linterna de papel en una rama', 'encuentra máscaras rotas entre la hierba', 'tararea una canción que nadie recuerda'],
        reliquias: ['una máscara de zorro lacada en rojo', 'un tambor ceremonial cubierto de musgo'] },
      { id: 'guardian', objetivo: 'Despertar al guardián de corteza',
        acciones: ['golpea tres veces un tronco hueco', 'ofrece agua al musgo de su rostro', 'esquiva un brazo de ramas que se despereza'],
        reliquias: ['una astilla del guardián que todavía se mueve', 'un sello verde de los antiguos druidas'] },
    ],
    sucesos: [
      'Una lluvia de hojas doradas cubre el sendero.',
      'Algo enorme se mueve entre los árboles y se aleja sin dejarse ver.',
      'Las raíces se apartan solas, como si el bosque les dejara pasar.',
      'Los grillos callan de golpe. Después, solo silencio.',
      'Brasas flotantes iluminan un camino que antes no estaba ahí.',
      'Un estandarte viejo cuelga de una rama, hecho jirones.',
      'La resina de los troncos brilla como si respirara.',
      'Un cuervo sigue a la compañía, siempre tres árboles por detrás.',
    ],
    encrucijadas: [
      { id: 'brasas', pregunta: 'A la izquierda se abre un sendero de brasas; a la derecha sigue el camino conocido.', opciones: ['Seguir el camino conocido', 'Tomar el sendero de brasas'] },
      { id: 'ciervo-luz', pregunta: 'Un ciervo de luz se detiene y mira a la compañía.', opciones: ['Dejarlo marchar', 'Seguirlo entre los helechos'] },
      { id: 'panales', pregunta: 'Una colmena de cobre zumba sobre el único puente.', opciones: ['Rodear el claro', 'Cruzar bajo los panales'] },
      { id: 'tronco-voz', pregunta: 'Una voz pide ayuda desde dentro de un tronco hueco.', opciones: ['Seguir adelante', 'Entrar en el tronco'] },
    ],
  },
  {
    id: 'cantera',
    nombre: 'Canteras del Eco',
    misiones: [
      { id: 'colosos', objetivo: 'Despertar a los colosos de piedra',
        acciones: ['limpia el polvo de una inscripción', 'cruza una pasarela de cadenas', 'oye un eco que responde a su voz'],
        reliquias: ['el rostro de un rey olvidado', 'una corona de granito partida en dos'] },
      { id: 'eco', objetivo: 'Seguir el eco hasta su origen',
        acciones: ['grita su nombre y cuenta los ecos', 'pega el oído a la roca fría', 'baja por una grieta que canta'],
        reliquias: ['una caracola de piedra que repite susurros', 'un diapasón de cristal violeta'] },
      { id: 'cristales', objetivo: 'Recoger cristales de luna',
        acciones: ['arranca un cristal violeta de la pared', 'envuelve el botín en tela gruesa', 'esquiva un derrumbe de esquirlas'],
        reliquias: ['un cristal con una luna atrapada dentro', 'un cincel de minero con mango de plata'] },
      { id: 'galeria', objetivo: 'Reabrir la galería sellada',
        acciones: ['retira escombros a mano', 'apuntala el techo con vigas viejas', 'encuentra una puerta con siete cerraduras'],
        reliquias: ['una llave de hierro con forma de corona', 'el casco abollado de un capataz'] },
      { id: 'tumba', objetivo: 'Honrar la tumba del rey cantero',
        acciones: ['enciende velas a los pies del sepulcro', 'descifra el nombre borrado de la lápida', 'deja una piedra sobre la tumba'],
        reliquias: ['el cetro de un rey sin reino', 'un sudario bordado con hilo de plata'] },
      { id: 'montacargas', objetivo: 'Poner en marcha el gran montacargas',
        acciones: ['gira una manivela oxidada', 'engrasa engranajes del tamaño de una carreta', 'tensa una cadena que gime'],
        reliquias: ['un engranaje de bronce con runas', 'un silbato de capataz que todavía suena'] },
      { id: 'mineros', objetivo: 'Encontrar a los mineros perdidos',
        acciones: ['sigue marcas de tiza en las paredes', 'encuentra un campamento abandonado', 'oye picos golpeando muy abajo'],
        reliquias: ['la lámpara de un minero que esperó demasiado', 'un mapa de las galerías dibujado en cuero'] },
      { id: 'tablillas', objetivo: 'Leer la biblioteca de piedra',
        acciones: ['pasa la mano por tablillas grabadas', 'copia un poema en su cuaderno', 'ordena tablillas caídas por siglos'],
        reliquias: ['una tablilla con la primera ley de los reyes', 'un sello real de ónice'] },
      { id: 'escalones', objetivo: 'Subir el puente de los mil escalones',
        acciones: ['sube escalones gastados por los siglos', 'se aferra a una cadena en un tramo roto', 'mira atrás y ve la Lumbre a lo lejos'],
        reliquias: ['una baldosa grabada con una estrella', 'un cuerno de vigía tallado en hueso'] },
      { id: 'coloso-llora', objetivo: 'Calmar al coloso que llora',
        acciones: ['limpia lágrimas de polvo de su mejilla', 'canta una nana a un gigante de piedra', 'se refugia bajo su mano abierta'],
        reliquias: ['una lágrima de piedra pulida', 'el anillo de un gigante, ancho como un escudo'] },
    ],
    sucesos: [
      'Un trozo de pared se desprende y deja ver otro rostro tallado.',
      'La luna asoma entre las nubes y los cristales se encienden.',
      'Un eco repite una frase que nadie ha dicho.',
      'El suelo vibra: algo enorme cambia de postura bajo la piedra.',
      'Cae polvo de cristal, como una nevada violeta.',
      'Una cadena se rompe a lo lejos y retumba durante un minuto entero.',
      'Los ojos de un rey tallado parecen seguir a la compañía.',
      'Un viento helado sopla desde una galería sin salida.',
    ],
    encrucijadas: [
      { id: 'galeria-violeta', pregunta: 'Una galería baja hacia un resplandor violeta.', opciones: ['Quedarse en la superficie', 'Bajar a la galería'] },
      { id: 'ojo-coloso', pregunta: 'Un coloso abre un ojo de piedra.', opciones: ['Retroceder en silencio', 'Hablarle'] },
      { id: 'cadenas', pregunta: 'Una pasarela de cadenas cruza el abismo; la otra ruta da un largo rodeo.', opciones: ['Dar el rodeo', 'Cruzar por las cadenas'] },
      { id: 'tumba-ithra', pregunta: 'Una tumba sellada lleva un nombre grabado: Ithra.', opciones: ['Dejarla cerrada', 'Romper el sello'] },
    ],
  },
  {
    id: 'marisma',
    nombre: 'Marisma de los Faroles',
    misiones: [
      { id: 'faroles', objetivo: 'Encender los faroles hundidos',
        acciones: ['enciende un farol hundido', 'salta entre piedras sobre el agua negra', 'sigue a las luciérnagas por la pasarela'],
        reliquias: ['un farol que todavía arde', 'una mecha trenzada que no se moja'] },
      { id: 'torre', objetivo: 'Llegar a la torre en la niebla',
        acciones: ['avanza guiándose por una campana lejana', 'ata una cuerda a cada poste', 'sube una escalera de caracol inundada'],
        reliquias: ['la campana de la torre, verde de verdín', 'un catalejo con la lente rajada'] },
      { id: 'barquero', objetivo: 'Encontrar al barquero sin rostro',
        acciones: ['deja una moneda en el embarcadero', 'llama al barquero tres veces', 'sube a una barca que se mueve sola'],
        reliquias: ['una moneda con dos caras iguales', 'el remo del barquero, frío como el hielo'] },
      { id: 'puente', objetivo: 'Reparar el puente roto',
        acciones: ['clava tablones nuevos sobre el agua', 'rescata una viga que flota a la deriva', 'prueba el puente con un pie'],
        reliquias: ['un clavo de plata de los primeros constructores', 'una placa de bronce con el nombre del puente'] },
      { id: 'voces', objetivo: 'Dar descanso a las voces del agua',
        acciones: ['escucha nombres susurrados bajo el agua', 'deja flores blancas sobre la corriente', 'responde a una voz con su propio nombre'],
        reliquias: ['un anillo cubierto de algas', 'un relicario con un retrato borroso'] },
      { id: 'reina-luz', objetivo: 'Seguir a la reina de las luciérnagas',
        acciones: ['apaga su antorcha para ver mejor', 'sigue una luz más grande que las demás', 'se mete hasta la cintura en el agua tibia'],
        reliquias: ['un frasco con luz viva dentro', 'un ala translúcida grande como una mano'] },
      { id: 'pilotes', objetivo: 'Explorar la aldea sobre pilotes',
        acciones: ['entra en una casa vacía con la mesa puesta', 'sube a un tejado de juncos', 'encuentra un diario empapado'],
        reliquias: ['una red de pesca tejida con hilo de plata', 'la llave de la casa del alcalde'] },
      { id: 'bestia', objetivo: 'Burlar a la bestia de la ciénaga',
        acciones: ['camina sin hacer ruido sobre el musgo', 'lanza una piedra lejos para distraerla', 'contiene el aliento entre los juncos'],
        reliquias: ['una escama negra del tamaño de un escudo', 'un diente partido de la bestia'] },
      { id: 'espejos', objetivo: 'Alinear los espejos del santuario lunar',
        acciones: ['gira un espejo cubierto de barro', 'limpia el cristal con la manga', 've la luna reflejada tres veces'],
        reliquias: ['un espejo de mano que refleja otro cielo', 'una diadema de plata lunar'] },
      { id: 'naufragio', objetivo: 'Registrar el barco varado',
        acciones: ['fuerza la puerta del camarote', 'baja a la bodega inundada', 'iza una bandera desgarrada'],
        reliquias: ['la brújula de un capitán que apunta a la Lumbre', 'un cofre pequeño sellado con lacre'] },
    ],
    sucesos: [
      'Una niebla espesa sube del agua y borra la orilla.',
      'Los faroles parpadean a la vez, como si respiraran.',
      'Algo roza la pasarela desde abajo.',
      'Suena una campana lejana, aunque la torre está en silencio.',
      'Mil luciérnagas se elevan a la vez y dibujan un camino.',
      'El agua se queda quieta como un espejo negro.',
      'Una barca vacía cruza la marisma sin remero.',
      'Un farol se enciende solo al paso de la compañía.',
    ],
    encrucijadas: [
      { id: 'barca', pregunta: 'Una barca sin remero se acerca a la orilla.', opciones: ['Seguir a pie', 'Subir a la barca'] },
      { id: 'dos-caminos', pregunta: 'Los faroles marcan dos caminos: uno con luz y otro a oscuras.', opciones: ['Seguir la luz', 'Entrar en la oscuridad'] },
      { id: 'respira', pregunta: 'Algo grande respira bajo la pasarela.', opciones: ['Esperar a que se aleje', 'Pasar corriendo'] },
      { id: 'nombre-agua', pregunta: 'Una voz bajo el agua dice el nombre de alguien de la compañía.', opciones: ['No responder', 'Responder'] },
    ],
  },
];

/** Cómo está el cielo en cada expedición. «dia» no cambia el fondo. La escena pinta el resto con CSS. */
export const CLIMAS = [
  { id: 'dia', nombre: '' },
  { id: 'amanecer', nombre: 'al amanecer' },
  { id: 'ocaso', nombre: 'al ocaso' },
  { id: 'noche', nombre: 'de noche' },
  { id: 'niebla', nombre: 'entre la niebla' },
  { id: 'tormenta', nombre: 'bajo la tormenta' },
] as const;
export type Clima = (typeof CLIMAS)[number]['id'];

/** Expediciones completadas entre un capítulo y el siguiente. */
export const CAPITULO_CADA = 6;

/** El prólogo se ve desde el principio; cada capítulo, al completar CAPITULO_CADA expediciones más. */
/** Probabilidad de que el momento del suceso sea una encrucijada. */
export const PROB_ENCRUCIJADA = 0.4;
/** Cuánto dura la votación. Sin votos, o con empate, gana la opción prudente. */
export const VOTO_MS = 3 * 60_000;
/** El camino arriesgado alarga la expedición y da más renombre a cada participante. */
export const META_ARRIESGADA = 2;
export const BONO_ARRIESGADO = 3;

/**
 * Los capítulos con `audaz` tienen dos versiones: si en las encrucijadas la
 * compañía eligió más veces el camino arriesgado que el prudente, la audaz.
 */
export const CRONICA: readonly { titulo: string; texto: string; audaz?: { titulo: string; texto: string } }[] = [
  { titulo: 'La Última Lumbre', texto: 'Nadie sabe quién encendió la Lumbre. Solo que, mientras arda, el Velo se abre de vez en cuando y deja pasar a quien se atreva.' },
  { titulo: 'Las primeras huellas', texto: 'Las expediciones vuelven con barro de tres tierras distintas. En la Lumbre empiezan a colgar mapas que nadie había dibujado.' },
  { titulo: 'El ciervo de ámbar', texto: 'Un vigía jura haber visto un ciervo de luz en la Fronda. Desde esa noche, las brasas del refugio arden de color miel.' },
  { titulo: 'Voces en la piedra', texto: 'En las Canteras, los ecos tardan cada vez más en responder. Como si alguien, al otro lado, pensara antes de contestar.' },
  { titulo: 'Los faroles despiertan', texto: 'Cada farol encendido en la Marisma sigue ardiendo cuando la compañía se marcha. Ya se ven desde la Lumbre.' },
  { titulo: 'El primer nombre', texto: 'Entre las reliquias aparece un nombre grabado una y otra vez: Ithra. Nadie en el refugio lo había oído nunca.' },
  { titulo: 'La tormenta de ceniza', texto: 'Una noche, el Velo escupe ceniza durante horas. Al amanecer, las tiendas tienen huellas de manos por fuera.' },
  { titulo: 'Ithra', texto: 'Las tablillas de las Canteras lo cuentan: Ithra fue la reina que tejió el Velo para encerrar algo. O para protegerlo.' },
  { titulo: 'El barquero habla', texto: 'El barquero sin rostro rompe su silencio por primera vez: «La Lumbre no es un refugio. Es una llave».' },
  { titulo: 'La llave', texto: 'Juntas, las reliquias vibran al acercarse al brasero. La compañía entiende que no solo explora: está reuniendo algo.' },
  { titulo: 'La grieta', texto: 'El Velo ya no se cierra del todo. Por la grieta asoma una cuarta tierra que todavía no tiene nombre.' },
  { titulo: 'Lo que guardaba el Velo', texto: 'Al otro lado no hay un monstruo. Hay otra Lumbre, mucho más antigua, apagada hace siglos.' },
  { titulo: 'Los que vinieron antes', texto: 'Los mineros perdidos, el ermitaño, el capitán varado: todos fueron compañías como esta, y dejaron su reliquia para quien llegara después.' },
  { titulo: 'La pregunta de Ithra', texto: 'En el santuario lunar queda una pregunta grabada: ¿mantener viva la Lumbre, o abrir el Velo para siempre? Cada encrucijada que elegís es una respuesta.' },
  { titulo: 'La Lumbre responde', texto: 'La compañía ha elegido con prudencia. El fuego crece y, por primera vez en siglos, suena música en el refugio.',
    audaz: { titulo: 'El Velo se rasga', texto: 'La compañía ha elegido sin miedo. El Velo se rasga de lado a lado y, al otro lado, la vieja Lumbre vuelve a encenderse.' } },
  { titulo: 'El Linde sigue abierto', texto: 'La crónica no termina: cada expedición añade una línea. El Velo espera a la próxima compañía.',
    audaz: { titulo: 'Dos Lumbres', texto: 'Ahora arden dos fuegos, uno a cada lado del Velo. La crónica no termina: la próxima compañía decidirá qué hay más allá.' } },
];

export const TOTAL_RELIQUIAS = REGIONES.reduce((n, r) => n + r.misiones.length * 2, 0);

export function buscarEncrucijada(regionId: string, id: string | null | undefined): Encrucijada | undefined {
  return REGIONES.find((r) => r.id === regionId)?.encrucijadas.find((e) => e.id === id);
}

export function buscarMision(regionId: string, misionId: string | null | undefined): Mision | undefined {
  return REGIONES.find((r) => r.id === regionId)?.misiones.find((m) => m.id === misionId);
}
