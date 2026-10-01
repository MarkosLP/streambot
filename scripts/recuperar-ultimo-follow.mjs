// Recupera el último follow real ya recibido por Streamer.bot antes de corregir targetUser.
// Ejecutar con el bot cerrado o reiniciarlo después: el proceso mantiene estos ajustes en memoria.
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/crid4m.sqlite');
try {
  const fila = db.prepare('SELECT valor FROM ajustes WHERE clave = ?').get('overlays');
  if (!fila) throw Error('No hay ajustes de overlays en la base de datos');
  const guardado = JSON.parse(fila.valor);
  let ultimo = guardado.ultimoFollow?.quien ? guardado.ultimoFollow : null;
  for (const linea of (await readFile('logs/raw-events.log', 'utf8')).split(/\r?\n/)) {
    if (!linea) continue;
    let registro;
    try { registro = JSON.parse(linea); } catch { continue; }
    if (registro.event !== 'Twitch.Follow' || registro.payload?.isTest) continue;
    const usuario = registro.payload?.targetUser;
    const quien = typeof usuario?.name === 'string' ? usuario.name.trim() : '';
    const at = registro.payload?.followedAt || registro.at;
    if (!quien || !Number.isFinite(Date.parse(at))) continue;
    if (!ultimo || Date.parse(at) > Date.parse(ultimo.at)) ultimo = { quien, at };
  }
  if (!ultimo) {
    console.log('No hay ningún follow real recuperable.');
  } else if (guardado.ultimoFollow?.quien === ultimo.quien && guardado.ultimoFollow?.at === ultimo.at) {
    console.log(`El último follow ya está guardado: ${ultimo.quien}.`);
  } else {
    guardado.ultimoFollow = ultimo;
    db.prepare('UPDATE ajustes SET valor = ?, at = ? WHERE clave = ?').run(JSON.stringify(guardado), new Date().toISOString(), 'overlays');
    console.log(`Último follow real recuperado: ${ultimo.quien} (${ultimo.at}).`);
  }
} finally {
  db.close();
}
