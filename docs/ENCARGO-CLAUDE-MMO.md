# Encargo para Claude: identidad y prototipo de La Frontera

Crid4m quiere un MMO propio que la comunidad pueda jugar en el chat cuando él esté ausente. El plan general y el contrato de datos están en [MMO-CHAT-24H.md](MMO-CHAT-24H.md). Codex ya está desarrollando el motor en `src/interactions/mmo/`; este encargo es la parte visual y narrativa de la fase 0.

## Entrega

1. Escribe `docs/MMO-CHAT-ARTE-Y-LORE.md` con un nombre propuesto para el mundo, una premisa breve y tres regiones originales. Puedes mejorar los nombres provisionales del plan.
2. Crea `biblioteca/overlays/mmo-prototipo.html`: una maqueta estática de 1920 × 1080 que muestre calma, expedición, resultado y desconexión. Que se lea bien desde el reproductor de Twitch. No la conectes aún a OBS ni a datos reales.
3. Incluye textos cortos para `!mundo`, una acción `!explorar` y un resultado cooperativo. Deben funcionar también con una sola persona.
4. Separa los recursos visuales imprescindibles para la primera escena de los que podrían llegar después. No generes imágenes de pago sin que Crid4m lo pida.

## Límites de trabajo en paralelo

- El overlay definitivo leerá `GET /api/mmo/estado`; la forma del JSON figura en el plan. El motor decide resultados y premios; la página solo muestra datos.
- No edites `src/interactions/mmo/`, `src/data/`, `src/core/handler.ts`, `src/panel/server.ts` ni `src/index.ts`: Codex trabaja ahí.
- No modifiques los archivos de `espectadores` que ya tienen cambios simultáneos.
- Si necesitas cambiar el contrato del estado, anótalo en tu documento para revisarlo antes de integrar el overlay.

Cuando termines, deja una captura del prototipo y una lista corta de decisiones que deba tomar Crid4m.
