"""Descarga previews CC0 de Freesound para escuchar; no instala sonidos en el bot."""

from html import escape
from pathlib import Path
import re
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "docs" / "previews" / "mmo" / "sonidos-candidatos"

# ID, autor, nombre de la fuente, papel propuesto, nombre local.
CANDIDATES = [
    (462089, "newagesoup", "Ethereal Woosh", "Salida · bruma", "salida-bruma.mp3"),
    (466829, "Breviceps", "Ethereal Teleport", "Salida · umbral", "salida-umbral.mp3"),
    (264981, "renatalmar", "SFX Magic", "Aporte · destello", "aporte-destello.mp3"),
    (398492, "Anthousai", "wind chimes - single 03", "Aporte · campana grabada", "aporte-campana.mp3"),
    (329795, "Unaxete", "Mystery_chime", "Encrucijada · misterio", "encrucijada-misterio.mp3"),
    (707797, "TheGreenEyedGhost", "Tibetan_Singing_bowl_1", "Encrucijada · cuenco grabado", "encrucijada-cuenco.mp3"),
    (668791, "jolup123", "success", "Victoria · acorde", "victoria-acorde.mp3"),
    (351408, "newagesoup", "GLEAM-GLOW-SFX-CHIME", "Victoria · fulgor", "victoria-fulgor.mp3"),
]


def fetch(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; MMO-audicion-local/1.0)"})
    with urlopen(request, timeout=30) as response:
        return response.read()


def main() -> None:
    DEST.mkdir(parents=True, exist_ok=True)
    rows = []
    for sound_id, author, title, purpose, filename in CANDIDATES:
        page = f"https://freesound.org/people/{author}/sounds/{sound_id}/"
        html = fetch(page).decode("utf-8")
        if "Creative Commons 0" not in html:
            raise RuntimeError(f"No se ha podido comprobar CC0: {page}")
        match = re.search(r'data-static-file-url="(https://cdn\.freesound\.org/previews/[^\"]+-hq\.mp3)"', html)
        if not match:
            raise RuntimeError(f"No se encontró preview HQ: {page}")
        data = fetch(match.group(1))
        if len(data) < 1000:
            raise RuntimeError(f"Preview demasiado pequeña: {page}")
        (DEST / filename).write_bytes(data)
        rows.append((purpose, filename, title, author, page, len(data)))
        print(f"{filename}: {len(data)} bytes · CC0 verificado en {page}")

    cards = "\n".join(
        f'<article><span>{escape(purpose)}</span><h2>{escape(title)}</h2>'
        f'<audio controls preload="none" src="{escape(filename)}"></audio>'
        f'<p><a href="{escape(page)}">Fuente original</a> · {escape(author)} · CC0 · preview HQ de Freesound</p></article>'
        for purpose, filename, title, author, page, _ in rows
    )
    document = f'''<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Audición de sonidos · El Linde del Velo</title>
<style>
body{{margin:0;background:#100e17;color:#f4eadb;font:18px/1.4 system-ui,sans-serif}}
main{{max-width:1080px;margin:auto;padding:32px 20px 80px}}
h1{{font:700 42px Georgia,serif;color:#ffe2aa}}.intro{{max-width:780px;color:#cbbcae}}
.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;margin-top:28px}}
article{{border:1px solid #866747;border-radius:14px;background:#1c1724;padding:22px}}
article span{{color:#e6ad73;text-transform:uppercase;letter-spacing:.13em;font-size:14px;font-weight:700}}
article h2{{font:700 26px Georgia,serif;margin:8px 0 18px}}audio{{width:100%}}
article p{{font-size:14px;color:#b9aeb7}}a{{color:#f7bf80}}
</style></head><body><main><h1>El Linde del Velo · sonidos candidatos</h1>
<p class="intro">Escucha y compara. Son previews CC0 de Freesound para aprobar el tono; todavía no están instalados en el juego ni procesados al volumen final. Algunas grabaciones duran más de lo que duraría el efecto definitivo.</p>
<div class="grid">{cards}</div></main></body></html>'''
    (DEST / "escuchar.html").write_text(document, encoding="utf-8")
    notes = [
        "# Candidatos de sonido para El Linde del Velo",
        "",
        "Previews HQ de Freesound, con licencia CC0 comprobada el 11 de octubre de 2026 en cada página original. Solo para audición; ninguno está conectado al bot ni a OBS.",
        "",
        "| Papel propuesto | Archivo | Autor y fuente |",
        "| --- | --- | --- |",
    ]
    notes += [f"| {purpose} | `{filename}` | [{author} — {title}]({page}) |" for purpose, filename, title, author, page, _ in rows]
    notes += ["", "Al aprobar, recortar, fundir y nivelar los elegidos; probarlos con la música del canal antes de habilitar audio en OBS.", ""]
    (DEST / "README.md").write_text("\n".join(notes), encoding="utf-8")


if __name__ == "__main__":
    main()
