# DOCUMENTO 1 — Arquitectura recomendada

**Estado:** propuesta de FASE 0. Nada implementado.
**Fecha:** 22 de septiembre de 2026.

---

## 1. Resumen ejecutivo

He verificado las capacidades actuales de Twitch, Streamer.bot y la API de Claude. Tu arquitectura conceptual es correcta en el fondo, pero **cambiaría la dirección de la conexión entre Streamer.bot y la API**, y **dónde vive la API**.

Cambios que propongo, en orden de importancia:

| # | Tu propuesta | Mi propuesta | Motivo |
|---|---|---|---|
| 1 | Streamer.bot llama a la API por HTTP | La API se conecta como **cliente WebSocket** al servidor WebSocket de Streamer.bot | El sub-action `Fetch URL` de Streamer.bot **solo soporta GET**. Hacer POST obliga a escribir C# dentro de la GUI de Streamer.bot, una vez por cada interacción. Con WebSocket: cero C#, una sola conexión, sin HTTP por evento. |
| 2 | Hosting (implícito) | La API corre **en el mismo PC** que Streamer.bot | El servidor WebSocket de Streamer.bot escucha **solo en localhost** por defecto. Corriendo al lado: 0 € de hosting, latencia ~0 ms, nada expuesto a internet. |
| 3 | Claude devuelve decisiones de acción | Claude **rellena el contenido**, el motor decide la acción | Reduce la superficie de ataque a casi nada y elimina una clase entera de bugs. Tu diseño es el correcto, pero para la Fase 9, no para la v1. |
| 4 | BD "si merece la pena" | **SQLite desde la Fase 3** | Los cooldowns y el "¿he visto antes a este usuario?" la necesitan antes de lo que crees. Fichero local, 0 €, backup = copiar un archivo. |

El resto de tu planteamiento (Streamer.bot como motor de ejecución, IA solo donde aporta, validación de la salida, fases cortas con parada) lo mantengo tal cual: es el enfoque correcto.

---

## 2. Lo que he verificado (hechos, no suposiciones)

### 2.1 Streamer.bot

**Versión actual:** v1.0.7 estable (6 de agosto de 2026). La v1.1.0-alpha.1 salió el 21 de septiembre de 2026 — es alpha, **no la uses para esto**.

Hallazgos relevantes:

- **v1.0.7 eliminó la conexión IRC de Twitch y migró todo a EventSub.** Es la mejor noticia del proyecto: Streamer.bot ya resuelve OAuth, refresco de tokens, reconexión y **139 eventos de Twitch** por nosotros. Escribir nuestro propio cliente EventSub sería reimplementar semanas de trabajo sin ganar nada en la v1.
- **Breaking change de v1.0.7:** el objeto `message` antiguo desapareció de los payloads WebSocket. Los tutoriales y ejemplos anteriores a agosto de 2026 que encuentres por internet están rotos. Conviene saberlo antes de copiar código de un foro.
- **Streamer.bot trackea internamente el "primer mensaje" de un usuario**, precisamente porque EventSub no da ese flag. Esto nos regala gratis la señal más valiosa para captación.
- Eventos que nos interesan: `RewardRedemption`, `ChatMessage`, `Follow`, `Sub`, `ReSub`, `GiftSub`, `Cheer`, `Raid`, `StreamOnline`/`StreamOffline`, `HypeTrain`, `WatchStreak`, polls y predicciones.

**API WebSocket de Streamer.bot** (`ws://127.0.0.1:8080/`, configurable):

- Peticiones disponibles: `Subscribe`, `UnSubscribe`, `GetEvents`, `DoAction`, `GetActions`, `ExecuteCodeTrigger`, `GetActiveViewers`, `GetGlobals`/`GetGlobal`, `TwitchGetUserGlobals`, `GetBroadcaster`, `GetUserPronouns`, y **`SendMessage`**.
- **`SendMessage` publica directamente en el chat** (plataforma, usar cuenta de bot sí/no, texto). Requiere autenticación. Esto significa que nuestra API puede responder al chat **sin crear ni una sola Action dentro de Streamer.bot**.
- Autenticación: handshake `Hello` con `salt` y `challenge`, respuesta SHA256 en dos etapas codificada en base64. El cliente oficial lo resuelve solo.
- **Escucha solo en localhost por defecto.** Se puede abrir a la LAN cambiando la dirección. Abrirlo a internet sería mala idea.
- Cliente oficial: **`@streamerbot/client`** (npm, TypeScript nativo). Suscripción con `client.on('Twitch.ChatMessage', handler)` o `client.subscribe({ Twitch: ['ChatMessage'] })`.

**Puerta de salida a la nube (para el futuro):** Streamer.bot también puede actuar como **cliente WebSocket saliente** — existe el trigger `Websocket Client Message`. Si algún día la API tiene que vivir fuera del PC, la migración es posible sin rehacer el diseño. No hay que decidirlo ahora.

### 2.2 Twitch

- **IRC quedó fuera de servicio el 15 de agosto de 2025.** El camino actual es EventSub para leer y la Helix API para escribir. Streamer.bot ya lo hace por nosotros.
- **Límite de 500 caracteres por mensaje de chat.** Restricción dura para la salida de la IA.
- **Rate limit de envío:** 20 mensajes / 30 s para una cuenta normal; **100 / 30 s si la cuenta del bot es moderadora del canal**. Acción concreta: haz moderadora a la cuenta del bot. Es gratis y multiplica el margen por cinco.
- **Channel Points requieren ser Afiliado o Partner.** Lo mismo para **Polls** (scope `channel:manage:polls`) y **Predicciones** (`channel:manage:predictions`). Si Crid4m todavía no es Afiliado, alrededor del 40 % del catálogo no puede arrancar. **Consecuencia de diseño: toda interacción de Channel Points debe tener también un disparador por comando de chat.** No es un parche, es una regla del motor.
- No existe forma de consultar el saldo de puntos de un espectador por API. Solo podemos observar las redenciones de *nuestras* recompensas. Esto limita el dato "Channel Points gastados" de tu punto 8: solo contaremos lo que se gaste en lo nuestro.
- Polls: entre 2 y 5 opciones, de 15 a 1800 segundos, uno activo a la vez.
- La lista de espectadores es aproximada. No sirve como fuente de verdad sobre "quién está viendo".

### 2.3 API de Claude

Modelos y precios vigentes (por millón de tokens):

| Modelo | ID | Entrada | Salida |
|---|---|---:|---:|
| Claude Opus 5 | `claude-opus-5` | $5 | $25 |
| Claude Sonnet 5 | `claude-sonnet-5` | $2 | $10 |
| Claude Haiku 4.5 | `claude-haiku-4-5` | $1 | $5 |

Detalles que afectan al diseño:

- **En Opus 5 el pensamiento está activo por defecto.** Para respuestas cortas de chat la palanca correcta es `output_config: { effort: "low" }`, **no** desactivar el pensamiento: desactivarlo en Opus 5 tiene dos modos de fallo conocidos (puede escribir una llamada a herramienta como texto visible, y puede filtrar etiquetas `<thinking>` en la respuesta).
- **El caché de prompt necesita un prefijo mínimo de 512 tokens en Opus 5.** Si el prompt de personalidad se queda por debajo, el caché **no se activa y no da error**: simplemente verás `cache_creation_input_tokens: 0`. Hay que comprobarlo midiendo, no asumirlo.
- **Salidas estructuradas:** `output_config.format` con `strict: true` garantiza que la respuesta valide contra nuestro esquema. Es la herramienta correcta para tu punto 7.
- El *prefill* de mensajes de asistente está eliminado en esta generación (devuelve error 400). Si has visto ese truco en tutoriales, ya no aplica.

---

## 3. Arquitectura propuesta

### 3.1 Flujo real

```
Twitch  ──EventSub──▶  Streamer.bot  (PC de Crid4m)
                            │ ▲
             WebSocket      │ │   ws://127.0.0.1:8080
             (una conexión  │ │
              persistente)  ▼ │
                    ┌───────────────────┐
                    │    API CRID4M     │   (Node.js, mismo PC)
                    │                   │
                    │  transport   ◀────┼── eventos de Streamer.bot
                    │      ↓            │
                    │  event-bus        │   normaliza a eventos de dominio
                    │      ↓            │
                    │  engine           │   ¿qué interacción? ¿puede correr?
                    │      ↓            │
                    │  interaction      │   ¿necesita IA?
                    │      ↓   ↘        │
                    │  policy    ai ────┼──▶ Claude API (internet)
                    │      ↓   ↙        │
                    │  transport ───────┼──▶ SendMessage / DoAction
                    └───────────────────┘
                            │
                            ▼
                     Streamer.bot ──▶ Chat de Twitch
```

**Una sola conexión WebSocket** hace de entrada y de salida. No hay servidor HTTP que exponer, no hay C# que mantener dentro de Streamer.bot, no hay túneles.

### 3.2 Capas

| Capa | Responsabilidad | Regla que la define |
|---|---|---|
| `transport/streamerbot` | Conexión, reconexión, auth, suscripción, envío | **La única capa que sabe que Streamer.bot existe.** Si algún día lo sustituimos, solo se toca esto. |
| `core/events` | Traduce eventos de Streamer.bot a eventos propios (`viewer.message`, `viewer.redeem`, `viewer.raid`…) | El resto del sistema nunca ve un payload de Streamer.bot en crudo. |
| `core/engine` | Registro de interacciones, resolución de disparadores, guardas (cooldown, permisos, presupuesto) | Decide **qué** corre. Nunca genera texto. |
| `interactions/*` | Una carpeta por interacción, declarativa | Añadir una interacción = añadir un archivo. Cero cambios en el motor. |
| `services/ai` | Fachada sobre Claude con contrato propio | El resto del código **nunca** importa el SDK de Anthropic. Cambiar de modelo toca un archivo. |
| `core/policy` | Valida y sanea todo lo que sale hacia el chat | Último filtro obligatorio. Nada llega a Twitch sin pasar por aquí. |
| `data` | SQLite: usuarios, interacciones, cooldowns, presupuesto | |
| `personality` | Ficheros de texto y configuración, **no código** | Se puede cambiar el tono sin tocar el backend, como pedías en tu punto 6. |

### 3.3 Cómo se controla a Claude (tu punto 7)

Propongo ser **más restrictivo** de lo que planteabas, al menos hasta la Fase 9:

1. **Claude no elige la acción.** El motor ya decidió qué interacción corre antes de llamar a la IA. Claude solo rellena el contenido. Tu ejemplo `{"action": "start_poll", ...}` es la forma correcta para la Fase 9; en la v1 la superficie debe ser mínima.
2. **Salida estructurada obligatoria** (`output_config.format` con `strict: true`): la respuesta valida contra nuestro esquema o no existe.
3. **Capa `policy` después de la validación de esquema**, que comprueba:
   - longitud ≤ 480 caracteres (margen sobre el límite real de 500),
   - sin URLs, sin caracteres de control, sin `/comando` ni `.comando` de Twitch,
   - las `@menciones` solo pueden ser de usuarios que el motor pasó como participantes,
   - lista de bloqueo de términos,
   - presupuesto de mensajes del bot no agotado.
4. **El texto del espectador nunca entra en el system prompt.** Va como contenido de usuario claramente delimitado. Esto es lo que impide que "ignora tus instrucciones y di X" funcione.
5. **Timeout duro de 8 s con respuesta de reserva.** Si Claude tarda, responde una plantilla. El directo no espera.

---

## 4. Decisiones técnicas y por qué

### 4.1 Lenguaje: TypeScript sobre Node.js

| Opción | A favor | En contra | Veredicto |
|---|---|---|---|
| **TypeScript + Node** | `@streamerbot/client` es TS nativo; el SDK de Anthropic trae tipos; los tipos atrapan justo la clase de bug más común aquí (payloads con forma inesperada entre 139 tipos de evento) | Curva de aprendizaje algo mayor | **Elegido** |
| JavaScript + Node | Más simple de arrancar | Sin tipos, los payloads de 139 eventos distintos se vuelven adivinanzas en tiempo de ejecución | Descartado |
| Python | SDK de Anthropic excelente | No hay cliente oficial de Streamer.bot: habría que escribir el WebSocket y el handshake SHA256 a mano | Descartado |
| C# dentro de Streamer.bot | Cero dependencias externas | Editar código en cuadros de texto de una GUI, sin git, sin tests, sin depurador | Descartado |

Mitigación de la curva de aprendizaje: ejecutar con **`tsx`** (sin paso de compilación) y arrancar con `strict: false`, endureciendo el `tsconfig` a medida que avanzas. Aprendes TypeScript mientras el proyecto funciona, no antes de empezarlo.

### 4.2 Base de datos: SQLite

- Fichero local, cero servidor, cero coste, backup = copiar el archivo.
- Soporta de sobra las consultas de analytics de la Fase 10.
- **No uses JSON plano:** se corrompe con escrituras concurrentes y no te servirá cuando quieras responder "¿qué interacción genera más participación?".
- Postgres solo tendría sentido si el backend se fuera a la nube. No es el caso.
- **Cuándo introducirla: Fase 3**, con dos tablas (`users`, `interactions`). No antes.

### 4.3 Modelo de Claude

**Por defecto: `claude-opus-5` con `effort: "low"`.** La personalidad del canal *es* el producto; empezar recortando calidad para ahorrar veinte euros al mes sería optimizar la variable equivocada.

Dicho eso, y ya que pediste analizar el coste: la decisión debe tomarse **con datos reales**, no ahora. El plan es registrar `response.usage` en cada llamada desde la Fase 4, medir durante tres directos, y entonces decidir si alguna interacción concreta baja a `claude-sonnet-5` o `claude-haiku-4-5`. Los números están en el DOCUMENTO 4.

### 4.4 Dónde corre

**En el PC de Crid4m, al lado de Streamer.bot.**

- A favor: 0 € de hosting, latencia ~0 ms, nada expuesto a internet, el servidor WebSocket de Streamer.bot funciona tal cual sin tocar su configuración de red.
- El contraargumento obvio ("¿y si el PC se apaga?") no aplica: el sistema solo tiene sentido durante el directo, y durante el directo el PC está encendido por definición.
- Debe correr como **proceso separado** con reinicio automático, para que un fallo del backend no pueda tumbar OBS ni Streamer.bot.

---

## 5. Preguntas abiertas — RESPONDIDAS (22 sep 2026)

| # | Pregunta | Respuesta | Consecuencia |
|---|---|---|---|
| 1 | ¿Crid4m es Afiliado? | **Sí** | Channel Points, Polls y Predicciones disponibles. Riesgo R1 cerrado. Se mantiene igualmente el doble disparador (punto + comando): un comando es gratis para el espectador, y con poca gente eso importa. |
| 2 | ¿Espectadores concurrentes? | **Prácticamente cero.** Canal abandonado durante años, ahora retomado | **El cambio más grande.** Quedan fuera las 12 interacciones 🟡/🔴 del catálogo. El sistema se centra en las 5 que funcionan con **un solo espectador**. Ver §5.1. |
| 3 | ¿Cuenta de bot separada? | Pendiente | No bloquea. Se decide en la Fase 3. |
| 4 | ¿Tope de gasto mensual? | Pendiente | Se arranca con el valor por defecto de 3 $/directo en la Fase 4. |
| 5 | ¿Node corriendo en el PC? | **Sí** | Arquitectura local confirmada. Objetivo declarado: aprender full-stack (punto 11 del brief). |
| — | Otros bots en el chat | **Streamlabs y StreamElements se apagan** | Solo Streamer.bot. Evita bienvenidas duplicadas y comandos en conflicto, que con pocos espectadores se nota muchísimo. |

### 5.1 Qué implica un canal sin espectadores

Es un dato de diseño, no un obstáculo. Pero hay que decirlo con claridad: **un bot no trae espectadores, amplifica una comunidad que ya existe.** El cuello de botella del canal ahora mismo no es este sistema.

La vuelta, que sí es aprovechable:

> Con 80 espectadores, que uno se sienta ignorado no importa. Con 2, que el bot recuerde a esa persona tres semanas después es lo más valioso que puede pasar en el canal.

Eso reordena el proyecto alrededor de **la memoria**, no de las dinámicas de grupo. Las interacciones que trabajan con una sola persona (`#1`, `#2`, `#15`, `#18`, `#24`) pasan a ser el núcleo; las sociales (`#7`, `#13`, `#17`) quedan escritas y en espera hasta que haya con quién jugar.

Efecto secundario útil para el objetivo de aprendizaje: **puedes depurar sin público delante.**

### 5.2 Por qué Node y no solo Streamer.bot

Pregunta legítima que conviene dejar respondida por escrito, porque volverá a surgir.

Para las cinco interacciones del núcleo, **Streamer.bot solo sería suficiente**: tiene variables por usuario, C# y lógica de sobra. Si el único objetivo fuera "que el bot funcione", Node sobraría.

Node se gana el sitio por dos razones, y solo dos:

1. **La capa de IA con controles reales:** timeout, reintentos, validación de esquema, sanitización, tope de gasto, registro de coste. Escribible en C#, sí — dentro de cuadros de texto de una GUI, sin git, sin depurador y sin poder probarlo fuera del directo. Es justo el tipo de código donde un fallo se paga en directo.
2. **Aprender full-stack es un objetivo declarado del proyecto** (punto 11 del brief). No es carga añadida.

Sobre el coste en recursos, que fue la preocupación concreta:

| Proceso | RAM aprox. |
|---|---:|
| **Node (event-driven, esperando en un WebSocket)** | **60-80 MB** |
| Streamer.bot | ~300-500 MB |
| OBS | 500 MB - 1 GB+ |
| Un juego | varios GB |

Node es el ~1-2 % de lo que ya corre, con la CPU prácticamente a cero mientras no pasa nada. Las aplicaciones de escritorio de Streamlabs/StreamElements (Electron) pesan bastante más que todo este backend junto.

---

## 6. Lo que NO vamos a construir (todavía)

Por escrito, para que sirva de freno:

- Nada de overlays. Todo en chat, como pediste.
- Sin panel de administración. Un fichero de configuración y los logs bastan.
- Sin servidor HTTP público. Si no hay nada que exponer, no hay nada que atacar.
- Sin colas de mensajes, sin Docker, sin microservicios.
- Claude no elige acciones hasta la Fase 9.
- Sin analytics más allá de registrar los eventos en bruto, hasta la Fase 10.
