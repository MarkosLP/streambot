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

### 1.2 Cálculo del coste de una llamada a la IA

Llamada típica de `#5 Pregunta a Crid4m AI` con `claude-opus-5` y `effort: "low"`:

| Parte | Tokens | Precio | Coste |
|---|---:|---|---:|
| Entrada: personalidad + reglas | ~800 | $5/M | $0.0040 |
| Entrada: contexto + pregunta | ~400 | $5/M | $0.0020 |
| Salida: razonamiento (effort low) | ~250 | $25/M | $0.0063 |
| Salida: respuesta (≤500 caracteres) | ~150 | $25/M | $0.0037 |
| **Total** | | | **~$0.016** |

**El hallazgo importante: la salida cuesta el 62 % del total, aunque sea tres veces más corta que la entrada.** Esto determina qué optimizaciones sirven y cuáles no (sección 1.4).

### 1.3 Escenarios

Asumiendo 4 directos por semana de 4 horas (16 directos al mes):

| Escenario | Llamadas/hora | Por directo | Al mes |
|---|---:|---:|---:|
| **Situación actual de Crid4m** (sin espectadores) | 0-2 | **~$0.10** | **~$1.60 (1,50 €)** |
| Canal pequeño, cooldowns generosos | 20 | $1.28 | ~$20 (19 €) |
| Canal creciendo | 40 | $2.56 | ~$41 (39 €) |
| Canal activo, varias interacciones con IA | 60 | $3.84 | ~$61 (58 €) |

**Con el canal como está hoy, el coste real es despreciable: menos de 2 € al mes**, casi todo de tus propias pruebas. La fila de "canal pequeño" es el objetivo, no el punto de partida. Esto quita presión a la decisión de modelo: no hay ningún motivo para bajar de Opus 5 mientras el gasto sea este.

**Comparación de modelos** (misma llamada, mismos tokens):

| Modelo | Por llamada | Mes (escenario pequeño) | vs. Opus 5 |
|---|---:|---:|---|
| `claude-opus-5` | $0.016 | ~$20 | — |
| `claude-sonnet-5` | $0.0064 | ~$8 | 2,5× más barato |
| `claude-haiku-4-5` | $0.0032 | ~$4 | 5× más barato |

**Mi recomendación: empezar en Opus 5.** La personalidad del canal *es* el producto; recortar calidad de salida para ahorrar 12 € al mes sería optimizar la variable equivocada antes de tener un solo dato. El plan del DOCUMENTO 3 registra `response.usage` en cada llamada desde la Fase 4 precisamente para que esta decisión se tome con tus números reales en la Fase 12, no con mis estimaciones ahora. Si entonces resulta que `#1 Primer Mensaje` no necesita un modelo grande, se baja esa interacción concreta y ya está — la fachada `services/ai` permite elegir modelo por interacción.

### 1.4 Qué optimizaciones sirven de verdad

Ordenadas por efecto real en **este** caso de uso:

| Palanca | Ahorro | Comentario |
|---|---:|---|
| **No llamar a la IA** | 100 % | Cooldowns, respuestas predefinidas, y la regla de tu punto 3. Es, con diferencia, la palanca más grande. |
| **`effort: "low"`** | ~40 % | Ataca el razonamiento, que es la mitad cara. Ya está en el diseño. |
| **`max_tokens` bajo (~300)** | ~15 % | El chat de Twitch solo admite 500 caracteres: pedir más tokens es pagar por texto que se va a truncar. |
| Cambiar de modelo | 60-80 % | Efectiva, pero es la única que cuesta calidad. Decisión para la Fase 12, con datos. |
| **Caché de prompt** | **~20 %** | Más modesto de lo que parece, porque solo afecta a la entrada, que es la mitad barata. |

**Sobre el caché, dos avisos concretos:**

1. **Solo funciona si el prefijo llega a 512 tokens** (mínimo de Opus 5). Si el archivo de personalidad se queda corto, el caché **no se activa y no da ningún error**: verás `cache_creation_input_tokens: 0` y creerás que funciona. Hay que comprobarlo explícitamente en la Fase 4.
2. **Cualquier byte que cambie en el prefijo lo invalida todo.** Un timestamp o un contador dentro del prompt de personalidad y el caché deja de servir en silencio. El orden correcto es: personalidad fija → reglas fijas → punto de caché → contexto variable → mensaje del espectador.

### 1.5 Tope de gasto

Más importante que optimizar es no poder pasarse. El diseño incluye, desde la Fase 4:

- Contador de gasto **por directo**, guardado en SQLite
- Corte automático de las interacciones con IA al llegar al tope (el resto del sistema sigue funcionando)
- Cooldown por usuario **y** cooldown global en toda interacción con IA
- Ninguna interacción con IA sin coste en Channel Points o sin cooldown largo

Sugerencia de partida: 3 $ por directo. Es más del doble del escenario pequeño, así que solo saltará si algo va mal — que es exactamente para lo que está.

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

**Mitigación:** `effort: "low"`, `max_tokens` bajo, timeout duro de 8 s con respuesta de reserva. Sin streaming, porque no se puede publicar una respuesta a medias en el chat.
**Objetivo:** percentil 95 por debajo de 4 s, medido en la Fase 12.

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

**Mitigación:** ya cubierto en 1.5. El tope por directo es la red de seguridad final.

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
| 4 | ¿Tope de gasto mensual? | ⏳ Pendiente | Arranca en 3 $/directo por defecto. Con el gasto real actual (~1,50 €/mes) no es urgente |
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
