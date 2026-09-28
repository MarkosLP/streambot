// Busca los 10 anillos dorados del panel de jefes (centro y radio) cerca de una rejilla aproximada.
import { execFileSync } from 'node:child_process';
const [archivo] = process.argv.slice(2);
const [W, H] = execFileSync('magick', ['identify', '-format', '%w %h', archivo]).toString().split(' ').map(Number);
const px = execFileSync('magick', [archivo, '-depth', '8', 'rgb:-'], { maxBuffer: 64 << 20 });
const oro = (x, y) => {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return 0;
  const i = (y * W + x) * 3, r = px[i], g = px[i + 1], b = px[i + 2];
  return r > 140 && g > 90 && b < 120 && r - b > 70 ? 1 : 0;
};
const anillo = (cx, cy, r) => { let s = 0; for (let k = 0; k < 180; k++) { const a = (k / 180) * 2 * Math.PI; s += oro(cx + r * Math.cos(a), cy + r * Math.sin(a)); } return s / 180; };
const filas = [594, 786, 975, 1160, 1335], cols = [153, 610];
const res = [];
for (const y0 of filas) for (const x0 of cols) {
  let mejor = { p: -1 };
  for (let cx = x0 - 20; cx <= x0 + 20; cx++) for (let cy = y0 - 25; cy <= y0 + 25; cy++) for (let r = 72; r <= 98; r++) {
    const p = anillo(cx, cy, r); if (p > mejor.p) mejor = { cx, cy, r, p };
  }
  // Borde interior del anillo: el primer radio hacia dentro donde ya casi no hay oro.
  let dentro = mejor.r; while (dentro > 50 && anillo(mejor.cx, mejor.cy, dentro) > 0.25) dentro--;
  res.push({ ...mejor, dentro });
}
console.log(JSON.stringify(res));
