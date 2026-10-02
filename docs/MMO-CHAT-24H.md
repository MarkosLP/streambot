# MMO de chat de Crid4m — diseño por fases

Estado: fases 0 a 3 desarrolladas en local, 2 de octubre de 2026 (Claude hizo la 2 y la 3 completas por encargo de Crid4m; Codex las revisará). Decisión de Crid4m: **universo propio**, jugable en una escena de OBS mientras él está ausente. Nombre y textos aprobados en [MMO-CHAT-ARTE-Y-LORE.md](MMO-CHAT-ARTE-Y-LORE.md).

**Ya desarrollado:** identidad [El Linde del Velo](MMO-CHAT-ARTE-Y-LORE.md), cuatro fondos y la escena [mmo.html](../biblioteca/overlays/mmo.html), que muestra calma (con «Cómo se juega»), expedición, pausa, victoria, cierre sin completar, mundo cerrado y desconexión. El motor guarda expediciones y renombre en SQLite y responde a `!mundo`, `!explorar` y `!expedicion`; `!mundo activar|pausar|apagar` para dueño y moderadores. Panel → **Mundo**: estado, avisos (sin directo, bot apagado), Activar/Pausar/Apagar, vista previa y «Crear escena en OBS» (`✦ El Linde del Velo` con la fuente `ESC Linde del Velo` y las alertas encima; solo añade, nunca cambia la escena en emisión). Arranca apagado. Prueba de resistencia de 8 h simuladas en `src/interactions/mmo/resistencia.test.ts`. **Falta:** que Crid4m cree la escena desde el panel y una prueba supervisada con gente real.

## La experiencia

Nombre propuesto por Claude: **El Linde del Velo**. El chat es una compañía de aventureros que sale de la Última Lumbre, explora tres regiones y vuelve antes de que el Velo se cierre. La escena muestra un mundo que cambia por las acciones reales del chat. Si no hay nadie jugando, el refugio permanece tranquilo; no simula espectadores ni reparte premios a cuentas inactivas.

Una persona debe poder disfrutarlo sola. Con más personas, se llena antes el objetivo común y aparecen los nombres de quienes ayudaron. El resultado de cada expedición queda visible un rato y se guarda para que el mundo continúe tras reiniciar el bot.

### Primera sesión jugable

1. El espectador escribe `!mundo` y ve dónde está la compañía, el objetivo y cómo participar.
2. Escribe `!explorar`. Su personaje aporta progreso a la expedición actual; la escena enseña su acción y actualiza la barra.
3. Al completar la barra, el grupo descubre un lugar, obtiene un resultado y vuelve al refugio. Si solo participa una persona, el objetivo se ajusta para que pueda terminarlo.
4. Tras una pausa breve empieza otra expedición. Cuando nadie participa, el ciclo espera sin llenar el chat.

`!pj`, inventario, temporadas, duelos y jefes existentes siguen disponibles. La primera versión del mundo no consume objetos ni entrega cofres nuevos: otorga **renombre de expedición** separado del poder y del botín actuales. Así podremos ajustar la frecuencia sin desordenar la economía que ya funciona. El renombre puede convertirse en títulos cosméticos en una fase posterior.

Comandos iniciales: `!mundo` (consulta), `!explorar` (acción con espera por persona) y `!expedicion` (resumen propio). No añadir más comandos antes de probar el ciclo con gente real. Las respuestas individuales deben ser breves; el progreso continuo vive en la escena, no en mensajes repetidos del bot.

### Boceto de escena

Fuente de navegador de 1920 × 1080 en OBS, con animación ligera a 30 fps:

| Zona | Contenido |
| --- | --- |
| Centro | Refugio y camino hacia la región actual; cambia entre calma, expedición y resultado. |
| Superior | Nombre del mundo, región y estado de la expedición. |
| Lateral | Objetivo común, barra y tiempo hasta el siguiente cambio. |
| Inferior | Últimas acciones y nombres de participantes; tres comandos legibles. |

La escena debe seguir siendo comprensible sin sonido y dejar claro que Crid4m está ausente. La música debe ser opcional y elegida desde el sistema actual de Música; el overlay no incorpora audio ni contenido de terceros por su cuenta. Los nombres de usuario se muestran como texto escapado y respetan la moderación y `!olvidame`.

## Contrato entre juego y escena

El motor es la única autoridad sobre tiempo, tiradas, progreso y premios. El navegador de OBS solo lee un estado público de `GET /api/mmo/estado`; nunca decide resultados ni escribe recompensas. El contrato inicial del estado es:

```json
{
  "version": 1,
  "modo": "apagado | activo | pausado",
  "fase": "calma | expedicion | resultado",
  "region": { "id": "bosque", "nombre": "Fronda Ámbar", "objetivo": "Abrir camino entre las raíces" },
  "objetivo": { "actual": 3, "meta": 8 },
  "hasta": "2026-10-02T20:30:00.000Z",
  "participantes": [{ "nombre": "Ejemplo", "aporte": 2 }],
  "acciones": [{ "quien": "Ejemplo", "texto": "aparta una cortina de raíces", "at": "2026-10-02T20:20:00.000Z" }],
  "resultado": null,
  "ultimoSuceso": "La compañía encontró un sendero seguro"
}
```

Los valores son ejemplo, no contenido final. El endpoint podrá añadir campos sin romper la escena; `version` señala cambios incompatibles. No se incluye chat libre, identificadores de Twitch, inventarios ni datos privados. Si el bot no responde, el overlay muestra «Reconectando con el mundo» sin inventar progreso. La escena consulta cada pocos segundos y se anima localmente entre consultas.

## Fases y reparto de trabajo

| Fase | Entrega visible | Codex | Claude | Criterio para avanzar |
| --- | --- | --- | --- | --- |
| **0. Diseño** | Reglas, mapa y boceto visual. | Fijar el ciclo, contrato de estado y límites técnicos en este documento. | Proponer identidad visual, nombres propios, tres regiones y un prototipo estático de la escena. | Crid4m puede explicar qué hace alguien al entrar y reconocerlo en el prototipo. |
| **1. Núcleo jugable** | `!mundo`, `!explorar`, `!expedicion` funcionan en el simulador. | Persistencia SQLite, estados, acciones, recompensas separadas, recuperación tras reinicio y pruebas del ciclo. | Afinar textos cortos de eventos y resultados dentro de límites del chat. | Una y varias personas completan una expedición; reiniciar no duplica premios. |
| **2. Escena conectada** | OBS enseña el progreso real. | Endpoint de solo lectura, preparación de fuente OBS y controles del panel. | Implementar el overlay definitivo a partir del prototipo y del contrato de estado. | La escena refleja acciones reales, soporta desconexión y se lee a distancia. |
| **3. Modo ausente** | Transición clara entre directo habitual y mundo. | Activar, pausar y salir desde el panel; límites de mensajes, supervisión y recuperación. | Pulir estados de calma, victoria y pausa; instrucciones para nuevos jugadores. | Prueba de varias horas con el dueño ausente: sin spam, premios duplicados ni bloqueo del juego. |
| **4. Emisión larga** | Operación repetible durante un día completo. | Arranque y parada controlados, monitor de OBS/bot/conexión, registro de fallos y ensayo de 24 h. | Ajustes visuales a partir de la prueba y variantes de regiones. | El ensayo documenta cortes, recuperación y carga del PC. |
| **5. Expansión** | Decisiones colectivas, amenazas y nuevos lugares. | Nuevas reglas solo después de medir la primera versión. | Historia, ilustraciones y animaciones de cada lugar. | Se elige con datos de participación, no por acumular funciones. |

La fase 4 debe contemplar sesiones sucesivas: [Twitch indica un máximo de 48 horas por emisión](https://help.twitch.tv/s/article/broadcasting-guidelines?language=es). «24 h» aquí significa que el mundo pueda estar disponible durante un día entero; una operación permanente necesitará gestionar los cierres y nuevos directos.

## Reglas técnicas que no conviene saltarse

- El modo mundo se activa expresamente desde el panel y solo progresa si el bot sabe que hay directo. No basta con que la página de OBS siga abierta.
- Cada acción tiene un identificador único y cada premio se entrega una sola vez, incluso si el proceso se reinicia entre el resultado y el anuncio. Los plazos se guardan en UTC; al volver, el motor calcula el estado según el reloj, sin ejecutar de golpe horas de eventos atrasados.
- La participación se cuenta por acciones aceptadas, no por la cifra de espectadores ni por mensajes genéricos. Se ajusta la meta al número de participantes reales; nunca se requiere un grupo grande.
- Todos los mensajes usan `output.send()` y su `policy`; el ciclo automático respeta el interruptor y el límite de mensajes espontáneos. Si se agota el cupo, la escena continúa actualizándose.
- `!olvidame` elimina también el estado y el renombre del MMO y evita nuevos registros de esa cuenta. El overlay retira cualquier nombre afectado de su estado público.
- La pantalla y la lógica permiten simulación local y modo de prueba sin enviar nada a Twitch. El modo ausente real se prueba primero con supervisión.
- El sistema debe poder quedar en pausa manual desde el panel o con un comando de moderador. Una caída de OBS o del WebSocket deja el juego en un estado visible de espera y no genera premios invisibles.

## Encargo inmediato para Claude — fase 0

Trabajar de forma independiente en `docs/MMO-CHAT-ARTE-Y-LORE.md` y, si le sirve, en `biblioteca/overlays/mmo-prototipo.html` como **prototipo estático**, sin conectarlo al bot ni a OBS. Entregar:

1. Nombre propuesto para el mundo, una premisa de dos frases y tres regiones originales con personalidad visual distinta.
2. Boceto de la escena 1920 × 1080 usando los cuatro estados: calma, expedición, resultado y desconexión.
3. Textos de muestra para `!mundo`, una acción `!explorar` y un resultado de grupo. Deben caber holgadamente en el chat y funcionar con una sola persona.
4. Lista de imágenes o animaciones que harían falta, separando lo imprescindible de lo posterior. El prototipo puede usar CSS y marcadores temporales.

No tocar `src/interactions/loot/`, `src/data/`, `src/core/handler.ts`, `src/panel/server.ts` ni el overlay de espectadores que ya está en marcha. El código funcional de la fase 1 lo llevará Codex. Después de revisar juntos el prototipo y el contrato, Claude podrá convertirlo en el overlay definitivo de la fase 2.

## Primeras decisiones para Crid4m

Al revisar la fase 0, elegir el nombre y aspecto final del mundo. El ritmo exacto de las expediciones, el valor del renombre y si el modo ausente cambia automáticamente la escena de OBS se ajustarán después de la primera prueba, con la frecuencia real de participación delante.
