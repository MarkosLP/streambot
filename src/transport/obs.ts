import { createHash } from 'node:crypto';
import { config } from '../config.js';

/**
 * Cliente mínimo del WebSocket de OBS (protocolo v5, el que trae OBS 28+ de serie).
 *
 * No es una conexión permanente: se abre, se hacen las peticiones y se cierra.
 * Solo se usa desde el panel para preparar fuentes y filtros, cosa de una vez;
 * el directo lo sigue llevando Streamer.bot, que tiene su propia conexión.
 *
 * Protocolo: OBS saluda (op 0), nos identificamos (op 1), confirma (op 2), y
 * luego cada petición (op 6) tiene su respuesta (op 7) con el mismo id.
 */

export class ErrorObs extends Error {
  constructor(
    message: string,
    /** Código de obs-websocket; 601 = ya existe, 600 = no existe. */
    public codigo?: number,
  ) {
    super(message);
  }
}

export type PedirObs = <T = any>(tipo: string, datos?: Record<string, unknown>) => Promise<T>;

/** La respuesta al reto de autenticación de obs-websocket. */
export function autenticacion(password: string, salt: string, challenge: string): string {
  const sha = (s: string) => createHash('sha256').update(s).digest('base64');
  return sha(sha(password + salt) + challenge);
}

const TIEMPO_MAX_MS = 5000;

/** Abre una conexión, ejecuta `trabajo` y la cierra pase lo que pase. */
export async function conObs<T>(
  trabajo: (pedir: PedirObs) => Promise<T>,
  { url = config.obs.url, password = config.obs.password } = {},
): Promise<T> {
  const ws = new WebSocket(url);
  const pendientes = new Map<string, { ok: (v: any) => void; ko: (e: Error) => void }>();
  let siguiente = 0;

  const listo = new Promise<void>((resolve, reject) => {
    const reloj = setTimeout(() => reject(new ErrorObs(`OBS no contesta en ${url}`)), TIEMPO_MAX_MS);
    ws.addEventListener('error', () => {
      clearTimeout(reloj);
      reject(new ErrorObs(`No se pudo conectar con OBS en ${url}. ¿Está abierto y con el servidor WebSocket activado?`));
    });
    ws.addEventListener('close', (ev) => {
      clearTimeout(reloj);
      // 4009 = contraseña incorrecta, 4008 = hacía falta y no se mandó.
      if (ev.code === 4009 || ev.code === 4008) {
        reject(new ErrorObs('OBS ha rechazado la contraseña. Revisa OBS_WS_PASSWORD en el .env.'));
      } else {
        reject(new ErrorObs(`OBS cerró la conexión (${ev.code}${ev.reason ? `: ${ev.reason}` : ''}).`));
      }
      for (const p of pendientes.values()) p.ko(new ErrorObs('OBS cerró la conexión.'));
      pendientes.clear();
    });
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.op === 0) {
        const auth = msg.d.authentication;
        if (auth && !password) {
          reject(new ErrorObs('OBS pide contraseña. Ponla en OBS_WS_PASSWORD en el .env.'));
          ws.close();
          return;
        }
        ws.send(JSON.stringify({
          op: 1,
          d: { rpcVersion: 1, ...(auth ? { authentication: autenticacion(password, auth.salt, auth.challenge) } : {}) },
        }));
      } else if (msg.op === 2) {
        clearTimeout(reloj);
        resolve();
      } else if (msg.op === 7) {
        const p = pendientes.get(msg.d.requestId);
        if (!p) return;
        pendientes.delete(msg.d.requestId);
        const estado = msg.d.requestStatus;
        if (estado.result) p.ok(msg.d.responseData ?? {});
        else p.ko(new ErrorObs(estado.comment || `${msg.d.requestType} falló (${estado.code})`, estado.code));
      }
    });
  });

  const pedir: PedirObs = (tipo, datos = {}) =>
    new Promise((ok, ko) => {
      const id = String(++siguiente);
      pendientes.set(id, { ok, ko });
      ws.send(JSON.stringify({ op: 6, d: { requestType: tipo, requestId: id, requestData: datos } }));
    });

  try {
    await listo;
    return await trabajo(pedir);
  } finally {
    ws.close();
  }
}
