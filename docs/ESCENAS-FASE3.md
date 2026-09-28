# Escenas: organización y peticiones de fondos

28 de septiembre de 2026. Continuación sobre `master`, donde ya estaba integrado el trabajo anterior.

- Selector Empezamos / Charla / Pausa / Final. Elegir una vista no cambia el directo.
- Vista previa junto al fondo y los textos de la escena; cuenta atrás compartida visible en Empezamos y Pausa. En móvil, los controles quedan debajo.
- Estilo común debajo del editor y avatar a todo el ancho. Generación, calibración y configuración OBS quedan en desplegables.
- Los avisos distinguen cambios inmediatos de textos que requieren guardar. La petición de fondo se diferencia del nombre para guardarlo en la biblioteca.

## Fondos

Antes se reescribía la petición mediante un modelo de texto y esa versión ocupaba la posición principal del prompt. Podía diluir o inventar detalles del lugar; además se añadían las instrucciones de estilo. No se ha recuperado la petición histórica exacta que produjo el fondo mencionado por el usuario.

Ahora se envía primero la descripción original, sin reescritura intermedia para fondos. Se da prioridad explícita al juego, lugar, arquitectura y rasgos reconocibles frente al estilo. La prueba usa «Castillo de Aden de Lineage 2» y comprueba que llega intacto al motor, sin introducir el castillo genérico predeterminado ni llamar al modelo de reescritura.

Esto corrige cómo se construye la petición; no demuestra que el modelo dibuje Aden fielmente. No se ha generado ninguna imagen de pago para verificarlo.

## Verificación

- `npm run check`: 597 pruebas aprobadas y TypeScript correcto.
- `node --import tsx scripts/pruebas-visuales.mjs escenas`: navegador a 390 y 1366 píxeles, cuatro vistas, escala del iframe, ausencia de desbordamiento horizontal, controles por escena, conservación de la descripción al cambiar de vista y configuración del directo intacta.
- Capturas anteriores: modo `escenas-antes` sobre la revisión anterior. Resultados en `D:\Descargas\StreamerBotApi-fase2-capturas\escenas-fase3-*`.
- SQLite en memoria, motor de imágenes y transportes falsos, solicitudes externas bloqueadas. No se ha conectado a OBS real ni arrancado el bot.
