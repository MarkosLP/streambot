# DOCUMENTO 4 — Riesgos, costes y limitaciones

**Estado:** propuesta de FASE 0.
Este es el documento que conviene releer antes de cada fase.

---

## 1. Costes

### 1.1 Resumen

| Concepto | Coste mensual | Nota |
|---|---:|---|
| **API de Claude** | **~20 €** | Única partida real. Detalle abajo. |
| Hosting | **0 €** | Corre en tu PC, junto a Streamer.bot |
| Base de datos | **0 €** | SQLite, archivo local |
| API de Twitch | **0 €** | Gratuita |
| Streamer.bot | **0 €** | Gratuito |
| **Total** | **~20 €/mes** | |

Si algún día el backend se fuera a la nube, súmale un VPS pequeño (~5 €/mes). No hace falta ahora.

### 1.2 Coste real de una llamada — MEDIDO (23 sep 2026)

> Los números de esta sección ya no son estimaciones. Salen de la primera llamada real de la Fase 4, registrada en la tabla `ai_usage`.

Llamada real de `pregunta-ia` con `claude-opus-5` y `effort: "low"`, pregunta *"¿mando o teclado?"*, respuesta de 149 caracteres:

| Parte | Tokens | Precio | Coste |
|---|---:|---|---:|
| Entrada (prompt de sistema, esquema y pregunta) | 1.273 | $5/M | $0.006365 |
| Salida (razonamiento + respuesta) | 68 | $25/M | $0.001700 |
| **Total** | **1.341** | | **$0.008065** |

Latencia: **4.360 ms**.

**Corrección importante respecto a la estimación de la Fase 0.** Habíamos calculado ~$0.016 por llamada con la salida dominando el coste (62 %). La realidad es la contraria:

| | Estimado | Real | |
|---|---:|---:|---|
| Tokens de entrada | ~1.200 | 1.273 | acertado |
| Tokens de salida | ~400 | **68** | 6× menos |
| Coste por llamada | $0.016 | **$0.008** | la mitad |
| **Peso de la entrada** | 38 % | **79 %** | **se invierte** |

Dos causas: el razonamiento con `effort: "low"` gasta muchísimo menos de lo previsto, y la instrucción de brevedad de `crid4m.md` funciona. **El coste lo domina la entrada, no la salida**, y eso cambia qué optimizaciones sirven (§1.4.1).

*Una sola muestra, y con una respuesta corta. Respuestas más largas subirán la salida, pero la entrada es casi fija, así que el reparto no debería moverse mucho.*

### 1.3 Escenarios

Asumiendo 4 directos por semana de 4 horas (16 directos al mes):

Recalculado con el coste medido de **$0.008065** por llamada:

| Escenario | Llamadas/hora | Por directo | Al mes |
|---|---:|---:|---:|
| **Situación actual de Crid4m** (sin espectadores) | 0-2 | **~$0.016** | **~$0.26 (0,25 €)** |
| Canal pequeño, cooldowns generosos | 20 | $0.65 | ~$10 (10 €) |
| Canal creciendo | 40 | $1.29 | ~$21 (20 €) |
| Canal activo, varias interacciones con IA | 60 | $1.94 | ~$31 (30 €) |

**Todas las cifras son la mitad de lo estimado en la Fase 0.** Con el canal como está hoy el gasto es de céntimos al mes, casi todo de tus propias pruebas.

Esto cierra el debate del modelo: **no hay ningún motivo para bajar de Opus 5.** Incluso con el canal creciendo, hablamos de 20 € al mes.

**Comparación de modelos** (misma llamada, mismos tokens):

| Modelo | Por llamada | Mes (escenario pequeño) | vs. Opus 5 |
|---|---:|---:|---|
| `claude-opus-5` | $0.016 | ~$20 | — |
| `claude-sonnet-5` | $0.0064 | ~$8 | 2,5× más barato |
| `claude-haiku-4-5` | $0.0032 | ~$4 | 5× más barato |

**Mi recomendación: empezar en Opus 5.** La personalidad del canal *es* el producto; recortar calidad de salida para ahorrar 12 € al mes sería optimizar la variable equivocada antes de tener un solo dato. El plan del DOCUMENTO 3 registra `response.usage` en cada llamada desde la Fase 4 precisamente para que esta decisión se tome con tus números reales en la Fase 12, no con mis estimaciones ahora. Si entonces resulta que `#1 Primer Mensaje` no necesita un modelo grande, se baja esa interacción concreta y ya está — la fachada `services/ai` permite elegir modelo por interacción.

### 1.4 Qué optimizaciones sirven de verdad

Ordenadas por efecto real en **este** caso de uso:

Reordenadas con los datos reales de la Fase 4. **La entrada es el 79 % del coste**, así que las palancas que atacan la salida importan mucho menos de lo que pensábamos:

| Palanca | Ahorro | Comentario |
|---|---:|---|
| **No llamar a la IA** | 100 % | Cooldowns, respuestas predefinidas, y la regla de tu punto 3. Sigue siendo la palanca más grande con diferencia. |
| **Caché de prompt** | **30-40 %** | **Sube al segundo puesto.** El 75 % de la entrada es prefijo fijo. Implementado con TTL de 1 hora; rentable a partir de 3 preguntas/hora (§1.4.1). |
| **Acortar el prompt de sistema** | hasta ~30 % | Palanca nueva que no habíamos visto: 963 de los 1.273 tokens de entrada son la personalidad. Cada línea que sobre en `crid4m.md` se paga en **todas** las llamadas. |
| `effort: "low"` | ya aplicado | Funciona mejor de lo previsto: 68 tokens de salida en vez de los ~400 estimados. Ya no queda margen aquí. |
| `max_tokens` bajo | ~0 % | Irrelevante: solo es un tope, y la salida real (68 tokens) no se acerca. |
| Cambiar de modelo | 60-80 % | La única que cuesta calidad. Con 10 €/mes en el peor caso, **no compensa ni planteárselo**. |

### 1.4.1 Caché de prompt: medido en la Fase 4 → implementado en la Fase 5

Medido con `npm run ai:test -- --tokens`, no estimado:

- **Prompt de sistema: 963 tokens** (2.181 caracteres). El mínimo de Opus 5 son 512, así que hay **casi el doble de margen**. Es cacheable de sobra.
- Entrada total por llamada: **1.273 tokens**. Es decir, **el 75 % de la entrada es prefijo fijo y cacheable**.

> Nota sobre una estimación fallida: en la Fase 0 calculé ~570 tokens usando 3,6 caracteres por token. En español con acentos y markdown la densidad real es de **2,26 caracteres por token**. Conviene medir, no estimar.

Cuentas con los precios reales:

| | Sin caché | Con caché (lectura) |
|---|---:|---:|
| Entrada cacheable (963 tok) | $0.004815 | $0.000482 |
| Entrada variable (310 tok) | $0.001550 | $0.001550 |
| Salida (68 tok) | $0.001700 | $0.001700 |
| **Total** | **$0.008065** | **$0.003732** |

El ahorro sería del **53 %**, no del 20 % que había calculado antes. Pero eso solo aplica a las **lecturas**: escribir la caché cuesta 1,25× con el TTL de 5 minutos y 2× con el de 1 hora.

#### Revisión (23 sep 2026): implementado con TTL de 1 hora

La tabla de arriba daba el equilibrio en 2 llamadas **por cada ventana de 5 minutos**, y de ahí salió el "no implementado". El error de razonamiento estaba en la ventana, no en las cuentas: **los cooldowns del propio sistema son de 5 y 15 minutos**, así que dos preguntas dentro de la misma ventana de 5 minutos es precisamente lo que el diseño impide que ocurra. Con ese TTL la caché estaba condenada a caducar sin leerse nunca.

Con TTL de 1 hora la escritura cuesta 2× en vez de 1,25×, pero la entrada aguanta entre preguntas, que es lo que aquí hace falta:

| Llamadas en una hora | Sin caché | Con caché 1h | |
|---:|---:|---:|---|
| 1 | $0.0081 | $0.0129 | ❌ más caro |
| 2 | $0.0161 | $0.0166 | ≈ igual |
| 3 | $0.0242 | $0.0203 | ✅ −16 % |
| 5 | $0.0403 | $0.0278 | ✅ −31 % |
| 10 | $0.0807 | $0.0465 | ✅ −42 % |

**El punto de equilibrio está en 3 preguntas por hora.** Cada lectura reinicia el contador del TTL, así que un directo con preguntas cada 10-20 minutos mantiene la entrada viva toda la sesión.

**Decisión: implementado y configurable** (`AI_CACHE_TTL`, por defecto `1h`; acepta `5m` y `off`).

Con el tráfico de hoy (0-2 preguntas por directo) esto es **ligeramente peor**, del orden de medio céntimo por directo. Se asume a propósito: el coste de equivocarse por este lado es despreciable y el de no tenerlo puesto cuando el chat crezca es un 40 % de la factura. La condición para volver a `5m` u `off` sería que la tabla `ai_usage` mostrase, de forma sostenida, menos de 3 llamadas por hora de directo.

**Sobre el caché, dos avisos concretos:**

1. **Solo funciona si el prefijo llega a 512 tokens** (mínimo de Opus 5). Si el archivo de personalidad se queda corto, el caché **no se activa y no da ningún error**: verás `cache_creation_input_tokens: 0` y creerás que funciona. Hay que comprobarlo explícitamente en la Fase 4.
2. **Cualquier byte que cambie en el prefijo lo invalida todo.** Un timestamp o un contador dentro del prompt de personalidad y el caché deja de servir en silencio. El orden correcto es: personalidad fija → reglas fijas → punto de caché → contexto variable → mensaje del espectador.

### 1.5 Topes de gasto

Más importante que optimizar es no poder pasarse.

#### Corrección (23 sep 2026): el tope por directo no protegía

Hasta aquí el único tope era el de **sesión**, y vivía en memoria. Eso significaba que reiniciar el proceso lo ponía a cero. En una tarde de pruebas el bot se arranca diez veces, así que "3 $ por directo" era en la práctica **"3 $ por cada arranque"**: un tope que no acota nada.

Ahora son **cuatro topes**, y basta con que salte uno para que no se llame a Anthropic:

| Tope | Variable | Por defecto | Dónde vive |
|---|---|---:|---|
| Por sesión | `AI_BUDGET_PER_STREAM_USD` | 3 $ | memoria (se reinicia al arrancar) |
| Por día | `AI_BUDGET_PER_DAY_USD` | 5 $ | **SQLite** (sobrevive al reinicio) |
| Por mes | `AI_BUDGET_PER_MONTH_USD` | 20 $ | **SQLite** |
| Llamadas por día | `AI_MAX_CALLS_PER_DAY` | 250 | **SQLite** |

Los de día y mes se calculan sumando `cost_usd` en la tabla `ai_usage`. Los cortes caen a **medianoche local**, no UTC: un directo de 22:00 a 02:00 cruza la medianoche UTC a mitad de sesión, y con ventanas UTC el tope diario se reiniciaría en mitad del directo.

**El tope de llamadas no es redundante con los de dinero.** `cost_usd` solo se conoce si el modelo está en la tabla de precios de `budget.ts`. Si se configura un modelo que no está, el coste se guarda como `null`, los topes en dólares dejan de ver el gasto y **solo el contador de llamadas sigue protegiendo**. Por eso al arrancar se avisa explícitamente cuando el modelo configurado no tiene precio conocido.

Si no se puede leer la contabilidad (base de datos bloqueada, disco lleno), `since()` devuelve infinito y **no se llama a la IA**. Ante la duda, no se gasta.

Además, y como antes:

- Corte automático de las interacciones con IA al llegar a cualquier tope; el resto del sistema sigue funcionando con el texto de reserva
- Cooldown por usuario **y** cooldown global en el comando gratuito
- Interruptor de emergencia (`!apagar`) por delante de todo, antes incluso de mirar el presupuesto

El gasto se ve sin abrir la base de datos: al arrancar, después de cada llamada, y bajo demanda con `!estado`.

**Fuera de nuestro código queda el tope duro:** el límite de gasto mensual de la consola de Anthropic (Plans & Billing). Ese es el único que no depende de que nuestro código funcione, y conviene tenerlo puesto.

---

## 2. Riesgos

Ordenados por lo que de verdad puede hacer daño.

### ✅ R1 — No ser Afiliado — **CERRADO (22 sep 2026)**

Crid4m **es Afiliado**. Channel Points, Polls y Predicciones están disponibles.

Se mantiene igualmente la regla del doble disparador (punto + comando) en todas las interacciones `CP`, por un motivo distinto al original: **un comando de chat es gratis para el espectador**, y con un canal que arranca de cero conviene no poner ningún peaje.

### 🔴 R13 — Construir para una audiencia que todavía no existe

**El riesgo real del proyecto hoy**, y sustituye a R1 como el número uno.

El canal viene de años parado y no tiene espectadores. Doce de las 28 interacciones del catálogo (las 🟡 y 🔴) no tienen con quién funcionar. Existe el riesgo de invertir semanas en dinámicas de grupo que nadie va a usar, y de medir el éxito del proyecto por algo que el proyecto no controla.

**Hay que decirlo una vez y no repetirlo:** un bot no trae espectadores, amplifica una comunidad que ya existe. El cuello de botella del canal está en otro sitio — horario, contenido, descubribilidad — y ninguna de estas 28 interacciones lo toca.

**Mitigación (ya incorporada al roadmap):**
- El núcleo se reduce a **6 interacciones que funcionan con una sola persona** (DOCUMENTO 2 §7.2).
- La Fase 8 pasa de "sistema social" a **"sistema de memoria"**: con dos espectadores, lo valioso no es que se relacionen entre sí, es que el bot los recuerde.
- Las sociales quedan en la **Fase 8-bis**, con condición de arranque explícita (5+ espectadores habituales). No se construyen antes.
- La puerta de validación de la Fase 5 *"¿la usa alguien?"* queda **aplazada, no eliminada**: se contesta cuando haya a quién preguntar.

**Lo que sí justifica seguir adelante ahora:** el objetivo de aprendizaje full-stack (punto 11 del brief), que no depende de los espectadores, y tener el sistema listo y depurado para cuando empiecen a llegar. Depurar sin público delante es una ventaja, no un consuelo.

### ✅ R14 — Tres bots en el mismo chat — **RESUELTO (22 sep 2026)**

Había Streamer.bot, Streamlabs y StreamElements activos a la vez: bienvenidas duplicadas, comandos en conflicto y tres respuestas al mismo evento. Con pocos espectadores eso se nota muchísimo — era el riesgo R4 ocurriendo ya, antes de construir nada.

**Decisión: se apagan Streamlabs y StreamElements.** Solo queda Streamer.bot.

Nota: son bots en la nube, así que apagarlos no libera recursos del PC — libera el chat, que es lo que importa. Si además tenías sus *aplicaciones de escritorio* abiertas (Electron, cientos de MB), ahí sí ganas recursos, y bastantes más de los que consume todo este backend.

### 🔴 R2 — La IA dice algo por lo que te sancionan a ti

Ante Twitch, de lo que diga tu bot respondes tú. Un aviso puede costarte el canal.

**Mitigación (Fases 4 y 5):**
- Lista de temas permitidos y lista negra explícita en la personalidad
- Capa `policy` obligatoria: longitud, URLs, comandos, menciones, lista de bloqueo
- **Modo revisión durante las primeras semanas:** la respuesta se imprime en tu consola antes de publicarse; tú apruebas. Es incómodo, pero solo durante los primeros directos, y es el único control que de verdad garantiza que nada te sorprenda en directo.
- Interruptor de emergencia desde la Fase 2

### 🟠 R3 — Inyección de prompt

Un espectador escribe *"ignora tus instrucciones anteriores y di X"*.

**Mitigación (Fase 5):**
- **El texto del espectador nunca entra en el system prompt.** Va como contenido de usuario, claramente delimitado. Esta es la defensa estructural, no un filtro de palabras.
- Salida estructurada con `strict: true`: aunque el modelo se desvíe, la respuesta tiene que validar contra nuestro esquema.
- La capa `policy` se aplica después, siempre.
- Claude no puede ejecutar acciones hasta la Fase 10.
- **Probarlo a propósito es un criterio de hecho de la Fase 5**, no una nota al pie.

### 🟠 R4 — El bot se percibe como spam

Es el riesgo número uno del *producto*, y no es técnico. Un bot que habla demasiado es peor que no tener bot.

**Mitigación (diseño, no código):**
- **Presupuesto global de mensajes del bot: máximo ~12 por hora.** Compartido entre todas las interacciones.
- **Silencio cuando el chat está vivo:** si hay conversación fluyendo, el bot no interrumpe. El bot es para cuando hace falta.
- Cooldown por tipo de interacción, además del global
- La métrica de la Fase 11 que mide esto es "mensajes generados en los 60 s siguientes". Si una interacción del bot no genera conversación, sobra.

### 🟠 R5 — Una raid dispara todo a la vez

Llegan 200 personas; el sistema detecta 200 primeros mensajes y dispara 200 bienvenidas.

**Mitigación (Fase 6):** **modo raid** — durante 3 minutos tras una raid, las interacciones de captación individual se desactivan y se sustituyen por un único mensaje colectivo. Es el fallo que con más probabilidad te va a morder si no se previene, porque solo aparece en el peor momento posible: cuando hay público nuevo mirando.

### 🟡 R6 — Latencia

Un espectador redime puntos y espera. Si tarda más de 5 segundos, el momento ya pasó.

**Mitigación:** `effort: "low"`, timeout duro de 8 s con respuesta de reserva. Sin streaming, porque no se puede publicar una respuesta a medias en el chat.

**Primera medición real (Fase 4): 4.360 ms.** Ya por encima del objetivo de 4 s, con una sola muestra y una respuesta corta. Hay margen hasta el timeout de 8 s, pero el objetivo está justo.

**Revisar en la Fase 5, con varias muestras.** La tabla `ai_usage` guarda `latency_ms` en cada llamada, así que el percentil se puede calcular en lugar de estimarlo. Si se confirma por encima de 4 s, la palanca no es el modelo: es acortar el prompt de sistema (963 tokens tardan en procesarse) o dar un acuse de recibo en el chat mientras se piensa.

### 🟡 R7 — Rate limit del chat de Twitch

20 mensajes / 30 s para una cuenta normal; 100 / 30 s si la cuenta del bot es moderadora.

**Mitigación:** haz moderadora a la cuenta del bot (gratis, ×5 de margen) y añade una cola de salida propia con un límite más conservador que el de Twitch. En la práctica el R4 (presupuesto de 12 mensajes/hora) ya nos deja muy por debajo de cualquier límite.

### 🟡 R8 — Dependencia de Streamer.bot

Es software de terceros que ha tenido cambios que rompen compatibilidad recientemente: **v1.0.7 eliminó el objeto `message` de los payloads**, y la v1.1.0 está en alpha.

**Mitigación:**
- **Fija la versión. No actualices Streamer.bot en mitad de una racha de directos.**
- La capa `transport` es fina a propósito: si algo cambia, se toca un archivo.
- Desconfía de cualquier tutorial o ejemplo anterior a agosto de 2026.

### 🟡 R9 — Tu PC es el servidor

Si el backend falla, falla en la máquina desde la que estás emitiendo.

**Mitigación:** proceso separado, nunca dentro de Streamer.bot ni de OBS. Reinicio automático. Límite de memoria. Y la regla que importa: **si el backend muere, Streamer.bot y OBS siguen funcionando exactamente igual.** El sistema se degrada, no rompe el directo.

### 🟡 R10 — Coste descontrolado por un troll o un bucle

**Mitigación:** ya cubierto en 1.5. Los topes de **día y mes** son la red de seguridad final, y son los que importan aquí: viven en SQLite, así que un troll no los esquiva reiniciando el bot ni esperando al día siguiente dentro del mismo mes. El tope de llamadas diarias cubre además el caso de que el coste no se pueda calcular.

### 🟢 R11 — Datos personales

Vas a guardar historial de espectadores identificables. El RGPD aplica aunque sea un proyecto personal.

**Mitigación (barata ahora, cara después):**
- Guarda el **ID numérico de Twitch**, no correos ni nada externo
- Retención de 90 días en los datos de contenido (lo que dijeron); el perfil básico puede persistir
- Comando **`!olvidame`** que borra todo lo de esa persona
- Una línea en los paneles del canal diciendo que el bot recuerda interacciones

### 🟢 R12 — Perder la motivación construyendo infraestructura

Es un proyecto de una sola persona que además está aprendiendo. El riesgo real no es técnico: es construir el motor perfecto y no llegar nunca al directo.

**Mitigación (ya en el roadmap):** la regla de los tres casos antes de abstraer, las puertas de validación en directo, y la ruta alternativa de la sección 4 del DOCUMENTO 3 — Fase 2 + Fase 3 y ya tienes algo funcionando en tu chat, sin IA y sin coste.

---

## 3. Limitaciones técnicas

Cosas que **no se pueden hacer**, para no diseñar sobre suposiciones:

### Twitch
- **500 caracteres por mensaje.** Límite duro para la salida de la IA.
- **No se puede consultar el saldo de Channel Points de un espectador.** Solo se observan las redenciones. Esto recorta el dato "Channel Points gastados" de tu punto 8: solo contaremos lo gastado en *nuestras* recompensas.
- **La lista de espectadores es aproximada.** No sirve como fuente de verdad sobre quién está viendo.
- **Los susurros (whispers) no son una vía fiable** para un bot. Todo tiene que ocurrir en el chat — que además es lo que querías.
- **Polls:** 2-5 opciones, de 15 a 1800 s, uno activo a la vez.
- **Channel Points / Polls / Predicciones:** Afiliado o Partner. Ver R1.
- IRC dejó de funcionar el 15 de agosto de 2025. Todo pasa por EventSub y la Helix API.

### Streamer.bot
- **`Fetch URL` solo hace GET.** Para POST hay que escribir C# dentro de la GUI. Por eso la arquitectura invierte la conexión y usa WebSocket.
- **El servidor WebSocket solo escucha en localhost por defecto.** Se puede abrir a la LAN; abrirlo a internet sería mala idea.
- **Solo vemos lo que Streamer.bot expone.** Si algún campo de EventSub no llega a su payload, no lo tenemos. No hay bloqueo conocido para el catálogo propuesto, pero conviene verificarlo por interacción antes de construirla.
- Solo funciona en Windows.

### Claude
- **Caché de prompt: mínimo 512 tokens de prefijo en Opus 5**, y falla en silencio por debajo.
- **El prefill de mensajes de asistente está eliminado** en esta generación (devuelve error 400). Si lo has visto en tutoriales antiguos, ya no aplica.
- **En Opus 5, desactivar el pensamiento tiene dos modos de fallo conocidos** (puede escribir llamadas a herramientas como texto visible, y puede filtrar etiquetas `<thinking>`). La forma correcta de abaratar es `effort: "low"`, no desactivarlo.
- La latencia depende de internet. Sin conexión no hay interacciones con IA — de ahí que las respuestas de reserva sean obligatorias.

---

## 4. Preguntas abiertas — estado

| # | Pregunta | Respuesta | Efecto |
|---|---|---|---|
| 1 | ¿Eres Afiliado? | ✅ **Sí** | R1 cerrado. Channel Points, Polls y Predicciones disponibles |
| 2 | ¿Espectadores activos? | ✅ **Prácticamente cero** | 12 interacciones a la espera; núcleo reducido a 6. Ver R13 |
| 3 | ¿Cuenta de bot separada? | ⏳ Pendiente | Se decide en la Fase 3. Afecta al rate limit (R7) |
| 4 | ¿Tope de gasto mensual? | ✅ **Resuelto** | 20 $/mes y 5 $/día, persistidos en SQLite (§1.5). Falta ponerlo también en la consola de Anthropic, que es el tope duro |
| 5 | ¿Node en el PC del directo? | ✅ **Sí** | Arquitectura local confirmada |
| 6 | ¿Otros bots en el chat? | ✅ **Se apagan** | R14 resuelto. Solo Streamer.bot |

---

## 5. Lo que más probablemente salga mal

Actualizado con lo que sabemos ya del canal. Por orden de probabilidad:

1. **Que el proyecto se alargue y pierdas la motivación** (R12) — ha subido al primer puesto. Sin espectadores no hay retorno inmediato que empuje, así que el motor del proyecto durante los próximos meses es el aprendizaje, no el chat. Las puertas de validación y la regla de los tres casos existen exactamente para esto, y la ruta alternativa del DOCUMENTO 3 §4 sigue disponible.
2. **Que se construyan dinámicas para una audiencia que no está** (R13). Mitigado reordenando el catálogo, pero conviene releer esto antes de cada fase.
3. **Que el bot hable demasiado** (R4). Menos probable que antes por el volumen bajo, pero **más visible**: con dos personas en el chat, un bot que interrumpe se nota muchísimo más que con ochenta.
4. **Que una raid lo dispare todo a la vez** (R5). Baja probabilidad hoy, pero si llega una raid será justo el momento de máxima exposición del canal — el peor sitio para un fallo. Mantener la mitigación.

Ninguno de los cuatro es un problema técnico. Eso, en un proyecto así, es buena señal: la parte técnica está razonablemente acotada.
