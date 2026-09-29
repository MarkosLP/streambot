// Recarga la fuente compartida de jefes y duelos tras cambiar su overlay.
// Uso: node --import tsx scripts/actualizar-combate-obs.mjs <version>
import { conObs } from '../src/transport/obs.ts';

const version = process.argv[2];
if (!version || !/^[a-zA-Z0-9._-]+$/.test(version)) throw new Error('Indica una versión sencilla, por ejemplo el hash del commit');

await conObs(async (pedir) => {
  const emision = await pedir('GetStreamStatus');
  if (emision.outputActive) throw new Error('OBS está emitiendo; no se recarga la fuente durante el directo');
  const { inputKind, inputSettings } = await pedir('GetInputSettings', { inputName: 'FX Jefe' });
  const actual = new URL(inputSettings?.url || '');
  if (inputKind !== 'browser_source' || actual.pathname !== '/biblioteca/overlays/jefe.html') throw new Error('FX Jefe no apunta al overlay de combate');
  actual.searchParams.set('v', version);
  await pedir('SetInputSettings', { inputName: 'FX Jefe', inputSettings: { url: actual.href }, overlay: true });
  const comprobado = await pedir('GetInputSettings', { inputName: 'FX Jefe' });
  if (comprobado.inputSettings?.url !== actual.href) throw new Error('OBS no guardó la URL nueva');
  console.log(`FX Jefe (jefes y duelos): ${actual.href}`);
});
