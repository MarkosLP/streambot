# Plan futuro: Loot, jefes y participación del chat

**Estado:** propuesta para otra sesión. No hay mecánicas de este documento implementadas ni aprobadas para entrar en directo. Revisar el equilibrio con Crid4m antes de programar. El orden recomendado está al final.

## Punto de partida (29 de septiembre de 2026)

- Hay diez jefes con retrato, aura y un especial distinto. Un jefe dura como máximo tres minutos, tiene 200 de vida por persona activa al invocarlo y cada `!atacar` tiene diez segundos de espera. Lanza un especial una vez, al bajar al 60 % de vida.
- El bot procura hablar poco: aparición, aviso de mitad de vida y resultado; los golpes normales se ven en OBS. El overlay ya cuenta golpes acertados. Quien haya pegado recibe cofre si cae el jefe y el MVP obtiene un premio mejor y puntos de temporada.
- Ya existen duelos, forja de tres objetos, colección, regalos, objetos malditos, eventos semanales, temporadas y `!usar` para tres objetos con efecto real. No conviene duplicar esas funciones.
- El canal suele tener también peleas con **una a tres personas**: ninguna mecánica puede exigir una multitud. Los jefes y duelos comparten la fuente «FX Jefe»; el diseño compacto deja visible el juego.
- Las imágenes de los paneles de Twitch contienen texto incrustado. Si añadimos comandos, habrá que actualizar el panel «Comandos», su ayuda en `!loot` y la Biblioteca.

## Principios de diseño

1. **El jefe debe dar una decisión, no solo quitar vida.** El espectador ha de entender en pocos segundos qué pasa, qué puede hacer y qué consiguió el grupo.
2. **Pocos comandos nuevos.** Reutilizar `!atacar` y `!usar`; añadir `!cubrir` y `!bestiario` solo si demuestran utilidad. No obligar a memorizar una orden distinta para cada jefe.
3. **Con uno o dos participantes también se juega.** Escalar requisitos según personas que realmente atacaron al jefe, no según espectadores o mensajes en el chat.
4. **Recompensas moderadas.** No convertir bits, subs ni objetos raros en victorias automáticas. Las mejoras más duraderas serán títulos, estadísticas y apariencias. Mantener el botín útil sin inflar la economía.
5. **El juego sigue siendo protagonista.** Aviso visible solo durante la mecánica, en el marco compacto. Sonidos breves. Nada de paneles permanentes tapando Aion 2 u otros MMO.
6. **Silencio cuando no toca.** Como punto de partida, máximo cuatro mensajes del bot por jefe. No responder a cada `!atacar` ni a cada `!cubrir`; el overlay muestra el progreso. Ajustar el mensaje de mitad de vida para no repetir el del especial.
7. **El sistema debe sobrevivir a recargas.** Una fuente de OBS que se abre a mitad de pelea muestra el estado actual sin repetir sonidos, efectos ni recompensas.

## Fase 0: medir antes de ajustar

Registrar por jefe, en el sistema de datos local: tipo, motivo de aparición, participantes únicos, duración, golpes acertados/fallidos, vida al terminar, especial ocurrido, respuestas recibidas, resultado y premios. No guardar el texto ordinario de la charla. Mostrar en el panel un resumen pequeño de las últimas peleas y una forma de exportarlo para revisar el equilibrio.

Con los primeros directos, comprobar: cuánto dura una pelea con 1, 2, 3 y más participantes; cuántas terminan en victoria; cuántos golpes se pierden por el cooldown; si la gente entiende los especiales; si la barra coincide con lo que ve el chat. La duración objetivo provisional sería **1–2 minutos**, con posibilidad real de perder. No fijar probabilidades definitivas sin esos datos.

## Fase 1: especiales que se pueden contrarrestar

Al llegar al umbral actual del 60 %, el especial entra en estado **preparando** durante 10–12 segundos. Aparece un aviso en el marco con icono, nombre, objetivo y una instrucción concreta. Al terminar, se resuelve una sola vez y el overlay enseña si el chat lo frenó, lo redujo o lo sufrió entero.

**Una nueva acción principal:** `!cubrir`. Solo funciona durante la preparación de un especial dañino, una vez por persona y especial. Cuenta como una decisión defensiva: quien cubre pospone su siguiente ataque. La persona objetivo puede cubrirse si pelea sola. El número necesario se calcula con participantes únicos de *esta* pelea; empezar con uno si participa una persona, dos si participan 2–5 y un máximo prudente para grupos grandes. Ajustarlo tras probar, no dejar un umbral fijo que vuelva imposible una pelea pequeña.

Para curaciones e invocaciones, **`!atacar` ya es la respuesta**: los golpes durante la preparación llenan una pequeña barra de interrupción. Una curación interrumpida se reduce, no desaparece siempre. Respetar el cooldown actual; la ventana debe ser lo bastante larga para que alguien que acaba de golpear tenga al menos una oportunidad. El especial cómico del Tanque mantiene su fallo propio sin exigir una reacción.

| Jefe | Aviso y respuesta propuesta | Si el chat reacciona |
|---|---|---|
| Dragón de Escarcha | Prepara Aliento helado sobre una persona; `!cubrir`. | Congelación más corta o evitada. |
| Rey Esqueleto | Invoca muertos; `!atacar` alimenta la interrupción. | Recupera menos vida. |
| Hidra del Pantano | Va a envenenar; `!cubrir`. | Menos duración del daño reducido. |
| Gólem de Obsidiana | Carga Terremoto contra todos; varias personas `!cubrir`. | Aturdimiento colectivo más corto. |
| Liche sin Nombre | Canaliza Drenar alma; `!atacar` interrumpe. | Roba menos vida. |
| Araña Reina | Marca a alguien para atraparlo; `!cubrir`. | Telaraña rota o más breve. |
| Kraken del Foso | Arrastra a alguien; `!cubrir`. | Regresa antes al combate. |
| Minotauro con Resaca | Prepara Vomitona; defensa de grupo. | Menos personas fallan su próximo golpe. |
| Tanque que no sabe tanquear | Sigue provocando y pegándose solo. | Ninguna orden extra; se celebra el momento. |
| Lag Primigenio | Prepara Desconexión; `!cubrir`. | Reconexión más rápida. |

**Casos que deben quedar definidos:** si el jefe muere durante la preparación, el ataque se cancela; si se acaba el tiempo, se escapa sin lanzar un especial tardío. No contar dos veces mensajes repetidos, bits o reconexiones. Un `!cubrir` fuera de ventana no gasta nada ni ensucia el chat. Si OBS o Streamer.bot se desconectan, el estado del combate manda y el overlay se recupera al volver. El canje Lag puede parar el reloj del jefe, pero no dejar una preparación congelada indefinidamente.

**Presentación:** la barra actual cambia durante unos segundos: color de alarma del propio jefe, nombre del ataque y «`!cubrir` a [nombre]» o «`!atacar` para interrumpir». Un medidor discreto muestra 0/1, 1/2, etc. Al resolverse, un mensaje breve («¡Protegido!», «Interrupción parcial» o el efecto original). No abrir otra pantalla grande.

## Fase 2: objetos del botín con uso táctico

Extender el `!usar` existente con **dos o tres objetos de combate**, primero probados sin premios adicionales:

- **Bálsamo o antídoto:** quita veneno o acorta una maldición/ralentización. No cura al jefe ni añade daño.
- **Cuchilla de rescate:** libera antes a un aliado congelado, atrapado o arrastrado. El efecto se muestra en el medallón o la pista del jefe.
- **Pergamino de interrupción:** suma una pequeña cantidad al intento colectivo contra Esqueleto o Liche. No basta él solo para cancelar la curación.

Un objeto se consume solo si su efecto puede aplicarse. Máximo un uso de combate por persona y jefe, más un límite de usos totales por pelea para que una mochila grande no la decida. Decidir antes si se reutilizan nombres del catálogo o se añaden estos tres; documentar la probabilidad de obtención y revisar que `!forjar`, `!dar`, `!purificar` y el `!usar` actual sigan funcionando. Si se permite objetivo (`!usar nombre @persona`), el parser debe pedir confirmación textual cuando haya ambigüedad, no gastar el objeto equivocado.

**Idea adicional para botín sobrante:** una ofrenda de duplicados comunes para obtener un pequeño beneficio **del grupo** en el siguiente jefe, con un tope por directo. Es una posible salida para inventarios llenos, no una moneda nueva. Posponerla hasta medir si realmente sobran objetos; la forja ya cumple parte de esa función.

## Fase 3: bestiario y motivos para volver

`!bestiario` sería una consulta personal corta: jefes distintos enfrentados y derrotados, mejor golpe, número de MVP y el siguiente que falta. `!bestiario dragon` daría su historial contra un jefe concreto. La Biblioteca podría mostrar el progreso completo, sin meter diez líneas en el chat. Guardar estadísticas por **ID de Twitch**, separando participaciones, victorias, golpes, daño y MVP. Excluir pruebas del panel y al propio canal de rankings competitivos; respetar el borrado de datos que ya existe.

Recompensas **cosméticas** propuestas: títulos por primer jefe vencido, cinco tipos distintos y colección completa de diez; quizá un marco distinto en `!presumir`. Evitar regalar un legendario por cada hito: ya hay cofres de jefe, forja y premios de temporada. Opcionalmente, «cazador de la semana» en el panel rotativo, con límite de aparición para que no eclipse otras tarjetas.

**Ideas para más adelante:**

- Una rareza de jefe **élite** ocasional: mismo retrato con corona/aura especial, algo más de vida, un modificador anunciado y premio cosmético. Activarla solo tras equilibrar las peleas normales.
- **Hazañas del grupo:** vencer sin que nadie quede atrapado, salvar a la persona marcada, ganar con menos de 15 segundos. Mostrar una al final, sin perseguir diez objetivos simultáneos.
- **Encuentros enlazados:** dos victorias en una semana desbloquean una aparición especial. No alterar el límite de mensajes ni obligar a jugar horas concretas.
- **Marcador histórico del canal:** jefe más resistente, derrota más ajustada, golpe récord. Usarlo como anécdota al cerrar la pelea, no como ranking permanente en pantalla.
- **Pistas de botín:** ciertos objetos describen una vulnerabilidad de un jefe en `!inventario` o `!bestiario`. Debe ser información útil, no una ventaja secreta imprescindible.
- **Eventos semanales** que varíen una regla del combate, aprovechando el sistema actual: más tiempo para cubrir, interrupciones más difíciles o jefes con mayor probabilidad de cierto tipo. Mostrar la regla antes de empezar.
- **Predicción puntual** «¿Cae este jefe?» usando la función nativa de Twitch, si Crid4m quiere jugar con puntos del canal. No construir una segunda economía de apuestas ni automatizar la resolución hasta probar el flujo manual.
- **Duelo y jefes conectados solo de forma cosmética:** por ejemplo, el ganador del último duelo recibe una mención en la entrada del siguiente jefe. Evitar bonos de daño que hagan los duelos obligatorios.

## Interfaz y operación

El panel de control debe ofrecer un interruptor para la nueva mecánica, estado de preparación, participantes, contador de `!cubrir`, tiempo restante y un botón de prueba aislada. Crid4m debe poder cancelar una pelea o forzar el especial a terminar si algo falla, sin entregar premios duplicados. La demo de Biblioteca debe permitir probar cada jefe en tres estados: antes del especial, preparación y resultado; también con una y varias personas.

Actualizar ayuda `!loot`, documentación de comandos y los paneles de Twitch con texto incrustado **solo cuando un comando quede aprobado e implementado**. Mantener el arte genérico de fantasía: el bot se usará también fuera de Aion 2.

## Orden de implementación para la próxima sesión

1. Revisar con Crid4m este plan y elegir solo la **Fase 1** como primer alcance. Medir la línea base con el laboratorio actual.
2. Modelar preparación, respuesta y resolución en `src/interactions/loot/jefe.ts`; poner los efectos y parámetros por jefe en `especiales.ts`. Añadir `!cubrir` al registro de comandos con un único cooldown claro. Conservar la lógica vieja detrás de un ajuste para poder volver atrás durante el primer directo.
3. Dibujar el aviso en `biblioteca/overlays/jefe.html` dentro del marco compacto. Añadir demos reproducibles y prueba visual a 1920×1080 con el juego visible.
4. Simular peleas con 1, 2, 3 y muchos participantes; probar spam, empates, muerte durante preparación, reloj agotado, reconexiones, bits y canjes simultáneos. Pasar TypeScript, tests y ensayo en OBS grabado antes de activarlo en directo.
5. Tras uno o dos directos, revisar duración, claridad y uso real de `!cubrir`. Solo entonces decidir Fase 2 (objetos) y Fase 3 (bestiario). Dejar variantes élite y eventos enlazados para después.

**Criterio de éxito:** una persona nueva comprende el aviso sin leer una guía, alguien puede salvar la situación aun con poco chat, el jefe puede ganar y Crid4m sigue pudiendo jugar sin administrar el bot. Si una idea añade ruido sin mejorar esa experiencia, se descarta.
