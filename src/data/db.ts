import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';
import { log } from '../core/logger.js';

/**
 * Acceso a SQLite.
 *
 * Driver: `node:sqlite`, el módulo integrado en Node 22. Alternativa
 * considerada: `better-sqlite3`, que es el estándar de facto pero es un módulo
 * NATIVO — en Windows depende de que exista un binario precompilado para tu
 * versión de Node, y se rompe al actualizar Node hasta recompilarlo. Para un
 * proyecto que corre en el PC del directo, esa fragilidad no compensa.
 *
 * Contrapartida: `node:sqlite` está marcado como experimental, así que su API
 * podría cambiar en una versión futura de Node. Por eso TODO el acceso a la
 * base de datos pasa por este archivo: cambiar de driver es tocar uno solo.
 */

let db: DatabaseSync | null = null;
let path = config.dbPath;

/** Cambia el archivo de base de datos. Debe llamarse ANTES del primer getDb(). */
export function configureDatabase(newPath: string): void {
  if (db) throw new Error('La base de datos ya está abierta; configureDatabase() llega tarde.');
  path = newPath;
}

export function getDb(): DatabaseSync {
  if (db) return db;

  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  db = new DatabaseSync(path);
  // WAL aguanta mejor lecturas y escrituras a la vez, que es lo que pasa
  // cuando el chat se anima. En memoria no aplica.
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  log.debug(`SQLite abierta en ${path}`);
  return db;
}

export function closeDatabase(): void {
  db?.close();
  db = null;
}

/**
 * Esquema.
 *
 * Las fechas se guardan como texto ISO 8601 en UTC. SQLite no tiene tipo
 * fecha; el texto ISO se ordena y compara correctamente y se lee a simple
 * vista al abrir el archivo con cualquier visor.
 *
 * FASE 3: solo las dos tablas que esta fase necesita. Nada de memoria, XP,
 * logros ni analytics.
 */
function migrate(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      twitch_id    TEXT PRIMARY KEY,
      login        TEXT NOT NULL,
      display_name TEXT NOT NULL,
      first_seen   TEXT NOT NULL,
      last_seen    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS interactions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      interaction TEXT NOT NULL,
      twitch_id   TEXT,
      at          TEXT NOT NULL,
      status      TEXT NOT NULL,
      detail      TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_interactions_at ON interactions(at);
    CREATE INDEX IF NOT EXISTS idx_interactions_name ON interactions(interaction);

    -- Contabilidad de la IA. Tabla aparte a propósito: la capa de IA no
    -- toca 'users' ni 'interactions'. Sin estos datos acumulados, la
    -- revisión de costes de la Fase 12 sería adivinar.
    CREATE TABLE IF NOT EXISTS ai_usage (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id            TEXT NOT NULL,
      at                    TEXT NOT NULL,
      intent                TEXT NOT NULL,
      model                 TEXT NOT NULL,
      input_tokens          INTEGER NOT NULL,
      output_tokens         INTEGER NOT NULL,
      cache_read_tokens     INTEGER NOT NULL,
      cache_creation_tokens INTEGER NOT NULL,
      cost_usd              REAL,
      outcome               TEXT NOT NULL,
      latency_ms            INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ai_usage_at ON ai_usage(at);

    -- FASE 6: sesiones de directo. Se abren con Twitch.StreamOnline y se
    -- cierran con Twitch.StreamOffline.
    --
    -- Una fila con ended_at a NULL es el directo en curso. Si el bot se
    -- arranca a mitad de directo no habrá ninguna abierta, porque el evento
    -- de apertura ya pasó: las interacciones que consultan esto tienen que
    -- aguantar que no haya directo abierto, no darlo por hecho.
    CREATE TABLE IF NOT EXISTS streams (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      ended_at   TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_streams_started ON streams(started_at);

    -- FASE 8: lo que el bot recuerda de una persona.
    --
    -- expires_at no es decorativo: es una de las mitigaciones del riesgo de
    -- #15 (docs/02). Un dato que alguien soltó hace cuatro meses y ya no
    -- recuerda haber dicho no produce "aquí me conocen", produce desconcierto.
    --
    -- topic se valida contra una lista blanca en memory.ts. Guardar texto
    -- libre de un desconocido es el riesgo real de esta fase.
    CREATE TABLE IF NOT EXISTS memories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      twitch_id  TEXT NOT NULL,
      kind       TEXT NOT NULL,
      topic      TEXT NOT NULL,
      content    TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at    TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(twitch_id);
    CREATE INDEX IF NOT EXISTS idx_memories_expires ON memories(expires_at);

    -- Quien ha pedido que no le recordemos. Esta tabla es la UNICA que
    -- sobrevive a un !olvidame, y guarda lo mínimo imprescindible para poder
    -- respetar la decisión: el id y cuándo lo pidió. Sin ella, la persona
    -- tendría que volver a pedirlo cada vez que escribiera.
    -- FASE 9: rachas de asistencia (#19).
    --
    -- "Asistir" a un directo es escribir al menos un mensaje en el.
    --
    -- last_stream_id es el nucleo: sin el no se puede distinguir "vino al
    -- directo anterior" (la racha sigue) de "se salto uno" (se rompe, o se
    -- gasta el comodin). comodin_mes guarda el mes en formato YYYY-MM en vez
    -- de un booleano, porque asi el comodin se renueva solo al cambiar de mes
    -- y no hace falta ninguna tarea que lo reinicie.
    CREATE TABLE IF NOT EXISTS streaks (
      twitch_id      TEXT PRIMARY KEY,
      current        INTEGER NOT NULL DEFAULT 0,
      best           INTEGER NOT NULL DEFAULT 0,
      last_stream_id INTEGER,
      comodin_mes    TEXT,
      updated_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS consent (
      twitch_id TEXT PRIMARY KEY,
      opted_out INTEGER NOT NULL DEFAULT 0,
      at        TEXT NOT NULL
    );

    -- Loot del chat: una fila por objeto conseguido. Se guarda el nombre y no
    -- un id del catálogo, para que cambiar el catálogo no altere lo que ya
    -- tiene la gente. display_name es para el panel; !olvidame la borra.
    CREATE TABLE IF NOT EXISTS loot (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      twitch_id    TEXT NOT NULL,
      display_name TEXT NOT NULL,
      objeto       TEXT NOT NULL,
      rareza       TEXT NOT NULL,
      origen       TEXT NOT NULL,
      at           TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_loot_user ON loot(twitch_id);

    -- La colección: qué objetos distintos ha conseguido alguien ALGUNA VEZ.
    -- Aparte de 'loot' a propósito: forjar o tirar un objeto lo saca de la
    -- mochila, pero no de la colección. Lo conseguiste, y eso no se pierde.
    CREATE TABLE IF NOT EXISTS coleccion (
      twitch_id TEXT NOT NULL,
      objeto    TEXT NOT NULL,
      rareza    TEXT NOT NULL,
      first_at  TEXT NOT NULL,
      PRIMARY KEY (twitch_id, objeto)
    );

    -- Duelos ganados y perdidos, por persona.
    CREATE TABLE IF NOT EXISTS duelos (
      twitch_id TEXT PRIMARY KEY,
      ganados   INTEGER NOT NULL DEFAULT 0,
      perdidos  INTEGER NOT NULL DEFAULT 0
    );

    -- Títulos de directo sugeridos por la IA local (panel → Títulos).
    -- favorito: lo has marcado con la estrella. usado_at: lo copiaste para
    -- usarlo. Los usados y favoritos se le pasan a la IA para no repetirse.
    CREATE TABLE IF NOT EXISTS titulos (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      texto    TEXT NOT NULL,
      juego    TEXT NOT NULL DEFAULT '',
      sesion   TEXT NOT NULL DEFAULT '',
      at       TEXT NOT NULL,
      favorito INTEGER NOT NULL DEFAULT 0,
      usado_at TEXT
    );

    -- Suscriptores (propuestas S1-S7). Se apunta con los avisos de sub de
    -- Twitch y con la insignia de cada mensaje. activo: lo es ahora mismo.
    CREATE TABLE IF NOT EXISTS suscriptores (
      twitch_id  TEXT PRIMARY KEY,
      activo     INTEGER NOT NULL DEFAULT 1,
      meses      INTEGER NOT NULL DEFAULT 0,
      nivel      INTEGER NOT NULL DEFAULT 1,
      actualizado TEXT NOT NULL
    );

    -- Temporadas del Loot (27 sep 2026): una por mes, 'YYYY-MM' en hora local.
    -- Los puntos se ganan consiguiendo botín y ganando duelos; el ranking de
    -- la temporada vuelve a cero cada mes, las mochilas no.
    CREATE TABLE IF NOT EXISTS temporada_puntos (
      temporada    TEXT NOT NULL,
      twitch_id    TEXT NOT NULL,
      display_name TEXT NOT NULL,
      puntos       INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (temporada, twitch_id)
    );

    -- El Salón de la Fama: el podio de cada temporada cerrada. Una temporada
    -- sin nadie en el podio se cierra igual (temporadas_cerradas).
    CREATE TABLE IF NOT EXISTS salon_fama (
      temporada    TEXT NOT NULL,
      puesto       INTEGER NOT NULL,
      twitch_id    TEXT NOT NULL,
      display_name TEXT NOT NULL,
      puntos       INTEGER NOT NULL,
      PRIMARY KEY (temporada, puesto)
    );

    CREATE TABLE IF NOT EXISTS temporadas_cerradas (
      temporada TEXT PRIMARY KEY,
      at        TEXT NOT NULL,
      anunciada INTEGER NOT NULL DEFAULT 0
    );

    -- Ajustes del panel que sobreviven a un reinicio (core/ajustes.ts).
    -- Sin fila, manda el .env.
    CREATE TABLE IF NOT EXISTS ajustes (
      clave TEXT PRIMARY KEY,
      valor TEXT NOT NULL,
      at    TEXT NOT NULL
    );

    -- La Frontera: estado común y progreso propio del MMO de chat.
    -- Separado del Loot para poder ajustar recompensas sin alterar su economía.
    CREATE TABLE IF NOT EXISTS mmo_world (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      modo          TEXT NOT NULL,
      fase          TEXT NOT NULL,
      expedicion_id INTEGER NOT NULL DEFAULT 0,
      region_index  INTEGER NOT NULL DEFAULT 0,
      progreso      INTEGER NOT NULL DEFAULT 0,
      meta          INTEGER NOT NULL DEFAULT 4,
      hasta_ms      INTEGER,
      pausado_ms    INTEGER,
      ultimo_suceso TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS mmo_participantes (
      expedicion_id INTEGER NOT NULL,
      twitch_id     TEXT NOT NULL,
      nombre        TEXT NOT NULL,
      aporte        INTEGER NOT NULL DEFAULT 0,
      ultimo_ms     INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (expedicion_id, twitch_id)
    );

    CREATE TABLE IF NOT EXISTS mmo_jugadores (
      twitch_id TEXT PRIMARY KEY,
      nombre    TEXT NOT NULL,
      renombre INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS mmo_acciones (
      mensaje_id TEXT PRIMARY KEY,
      twitch_id  TEXT NOT NULL,
      at_ms      INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mmo_historial (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      expedicion_id INTEGER NOT NULL,
      twitch_id     TEXT NOT NULL,
      nombre        TEXT NOT NULL,
      texto         TEXT NOT NULL,
      at_ms         INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mmo_historial_expedicion ON mmo_historial(expedicion_id, id);

    CREATE TABLE IF NOT EXISTS mmo_resultados (
      expedicion_id INTEGER PRIMARY KEY,
      completada    INTEGER NOT NULL,
      hallazgo      TEXT,
      at_ms         INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mmo_premios (
      expedicion_id INTEGER NOT NULL,
      twitch_id     TEXT NOT NULL,
      renombre      INTEGER NOT NULL,
      PRIMARY KEY (expedicion_id, twitch_id)
    );

    -- El contenido de cada expedición (interactions/mmo/contenido.ts): misión,
    -- clima, el suceso de mitad de camino, la reliquia y el capítulo de la crónica.
    CREATE TABLE IF NOT EXISTS mmo_expediciones (
      expedicion_id  INTEGER PRIMARY KEY,
      region_id      TEXT NOT NULL,
      mision_id      TEXT NOT NULL,
      clima          TEXT NOT NULL,
      suceso         TEXT,
      reliquia_id    TEXT,
      reliquia_nueva INTEGER NOT NULL DEFAULT 0,
      capitulo       INTEGER,
      inicio_ms      INTEGER NOT NULL
    );

    -- La colección de la Lumbre: cada reliquia, una vez, con la expedición que la trajo.
    CREATE TABLE IF NOT EXISTS mmo_reliquias (
      reliquia_id   TEXT PRIMARY KEY,
      expedicion_id INTEGER NOT NULL,
      at_ms         INTEGER NOT NULL
    );
  `);

  // El "continuará" de #24 es una fila por directo, así que vive en `streams`.
  // Va con ALTER porque la tabla ya existe en bases de datos de la Fase 6:
  // CREATE TABLE IF NOT EXISTS no añade columnas a una tabla que ya está.
  addColumnIfMissing(database, 'streams', 'continuara', 'TEXT');
  // Objetos malditos de la Maldición (Loot). 0 = normal.
  addColumnIfMissing(database, 'loot', 'maldito', 'INTEGER NOT NULL DEFAULT 0');
}

/**
 * Añade una columna solo si falta.
 *
 * El proyecto no tiene framework de migraciones y no lo necesita, pero sí
 * necesita poder evolucionar el esquema sin que a nadie se le borre la base
 * de datos al actualizar.
 */
function addColumnIfMissing(
  database: DatabaseSync,
  table: string,
  column: string,
  type: string,
): void {
  const columnas = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columnas.some((c) => c.name === column)) return;

  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  log.info(`Esquema actualizado: ${table}.${column}`);
}

/** Vacía las tablas. Solo para el simulador y los tests. */
export function truncateAll(): void {
  const database = getDb();
  database.exec(
    'DELETE FROM loot; DELETE FROM coleccion; DELETE FROM duelos; DELETE FROM streaks; DELETE FROM consent; DELETE FROM memories; DELETE FROM streams; ' +
      'DELETE FROM ai_usage; DELETE FROM interactions; DELETE FROM users; DELETE FROM titulos; DELETE FROM ajustes; DELETE FROM suscriptores; ' +
      'DELETE FROM temporada_puntos; DELETE FROM salon_fama; DELETE FROM temporadas_cerradas;',
  );
  database.exec('DELETE FROM mmo_world; DELETE FROM mmo_participantes; DELETE FROM mmo_jugadores; DELETE FROM mmo_acciones; DELETE FROM mmo_historial; DELETE FROM mmo_resultados; DELETE FROM mmo_premios; DELETE FROM mmo_expediciones; DELETE FROM mmo_reliquias;');
}

export function nowIso(): string {
  return new Date().toISOString();
}
