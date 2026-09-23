# Dónde lo dejamos — 24 sep 2026

Traspaso para la próxima sesión. Lo primero de todo está en la sección 1.

---

## 0. Lo primero de mañana, ya acordado

Reescribir las puertas de validación de las fases 6-9 con el **mismo criterio
adaptado que ya tiene la Fase 5**, y preparar un guion de UN directo de unos
30 minutos que cierre todo lo que se puede cerrar sin comunidad.

El planteamiento, que salió al final de la sesión del 24:

**"Necesito un directo" y "necesito espectadores" no son lo mismo**, y las
había estado mezclando. Cinco de las seis cosas pendientes se validan en
solitario: el Channel Point con payload real, rechazar en revisión, el corte
de red, el caché en marcha, y los eventos de principio y fin de directo.

Solo cuatro interacciones necesitan a otra persona: `#1`, `#18`, `#15` y
`#19`. Y para eso está **`crid4n`**, que ya es una cuenta real con historial
en el canal (id `1541361603`, vista el 22 de sep). Desde el móvil y con datos
en vez de wifi, para el bot es un espectador de verdad: otro `twitch_id`,
otros badges, los mismos payloads. No es comunidad, pero para validar el
código es equivalente.

La Fase 5 ya tenía esto resuelto en el roadmap —separa "¿funciona?" de
"¿le importa a alguien?", y deja la segunda aplazada— y es lo que hay que
extender a las demás.

**Excepción a tener en cuenta:** `#24 Continuará` exige al menos un
espectador, y el dueño del canal se ignora a propósito, así que un directo en
el que solo hablas tú cuenta cero y se saltará siempre. Esa necesita a
`crid4n` escribiendo una vez.

Y el dato que conviene no perder de vista: **el 23 de sep hubo tres personas
en el chat**, y `armifer91` estuvo 44 minutos. No es un canal sin espectadores,
es un canal con pocos.

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

**256 tests, 0 fallos.** `npm run check`.

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

## 4. Qué viene: Fase 10 — Sistema de personalidad

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
npm run check          # 256 tests
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
