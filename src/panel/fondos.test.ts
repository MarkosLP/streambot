import { codificar } from '../services/png.js';
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as imagen from '../services/ia-imagen.js';
import * as fondos from './fondos.js';
import * as avatarIa from './avatar-ia.js';
import * as escenas from './escenas.js';
import * as estilos from './estilos.js';
import * as rotulos from './rotulos.js';
import * as biblioteca from './biblioteca.js';
import { configureDatabase, getDb, truncateAll } from '../data/db.js';

/**
 * Fondos y personajes con IA. Con un motor de mentira: ni un céntimo en
 * OpenAI por pasar los tests.
 */

function muestra(editada = false) {
  const px = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { const i = (y * 64 + x) * 4; px[i] = x * 3; px[i+1] = y * 3; px[i+2] = 100; px[i+3] = 255; }
  if (editada) for (let y = 17; y < 21; y++) for (let x = 26; x < 30; x++) { px[(y*64+x)*4] = 255; px[(y*64+x)*4+1] = 0; }
  return codificar(64, 64, px);
}
let dir: string;
let pedidas: Array<{ tipo: string; prompt: string; transparente?: boolean; conBase: boolean; conMascara?: boolean }> = [];
/** Lo que contesta el «modelo que ve» al comprobar una variante (null: no mira). */
let veredicto: { ok: boolean; motivo: string } | null = null;

before(async () => {
  configureDatabase(':memory:');
  dir = await mkdtemp(join(tmpdir(), 'crid4m-fondos-'));
  imagen.setMotor({
    generar: async (p) => { pedidas.push({ tipo: 'generar', prompt: p.prompt, transparente: p.transparente, conBase: false }); return p.transparente ? muestra() : Buffer.from('PNG-generada'); },
    editar: async (p) => { pedidas.push({ tipo: 'editar', prompt: p.prompt, transparente: p.transparente, conBase: p.base.length > 0, conMascara: !!p.mascara }); return muestra(true); },
    localizarCara: async () => ({ ojos: [{ x: .41, y: .3 }, { x: .55, y: .3 }], boca: { x: .48, y: .38 }, anchoOjo: .06 }),
    comprobarVariante: async () => veredicto,
  });
});
after(async () => {
  imagen.setMotor(null);
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  pedidas = [];
  veredicto = { ok: true, motivo: '' };
  truncateAll();
  escenas.reset();
});

describe('fondos con IA', () => {
  test('el prompt lleva el estilo común, lo que pides y la composición de la escena', () => {
    const p = fondos.prompt('charla', 'una biblioteca de mago');
    assert.match(p, /dark fantasy matte painting/);
    assert.match(p, /una biblioteca de mago/);
    assert.match(p, /webcam frame/, 'en Charla deja sitio a la cámara');
    assert.match(fondos.prompt('inicio', ''), /castillo gótico/, 'vacío = la descripción de siempre');
  });

  test('lo que pides va delante del estilo y manda sobre su ambiente', () => {
    // 27 sep: «Giran de día con gente» salió de noche y vacío por el estilo oscuro.
    const p = fondos.prompt('inicio', 'Giran de Lineage 2 de día con gente', 'oscuro', 'Giran city at midday, crowded plaza');
    assert.ok(p.indexOf('Giran city at midday') < p.indexOf('dark fantasy'), 'lo tuyo primero');
    assert.match(p, /has priority/);
    assert.match(p, /Mood only if the scene does not set one/);
    assert.doesNotMatch(p, /no people/);
  });

  test('genera, guarda en imagenes/fondos y aparece en la lista', async () => {
    const ruta = await fondos.generar('inicio', 'un castillo', 'oscuro', dir);
    assert.match(ruta, /^imagenes\/fondos\/oscuro-inicio-.+\.png$/);
    assert.equal(await readFile(join(dir, ruta), 'utf8'), 'PNG-generada');
    const lista = await fondos.lista(dir);
    assert.equal(lista[0]!.ruta, ruta);
    assert.equal(lista[0]!.escena, 'inicio');
    assert.equal(lista[0]!.estilo, 'oscuro');
  });

  test('cada estilo pide su propio arte a la IA', () => {
    assert.match(fondos.prompt('inicio', '', 'alegre'), /anime RPG key art/);
    assert.match(fondos.prompt('inicio', '', 'alegre'), /Islas flotantes/, 'vacío = la descripción del estilo');
    assert.match(fondos.prompt('pausa', 'un río', 'acogedor'), /painterly illustration/);
    assert.match(fondos.prompt('inicio', '', 'alegre'), /Not childish/, 'nada infantil: el 27 sep los primeros lo parecían');
    assert.doesNotMatch(fondos.prompt('inicio', '', 'alegre'), /dark fantasy/);
  });

  test('los nombres dicen estilo y escena; los de antes de los estilos son del oscuro', () => {
    assert.deepEqual(fondos.partes('inicio-2026-09-27T00-30-00.png'), { estilo: 'oscuro', escena: 'inicio' });
    assert.deepEqual(fondos.partes('alegre-charla-2026-09-27T10-00-00.png'), { estilo: 'alegre', escena: 'charla' });
  });

  test('el último fondo de una escena es el de su estilo', async () => {
    const oscuro = await fondos.generar('pausa', '', 'oscuro', dir);
    await new Promise((r) => setTimeout(r, 1100));
    const alegre = await fondos.generar('pausa', '', 'alegre', dir);
    assert.equal(fondos.ultimoDe('pausa', 'oscuro', dir), oscuro);
    assert.equal(fondos.ultimoDe('pausa', 'alegre', dir), alegre);
    assert.equal(fondos.ultimoDe('pausa', 'acogedor', dir), null);
  });

  test('solo se aceptan rutas de la carpeta de fondos', () => {
    assert.equal(fondos.rutaValida('imagenes/fondos/inicio-1.png'), true);
    assert.equal(fondos.rutaValida('imagenes/fondos/../../.env'), false);
    assert.equal(fondos.rutaValida('https://malo.example/x.png'), false);
    assert.equal(fondos.rutaValida('imagenes/otra/x.png'), false);
  });

  test('cambiar el fondo de una escena no borra los de las demás; null lo quita', () => {
    escenas.cambiar({ fondos: { inicio: 'imagenes/fondos/a.png' } });
    escenas.cambiar({ fondos: { pausa: 'imagenes/fondos/b.png', final: '../../x.png' } });
    assert.deepEqual(escenas.leer().fondos, { inicio: 'imagenes/fondos/a.png', pausa: 'imagenes/fondos/b.png' });
    escenas.cambiar({ fondos: { inicio: null } });
    assert.deepEqual(escenas.leer().fondos, { pausa: 'imagenes/fondos/b.png' });
  });
});

describe('personaje del avatar con IA', () => {
  test('cuatro imágenes del mismo personaje: la base y tres variantes editándola, con fondo transparente', async () => {
    const ruta = await avatarIa.generar('', 'oscuro', dir);
    assert.match(ruta, /^imagenes\/avatar\/[\w-]+$/);
    assert.deepEqual((await readdir(join(dir, ruta))).sort(), ['base.png', 'cerrados.png', 'contento.png', 'info.json', 'medio.png'], 'y su nombre al lado');
    assert.equal(pedidas.length, 4);
    assert.ok(pedidas.every((p) => p.transparente), 'todo con fondo transparente');
    assert.equal(pedidas.filter((p) => p.tipo === 'editar' && p.conBase).length, 3, 'las variantes parten de la base');
    assert.equal(pedidas.filter((p) => p.conMascara).length, 3, 'y solo retocan la cara (con máscara)');
    const r = await rotulos.leer(ruta, dir);
    assert.ok(r?.ojos && r.cara, 'las zonas se guardan para el overlay');
    assert.ok(r.ojos.y > .2 && r.ojos.y < .4 && r.ojos.w < .5);
    assert.match(pedidas[0]!.prompt, /errante encapuchado/, 'vacío = el personaje de siempre');
    assert.equal((await avatarIa.lista(dir))[0]!.ruta, ruta);
  });

  test('las variantes no llevan lo del errante: nada de tapar ni oscurecer la cara', async () => {
    // 27 sep: con las del estilo oscuro, al Chico de pelo negro le tapó la cara de negro.
    await avatarIa.generar('un chico de pelo negro', 'oscuro', dir);
    const ediciones = pedidas.filter((p) => p.tipo === 'editar');
    assert.ok(ediciones.every((p) => /Do not darken, shadow, cover/.test(p.prompt)));
    assert.ok(ediciones.every((p) => !/dim lines|crescents/.test(p.prompt)));
    assert.ok(ediciones.some((p) => /HALF closed/.test(p.prompt)), 'y el paso intermedio del parpadeo');
  });

  test('si el modelo que ve dice que una variante está mal, se repite una vez y se avisa', async () => {
    const ruta = await avatarIa.generar('un mago', 'oscuro', dir);
    pedidas = [];
    for (const v of ['medio', 'cerrados', 'contento']) await writeFile(join(dir, ruta, `${v}.png`), Buffer.from('PNG-roto'));
    veredicto = { ok: false, motivo: 'la cara está tapada' };
    const r = await avatarIa.rehacerVariantes(ruta, dir);
    assert.equal(pedidas.filter((p) => p.tipo === 'editar').length, 6, 'tres variantes, cada una dos veces');
    assert.ok(pedidas.filter((_, i) => i % 2 === 1).every((p) => /la cara está tapada/.test(p.prompt)), 'cada segunda dice qué falló');
    assert.deepEqual(r.dudosas.sort(), ['cerrados', 'medio'], 'la sonrisa que no sale se sustituye por los ojos cerrados');
    assert.deepEqual(await readFile(join(dir, ruta, 'contento.png')), await readFile(join(dir, ruta, 'cerrados.png')));
    veredicto = { ok: true, motivo: '' };
    pedidas = [];
    assert.deepEqual((await avatarIa.rehacerVariantes(ruta, dir)).dudosas.sort(), ['cerrados', 'medio'], 'las reservas no se anuncian como reparadas');
    assert.ok(pedidas.length <= 3, 'sin repetir ediciones válidas');
  });

  test('el personaje elegido se guarda, y solo si es una carpeta de avatar', () => {
    assert.equal(escenas.leer().avatarImagen, null, 'sin elegir: el último del estilo, o el errante');
    escenas.cambiar({ avatarImagen: 'imagenes/avatar/otro' });
    assert.equal(escenas.leer().avatarImagen, 'imagenes/avatar/otro');
    escenas.cambiar({ avatarImagen: '../../secretos' });
    assert.equal(escenas.leer().avatarImagen, 'imagenes/avatar/otro');
    escenas.cambiar({ avatarImagen: null });
    assert.equal(escenas.leer().avatarImagen, null, 'null = el último de este estilo');
  });

  test('un personaje de otro estilo pide otro arte y lleva el estilo en la carpeta', async () => {
    const ruta = await avatarIa.generar('', 'alegre', dir);
    assert.match(ruta, /^imagenes\/avatar\/alegre-/);
    assert.match(pedidas[0]!.prompt, /anime/);
    assert.match(pedidas[0]!.prompt, /aventurero joven/);
    assert.equal(avatarIa.ultimoDe('alegre', dir), ruta);
    assert.equal((await avatarIa.lista(dir)).find((p) => p.ruta === ruta)?.estilo, 'alegre');
  });
});

describe('estilos de las escenas', () => {
  test('por defecto, el oscuro', () => {
    assert.equal(escenas.leer().estilo, 'oscuro');
    escenas.cambiar({ estilo: 'rosa-chicle' });
    assert.equal(escenas.leer().estilo, 'oscuro', 'un estilo que no existe no se guarda');
  });

  test('cada estilo guarda sus fondos y su personaje: al volver, vuelve lo suyo', () => {
    escenas.cambiar({ fondos: { inicio: 'imagenes/fondos/oscuro-inicio-1.png' }, avatarImagen: 'imagenes/avatar/errante' });
    escenas.cambiar({ estilo: 'alegre' });
    assert.deepEqual(escenas.leer().fondos, {}, 'el alegre empieza sin fondos elegidos');
    assert.equal(escenas.leer().avatarImagen, null);
    escenas.cambiar({ fondos: { inicio: 'imagenes/fondos/alegre-inicio-1.png' } });
    escenas.cambiar({ estilo: 'oscuro' });
    assert.deepEqual(escenas.leer().fondos, { inicio: 'imagenes/fondos/oscuro-inicio-1.png' });
    assert.equal(escenas.leer().avatarImagen, 'imagenes/avatar/errante');
    escenas.cambiar({ estilo: 'alegre' });
    assert.deepEqual(escenas.leer().fondos, { inicio: 'imagenes/fondos/alegre-inicio-1.png' });
  });

  test('sobrevive a un reinicio', () => {
    escenas.cambiar({ estilo: 'acogedor', fondos: { pausa: 'imagenes/fondos/acogedor-pausa-1.png' } });
    escenas.reset();
    assert.equal(escenas.leer().estilo, 'acogedor');
    assert.deepEqual(escenas.leer().fondos, { pausa: 'imagenes/fondos/acogedor-pausa-1.png' });
  });

  test('lo guardado antes de los estilos pasa al oscuro', () => {
    getDb().prepare("INSERT INTO ajustes (clave, valor, at) VALUES ('escenas', ?, '2026-09-27')")
      .run(JSON.stringify({ titulo: 'Hola', fondos: { final: 'imagenes/fondos/final-1.png' }, avatarImagen: 'imagenes/avatar/errante' }));
    escenas.reset();
    const c = escenas.leer();
    assert.equal(c.estilo, 'oscuro');
    assert.equal(c.titulo, 'Hola');
    assert.deepEqual(c.fondos, { final: 'imagenes/fondos/final-1.png' });
    assert.equal(c.avatarImagen, 'imagenes/avatar/errante');
  });

  test('el overlay recibe el estilo y siempre un personaje pintado, nunca el dibujado', () => {
    escenas.cambiar({ estilo: 'acogedor' });
    const d = escenas.paraOverlay('charla');
    assert.equal(d.config.estilo, 'acogedor');
    assert.match(d.config.avatarImagen, /^imagenes\/avatar\//);
    assert.equal('temas' in d.config, false);
  });
});

describe('estilos propios (el formulario)', () => {
  const cyber = {
    nombre: 'Neón', icono: '🌆', tematica: 'Ciudad cyberpunk de noche con lluvia y neones rosas',
    base: 'oscuro', letra: 'futurista', particulas: 'lluvia',
    colores: { principal: '#FF2BD6', secundario: '#19E6FF', cieloArriba: '#0a0620', cieloAbajo: '#3a0a4a' },
  };

  test('crear uno lo deja elegido, y pide a la IA su temática y sus colores', () => {
    const r = escenas.guardarEstilo(cyber)!;
    assert.match(r.id, /^mi[a-z0-9]+$/);
    assert.equal(r.config.estilo, r.id);
    const p = fondos.prompt('inicio', '', r.id);
    assert.match(p, /cyberpunk/);
    assert.match(p, /#ff2bd6/, 'los colores, en minúsculas');
    assert.doesNotMatch(p, /dark fantasy/);
    assert.equal(estilos.deNombre(`${r.id}-inicio-2026-09-27T10-00-00.png`), r.id);
    assert.deepEqual(fondos.partes(`${r.id}-charla-2026-09-27T10-00-00.png`), { estilo: r.id, escena: 'charla' });
  });

  test('el overlay recibe su aspecto: forma, letra, partículas y colores', () => {
    const { id } = escenas.guardarEstilo(cyber)!;
    const a = escenas.paraOverlay('inicio').config.apariencia;
    assert.deepEqual(a, { base: 'oscuro', letra: 'futurista', particulas: 'lluvia', colores: { principal: '#ff2bd6', secundario: '#19e6ff', cieloArriba: '#0a0620', cieloAbajo: '#3a0a4a' } });
    assert.equal('propios' in escenas.paraOverlay('inicio').config, false);
    escenas.cambiar({ estilo: 'alegre' });
    assert.equal(escenas.paraOverlay('inicio').config.apariencia.colores, null, 'los hechos llevan sus colores en el overlay');
    assert.equal(escenas.cambiar({ estilo: id }).estilo, id, 'se puede volver a elegir');
  });

  test('sin nombre o sin temática no se crea; lo raro toma valores por defecto', () => {
    assert.equal(escenas.guardarEstilo({ nombre: '', tematica: 'algo' }), null);
    assert.equal(escenas.guardarEstilo({ nombre: 'algo' }), null);
    const r = escenas.guardarEstilo({ nombre: 'X', tematica: 'Playa', letra: 'wingdings', colores: { principal: 'rojo' } })!;
    const e = escenas.leer().propios.find((x) => x.id === r.id)!;
    assert.equal(e.letra, 'moderna');
    assert.equal(e.colores.principal, '#ff5fa8');
  });

  test('editar cambia el mismo estilo; sobrevive a un reinicio', () => {
    const { id } = escenas.guardarEstilo(cyber)!;
    escenas.guardarEstilo({ ...cyber, nombre: 'Neón 2' }, id);
    escenas.reset();
    assert.equal(escenas.leer().propios.length, 1);
    assert.equal(escenas.leer().propios[0]!.nombre, 'Neón 2');
    assert.equal(escenas.leer().estilo, id);
    assert.equal(escenas.guardarEstilo(cyber, 'minoexiste'), null, 'no se edita uno que no existe');
  });

  test('borrar el elegido vuelve al oscuro; un estilo borrado ya no se puede elegir', () => {
    const { id } = escenas.guardarEstilo(cyber)!;
    escenas.cambiar({ fondos: { inicio: 'imagenes/fondos/x.png' } });
    const c = escenas.borrarEstilo(id);
    assert.equal(c.estilo, 'oscuro');
    assert.equal(c.propios.length, 0);
    assert.equal(escenas.cambiar({ estilo: id }).estilo, 'oscuro');
  });
});

describe('títulos de fondos y personajes', () => {
  test('sin título, sale de la descripción: la primera frase, sin artículo y corta', () => {
    assert.equal(rotulos.tituloDe('Un cachorro de león amarillo, pequeño y adorable'), 'Cachorro de león amarillo');
    assert.equal(rotulos.tituloDe('La vista más espectacular de este mundo: ciudad cyberpunk'), 'Vista más espectacular de este mundo');
    assert.ok(rotulos.tituloDe('islas flotantes sobre un mar de nubes con cascadas brillantes y criaturas adorables volando').length <= rotulos.LARGO_TITULO);
    assert.equal(rotulos.tituloDe('islas flotantes'), 'Islas flotantes', 'con mayúscula');
  });

  test('un fondo nuevo guarda su título al lado, y la lista lo trae', async () => {
    const con = await fondos.generar('final', 'Un atardecer rosa, con farolillos', 'alegre', dir, 'Mi atardecer');
    const sin = await fondos.generar('charla', 'Una base de aventureros, con plantas', 'alegre', dir);
    const lista = await fondos.lista(dir);
    assert.equal(lista.find((f) => f.ruta === con)?.titulo, 'Mi atardecer');
    assert.equal(lista.find((f) => f.ruta === sin)?.titulo, 'Base de aventureros');
    assert.equal((await rotulos.leer(con, dir))?.descripcion, 'Un atardecer rosa, con farolillos');
  });

  test('un personaje nuevo guarda su nombre; el errante se llama «El errante»', async () => {
    const ruta = await avatarIa.generar('Un cachorro de león amarillo, adorable', 'alegre', dir, '');
    assert.equal(await avatarIa.titulo(ruta, dir), 'Cachorro de león amarillo');
    assert.equal(await avatarIa.titulo('imagenes/avatar/errante', dir), 'El errante');
  });

  test('renombrar cambia el título y deja la descripción; vacío no vale', async () => {
    const ruta = await fondos.generar('pausa', 'Un claro del bosque', 'alegre', dir);
    assert.equal(await rotulos.renombrar(ruta, '  Siesta  ', dir), 'Siesta');
    assert.deepEqual(await rotulos.leer(ruta, dir), { titulo: 'Siesta', descripcion: 'Un claro del bosque' });
    await assert.rejects(rotulos.renombrar(ruta, '   ', dir));
  });

  test('la galería de la Biblioteca enseña el título (y no lista los .json)', async () => {
    const ruta = await fondos.generar('inicio', 'Islas flotantes, cascadas', 'alegre', dir);
    const av = await avatarIa.generar('', 'alegre', dir, 'Leoncito');
    const imgs = (await biblioteca.listar(dir)).imagenes;
    assert.equal(imgs.find((i) => `imagenes/${i.carpeta}/${i.nombre}` === ruta)?.titulo, 'Islas flotantes');
    assert.equal(imgs.find((i) => i.carpeta === av.slice('imagenes/'.length) && i.nombre === 'cerrados.png')?.titulo, 'Leoncito · ojos cerrados');
    assert.ok(!imgs.some((i) => i.nombre.endsWith('.json')));
  });

  test('borrar un fondo o un personaje quita el archivo y su título; el errante no se borra', async () => {
    const f = await fondos.generar('final', 'un faro', 'oscuro', dir);
    const av = await avatarIa.generar('un mago', 'oscuro', dir);
    await fondos.borrar(f, dir);
    await avatarIa.borrar(av, dir);
    assert.ok(!(await fondos.lista(dir)).some((x) => x.ruta === f));
    assert.ok(!(await readdir(join(dir, 'imagenes', 'fondos'))).includes(`${f.split('/').pop()}.json`));
    assert.ok(!(await readdir(join(dir, 'imagenes', 'avatar'))).includes(av.split('/').pop()!));
    await assert.rejects(avatarIa.borrar(avatarIa.ERRANTE, dir), /errante/);
    await assert.rejects(fondos.borrar('imagenes/fondos/../../.env', dir));
  });
});


test('avatar: sin veredicto verificable conserva la base', async () => {
  veredicto = null;
  const ruta = await avatarIa.generar('Prueba sin visión', 'oscuro', dir);
  const base = await readFile(join(dir, ruta, 'base.png'));
  for (const v of ['medio', 'cerrados', 'contento']) assert.deepEqual(await readFile(join(dir, ruta, `${v}.png`)), base);
  assert.equal(pedidas.filter(p=>p.tipo==='editar').length,3,'no repite gasto ante un fallo de validación');
});


test('avatar: copias de la base son reservas, no reparaciones ni nuevos gastos', async () => {
  const ruta = await avatarIa.generar('Reservas', 'oscuro', dir);
  const base=await readFile(join(dir,ruta,'base.png'));
  for(const v of ['medio','cerrados','contento'])await writeFile(join(dir,ruta,`${v}.png`),base);
  pedidas=[];
  const resultado=await avatarIa.rehacerVariantes(ruta,dir);
  assert.deepEqual(resultado.arregladas,[]);
  assert.deepEqual(resultado.rehechas,[]);
  assert.deepEqual(resultado.dudosas.sort(),['cerrados','medio']);
  assert.equal(pedidas.length,0);
});
