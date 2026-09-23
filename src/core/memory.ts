import { getDb, nowIso } from '../data/db.js';
import { log } from './logger.js';
import * as consent from './consent.js';
import { config } from '../config.js';

/**
 * Qué recuerda el bot de una persona, cuánto dura y cuándo se saca.
 *
 * Es el núcleo de la Fase 8 y también su parte delicada: aquí se guarda texto
 * que ha escrito un desconocido. Tres barreras, todas obligatorias:
 *
 *  1. **Lista blanca de temas.** Solo juegos, comida, planes y costumbres.
 *     La decide el código, no la IA: si la IA propusiera el tema y el código
 *     se fiara, bastaría con que se equivocara una vez.
 *  2. **Caducidad.** 90 días por defecto (docs/02, mitigación de #15). Un dato
 *     de hace cuatro meses que la persona ya no recuerda haber dicho no
 *     produce "aquí me conocen", produce desconcierto.
 *  3. **Consentimiento.** Quien ha pedido el olvido no vuelve a tener nada
 *     guardado, y esto se comprueba en el momento de ESCRIBIR, no solo al
 *     leer. Una comprobación solo en lectura dejaría la base de datos
 *     llenándose de datos de alguien que pidió que le olvidaran.
 */

/**
 * Temas permitidos, de docs/02: *"solo datos de temas neutros (juegos,
 * comida, planes)"*. `costumbres` cubre las preguntas de `#1` del tipo
 * "¿ducha de mañana o de noche?", que ya se le hacen a todo el mundo.
 *
 * Que esta lista sea corta es la intención, no una limitación pendiente de
 * ampliar. Cada tema nuevo es una superficie nueva por la que puede colarse
 * algo que alguien preferiría que no se recordara.
 */
export const TEMAS = ['juegos', 'comida', 'planes', 'costumbres'] as const;
export type Tema = (typeof TEMAS)[number];

export function esTemaPermitido(tema: string): tema is Tema {
  return (TEMAS as readonly string[]).includes(tema);
}

/** De dónde salió el recuerdo. */
export type Kind = 'ticket' | 'dato';

export interface Memory {
  id: number;
  twitch_id: string;
  kind: Kind;
  topic: Tema;
  content: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

export interface Guardar {
  twitchId: string;
  kind: Kind;
  topic: string;
  content: string;
}

export type Resultado = { ok: true; id: number } | { ok: false; motivo: string };

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Guarda un recuerdo, si se puede.
 *
 * Devuelve el motivo en vez de lanzar: que un dato no se pueda guardar es
 * normal y previsto, no un error del programa.
 */
export function guardar(entrada: Guardar): Resultado {
  const contenido = entrada.content.trim();

  if (consent.haPedidoOlvido(entrada.twitchId)) {
    return { ok: false, motivo: 'la persona pidió que no la recordáramos' };
  }

  if (!entrada.twitchId) return { ok: false, motivo: 'sin id de usuario' };
  if (contenido.length === 0) return { ok: false, motivo: 'contenido vacío' };

  if (contenido.length > config.memoria.maxContenido) {
    return {
      ok: false,
      motivo: `${contenido.length} caracteres, el máximo son ${config.memoria.maxContenido}`,
    };
  }

  if (!esTemaPermitido(entrada.topic)) {
    return { ok: false, motivo: `tema "${entrada.topic}" fuera de la lista blanca` };
  }

  const ahora = new Date();
  const caduca = new Date(ahora.getTime() + config.memoria.diasCaducidad * DIA_MS);

  const info = getDb()
    .prepare(
      `INSERT INTO memories (twitch_id, kind, topic, content, created_at, expires_at, used_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(
      entrada.twitchId,
      entrada.kind,
      entrada.topic,
      contenido,
      ahora.toISOString(),
      caduca.toISOString(),
    );

  log.debug(`memoria guardada para ${entrada.twitchId}: ${entrada.kind}/${entrada.topic}`);
  return { ok: true, id: Number(info.lastInsertRowid) };
}

/**
 * Recuerdos vigentes de una persona, del más reciente al más antiguo.
 *
 * Los caducados no se devuelven NUNCA, aunque sigan en la tabla. Borrarlos es
 * otra cosa (`limpiarCaducados`) y puede fallar o no haberse ejecutado: la
 * garantía de que no salen tiene que estar en la lectura.
 */
export function de(twitchId: string): Memory[] {
  if (consent.haPedidoOlvido(twitchId)) return [];

  return getDb()
    .prepare(
      `SELECT id, twitch_id, kind, topic, content, created_at, expires_at, used_at
         FROM memories
        WHERE twitch_id = ? AND expires_at > ?
        ORDER BY created_at DESC`,
    )
    .all(twitchId, nowIso()) as unknown as Memory[];
}

/**
 * Un recuerdo para sacar ahora, o null.
 *
 * Prefiere el que nunca se ha usado y, entre esos, el más antiguo: sacar dos
 * veces el mismo dato es peor que no sacar ninguno, y un dato viejo sorprende
 * más que uno de ayer.
 */
export function paraSacar(twitchId: string): Memory | null {
  const vigentes = de(twitchId);
  const sinUsar = vigentes.filter((m) => m.used_at === null);
  const candidatos = sinUsar.length > 0 ? sinUsar : [];

  if (candidatos.length === 0) return null;

  return candidatos.reduce((masViejo, m) => (m.created_at < masViejo.created_at ? m : masViejo));
}

/** Marca un recuerdo como ya usado, para no repetirlo. */
export function marcarUsado(id: number): void {
  getDb().prepare('UPDATE memories SET used_at = ? WHERE id = ?').run(nowIso(), id);
}

/**
 * Borra los caducados.
 *
 * Se llama al arrancar. No es imprescindible para la corrección —las lecturas
 * ya filtran por fecha— pero sin esto la tabla crece para siempre con datos
 * que nadie va a volver a leer, y "lo guardamos pero no lo usamos" es
 * exactamente lo que no queremos poder decir de los datos de alguien.
 */
export function limpiarCaducados(): number {
  const info = getDb().prepare('DELETE FROM memories WHERE expires_at <= ?').run(nowIso());
  const borrados = Number(info.changes);
  if (borrados > 0) log.info(`Memoria: ${borrados} recuerdo(s) caducado(s) borrados.`);
  return borrados;
}

export function count(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM memories').get() as { n: number };
  return row.n;
}
