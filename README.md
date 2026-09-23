# CRID4M Interaction System

Sistema de interacciones para el canal de Twitch **Crid4m**.

**Estado: FASE 5 — primera interacción con IA.** Recibe eventos de Twitch, consulta SQLite, llama a Claude cuando toca y **responde en el chat**.

La propuesta completa está en [docs/](docs/): arquitectura, catálogo de interacciones, roadmap y riesgos.

---

## Requisitos

- **Node.js 22 o superior** (usa el `WebSocket` global, así que no hace falta ninguna librería extra).
- **Streamer.bot v1.0.7** con el servidor WebSocket activado.
- Windows (por Streamer.bot).

## Puesta en marcha

### 1. Activar el servidor WebSocket en Streamer.bot

En Streamer.bot: **Servers/Clients → WebSocket Server**.

- Dirección: `127.0.0.1`, puerto `8080` (los valores por defecto).
- Marca **Auto Start**.
- **Activa la autenticación y pon una contraseña.** Ya no es opcional: la petición `SendMessage` la exige. Sin contraseña el sistema recibe eventos pero **no puede escribir en el chat**, y Streamer.bot responde `Authentication required`.

> ⚠️ **No lo confundas con `Custom WebSocket Servers`.** Son dos servicios distintos y están uno al lado del otro en el menú:
>
> - **`WebSocket Server`** → el de la API. Habla el protocolo (`Hello`, `Subscribe`, `DoAction`). **Es el que necesitamos.**
> - **`Custom WebSocket Servers`** → servidores en crudo para integraciones propias. **No hablan el protocolo de la API.**
>
> Si apuntas al segundo, la conexión TCP se establece pero el handshake nunca llega, y verás `Handshake timeout exceeded`. Y si los dos usan el mismo puerto, hay conflicto y el bueno no puede arrancar. El sistema detecta este caso y te lo explica en la consola.

> Por defecto solo escucha en `127.0.0.1`, es decir, solo acepta conexiones desde este mismo PC. Está bien así: **no lo abras a internet.**

### 2. Configurar el proyecto

```bash
npm install
cp .env.example .env
```

Abre `.env` y rellena `STREAMERBOT_PASSWORD` si activaste la autenticación, y `BROADCASTER_LOGIN` con tu usuario de Twitch en minúsculas.

`.env` está en `.gitignore` y **nunca** debe subirse a git.

### 3. Arrancar

```bash
npm start
```

---

## Comandos

| Comando | Qué hace |
|---|---|
| `npm start` | Arranca el sistema y se conecta a Streamer.bot |
| `npm run dev` | Igual, pero se reinicia solo al guardar un archivo |
| `npm test` | Ejecuta los tests |
| `npm run typecheck` | Comprueba los tipos |
| `npm run check` | Tipos + tests. **Úsalo antes de cada directo.** |
| `npm run simulate -- flujo` | Usuario nuevo saluda, el mismo usuario ya no |
| `npm run simulate -- demo` | Interruptor de emergencia y policy |
| `npm run simulate -- pregunta` | Pregunta a Crid4m AI por sus dos disparadores |
| `npm run simulate -- estado` | Contenido de la base de datos de simulación |
| `npm run simulate -- <comando>` | Dispara un evento concreto |
| `npm run ai:test "pregunta"` | Prueba la IA aislada. **No toca Twitch** |
| `npm run ai:test -- --tokens` | Mide el prompt de sistema (para decidir sobre la caché) |

### Simulador

Permite probar sin estar en directo y sin Streamer.bot abierto:

```bash
npm run simulate -- message --user=pepe --text="hola"
npm run simulate -- message --user=nuevo --text="hola" --first
npm run simulate -- redeem  --user=pepe --text="¿mando o teclado?"
npm run simulate -- demo
```

`npm run simulate -- --help` (o sin argumentos) lista todas las opciones.

> ⚠️ **Los dos guiones `--` son obligatorios.** Sin ellos, npm se queda las opciones para sí mismo y el simulador usa los valores por defecto sin avisar. `npm run simulate redeem --user=pepe` **no** hace lo que parece.

El simulador no construye eventos a mano: fabrica un payload con la forma de Streamer.bot y lo pasa por el **mismo** `normalize()` que usa la conexión real. Por eso lo que ves simulando es exactamente lo que verás en directo.

### Comandos dentro del chat

| Comando | Quién puede | Qué hace |
|---|---|---|
| `!apagar` | tú y los moderadores | **Interruptor de emergencia.** Bloquea al instante cualquier salida |
| `!encender` | tú y los moderadores | Reactiva el sistema |
| `!estado` | cualquiera | Muestra el estado en la consola |
| `!ping` | cualquiera | Sonda de verificación del camino de envío |
| `!pregunta <texto>` | cualquiera | Pregunta a Crid4m AI. Gratis, con cooldown de 5 min global y 15 min por persona. `!preguntar` vale igual |
| `!olvidame` | cualquiera | Borra todo lo que el bot guarda de esa persona y no vuelve a guardar nada suyo. Funciona aunque el sistema este apagado |
| `!incomoda` | subs y mods | Saca una pregunta personal del banco para que la respondas en voz alta. Tambien por Channel Point, sin cooldown |

---

## Estructura

```
src/
  index.ts                 arranque y cableado
  config.ts                única puerta al .env — nadie más lee process.env
  core/
    logger.ts              logs + captura de payloads sin normalizar
    events.ts              tipos de dominio y normalize()
    handler.ts             pipeline por el que pasan todos los eventos
    killswitch.ts          interruptor de emergencia
    cooldowns.ts           ventanas de tiempo por interacción y por usuario
    policy.ts              qué puede salir al chat y qué no
    review.ts              aprobación manual de lo que genera la IA
    console-approver.ts    la parte de la revisión que habla con la terminal
    output.ts              única salida del sistema
  data/
    db.ts                  SQLite: conexión y esquema
    users.ts               quién ha escrito y cuándo
    interactions.ts        qué hizo el sistema y cómo acabó
  interactions/
    primer-mensaje.ts      #1 del catálogo, sin IA
    pregunta-ia.ts         #5 del catálogo, con IA
  services/ai/
    index.ts               ask(intent, context) — el resto no conoce Anthropic
    claude.ts              único archivo que importa el SDK
    budget.ts              presupuesto y contabilidad
  personality/
    crid4m.md              personalidad, editable sin tocar código
  transport/
    streamerbot.ts         único archivo que sabe que Streamer.bot existe
  cli/
    simulate.ts            consola de simulación
```

Tres reglas sostienen el diseño:

1. **Si cambiamos de motor, solo se tocan `transport/` y `events.ts`.** Nada más ve un payload de Streamer.bot en crudo.
2. **Nada sale al chat sin pasar por `policy`.** No porque haya que acordarse de llamarla, sino porque `output.send()` es el único camino y la llama siempre.
3. **`output.ts` no importa el transporte: se lo inyectan.** Eso rompe el ciclo de dependencias y permite que tests y simulador recorran el mismo código con un emisor falso. Lo mismo vale para el aprobador y para la llamada a Claude.
4. **Claude propone contenido; Node decide qué hacer con él.** La IA nunca ejecuta una acción.

### Recorrido de un mensaje

```
Twitch → Streamer.bot → transport → normalize() → handler
                                                     │
                                          ignora bots y al canal
                                                     │
                                          users.touch()  ← SQLite
                                                     │
                                      primer-mensaje / pregunta-ia
                                                     │
                                          guardas: ¿cooldown? ¿entrada válida?
                                                     │
                                          services/ai → Claude  (si toca)
                                                     │
                                          output.send()
                                                     │
                                          policy.evaluate()
                                                     │
                                          review  ← aprobación manual
                                                     │
                                          transport.sendChat() → Twitch
                                                     │
                                          interactions.record() ← SQLite
```

---

## Dos cosas que te van a confundir

### ¿Por qué los imports terminan en `.js` si los archivos son `.ts`?

```ts
import { log } from './core/logger.js';   // el archivo real es logger.ts
```

No es un error. En módulos ESM de Node, el import apunta al archivo **tal como existirá al ejecutarse**, y la extensión es obligatoria. TypeScript lo sabe y resuelve `logger.js` → `logger.ts`. Es la forma correcta y evita problemas más adelante.

### Si cierras y reabres Streamer.bot

No pasa nada: el sistema reintenta solo, de forma indefinida. Pero el intervalo entre reintentos **crece 1 segundo por intento hasta un tope de 30 segundos**, así que si reinicias Streamer.bot en mitad de un directo, el bot puede tardar **hasta medio minuto** en volver a engancharse.

En la consola solo verás un aviso al perder la conexión y otro al recuperarla. El ruido de los reintentos está silenciado a propósito para que no tape los eventos del chat; si quieres verlo, arranca con `LOG_LEVEL=debug`.

### `logs/raw-events.log`

Los eventos que todavía no sabemos normalizar (follows, subs, raids…) se guardan ahí en crudo. No es un log de errores: es **materia prima** para escribir sus normalizadores en la Fase 3 con datos reales en lugar de deducirlos de la documentación.

Se puede desactivar con `CAPTURE_RAW_EVENTS=false`.

---

## Endurecer TypeScript

El proyecto arranca con `"strict": false` en `tsconfig.json` para bajar la barrera de entrada. Cuando te sientas cómodo:

1. Cambia a `"strict": true`.
2. `npm run typecheck`.
3. Arregla lo que salga, de arriba abajo.

No hay prisa, pero hazlo antes de que el proyecto crezca: cuanto más tarde, más errores de golpe.

---

## Modo de prueba sin riesgo

`DRY_RUN=true` en el `.env` hace que el sistema funcione entero —eventos, SQLite, cooldowns, policy— pero **sin enviar nada a Twitch**. En la consola verás `[SIMULADO · ...]` en lugar de `[ENVIADO · ...]`.

Sirve para hacer un directo completo comprobando qué habría dicho el bot, antes de soltarlo de verdad.

## Pregunta a Crid4m AI

La interacción tiene **dos disparadores y una sola implementación** ([pregunta-ia.ts](src/interactions/pregunta-ia.ts)):

- **Channel Point** — crea en Twitch una recompensa con **"Requerir que el espectador introduzca texto"** activado. Llámala `Pregunta a Crid4m AI` o pon su ID en `PREGUNTA_IA_REWARD_ID`.
- **`!pregunta <texto>`** — gratis, con cooldown de 5 min global y 15 min por persona. Se acepta también `!preguntar`, porque es lo que la gente escribe de forma natural.

Los cooldowns **solo se aplican al comando**. Una redención de Channel Points nunca se bloquea por ellos: quien paga puntos tiene que recibir respuesta. Su limitador es el coste, que configuras en Twitch donde corresponde.

### Modo revisión

Con `REVIEW_MODE=true` (por defecto), **nada de lo que escriba Claude sale al chat sin tu visto bueno**:

```
┌─ REVISIÓN ──────────────────────────────────────────────────
│ Interacción: pregunta-ia
│
│   @pepe Mando para plataformas, teclado para shooters.
│
└─ ¿Se publica en Twitch?  s = sí · n = no  (90s)
```

Escribes `s` o `n`. Si no contestas en 90 segundos, se descarta — un directo no puede quedarse colgado esperándote.

Solo pasa por aquí el texto **generado por Claude**. Los saludos y los textos de reserva son deterministas: ya sabes qué dicen, revisarlos sería un incordio sin ganancia.

Es la mitigación del riesgo R2 de [docs/04](docs/04-RIESGOS-COSTES-LIMITACIONES.md): ante Twitch, de lo que diga tu bot respondes tú. Se desactiva tras los dos directos de validación.

## La capa de IA

Vive en [src/services/ai/](src/services/ai/). Genera contenido validado y lo devuelve; quien decide qué hacer con él es el backend.

- La personalidad está en [src/personality/crid4m.md](src/personality/crid4m.md). **Es un archivo de texto: cámbialo sin tocar código.**
- El texto del espectador viaja siempre dentro de `<mensaje_espectador>` en el turno de usuario, **nunca** interpolado en el prompt de sistema. Esa separación es la defensa contra la inyección de prompt, y no es un filtro de palabras que se pueda esquivar reformulando.
- La respuesta se valida contra un esquema y contra el límite de 480 caracteres. Si algo falla —timeout, error, salida inválida, respuesta demasiado larga— se devuelve un **texto de reserva determinista**, nunca una segunda llamada a la IA.
- Presupuesto de 3 $ por sesión. Al agotarse, deja de llamar y el resto del sistema sigue funcionando.
- El interruptor de emergencia corta las llamadas **antes** de gastar nada.

Cada llamada queda registrada en la tabla `ai_usage` con tokens, coste y latencia.

## Qué NO hace todavía

- **Solo hay dos interacciones** (`primer-mensaje` y `pregunta-ia`). El motor que permita añadirlas sin tocar el resto llega en la Fase 7, cuando haya tres casos reales de los que extraer el patrón.
- El interruptor de emergencia vive en memoria: **reiniciar el proceso lo reactiva.** Deliberado.
- Los cooldowns también viven en memoria. El "una sola vez en la vida" de `primer-mensaje` **no** depende de ellos: lo garantiza SQLite, que sí sobrevive a los reinicios.
