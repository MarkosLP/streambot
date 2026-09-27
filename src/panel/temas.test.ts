import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { configureDatabase, truncateAll } from '../data/db.js';
import * as iaLocal from '../services/ia-local.js';
import * as temas from './temas.js';
import * as escenas from './escenas.js';

/**
 * Temas para hablar: leer RSS de verdad (con sus rarezas), el guion y lo que
 * sale en pantalla. Sin internet ni Ollama: todo de mentira.
 */

const hoy = new Date(Date.now() - 3600_000).toUTCString();
const antiguo = new Date(Date.now() - 10 * 24 * 3600_000).toUTCString();

const RSS = `<?xml version="1.0" encoding="UTF-8"?><rss><channel><title>Medio</title>
<item>
  <title><![CDATA[Anuncian un MMO &amp; más ]]></title>
  <link>https://medio.example/mmo</link>
  <pubDate>${hoy}</pubDate>
  <description><![CDATA[<p><img src="https://img.example/mmo.jpg"></p><p>Un mundo abierto con ciudades&#x20;de jugadores.</p><script>alert(1)</script>]]></description>
</item>
<item>
  <title>Doble escapado</title>
  <link>https://medio.example/doble</link>
  <pubDate>${hoy}</pubDate>
  <description>&lt;ul&gt;&lt;li&gt;Primera l&amp;iacute;nea&lt;/li&gt;&lt;/ul&gt;&lt;a href="x"&gt;Leer la noticia completa&lt;/a&gt;</description>
  <enclosure url="https://img.example/doble.png" type="image/png"/>
</item>
<item><title>Vieja</title><link>https://medio.example/vieja</link><pubDate>${antiguo}</pubDate></item>
<item><title>Sin enlace</title><description>nada</description></item>
<item><title>Enlace raro</title><link>javascript:alert(1)</link></item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
  <title type="html">Descubren un planeta</title>
  <link rel="alternate" href="https://ciencia.example/planeta"/>
  <updated>${new Date().toISOString()}</updated>
  <summary>Un planeta &laquo;raro&raquo;.</summary>
  <media:thumbnail url="https://img.example/planeta.jpg"/>
</entry>
<entry><title>El mismo MMO</title><link href="https://medio.example/mmo"/><updated>${new Date().toISOString()}</updated></entry></feed>`;

before(() => configureDatabase(':memory:'));
after(() => {
  temas.setDescargador(null);
  iaLocal.setGenerador(null);
});
beforeEach(() => {
  truncateAll();
  temas.reset();
  escenas.reset();
  temas.setDescargador(async (url) => {
    if (url.includes('3djuegos')) return RSS;
    if (url.includes('xataka')) return ATOM;
    throw new Error('respondió 503');
  });
});

describe('leer los RSS', () => {
  test('título, enlace, entradilla limpia, imagen y fecha; lo roto fuera', () => {
    const f = temas.FUENTES.find((x) => x.id === '3djuegos')!;
    const ns = temas.leerFeed(RSS, f);
    assert.deepEqual(ns.map((n) => n.titulo), ['Anuncian un MMO & más', 'Doble escapado', 'Vieja'], 'sin enlace o con uno raro, fuera');
    const [mmo, doble] = ns;
    assert.equal(mmo!.resumen, 'Un mundo abierto con ciudades de jugadores.', 'sin HTML, sin script');
    assert.equal(mmo!.imagen, 'https://img.example/mmo.jpg');
    assert.equal(mmo!.categoria, 'juegos');
    assert.match(mmo!.id, /^[0-9a-f]{12}$/);
    assert.equal(doble!.resumen, 'Primera línea', 'HTML escapado dos veces y sin «Leer la noticia completa»');
    assert.equal(doble!.imagen, 'https://img.example/doble.png');
  });

  test('Atom: enlace en href, miniatura y entidades con nombre', () => {
    const f = temas.FUENTES.find((x) => x.id === 'xataka')!;
    const [p] = temas.leerFeed(ATOM, f);
    assert.equal(p!.enlace, 'https://ciencia.example/planeta');
    assert.equal(p!.resumen, 'Un planeta «raro».');
    assert.equal(p!.imagen, 'https://img.example/planeta.jpg');
  });

  test('juntas: sin las viejas, sin repetir enlace, las nuevas primero; un medio caído no rompe nada', async () => {
    const r = await temas.noticias();
    assert.ok(!r.noticias.some((n) => n.titulo === 'Vieja'), 'más de 3 días, fuera');
    assert.equal(r.noticias.filter((n) => n.enlace === 'https://medio.example/mmo').length, 1);
    assert.equal(r.noticias[0]!.titulo, 'Descubren un planeta');
    assert.equal(r.errores.length, temas.FUENTES.length - 2);
    assert.equal(r.errores[0]!.error, 'respondió 503');
  });
});

describe('preparar un tema (IA local)', () => {
  test('resumen, 3 preguntas y encuesta; solo con el titular y la entradilla', async () => {
    let pedido = '';
    iaLocal.setGenerador(async (p) => {
      pedido = `${p.sistema}\n${p.usuario}`;
      return { resumen: '  Un MMO nuevo.  ', preguntas: ['¿Lo jugaríais?', '¿Qué os parece?', '¿Mejor en PC?'], encuesta: { pregunta: '¿Lo probarás?', opciones: ['Sí', 'No', 'Ya veremos'] } };
    });
    const { noticias } = await temas.noticias();
    const n = noticias.find((x) => x.titulo.startsWith('Anuncian'))!;
    const p = await temas.preparar(n);
    assert.equal(p.resumen, 'Un MMO nuevo.');
    assert.equal(p.preguntas.length, 3);
    assert.deepEqual(p.encuesta.opciones, ['Sí', 'No', 'Ya veremos']);
    assert.match(pedido, /no inventes/);
    assert.match(pedido, /Anuncian un MMO/);
    assert.deepEqual(temas.preparadoDe(n.id), p);
  });

  test('si la IA no devuelve nada útil, se dice', async () => {
    iaLocal.setGenerador(async () => ({ resumen: '', preguntas: [] }));
    const { noticias } = await temas.noticias();
    await assert.rejects(temas.preparar(noticias[0]!), iaLocal.ErrorIaLocal);
  });
});

describe('guion y pantalla', () => {
  test('apartar, marcar, mover y quitar; sobrevive a un reinicio', async () => {
    const { noticias } = await temas.noticias();
    const [a, b] = noticias;
    temas.apartar(a!.id);
    temas.apartar(b!.id);
    temas.apartar(a!.id);
    assert.equal(temas.leer().guion.length, 2, 'no se aparta dos veces');
    temas.mover(b!.id, -1);
    assert.deepEqual(temas.leer().guion.map((g) => g.noticia.id), [b!.id, a!.id]);
    temas.marcarHecho(a!.id, true);
    temas.reset();
    assert.equal(temas.leer().guion.length, 2);
    assert.equal(temas.leer().guion[1]!.hecho, true);
    temas.quitar(a!.id);
    assert.equal(temas.leer().guion.length, 1);
    assert.equal(temas.apartar('000000000000'), null, 'una que no existe');
  });

  test('lo apartado se puede preparar aunque ya no esté en la lista de titulares', async () => {
    const { noticias } = await temas.noticias();
    temas.apartar(noticias[0]!.id);
    temas.reset();
    assert.ok(temas.buscar(noticias[0]!.id), 'sale del guion guardado');
  });

  test('en pantalla solo en Charla, con su pregunta; null lo quita', async () => {
    const { noticias } = await temas.noticias();
    temas.ponerEnPantalla(noticias[0]!.id, '¿Qué opináis?');
    assert.deepEqual(escenas.paraOverlay('charla').tema, { titulo: noticias[0]!.titulo, fuente: noticias[0]!.fuente, pregunta: '¿Qué opináis?' });
    assert.equal(escenas.paraOverlay('inicio').tema, null);
    temas.ponerEnPantalla(null);
    assert.equal(escenas.paraOverlay('charla').tema, null);
  });
});
