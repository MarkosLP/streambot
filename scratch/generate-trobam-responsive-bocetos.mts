import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { editar } from '../src/services/ia-imagen.ts';

const sharp = (await import('file:///D:/Descargas/Trobam/node_modules/sharp/dist/index.mjs')).default;
const outputDir = 'D:/Descargas/Trobam/scratch/robot-responsive-bocetos';
const source = 'D:/Descargas/Trobam/src/components/brand/robot/idle.webp';
mkdirSync(outputDir, { recursive: true });

const reference = await sharp(readFileSync(source)).png().toBuffer();
const common = `Use the supplied image as the exact character reference for Trobam's robot mascot. Preserve the recognizable cream rounded helmet and body, glossy black face screen, warm amber eyes and smile, glowing orange antenna bulb, orange circular ear covers, teal chest and orange details, soft polished 3D illustration style and gentle lighting. This is a standalone character asset for a responsive business marketplace website. Transparent background, no scenery, no floor, no shadow, no text, no logos, no UI elements, no other characters. Keep all visible parts comfortably within the canvas with generous transparent margins. Do not redesign the face, proportions or materials.`;

const variants = [
  {
    file: 'tablet-busto.png',
    prompt: `${common} Create a TABLET-specific pose: three-quarter view, upper body from waist upward, smiling and examining a small magnifying glass near the lower side of its face. One hand holds the magnifying glass; the other hand rests naturally. The head and chest are fully visible. Compact silhouette with no legs, composed to sit beside a headline in a two-column 820-1024px layout. The character must read clearly at about 300px display width.`,
  },
  {
    file: 'movil-saludo.png',
    prompt: `${common} Create a MOBILE-specific pose: tight head-and-shoulders portrait, front-facing, smiling warmly with one small hand waving hello beside the face. No magnifying glass. The antenna, both orange ear covers, full face and waving hand must be visible. Simple compact silhouette that reads at about 150-180px display width beside a search field. Do not include legs.`,
  },
];

for (const variant of variants) {
  console.log(`Generating ${variant.file}`);
  const result = await editar({
    base: reference,
    prompt: variant.prompt,
    tamano: '1024x1024',
    transparente: true,
    calidad: 'medium',
  });
  const target = join(outputDir, variant.file);
  writeFileSync(target, result);
  const metadata = await sharp(result).metadata();
  console.log(`${target} ${metadata.width}x${metadata.height} ${metadata.channels} channels`);
}
