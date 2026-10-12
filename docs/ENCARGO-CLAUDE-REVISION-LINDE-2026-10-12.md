# Encargo para Claude: revisión del Linde del Velo

Fecha: 12 de octubre de 2026. Estado: ejecutado desde esta sesión con Claude Code CLI en modo de solo lectura; informe recibido sin cambios de archivos.

Las revisiones posteriores de solo lectura detectaron problemas en la longitud de la senda y en los identificadores del panel, además de casos de visibilidad de fuentes en OBS. Se corrigieron y verificaron localmente; el resumen está en [MMO-TRABAJO-2026-10-12.md](MMO-TRABAJO-2026-10-12.md).

## Objetivo

Revisa la experiencia del espectador en `biblioteca/overlays/mmo.html` y `biblioteca/overlays/mmo-atlas.html`. Propón tres mejoras visuales y de comprensión para una emisión larga sin webcam. Prioriza lo que se entienda en móvil, haga visible la acción real del chat y mantenga interesante la escena durante la calma.

## Tareas

1. Recorre las capturas de `docs/previews/mmo/` y los dos overlays en calma, expedición, encrucijada, resultado, pausa y desconexión. Señala problemas concretos con archivo, estado y evidencia visual. Distingue defectos comprobados de hipótesis.
2. Contrasta las instrucciones que ve el espectador con `src/interactions/mmo/index.ts` y `src/interactions/mmo/contenido.ts`. Detecta promesas, tiempos o comandos que no correspondan al motor.
3. Propón un boceto de integración del atlas en el panel actual: cómo elegir o previsualizar la vista y cómo saber cuál está preparada para OBS. Incluye el caso en que el bot esté apagado.

## Entrega

Un informe breve en español, ordenado por impacto, con capturas o referencias a capturas existentes, archivos y líneas, solución propuesta y límites de verificación. Incluye una recomendación única para la mejora que conviene implementar primero.

## Límites

Trabajo de solo lectura. No edites archivos ni toques OBS, Streamer.bot, Twitch, la base de datos ni servicios externos. No hagas commit ni push. No atribuyas a datos reales los efectos ambientales o estados de `?demo=1`.
