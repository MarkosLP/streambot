# DOCUMENTO 3 — Roadmap por fases

**Estado:** propuesta de FASE 0.
Revisión de tus 12 fases originales. Mantengo la estructura y la filosofía; cambio seis cosas concretas y explico por qué cada una.

---

## 1. Qué cambio de tus fases y por qué

| # | Cambio | Motivo |
|---|---|---|
| 1 | **Añado una consola de simulación en la Fase 2** | Tal como estaba, cada prueba exige estar en directo. Poder disparar eventos falsos desde la terminal es la inversión que más tiempo ahorra en todo el proyecto. Sin esto, el proyecto avanza al ritmo de tu calendario de directos. |
| 2 | **Adelanto el interruptor de emergencia a la Fase 2** | Antes de que nada con IA hable en tu chat, tiene que existir una forma de apagarlo en un segundo. Es media hora de trabajo y evita el peor escenario posible. |
| 3 | **Adelanto SQLite a la Fase 3** (tú lo dejabas implícito hasta la 8) | Los cooldowns persistentes y el "¿he visto antes a este usuario?" la necesitan ya en la Fase 3. Añadirla después obliga a reescribir. |
| 4 | **Adelanto un archivo de personalidad mínimo a la Fase 4** (tú lo ponías en la 9) | La personalidad es el 80 % de si esto se siente "propio de Crid4m". Y es un archivo de texto, no código. La Fase 9 pasa a ser *sistema* de personalidad (variantes por contexto), no *introducir* la personalidad. |
| 5 | **Reordeno la relación entre tu Fase 5 y tu Fase 6** | Construir una interacción y después el motor obliga a reescribir esa interacción. Construir el motor antes es adivinar. **Regla: no se abstrae nada hasta tener tres casos reales.** La Fase 5 construye una interacción con la *forma* del motor; el motor se extrae en la Fase 7, cuando ya hay tres. |
| 6 | **Añado una puerta de validación en directo entre fases** | Dos directos reales usando lo construido antes de avanzar. Sin esto se acumulan funcionalidades que nadie usa — el fracaso más común en proyectos de este tipo. |

Tus fases 10, 11 y 12 me parecen correctas tal cual. Las renumero pero no las toco.

---

## 2. Reglas que aplican a todas las fases

1. **Una fase termina cuando el criterio de hecho se cumple, no cuando el código está escrito.**
2. **Tres casos antes de abstraer.** Copiar y pegar dos veces está bien. A la tercera, se extrae.
3. **Ninguna interacción llega al chat sin cooldown, sin límite de longitud y sin respuesta de reserva.**
4. **Puerta de validación:** después de las fases 5, 7 y 9, dos directos reales antes de seguir.
5. **Al terminar cada fase, informe de estado y parada** (plantilla en la sección 5).

---

## FASE 0 — Investigación ✅ ENTREGADA

**Objetivo:** saber qué se puede hacer de verdad antes de decidir nada.
**Entregables:** este documento, más el 01, el 02 y el 04.
**Hallazgos que cambiaron el plan:** `Fetch URL` solo hace GET; el servidor WebSocket de Streamer.bot solo escucha en localhost; v1.0.7 migró a EventSub y eliminó el objeto `message`; Channel Points, Polls y Predicciones requieren Afiliado.
**Decisiones cerradas (22 sep 2026):** Crid4m **es Afiliado**; el canal **no tiene espectadores** todavía; el backend corre **en local con Node**, con el aprendizaje full-stack como objetivo declarado; **Streamlabs y StreamElements se apagan** y solo queda Streamer.bot en el chat.
**Pendiente:** cuenta de bot separada (se decide en la Fase 3) y tope de gasto mensual (arranca en 3 $/directo).

---

## FASE 1 — Catálogo de interacciones ✅ ENTREGADA

**Objetivo:** tener de dónde elegir, sin implementar.
**Entregable:** DOCUMENTO 2, con 28 interacciones clasificadas.
**Cerrado:** orden de construcción revisado para canal sin espectadores (DOCUMENTO 2 §7). Las 12 interacciones 🟡/🔴 quedan en espera; el núcleo son las 6 que funcionan con una sola persona.

---

## FASE 2 — Esqueleto y herramientas de trabajo

**Qué vamos a conseguir:** un proyecto que arranca, se conecta a Streamer.bot, imprime los eventos que llegan, y se puede probar sin estar en directo.

**Por qué lo necesitamos:** es el suelo sobre el que va todo. Y la consola de simulación es lo que hace que las fases siguientes se midan en horas y no en semanas.

**Qué tocamos:**
- `package.json`, `tsconfig.json`, `.env.example`, `.gitignore` (con `.env` dentro **desde el primer commit**)
- `src/transport/streamerbot.ts` — conexión, auth, reconexión con reintento
- `src/core/events.ts` — normalización de eventos
- `src/core/logger.ts`
- `src/cli/simulate.ts` — **consola de simulación**
- `src/core/killswitch.ts` — **interruptor de emergencia**
- Repositorio git inicializado

**Criterio de hecho:**
- El proceso arranca, se conecta a Streamer.bot y sobrevive a que cierres y reabras Streamer.bot.
- Escribes en tu chat y el evento normalizado aparece en la consola.
- `npm run simulate -- redeem --user=pepe --text="hola"` produce el mismo evento normalizado que uno real.
  *(Corregido durante la Fase 2: sin los dos guiones `--`, npm se queda las opciones y el simulador usa los valores por defecto sin avisar.)*
- `!apagar` desde tu cuenta detiene toda salida al instante.
- `.env` no está en git. Verificado, no supuesto.

**Estimación:** 1-2 sesiones.
**Sin IA todavía. Sin base de datos todavía. Sin responder al chat todavía.**

---

## FASE 3 — Ida y vuelta completa, sin IA

**Qué vamos a conseguir:** un evento de Twitch entra, el sistema decide algo, y responde en el chat. El circuito completo, con lógica normal.

**Por qué lo necesitamos:** separa los problemas. Cuando metamos la IA en la Fase 4, si algo falla sabremos que es la IA, porque el resto ya estaba probado.

**Qué tocamos:**
- `src/transport/streamerbot.ts` — añadir `SendMessage`
- `src/core/policy.ts` — validación de salida (longitud, URLs, comandos, menciones)
- `src/core/cooldowns.ts`
- `src/data/db.ts` + esquema con **dos tablas**: `users`, `interactions`
- `src/interactions/primer-mensaje.ts` — la interacción #1 del catálogo, sin IA

**Criterio de hecho:**
- Alguien escribe por primera vez y recibe una pregunta en el chat.
- El cooldown funciona: dos primeros mensajes seguidos no producen dos respuestas.
- El usuario queda registrado en SQLite con fecha de primera aparición.
- El límite de 480 caracteres se aplica de verdad (probado con una respuesta larga a propósito).
- La consola de simulación reproduce todo el flujo sin Twitch.

**Estimación:** 2-3 sesiones.

---

## FASE 4 — Capa de IA aislada

**Qué vamos a conseguir:** un servicio de IA con contrato propio, medido y con tope de gasto, probado fuera del chat.

**Por qué lo necesitamos:** tu punto 4 del brief. El resto del proyecto no debe saber que Claude existe. Y necesitamos saber cuánto cuesta **antes** de dejarlo suelto.

**Qué tocamos:**
- `src/services/ai/index.ts` — fachada con contrato propio (`ask(intent, context)`)
- `src/services/ai/claude.ts` — la única parte que importa el SDK de Anthropic
- `src/services/ai/budget.ts` — **contador de gasto por directo, con corte automático**
- `src/personality/crid4m.md` — **archivo de personalidad mínimo** (tono, límites, palabras prohibidas)
- `.env` — `ANTHROPIC_API_KEY`

**Decisiones técnicas ya tomadas** (razonadas en el DOCUMENTO 1):
- `claude-opus-5` con `output_config: { effort: "low" }`
- `max_tokens` bajo (~300): el chat de Twitch solo admite 500 caracteres
- Salida estructurada con `strict: true`
- Timeout de 8 s con respuesta de reserva
- **Registrar `response.usage` de cada llamada en SQLite** — sin esto la Fase 12 es adivinar

**Criterio de hecho:**
- `npm run ai:test "¿mando o teclado?"` devuelve una respuesta con la voz de Crid4m.
- La respuesta valida contra el esquema; una respuesta malformada se rechaza sin tirar el proceso.
- El coste real por llamada aparece en los logs, y contrastas el número con el del DOCUMENTO 4.
- **Comprobado si el caché se activa:** si `cache_read_input_tokens` es 0 en llamadas repetidas, el prompt no llega a los 512 tokens mínimos y hay que decidir si merece la pena ampliarlo.
- Al superar el presupuesto del directo, las interacciones de IA se desactivan solas y el resto sigue funcionando.

**Estimación:** 2-3 sesiones.
**Todavía no conectado al chat.**

---

## FASE 5 — Primera interacción real en directo

**Qué vamos a conseguir:** `#5 Pregunta a Crid4m AI` funcionando de punta a punta, en un directo de verdad.

**Por qué lo necesitamos:** es tu candidata y estoy de acuerdo: es la interacción con más superficie de riesgo del catálogo, así que si sale bien, toda la infraestructura de seguridad queda construida y probada de una vez.

**Ventaja de no tener público todavía:** puedes depurarla y afinar la personalidad sin nadie mirando. Aprovéchalo — es el mejor momento posible para construir justo esta.

**Qué tocamos:**
- `src/interactions/pregunta-ia.ts`
- `src/core/policy.ts` — endurecer: **inyección de prompt, lista de bloqueo, menciones**
- Configuración del Channel Point en Twitch (eres Afiliado, así que está disponible) **y** el comando `!pregunta` como alternativa gratuita

**Criterio de hecho:**
- Rediges tú mismo el punto y recibes respuesta en menos de 5 segundos.
- Cooldown por usuario y global, funcionando.
- **Probado a propósito:** un mensaje de 2000 caracteres, un intento de inyección de prompt (`ignora tus instrucciones…`), y un corte de red a mitad de llamada. Los tres deben fallar con elegancia, no romper nada.
- El coste del directo aparece registrado.

**🚦 PUERTA DE VALIDACIÓN (adaptada a canal sin espectadores):** dos directos reales sin fallos, más un recorrido manual de los tres casos límite de arriba.

La pregunta original de esta puerta era *"¿la usa alguien?"*, y ahora mismo no se puede responder. Queda **aplazada, no eliminada**: en cuanto haya espectadores habituales, se vuelve a esta puerta y se contesta de verdad. Si entonces nadie la usa, se cambia la interacción.

**Estimación:** 2 sesiones + 2 directos.

---

## FASE 6 — Dos interacciones más (sin motor todavía) ✅ CÓDIGO ENTREGADO (23 sep 2026)

> **Estado:** las dos interacciones están construidas, probadas y documentadas.
> `#1` refinada para disparar con el flag de Streamer.bot en vez de con "es
> nuevo en nuestra base de datos", `#18` nueva, tabla `streams` creada y
> escena `npm run simulate -- vuelta` que recorre el criterio de hecho.
>
> Las notas del motor están en **docs/05-NOTAS-PARA-EL-MOTOR.md**.
>
> Las dos son espontáneas y el `.env` de Crid4m tiene
> `INTERACCIONES_ESPONTANEAS=false`, así que existen pero no se disparan.
> Decisión suya, tomada a sabiendas. Ver § 5 de las notas del motor.

**Qué vamos a conseguir:** `#1 Primer Mensaje` refinada y **`#18 Bienvenida de Vuelta`** funcionando.

**Por qué estas dos y no `#24`:** son el par que produce el efecto *"aquí me conocen"*, que es lo único que de verdad importa cuando llega **una** persona al canal. La `#18` además obliga a usar la BD en serio (`last_seen`, historial), que es donde está el aprendizaje.

**Por qué ahora y no el motor:** la regla de los tres casos. Con tres interacciones reales encima de la mesa, el motor de la Fase 7 se diseña a partir de hechos y no de suposiciones. Con una sola, sería inventado.

**Qué tocamos:**
- `src/interactions/primer-mensaje.ts` (refinada)
- `src/interactions/bienvenida-vuelta.ts`
- Tabla `streams` en SQLite

**Criterio de hecho:**
- Las tres interacciones conviven sin pisarse.
- Simulas un usuario visto hace 20 días y el bot lo reconoce al volver.
- **Anota por escrito qué has tenido que copiar y pegar entre las tres.** Eso, literalmente, es la especificación del motor de la Fase 7.

**Estimación:** 2-3 sesiones.

---

## FASE 7 — Motor de interacciones

**Qué vamos a conseguir:** extraer el patrón común para que añadir una interacción sea añadir un archivo.

**Por qué lo necesitamos:** es tu Fase 6 original, movida aquí. Ahora se construye sobre lo que se repitió de verdad, no sobre lo que imaginamos que se repetiría.

**Qué tocamos:**
- `src/core/engine.ts`
- `src/core/interaction.ts` — el contrato: disparador, entradas, guardas, ejecución, cooldown, permisos, IA sí/no, resultado
- Migrar las tres interacciones existentes al contrato

**Criterio de hecho:**
- Las tres interacciones siguen funcionando exactamente igual después de migrarlas.
- **La prueba real: añadir una cuarta interacción trivial en menos de 30 minutos, tocando un solo archivo.** Si no se cumple, el motor está mal y hay que simplificarlo, no añadirle capas.

**🚦 PUERTA DE VALIDACIÓN: dos directos.**

**Estimación:** 2-3 sesiones.

---

## FASE 8 — Sistema de memoria

> **Esta fase era "Sistema social". Se ha cambiado** porque las dinámicas sociales necesitan gente y el canal todavía no la tiene. Con un espectador, lo valioso no es que se relacione con otros: es que el bot lo recuerde.

**Qué vamos a conseguir:** `#2 Ticket de Entrada`, `#15 Dato Inútil` y `#24 Continuará`.

**Por qué lo necesitamos:** es el núcleo real del proyecto en su situación actual. La `#15` es la única de complejidad Alta que recomiendo construir, y es la que de verdad diferencia el canal: que el bot recuerde algo que dijiste hace un mes es desproporcionadamente potente cuando sois cuatro en el chat.

**Qué tocamos:**
- `src/core/memory.ts` — qué se guarda de un espectador, cuándo caduca, cuándo se saca
- `src/interactions/ticket-entrada.ts`, `dato-inutil.ts`, `continuara.ts`
- `src/core/consent.ts` — **`!olvidame` y opt-out permanente**, obligatorio para cualquier cosa que recuerde o mencione a alguien
- Tabla `memories` con caducidad a 90 días

**Criterio de hecho:**
- Guardas un dato de prueba, simulas el paso de tres semanas y el bot lo saca con naturalidad.
- `!olvidame` borra todo lo de esa persona. Verificado consultando la BD, no supuesto.
- Al cerrar el directo se genera y guarda un "continuará"; al abrir el siguiente, se lee.
- Nada de lo guardado sale de los temas neutros permitidos (juegos, comida, planes).

**Estimación:** 3-4 sesiones.

---

## FASE 8-bis — Sistema social *(en espera)*

**Qué contendría:** `#14 Presentación Cruzada` → `#7 Dos Puertas` → `#13 El Algoritmo`.

**Condición de arranque:** **5 o más espectadores activos de forma habitual.** Ninguna requiere Afiliado, así que no hay nada que preparar de antemano. Están escritas en el DOCUMENTO 2 y esperando a que haya con quién jugar.

No tiene sentido estimarla ahora.

---

## FASE 9 — Progresión

**Qué vamos a conseguir:** `#19 Rachas`. **Diseñar** XP y logros; implementar solo si el diseño convence.

*(`#23 Cita del Directo` estaba aquí y se retira: necesita suficiente chat para que haya una frase que merezca la pena elegir. Vuelve con la Fase 8-bis.)*

**Por qué lo necesitamos:** es lo que da razones de volver. Pero con la advertencia del catálogo: **XP por participar en interacciones, nunca por escribir mensajes**, o conviertes el chat en farmeo.

**Criterio de hecho:**
- Una racha se mantiene entre directos y se anuncia en los hitos.
- El comodín mensual funciona.
- Documento breve de diseño de XP **antes** de escribir una línea, y decisión explícita de construirlo o no.

**🚦 PUERTA DE VALIDACIÓN: dos directos.**

**Estimación:** 3 sesiones.

---

## FASE 10 — Sistema de personalidad

**Qué vamos a conseguir:** tu Fase 9 original. Separar personalidad, lógica, seguridad y ejecución; personalidad con variantes según contexto (nuevo vs. habitual, chat activo vs. muerto, momento serio vs. de broma).

**Por qué aquí y no antes:** el archivo mínimo ya existe desde la Fase 4. Lo que se construye aquí es el sistema de *variantes*, y eso necesita saber qué interacciones existen.

**Qué tocamos:**
- `src/personality/` — perfiles por contexto
- `src/core/context.ts` — detección de situación del directo
- Las reglas del sistema siguen teniendo prioridad sobre lo que genere Claude. Siempre.

**Aquí es donde por fin tiene sentido** dejar que Claude devuelva decisiones estructuradas del tipo `{"action": "...", ...}` como planteabas en tu punto 7, porque para entonces existirá la lista blanca de acciones, la validación y el historial para saber si se equivoca.

**Estimación:** 3-4 sesiones.

---

## FASE 11 — Analytics

**Qué vamos a conseguir:** responder a una sola pregunta: **¿qué interacciones funcionan de verdad?**

**Por qué lo necesitamos:** desde la Fase 3 estamos registrando todo. Aquí solo hay que consultarlo.

**Métricas, y ninguna más:**
- Participantes únicos por interacción
- Interacciones por directo y por usuario
- Tasa de repetición (¿alguien la usa más de una vez?)
- Mensajes generados en los 60 s siguientes a cada interacción (**la métrica que de verdad mide "participación"**)
- Retorno: qué interacciones correlacionan con volver al siguiente directo
- Coste por interacción

**Entregable:** un comando `npm run report` que imprime una tabla en la terminal. **Nada de panel web.**

**Criterio de hecho:** puedes señalar en la tabla al menos una interacción que merezca eliminarse. Si todas parecen buenas, la medición está mal.

**Estimación:** 2 sesiones.

---

## FASE 12 — Optimización

Con datos reales de la Fase 11:
- **Coste:** decidir, ahora sí con números, si alguna interacción baja a `claude-sonnet-5` o `claude-haiku-4-5`
- **Latencia:** medir el percentil 95 de respuesta y recortar lo que pase de 4 s
- **Ruido:** ajustar el presupuesto de mensajes del bot por hora
- **Eliminar** las interacciones que la Fase 11 haya señalado como muertas

**Estimación:** 2 sesiones.

---

## FASE 13 — Expansión

Solo después de todo lo anterior. Candidatas del catálogo que se quedaron fuera, nuevos eventos de Twitch, integraciones externas. Sin plan detallado a propósito: dependerá de lo que digan los datos.

---

## 3. Resumen del recorrido

| Fase | Objetivo | Sesiones | ¿IA? | ¿BD? |
|---|---|:--:|:--:|:--:|
| 0 | Investigación | ✅ | — | — |
| 1 | Catálogo | ✅ | — | — |
| 2 | Esqueleto + simulador + kill switch | 1-2 | No | No |
| 3 | Ida y vuelta sin IA | 2-3 | No | **Sí** |
| 4 | Capa de IA aislada | 2-3 | **Sí** | Sí |
| 5 | `#5` Pregunta a Crid4m AI 🚦 | 2 | Sí | Sí |
| 6 | `#1` Primer Mensaje + `#18` Bienvenida de Vuelta | 2-3 | Sí | Sí |
| 7 | Motor 🚦 | 2-3 | Sí | Sí |
| 8 | Sistema de memoria (`#2`, `#15`, `#24`) | 3-4 | Sí | Sí |
| 8-bis | Sistema social — **en espera de 5+ espectadores** | — | — | — |
| 9 | Progresión 🚦 | 3 | Sí | Sí |
| 10 | Personalidad | 3-4 | Sí | Sí |
| 11 | Analytics | 2 | Sí | Sí |
| 12 | Optimización | 2 | Sí | Sí |

**Hasta la Fase 5 (primera interacción real en tu chat): 7-10 sesiones.**

---

## 4. Ruta alternativa si tienes prisa

Si prefieres ver algo en el chat cuanto antes, hay un atajo defendible: **Fase 2 → Fase 3 → parar y usarlo**.

Con eso tienes `#1 Primer Mensaje` funcionando en tu directo, sin IA, sin coste y casi sin riesgo. Es la interacción con mejor relación valor/esfuerzo del catálogo y no necesita nada de lo que viene después. La IA puede esperar dos semanas.

No lo recomiendo por encima del plan completo, pero es una opción real si notas que el proyecto se está alargando antes de dar fruto.

---

## 5. Plantilla de informe de fin de fase

```markdown
## ESTADO — Fase N: <nombre>

**Qué se ha hecho:**
**Qué funciona:** (verificado, no supuesto)
**Qué se ha probado:** (incluidos los fallos provocados a propósito)
**Archivos creados/modificados:**
**Qué queda pendiente:**
**Problemas encontrados:**
**Coste acumulado de API:** (desde la Fase 4)
**Próximo paso recomendado:**

⏸️ PARADA. Esperando revisión.
```
