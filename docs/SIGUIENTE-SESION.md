# Dónde lo dejamos — 26 sep 2026 (madrugada)

Traspaso para la próxima sesión. **Lo primero de todo está en la sección 00.**

---

## 00. Estado a 26 sep, y lo primero de la próxima vez

### Lo que hay, hecho y guardado (371 tests, 0 fallos)

**Panel** (http://127.0.0.1:7070): botonera de efectos, pestañas Efectos, **Loot**, Biblioteca, Interacciones, Espectadores y Registro. Guías de montaje en español, por fases.

**Efectos con Oro**, montados y probados en tu PC: Grito de guerra, Poción de vida y Maldición. Lag y Terremoto esperan a los plugins Freeze Filter y Move de OBS.
- **Preparar en OBS** crea `FX Pocion`, `FX Maldicion`, `FX Lag` y `FX Botin`, ocultos o apagados y a pantalla completa. OBS 32.2.2, escena `EMPEZAMOS`, juego en `Captura de ventana`.
- **Importar en Streamer.bot**: el panel genera el código de Import. El formato sale de exportaciones reales (`src/panel/muestras-streamerbot/`).

**Loot del chat** (sin probar aún en un directo de verdad):
- Cofre cada 20-30 min para quien haya escrito en los últimos 15 min. **Cofre del tesoro** con Oro (lo abre el bot, no lleva acción en Streamer.bot).
- Banner en OBS para **cada** botín, con el color de su rareza. Las tiradas de prueba del panel también salen en OBS.
- Mochila de 20. `!inventario` `!poder` `!duelo nombre` `!forjar` `!presumir` `!coleccion` `!purificar` `!loot`. Títulos por completar una rareza.
- **Efectos conectados**: Grito de guerra → cofre de guerra en 1-2 min (solo armas). Maldición → objeto maldito (poder doble; se pierde al perder un duelo). Poción de vida → `!purificar`.

**Iconos de Twitch** en `biblioteca/imagenes/twitch/`: moneda Oros (28/56/112) y uno por recompensa (28/56/112). Fuente en `docs/iconos/`.

### Añadido el 26 sep por la mañana (381 tests)

- **Regalar cofre** (panel → Loot): cuando quieras, haya hablado alguien o no. Vacío = uno para cada persona del chat (según Streamer.bot, también quien no escribe); o un nombre concreto, aunque pasara por el chat otro día. Cofre normal o del tesoro. Nunca a bots (`src/core/bots.ts` + `IGNORED_LOGINS`) ni al canal.
- **Grito y Maldición**: sí escribían en el chat, pero si algo lo impedía se callaban sin rastro. Ahora el motivo queda en el Registro, un segundo Grito se anuncia ("se une al grito") y el nombre de la recompensa vale con emojis o mayúsculas. Una recompensa que el bot no usa sale en la consola.
- **Catálogo**: 51 → 94 objetos, con más armas en cada rareza para el cofre de guerra.
- **Cofre de guerra sin nadie**: se queda en el suelo 10 min y se lo lleva el primero que escriba (antes se perdía en silencio: el canal no cuenta para los cofres).
- **Jefe de raid** (panel → Loot → Invocar jefe): 200 de vida por persona hablando, un ataque cada 10 s, 3 min, `!atacar`. Si cae, cofre para cada atacante y Cofre del tesoro para el MVP. El bot habla 3 veces por jefe (tope de 12 mensajes/hora).
- **`!dar nombre [rareza|objeto]`**: regalar objetos. Los malditos no se regalan.
- **`!usar`**: Cuerno de guerra 🟣 (Grito + cofre de guerra), Frasco de agua bendita 🔵 (¡Bebe agua! + purifica), Calavera que susurra 🟣 (Maldición + objeto maldito). Lanzan la Action de Streamer.bot de su recompensa; 2 min entre efectos.
- Paneles de Twitch regenerados con `!dar`, `!usar` y `!atacar`: hay que volver a subir comandos.png y loot.png.
- **El canal juega al Loot** como uno más (cofres, jefe, regalos, `!dar`). Interruptor «Yo también juego» en el panel; `LOOT_CANAL_JUEGA` en el `.env`.
- **Barra del jefe en OBS** (`biblioteca/overlays/jefe.html`, fuente `FX Jefe`): emblema, vida con rastro, reloj, números de daño (críticos en dorado), aviso al aparecer y rótulo final con podio. Se crea desde Efectos → Preparar en OBS → «Barra del jefe». Queda VISIBLE siempre: sin jefe es transparente. Pregunta al bot cada 0,5 s por `GET /api/overlay/jefe` (única ruta con CORS). Vista previa: `jefe.html?demo=1`.
- **Dos techos de mensajes**: 12/hora lo que el bot dice solo (`BOT_MESSAGES_PER_HOUR`) y 200/hora (antes 60: la prueba de resistencia dejó 115 sin salir) las respuestas a comandos, canjes y botones del panel (`BOT_RESPUESTAS_PER_HOUR`). Antes era uno solo de 12, y un jefe con regalos lo agotó en 10 min dejando a la gente sin `!inventario`.
- **Biblioteca**: galería con subcarpetas, visor, filtros y vistas previas de overlays con variantes.
- **`!dar` rehecho**: `!dar` solo enseña tus objetos numerados; `!dar ana` pregunta qué le das; `!dar ana 2` le da el 2. Siguen valiendo rareza y parte del nombre.
- **Duelos en OBS**: en la misma fuente `FX Jefe` (nada que montar). VS, barra de probabilidades con una aguja que cae en el lado del ganador, ¡GANA!, ¡SORPRESA! y el maldito que cambia de manos. Vista previa: `jefe.html?demo=duelo`.
- Prueba con raftaei (26 sep, 12:48-13:01): el jefe caía en 73 s y la mitad de los !atacar se perdían en la espera de 15 s → 200 de vida/persona y 10 s. El registro del final del jefe ya dice si el mensaje salió.
- **Cada jefe con su aspecto**: retrato SVG propio en el medallón y en el aviso, colores de la barra y un ambiente en los bordes (nieve, almas, burbujas tóxicas, brasas con temblor en críticos, runas, telarañas y arañas colgando, tentáculos, «¡hic!», «MISS», glitch). En `jefe.html`, `TEMAS`; el tipo viene de `JEFES` en `jefe.ts`. En el panel se puede elegir qué jefe invocar. Vista previa: `jefe.html?demo=1&jefe=arana`.
- **Ataque especial del jefe** (`especiales.ts`): uno por combate al bajar del 60 %. Congelar, atrapar, desconectar o arrastrar a alguien 15 s; aturdir a todos 8 s (gólem); curarse (esqueleto, liche); envenenar (hidra: la mitad de daño); vomitona (todos fallan el siguiente); el tanque se pega solo. Una línea en el chat y cartel en el overlay, con quién está afectado bajo la barra.
- **Sonidos más bajos**: los overlays suenan al 35 % (antes 80 %). Se ajustan en el mezclador de OBS (pistas «FX Jefe» y «FX Botin») o con `?volumen=0.2` en la dirección de la fuente.
- **Terremoto sin plugin**: el bot mueve `Captura de ventana` (`OBS_FUENTE_JUEGO`) 5 s y la deja en su sitio (probado en su OBS el 26 sep: vuelve a 0,0). La Action de Streamer.bot, solo sonido + aviso; ya se puede importar. El plugin Move está instalado y cargado, pero no se usa.
- **El directo según OBS** (`core/directo.ts`): cada minuto pregunta a OBS si emite y abre o cierra el directo por el mismo camino que los avisos de Twitch. Si OBS deja de contestar 5 veces seguidas (y había contestado antes), lo cierra. «Marcar en directo para probar» del panel lo deja abierto aunque no emitas, hasta que lo cierres o haya una emisión de verdad.
- El Lag (Freeze Filter) ya funciona. Paneles de Twitch rehechos (26 sep): más épicos, con Terremoto y Lag en Recompensas, `!top`, el cofre de fidelidad y un cuarto panel «Jefes de raid». Hay que subirlos otra vez.
- **Cofre de fidelidad** (3+ directos seguidos, en el primer mensaje de cada directo) y **`!top`**. Las rachas se cuentan ya aunque las espontáneas estén apagadas.
- **Laboratorio de pruebas**: `npm run laboratorio` simula 8 personas usando comandos A LA VEZ (12 escenarios: cofre en el suelo, !usar doble, !dar cruzado, jefe en multitud, duelos cruzados con maldito, regalo + cofre, forja + dar, terremotos, jefes dobles, todo mezclado, ráfaga de 120) y comprueba que no se duplica ni se pierde nada. Con `--semilla=N` se repite una ejecución. 30 semillas limpias el 26 sep. Encontró un fallo: con «Yo también juego» apagado después de escribir, el canal seguía recibiendo cofres 15 min (arreglado).
- **Títulos** (pestaña nueva, IA local con Ollama, `qwen3.5:9b`): 10 títulos de la sesión + 3 «💬 del chat», anuncio para redes, categoría (el juego) y etiquetas. Todo son sugerencias para copiar; nada se conecta a Twitch ni a Discord. Favoritos (⭐) y usados (copiar = usado); la IA no repite ninguno. «Emojis por título» (0-3): paleta por tono de los que más se ven en títulos de Twitch; se recortan los que sobran. Los emotes de Twitch (KEKW…) no se ven en el título, por eso emojis. Dos peticiones separadas: con lo del chat en la misma, lo metía en todos. qwen2.5:7b se descartó (inventaba raids, Mayúsculas En Cada Palabra). En raids, poner el nombre de la raid en Notas o se inventa uno. ~40 s por tanda.
- **Panel consolidado**: menú Inicio · Loot · Efectos · Títulos · Espectadores · Biblioteca · IA y bot · Ajustes · Registro. «Directo» pasa a Inicio con **Acciones rápidas** (jefe, cofre a todo el chat, soltar cofre) y el estado del Loot. **Ajustes** nueva: los interruptores (Loot, Yo también juego, espontáneas, revisión) **se guardan** en la tabla `ajustes` y sobreviven a un reinicio; «Volver a lo del .env» los olvida; el de apagar el bot NO se guarda, a propósito. Desde Ajustes se lanza el **laboratorio** (proceso aparte). **Ficha de espectador** en Espectadores: mochila, poder y puesto, colección, duelos, racha y título.
- **Suscriptores** (`loot/mecenas.ts`, propuestas S1-S7 de docs/PROPUESTAS-SUBS-Y-JUEGOS.md): cofre de suscriptor al sub/resub (aniversarios 3/6/9 con más suerte, cada 12 meses legendario asegurado); regalar subs = cofre de bienvenida para cada quien recibe y hasta 5 cofres del tesoro para quien regala, en UN mensaje por tanda; 5+ de golpe, lluvia de cofres; raid entrante = cofre para quien la trae y jefe a los 30 s si trae 3+; bits = golpes al jefe (500 con crítico) o cofre desde 300 sin jefe; 💜 junto al nombre de los subs; mochila de 30; colección de mecenas (6 objetos, título «Mecenas del Reino», fuera de las colecciones de rareza). Quién es sub: avisos de Twitch + insignia de cada mensaje (tabla `suscriptores`).
- **PENDIENTE para los subs**: Streamer.bot 1.0 no tiene botón que mande esos avisos al bot, así que el panel (Loot → «Probar suscriptores») los simula; los mensajes salen al chat de verdad. Con el PRIMER aviso real de cada tipo, mirar logs/raw-events.log: la forma sale de los tipos de la librería (con los canjes no coincidía). Crid4m tiene «Gift Bombs: Ignored»: una bomba llega como UN aviso GiftBomb (ahora escuchado); bomba y sueltos se juntan en una tanda de 5 s sin contar dos veces.
- Hay que **reiniciar el bot** para tenerlo. 458 tests.

### Añadido el 26-27 sep por la noche (481 tests)

- **Temporadas** (`loot/temporada.ts`, `data/temporadas.ts`): cada mes, un ranking que empieza de cero; las mochilas no se tocan. Puntos: lo que vale el poder de cada objeto conseguido, +5 por duelo ganado y +10 para el MVP de un jefe. Al cambiar de mes, el podio va al Salón de la Fama con premio a la mochila (🥇 legendario, 🥈 épico, 🥉 raro), y el primero se queda para siempre el título «Campeón de <mes>» (por debajo solo de Leyenda Viviente). El canal y la gente `prueba-` no entran en el podio. `!top` es ahora el podio de la temporada; `!top poder` es el de siempre. `!temporada` explica los puntos. Los puntos empiezan a contar desde esta versión: septiembre sale casi vacío.
- **Evento de la semana** (`loot/eventos.ts`): cambia solo cada lunes entre Fiebre del oro, Semana maldita, Forja al rojo vivo, Coleccionista, Arena y Caza mayor. En panel → Loot se puede fijar uno o quitarlo (se guarda en `ajustes`, clave `evento`). Se anuncia en el chat con el primer mensaje de una persona en cada directo, junto al final de temporada si toca. `!evento` lo dice. En los tests no hay evento (lo quita `loot.reset`).
- **`!pj [nombre]`**: la ficha en una línea: poder y puesto, temporada, colección, duelos, racha, mochila y mejor pieza. **`!fundir`** es el mismo `!forjar`, que ya existía.
- **Inicio → Revisión previa**: comprueba el bot, Streamer.bot y sus Actions, OBS, la fuente del juego, las fuentes FX, el plugin Freeze, el Loot y Ollama. Solo lee.
- **Inicio → Resumen del directo**: duración, quién vino (y quién era nuevo), lo más usado, lo que no salió y por qué, cofres, jefes, duelos y botín destacado. Se puede elegir cualquier directo anterior.
- Panel de Twitch «Comandos» regenerado (`!pj`, `!top`, `!temporada`, `!evento`): hay que volver a subir **comandos.png**.

### Escenas (27 sep 2026, 488 tests)

- **Pestaña Escenas** del panel y un solo overlay, `biblioteca/overlays/escena.html?tipo=inicio|charla|pausa|final`, con el estilo de los paneles de Twitch (oro, morado, brasas, círculo de runas). Lee `GET /api/overlay/escena` (CORS abierto, solo lectura, como la del jefe).
  - **Empezamos**: título, cuenta atrás (o «en breve»), evento de la semana, podio de la temporada y últimos botines.
  - **Charla** (Just Chatting): marco dorado con el hueco de la cámara (48, 48, 1280×720, el mismo que `HUECO_CAMARA` en obs-setup.ts), chat en pantalla con emotes y colores, evento, podio y próximo cofre/jefe. `?fondo=0` lo deja sin fondo.
  - **Pausa**: reloj de arena y cuenta atrás.
  - **Final**: cifras del directo y créditos con los nombres de quien ha pasado.
  - Todas menos Final avisan de cada botín nuevo.
- **Avatar sin cámara**: interruptor en Escenas. Un encapuchado con ojos brillantes tapa el hueco en Charla: parpadea, respira, mira al chat, celebra el botín, se duerme a los 90 s sin chat, y lleva un bocadillo con el texto que pongas. Idea para más adelante: que mueva la boca con el micro (medidor de volumen de obs-websocket).
- Textos, cuenta atrás y avatar se guardan en `ajustes` (clave `escenas`) y el overlay los recoge en segundos, sin tocar OBS.
- **Crear en OBS** (con confirmación): escena `✦ Empezamos/Charla/Pausa/Final` con su overlay `ESC …` a pantalla completa. En Charla, además, tu cámara debajo encajada en el hueco y la barra del jefe (`FX Jefe`) encima. Nunca cambia la escena en emisión, no borra nada y, si ya existe, solo añade lo que falta.
- **Chat en pantalla** (`core/chat-reciente.ts`): solo en memoria (últimos 30), nunca de quien pidió `!olvidame`. Lo que borra un moderador (mensaje borrado, expulsión, silencio, chat vaciado) desaparece también del overlay: el bot escucha ahora ChatMessageDeleted, UserTimedOut, UserBanned y ChatCleared. Emotes solo de Twitch, 7TV, BTTV y FFZ; colores solo `#RRGGBB`.
- **Sin comprobar con Streamer.bot de verdad**: la forma de los emotes y del color en ChatMessage, y los avisos de moderación. Se leen con tolerancia; si no llegan, el chat sale sin emotes y con colores inventados, y lo borrado no desaparece hasta que lo empujen mensajes nuevos.

### Precios y límites acordados

| Recompensa | Coste | Espera (s) | Máx. por directo | Máx. por persona |
|---|---:|---:|---:|---:|
| Poción de vida | 500 | 600 | — | 2 |
| Grito de guerra | 750 | 600 | 4 | 1 |
| Cofre del tesoro | 1.500 | 300 | — | 2 |
| Maldición | 2.500 | 1200 | 2 | 1 |
| Terremoto | 3.000 | 1200 | 2 | 1 |
| Lag | 5.000 | 1800 | 1 | 1 |

### Lo primero de la próxima vez

1. **Reinicia el bot** (sin estar en directo): trae los efectos conectados y `!purificar`.
2. ~~Puntos de canal e iconos de las recompensas~~ **Hecho el 26 sep.** Las recompensas ya estaban en Twitch; solo hubo que ponerles icono. No se rehicieron, así que no cambia ningún id.
3. **Subir los paneles** de `biblioteca/imagenes/twitch/paneles/` (Comandos, Recompensas, Loot). Cómo, en `docs/paneles/README.md`.
4. **Probar el Loot con dos personas**: `crid4n` desde el móvil escribe en el chat; probar `!duelo`, un Grito de guerra con directo abierto y una Maldición seguida de un duelo.

### Cosas a tener en cuenta

- Los tamaños y posiciones de las fuentes `FX` en OBS son a propósito.
- Si arrancas el bot con el directo ya empezado, en la pestaña Loot pulsa **El directo ya ha empezado**. Y **Terminar directo** si se queda marcado sin estar emitiendo.
- Siguiente en la lista: retos al jugador, predicciones y contador de wipes. Ideas para Terremoto y Lag cuando haya plugins (el terremoto tira un objeto al suelo y se lo lleva el primero que escriba `!coger`).

---

## 0. CAMBIO DE RUMBO (sesión del 24-25 sep)

**Lo que dijiste:** conectar los Channel Points con la IA no te termina de
convencer. Quieres que esto sirva para **sacarle partido a Streamer.bot**:
comandos interesantes, juegos con el chat y añadidos que, mientras juegas o
haces Just Chatting, inviten a quedarse y divertirse. Los juegos de grupo,
para cuando haya gente.

**Lo que eso significa:**
- La IA pasa a ser un ingrediente más, no el centro. `#5 Pregunta a Crid4m AI` se queda como un comando más.
- Primero, lo que funciona con **1-3 espectadores** y **se ve en pantalla** (Streamer.bot → OBS).
- Lo sencillo (sonidos, filtros) se monta **directamente en Streamer.bot**. Nuestro código se reserva para lo que tiene **estado o memoria**: juegos, marcadores, inventarios.
- Todo lo construido (conexión, SQLite, cooldowns, interruptor, simulador, memoria) se aprovecha.

**Datos del canal que ya no hay que volver a preguntar:** eres **afiliado**, tienes **OBS conectado a Streamer.bot**, y emites **MMOs** con **Just Chatting ocasional**.

### El plan, en orden

| # | Qué | Dónde vive | Estado |
|---|---|---|---|
| 1 | **Efectos con Oro 🪙** (sonido, "bebe agua", maldición B/N, terremoto, lag) | Streamer.bot + OBS | 📄 Guía escrita en `docs/07`. **Te toca montarlos.** |
| 2 | **Loot del chat** ⭐ — mientras farmeas, al chat le caen objetos con rareza; un legendario lanza un efecto en OBS; `!inventario` | Nuestro código + `DoAction` | Por diseñar |
| 3 | **Retos al jugador** con Channel Points + overlay con temporizador | Streamer.bot + nuestro código | Idea |
| 4 | **Predicciones** de drop/wipe, abiertas y cerradas solas | Nuestro código | Idea |
| 5 | **Contador de wipes/muertes** en pantalla + `!wipes` | Streamer.bot | Idea |
| — | Jefe de raid del chat con barra de vida | — | Para cuando haya gente |

Just Chatting: ruleta de temas y `#5` tal cual.

### Lo primero de mañana

1. **Pruebas el panel**: `npm start` y abre **http://127.0.0.1:7070**. No lo he visto pintado en un navegador; si algo se ve raro, se arregla lo primero.
2. **Montas "Grito de guerra"** siguiendo `docs/07` § 5 (o la pestaña Efectos del panel, que trae los mismos pasos). La Action se tiene que llamar `Efecto - Grito de guerra` para que el panel la reconozca. Cuando el panel la marque como **Montado** y el botón **Probar** suene, el patrón está validado.
3. **Me dices qué MMO juegas.** Hace falta para darle nombres del juego a las rarezas del Loot, a los retos y a los efectos.
4. Diseñamos el **Loot del chat**.

### Pendientes de esta idea

- **La moneda:** propuse **Oro 🪙** en vez de las esferas del dragón, que no pegan en un canal de MMO. No me has dicho si te convence. Me ofrecí a generar el icono en 18, 36 y 72 px.
- Los nombres de menú de Streamer.bot en `docs/07` no están comprobados en tu pantalla. Si alguno no coincide, se corrige la guía.

---

## 0-bis. El panel de control (nuevo)

`src/panel/`. Lo sirve el propio bot en **http://127.0.0.1:7070** (`PANEL_PORT`, `PANEL_ENABLED` en el `.env`).

- **Directo:** interruptor, espontáneas y revisión en caliente, gasto, escribir en el chat, actividad.
- **Revisión desde el panel:** lo que la IA quiere decir aparece arriba con Publicar / Descartar. La consola sigue funcionando; vale la primera respuesta.
- **Efectos:** cruza el catálogo con las Actions reales de Streamer.bot y las prueba con `DoAction`.
- **Interacciones**, **Espectadores** (con olvidar) y **Registro**.
- Los interruptores del panel **duran hasta reiniciar**. El `.env` sigue mandando.
- Seguridad: solo escucha en 127.0.0.1, comprueba la cabecera Host y exige `X-Panel: 1` en todo lo que cambia algo. Ver el comentario de `src/panel/server.ts`.

---

## 0-ter. El plan de validación de antes (sigue valiendo, ya no es lo primero)

Lo que había acordado el 24 sep, resumido: "necesito un directo" y "necesito
espectadores" no son lo mismo. Casi todo se valida en solitario, y para lo
que necesita a otra persona está `crid4n` desde el móvil con datos (id
`1541361603`). `#24 Continuará` exige al menos un espectador que no seas tú.

Con el cambio de rumbo, esto queda **detrás** de los efectos y el Loot.
Las interacciones que valida son las de la etapa anterior.

---

## 1. Lo único que bloquea de verdad

**Hay cinco puertas de validación sin pasar.** Las fases 5, 6, 7, 8 y 9 tienen el código escrito y probado, pero **ninguna ha visto un directo real**.

No es una formalidad del roadmap. Hay cosas que los tests no pueden decirnos:

| Qué | Por qué no basta con tests |
|---|---|
| El Channel Point en Twitch | Solo se ha visto el payload real una vez, y venía roto |
| Rechazar en revisión escribiendo `n` | El recuadro de consola nunca se ha usado de verdad |
| Un corte de red a mitad de llamada | Automatizado, pero nunca con el wifi de verdad |
| `#19 Rachas` | **Una racha necesita directos reales separados en el tiempo. Es imposible de evaluar sin emitir.** |
| El caché de prompt en marcha | Medido con 3 llamadas seguidas, no en un directo |

Mi recomendación sigue siendo la misma: **un directo de prueba antes de seguir construyendo.** No hace falta que sea con público.

---

## 2. Qué hay construido

```
FASE 0-4  ✅ entregadas y validadas
FASE 5    ✅ código · #5 Pregunta a Crid4m AI          🚦 sin validar
FASE 6    ✅ código · #1 Primer Mensaje, #18 Vuelta    🚦 sin validar
FASE 7    ✅ código · motor + #10 Pregunta Incómoda    🚦 sin validar
FASE 8    ✅ código · memoria, #2, #24, #15            🚦 sin validar
FASE 9    ✅ código · #19 Rachas (XP diseñado, NO hecho) 🚦 sin validar
FASE 10   ◀── siguiente: sistema de personalidad
```

**275 tests, 0 fallos.** `npm run check`.

### Las siete interacciones

| # | Nombre | Disparador | IA | ¿Activa hoy? |
|---|---|---|:--:|---|
| 5 | Pregunta a Crid4m AI | `!pregunta` / `!preguntar` / CP | Sí | ✅ |
| 10 | Pregunta Incómoda | `!incomoda` (subs) / CP | No | ✅ |
| 1 | Primer Mensaje | evento | No | ❌ dormida |
| 2 | Ticket de Entrada | evento | No | ❌ dormida |
| 18 | Bienvenida de Vuelta | evento | No | ❌ dormida |
| 15 | Dato Inútil | evento | **Sí ×2** | ❌ dormida |
| 19 | Rachas | evento | No | ❌ dormida |
| 24 | Continuará | fin de directo | Sí | ❌ dormida |

Más `!olvidame`, `!apagar`, `!encender`, `!estado`, `!ping`, que funcionan siempre.

---

## 3. Tu configuración ahora mismo

```env
INTERACCIONES_ESPONTANEAS=false   # el bot solo responde si le invocan
REVIEW_MODE=true                  # lo que escribe Claude te espera en consola
AI_BUDGET_PER_DAY_USD=1           # ~400 respuestas, holgado
AI_CACHE_TTL=1h                   # −70% por respuesta, medido
PREGUNTA_IA_COOLDOWN_GLOBAL_MS=300000   # 5 min  (valores de produccion)
PREGUNTA_IA_COOLDOWN_USER_MS=900000     # 15 min
```

### Lo que hice al final de la sesión, y conviene que sepas

**`#24 Continuará` no pasaba por tu interruptor.** No usa el motor —la dispara el fin del directo, no un espectador— así que `INTERACCIONES_ESPONTANEAS=false` no la cubría. Era el único camino por el que el bot habría hablado solo, y encima gastando dinero en cada cierre de directo.

Lo he tapado: ahora consulta la misma marca. **Si quieres el "continuará" pero no el resto de espontáneas, dímelo** — hoy son un único interruptor y habría que separarlos.

---

## 4. Lo que iba a venir: Fase 10 — Sistema de personalidad

> **Aplazado por el cambio de rumbo (sección 0).** Se queda como referencia.

Lee `docs/03-ROADMAP.md`. Dos cosas que ya sabemos:

- Trae el **registro de interacciones** que `#22 Logros` necesita, y que dejamos aplazado a propósito en la Fase 9.
- Hay una decisión pendiente de la Fase 9 que se revisa aquí: XP está **diseñado y no construido** (`docs/06-DISENO-XP-Y-LOGROS.md`), con condición explícita para retomarlo: 5+ espectadores habituales y 4+ interacciones alcanzables. Hoy son 0-2 y 2.

---

## 5. Cosas tuyas pendientes, sin prisa

- **El banco de `#10 Pregunta Incómoda` es tuyo.** Escribí 15 preguntas de arranque en [pregunta-incomoda.ts:31](../src/interactions/pregunta-incomoda.ts#L31). Ahí está todo el control del riesgo de esa interacción: la respondes tú en voz alta. Léelas y borra las que no quieras. Con menos de 5 falla un test, con 5 o más no.
- **Límite de gasto mensual en la consola de Anthropic** (Plans & Billing). Nuestros topes cubren día y mes, pero ese es el único que no depende de que nuestro código funcione. Sigue pendiente desde el principio.
- **Apagar Streamlabs y StreamElements** del chat. Pendiente desde el principio.
- Lo del login quedó resuelto: `crid4m` (125801906) y `crid4n` (1541361603) son **dos cuentas distintas**, no un typo. El `.env` apunta a la correcta.

---

## 6. Para volver a coger el hilo rápido

```bash
npm run check          # 275 tests
npm start              # arranca; mira las lineas de "Gasto —" e "IA:"
```

Escenas del simulador, que no gastan dinero ni necesitan Twitch:

```bash
npm run simulate -- pregunta    # #5 por sus dos disparadores
npm run simulate -- vuelta      # #1, #18 y la tabla streams
npm run simulate -- memoria     # #2, #15, #24 y !olvidame
npm run simulate -- demo        # interruptor de emergencia y policy
```

Las espontáneas están apagadas en tu `.env`, así que para ver esas escenas en acción:

```bash
INTERACCIONES_ESPONTANEAS=true npm run simulate -- memoria
```

Consulta de gasto real:

```bash
node --disable-warning=ExperimentalWarning -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/crid4m.sqlite');console.table(d.prepare('SELECT id,at,intent,outcome,input_tokens AS ent,cache_read_tokens AS cache,output_tokens AS sal,cost_usd,latency_ms FROM ai_usage ORDER BY id').all())"
```

O simplemente `!estado` en el chat.

---

## 7. Documentos que importan

| Archivo | Qué hay dentro |
|---|---|
| `docs/03-ROADMAP.md` | Las fases, con el estado de cada una |
| `docs/04-RIESGOS-COSTES-LIMITACIONES.md` | Costes medidos, los cuatro topes, el caché |
| `docs/05-NOTAS-PARA-EL-MOTOR.md` | Por qué el motor es como es |
| `docs/06-DISENO-XP-Y-LOGROS.md` | El diseño de XP y por qué NO se construyó |
| `docs/07-EFECTOS-CANAL.md` | **Nuevo.** La moneda Oro, precios y la guía paso a paso de los efectos |
| `docs/paneles/` | Los paneles de Twitch (Comandos, Recompensas, Loot) y cómo regenerarlos |
