# CRID4M Interaction System

Sistema de interacciones para el canal de Twitch **Crid4m**.

**Estado: FASE 2 — esqueleto.** Se conecta a Streamer.bot, normaliza los eventos que llegan y los imprime. **Todavía no responde en el chat.**

La propuesta completa está en [docs/](docs/): arquitectura, catálogo de interacciones, roadmap y riesgos.

---

## Requisitos

- **Node.js 22 o superior** (usa el `WebSocket` global, así que no hace falta ninguna librería extra).
- **Streamer.bot v1.0.7** con el servidor WebSocket activado.
- Windows (por Streamer.bot).

## Puesta en marcha

### 1. Activar el servidor WebSocket en Streamer.bot

En Streamer.bot: pestaña **Servers/Clients → WebSocket Server**.

- Dirección: `127.0.0.1`, puerto `8080` (los valores por defecto).
- Marca **Auto Start**.
- Recomendado: activa la autenticación y pon una contraseña.

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
| `npm run typecheck` | Comprueba los tipos. **Úsalo antes de cada directo.** |
| `npm run simulate -- demo` | Escena guionizada que recorre toda la Fase 2 sin Twitch |
| `npm run simulate -- <comando>` | Dispara un evento concreto |

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
| `!ping` | cualquiera | Sonda de prueba de la Fase 2. Se elimina en la Fase 3 |

---

## Estructura

```
src/
  index.ts                 arranque
  config.ts                única puerta al .env — nadie más lee process.env
  core/
    logger.ts              logs + captura de payloads sin normalizar
    events.ts              tipos de dominio y normalize()
    killswitch.ts          interruptor de emergencia
    output.ts              única salida del sistema
    handler.ts             pipeline por el que pasan todos los eventos
  transport/
    streamerbot.ts         único archivo que sabe que Streamer.bot existe
  cli/
    simulate.ts            consola de simulación
```

La regla que sostiene el diseño: **si algún día cambiamos de motor, solo se tocan `transport/` y `events.ts`.** Nada más del sistema ve un payload de Streamer.bot en crudo.

---

## Dos cosas que te van a confundir

### ¿Por qué los imports terminan en `.js` si los archivos son `.ts`?

```ts
import { log } from './core/logger.js';   // el archivo real es logger.ts
```

No es un error. En módulos ESM de Node, el import apunta al archivo **tal como existirá al ejecutarse**, y la extensión es obligatoria. TypeScript lo sabe y resuelve `logger.js` → `logger.ts`. Es la forma correcta y evita problemas más adelante.

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

## Qué NO hace todavía

- **No escribe en el chat.** `core/output.ts` solo registra lo que enviaría. Llega en la Fase 3.
- **No tiene base de datos.** Fase 3.
- **No usa IA.** Fase 4.
- El interruptor de emergencia vive en memoria: **reiniciar el proceso lo reactiva.** Deliberado mientras no haya base de datos.
