import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { config, type LogLevel } from '../config.js';

/**
 * Logger mínimo. Sin dependencias, sin colores (la consola de Windows
 * los maneja de forma inconsistente y aquí no aportan nada).
 */

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = ORDER[config.logLevel];

function stamp(): string {
  // Hora local en HH:MM:SS — durante un directo la fecha sobra.
  return new Date().toLocaleTimeString('es-ES', { hour12: false });
}

/**
 * Las últimas líneas, en memoria, para el panel.
 *
 * Es un anillo de tamaño fijo: un directo de seis horas no puede ir llenando
 * la memoria del proceso. Guarda lo mismo que sale por consola y con el mismo
 * umbral de nivel, para que el panel y la terminal cuenten la misma historia.
 */
export interface LineaLog {
  n: number;
  at: string;
  level: LogLevel;
  msg: string;
}

const MAX_RECIENTES = 300;
const buffer: LineaLog[] = [];
let contador = 0;

/** Líneas con número mayor que `desde`. Así el panel solo pide lo nuevo. */
export function recientes(desde = 0): LineaLog[] {
  return buffer.filter((l) => l.n > desde);
}

function write(level: LogLevel, label: string, msg: string, extra?: unknown, msgArchivo = msg): void {
  if (ORDER[level] < threshold) return;
  contador += 1;
  buffer.push({ n: contador, at: new Date().toISOString(), level, msg });
  if (buffer.length > MAX_RECIENTES) buffer.shift();

  const line = `${stamp()} ${label} ${msg}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  if (extra !== undefined) console.log(inspect(extra));
  // Los detalles (payloads enteros) solo con avisos y errores: son los que se
  // necesitan para saber qué falló, y los demás llevan lo que escribe la gente.
  alArchivo(`${stamp()} ${label} ${msgArchivo}${extra !== undefined && ORDER[level] >= ORDER.warn ? `\n${inspect(extra)}` : ''}`);
}

// ---------------------------------------------------------------------------
// El registro en disco (28 sep 2026)
// ---------------------------------------------------------------------------
//
// Solo existía en la consola: para saber por qué un Grito de guerra «no hacía
// nada» hubo que reconstruirlo con el log de Streamer.bot. Ahora el bot deja
// logs/bot-AAAA-MM-DD.log, uno por día, y borra los de más de 14 días.
// Lo activa index.ts: los tests, el laboratorio y el simulador no escriben.

export const DIAS_LOGS = 14;
let carpetaLogs = 'logs';
let archivoActivo = false;

/** Empieza a guardar el registro en disco y borra los días viejos. */
export function activarArchivo({ ahora = new Date(), carpeta = 'logs' }: { ahora?: Date; carpeta?: string } = {}): void {
  archivoActivo = true;
  carpetaLogs = carpeta;
  try {
    mkdirSync(carpetaLogs, { recursive: true });
    const limite = ahora.getTime() - DIAS_LOGS * 86_400_000;
    for (const nombre of readdirSync(carpetaLogs)) {
      const m = /^bot-(\d{4}-\d{2}-\d{2})\.log$/.exec(nombre);
      if (m && new Date(`${m[1]}T23:59:59`).getTime() < limite) rmSync(join(carpetaLogs, nombre), { force: true });
    }
  } catch (err) {
    console.warn(`${stamp()} [WARN ] No se pudo preparar la carpeta de logs: ${String(err)}`);
  }
}

/** Solo para tests. */
export function desactivarArchivo(): void {
  archivoActivo = false;
  carpetaLogs = 'logs';
}

/** El archivo de hoy, en hora local: un directo que pasa de medianoche sigue en el suyo. */
export function archivoDeHoy(ahora = new Date()): string {
  const d = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
  return join(carpetaLogs, `bot-${d}.log`);
}

function alArchivo(linea: string): void {
  if (!archivoActivo) return;
  try {
    appendFileSync(archivoDeHoy(), linea + '\n', 'utf8');
  } catch {
    // Un disco lleno o un archivo bloqueado no pueden tumbar el bot en directo.
  }
}

function inspect(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export const log = {
  debug: (msg: string, extra?: unknown) => write('debug', '[debug]', msg, extra),
  info: (msg: string, extra?: unknown) => write('info', '[info ]', msg, extra),
  warn: (msg: string, extra?: unknown) => write('warn', '[WARN ]', msg, extra),
  error: (msg: string, extra?: unknown) => write('error', '[ERROR]', msg, extra),
  /** Como info, pero al disco va `paraArchivo`: sin lo que escribe la gente. */
  evento: (msg: string, paraArchivo: string) => write('info', '[info ]', msg, undefined, paraArchivo),
};

/**
 * Guarda en logs/raw-events.log los payloads de eventos que todavía no
 * normalizamos. No es un log de depuración: es materia prima para escribir
 * los normalizadores de la Fase 3 contra datos reales en vez de contra
 * la documentación.
 */
export function captureRaw(eventName: string, payload: unknown): void {
  if (!config.captureRawEvents) return;
  try {
    mkdirSync('logs', { recursive: true });
    const entry = { at: new Date().toISOString(), event: eventName, payload };
    appendFileSync('logs/raw-events.log', JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    // Nunca dejamos que un fallo de escritura tumbe el proceso durante un directo.
    log.warn(`No se pudo guardar el payload de ${eventName}: ${String(err)}`);
  }
}
