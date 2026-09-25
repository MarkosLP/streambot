# Iconos de Twitch

`iconos.html` es la fuente: un SVG por icono. Los PNG salen de ahí.

| Qué | Archivos | Dónde se suben |
|---|---|---|
| Moneda **Oros** (puntos de canal) | `biblioteca/imagenes/twitch/oro-moneda-{28,56,112}.png` | Panel de creador → Recompensas para espectadores → Puntos de canal → Configuración |
| Una por recompensa | `biblioteca/imagenes/twitch/<nombre>-{28,56,112}.png` | Al crear o editar la recompensa en el panel de creador |

Twitch **no deja poner imagen a una recompensa creada desde Streamer.bot**: la API no admite imágenes, y el panel de Twitch no edita recompensas de otra aplicación. Para tener icono, la recompensa se crea desde el panel de creador de Twitch. Streamer.bot sigue viendo sus canjes igual; solo pierde la capacidad de activarla o pausarla él.

## Regenerarlos

Desde la raíz del proyecto, en Git Bash (hace falta ImageMagick):

```bash
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
"$EDGE" --headless=new --disable-gpu --hide-scrollbars --window-size=2560,1024 \
  --default-background-color=00000000 --screenshot="$(cygpath -w $PWD)\\hoja.png" \
  "file:///$(cygpath -m $PWD)/docs/iconos/iconos.html"
i=0
for n in oro-moneda grito pocion maldicion cofre terremoto lag pregunta-ia pregunta-incomoda; do
  x=$(( (i % 5) * 512 )); y=$(( (i / 5) * 512 ))
  tams="112 56 28"
  for t in $tams; do
    magick hoja.png -crop 512x512+$x+$y +repage -filter Lanczos -resize ${t}x${t} -strip \
      "biblioteca/imagenes/twitch/$n-$t.png"
  done
  i=$((i+1))
done
rm hoja.png
```

El orden de la lista tiene que ser el de los SVG en `iconos.html`.
