/**
 * Cooldowns en memoria.
 *
 * FASE 3: no se persisten. Reiniciar el proceso los borra, y es aceptable
 * porque el peor caso es un mensaje de más justo después de un reinicio.
 * El "una sola vez en la vida" de Primer Mensaje NO depende de esto: lo
 * garantiza la tabla `users` de SQLite, que sí sobrevive a los reinicios.
 *
 * Se pasa `now` como parámetro en lugar de leer el reloj por dentro para que
 * los tests no dependan de esperas reales.
 */

const lastUse = new Map<string, number>();

/** Milisegundos que faltan para que `key` vuelva a estar disponible. */
export function remaining(key: string, windowMs: number, now = Date.now()): number {
  const last = lastUse.get(key);
  if (last === undefined) return 0;
  const elapsed = now - last;
  return elapsed >= windowMs ? 0 : windowMs - elapsed;
}

/**
 * Si el cooldown ha pasado, lo consume y devuelve true.
 * Si no, devuelve false y no toca nada.
 */
export function tryConsume(key: string, windowMs: number, now = Date.now()): boolean {
  if (remaining(key, windowMs, now) > 0) return false;
  lastUse.set(key, now);
  return true;
}

/** Claves de cooldown. Centralizadas para que no se escriban a mano por ahí. */
export const keys = {
  interaction: (name: string) => `interaction:${name}`,
  user: (name: string, twitchId: string) => `interaction:${name}:user:${twitchId}`,
};

/** Solo para tests y para el simulador. */
export function reset(): void {
  lastUse.clear();
}
