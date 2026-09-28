#!/usr/bin/env bash
# Pega los retratos de biblioteca/imagenes/jefes en los círculos del panel de jefes pintado.
set -e
PANEL="$1"; SALIDA="$2"
J="$(dirname "$0")/../../biblioteca/imagenes/jefes"
T="$(dirname "$SALIDA")/tmp-jefes"; mkdir -p "$T"
R=${R:-82}            # radio del retrato
RA=${RA:-87}          # radio del anillo que tapa el borde
D=$((R * 2))
# Orden del panel: filas de izquierda a derecha. Centros medidos con anillos.mjs.
set -- dragon:155:590 esqueleto:611:587 hidra:157:787 golem:613:786 liche:154:976 arana:613:976 kraken:154:1156 minotauro:610:1158 tanque:153:1334 lag:609:1333
cp "$PANEL" "$T/base.png"
magick -size ${D}x${D} xc:black -fill white -draw "circle $R,$R $R,0" -blur 0x1.2 "$T/mascara.png"
dibujo=()
for j in "$@"; do
  IFS=: read n x y <<< "$j"
  magick "$J/$n.png" -resize ${D}x${D} -gravity center -extent ${D}x${D} "$T/mascara.png" -alpha off -compose CopyOpacity -composite "$T/$n.png"
  magick "$T/base.png" "$T/$n.png" -geometry +$((x - R))+$((y - R)) -compose Over -composite "$T/base.png"
  dibujo+=(-stroke "#1a0f06" -strokewidth 11 -fill none -draw "circle $x,$y $((x + RA)),$y")
  dibujo+=(-stroke "#c8902c" -strokewidth 7 -fill none -draw "circle $x,$y $((x + RA)),$y")
  dibujo+=(-stroke "#f3d27a" -strokewidth 2 -fill none -draw "circle $x,$y $((x + RA - 2)),$y")
done
magick "$T/base.png" "${dibujo[@]}" "$SALIDA"
rm -rf "$T"
echo "Hecho: $SALIDA"
