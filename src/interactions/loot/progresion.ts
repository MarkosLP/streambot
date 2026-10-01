import * as lootDb from '../../data/loot.js';
import { probabilidad } from './comandos.js';

/** Lectura del equilibrio actual; no altera probabilidades ni recompensas. */
export function estado() {
  const mochilas = lootDb.mochilas(1000);
  if (!mochilas.length) return { jugadores: 0, masAlto: 0, mediana: 0, masBajo: 0, nuevoContraLider: 0.5 };
  const poderes = mochilas.map((m) => m.poder).sort((a, b) => a - b);
  const mitad = Math.floor(poderes.length / 2);
  const mediana = poderes.length % 2 ? poderes[mitad]! : (poderes[mitad - 1]! + poderes[mitad]!) / 2;
  return {
    jugadores: mochilas.length,
    masAlto: poderes.at(-1)!,
    mediana,
    masBajo: poderes[0]!,
    nuevoContraLider: probabilidad(1, poderes.at(-1)!),
  };
}
