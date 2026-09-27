import * as cooldowns from '../core/cooldowns.js';
import type { Interaction } from '../core/interaction.js';
import * as musica from '../core/musica.js';
import type { CtxComando } from './loot/comandos.js';

/**
 * !cancion (27 sep 2026): qué está sonando en el directo (core/musica.ts).
 * También !musica y !song. Un aviso cada 30 s como mucho, para todos.
 */

export const COMANDO = /^!(canci[oó]n|m[uú]sica|song)\b/i;

export const cancion: Interaction<CtxComando> = {
  name: 'musica-cancion',
  spontaneous: false,
  consulta: true,
  cooldowns: [{ key: () => cooldowns.keys.interaction('musica-cancion'), ms: 30_000, motivo: (_c, f) => `cooldown, faltan ${f}s` }],
  run: () => {
    const m = musica.estado();
    if (!m.sonando || !m.pista) return { text: '🎵 Ahora mismo no suena música.' };
    const quien = m.pista.artista ? ` — ${m.pista.artista}` : '';
    return { text: `🎵 Sonando: ${m.pista.titulo}${quien}. Música libre de derechos para directos.` };
  },
};
