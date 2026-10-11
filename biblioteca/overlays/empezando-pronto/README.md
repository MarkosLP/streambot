# CRID4M · Empezando pronto

Escena local 1920 × 1080. Aparece en el panel, pestaña **Escenas → Empezando pronto · Retro**, con vista previa y botón **Crear en OBS**. Este botón prepara una escena independiente cuando se pulsa; no cambia la escena emitida. El archivo `biblioteca/overlays/empezando-pronto.html` funciona también como Fuente de navegador local en OBS.

El archivo HTML visible en el panel se genera con `node scripts/build-empezando-pronto.mjs`. Incluye dentro imágenes, fuentes, CSS y JavaScript para que funcione incluso si el servidor del panel ya estaba abierto antes de añadir esta escena. Después de editar cualquier componente de la carpeta, ejecuta ese comando para actualizar el HTML.

## Capas

- `habitacion-v9.webp`: fondo activo con pósteres sin marcos y zapatillas integradas junto a la cama. Las versiones anteriores quedan como referencias de edición.
- `zapatillas-rojas.png`: recurso original de referencia; las zapatillas visibles ya forman parte de `habitacion-v9.webp`.
- `sonic-bola.png` y `sonic-estela.png`: la bola gira por separado mientras la estela queda detrás. Cruza la zona inferior en 2,75 segundos; aparece primero a los 5 segundos y después cada 21–31 segundos aproximadamente. `erizo.png` conserva el sprite anterior como referencia.
- `goku-carga-frente.png` y `goku-kamehameha.png`: dos poses pixeladas independientes del fondo. Goku aparece primero a los 12 segundos y después cada 37–50 segundos aproximadamente. Carga durante 1,75 segundos, gira a la pose lateral y revela el haz.
- `escena.css`: monitores, iluminación RGB, LED y animaciones visuales.
- `efectos-nuevos.css`: destello rosa, nueva carrera del erizo y animación de Goku.
- `escena.js`: texto, reloj, lluvia limitada a la parte alta de los cristales, relámpago lejano y frecuencia de los personajes.
- Fuentes locales Orbitron y Rajdhani con sus licencias OFL.

## Ajustes rápidos

Parámetros opcionales de la URL: `?title=VOLVEMOS%20PRONTO&brand=CRID4M`, `runner=0` para ocultar el erizo, `goku=0` para ocultar a Goku, `rain=0` para apagar la lluvia y el relámpago, `lightning=0` para apagar solo el relámpago, `preview-runner=1`, `preview-goku-front=1`, `preview-goku=1` y `preview-lightning=1` para fijar cada efecto en una captura. El texto de los monitores también se puede cambiar en `escena.js`.

La ilustración base se generó con la herramienta integrada de generación de imágenes. Prompt final resumido: habitación gamer nocturna cinematográfica en 16:9, nostalgia de consolas y cartuchos de los 90/2000, monitores oscuros sin texto, RGB tenue y ciudad lluviosa. Los sprites se generaron por separado con transparencia: erizo azul enrollado sin estela, y Goku pixelado en pose frontal de carga que combina con su sprite lateral de Kamehameha.
