# DOCUMENTO 2 — Catálogo inicial de interacciones

**Estado:** propuesta de FASE 1. Nada implementado, nada decidido.
**28 interacciones.** El objetivo de este documento es tener de dónde elegir, no una lista de tareas.

---

## 0. Cómo leer este catálogo

Cada interacción pasa tu filtro del punto 2: *¿hace que el espectador participe, se divierta, conozca a otros, permanezca más tiempo o tenga una razón para volver?* Las que no lo pasaban no están aquí.

**Dos avisos antes de empezar:**

1. **Dependencia de Afiliado.** Todo lo marcado `CP` (Channel Points), `POLL` o `PRED` requiere ser Afiliado o Partner. **Crid4m lo es**, así que están disponibles. Aun así cada una mantiene una **alternativa por comando de chat**: es gratis para el espectador, y con poca gente eso importa.
2. **Dependencia del tamaño del chat.** Marco cada interacción con el tamaño mínimo de chat en el que funciona:
   - 🟢 **funciona con 1-5 espectadores activos**
   - 🟡 **necesita 5-15**
   - 🔴 **necesita 15+**

   Esto importa más de lo que parece: la mitad de los bots de comunidad fracasan porque implementan dinámicas de masas en canales pequeños.

   **Situación real de Crid4m (22 sep 2026): prácticamente cero espectadores**, canal retomado tras años parado. Eso deja fuera las 12 interacciones 🟡/🔴 por ahora. **Empieza por la sección 7**, que tiene el orden revisado; el resto del documento es el catálogo completo para cuando haya chat.

**Complejidad:** Baja (una tarde) · Media (un fin de semana) · Alta (varias sesiones + estado persistente).

---

## 1. Tabla resumen

| # | Nombre | Categoría | Disparador | IA | Compl. | Chat | Potencial |
|---:|---|---|---|:--:|---|:--:|---|
| 1 | Primer Mensaje | Captación | Evento | No | Baja | 🟢 | Muy alto |
| 2 | Ticket de Entrada | Captación | Evento | No | Baja | 🟢 | Alto |
| 3 | ¿Qué está pasando? | Captación | Comando | Sí | Media | 🟢 | Alto |
| 4 | El Lurker Nombrado | Captación | Temporizador | No | Media | 🟡 | Medio |
| 5 | Pregunta a Crid4m AI | Participación | CP / Comando | Sí | Media | 🟢 | Alto |
| 6 | Hot Take | Participación | CP / Temporizador | Sí | Media | 🟡 | Alto |
| 7 | Dos Puertas | Participación | Comando | Sí | Media | 🟡 | Muy alto |
| 8 | Duelo de Emotes | Participación | Comando | No | Media | 🔴 | Alto |
| 9 | El Chat Manda | Participación | CP | No | Baja | 🟢 | Alto |
| 10 | Pregunta Incómoda | Participación | CP | No | Baja | 🟢 | Medio |
| 11 | Confesionario | Participación | CP | Sí | Media | 🟡 | Alto (riesgo alto) |
| 12 | Predicción de Partida | Participación | PRED | No | Media | 🔴 | Medio |
| 13 | El Algoritmo | Comunidad | CP / Comando | Sí | Media | 🟡 | Muy alto |
| 14 | Presentación Cruzada | Comunidad | Evento | No | Baja | 🟢 | Alto |
| 15 | Dato Inútil | Comunidad | Evento | Sí | Alta | 🟢 | Muy alto |
| 16 | Reto entre Espectadores | Comunidad | Comando | No | Media | 🟡 | Medio |
| 17 | Comité del Chat | Comunidad | Comando | No | Media | 🟡 | Medio |
| 18 | Bienvenida de Vuelta | Comunidad | Evento | No | Baja | 🟢 | Alto |
| 19 | Rachas | Retención | Evento | No | Media | 🟢 | Alto |
| 20 | Misión del Directo | Retención | Evento | No | Media | 🟡 | Alto |
| 21 | XP y Niveles | Retención | Evento | No | Alta | 🟢 | Medio |
| 22 | Logros | Retención | Evento | No | Media | 🟢 | Medio |
| 23 | Cita del Directo | Retención | Evento | Sí | Media | 🟡 | Muy alto |
| 24 | Continuará | Retención | Evento | Sí | Baja | 🟢 | Muy alto |
| 25 | Raid Recibida | Eventos | Evento | Sí | Media | 🟢 | Alto |
| 26 | Sub con Memoria | Eventos | Evento | Sí | Media | 🟢 | Alto |
| 27 | Bits con Sentido | Eventos | Evento | No | Baja | 🟢 | Medio |
| 28 | Hype Train Colectivo | Eventos | Evento | No | Media | 🔴 | Medio |

**Reparto:** 10 usan IA, 18 no. Eso responde a tu regla del punto 3: la mayoría de las interacciones no necesitan a Claude, y las que lo usan lo usan para generar *contenido*, no para decidir.

---

## 2. CAPTACIÓN

El objetivo aquí es un único momento: alguien que nunca ha escrito, escribe.

### 1. Primer Mensaje 🟢

- **Qué hace:** cuando alguien escribe por primera vez en la historia del canal, el bot no le da la bienvenida — le hace **una pregunta concreta y trivial** que se puede responder con una palabra. "Bienvenido al canal" no genera nada; "¿mando o teclado?" genera un segundo mensaje.
- **Activación:** evento `ChatMessage` con el flag de primer mensaje. **Streamer.bot lo trackea internamente** (EventSub no lo da), así que lo tenemos gratis.
- **Necesita:** el flag de primer mensaje, un banco de 20-30 preguntas de una palabra.
- **IA:** No. Plantillas rotativas bastan y son instantáneas.
- **Complejidad:** Baja.
- **Riesgos:** si entran cinco personas a la vez, el bot spamea. **Mitigación: máximo uno cada 60 s, el resto entra en cola o se descarta.**
- **Potencial:** Muy alto. Es la interacción con mejor relación valor/esfuerzo de todo el catálogo.

### 2. Ticket de Entrada 🟢

- **Qué hace:** la respuesta a la pregunta del #1 se **guarda en el perfil del espectador** y se reutiliza semanas después ("@Dani, sigues siendo de los de mando, ¿no?"). Convierte un saludo de un solo uso en un activo permanente.
- **Activación:** el mensaje siguiente al #1, del mismo usuario, en menos de 2 minutos.
- **Necesita:** BD (tabla `users`, campo libre).
- **IA:** No para guardar. Sí para recuperarlo con gracia (eso es el #15).
- **Complejidad:** Baja (sobre la BD ya existente).
- **Riesgos:** guardar texto libre de un desconocido. Limitar a 60 caracteres y sanear.
- **Potencial:** Alto. Es la materia prima del #15, que es donde está el oro.

### 3. ¿Qué está pasando? 🟢

- **Qué hace:** comando `!quepasa`. Alguien entra a mitad de partida y no entiende nada. El bot resume en una línea qué ha pasado en los últimos diez minutos, a partir del chat reciente y el título del directo.
- **Activación:** comando de chat.
- **Necesita:** buffer en memoria de los últimos ~80 mensajes, el título/categoría del directo.
- **IA:** **Sí.** Es exactamente el caso que describías: algo que no se puede resolver con lógica normal.
- **Complejidad:** Media.
- **Riesgos:** el resumen puede ser aburrido o inventado si el chat está muerto. **Mitigación: si hay menos de 15 mensajes en el buffer, responder una plantilla en vez de llamar a la IA** (ahorra dinero y evita ridículos).
- **Potencial:** Alto. Ataca el momento exacto en que un nuevo decide quedarse o irse.

### 4. El Lurker Nombrado 🟡

- **Qué hace:** a quien lleva veinte minutos en la lista de espectadores sin escribir nunca, el bot le lanza una pregunta de sí/no respondible con un solo emote.
- **Activación:** temporizador + `GetActiveViewers` cruzado con el historial.
- **Necesita:** `GetActiveViewers` (disponible por WebSocket), BD.
- **IA:** No.
- **Complejidad:** Media.
- **Riesgos:** **molestar a gente que quiere ser lurker es peor que no hacer nada.** Mitigación obligatoria: máximo una vez por persona y por directo, nunca dos directos seguidos, y un `!silencio` que lo desactiva para siempre para ese usuario.
- **Potencial:** Medio. Alto valor cuando funciona, pero el riesgo de molestar es real.

---

## 3. PARTICIPACIÓN

### 5. Pregunta a Crid4m AI 🟢 `CP`

- **Qué hace:** el espectador paga puntos, escribe una pregunta, el bot responde **con la personalidad de Crid4m** (no como un asistente genérico — esa es toda la gracia).
- **Activación:** Channel Point con entrada de texto. **Alternativa sin Afiliado:** comando `!pregunta` con cooldown largo (5 min global, 15 min por usuario).
- **Necesita:** Claude, cooldowns, presupuesto, sanitización.
- **IA:** **Sí.**
- **Complejidad:** Media.
- **Riesgos:** inyección de prompt, contenido tóxico, coste descontrolado, latencia. Es la interacción con más superficie de riesgo del catálogo — y por eso es **la candidata correcta para la Fase 5**: si esta sale bien, toda la infraestructura de seguridad queda construida y probada.
- **Potencial:** Alto. Confirmo tu elección.

### 6. Hot Take 🟡 `CP`

- **Qué hace:** el bot suelta una opinión deliberadamente polémica pero inofensiva sobre el juego o tema actual, y pide postura al chat.
- **Activación:** Channel Point, o temporizador cuando el chat lleva rato parado. **Alternativa:** `!hottake`.
- **Necesita:** categoría del directo, **lista blanca de temas**.
- **IA:** **Sí**, para generar el take.
- **Complejidad:** Media.
- **Riesgos:** que la polémica sea polémica de verdad. **Mitigación innegociable: lista de temas permitidos (videojuegos, comida, costumbres cotidianas) y lista negra explícita (política, religión, identidad, actualidad).** La IA no elige el terreno, solo juega dentro de él.
- **Potencial:** Alto. Genera respuestas en cadena como pocas cosas.

### 7. Dos Puertas 🟡

- **Qué hace:** el bot plantea un dilema absurdo con dos opciones; el chat vota escribiendo `1` o `2`; a los 45 s se anuncia el resultado y el streamer acata.
- **Activación:** comando o temporizador.
- **Necesita:** contador en memoria, ventana temporal.
- **IA:** Sí para generar el dilema, **no** para contar los votos (tu regla del punto 3 aplicada al detalle).
- **Complejidad:** Media.
- **Riesgos:** ninguno grave. Si vota poca gente, queda pobre.
- **Potencial:** **Muy alto**, y con una ventaja enorme: **no requiere ser Afiliado**, porque el voto va por chat en lugar de por la Poll API. Es la mejor interacción de participación masiva disponible para un canal pequeño.

### 8. Duelo de Emotes 🔴

- **Qué hace:** dos emotes compiten durante 30 s; gana el más escrito. Participación pura, coste cero.
- **Activación:** comando.
- **Necesita:** `TwitchGetEmotes`, contador en memoria.
- **IA:** No.
- **Complejidad:** Media.
- **Riesgos:** inunda el chat durante 30 s. Es el objetivo, pero no lo lances dos veces seguidas.
- **Potencial:** Alto **solo con 15+ personas activas**. Por debajo de eso queda vacío.

### 9. El Chat Manda 🟢 `CP`

- **Qué hace:** Channel Point caro. El espectador impone al streamer una regla durante cinco minutos, elegida de un catálogo cerrado ("no puedes usar la habilidad X", "solo puedes hablar en susurros").
- **Activación:** Channel Point. **Alternativa:** comando para subs.
- **Necesita:** catálogo curado de reglas, temporizador, anuncio de inicio y de fin.
- **IA:** No. **Deliberadamente: el catálogo cerrado es lo que impide que alguien te imponga algo imposible o peligroso.**
- **Complejidad:** Baja.
- **Riesgos:** bajos, por el catálogo cerrado.
- **Potencial:** Alto. Da sensación real de poder sobre el directo.

### 10. Pregunta Incómoda 🟢 `CP`

- **Qué hace:** el bot elige una pregunta personal de un banco y obliga al streamer a responderla en voz alta.
- **Activación:** Channel Point. **Alternativa:** `!incomoda` para subs.
- **Necesita:** banco de preguntas escrito **por ti**, para que no te pille en un terreno que no quieres.
- **IA:** No en la v1. Opcionalmente sí más adelante, con lista blanca de temas.
- **Complejidad:** Baja.
- **Riesgos:** que la pregunta te incomode de verdad. Tú escribes el banco: riesgo controlado.
- **Potencial:** Medio-alto. Funciona muy bien en canales con comunidad ya formada.

### 11. Confesionario 🟡 `CP`

- **Qué hace:** el espectador envía algo anónimo; el bot lo lee sin decir quién.
- **Activación:** Channel Point con texto.
- **Necesita:** IA de moderación **y** de reescritura (para eliminar señas de identidad).
- **IA:** **Sí**, doble pasada: primero clasificar, después reescribir.
- **Complejidad:** Media.
- **Riesgos:** **Los más altos del catálogo.** El anonimato invita al abuso, y de lo que diga tu bot respondes tú ante Twitch. Además el anonimato nunca es perfecto: quien confiesa puede ser identificado por el contenido.
- **Potencial:** Alto, pero **mi recomendación es no incluirla en la v1**. Si algún día se hace, con moderación humana previa (el mensaje pasa por ti antes de salir).

### 12. Predicción de Partida 🔴 `PRED`

- **Qué hace:** el bot detecta un momento clave y lanza una predicción nativa de Twitch.
- **Activación:** comando, o evento de inicio de partida.
- **Necesita:** **Afiliado o Partner** + scope `channel:manage:predictions`. Sin alternativa real: las predicciones no se pueden simular por chat sin perder lo que las hace funcionar (apostar puntos).
- **IA:** No.
- **Complejidad:** Media.
- **Riesgos:** una predicción mal cerrada enfada a la gente que apostó.
- **Potencial:** Medio, y **solo con chat grande**. Con 5 personas no hay tensión.

---

## 4. COMUNIDAD

Esta es, en mi opinión, la categoría donde tu proyecto puede diferenciarse de verdad. Bots que responden preguntas hay miles; bots que hacen que dos espectadores se conozcan, casi ninguno.

### 13. El Algoritmo 🟡 `CP`

- **Qué hace:** empareja a dos espectadores activos y les da una misión de conversación concreta: *"@Alex y @Dani, el algoritmo os ha emparejado. Tenéis dos minutos para descubrir qué juego habéis terminado los dos."*
- **Activación:** Channel Point o comando. **Alternativa:** `!algoritmo`.
- **Necesita:** lista de espectadores que han escrito en los últimos 10 min, BD.
- **IA:** **Sí** para generar la misión. **No** para elegir a las personas (tu ejemplo exacto del punto 3).
- **Complejidad:** Media.
- **Riesgos:** emparejar a alguien con un troll, o con alguien que no quiere participar. **Mitigación: solo usuarios con 10+ mensajes históricos y actividad en los últimos 10 minutos. Y opt-out permanente.**
- **Potencial:** **Muy alto.** Es literalmente tu ejemplo del brief, y es lo que hace que un chat se convierta en comunidad.

### 14. Presentación Cruzada 🟢

- **Qué hace:** cuando un habitual y un nuevo coinciden, el bot le pide al habitual que le presente el canal al nuevo en una frase. El habitual se siente veterano; el nuevo recibe la bienvenida de una persona, no de un bot.
- **Activación:** evento de primer mensaje + presencia de un habitual.
- **Necesita:** BD para saber quién es habitual.
- **IA:** No.
- **Complejidad:** Baja.
- **Riesgos:** que el habitual no conteste y quede raro. Mitigación: elegir al habitual que ha escrito hace menos tiempo.
- **Potencial:** Alto, y **coste cero**. Delega el trabajo emocional en la comunidad, que es donde funciona mejor.

### 15. Dato Inútil 🟢

- **Qué hace:** guarda un dato trivial que un espectador soltó una vez, y lo saca semanas después. *"@Marta, ¿al final pudiste con el jefe ese que te tenía frita en marzo?"*
- **Activación:** evento (el espectador vuelve tras varios días).
- **Necesita:** BD con historial, extracción de datos del chat, criterio para elegir el momento.
- **IA:** **Sí**, en dos momentos: para detectar qué merece guardarse y para redactar el recuerdo.
- **Complejidad:** **Alta.** Es la única de complejidad alta que recomiendo construir.
- **Riesgos:** sacar un dato en mal momento, o guardar algo que el espectador preferiría olvidar. Mitigación: solo datos de temas neutros (juegos, comida, planes), caducidad de 90 días, y `!olvidame`.
- **Potencial:** **Muy alto.** Es la interacción que mejor produce el efecto *"aquí me conocen"*, que es exactamente el objetivo del punto 15 de tu brief. Si solo pudieras construir una interacción de comunidad, sería esta.

### 16. Reto entre Espectadores 🟡

- **Qué hace:** `!reto @usuario` lanza un desafío de chat entre dos personas (adivinar algo, responder más rápido, escribir algo).
- **Activación:** comando con mención.
- **Necesita:** consentimiento del retado (tiene que aceptar con `!acepto`).
- **IA:** No (plantillas de retos).
- **Complejidad:** Media.
- **Riesgos:** acoso disfrazado de juego. **El consentimiento explícito no es opcional.**
- **Potencial:** Medio.

### 17. Comité del Chat 🟡

- **Qué hace:** tres espectadores aleatorios forman un jurado que decide algo real del directo (qué misión hacer, qué personaje elegir).
- **Activación:** comando del streamer.
- **Necesita:** selección aleatoria entre activos, ventana de respuesta.
- **IA:** No.
- **Complejidad:** Media.
- **Riesgos:** que un miembro del jurado no responda y bloquee la dinámica. Mitigación: timeout de 60 s y se decide con los que hayan votado.
- **Potencial:** Medio-alto. Da protagonismo rotatorio, que es muy valioso en canales pequeños.

### 18. Bienvenida de Vuelta 🟢

- **Qué hace:** alguien que no aparecía desde hace más de catorce días vuelve, y el bot lo reconoce.
- **Activación:** primer mensaje del usuario en el directo + consulta a la BD.
- **Necesita:** BD (`last_seen`).
- **IA:** No en la v1.
- **Complejidad:** Baja.
- **Riesgos:** mínimos. Evitar que suene a reproche.
- **Potencial:** Alto por lo barata que es.

---

## 5. RETENCIÓN

### 19. Rachas 🟢

- **Qué hace:** cuenta directos consecutivos a los que asiste un espectador. Se anuncia al llegar a hitos (3, 5, 10, 25).
- **Activación:** primer mensaje del usuario en cada directo.
- **Necesita:** BD, definición clara de "asistir" (≥1 mensaje).
- **IA:** No.
- **Complejidad:** Media.
- **Riesgos:** **romper una racha larga genera frustración real.** Mitigación: un "comodín" al mes.
- **Potencial:** Alto. Es el mecanismo de retorno más probado que existe.

### 20. Misión del Directo 🟡

- **Qué hace:** una misión colectiva por directo ("entre todos, 50 mensajes con la palabra del día"). Si se cumple, pasa algo.
- **Activación:** al arrancar el directo.
- **Necesita:** contador, anuncio de progreso (pocos, no spam).
- **IA:** No (banco de misiones); opcionalmente sí para generarlas.
- **Complejidad:** Media.
- **Riesgos:** si la misión es muy difícil para el tamaño del chat, desmotiva. **Escala el objetivo según los espectadores presentes.**
- **Potencial:** Alto. Convierte a espectadores individuales en equipo.

### 21. XP y Niveles 🟢

- **Qué hace:** progresión por participación.
- **Activación:** transversal.
- **Necesita:** BD, tabla de XP.
- **IA:** No.
- **Complejidad:** Alta (por el diseño del balance, no por el código).
- **Riesgos:** **el grande: si das XP por mensajes, conviertes el chat en farmeo silencioso y consigues lo contrario de lo que buscas.** Mitigación de diseño: **XP solo por participar en interacciones**, nunca por escribir.
- **Potencial:** Medio. Mucha gente lo espera, pero por sí solo no crea comunidad. Constrúyelo tarde.

### 22. Logros 🟢

- **Qué hace:** desbloqueables por hacer cosas concretas ("has sido emparejado 5 veces", "sobreviviste a un Chat Manda").
- **Activación:** transversal.
- **Necesita:** BD, catálogo de logros.
- **IA:** No.
- **Complejidad:** Media.
- **Riesgos:** logros aburridos que nadie persigue.
- **Potencial:** Medio. Barato de añadir **una vez existe el registro de interacciones de la Fase 10**: los logros se pueden calcular sobre esos datos.

### 23. Cita del Directo 🟡

- **Qué hace:** al cerrar el directo, el bot elige la mejor frase del chat del día, la guarda y la recuerda al día siguiente al abrir.
- **Activación:** `StreamOffline` y `StreamOnline`.
- **Necesita:** buffer del chat del directo, BD.
- **IA:** **Sí**, para elegir y presentar.
- **Complejidad:** Media.
- **Riesgos:** elegir una frase desafortunada. Mitigación: pasa por tu aprobación antes de guardarse (una sola revisión al final del directo, no es carga).
- **Potencial:** **Muy alto.** Dos golpes por el precio de uno: cierra el directo con un premio y abre el siguiente con continuidad. **Solo cuesta 2 llamadas a la IA por directo.**

### 24. Continuará 🟢

- **Qué hace:** al cerrar, el bot deja una pregunta abierta que se resolverá en el siguiente directo. *"El martes descubriremos si @Alex tenía razón."*
- **Activación:** `StreamOffline`.
- **Necesita:** BD (una fila), lo ocurrido en el directo.
- **IA:** **Sí**, una llamada.
- **Complejidad:** Baja.
- **Riesgos:** ninguno. Si nadie se acuerda, no pasa nada.
- **Potencial:** **Muy alto** respecto a su coste: una llamada a la IA por directo para darle a la gente una razón concreta de volver. Es la mejor relación coste/retención del catálogo.

---

## 6. EVENTOS Y MONETIZACIÓN

### 25. Raid Recibida 🟢

- **Qué hace:** en lugar de un "gracias por la raid" genérico, un saludo específico que menciona el juego del canal que raidea y le da a la gente entrante algo que responder.
- **Activación:** evento `Raid`.
- **Necesita:** datos del canal que raidea (Streamer.bot los proporciona).
- **IA:** **Sí.**
- **Complejidad:** Media.
- **Riesgos:** una raid de 200 personas dispara todas las interacciones de captación a la vez. **Mitigación obligatoria: modo raid — durante 3 minutos tras una raid, el #1 y el #14 se desactivan.** Este es el bug que más probablemente te va a morder si no lo previenes.
- **Potencial:** Alto. Es el momento de mayor entrada de gente nueva del directo.

### 26. Sub con Memoria 🟢

- **Qué hace:** en vez de un mensaje de agradecimiento genérico, uno que hace referencia al historial real de esa persona en el canal.
- **Activación:** `Sub`, `ReSub`, `GiftSub`.
- **Necesita:** BD con historial.
- **IA:** **Sí.**
- **Complejidad:** Media.
- **Riesgos:** si no hay historial (sub de alguien nuevo), debe caer con elegancia a una plantilla.
- **Potencial:** Alto. Momento de máxima atención del chat.

### 27. Bits con Sentido 🟢

- **Qué hace:** distintos tramos de bits desbloquean distintas interacciones del catálogo en lugar de un simple agradecimiento.
- **Activación:** `Cheer`.
- **Necesita:** mapa de tramos a interacciones.
- **IA:** No.
- **Complejidad:** Baja.
- **Riesgos:** ninguno.
- **Potencial:** Medio. Es sobre todo un multiplicador: reutiliza interacciones que ya existen.

### 28. Hype Train Colectivo 🔴

- **Qué hace:** durante un hype train, el bot lo convierte en un objetivo colectivo con narración por niveles.
- **Activación:** eventos de `HypeTrain`.
- **Necesita:** eventos de hype train.
- **IA:** No (plantillas por nivel; el ritmo importa más que la originalidad).
- **Complejidad:** Media.
- **Riesgos:** mucho ruido en un momento ya ruidoso. Un mensaje por nivel, no más.
- **Potencial:** Medio, y solo aplica si los hype trains ocurren, lo que requiere canal grande.

---

## 7. Orden de construcción — REVISADO (22 sep 2026)

> **Dato que reordena todo el catálogo:** Crid4m es Afiliado (Channel Points, Polls y Predicciones disponibles), pero el canal viene de años abandonado y **ahora mismo no hay espectadores**.

### 7.1 Qué queda fuera, y por qué

**Las 12 interacciones 🟡 y 🔴 quedan en espera.** No es que funcionen mal: necesitan gente y no la hay. Dos personas votando en un "Duelo de Emotes" no es una dinámica, es una postal triste.

En espera: `#4`, `#6`, `#7`, `#8`, `#11`, `#12`, `#13`, `#16`, `#17`, `#20`, `#23`, `#28`.

Siguen escritas. Se activan cuando haya chat.

### 7.2 El núcleo real: cinco interacciones para un solo espectador

Con 80 espectadores, que uno se sienta ignorado no importa. **Con 2, que el bot recuerde a esa persona tres semanas después es lo más valioso que puede pasar en el canal.**

Eso reordena el proyecto alrededor de **la memoria**, no de las dinámicas de grupo:

| Orden | Interacción | Por qué ahora |
|---|---|---|
| 1 | **#5 Pregunta a Crid4m AI** | Construye y valida toda la infraestructura de riesgo de una vez (IA, cooldowns, validación, presupuesto, sanitización). Ventaja inesperada de no tener público: **puedes depurarla y afinar la personalidad sin nadie mirando.** |
| 2 | **#1 Primer Mensaje** | Sin IA, mejor relación valor/esfuerzo del catálogo. Es literalmente el momento en que un desconocido decide si escribe o se va. |
| 3 | **#18 Bienvenida de Vuelta** | Barata y es la mitad del efecto "aquí me conocen". Necesita la BD, que ya existirá. |
| 4 | **#2 Ticket de Entrada** | Sola no hace nada; es la materia prima de la #15. |
| 5 | **#15 Dato Inútil** | La de complejidad Alta, y **la que de verdad diferencia el canal**. Con dos espectadores, que el bot recuerde algo que dijiste hace un mes es desproporcionadamente potente. |
| 6 | **#24 Continuará** | Una llamada a la IA por directo para dar una razón concreta de volver. La mejor relación coste/retención del catálogo. |

Las seis funcionan con **una sola persona en el chat**, y **ninguna necesita Channel Points** (aunque ahora estén disponibles). Entre ellas tocas evento, comando, temporizador, IA y persistencia: material de sobra para que el motor de la Fase 7 se diseñe a partir de hechos.

### 7.3 Cuándo se reactivan las sociales

`#14 Presentación Cruzada` → `#7 Dos Puertas` → `#13 El Algoritmo`, en ese orden, **en cuanto haya 5+ personas activas de forma habitual**. Ninguna requiere Afiliado, así que no hay nada que preparar: están esperando a que haya con quién jugar.

### 7.4 Descartadas por ahora

- **#11 Confesionario** — riesgo desproporcionado.
- **#21 XP y Niveles** — mucho trabajo, poco efecto comunitario, y es la típica funcionalidad que se construye porque es posible. Justo lo que dijiste que no querías.
- **#12 Predicción de Partida** — disponible técnicamente (eres Afiliado), pero sin gente que apueste no hay tensión, que es todo lo que la hace funcionar.

### 7.5 Aviso que conviene no perder de vista

**Un bot no trae espectadores.** Amplifica una comunidad que ya existe. Este sistema hará que la gente que llegue se quede y vuelva — no hará que llegue. El cuello de botella del canal está en otro sitio, y ninguna de estas 28 interacciones lo toca.
