import { config } from '../config.js';

/**
 * Cuentas que son bots, no personas.
 *
 * Se SUMAN a `IGNORED_LOGINS`: aunque cambies esa lista en el .env, estos
 * siguen fuera. Sin ellos, un cofre regalado "a todo el chat" le tocaría a
 * StreamElements o a los bots que se pasean por todos los canales.
 */
export const BOTS_CONOCIDOS = [
  'streamelements',
  'streamlabs',
  'nightbot',
  'moobot',
  'fossabot',
  'sery_bot',
  'wizebot',
  'soundalerts',
  'streamstickers',
  'kofistreambot',
  'blerp',
  'commanderroot',
  'pokemoncommunitygame',
  'tangiabot',
  'frostytoolsdotcom',
  'own3d',
];

export function esBot(login: string): boolean {
  const l = login.replace(/^@/, '').trim().toLowerCase();
  return config.ignoredLogins.includes(l) || BOTS_CONOCIDOS.includes(l);
}
