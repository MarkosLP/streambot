# Notas para el motor de la FASE 7

**Qué es esto:** el criterio de hecho de la Fase 6 pide *"anota por escrito qué has tenido que copiar y pegar entre las tres. Eso, literalmente, es la especificación del motor de la Fase 7."*

Esto es esa anotación, escrita al terminar la Fase 6 con las tres interacciones delante. No es un diseño del motor: es el **inventario de lo que se repitió**, que es de donde el diseño tiene que salir.

Regla del proyecto (docs/03 § 2): *tres casos antes de abstraer*. Ya están los tres.

| Interacción | Líneas | IA | Disparador |
|---|---:|:--:|---|
| `#1 primer-mensaje` | 165 | No | Evento (flag de primer mensaje) |
| `#18 bienvenida-vuelta` | 138 | No | Evento (mensaje + BD) |
| `#5 pregunta-ia` | 153 | Sí | Comando + Channel Point |

---

## 1. Lo que está copiado y pegado

### 1.1 El cierre: enviar y registrar

Aparece **en las tres**, casi carácter por carácter:

```ts
const outcome = await send({
  text: <lo único que cambia>,
  reason: NAME,
  allowedMentions: [viewer.login],
});

interactionLog.record({
  interaction: NAME,
  twitchId: viewer.id,
  status: outcome.sent ? 'sent' : 'blocked',
  detail: outcome.sent ? <algo> : `${outcome.rejection}: ${outcome.detail}`,
});
```

`primer-mensaje.ts:152`, `bienvenida-vuelta.ts:123`, `pregunta-ia.ts:127`.

**Para el motor:** esto no debería escribirlo ninguna interacción. Una interacción debería *devolver* qué quiere decir, y que el motor se encargue de enviarlo y registrarlo. Es el trozo más claro de todos.

### 1.2 La guarda que descarta

El patrón "compruebo algo, si falla lo registro y salgo" aparece **siete veces** entre las tres:

```ts
if (<no se cumple>) {
  log.info(`${NAME}: <motivo>`);
  interactionLog.record({
    interaction: NAME,
    twitchId: viewer.id,
    status: 'skipped',
    detail: <el mismo motivo otra vez>,
  });
  return;
}
```

El motivo se escribe **dos veces** en cada una de las siete, una para el log y otra para la base de datos. Ya han divergido alguna vez.

**Para el motor:** una guarda debería ser una función que devuelve `ok` o `{ motivo }`, y el motor decide qué hacer con el motivo. La interacción no debería llamar ni a `log` ni a `interactionLog`.

### 1.3 El cooldown

Idéntico en `primer-mensaje.ts:141` y `bienvenida-vuelta.ts:110`, incluido el cálculo de los segundos que faltan:

```ts
if (!cooldowns.tryConsume(cooldowns.keys.interaction(NAME), COOLDOWN_MS)) {
  const faltan = Math.ceil(cooldowns.remaining(...) / 1000);
  ...
}
```

`pregunta-ia` **no** encaja: tiene dos cooldowns (usuario y global), los comprueba antes de consumir ninguno, y solo los consume si los dos estaban libres (`pregunta-ia.ts:71-88`). Además se los salta entero cuando el disparador es Channel Point.

**Para el motor:** los cooldowns son una **lista**, no uno. Y el disparador puede eximir de ellos. Un motor que asuma "un cooldown global por interacción" no sirve para la que ya tenemos.

### 1.4 La mención

Las tres componen el texto con `@${displayName}` delante y pasan `allowedMentions: [viewer.login]`. Las tres. Y la razón es la misma en las tres (que la policy sea exacta por construcción), pero solo está explicada en una.

**Para el motor:** "menciona a quien disparó la interacción" debería ser una opción del contrato, no código repetido.

---

## 2. Lo que NO se puede unificar a la ligera

Esta parte es tan importante como la anterior. Un motor que obligue a las tres a parecerse **rompería** cosas que hoy funcionan:

| Diferencia | Quién | Por qué no es accidental |
|---|---|---|
| Dos cooldowns en vez de uno | `pregunta-ia` | Uno protege del spam individual, el otro del colectivo |
| El disparador exime del cooldown | `pregunta-ia` (Channel Point) | Quien paga puntos siempre recibe respuesta |
| Validación de la entrada antes de nada | `pregunta-ia` | Descartar ANTES de gastar dinero en la IA |
| Texto de reserva | `pregunta-ia` | La IA no puede ser un punto único de fallo |
| Modo revisión | `pregunta-ia` | Solo se revisa lo que escribe Claude, no lo determinista |
| Deduplicación de por vida | `primer-mensaje` | Nadie recibe dos veces el saludo de primerizo |
| "Deuda" de saludo pendiente | `primer-mensaje` | Si el cooldown se come la ocasión, se reintenta después |
| Necesita un dato previo al `touch()` | `bienvenida-vuelta` | `previousLastSeen`: leerlo después daría siempre cero |
| Elección determinista por hash | `primer-mensaje` | Sin azar, los tests no son frágiles |

El último de la tabla es el que más fácil se pierde: `bienvenida-vuelta` necesita un valor que **deja de existir** en cuanto el manejador registra la presencia. Cualquier motor tiene que poder pasarle a la interacción datos calculados **antes** de que se toque la base de datos.

---

## 3. Lo que el contrato tiene que cubrir

Sale de las dos secciones anteriores, no de la imaginación:

- **Disparador**, y que haya más de uno para la misma interacción (`pregunta-ia` tiene dos)
- **Entradas calculadas antes del registro de presencia** (`previousLastSeen`)
- **Guardas ordenadas**, cada una con su motivo, sin que la interacción registre nada
- **Cooldowns como lista**, con la posibilidad de que un disparador exima
- **Si usa IA o no**, y con ello el modo revisión y el texto de reserva
- **Composición del mensaje**, con mención opcional a quien disparó
- **Resultado**: la interacción devuelve qué decir; el motor envía y registra

---

## 4. La prueba de que el motor está bien

Ya está escrita en docs/03, Fase 7, y conviene no perderla de vista:

> **Añadir una cuarta interacción trivial en menos de 30 minutos, tocando un solo archivo.** Si no se cumple, el motor está mal y hay que simplificarlo, no añadirle capas.

Una cuarta buena para esa prueba: `#10 Pregunta Incómoda` (Channel Point, sin IA, complejidad baja). Si con el motor se escribe en un archivo y en media hora, el motor vale.

---

## 5. Aviso sobre el estado actual

`INTERACCIONES_ESPONTANEAS=false` en el `.env` de Crid4m deja `#1` y `#18` **construidas y probadas pero dormidas**. Para el motor da igual —el código existe y sus tests corren—, pero conviene saberlo antes de concluir nada mirando la tabla `interactions` de la base de datos real: ahí no habrá filas de esas dos.
