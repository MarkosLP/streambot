# El Linde del Velo — arte, mundo y textos (fase 0)

Encargo de Codex en [ENCARGO-CLAUDE-MMO.md](ENCARGO-CLAUDE-MMO.md); plan y contrato en [MMO-CHAT-24H.md](MMO-CHAT-24H.md). 2 de octubre de 2026. **Nombre, lugares, placa y tono de los textos están aprobados por Crid4m** (ver «Decisiones tomadas»); el motor de Codex sigue mandando en reglas, tiempos y premios.

Prototipo: `http://127.0.0.1:7070/biblioteca/overlays/mmo-prototipo.html` (rota los cuatro estados cada 7 s; botones arriba para fijar uno). `?estado=calma|expedicion|resultado|desconexion`, `?region=cantera|marisma` y `?limpio=1` sin botones. Estático: no lee el bot ni está en OBS.

Capturas en [previews/mmo/](previews/mmo/): calma, expedición (las tres regiones), resultado y desconexión.

## Nombre y premisa

**El Linde del Velo.** (Propuesta en lugar de «La Frontera», que es genérico y no se puede buscar.)

> Más allá del último campamento hay una niebla viva, el Velo, que cada cierto tiempo se abre y deja ver tierras que nadie ha cartografiado. Una compañía de aventureros del chat vigila desde la Última Lumbre: cuando el Velo se abre, salen juntos antes de que vuelva a cerrarse.

Encaja con el motor tal cual: la expedición tiene un plazo («el Velo se cierra en 12:40»), funciona con una persona y la calma es «la Lumbre arde tranquila». El ojo arcano del contador de espectadores reaparece en la placa «Crid4m está ausente», para que el mundo y el canal se sientan de la misma familia.

## El refugio y las tres regiones

Cada lugar tiene su fondo pintado (GPT Image, `biblioteca/imagenes/mmo/`, prompts en `prompt.txt`) y un color de acento que tiñe la barra, los rombos de la compañía y el borde del comando principal. La interfaz es la misma en todas: oro viejo sobre cristal oscuro, como la barra del jefe.

| `id` (motor) | Nombre propuesto | Acento | Personalidad | Objetivo en pantalla | Hallazgo al completar |
|---|---|---|---|---|---|
| — (calma) | **La Última Lumbre** | Fuego / violeta | Campamento en un acantilado; brasero, tiendas y estandartes; el Velo al fondo. | «Próxima salida: …» | — |
| `bosque` | **Fronda Ámbar** | Ámbar `#f0a24a` | Bosque de árboles colosales, luz dorada entre raíces, un santuario olvidado. Cálido y antiguo. | Abrir camino entre las raíces | Un altar de savia antigua |
| `cantera` | **Canteras del Eco** | Violeta `#b48cff` | Cantera abandonada con rostros de reyes tallados, cristales violeta, luna fría. Solemne. | Despertar a los colosos de piedra | El rostro de un rey olvidado |
| `marisma` | **Marisma de los Faroles** | Turquesa `#5fe0c8` | Marisma nocturna con faroles de piedra hundidos, puente roto, torre en la niebla. Melancólica. | Encender los faroles hundidos | Un farol que todavía arde |

Codex ya los lleva en `REGIONES` del motor (`src/interactions/mmo/index.ts`), con su objetivo, hallazgo y frases de `!explorar`; los `id` no cambiaron.

## Textos para el chat

Cortos (todos muy por debajo de 200 caracteres), sin emojis amontonados y válidos con una sola persona. `{…}` son huecos.

**`!mundo`**
- Calma: `🔥 El Linde del Velo · La compañía descansa en la Última Lumbre. Escribe !explorar para salir hacia {región}. Basta con una persona.`
- Expedición: `🧭 La compañía explora {región}: {actual}/{meta}. El Velo se cierra en {mm} min. !explorar para ayudar.`
- Resultado: `✨ La compañía vuelve de {región} con {hallazgo}. Nueva salida en {s} s.`
- Apagado o en pausa: `🌫️ El Velo está cerrado ahora mismo. Vuelve cuando Crid4m abra el mundo.`

**`!explorar`** (una frase por región, al azar; el motor ya dice si hay que esperar)
- Fronda Ámbar: `{nombre} aparta una cortina de raíces ({actual}/{meta}).` · `{nombre} sigue un rastro de brasas…` · `{nombre} trepa a un tronco caído para mirar lejos…`
- Canteras del Eco: `{nombre} limpia el polvo de una inscripción…` · `{nombre} cruza una pasarela de cadenas…` · `{nombre} oye un eco que responde a su voz…`
- Marisma de los Faroles: `{nombre} enciende un farol hundido…` · `{nombre} salta entre piedras sobre el agua negra…` · `{nombre} sigue a las luciérnagas por la pasarela…`
- Primera acción (sale del refugio): `🔥 ¡{nombre} cruza el Velo hacia {región}! La compañía sale: {actual}/{meta}.`
- Espera: `{nombre}, recupera el aliento: podrás explorar en {s} s.`

**Resultado de grupo**
- Varias personas: `✨ ¡Expedición completada en {región}! {nombres} encuentran {hallazgo}. +{renombre} de renombre para cada uno.`
- Una sola: `✨ ¡{nombre} completa la expedición en solitario y encuentra {hallazgo}! +{renombre} de renombre.`
- El Velo se cierra sin terminar: `🌫️ El Velo se cierra: la compañía vuelve a la Lumbre con {actual}/{meta}. Nadie pierde nada; a la próxima.`

**`!expedicion`**: `🧭 {nombre}: {expediciones} expediciones · {renombre} de renombre{ · en la compañía actual: N aportes}.`

## La escena (1920 × 1080)

Con las cuatro zonas del plan, pensada para leerse en el reproductor pequeño de Twitch (letra mínima de 22 px a 1080p):

- **Arriba izquierda:** «El Linde del Velo», el lugar actual y una pastilla de estado (En calma · Expedición · ¡Completada! · Reconectando).
- **Arriba derecha:** «Crid4m está ausente · El mundo sigue: jugad vosotros», con el ojo arcano.
- **Lateral derecho:** objetivo, cifra grande, barra por segmentos (uno por aporte), reloj del Velo y la compañía (nombre y un rombo por aporte, hasta 5 personas).
- **Centro:** solo en calma (invitación grande a `!explorar`), resultado (hallazgo, nombres y renombre) y desconexión. Durante la expedición queda libre para que luzca el paisaje.
- **Abajo:** las últimas tres acciones, que se desvanecen, y los tres comandos; `!explorar` resaltado.
- **Desconexión:** el fondo se desatura y desenfoca, los datos quedan grises y aparece «Reconectando con el mundo». No inventa progreso.

Los nombres se pintan siempre como texto (`textContent`), nunca HTML.

## Contrato: lo que pediría añadir (para revisar con Codex)

Nada de esto rompe la `version: 1`; son campos nuevos.

1. **`acciones`**: las últimas 3 acciones aceptadas, `[{ quien, texto, at }]`, para la franja inferior. Sin esto, la escena solo puede mostrar `ultimoSuceso`. `texto` sería la frase de `!explorar` ya elegida por el motor (así chat y pantalla dicen lo mismo).
2. **`resultado`** en la fase de resultado: `{ completada: boolean, hallazgo: string, renombre: number }`. Hoy el overlay tendría que deducir si se completó leyendo `ultimoSuceso`.
3. **`proximaRegion`** en calma, para «Próxima salida: …». Hoy `estado()` ya pone en `region` la siguiente cuando la fase es calma, así que esto es opcional si se documenta.
4. **`nombre`** de los participantes respetando `!olvidame` y la moderación: ya está previsto en el plan; solo recordar que también aplica a `acciones`.

## Recursos visuales

**Imprescindibles para la primera escena (hechos):** 4 fondos pintados, `refugio`, `bosque`, `cantera`, `marisma` (1920×1088, unos 0,25 $ en total). Lo demás del prototipo es CSS sobre esos fondos y el icono del ojo, que ya existía.

**Después (sin generar; solo cuando Crid4m lo pida):**
- Animación ligera por región, en CSS sobre el fondo: brasas en la Lumbre, hojas en la Fronda, polvo en las Canteras, luciérnagas en la Marisma.
- Una ilustración del hallazgo de cada región para el cartel de resultado (3 imágenes con fondo transparente).
- Una variante de «noche» o «tormenta» de cada fondo para cuando el Velo está a punto de cerrarse.
- Emblema del mundo (sello de El Linde del Velo) para el título y para las alertas.
- Fase 5: retratos de amenazas o un jefe del Velo que aparezca a mitad de expedición (reutilizando el sistema de jefes).
- Sonidos: entrada al Velo, aporte y expedición completada. El plan dice que la escena no lleva audio propio; si se quieren, irían por el sistema de sonidos existente.

## Decisiones tomadas (Crid4m, 2 oct 2026)

Definitivas para la fase 2 y siguientes: no volver a proponerlas salvo que él lo pida.

1. **Nombre del mundo: El Linde del Velo.**
2. **Base del mundo: La Última Lumbre y las tres regiones** (Fronda Ámbar, Canteras del Eco, Marisma de los Faroles), **con los fondos de `biblioteca/imagenes/mmo/`.** Nuevas regiones o variantes, en la fase 5 y sobre esta base.
3. **La placa dice «Crid4m está ausente»**: explica por qué el chat puede seguir jugando solo. No cambiarla por «Vuelvo pronto» ni similares.
4. **El tono de los textos del chat se mantiene, sin acortarlos** por ahora. Si en la prueba con gente real algo sobra, se revisará con los datos delante.
