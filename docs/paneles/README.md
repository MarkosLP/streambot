# Paneles de Twitch

Los paneles que van **debajo del directo**, en la pestaña Acerca de: Comandos, Recompensas y Loot del chat.

`paneles.html` es la fuente. Los PNG salen a `biblioteca/imagenes/twitch/paneles/`, a 640 px de ancho (el doble de los 320 que enseña Twitch, para que se vean nítidos en pantallas con zoom).

## Subirlos

En tu canal de Twitch → **Acerca de** → **Editar paneles** → **+** → **Añadir panel de texto o imagen**:

1. **Título**: vacío (la imagen ya lo lleva).
2. **Imagen**: el PNG.
3. **Descripción**: opcional. Twitch la pone debajo de la imagen.

Orden recomendado: `comandos.png`, `recompensas.png`, `loot.png`.

## Regenerarlos

Si cambia un comando o un precio, se cambia en `paneles.html` y se regeneran. Desde la raíz del proyecto, en Git Bash (hace falta ImageMagick):

```bash
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
"$EDGE" --headless=new --disable-gpu --hide-scrollbars --window-size=320,1170 \
  --force-device-scale-factor=2 --screenshot="$(cygpath -w $PWD)\\hoja-paneles.png" \
  "file:///$(cygpath -m $PWD)/docs/paneles/paneles.html"
y=0
for p in comandos:470 recompensas:370 loot:330; do
  n=${p%%:*}; h=${p##*:}
  magick hoja-paneles.png -crop 640x$((h*2))+0+$((y*2)) +repage -strip \
    "biblioteca/imagenes/twitch/paneles/$n.png"
  y=$((y+h))
done
rm hoja-paneles.png
```

Las alturas (`470`, `370`, `330`) son las `--alto` de cada panel en `paneles.html`, en el mismo orden, y `--window-size` es su suma. Si cambias una, cambia las tres cosas. A veces Edge tarda un segundo en escribir la captura: si `magick` dice que no encuentra `hoja-paneles.png`, vuelve a lanzarlo.
