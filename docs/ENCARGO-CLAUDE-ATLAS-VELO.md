# Encargo para Claude: Atlas vivo del Linde del Velo

Queremos que El Linde del Velo sostenga emisiones largas sin webcam. Codex está modificando `biblioteca/overlays/mmo.html`; trabaja en un módulo visual independiente que podamos revisar e integrar después.

## Objetivo

Construye un **atlas vivo** de 1920 × 1080 que enseñe la Última Lumbre, Fronda Ámbar, Canteras del Eco y Marisma de los Faroles como lugares conectados. Debe mostrar con claridad dónde está la compañía, qué regiones se han descubierto, el objetivo de la salida y el próximo paso del chat. El mapa ha de resultar interesante en calma sin fingir viajes, jugadores ni logros.

## Entrega

1. Crea `biblioteca/overlays/mmo-atlas.html`, autónomo y de solo lectura. Conecta la vista a `GET /api/mmo/estado` usando el contrato actual. Incluye `?demo=1` para probar calma, expedición, encrucijada, victoria, pausa y desconexión sin escribir en la base de datos ni mandar mensajes al chat.
2. Diseña interacciones visuales propias para cada región con CSS/SVG o recursos ya presentes en `biblioteca/imagenes/mmo/`. Usa las regiones, crónica, reliquias y participantes que llegan del estado real. Los nombres de usuarios deben entrar como texto, nunca como HTML.
3. Deja capturas de 1920 × 1080 de al menos calma, expedición y victoria en `docs/previews/mmo/atlas-*.png` y revísalas visualmente.
4. Escribe en `docs/MMO-ATLAS.md` cómo se integra el atlas con el overlay principal, qué datos del contrato actual has usado y qué ampliaciones del motor propones para sostener 8–12 horas de emisión. Distingue datos reales de efectos ambientales. Prioriza tres ampliaciones jugables concretas, cada una con condición de entrada, acción del chat, persistencia y resultado visible.

## Límites del trabajo paralelo

- No edites `biblioteca/overlays/mmo.html`, `src/interactions/mmo/`, `src/data/`, `src/core/handler.ts`, `src/panel/server.ts` ni `src/index.ts`; Codex revisará la integración del atlas y del motor.
- No cambies escenas ni fuentes de OBS, no emitas mensajes de Twitch y no generes imágenes de pago.
- No hagas commit ni push. Conserva los cambios que ya estén en el árbol de trabajo.
- El atlas debe funcionar con una persona y con nadie jugando. Nunca avances progreso o premios por animación o por el mero paso del tiempo.

Al terminar, entrega el enlace local del prototipo, las capturas, las comprobaciones realizadas y los límites que queden. Si el contrato actual no permite alguna idea, déjala descrita en el documento en vez de modificar el motor.
