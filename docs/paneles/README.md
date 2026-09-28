# Paneles de Twitch

Los paneles que van **debajo del directo**, en la pestaña Acerca de: Comandos, Recompensas, Loot del chat y Jefes de raid.

Desde el 28 sep 2026 están **pintados enteros con IA** (gpt-image-2, calidad `high`, estilo taberna del gremio), texto incluido. Los finales están en `biblioteca/imagenes/twitch/paneles/`: JPG de 640 px de ancho (el doble de los 320 que enseña Twitch, para que se vean nítidos en pantallas con zoom).

**Twitch no deja subir imágenes de panel de más de 1 MB.** Por eso van en JPG: en PNG, incluso a 640 px, la pintura pasa de 1 MB; en JPG de calidad 92 pesan ~300-400 KB y no se nota la diferencia en el texto.

El panel antiguo, hecho con HTML y CSS (`paneles.html`), sigue en el historial de git si alguna vez hace falta.

## Subirlos

En tu canal de Twitch → **Acerca de** → **Editar paneles** → **+** → **Añadir panel de texto o imagen**:

1. **Título**: vacío (la imagen ya lo lleva).
2. **Imagen**: el JPG.
3. **Descripción**: opcional. Twitch la pone debajo de la imagen.

Orden recomendado: `comandos.jpg`, `recompensas.jpg`, `loot.jpg`, `jefes.jpg`.

## Rehacer uno

Si cambia un comando, un precio o un jefe, hay que volver a pintar **ese** panel. Cada imagen cuesta dinero (OpenAI): se genera solo el que cambia.

1. Cambia el texto en `generar-panel.mts` (`PANELES`). Los comandos son los de `src/interactions/loot/comandos.ts` (`LISTA`); los precios, los de `src/panel/efectos.ts`; los jefes, los de `src/interactions/loot/jefe.ts`.
2. Desde la raíz del proyecto: `npx tsx docs/paneles/generar-panel.mts comandos` (o `recompensas`, `loot`, `jefes`). Deja el original (~3 MB) y su prompt en `biblioteca/imagenes/twitch/paneles-ia/`.
3. **Revisa el texto letra a letra.** El modelo casi nunca se equivoca, pero si lo hace, se repite.
4. Solo en **Jefes**: el modelo se inventa los retratos. Se tapan con los nuestros (`biblioteca/imagenes/jefes/`, los del overlay), sin gastar nada:
   ```bash
   node docs/paneles/anillos.mjs <jefes-original.png>      # centros de los 10 círculos
   # copia esos centros en poner-jefes.sh (línea «set --») y:
   bash docs/paneles/poner-jefes.sh <jefes-original.png> <jefes-con-retratos.png>
   ```
5. Reduce a JPG para Twitch y borra los originales:
   ```bash
   magick <original.png> -filter Lanczos -resize 640x -strip -quality 92 -sampling-factor 4:4:4 biblioteca/imagenes/twitch/paneles/<panel>.jpg
   rm -r biblioteca/imagenes/twitch/paneles-ia
   ```

`prompts/` guarda el prompt exacto de cada panel actual (modelo, calidad, tamaño y fecha), para saber de dónde salió cada uno.

`generar-panel.mts comandos luminosa` hace la variante «aventura luminosa» (islas flotantes, cielo azul) que se probó el 28 sep; se eligió la taberna.
