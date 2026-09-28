# Sonidos de los efectos

Los `.wav` de `biblioteca/sonidos/`. Suenan en los canjes (Actions de Streamer.bot), en los banners de botín (`botin.html`) y en la barra del jefe (`jefe.html`), que los buscan **por su nombre**: al cambiar uno, se deja con el mismo nombre y en `.wav`.

## De dónde sale cada uno

El 28 sep 2026 Crid4m pidió cambiar los sintetizados («muy cutres o básicos»), menos la poción. Escuchó 4 candidatos de cada uno y eligió estos. Todos con licencia **CC0** (dominio público): se pueden usar en Twitch sin atribución ni avisos de copyright. Se tomó la versión de escucha de Freesound (mp3 de alta calidad).

| Archivo | Sonido original | Autor | Enlace |
|---|---|---|---|
| `grito-de-guerra.wav` | war horn | adharca | https://freesound.org/people/adharca/sounds/539956/ |
| `maldicion.wav` | Evil Laugh_1 | NinjaSharkStudios | https://freesound.org/people/NinjaSharkStudios/sounds/646307/ |
| `terremoto.wav` | quake and break (recortado a 6,5 s) | cheetahzbrain | https://freesound.org/people/cheetahzbrain/sounds/431859/ |
| `lag.wav` | Glitch | AmicaSys | https://freesound.org/people/AmicaSys/sounds/332711/ |
| `cofre.wav` | Treasure Chest Open | steprock | https://freesound.org/people/steprock/sounds/771164/ |
| `legendario.wav` | Success Fanfare Trumpets | FunWithSound | https://freesound.org/people/FunWithSound/sounds/456966/ |
| `pocion.wav` | Sintetizado (`npm run sonidos`) | — | `src/cli/generar-sonidos.ts` |

Todos llevan el volumen de la poción (la que gusta), salvo el cofre y el lag, que quedan unos 5-7 dB más bajos: son golpes muy cortos y subirlos más pediría comprimirlos. Si en directo se oyen flojos, se suben.

## Cambiar uno

1. Busca en [Freesound](https://freesound.org) con el filtro de licencia **Creative Commons 0** (u otra fuente CC0).
2. `node scripts/poner-sonido.mjs <nombre> <archivo> [segundos máximos]`, por ejemplo `node scripts/poner-sonido.mjs cofre descargas/cofre.mp3 3`. Quita el silencio del principio, lo iguala al volumen de la poción, lo corta con fundido si pasa del máximo y lo guarda como `biblioteca/sonidos/<nombre>.wav` (44,1 kHz, 16 bits). Usa Edge sin ventana: no hace falta ffmpeg.
3. Si era sintetizado, añádelo a `GRABADOS` en `src/cli/generar-sonidos.ts`: si no, `npm run sonidos` lo pisaría.
4. Apunta aquí de dónde sale.
