# Controles de prueba del mundo

Solo el propietario del canal (`isBroadcaster`) puede usarlos en el chat. Los moderadores y espectadores no pueden. También funciona `!mundo pruebas` para recordar la lista.

| Comando | Efecto |
| --- | --- |
| `!mundo terminar` | Cierra la expedición actual como **no completada**. Muestra el resultado durante el descanso normal. No crea premios ni reliquias. |
| `!mundo siguiente` | Si hay expedición, la cierra sin premios; si hay resultado, salta el descanso. Deja el mundo en calma con la siguiente región preparada. Usa `!explorar` para empezar allí. |
| `!mundo probar` | Muestra en el overlay un recorrido visual de 9 estados durante 63 s: calma, salida, aporte, encrucijada, victoria, Canteras, Marisma, pausa y cierre fallido. Se marca **PRUEBA VISUAL · SIN PREMIOS** en pantalla. No modifica la base de datos ni la expedición real. |
| `!mundo cancelar` | Detiene el recorrido visual y devuelve el overlay al estado real. |

El recorrido visual se cancela también al apagar o cerrar el bot. Si el bot se reinicia, la prueba desaparece; no se restaura como partida real. Los espectadores siguen viendo el estado de prueba mientras dure, pero sus comandos `!explorar` siguen actuando sobre la expedición real, por lo que conviene usarlo fuera de una partida activa con público.
