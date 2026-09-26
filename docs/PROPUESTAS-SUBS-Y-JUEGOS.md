# Propuestas: suscriptores y juegos (26 sep 2026)

Pedido por Crid4m: sacarle partido a los suscriptores, y qué hacer para Aion 2, Aniimo, WoW y Just Chatting **sin añadir overlays**. Todo lo de aquí usa lo que ya existe: el chat, el banner del botín (`FX Botin`), el overlay de combate (`FX Jefe`) y el panel.

---

## 1. Suscriptores

### Punto de partida

- Streamer.bot **ya manda al bot** los avisos de `Sub`, `ReSub`, `GiftSub`, `Cheer` (bits), `Raid` y `Follow`. El bot **no hace nada con ellos**: se guardan como eventos sin procesar.
- Lo único para suscriptores hoy es `!incomoda`.
- Aún no ha llegado ninguno de verdad, así que no tenemos su forma exacta. **Antes de montar nada**, hay que lanzar las pruebas de Streamer.bot (Platforms → Twitch → Test Events → Sub / ReSub / Gift Sub / Raid) con el bot encendido, para capturar un ejemplo real de cada uno. Así se hizo con los canjes y evitó un fallo en la Fase 5.

### Regla que propongo

**Ventajas de identidad y comodidad, nunca de fuerza.** Con 1-3 espectadores, si un sub gana siempre los duelos, el resto deja de jugar. Un sub se nota, luce y tiene más cofres, pero en un duelo pesa lo mismo.

### Propuestas, por lo que aportan

| # | Qué | Cómo funciona | Carga |
|---|---|---|---|
| S1 | **Cofre de suscriptor** ⭐ | Al suscribirse o resuscribirse, un Cofre del tesoro al momento, con banner «💜 Cofre de suscriptor» y una línea en el chat. En los aniversarios (3, 6 y 12 meses), mejor suerte; a los 12, **legendario asegurado**. | Solo código; usa el banner |
| S2 | **Regalar subs = regalar cofres** ⭐ | Quien regala recibe un cofre por cada sub regalada (con tope) y cada persona que la recibe, uno de bienvenida. Si alguien regala 5 o más de golpe, **lluvia de cofres** para todo el chat. | Solo código |
| S3 | **Raid entrante** ⭐ | Cuando otro canal te trae su gente: «¡Llega una incursión de X con N personas!» y un cofre para quien la trae. Opcional: aparece un jefe para que los recién llegados jueguen en el primer minuto. | Solo código; usa el jefe |
| S4 | **Marca de suscriptor** | En los mensajes del bot, el nombre del sub lleva 💜 (en `!top`, duelos, ranking…). En `!inventario` y `!poder`, «💜 suscriptor · 7 meses». | Mínima |
| S5 | **Mochila más grande** | 30 huecos en vez de 20. Es comodidad, no fuerza. | Mínima |
| S6 | **Colección de mecenas** | Unos 6 objetos solo de suscriptor (cosméticos, sin poder extra) que caen en sus cofres; completarla da el título «Mecenas del Reino». | Catálogo y título |
| S7 | **Bits = ayuda contra el jefe** | Con un jefe en pie, 100 bits valen un golpe extra y 500 un crítico asegurado. Sin jefe, 300 bits valen un cofre. | Solo código |

**Mi recomendación:** S1 + S2 + S3 primero. Son los momentos que ya existen (alguien se suscribe, regala o te trae una raid) convertidos en algo que se ve y se agradece, sin inventar nada nuevo en pantalla.

### Cuidado

- Los objetos son virtuales y sin valor fuera del canal: no hay problema con las normas de Twitch.
- Las ventajas por suscripción deben ser cosméticas o de comodidad. Si en el futuro se valora algo de poder, que sea pequeño y temporal (por ejemplo, el día del aniversario).

---

## 2. Juegos: Aion 2, Aniimo, WoW

### G1. Ficha de personaje por juego ⭐ (lo primero)

Es la pregunta que más se repite en un MMO: «¿qué clase llevas?», «¿en qué servidor?», «¿cuál es tu gremio?».

- En el panel, **una ficha por juego**: servidor, clase y especialización, nivel u objeto, gremio, facción, y una línea libre.
- Un **juego activo** en el panel (el mismo que usas en Títulos).
- `!pj` contesta con la ficha del juego activo: «🎮 WoW · Paladín Retribución · Sanguino (EU) · gremio Los de Siempre».
- También sirve para rellenar Títulos solo.

Sin IA, sin overlays: se rellena una vez y ya contesta el bot.

### G2. `!objetivo`: la meta del directo

Pones en el panel la meta de hoy («subir a nivel 50», «montura del jefe X») y `!objetivo` la dice. Si la marcas como conseguida, el bot lo celebra una vez en el chat. Encaja con el tipo de sesión de Títulos.

### G3. Predicciones de Twitch (WoW y Aion 2)

«¿Cae el jefe en menos de 3 intentos?», «¿Llegamos a +15?». Las predicciones son **de Twitch**: salen en su propia interfaz y se apuestan con Oros, sin overlay. Streamer.bot tiene sub-acciones para crearlas y resolverlas. Se lanzarían desde el panel con plantillas por juego.

Esto sí es una conexión con Twitch (crea la predicción). Si prefieres no conectar nada, se queda en plantillas de texto para crearlas tú a mano.

### G4. Aion 2: guerra de facciones del chat

Aion va de dos bandos. Al entrar, cada espectador elige bando con `!bando elyos` o `!bando asmodian`. Los duelos entre bandos y el daño al jefe suman puntos a su facción; al final del directo, una línea con el bando ganador. Solo chat, reutiliza duelos y jefes.

### G5. Aniimo: cofres que sueltan criaturas

Aniimo va de coleccionar criaturas. Con Aniimo como juego activo, el catálogo del Loot cambia a **criaturas** en vez de armas: mismas rarezas, colección y forja («fusionar» 3 comunes en un raro). Es cambiar la lista de nombres, no la mecánica: cero overlays nuevos.

### G6. Botín de temporada por juego

Más ligero que G5: con cada juego activo, se mezclan en los cofres unos pocos objetos con guiños a ese juego, sin nombres oficiales («Alas de daeva desgastadas» para Aion o «Piedra de hogar sin cargar» para WoW). Da variedad sin tocar nada más.

---

## 3. Just Chatting

| # | Qué | Cómo |
|---|---|---|
| J1 | **Cola de preguntas** ⭐ | `!pregunta` sin IA, o un comando nuevo `!pregunto`: la pregunta va a una lista del panel, las lees en voz alta y las marcas como respondidas. Nadie se pierde, nadie repite. |
| J2 | **Ruleta de temas** | `!tema` o un botón del panel saca un tema de una lista tuya. La IA local te puede sugerir temas nuevos para la lista, fuera del directo. |
| J3 | **Encuesta rápida** | Como las predicciones, pero con las encuestas de Twitch (su propia interfaz, sin overlay). |

---

## 4. Para la IA local (Ollama)

Sin directo de por medio, ideas donde encaja bien:

- Temas para Just Chatting (J2) y plantillas de predicción (G3) por juego.
- Nombres para el botín de temporada (G6) y las criaturas (G5), revisados por ti antes de usarlos.
- Un «qué pasó en el último directo» a partir del registro, para abrir el siguiente.

Lo que habla con el chat en directo sigue en Claude.

---

## Orden que propongo

1. **G1 Ficha de personaje + juego activo**: poco trabajo, útil desde el primer directo en los tres juegos.
2. **S1 + S2 + S3**: cofres de suscriptor, regalos y raids (antes, capturar los ejemplos reales con las pruebas de Streamer.bot).
3. **G2 `!objetivo`** y **J1 Cola de preguntas**.
4. Lo específico de cada juego (G4 facciones, G5 criaturas) cuando veas cuánto tiempo pasas en cada uno.
