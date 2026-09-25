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

**Iconos de Twitch** en `biblioteca/imagenes/twitch/`: moneda Oro (18/36/72) y uno por recompensa (28/56/112). Fuente en `docs/iconos/`.

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
2. **Puntos de canal**: en la web de Twitch, nombre **Oro** e icono `oro-moneda-18/36/72.png`.
3. **Rehacer las recompensas en la web de Twitch** para poder ponerles icono (Twitch no deja poner imagen a las creadas desde Streamer.bot). Con los precios y límites de la tabla y **Saltar la cola**. Después:
   - Borrar las viejas en Streamer.bot (Platforms → Twitch → Channel Point Rewards).
   - En cada acción, volver a elegir la recompensa en su disparador **Reward Redemption**.
   - **Pregunta a Crid4m AI**: al rehacerla cambia su id. Dejar vacío `PREGUNTA_IA_REWARD_ID` en el `.env` (la reconoce por el nombre) o pasarme el id nuevo.
4. **Probar el Loot con dos personas**: `crid4n` desde el móvil escribe en el chat; probar `!duelo`, un Grito de guerra con directo abierto y una Maldición seguida de un duelo.

### Cosas a tener en cuenta

- `FX Botin` está reducida al 57 % y colocada en (0, 198), y `FX Pocion` al 47 % arriba a la derecha. Si no fue a propósito, colocarlas a pantalla completa.
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
