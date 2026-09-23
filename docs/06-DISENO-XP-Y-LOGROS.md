# Diseño de XP y Logros — y la decisión

**Qué es esto:** el criterio de hecho de la Fase 9 pide *"documento breve de diseño de XP **antes** de escribir una línea, y decisión explícita de construirlo o no"*.

Esto es ese documento. Escrito antes del código, como pide, y con la decisión al final.

**Decisión, por delante para no hacerte leer hasta el final: se diseña y NO se construye todavía.** El porqué está en la sección 4, y la condición para revisarlo en la 5.

---

## 1. El diseño, si se construyera

### 1.1 De dónde sale el XP

La regla que manda sobre todas las demás viene de docs/02, interacción 21:

> **Si das XP por mensajes, conviertes el chat en farmeo silencioso y consigues lo contrario de lo que buscas.**

Así que **XP solo por participar en interacciones**. Nunca por escribir. Nunca por estar presente. Nunca por tiempo.

| Qué hace el espectador | XP | Por qué |
|---|---:|---|
| Responder al ticket de entrada (`#2`) | 10 | Ocurre una vez en la vida. Premia el primer paso. |
| Usar `!pregunta` / `!preguntar` (`#5`) | 5 | Tiene cooldown de 15 min por persona: no se puede farmear. |
| Canjear una recompensa de puntos | 15 | Ya ha pagado puntos; el XP reconoce el gesto. |
| Volver tras una ausencia (`#18`, `#15`) | 20 | Es exactamente la conducta que queremos. |
| Mantener una racha (`#19`) | 5 × hito | Se apoya en lo que ya cuenta la racha. |

**El anti-farmeo ya está hecho y no hay que inventarlo:** cada interacción tiene su cooldown, y el XP se concede *por interacción completada*. El techo de XP por hora es, por construcción, el techo de interacciones por hora.

### 1.2 La curva

Niveles con coste creciente suave, para que los primeros lleguen rápido y los últimos cuesten:

```
XP para el nivel N = 50 × N × (N-1) / 2
```

| Nivel | XP acumulado | Interacciones aprox. |
|---:|---:|---:|
| 2 | 50 | 5 |
| 3 | 150 | 15 |
| 5 | 500 | 50 |
| 10 | 2.250 | 225 |

### 1.3 Dónde se guarda

Una tabla `xp_events` (quién, cuánto, por qué, cuándo) en vez de un contador en `users`. Dos razones:

- Un contador suelto no se puede auditar: si alguien pregunta por qué tiene ese nivel, no hay respuesta.
- `!olvidame` tiene que poder borrarlo, y borrar filas de una tabla es trivial; revertir un contador no.

El nivel se calcula sumando, no se guarda.

### 1.4 Logros (`#22`)

El catálogo lo dice claro: *"barato de añadir **una vez existe el registro de interacciones de la Fase 10**"*. Ese registro no existe todavía.

Diseñarlos ahora sería diseñar contra una tabla que aún no está. **Se aplazan a la Fase 10**, sin más discusión.

---

## 2. Lo que este diseño hace bien

- No premia escribir, que es el fallo que arruina estos sistemas.
- Reutiliza los cooldowns que ya existen en lugar de inventar límites nuevos.
- Es auditable y borrable, lo que lo hace compatible con `!olvidame`.
- El código es sencillo: una tabla, una suma y una fórmula.

---

## 3. Lo que hace mal

Y esto es lo que decide.

### 3.1 No hay volumen que progresar

Ahora mismo el canal tiene **0-2 espectadores** y, con `INTERACCIONES_ESPONTANEAS=false`, solo **dos interacciones alcanzables**: `!pregunta` y `!incomoda`.

Con los números de arriba, un espectador habitual ganaría entre 5 y 20 XP por directo. A 16 directos al mes:

| | XP/mes | Nivel al cabo de un mes |
|---|---:|---:|
| Espectador habitual, canal actual | 80-320 | 2-3 |
| Lo que haría que se notara | 1.000+ | 5+ |

Tardaría **medio año** en llegar al nivel 5. Una barra de progreso que no se mueve es peor que no tener barra.

### 3.2 Se solapa con las rachas

`#19 Rachas` y `#21 XP` resuelven **el mismo problema**: dar una razón de volver. Rachas lo hace con una mecánica que se entiende sin explicarla, sin riesgo de farmeo, y que ya cuenta con los datos que tenemos.

Construir las dos a la vez, para un canal con dos espectadores, es poner dos motores de retención donde no hay a quién retener. Y si una de las dos funciona, no sabremos cuál.

### 3.3 Un nivel sin nadie con quien compararlo no es un nivel

La progresión funciona por comparación: ver a otro con más nivel, o competir por un puesto. Con un espectador, el nivel es un número privado que solo él ve. Eso es un contador, no una progresión.

---

## 4. La decisión

**No se construye XP en la Fase 9. Se construye solo `#19 Rachas`.**

No es un aplazamiento por falta de tiempo ni por complejidad: el código de XP sería fácil. Es que **no hay nada que progresar todavía**, y un sistema de progresión vacío no es neutro — le dice al espectador que hay algo que perseguir y luego no se lo da.

Coincide además con el catálogo, que le da a `#21` potencial **Medio** y dice literalmente *"constrúyelo tarde"*.

**Logros (`#22`) se aplazan a la Fase 10**, donde el registro de interacciones que necesitan sí existirá.

---

## 5. Cuándo volver a esto

Se revisa cuando se cumplan **las dos**:

1. **5 o más espectadores habituales.** El mismo umbral que la Fase 8-bis, y por el mismo motivo: sin peers, no hay comparación.
2. **4 o más interacciones alcanzables** para un espectador normal. Hoy son dos.

Se puede comprobar con una consulta, no hace falta adivinarlo:

```sql
-- espectadores con actividad en al menos 3 de los últimos 8 directos
SELECT COUNT(*) FROM (
  SELECT twitch_id FROM interactions
   WHERE at >= date('now','-30 days')
   GROUP BY twitch_id HAVING COUNT(DISTINCT date(at)) >= 3
);
```

Si ese día llega, este documento ya tiene el diseño hecho y solo habrá que escribirlo.
