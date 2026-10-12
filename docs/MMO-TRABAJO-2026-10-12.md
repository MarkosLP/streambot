# El Linde del Velo: revisión y mejoras del 12 de octubre

Trabajo local. La revisión independiente de Claude Code se ejecutó en modo de solo lectura. No se ha enviado ningún mensaje al chat, cambiado ninguna fuente real de OBS, ni publicado el código.

## Cambios

- Diorama: un nodo por paso de la meta (hasta los 14 pasos actuales del motor), con la línea terminando en el último nodo realmente encendido. El aporte nuevo muestra su nombre; si varias acciones llegan entre dos lecturas, muestra su número. El personaje solo se anima si pertenece a quien ha aportado.
- Encrucijada: comandos de voto y llamada inferior más grandes; el empate indica que gana el camino 1. El globo de la acción queda por encima del cartel y una acción nueva sustituye a una cola antigua.
- Calma: desaparece la senda sin progreso y la tarjeta rota por las reliquias y el último suceso recibidos del motor.
- Textos: el descanso anuncia cuándo se puede *abrir* la siguiente salida; la demo explica la espera real de 45 segundos por persona y el límite de 20 minutos.
- Panel: permite previsualizar Diorama o Atlas sin alterar el mundo. «Comprobar fuentes en OBS» lee si cada fuente existe y está activada, y si la escena está en emisión. «Crear escena en OBS» también prepara la fuente `ESC Atlas del Velo` oculta cuando aún no existe; si ya existe, actualiza su URL y conserva su visibilidad. Para ver el Atlas en OBS hay que ocultar el Diorama y mostrar el Atlas.
- La prueba de cola de banners de Loot espera a que terminen las dos animaciones, hasta un segundo. Un `sleep` fijo de 80 ms falló bajo carga en la suite completa, aunque el orden observado era correcto.

## Comprobaciones locales

- `npm run check`: 684 pruebas superadas tras los ajustes visuales y de OBS.
- `npm run laboratorio -- --semilla=8106 --json`: 18 escenarios, 600 eventos, sin fallos.
- `node --import tsx scripts/prueba-atlas.mjs demo`: 10 comprobaciones superadas.
- `node --import tsx scripts/pruebas-visuales.mjs mmo`, `mmo-auditoria`, `mmo-panel` y `mmo-senda`: navegador Edge aislado, SQLite en memoria; capturas en `D:\Descargas\StreamerBotApi-fase2-capturas`.
- `src/panel/panel.test.ts`: 77 pruebas, incluidos atlas oculto, URL actualizada, reposición de la fuente y alertas arriba.
- `npm run mmo:informe`: integridad de la base local correcta; no es una prueba con chat real.

Capturas revisadas: [senda con ocho aventureros](previews/mmo/mmo-senda-grupo-2026-10-12.png), [senda máxima de 14 pasos](previews/mmo/mmo-senda-catorce-2026-10-12.webp), [votación](previews/mmo/mmo-voto-2026-10-12.png), [Atlas en el panel](previews/mmo/mmo-panel-atlas-2026-10-12.png) y [panel móvil](previews/mmo/mmo-panel-atlas-movil-2026-10-12.png). La senda y la votación son simulaciones; el panel muestra el mundo apagado de la base temporal.

## Pendiente de validación real

Revisar lectura y ritmo en el reproductor de Twitch, especialmente en móvil, y el cambio manual de las dos fuentes en OBS durante una prueba supervisada. El estado `?demo=1` y los datos de los scripts visuales son simulaciones.
