# El Linde del Velo — prueba supervisada con chat real

Preparada el 3 oct 2026. **Nadie la ha ejecutado todavía.** La lanza Crid4m cuando quiera y estando delante: Claude no abre ninguna emisión ni envía mensajes reales por su cuenta.

Objetivo: ver el mundo con gente de verdad antes de dejarlo solo muchas horas. Duración: entre 45 y 60 minutos. Hace falta al menos **una persona más en el chat** (un moderador o alguien de confianza); mejor dos o tres.

## Antes (sin emitir)

1. Reiniciar el bot (`npm start`): crea las tablas nuevas y el latido.
2. `npm run mmo:informe` → debe decir **Todo en orden**. Guardar la salida para compararla.
3. Panel → **Mundo**: comprobar que Streamer.bot sale conectado y que no hay avisos raros.
4. Panel → Mundo → **Crear escena en OBS** (lo pulsa Crid4m). No cambia la escena en emisión.
5. Decidir cómo se hará la prueba: en un directo normal (el mundo solo corre con directo) o en uno de prueba sin anunciar.

**Para cortar en cualquier momento:** Panel → Mundo → Apagar, o `!mundo apagar` en el chat. El interruptor del bot (abajo a la izquierda) también lo congela todo.

## Durante (con Crid4m en directo y delante)

Ir marcando. Lo que hay que mirar está en la columna de la derecha.

| # | Qué hacer | Qué tiene que pasar |
|---|---|---|
| 1 | Panel → Mundo → **Activar**. Cambiar a la escena `✦ El Linde del Velo`. | La escena en calma: «Escribe !explorar», «Cómo se juega», la crónica (prólogo) y «Reliquias 0/60». |
| 2 | Una persona escribe `!mundo`. | Responde en el chat con la Lumbre, reliquias y crónica. |
| 3 | Esa persona escribe `!explorar`. | El bot anuncia la salida y la misión. La escena cambia a Fronda Ámbar, 1/4. |
| 4 | Repite `!explorar` enseguida, dos o tres veces. | **Un solo** aviso de «Aún te recuperas…»; los siguientes no contestan. |
| 5 | Una segunda persona escribe `!explorar`. | La meta pasa a 6, su nombre aparece en la compañía. |
| 6 | Seguir hasta completar (45 s entre aportes de la misma persona). | A mitad, un suceso en cursiva en la escena. Al final: cartel con la reliquia, «Nueva reliquia · 1 de 60», chispas, y un solo anuncio en el chat. |
| 7 | Esperar el minuto de descanso. | Vuelve a la Lumbre por sí solo. |
| 7b | Repetir expediciones hasta que salga una **encrucijada** (sale en un 40 % de ellas). Votar una con `!explorar 2` y otra persona con `!explorar 1`; luego cambiar a `!explorar 2`. | El chat anuncia la encrucijada. La tarjeta muestra los votos (0 a 2 tras el cambio) y la cuenta atrás de 3 min. Al acabar, «La compañía elige: …», la meta sube 2 y el cartel final dice «Camino arriesgado». |
| 8 | Empezar otra expedición y, a mitad, Panel → **Pausar**. Esperar 1 min. **Activar**. | En pausa: «El tiempo se detiene», sin cuenta atrás. Al activar, el reloj sigue donde estaba. |
| 9 | Cerrar **Streamer.bot** 1-2 min y volver a abrirlo. | Escena: «Reconectando con el chat» y «El tiempo está detenido». El panel lo avisa. Al volver, el reloj sigue donde estaba. |
| 10 | Cerrar el bot con **Ctrl+C** y arrancarlo de nuevo. | La escena muestra «Reconectando con el mundo» mientras está cerrado. Al volver, la expedición sigue con el tiempo que le quedaba. |
| 11 | *(Opcional, solo si Crid4m quiere)* cerrar la ventana del bot de golpe (sin Ctrl+C) y arrancarlo. | El registro dice «el bot se cerró sin despedirse; los N min cerrado no cuentan». La expedición no se pierde. |
| 12 | `!expedicion` desde las dos cuentas. | Cada una ve su renombre. |
| 13 | Panel → Mundo → **Apagar**. Volver a la escena de siempre. | Escena «El Velo está cerrado». |

Anotar cualquier texto que se lea mal desde el reproductor de Twitch (sobre todo en el móvil) y si el chat se siente saturado por el bot.

## Después

1. `npm run mmo:informe` → **Todo en orden**, con las expediciones de la prueba contadas.
2. Panel → Registro: buscar «El Linde del Velo» y comprobar que aparecen la activación, cada salida y final, la pausa y las congelaciones.
3. Contar cuántos mensajes escribió el bot en el chat durante la prueba.
4. Apuntar aquí debajo qué salió bien, qué no y qué cambiarías antes de dejarlo solo.

## Qué ya está probado sin chat real

- 660 pruebas automáticas, entre ellas: 8 horas simuladas con duplicados, pausa, corte de directo, **caída de Streamer.bot**, reinicios, **cierre brusco sin `parar()`**, `!olvidame` y apagado a mitad; y 200 expediciones seguidas para el contenido.
- Laboratorio de Codex: 17 escenarios con Mundo y Loot a la vez y ocho jugadores simultáneos.
- Escena revisada captura a captura en todos sus estados (`docs/previews/mmo/`).

Lo que solo puede verse con gente real: el retraso del reproductor de Twitch, cómo se lee en el móvil, si el ritmo (45 s entre aportes, 20 min por expedición) se siente bien, y cuántos mensajes del bot son demasiados.

## Resultados

*(Rellenar tras la prueba.)*
