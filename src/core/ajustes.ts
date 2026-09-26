import { config } from '../config.js';
import { getDb, nowIso } from '../data/db.js';
import { log } from './logger.js';

/**
 * Ajustes que se pueden cambiar con el bot en marcha, desde el panel.
 *
 * Arrancan con el valor del `.env`. Hasta el 26 sep 2026 vivían solo en
 * memoria y cada reinicio los devolvía al `.env`, a propósito: que un cambio
 * con prisas no sobreviviera a un reinicio. En la práctica obligaba a volver
 * a tocarlo todo después de cada reinicio, y se decidió guardarlos (tabla
 * `ajustes`). Sin fila guardada, manda el `.env`; «Volver a lo del .env» en
 * el panel borra lo guardado.
 *
 * El interruptor de emergencia sigue SIN guardarse (killswitch.ts): si
 * reinicias, el bot vuelve encendido. Un «apagado» olvidado no debe
 * sobrevivir a un reinicio sin que nadie lo decida.
 *
 * Todo el código lee de aquí, no de `config`: `config` sigue siendo lo que se
 * leyó del `.env` al arrancar.
 */

export type Clave = 'espontaneas' | 'revision' | 'loot' | 'canalJuega';

const DEL_ENV: Record<Clave, () => boolean> = {
  espontaneas: () => config.interaccionesEspontaneas,
  revision: () => config.reviewMode,
  loot: () => config.loot.activo,
  canalJuega: () => config.loot.canalJuega,
};

const AVISOS: Record<Clave, [string, string]> = {
  espontaneas: ['Interacciones espontáneas ENCENDIDAS', 'Interacciones espontáneas APAGADAS'],
  revision: ['Modo revisión ACTIVADO', 'Modo revisión DESACTIVADO'],
  loot: ['Loot del chat ACTIVADO', 'Loot del chat DESACTIVADO'],
  canalJuega: ['El canal JUEGA al Loot', 'El canal NO juega al Loot'],
};

const CLAVES = Object.keys(DEL_ENV) as Clave[];
const valores = Object.fromEntries(CLAVES.map((c) => [c, DEL_ENV[c]()])) as Record<Clave, boolean>;

function poner(clave: Clave, valor: boolean, quien: string): void {
  if (valores[clave] === valor) return;
  valores[clave] = valor;
  log.warn(`${AVISOS[clave][valor ? 0 : 1]} — ${quien}.`);
  try {
    getDb()
      .prepare('INSERT INTO ajustes (clave, valor, at) VALUES (?, ?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, at = excluded.at')
      .run(clave, valor ? '1' : '0', nowIso());
  } catch (err) {
    // Sin base de datos (algún test) se queda en memoria: no es grave.
    log.debug(`Ajuste ${clave} sin guardar: ${String(err)}`);
  }
}

/** Al arrancar: lo que guardaste en el panel pasa por encima del .env. */
export function cargarGuardados(): void {
  const filas = getDb().prepare('SELECT clave, valor FROM ajustes').all() as Array<{ clave: string; valor: string }>;
  const leidas: string[] = [];
  for (const { clave, valor } of filas) {
    if (!CLAVES.includes(clave as Clave)) continue;
    valores[clave as Clave] = valor === '1';
    leidas.push(`${clave}=${valor === '1' ? 'sí' : 'no'}`);
  }
  if (leidas.length) log.info(`Ajustes guardados desde el panel: ${leidas.join(', ')}.`);
}

/** Vuelve a lo que diga el .env y olvida lo guardado. */
export function volverAlEnv(quien: string): void {
  for (const c of CLAVES) valores[c] = DEL_ENV[c]();
  try { getDb().prepare('DELETE FROM ajustes').run(); } catch { /* sin base de datos */ }
  log.warn(`Ajustes devueltos a lo del .env — ${quien}.`);
}

/** Para el panel: cada ajuste, su valor, si está guardado y qué dice el .env. */
export function todos(): Record<Clave, { valor: boolean; guardado: boolean; env: boolean }> {
  let guardadas = new Set<string>();
  try {
    guardadas = new Set((getDb().prepare('SELECT clave FROM ajustes').all() as Array<{ clave: string }>).map((f) => f.clave));
  } catch { /* sin base de datos */ }
  return Object.fromEntries(
    CLAVES.map((c) => [c, { valor: valores[c], guardado: guardadas.has(c), env: DEL_ENV[c]() }]),
  ) as Record<Clave, { valor: boolean; guardado: boolean; env: boolean }>;
}

export const interaccionesEspontaneas = () => valores.espontaneas;
export const modoRevision = () => valores.revision;
/** ¿Caen cofres del Loot del chat? Es independiente de las espontáneas. */
export const lootActivo = () => valores.loot;
/** ¿El canal juega al Loot como uno más? */
export const canalJuega = () => valores.canalJuega;

export const setInteraccionesEspontaneas = (valor: boolean, quien: string) => poner('espontaneas', valor, quien);
export const setModoRevision = (valor: boolean, quien: string) => poner('revision', valor, quien);
export const setLootActivo = (valor: boolean, quien: string) => poner('loot', valor, quien);
export const setCanalJuega = (valor: boolean, quien: string) => poner('canalJuega', valor, quien);

/** Solo para tests: vuelve a los valores del `.env`, sin tocar la base de datos. */
export function reset(): void {
  for (const c of CLAVES) valores[c] = DEL_ENV[c]();
}
