import type { PedirObs } from '../transport/obs.js';
import { PREPARABLES } from './obs-setup.js';

type Conexion = <T>(trabajo: (pedir: PedirObs) => Promise<T>) => Promise<T>;
export const EFECTOS_PRUEBA = ['grito', 'pocion', 'maldicion', 'terremoto', 'lag'] as const;
export type EfectoPrueba = typeof EFECTOS_PRUEBA[number];

/** Solo presentación: no ejecuta Actions, canjes, chat ni reglas del Loot. */
export async function probarVisual(
  conectar: Conexion, tipo: EfectoPrueba, escena: string, fuente: string,
  { esperar = (ms: number) => new Promise<void>(r => setTimeout(r, ms)), azar = Math.random } = {},
): Promise<void> {
  if (!EFECTOS_PRUEBA.includes(tipo)) throw Error('Efecto de prueba no válido');
  if (tipo === 'grito') return; // Su prueba es solo el sonido, en el navegador.
  if (!escena || (tipo !== 'pocion' && !fuente)) throw Error('Elige la escena y la fuente del juego en Preparación');
  let restaurar: ((p: PedirObs) => Promise<unknown>) | undefined;
  try {
    await conectar(async pedir => {
      const estado = await pedir<{ outputActive: boolean; outputReconnecting: boolean }>('GetStreamStatus');
      if (estado.outputActive || estado.outputReconnecting) throw Error('Esta prueba es sin emitir. Detén la emisión antes de probar efectos visuales');
      const { sceneItems } = await pedir<{ sceneItems: Array<{ sourceName: string; sceneItemId: number; sceneItemEnabled: boolean }> }>('GetSceneItemList', { sceneName: escena });
      const nombre = tipo === 'pocion' ? PREPARABLES.pocion.nombre : fuente;
      const item = sceneItems.find(x => x.sourceName === nombre);
      if (!item) throw Error(`No está «${nombre}» en «${escena}». Revisa Preparación`);
      const donde = { sceneName: escena, sceneItemId: item.sceneItemId };
      if (tipo === 'pocion') {
        if (item.sceneItemEnabled) throw Error('La Poción ya está visible; espera a que termine');
        restaurar = p => p('SetSceneItemEnabled', { ...donde, sceneItemEnabled: item.sceneItemEnabled });
        await pedir('SetSceneItemEnabled', { ...donde, sceneItemEnabled: true });
        await esperar(5000);
      } else if (tipo === 'maldicion' || tipo === 'lag') {
        const filtro = { sourceName: fuente, filterName: PREPARABLES[tipo].nombre };
        const antes = await pedir<{ filterEnabled: boolean }>('GetSourceFilter', filtro);
        if (antes.filterEnabled) throw Error('El filtro ya está activo; espera a que termine');
        restaurar = p => p('SetSourceFilterEnabled', { ...filtro, filterEnabled: antes.filterEnabled });
        await pedir('SetSourceFilterEnabled', { ...filtro, filterEnabled: true });
        await esperar(tipo === 'maldicion' ? 10000 : 5000);
      } else {
        const { sceneItemTransform: antes } = await pedir<{ sceneItemTransform: { positionX: number; positionY: number } }>('GetSceneItemTransform', donde);
        const posicion = { positionX: antes.positionX, positionY: antes.positionY };
        restaurar = p => p('SetSceneItemTransform', { ...donde, sceneItemTransform: posicion });
        for (let ms = 0; ms < 5000; ms += 40) {
          const fuerza = 16 * Math.min(1, (5000 - ms) / 1700);
          await pedir('SetSceneItemTransform', { ...donde, sceneItemTransform: { positionX: posicion.positionX + (azar() * 2 - 1) * fuerza, positionY: posicion.positionY + (azar() * 2 - 1) * fuerza } });
          await esperar(40);
        }
      }
    });
  } finally {
    // Una conexión nueva permite restaurar también si la anterior se canceló.
    if (restaurar) {
      try { await conectar(restaurar); }
      catch { throw Error('No se pudo restaurar el efecto de prueba en OBS. Revisa la fuente o el filtro antes de emitir'); }
    }
  }
}
