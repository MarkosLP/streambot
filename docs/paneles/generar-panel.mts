// Un panel de Twitch ENTERO pintado con gpt-image-2 (texto incluido). Uso: npx tsx docs/paneles/generar-panel.mts <panel> [luminosa]
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config } from '../../src/config.ts';
import { generar } from '../../src/services/ia-imagen.ts';

// Los originales pesan ~3 MB: se reducen a JPG de 640 px para Twitch (README) y se borran.
const DESTINO = fileURLToPath(new URL('../../biblioteca/imagenes/twitch/paneles-ia/', import.meta.url));

const calidad = 'high' as const;

const LUMINOSA = process.argv[3] === 'luminosa';
const AMBIENTE_LUMINOSA = [
  'Mood: bright open-sky fantasy adventure, like the key art of a modern anime MMO (Genshin Impact, Tower of Fantasy, Blue Protocol style): epic but cheerful, full daylight, fresh air, sense of adventure. NOT dark, NOT gothic, NOT horror, no skulls.',
  'Frame: ornate ivory-white and polished gold trim with small sky-blue crystal gems around the whole panel. Inside: a deep but luminous ocean-blue to teal background (#0f3550 to #0a2438) like enchanted glass with faint light rays, so cream-white text stays very readable.',
  'Palette: sky blue, turquoise, gold (#f5c542), white clouds, a touch of warm sunlight orange. Mature anime RPG art, not cute, not chibi, not cartoonish, not childish, no stickers.',
].join(' ');
const AMBIENTE_TABERNA = [
  'Mood: a cozy adventurers\' guild tavern — warm, welcoming and lively, like "come in, sit down, we are about to start". Warm lantern and hearth light, polished dark wood, brass fittings, leather, maps. NOT gloomy, NOT gothic, NOT horror, no skulls, no darkness-heavy shadows.',
  'Frame: carved warm walnut wood with polished brass/gold corner fittings and small amber gems around the whole panel. Inside: a rich warm dark-brown wood or leather background (#2a1a10 to #1a100a) softly lit in amber, so light text stays very readable.',
  'Palette: honey gold (#f5c542), warm amber, candle orange, wine red accents, warm browns; a small touch of teal for contrast. Mature anime RPG art, not cute, not chibi, not cartoonish, not childish, no stickers.',
].join(' ');
const CABECERA_LUMINOSA = 'HEADER (only the top ~15% of the panel, a short wide strip): a bright painted panorama of floating sky islands with waterfalls and a white-and-gold fantasy city on a cliff, airships and birds in a blue sky with soft clouds, sunlight; two crossed swords and an open glowing book in the foreground on a stone ledge; it blends softly into the panel.';

const ESTILO = [
  'A single vertical Twitch channel "About" panel graphic, full bleed, for a fantasy MMO and anime RPG gaming channel.',
  'Look: premium game UI like a high-end modern anime action RPG or MMO menu, painterly and richly detailed, NOT flat vector.',
  LUMINOSA ? AMBIENTE_LUMINOSA : AMBIENTE_TABERNA,
  'TYPOGRAPHY IS CRITICAL: render every text string EXACTLY as written below, in Spanish, letter by letter, with its accents, punctuation and the leading exclamation mark on commands. Crisp, perfectly legible, evenly spaced. Do not add, translate, abbreviate or invent any other text, numbers, logos or watermarks.',
].join(' ');

const PANELES: Record<string, string> = {
  comandos: [
    LUMINOSA ? CABECERA_LUMINOSA : 'HEADER (only the top ~15% of the panel, a short wide strip): a painted scene of the tavern\'s guild counter — a warm hearth, hanging lanterns, a wooden quest board with blank pinned parchments (no writing on them), two crossed swords mounted on the wall above, a frothy mug on the counter; it blends softly into the panel.',
    'Right under the header, centered: the title "COMANDOS" in a large carved gold serif (Cinzel-like) with a soft warm glow, and under it a smaller cream line "Escríbelos en el chat".',
    'Then a small ornamental divider with the section label "LOOT" in gold small caps.',
    'Then a two-column list of 15 entries in 8 rows (the 8th row has a single entry, centered). Each entry is a glossy gold plaque with dark bold monospace text for the command, and directly under it a short description in bright cream-white bold sans-serif.',
    'TEXT SIZE: this panel is shown shrunk to 320 px wide, so all text must be LARGE: command text about 42 px tall and description text about 36 px tall in this 1024 px wide image, filling most of each column width. Use the vertical space for text, not for decoration. Rows read left then right:',
    'Row 1: "!loot" / "Cómo funciona" — "!pj" / "Tu ficha de personaje".',
    'Row 2: "!inventario" / "Tu mochila" — "!poder" / "Tu poder y tus duelos".',
    'Row 3: "!top" / "Podio del mes" — "!temporada" / "Tus puntos y premios".',
    'Row 4: "!evento" / "Evento de la semana" — "!duelo nombre" / "Reta a alguien".',
    'Row 5: "!dar ana 2" / "Regala un objeto" — "!usar" / "Usa un objeto mágico".',
    'Row 6: "!atacar" / "Pega al jefe" — "!forjar" / "3 iguales → 1 mejor".',
    'Row 7: "!presumir" / "Tu mejor pieza en pantalla" — "!coleccion" / "Colección y títulos".',
    'Row 8 (one entry, centered): "!purificar" / "Limpia un maldito (Poción)".',
    'Then, with clear space above and below it (as much as between the title and "LOOT"), another ornamental divider with the section label "CON EL BOT".',
    'Then one row of 2 entries: "!pregunta" / "Pregúntale a la IA" — "!incomoda" / "Pregunta incómoda (subs)".',
    'Leave comfortable margins inside the frame; nothing touches the frame. Thin faint separators between rows.',
  ].join(' '),

  recompensas: [
    'HEADER (only the top ~15% of the panel, a short wide strip): a painted scene of the tavern\'s merchant counter — stacks and spilled piles of shining gold coins, a small brass scale, a coin purse, warm lanterns; it blends softly into the panel.',
    'Right under the header, centered: the title "RECOMPENSAS" in a large carved gold serif (Cinzel-like) with a soft warm glow, and under it a smaller cream line "Con Oros, los puntos del canal".',
    'Then a vertical list of 6 rows. Each row is a wide rounded plate with a colored left edge and soft glow in its rarity color, containing: on the left a small painted game-item icon, in the middle a bold title in bright cream-white with a smaller description line under it in warm light beige, and on the right the price in large bold gold digits next to a small gold coin.',
    'TEXT SIZE: this panel is shown shrunk to 320 px wide, so all text must be LARGE: titles about 40 px tall, descriptions about 32 px tall, prices about 44 px tall in this 1024 px wide image. Use the vertical space for text, not decoration.',
    'Row 1 (rarity gray-silver): icon red health potion bottle; title "Poción de vida"; description "«¡Bebe agua!» y !purificar"; price "500".',
    'Row 2 (rarity gray-silver): icon a war horn; title "Grito de guerra"; description "Cae un cofre de armas"; price "750".',
    'Row 3 (rarity blue): icon a small treasure chest; title "Cofre del tesoro"; description "Mejor suerte, al momento"; price "1.500".',
    'Row 4 (rarity purple): icon a cursed purple skull with dark smoke; title "Maldición"; description "Blanco y negro + objeto maldito"; price "2.500".',
    'Row 5 (rarity purple): icon a cracked boulder; title "Terremoto"; description "Tiembla y sale un jefe"; price "3.000".',
    'Row 6 (rarity orange-legendary): icon a frozen glitched hourglass; title "Lag"; description "Congela la imagen y al jefe"; price "5.000".',
    'Prices use a dot as thousands separator exactly as written. Leave comfortable margins inside the frame.',
  ].join(' '),

  loot: [
    'HEADER (only the top ~15% of the panel, a short wide strip): a painted scene of an open treasure chest on a tavern table overflowing with gold, gems and a glowing sword, warm lantern light; it blends softly into the panel.',
    'Right under the header, centered: the title "LOOT DEL CHAT" in a large carved gold serif (Cinzel-like) with a soft warm glow, and under it a smaller cream line "Botín por estar en el directo".',
    'Then one centered paragraph in bright cream-white: "Cada 20-30 min cae un cofre para quien haya escrito hace poco. Va a tu mochila y sale en pantalla." with "20-30 min" in gold.',
    'Then one row of 4 small glowing rarity badges, left to right: "Común" (silver-gray), "Raro" (blue), "Épico" (purple), "Legendario" (orange).',
    'Then an ornamental divider with the gold section label "Y ADEMÁS", followed by 5 lines, each with a small painted icon on the left and text on the right; the part before the colon (or comma) is bold gold, the rest cream-white:',
    '1 icon a flame: "3 directos seguidos: cofre de fidelidad."',
    '2 icon a small dragon head: "Jefes: todos a !atacar; botín para quien pegue."',
    '3 icon a trophy: "Temporada: cada mes, podio con premio y título."',
    '4 icon a calendar page: "Cada lunes, un evento que cambia las reglas."',
    '5 icon crossed swords: "Duelos, forja y colecciones con título."',
    'Then another ornamental divider with the gold section label "SUBS, BITS Y RAIDS", followed by 4 lines in the same style:',
    '1 icon a purple heart gem: "Sub: cofre (legendario al año) y mochila de 30."',
    '2 icon a gift box: "Regalar subs: cofre para ambos; 5+, ¡lluvia de cofres!"',
    '3 icon a faceted diamond: "Bits: 100 = un golpe al jefe; sin jefe, 300 = cofre."',
    '4 icon a shield: "Raid: cofre para quien la trae; con 3+, un jefe."',
    'At the bottom, centered and small: "Todos los comandos: !loot" with "!loot" in gold.',
    'TEXT SIZE: this panel is shown shrunk to 320 px wide, so text must be LARGE: body lines about 32 px tall, section labels about 34 px, in this 1024 px wide image. Each line may wrap to two lines; keep it left-aligned next to its icon. Use the vertical space for text, not decoration.',
  ].join(' '),

  jefes: [
    'HEADER (only the top ~15% of the panel, a short wide strip): a painted scene of a tavern wall with a wanted/bounty board of monster trophies — a mounted dragon horn, a big battle axe, claw marks, warm lanterns; it blends softly into the panel. Any posters are blank or show only monster sketches, with no writing.',
    'Right under the header, centered: the title "JEFES DE RAID" in a large carved gold serif (Cinzel-like) with a soft warm glow, and under it a smaller cream line "Aparecen en el directo: ¡!atacar!".',
    'Then a two-column grid of 10 boss cards, 5 rows. Each card is a dark rounded tile with: on the left a small round painted portrait of the boss in a gold ring, glowing in its color; on the right the boss name in bold bright cream-white serif and under it its special attack in its color. Rows read left then right:',
    'Row 1: frost dragon (icy blue) "Dragón de Escarcha" / "Aliento helado" — skeleton king with crown (bone white) "Rey Esqueleto" / "Alza a los muertos".',
    'Row 2: swamp hydra (toxic green) "Hidra del Pantano" / "Mordisco venenoso" — obsidian golem with lava cracks (orange) "Gólem de Obsidiana" / "Terremoto".',
    'Row 3: hooded lich (violet) "Liche sin Nombre" / "Drenar alma" — giant spider queen (magenta) "Araña Reina" / "Telaraña".',
    'Row 4: kraken (sea teal) "Kraken del Foso" / "Tentáculo" — hungover minotaur looking queasy, a bit comic (sickly green) "Minotauro con Resaca" / "Vomitona".',
    'Row 5: a clumsy armored knight hiding behind a huge shield, a bit comic (steel blue) "Tanque que no sabe tanquear" / "Se pega solo" — a glitching pixel-noise specter with a broken wifi symbol (red) "Lag Primigenio" / "Desconexión".',
    'At the bottom, centered: "Cada uno tiene su ataque especial" with "ataque especial" in gold.',
    'TEXT SIZE: this panel is shown shrunk to 320 px wide, so text must be LARGE: boss names about 34 px tall, attacks about 30 px tall in this 1024 px wide image; names may wrap to two lines. Portraits are painted anime RPG monster art, mature, not cute.',
  ].join(' '),
};
const TAMANOS: Record<string, string> = { comandos: '1024x1712', recompensas: '1024x1344', loot: '1024x1600', jefes: '1024x1472' };

const nombre = process.argv[2] ?? '';
const detalle = PANELES[nombre];
if (!detalle) throw new Error(`Panel desconocido: ${nombre}`);
const prompt = `${ESTILO}\n\n${detalle}`;
const tamano = TAMANOS[nombre]!;

console.log(`Panel: ${nombre} · modelo: ${config.imagen.modelo} · calidad: ${calidad} · tamaño: ${tamano}`);
const png = await generar({ prompt, tamano, calidad });
await mkdir(DESTINO, { recursive: true });
const sello = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
const archivo = `${DESTINO}${nombre}${LUMINOSA ? '-luminosa' : ''}-${sello}.png`;
await writeFile(archivo, png);
await writeFile(`${archivo}.json`, JSON.stringify({ modelo: config.imagen.modelo, calidad, tamano, prompt, fecha: new Date().toISOString() }, null, 2));
console.log(`Guardada: ${archivo} (${Math.round(png.length / 1024)} KB)`);
