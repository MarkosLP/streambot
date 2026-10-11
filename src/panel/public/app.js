// Panel Crid4m. Sin framework: el panel es pequeño y así no hay nada que compilar.
//
// Regla de este archivo: nada que venga del chat se mete con innerHTML.
// Nombres de espectadores, mensajes y líneas de log pueden traer cualquier
// cosa; todo pasa por textContent a través de h().

'use strict';

const INTERVALO_MS = 2000;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function h(tag, attrs = {}, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const hijo of hijos.flat()) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    el.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
  return el;
}

const $ = (id) => document.getElementById(id);

const MAX_IMAGENES = { '/api/escenas/fondo': 1, '/api/escenas/avatar-ia': 7, '/api/escenas/avatar-rehacer': 6 };
async function api(ruta, cuerpo) {
  const maximo = MAX_IMAGENES[ruta];
  if (cuerpo !== undefined && maximo && cuerpo.maxImagenes !== maximo) {
    if (!confirm(`Esta operación puede generar hasta ${maximo} imágenes de pago, incluidos reintentos. También puede realizar llamadas de texto y visión. El importe depende del modelo y la calidad. ¿Autorizas ese máximo?`)) throw new Error('Generación cancelada');
    cuerpo = { ...cuerpo, maxImagenes: maximo };
  }
  const opciones = cuerpo === undefined
    ? {}
    : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Panel': '1' }, body: JSON.stringify(cuerpo) };
  return DirectoRed.consultar(ruta, opciones, cuerpo === undefined ? 10000 : maximo ? 900000 : 180000);
}

let tostadaTimer;
function tostada(texto, error = false) {
  const el = $('tostada');
  el.textContent = texto;
  el.classList.toggle('error', error);
  el.classList.add('ver');
  clearTimeout(tostadaTimer);
  tostadaTimer = setTimeout(() => el.classList.remove('ver'), 3200);
}

function hora(iso) {
  return new Date(iso).toLocaleTimeString('es-ES', { hour12: false });
}

function hace(iso) {
  if (!iso) return '—';
  const seg = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seg < 60) return 'ahora';
  const min = Math.round(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const horas = Math.round(min / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? 'ayer' : `hace ${dias} días`;
}

// Rareza por coste: las mismas que usará el Loot del chat.
function rareza(coste) {
  if (coste >= 5000) return { clase: 'r-legendario', nombre: 'Legendario' };
  if (coste >= 2500) return { clase: 'r-epico', nombre: 'Épico' };
  if (coste >= 750) return { clase: 'r-raro', nombre: 'Raro' };
  return { clase: 'r-comun', nombre: 'Común' };
}

const ICONOS = { grito: '⚔️', pocion: '🧪', maldicion: '💀', terremoto: '🌋', lag: '🐌' };
const icono = (id) => ICONOS[id] || '✨';

const cooldownTexto = (seg) => (seg >= 60 ? `${seg / 60} min` : `${seg} s`);

function fecha(iso) {
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

function duracion(desdeIso) {
  const min = Math.floor((Date.now() - new Date(desdeIso).getTime()) / 60000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

// ---------------------------------------------------------------------------
// Pestañas
// ---------------------------------------------------------------------------

const cargadores = {
  escenas: cargarEscenas,
  overlays: () => { cargarOverlays(); cargarEscenasObs(); },
  musica: () => { cargarMusica(); cargarMusicaObs(); },
  temas: () => cargarTemas(),
  directo: () => cargarResumen(),
  efectos: () => { cargarEfectos(); cargarObs(); },
  biblioteca: cargarBiblioteca,
  ajustes: cargarAjustes,
  titulos: cargarTitulos,
  loot: cargarLoot,
  interacciones: cargarInteracciones,
  espectadores: cargarEspectadores,
  mundo: () => cargarMundo(),
};

function irA(tab) {
  DirectoRed.cancelarLecturas();
  for (const b of document.querySelectorAll('.pestanas button')) {
    b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    b.tabIndex = b.dataset.tab === tab ? 0 : -1;
  }
  for (const v of document.querySelectorAll('.vista')) v.hidden = v.id !== `v-${tab}`;
  try { localStorage.setItem('panel-tab', tab); } catch { /* sin almacenamiento, da igual */ }
  // "#/efectos" y no "#efectos": hay elementos con esos ids y el navegador saltaría a ellos.
  if (location.hash !== `#/${tab}`) history.replaceState(null, '', `#/${tab}`);
  cargadores[tab]?.();
  pintarMini();
}

// Los apartados plegables (Pruebas, Referencia…) recuerdan si los dejaste abiertos.
for (const d of document.querySelectorAll('details[data-recordar]')) {
  try { d.open = localStorage.getItem(`plegado-${d.id}`) === '1'; } catch { /* sin almacenamiento */ }
  d.addEventListener('toggle', () => { try { localStorage.setItem(`plegado-${d.id}`, d.open ? '1' : '0'); } catch { /* da igual */ } });
}

document.querySelector('.pestanas').addEventListener('click', (e) => {
  const tab = e.target.closest('button')?.dataset.tab;
  if (tab) irA(tab);
});
// 28 sep 2026: un único tabulador en el menú; flechas, Inicio y Fin entre secciones.
const pestanas = [...document.querySelectorAll('.pestanas button')];
for (const b of pestanas) {
  b.id = `tab-${b.dataset.tab}`;
  b.setAttribute('aria-controls', `v-${b.dataset.tab}`);
  const vista = $(`v-${b.dataset.tab}`);
  vista.setAttribute('role', 'tabpanel');
  vista.setAttribute('aria-labelledby', b.id);
  vista.tabIndex = 0;
}
const menuEstrecho = matchMedia('(max-width: 820px)');
const orientarMenu = () => document.querySelector('.pestanas').setAttribute('aria-orientation', menuEstrecho.matches ? 'horizontal' : 'vertical');
menuEstrecho.addEventListener('change', orientarMenu);
orientarMenu();
document.querySelector('.pestanas').addEventListener('keydown', (e) => {
  const actual = pestanas.indexOf(e.target.closest('button'));
  if (actual < 0) return;
  const avance = menuEstrecho.matches ? 'ArrowRight' : 'ArrowDown';
  const retroceso = menuEstrecho.matches ? 'ArrowLeft' : 'ArrowUp';
  const destino = e.key === 'Home' ? 0 : e.key === 'End' ? pestanas.length - 1
    : e.key === avance ? (actual + 1) % pestanas.length : e.key === retroceso ? (actual + pestanas.length - 1) % pestanas.length : null;
  if (destino === null) return;
  e.preventDefault();
  irA(pestanas[destino].dataset.tab);
  pestanas[destino].focus();
});
document.addEventListener('click', (e) => {
  const destino = e.target.closest('[data-ir]')?.dataset.ir;
  if (destino) irA(destino);
});

// ---------------------------------------------------------------------------
// Estado general (se refresca solo)
// ---------------------------------------------------------------------------

let ultimoLog = 0;
const lineas = [];
let estado = null;

async function refrescar() {
  try {
    estado = await api(`/api/estado?log=${ultimoLog}`);
    $('sin-bot').hidden = true;
    pintarCabecera(estado);
    pintarFichas(estado);
    pintarAjustes(estado.bot);
    pintarGasto(estado.gasto, estado.bot.modelo);
    pintarPendientes(estado.pendientes);
    anadirLog(estado.log);
  } catch (error) {
    if (error.name === 'AbortError') return;
    $('sin-bot').hidden = false;
    const sb = $('p-sb');
    sb.className = 'estado mal';
    sb.textContent = 'Bot sin conexión';
    ficha('s-bot', 'mal', 'Sin conexión', '¿Está en marcha npm start?');
  }
}

function pintarCabecera({ bot, streamerbot, directo }) {
  const sb = $('p-sb');
  sb.className = `estado ${streamerbot.conectado ? 'ok' : 'mal'}`;
  sb.textContent = streamerbot.conectado ? (streamerbot.version || 'Streamer.bot') : 'Streamer.bot desconectado';
  sb.title = streamerbot.destino;

  const d = $('p-directo');
  d.className = `estado ${directo ? 'vivo' : ''}`;
  d.textContent = directo ? `En directo · ${duracion(directo.desde)}` : 'Sin directo';

  const dry = $('p-dry');
  dry.hidden = !bot.dryRun;
  dry.className = 'estado aviso';
  dry.title = 'DRY_RUN: no se envía nada a Twitch';

  const btn = $('interruptor');
  btn.className = `interruptor ${bot.interruptor ? 'on' : 'off'}`;
  btn.querySelector('.interruptor-texto').textContent = bot.interruptor ? 'Apagar el bot' : 'Encender el bot';
  btn.title = bot.interruptorDetalle;
}

function ficha(id, clase, valor, sub = '') {
  const el = $(id);
  el.className = `stat ${clase}`;
  el.querySelector('.stat-valor').textContent = valor;
  el.querySelector('.stat-sub').textContent = sub;
}

function pintarFichas({ bot, streamerbot, directo, gasto }) {
  ficha('s-bot', bot.interruptor ? 'ok' : 'mal', bot.interruptor ? 'Activo' : 'Apagado',
    bot.dryRun ? 'DRY RUN: no sale nada a Twitch' : bot.revision ? 'Con modo revisión' : 'Publica sin revisión');
  ficha('s-directo', directo ? 'vivo' : '', directo ? duracion(directo.desde) : 'Offline',
    directo ? `Desde las ${hora(directo.desde).slice(0, 5)}` : 'Sin directo en marcha');
  ficha('s-sb', streamerbot.conectado ? 'ok' : 'mal', streamerbot.conectado ? 'Conectado' : 'Desconectado',
    streamerbot.conectado ? (streamerbot.version || streamerbot.destino) : streamerbot.destino);
  ficha('s-ia', 'oro', usd(gasto.today.spentUsd),
    `${gasto.today.calls} de ${gasto.maxCallsPerDay} llamadas · tope $${gasto.budgetTodayUsd}`);
}

$('interruptor').addEventListener('click', async () => {
  if (!estado) return;
  const encender = !estado.bot.interruptor;
  try {
    await api('/api/interruptor', { encendido: encender });
    tostada(encender ? 'Bot encendido' : 'Bot apagado: no saldrá nada al chat');
    refrescar();
  } catch (err) {
    tostada(err.message, true);
  }
});

// Los interruptores viven ahora en la pestaña Ajustes (y se guardan).
function pintarAjustes() {}

// ---------------------------------------------------------------------------
// Inicio: acciones rápidas
// ---------------------------------------------------------------------------

async function pintarLootInicio() {
  try {
    const d = await api('/api/loot');
    const partes = [
      d.jefe ? `🐉 ${d.jefe.nombre}: ${d.jefe.vida}/${d.jefe.vidaMax}` : null,
      d.enElSuelo ? `⚔️ cofre de guerra en el suelo` : null,
      !d.activo ? 'Loot apagado' : !d.directo ? 'Sin directo: no caen cofres solos' : d.proximoEnSeg !== null ? `Próximo cofre en ${mmss(d.proximoEnSeg)}` : null,
      `${(d.enElChat || []).length} en el chat`,
    ].filter(Boolean);
    $('i-loot').textContent = partes.join(' · ');
    $('i-mision').textContent = d.mision?.completada ? `🎯 ${d.mision.nombre}: completada` : d.mision?.activa ? `🎯 ${d.mision.nombre}: ${d.mision.progreso}/${d.mision.meta}` : '🎯 Misión del directo apagada';
    $('i-jefe').disabled = Boolean(d.jefe);
  } catch { /* sin bot: ya lo dice el aviso de arriba */ }
}

for (const [id, ruta, cuerpo, texto] of [
  ['i-jefe', '/api/loot/jefe', { accion: 'invocar' }, (r) => `🐉 ${r.nombre} aparece con ${r.vida} de vida`],
  ['i-regalo', '/api/loot/regalar', { tipo: 'cofre' }, (r) => `🎁 Cofre para ${r.reparto.length}`],
  ['i-soltar', '/api/loot/soltar', {}, (r) => `🎁 Cofre para ${r.reparto.length}`],
]) {
  $(id).addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      tostada(texto(await api(ruta, cuerpo)));
    } catch (err) {
      tostada(err.message, true);
    } finally {
      b.disabled = false;
      pintarLootInicio();
    }
  });
}
DirectoRed.sondear(() => { if (!$('v-directo').hidden) return pintarLootInicio(); }, 5000, false);
pintarLootInicio();

// ---------------------------------------------------------------------------
// Inicio: revisión previa
// ---------------------------------------------------------------------------

const NIVEL_PREVIA = { ok: '✅', aviso: '⚠️', fallo: '❌' };
const plural = (n, palabra) => `${n} ${palabra}${n === 1 ? '' : 's'}`;

$('previa-lanzar').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  b.disabled = true;
  b.textContent = 'Comprobando…';
  try {
    const lista = await api('/api/previa');
    const fallos = lista.filter((c) => c.nivel === 'fallo').length;
    const avisos = lista.filter((c) => c.nivel === 'aviso').length;
    $('previa-nota').textContent = fallos
      ? `❌ ${plural(fallos, 'cosa')} por arreglar${avisos ? ` y ${plural(avisos, 'aviso')}` : ''}`
      : avisos ? `Todo listo, con ${plural(avisos, 'aviso')}` : '✅ Todo listo para empezar';
    $('previa-nota').className = `nota ${fallos ? 'mal' : avisos ? 'regular' : 'bien'}`;
    $('previa-lista').hidden = false;
    let grupo = null;
    $('previa-lista').replaceChildren(...lista.flatMap((c) => {
      const cabeza = c.grupo !== grupo ? [h('li', { class: 'previa-grupo' }, (grupo = c.grupo))] : [];
      return [...cabeza, h('li', { class: `previa-${c.nivel}` },
        h('span', { class: 'previa-icono', 'aria-hidden': 'true' }, NIVEL_PREVIA[c.nivel]),
        h('strong', {}, c.nombre),
        h('span', { class: 'previa-detalle' }, c.detalle))];
    }));
  } catch (err) {
    tostada(err.message === 'no existe' ? 'Reinicia el bot para usar la revisión previa' : err.message, true);
  } finally {
    b.disabled = false;
    b.textContent = 'Comprobar otra vez';
  }
});

// ---------------------------------------------------------------------------
// Inicio: resumen del directo
// ---------------------------------------------------------------------------

let resumenElegido = '';

function fechaDirecto(iso) {
  return new Date(iso).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function minutosTexto(min) {
  return min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min` : `${min} min`;
}

async function cargarResumen() {
  let d;
  try {
    d = await api(`/api/resumen${resumenElegido ? `?id=${resumenElegido}` : ''}`);
  } catch {
    $('resumen-cuerpo').replaceChildren(h('p', { class: 'nota' }, 'Reinicia el bot para ver el resumen del directo.'));
    return;
  }
  const sel = $('resumen-directo');
  if (document.activeElement !== sel) {
    sel.replaceChildren(...d.directos.map((x) => h('option', { value: String(x.id), selected: String(x.id) === String(d.resumen?.id) },
      `${fechaDirecto(x.desde)}${x.hasta ? '' : ' · en curso'}`)));
  }
  const r = d.resumen;
  if (!r) {
    $('resumen-cuerpo').replaceChildren(h('p', { class: 'nota' }, 'Aún no hay ningún directo registrado. Se marca solo cuando OBS empieza a emitir.'));
    return;
  }

  const cifra = (valor, etiqueta, sub) => h('div', { class: 'cifra' }, h('strong', {}, String(valor)), h('span', {}, etiqueta), sub ? h('small', {}, sub) : null);
  const cofres = r.loot.cofres.reduce((n, c) => n + c.n, 0) + r.loot.cofresTesoro;
  const nuevos = r.personas.nuevos.length;
  const lista = (titulo, filas, vacio) => h('div', { class: 'resumen-lista' },
    h('h3', { class: 'subtitulo' }, titulo),
    filas.length ? h('ol', {}, filas) : h('p', { class: 'nota' }, vacio));

  $('resumen-cuerpo').replaceChildren(
    h('div', { class: 'cifras' },
      cifra(minutosTexto(r.minutos), r.enCurso ? 'en curso' : 'de directo', fechaDirecto(r.desde)),
      cifra(r.personas.total, r.personas.total === 1 ? 'persona' : 'personas', nuevos ? `${nuevos} nueva${nuevos === 1 ? '' : 's'}` : null),
      cifra(r.mensajes.enviados, 'mensajes del bot', r.mensajes.bloqueados ? `${r.mensajes.bloqueados} sin salir` : 'ninguno bloqueado'),
      cifra(cofres, cofres === 1 ? 'cofre' : 'cofres', r.loot.cofresTesoro ? `${r.loot.cofresTesoro} del tesoro` : null),
      cifra(r.jefes.derrotados, r.jefes.derrotados === 1 ? 'jefe derrotado' : 'jefes derrotados',
        r.jefes.aparecen ? `de ${r.jefes.aparecen}${r.jefes.escapan ? ` · ${r.jefes.escapan} huyeron` : ''}` : null),
      cifra(r.duelos, r.duelos === 1 ? 'duelo' : 'duelos')),
    h('div', { class: 'resumen-cols' },
      lista('Lo más usado', r.usos.map((u) => h('li', {}, h('span', {}, u.que), h('span', { class: 'dato' }, String(u.n)))), 'Nada todavía.'),
      lista('Lo que no salió', [
        ...r.bloqueos.map((b) => h('li', { class: 'mal' }, h('span', {}, b.motivo), h('span', { class: 'dato' }, String(b.n)))),
        ...(r.bloqueosPor.length ? [h('li', { class: 'nota' }, `Sobre todo: ${r.bloqueosPor.map((b) => `${b.que} (${b.n})`).join(', ')}`)] : []),
      ], '✅ Todo lo que el bot quiso decir, salió.'),
      lista('Botín destacado', r.loot.destacados.map((b) => h('li', {}, pildoraBotin(b), h('span', { class: 'quien' }, b.quien))), 'Ningún épico ni legendario.'),
      lista(`Quién vino (${r.personas.total})`, r.personas.nombres.map((n) => {
        const nuevo = r.personas.nuevos.includes(n);
        return h('li', { class: nuevo ? 'nuevo' : null }, h('span', {}, n), nuevo ? h('span', { class: 'dato' }, 'nuevo') : null);
      }), 'Nadie escribió.')));
}

$('resumen-directo').addEventListener('change', (e) => {
  resumenElegido = e.target.value;
  cargarResumen();
});
DirectoRed.sondear(() => { if (!$('v-directo').hidden && !resumenElegido) return cargarResumen(); }, 60_000, false);
cargarResumen();

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------

const AJUSTES = [
  ['loot', 'Loot del chat', 'Cofres cada 20-30 min, jefes, duelos… Apagado, no cae nada solo.'],
  ['canalJuega', 'Yo también juego', 'Recibes cofres, botín del jefe y regalos como uno más del chat.'],
  ['espontaneas', 'Interacciones espontáneas', 'El bot habla sin que le invoquen: saludos, rachas, vueltas, continuará.'],
  ['revision', 'Modo revisión', 'Lo que escribe la IA espera tu aprobación antes de salir.'],
];

async function cargarAjustes() {
  let d;
  try {
    d = await api('/api/ajustes');
  } catch (err) {
    tostada(err.message === 'no existe' ? 'Reinicia el bot para ver Ajustes (Ctrl+C y npm start)' : err.message, true);
    return;
  }
  $('aj-lista').replaceChildren(...AJUSTES.map(([clave, titulo, ayuda]) => {
    const a = d.ajustes[clave];
    const input = h('input', { type: 'checkbox', class: 'toggle', checked: a.valor });
    input.addEventListener('change', async () => {
      try {
        await api('/api/ajustes', { [clave]: input.checked });
        tostada(`${titulo}: ${input.checked ? 'sí' : 'no'} (guardado)`);
        cargarAjustes();
      } catch (err) {
        input.checked = !input.checked;
        tostada(err.message, true);
      }
    });
    return h('label', { class: 'ajuste' },
      h('span', {},
        h('strong', {}, titulo,
          a.guardado
            ? h('span', { class: 'chip ok origen', title: `En el .env: ${a.env ? 'sí' : 'no'}` }, 'guardado')
            : h('span', { class: 'chip origen' }, 'del .env')),
        h('small', {}, ayuda)),
      input);
  }));
  const i = d.info;
  const fila = (k, v) => [h('dt', {}, k), h('dd', {}, v)];
  $('aj-info').replaceChildren(
    ...fila('Mensajes del bot solo', `${i.mensajesPorHora} por hora`),
    ...fila('Respuestas a comandos', `${i.respuestasPorHora} por hora`),
    ...fila('Cofres automáticos', `cada ${i.minutosCofre} min`),
    ...fila('Fuente del juego', i.fuenteJuego),
    ...fila('OBS', i.obs),
    ...fila('IA del chat', i.modeloClaude),
    ...fila('IA local', i.iaLocal.disponible ? i.iaLocal.modelo : `${i.iaLocal.modelo} (apagada)`),
  );
}

$('aj-env').addEventListener('click', async () => {
  if (!confirm('¿Volver a lo que dice el .env? Se olvida lo que has cambiado aquí.')) return;
  try {
    await api('/api/ajustes', { volverAlEnv: true });
    tostada('Ajustes devueltos a lo del .env');
    cargarAjustes();
  } catch (err) { tostada(err.message, true); }
});

$('aj-lab').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  b.disabled = true;
  $('aj-lab-resultado').replaceChildren(h('p', { class: 'pensando' }, 'Simulando el chat…'));
  try {
    const r = await api('/api/laboratorio', {});
    const malas = r.resultados.filter((p) => p.fallos.length);
    $('aj-lab-resultado').replaceChildren(
      h('p', { class: `lab-resumen ${malas.length ? 'mal' : 'ok'}` },
        `${malas.length ? '✘' : '✔'} ${r.resultados.length - malas.length}/${r.resultados.length} pruebas bien · ${r.eventos} eventos · semilla ${r.semilla}`),
      ...r.resultados.map((p) => h('div', { class: 'lab-prueba' },
        h('strong', { class: p.fallos.length ? 'mal' : '' }, `${p.fallos.length ? '✘' : '✔'} ${p.nombre}`),
        ...p.fallos.map((f) => h('span', {}, `✘ ${f}`)),
        h('span', { class: 'nota' }, p.notas.join(' · ')))),
    );
  } catch (err) {
    $('aj-lab-resultado').replaceChildren(h('p', { class: 'aviso' }, err.message));
  } finally {
    b.disabled = false;
  }
});

function barra(etiqueta, valor, tope, texto) {
  const pct = tope > 0 ? Math.min(100, (valor / tope) * 100) : 0;
  const nivel = pct >= 90 ? 'alto' : pct >= 60 ? 'medio' : '';
  return h('div', { class: 'barra' },
    h('div', { class: 'etiquetas' }, h('span', {}, etiqueta), h('span', {}, texto)),
    h('div', { class: 'pista' }, h('div', { class: `relleno ${nivel}`, style: `width:${pct}%` })),
  );
}

const usd = (n) => `$${n.toFixed(n < 1 ? 3 : 2)}`;

function pintarGasto(g, modelo) {
  $('modelo').textContent = modelo;
  $('gasto').replaceChildren(
    barra('Esta sesión', g.spentUsd, g.budgetUsd, `${usd(g.spentUsd)} de $${g.budgetUsd}`),
    barra('Hoy', g.today.spentUsd, g.budgetTodayUsd, `${usd(g.today.spentUsd)} de $${g.budgetTodayUsd}`),
    barra('Llamadas hoy', g.today.calls, g.maxCallsPerDay, `${g.today.calls} de ${g.maxCallsPerDay}`),
    barra('Este mes', g.month.spentUsd, g.budgetMonthUsd, `${usd(g.month.spentUsd)} de $${g.budgetMonthUsd}`),
  );
}

function pintarPendientes(pendientes) {
  $('t-revision').hidden = pendientes.length === 0;
  document.title = pendientes.length ? `(${pendientes.length}) Panel Crid4m` : 'Panel Crid4m';

  $('pendientes').replaceChildren(...pendientes.map((p) => {
    const quedan = Math.max(0, Math.round((new Date(p.caduca).getTime() - Date.now()) / 1000));
    const decidir = async (aprobar) => {
      try {
        await api(`/api/revision/${p.id}`, { aprobar });
        tostada(aprobar ? 'Aprobado: se publica' : 'Rechazado');
        refrescar();
      } catch (err) {
        tostada(err.message, true);
      }
    };
    return h('div', { class: 'pendiente' },
      h('strong', {}, p.reason),
      h('blockquote', {}, p.text),
      h('div', { class: 'fila' },
        h('button', { class: 'boton ok', type: 'button', onclick: () => decidir(true) }, 'Publicar'),
        h('button', { class: 'boton peligro', type: 'button', onclick: () => decidir(false) }, 'Descartar'),
        h('span', { class: 'nota' }, `Se descarta sola en ${quedan} s`),
      ),
    );
  }));
}

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

const nivelesVisibles = () =>
  new Set([...document.querySelectorAll('#filtros input:checked')].map((i) => i.value));

// Un mensaje de varias líneas llega como varias entradas con la misma hora:
// se pintan juntas, con la hora solo en la primera.
function lineasLog(lista) {
  let anterior = null;
  return lista.map((l) => {
    const t = hora(l.at);
    const sigue = anterior && anterior.t === t && anterior.level === l.level;
    anterior = { t, level: l.level };
    return h('li', { class: `${l.level} ${sigue ? 'sigue' : 'nuevo-grupo'}` },
      h('time', {}, t), h('span', { class: 'msg' }, l.msg));
  });
}

/**
 * La Actividad de Inicio, en cristiano (27 sep): el registro dice
 * «<viewer.message> Pepe: hola  (mod, sub)» o «[ENVIADO · loot] …»; aquí sale
 * «💬 Pepe: hola» y «🤖 …». Lo que el bot escribe vuelve por el chat con tu
 * nombre: esa copia no se repite. Los cooldowns, fuera. El Registro sigue
 * teniéndolo todo tal cual.
 */
const ICONOS_EVENTO = {
  'viewer.message': '💬', 'viewer.follow': '❤️', 'viewer.sub': '💜', 'viewer.giftsub': '🎁', 'viewer.giftbomb': '🎁',
  'viewer.cheer': '💎', 'viewer.redeem': '🪙', 'channel.raid': '⚔️', 'stream.online': '🔴', 'stream.offline': '⏹️', 'chat.moderacion': '🛡️',
};
function actividad(lista) {
  const enviados = new Set();
  const salida = [];
  for (const l of lista) {
    if (/: cooldown, faltan/.test(l.msg)) continue;
    const env = /^\[ENVIADO · [^\]]*\] ([\s\S]*)$/.exec(l.msg);
    if (env) {
      enviados.add(env[1].trim());
      salida.push({ at: l.at, clase: 'bot', icono: '🤖', partes: [env[1]] });
      continue;
    }
    const ev = /^<([a-z.]+)> ([\s\S]*)$/.exec(l.msg);
    if (ev) {
      if (ev[1] === 'viewer.message') {
        const m = /^([^:]+): ([\s\S]*?)(?:  \(([^)]*)\))?$/.exec(ev[2]);
        if (!m) continue;
        if (enviados.has(m[2].trim())) continue; // el eco de lo que acaba de decir el bot
        salida.push({ at: l.at, clase: 'chat', icono: m[3]?.includes('PRIMER MENSAJE') ? '👋' : '💬', partes: [h('strong', {}, m[1]), `: ${m[2]}`] });
      } else {
        salida.push({ at: l.at, clase: 'evento', icono: ICONOS_EVENTO[ev[1]] ?? '•', partes: [ev[2]] });
      }
      continue;
    }
    salida.push({ at: l.at, clase: l.level, icono: l.level === 'error' ? '⛔' : l.level === 'warn' ? '⚠️' : '·', partes: [l.msg] });
  }
  return salida;
}

function anadirLog(nuevas) {
  if (!nuevas.length) return;
  ultimoLog = nuevas[nuevas.length - 1].n;
  lineas.push(...nuevas);
  if (lineas.length > 300) lineas.splice(0, lineas.length - 300);
  pintarLog();
}

function pintarLog() {
  const visibles = nivelesVisibles();
  const log = $('log');
  const abajo = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.replaceChildren(...lineasLog(lineas.filter((l) => visibles.has(l.level))));
  if (abajo) log.scrollTop = log.scrollHeight;

  const corto = $('log-corto');
  const recientes = actividad(lineas.filter((l) => l.level !== 'debug')).slice(-18);
  corto.replaceChildren(...(recientes.length
    ? recientes.map((a) => h('li', { class: `act ${a.clase}` }, h('time', {}, hora(a.at)), h('span', { class: 'act-icono', 'aria-hidden': 'true' }, a.icono), h('span', { class: 'msg' }, ...a.partes)))
    : [h('li', { class: 'log-vacio' }, 'Todavía no ha pasado nada.')]));
  corto.scrollTop = corto.scrollHeight;
}

$('filtros').addEventListener('change', pintarLog);

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

$('f-chat').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('chat-texto');
  const texto = input.value.trim();
  if (!texto) return;
  const resultado = $('chat-resultado');
  try {
    const r = await api('/api/chat', { texto });
    input.value = '';
    resultado.textContent = r.dryRun ? 'Simulado (DRY_RUN): no ha llegado a Twitch.' : 'Enviado.';
  } catch (err) {
    resultado.textContent = err.message;
  }
});

// ---------------------------------------------------------------------------
// Efectos
// ---------------------------------------------------------------------------

let pruebaEfectoActiva = false;
async function cargarEfectos() {
  if (pruebaEfectoActiva) return;
  try {
    const datos = await api('/api/efectos');
    $('efectos-sin-sb').hidden = datos.conectado;
    $('efectos').replaceChildren(...datos.efectos.map(tarjetaEfecto));
    pintarBotonera(datos);
    datosEfectos = datos;
    pintarImportar();
    // #/efectos/grito abre directamente la guía de ese efecto.
    if (guiaPendiente) {
      const e = datos.efectos.find((x) => x.id === guiaPendiente);
      guiaPendiente = null;
      if (e) abrirGuia(e);
    }

    $('efectos-extra').replaceChildren(
      ...(datos.extra.length
        ? [h('article', { class: 'tarjeta' },
            h('header', {}, h('h2', {}, 'Otros efectos tuyos'), h('span', { class: 'nota' }, `Actions que empiezan por «${datos.prefijo}»`)),
            h('div', { class: 'efectos' }, datos.extra.map((a) =>
              h('div', { class: 'efecto' },
                h('div', { class: 'efecto-cabeza' }, h('span', { class: 'icono' }, '✨'), h('div', {}, h('h3', {}, a.name.slice(datos.prefijo.length)))),
                h('div', { class: 'efecto-cuerpo' }, h('div', { class: 'pie' }, botonProbar(a.id, a.enabled))),
              ))),
          )]
        : []),
    );
  } catch (err) {
    tostada(err.message, true);
  }
}

/** Lanza la Action y, si es un efecto, el bot lo recibe como un canje tuyo. Devuelve el aviso, si lo hay. */
async function lanzar(accionId) {
  const r = await api(`/api/acciones/${accionId}/ejecutar`, {});
  return r?.aviso ?? null;
}

function pintarBotonera(datos) {
  const botones = datos.efectos.map((e) => {
    const r = rareza(e.coste);
    const montado = Boolean(e.accionId);
    const el = h('button', {
      class: `boton-fx ${r.clase} ${montado ? '' : 'no-montado'}`,
      type: 'button',
      disabled: montado && !e.habilitada,
      title: montado ? `${e.queHace} Lo lanza como si lo canjearas tú, sin gastar puntos.` : 'Todavía no está montado en Streamer.bot. Pulsa para ver cómo.',
      onclick: async () => {
        if (!montado) {
          irA('efectos');
          return abrirGuia(e);
        }
        try {
          const aviso = await lanzar(e.accionId);
          el.classList.remove('lanzado');
          void el.offsetWidth; // reinicia la animación
          el.classList.add('lanzado');
          tostada(aviso ?? `${icono(e.id)} ${e.recompensa} lanzado`, Boolean(aviso));
        } catch (err) {
          tostada(err.message, true);
        }
      },
    },
      h('span', { class: 'icono' }, icono(e.id)),
      e.montado === false && h('span', { class: 'falta' }, 'Por montar'),
      h('span', { class: 'nombre' }, e.recompensa),
      h('span', { class: 'linea' },
        h('span', { class: 'rareza' }, r.nombre),
        h('span', { class: 'coste' }, `🪙 ${e.coste.toLocaleString('es-ES')}`)),
    );
    return el;
  });

  const extra = datos.extra.map((a) => h('button', {
    class: 'boton-fx r-comun',
    type: 'button',
    disabled: !a.enabled,
    onclick: async () => {
      try {
        await lanzar(a.id);
        tostada(`${a.name.slice(datos.prefijo.length)} lanzado`);
      } catch (err) {
        tostada(err.message, true);
      }
    },
  },
    h('span', { class: 'icono' }, '✨'),
    h('span', { class: 'nombre' }, a.name.slice(datos.prefijo.length)),
    h('span', { class: 'linea' }, h('span', { class: 'rareza' }, 'Tuyo')),
  ));

  $('botonera').replaceChildren(...botones, ...extra);
  $('botonera-nota').textContent = datos.conectado
    ? 'Lanza los efectos sin gastar puntos'
    : 'Streamer.bot desconectado: no se pueden lanzar';
  $('botonera-nota').classList.toggle('mal', !datos.conectado);
}

function botonProbar(accionId, habilitada = true) {
  return h('button', {
    class: 'boton primario',
    type: 'button',
    disabled: !accionId || !habilitada,
    title: !accionId ? 'Todavía no existe en Streamer.bot' : !habilitada ? 'La Action está desactivada en Streamer.bot' : 'Lo lanza como si lo canjearas tú, sin gastar puntos',
    onclick: async () => {
      try {
        const aviso = await lanzar(accionId);
        tostada(aviso ?? 'Efecto lanzado', Boolean(aviso));
      } catch (err) {
        tostada(err.message, true);
      }
    },
  }, 'Lanzar efecto real');
}

function botonPruebaSinDirecto(e) {
  return h('button', {
    type: 'button', class: 'boton primario', 'data-prueba-efecto': e.id,
    onclick: async () => {
      if (pruebaEfectoActiva) return;
      if (e.id !== 'grito' && (!obsElegido.escena || (e.id !== 'pocion' && !obsElegido.fuente))) {
        $('preparacion-efectos').open = true;
        $('obs-prep').scrollIntoView({ block: 'center' });
        return tostada('Elige la escena y la fuente en Preparación. No necesitas estar en directo.', true);
      }
      pruebaEfectoActiva = true;
      document.querySelectorAll('[data-prueba-efecto]').forEach(b => { b.disabled = true; });
      const estado = $('fx-prueba-estado');
      estado.textContent = `Probando ${e.recompensa}${e.id === 'grito' ? '' : ` en «${obsElegido.escena}»`}. Sonido en este navegador; sin canje ni cambios en el Loot.`;
      const sonido = e.material.find(m => m.id.startsWith('sonidos/'));
      let audio, avisoSonido = '';
      try {
        if (sonido?.archivo) {
          audio = new Audio(sonido.archivo.url); audio.volume = .5;
          await audio.play().catch(() => { avisoSonido = ' No se pudo reproducir el sonido en el navegador.'; });
        } else avisoSonido = ' Falta el archivo de sonido.';
        const r = await api('/api/efectos/prueba', { efecto: e.id, escena: obsElegido.escena, fuente: obsElegido.fuente });
        if (e.id === 'grito' && audio && !avisoSonido) await new Promise(r => setTimeout(r, Math.min(20000, (sonido.archivo.duracionSeg ?? 5) * 1000)));
        estado.textContent = r.aviso + avisoSonido;
      } catch (err) { estado.textContent = err.message; }
      finally {
        audio?.pause(); pruebaEfectoActiva = false;
        document.querySelectorAll('[data-prueba-efecto]').forEach(b => { b.disabled = false; });
      }
    },
  }, 'Probar sin directo');
}

function tarjetaEfecto(e) {
  const estadoChip = e.montado === null
    ? h('span', { class: 'chip' }, 'Sin conexión')
    : e.montado
      ? h('span', { class: `chip ${e.habilitada ? 'ok' : 'falta'}` }, e.habilitada ? 'Action encontrada' : 'Action desactivada')
      : h('span', { class: 'chip falta' }, 'Por montar');

  const r = rareza(e.coste);
  return h('article', { class: `tarjeta efecto ${r.clase}` },
    h('div', { class: 'efecto-cabeza' },
      h('span', { class: 'icono' }, icono(e.id)),
      h('div', {}, h('span', { class: 'rareza' }, r.nombre), h('h3', {}, e.recompensa)),
      estadoChip),
    h('div', { class: 'efecto-cuerpo' },
      h('p', {}, e.queHace),
      e.requisitoLoot && h('p', { class: 'nota' }, `Canje real: ${e.requisitoLoot}. La prueba de sonido y visual sigue disponible.`),
      h('div', { class: 'meta' },
        h('span', { class: 'coste' }, `🪙 ${e.coste.toLocaleString('es-ES')}`),
        h('span', {}, `· cooldown ${cooldownTexto(e.cooldownSeg)}`),
        e.necesita && h('span', { class: 'chip plugin' }, e.necesita),
      ),
      e.material?.length > 0 && h('div', { class: 'material' }, e.material.map(filaMaterial)),
      h('div', { class: 'pie' },
        botonPruebaSinDirecto(e),
        h('button', {
          class: `boton ${e.montado === false && !e.necesita ? 'destacado' : ''}`,
          type: 'button',
          onclick: () => abrirGuia(e),
        }, e.montado ? 'Ver la guía' : 'Cómo montarlo'),
      ),
      h('details', { class: 'escena-avanzado' }, h('summary', {}, 'Lanzar el efecto completo como un canje'),
        h('p', { class: 'nota' }, 'Ejecuta la Action y las reglas del Loot: puede escribir al chat, dar objetos o modificar un jefe. No gasta Oros.'),
        botonProbar(e.accionId, e.habilitada)),
    ),
  );
}

// ---------------------------------------------------------------------------
// Guía de montaje
// ---------------------------------------------------------------------------

// Pasos con marcas sencillas (ver src/panel/efectos.ts):
//   **Botón**  → negrita    `texto` → se copia con un clic    [[ruta]] → archivo
// Se trocea a mano y se pinta con textContent: nunca innerHTML.
function textoGuia(str, e) {
  const partes = [];
  const re = /\*\*(.+?)\*\*|`(.+?)`|\[\[(.+?)\]\]/g;
  let ultimo = 0;
  let m;
  while ((m = re.exec(str))) {
    if (m.index > ultimo) partes.push(str.slice(ultimo, m.index));
    if (m[1]) partes.push(h('strong', { class: 'ui' }, m[1]));
    else if (m[2]) partes.push(chipCopiar(m[2], m[2]));
    else {
      const mat = e.material.find((x) => x.id === m[3]);
      const nombre = m[3].split('/').pop();
      partes.push(mat?.archivo ? chipCopiar(nombre, mat.archivo.ruta, 'archivo') : h('code', {}, nombre));
    }
    ultimo = re.lastIndex;
  }
  partes.push(str.slice(ultimo));
  return partes;
}

function chipCopiar(texto, valor, extra = '') {
  const el = h('button', {
    class: `copiable ${extra}`,
    type: 'button',
    title: `Copiar: ${valor}`,
    onclick: async () => {
      await copiar(valor);
      el.classList.add('hecho');
      setTimeout(() => el.classList.remove('hecho'), 1400);
    },
  }, texto);
  return el;
}

const DONDE = {
  'Streamer.bot': { clase: 'd-sb', texto: 'Streamer.bot' },
  OBS: { clase: 'd-obs', texto: 'OBS' },
  Panel: { clase: 'd-panel', texto: 'Este panel' },
};

function abrirGuia(e) {
  const r = rareza(e.coste);
  const dialogo = $('guia');
  const estado = e.montado === null ? h('span', { class: 'chip' }, 'Sin conexión')
    : e.montado ? h('span', { class: 'chip' }, e.habilitada ? 'Action encontrada' : 'Action desactivada') : h('span', { class: 'chip falta' }, 'Por montar');

  dialogo.className = `guia ${r.clase}`;
  dialogo.replaceChildren(
    h('header', { class: 'guia-cabeza' },
      h('span', { class: 'icono' }, icono(e.id)),
      h('div', {},
        h('span', { class: 'rareza' }, `${r.nombre} · 🪙 ${e.coste.toLocaleString('es-ES')}`),
        h('h2', {}, `Cómo montar «${e.recompensa}»`),
        h('p', { class: 'nota' }, e.queHace)),
      estado,
      h('button', { class: 'cerrar', type: 'button', 'aria-label': 'Cerrar', onclick: () => dialogo.close() }, '✕'),
    ),
    h('div', { class: 'guia-cuerpo' },
      h('p', { class: 'guia-aviso' },
        'Streamer.bot está en inglés: los botones salen en ', h('strong', { class: 'ui' }, 'negrita'),
        ' tal cual los verás, con la traducción al lado. Lo que tienes que escribir sale así: ',
        chipCopiar('pulsa para copiar', 'pulsa para copiar'), '.'),
      e.necesita && h('p', { class: 'guia-aviso plugin' }, `Este efecto necesita un plugin de OBS: ${e.necesita}.`),
      h('ol', { class: 'fases' }, e.guia.map((f, i) => {
        const d = DONDE[f.donde];
        return h('li', { class: 'fase' },
          h('div', { class: 'fase-cabeza' },
            h('span', { class: 'fase-num' }, String(i + 1)),
            h('h3', {}, f.titulo),
            h('span', { class: `donde ${d.clase}` }, d.texto)),
          f.atajo && h('p', { class: 'fase-atajo' }, '⚡ ', textoGuia(f.atajo, e)),
          h('ol', { class: 'pasos' }, f.pasos.map((p) => h('li', {}, textoGuia(p, e)))),
          f.nota && h('p', { class: 'fase-nota' }, textoGuia(f.nota, e)));
      })),
    ),
    h('footer', { class: 'guia-pie' },
      h('span', { class: 'nota' }, '¿Algún botón no se llama así en tu pantalla? Dímelo y corrijo la guía.'),
      botonProbar(e.accionId, e.habilitada)),
  );
  if (!dialogo.open) dialogo.showModal();
  dialogo.querySelector('.guia-cuerpo').scrollTop = 0;
}

function filaMaterial(m) {
  const nombre = m.id.split('/').pop();
  const esSonido = m.id.startsWith('sonidos/');
  if (!m.archivo) {
    return h('div', { class: 'fila-material falta' },
      h('span', { class: 'tipo-material' }, esSonido ? '♪' : '▣'),
      h('span', { class: 'nombre-material' }, nombre),
      h('span', { class: 'chip falta' }, 'Falta en la biblioteca'));
  }
  return h('div', { class: 'fila-material' },
    esSonido
      ? botonEscuchar(m.archivo.url, 'pequeno')
      : h('span', { class: 'tipo-material' }, '▣'),
    h('span', { class: 'nombre-material' }, nombre),
    botonCopiar(m.archivo.ruta),
  );
}

$('r-efectos').addEventListener('click', () => { cargarEfectos(); cargarObs(); });

// ---------------------------------------------------------------------------
// Loot
// ---------------------------------------------------------------------------

const RAREZA_LOOT = {
  comun: { clase: 'r-comun', nombre: 'Común' },
  raro: { clase: 'r-raro', nombre: 'Raro' },
  epico: { clase: 'r-epico', nombre: 'Épico' },
  legendario: { clase: 'r-legendario', nombre: 'Legendario' },
};
const ORIGEN = { cofre: 'cofre', oro: 'Cofre del tesoro', panel: 'desde el panel', regalo: 'regalo', jefe: 'jefe del chat', fidelidad: 'fidelidad', suscriptor: 'suscriptor', raid: 'raid de Twitch', bits: 'bits', forja: 'forjado', guerra: 'cofre de guerra', maldicion: 'Maldición', temporada: 'premio de temporada' };

function mmss(seg) {
  const m = Math.floor(seg / 60);
  return m >= 1 ? `${m} min ${String(seg % 60).padStart(2, '0')} s` : `${seg} s`;
}

const MEDALLA = ['🥇', '🥈', '🥉'];

function pintarTemporada(d) {
  const t = d.temporada;
  if (t) {
    $('l-temporada-titulo').textContent = `🏆 Temporada de ${t.nombre}`;
    $('l-temporada-quedan').textContent = t.diasQuedan === 1 ? 'Último día' : `Quedan ${t.diasQuedan} días`;
    $('l-temporada').replaceChildren(...(t.ranking.length
      ? t.ranking.map((p, i) => h('li', {},
        h('span', { class: 'puesto' }, String(i + 1)),
        h('div', { class: 'mochila-quien' }, h('strong', {}, p.display_name), h('span', { class: 'dato' }, `${p.puntos} puntos`))))
      : [h('li', { class: 'vacio-lista' }, 'Nadie tiene puntos este mes todavía.')]));
    $('l-salon').replaceChildren(...(t.salon.length
      ? t.salon.map((s) => h('li', {}, h('strong', {}, s.nombre),
        s.podio.map((p, i) => h('span', { class: 'salon-puesto' }, `${MEDALLA[i]} ${p.display_name} (${p.puntos})`))))
      : [h('li', { class: 'vacio-lista' }, 'Vacío: la primera temporada se cierra al acabar el mes.')]));
  }

  const e = d.evento;
  if (!e) return;
  $('l-evento-cambia').textContent = e.eleccion === 'auto'
    ? (e.cambiaEnDias === 1 ? 'Cambia mañana' : `Cambia en ${e.cambiaEnDias} días`)
    : 'Fijado por ti';
  $('l-evento-actual').replaceChildren(e.actual
    ? h('div', {}, h('strong', {}, `${e.actual.emoji} ${e.actual.nombre}`), h('p', { class: 'nota' }, `Esta semana ${e.actual.texto}.`))
    : h('p', { class: 'nota' }, 'Sin evento: el Loot con sus reglas de siempre.'));
  const sel = $('l-evento-eleccion');
  if (document.activeElement !== sel) {
    sel.replaceChildren(
      h('option', { value: 'auto', selected: e.eleccion === 'auto' }, `🔄 Rotar solo (esta semana: ${e.rotacion.nombre})`),
      h('option', { value: 'ninguno', selected: e.eleccion === 'ninguno' }, '⏸️ Ninguno'),
      ...e.eventos.map((x) => h('option', { value: x.id, selected: e.eleccion === x.id }, `${x.emoji} ${x.nombre}`)));
  }
  $('l-eventos').replaceChildren(...e.eventos.map((x) => h('li', { class: e.actual?.id === x.id ? 'activo' : null },
    h('span', { 'aria-hidden': 'true' }, x.emoji), h('strong', {}, x.nombre), h('span', { class: 'nota' }, x.texto))));
}

$('l-evento-eleccion').addEventListener('change', async (ev) => {
  try {
    await api('/api/loot/evento', { eleccion: ev.target.value });
    tostada('Evento de la semana cambiado');
    cargarLoot();
  } catch (err) { tostada(err.message, true); }
});

function pildoraBotin(b) {
  const r = RAREZA_LOOT[b.rareza];
  return h('span', { class: `botin ${r.clase}${b.maldito ? ' maldito' : ''}`, title: b.maldito ? 'Maldito: poder doble, se pierde en un duelo' : null },
    h('span', { class: 'gema' }), b.maldito ? `☠️ ${b.objeto}` : b.objeto);
}

async function cargarLoot() {
  let d;
  try {
    d = await api('/api/loot');
  } catch (err) {
    tostada(err.message === 'no existe' ? 'Reinicia el bot para ver el Loot (Ctrl+C y npm start)' : err.message, true);
    return;
  }

  if (document.activeElement !== $('loot-activo')) $('loot-activo').checked = d.activo;
  $('loot-activo-texto').textContent = d.activo ? 'Loot activo' : 'Loot apagado';
  if (document.activeElement !== $('loot-canal-juega')) $('loot-canal-juega').checked = d.canalJuega;
  const m = d.mision;
  if (m) {
    if (document.activeElement !== $('l-mision-tipo')) $('l-mision-tipo').value = m.tipo;
    $('l-mision-estado').textContent = m.completada ? 'Completada' : m.activa ? 'En marcha' : 'Apagada';
    $('l-mision-progreso').textContent = `${m.nombre}: ${m.progreso}/${m.meta}`;
    $('l-mision-barra').max = m.meta;
    $('l-mision-barra').value = m.progreso;
  } else {
    $('l-mision-estado').textContent = 'Reinicia el bot';
    $('l-mision-progreso').textContent = 'La versión abierta del bot aún no admite misiones.';
  }
  $('l-mision-preparar').disabled = !m;
  $('l-mision-activar').disabled = !m || m.activa || m.completada;
  $('l-mision-pausar').disabled = !m || !m.activa;
  $('l-regalo-ayuda').textContent = `Vacío: uno para cada persona del chat, haya escrito o no. Sin bots${d.canalJuega ? '; tú también participas' : ' y sin ti'}.`;

  const esperando = !d.activo ? 'Loot apagado' : !d.directo ? 'Esperando al directo' : null;
  ficha('l-proximo', esperando ? '' : 'oro', esperando ?? (d.proximoEnSeg !== null ? mmss(d.proximoEnSeg) : '—'),
    esperando ? 'No caerá ninguno hasta entonces' : 'Al azar entre 20 y 30 min');
  ficha('l-aventureros', d.aventureros.length ? 'ok' : '', String(d.aventureros.length),
    d.aventureros.length ? d.aventureros.join(', ') : `Nadie ha escrito en ${d.minutosActividad} min`);
  ficha('l-ultimo', '', d.ultimoCofre ? hace(d.ultimoCofre) : 'Ninguno', d.ultimoCofre ? hora(d.ultimoCofre) : 'desde que arrancó el bot');
  ficha('l-directo', d.directo ? 'vivo' : '', d.directo ? 'En marcha' : 'Sin directo', d.directo ? 'Los cofres pueden caer' : 'Sin directo no caen cofres');
  $('l-suelo').hidden = !d.enElSuelo;
  if (d.enElSuelo) {
    $('l-suelo').textContent = `⚔️ El cofre de guerra de ${d.enElSuelo.de} está en el suelo: el primero que escriba en ${mmss(d.enElSuelo.quedanSeg)} se lo lleva.`;
  }

  const j = d.jefe;
  $('l-jefe').replaceChildren(...(j
    ? [
      h('div', { class: 'jefe-cabeza' },
        h('strong', {}, `🐉 ${j.nombre.charAt(0).toUpperCase()}${j.nombre.slice(1)}`),
        h('span', { class: 'dato' }, `${j.vida}/${j.vidaMax} de vida · quedan ${mmss(j.quedanSeg)}`)),
      h('div', { class: 'jefe-barra', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(j.vidaMax), 'aria-valuenow': String(j.vida) },
        h('span', { style: `width:${Math.round((j.vida / j.vidaMax) * 100)}%` })),
      h('p', { class: 'nota' }, j.atacantes.length
        ? j.atacantes.map((a) => `${a.quien} ${a.dano}`).join(' · ')
        : 'Nadie le ha pegado todavía.'),
      h('button', { class: 'boton', type: 'button', 'data-jefe': 'retirar' }, 'Retirarlo sin botín'),
    ]
    : [
      h('p', { class: 'nota' }, 'Aparece en el chat con 200 de vida por cada persona que esté hablando; cada una puede pegar cada 10 s. Si cae, botín para todos los que peguen; Cofre del tesoro para quien más daño haga. El bot solo habla tres veces: al aparecer, a mitad de vida y al final.'),
      h('div', { class: 'jefe-invocar' },
        h('select', { id: 'l-jefe-tipo', 'aria-label': 'Qué jefe' },
          h('option', { value: '' }, '🎲 Al azar'),
          (d.jefes || []).map((x) => h('option', { value: x.tipo, selected: x.tipo === jefeElegido }, x.nombre.charAt(0).toUpperCase() + x.nombre.slice(1)))),
        h('button', { class: 'boton primario', type: 'button', 'data-jefe': 'invocar' }, '🐉 Invocar jefe')),
    ]));

  const enChat = d.enElChat || [];
  $('l-en-chat').textContent = enChat.length
    ? `En el chat ahora: ${enChat.length} (sin bots ni tú)`
    : 'Ahora mismo no hay nadie en el chat';
  $('l-regalo-lista').replaceChildren(...enChat.map((v) => h('option', { value: v.login }, v.nombre)));
  $('l-sin-directo').hidden = d.directo;
  $('l-con-directo').hidden = !d.directo;
  const vig = d.vigilante || {};
  $('l-con-directo-texto').textContent = vig.manual
    ? 'Marcado en directo a mano, para probar: no se cerrará solo aunque no emitas.'
    : vig.obs === true
      ? 'En directo: OBS está emitiendo. Se cerrará solo al terminar.'
      : 'En directo. El bot lo comprueba en OBS cada minuto y lo cerrará solo si no emites.';

  $('l-recientes').replaceChildren(...(d.recientes.length
    ? d.recientes.map((f) => h('li', {},
      pildoraBotin(f),
      h('span', { class: 'quien' }, f.display_name),
      h('span', { class: 'dato' }, `${ORIGEN[f.origen] || f.origen} · ${hace(f.at)}`)))
    : [h('li', { class: 'vacio-lista' }, 'Todavía no ha caído nada. El primer cofre llegará en el próximo directo.')]));

  if (document.activeElement !== $('l-duelos-pantalla')) $('l-duelos-pantalla').value = d.duelosPantalla || 'completo';
  $('l-retos').hidden = !d.retosPendientes?.length;
  $('l-retos').textContent = d.retosPendientes?.length
    ? `Esperando respuesta: ${d.retosPendientes.map((r) => `${r.retador} → ${r.rival}${r.revancha ? ' (revancha)' : ''} · ${r.quedanSeg} s`).join(' · ')}`
    : '';
  $('l-duelos').replaceChildren(...(d.duelosRecientes?.length
    ? d.duelosRecientes.slice(0, 10).map((x) => {
      const a = Math.round(x.prob * 100);
      if (x.asaltos?.length) {
        const ganador = x.ganaRetador ? x.retador : x.rival;
        const ganadosA = x.asaltos.filter((s) => s.ganaRetador).length;
        const marcador = x.ganaRetador ? `${ganadosA}-${x.asaltos.length - ganadosA}` : `${x.asaltos.length - ganadosA}-${ganadosA}`;
        const asaltos = x.asaltos.map((s, i) => `${i + 1}º ${s.a.objeto} contra ${s.b.objeto} → ${s.ganaRetador ? x.retador.nombre : x.rival.nombre}`).join(' · ');
        return h('li', {},
          h('strong', {}, `${x.revancha ? '🔥 Revancha · ' : ''}${x.retador.nombre} ${a} % · ${x.rival.nombre} ${100 - a} % → gana ${ganador.nombre} ${marcador}`),
          h('span', { class: 'dato' }, `Poder ${x.retador.poder} contra ${x.rival.poder} · ${asaltos}${x.maldito ? ` · ☠️ cambió de manos: ${x.maldito}` : ''}${x.pantalla === 'chat' ? ' · solo en el chat' : ''} · ${hace(new Date(x.at).toISOString())}`));
      }
      const ganador = x.ganaRetador ? x.retador : x.rival;
      const opcionGanadora = x.ganaRetador ? a : 100 - a;
      return h('li', {},
        h('strong', {}, `${x.retador.nombre} ${a} % · ${x.rival.nombre} ${100 - a} %`),
        h('span', { class: 'dato' }, `Poder ${x.retador.poder} contra ${x.rival.poder} · tirada ${(x.tirada * 100).toFixed(1)} frente al límite ${(x.prob * 100).toFixed(1)}: ${x.tirada < x.prob ? 'gana quien retó' : 'gana quien defendió'} (${ganador.nombre}, ${opcionGanadora} % de opciones)${x.maldito ? ` · ☠️ cambió de manos: ${x.maldito}` : ''} · ${hace(new Date(x.at).toISOString())}`));
    })
    : [h('li', { class: 'vacio-lista' }, 'Todavía no hay duelos en esta sesión.')]));

  const p = d.progresion;
  $('l-progresion').replaceChildren(p?.jugadores
    ? h('div', {},
      h('p', {}, `${p.jugadores} mochilas · poder más alto ${p.masAlto} · mediana ${p.mediana} · más bajo ${p.masBajo}.`),
      h('p', {}, `Alguien nuevo con un objeto común (poder 1) tendría ${Math.round(p.nuevoContraLider * 100)} % de opciones frente a la mochila líder.`),
      h('p', { class: 'nota' }, p.jugadores < 10
        ? 'Aún hay pocas mochilas para justificar un cambio de equilibrio. El mínimo del 20 % mantiene posibles los duelos desiguales.'
        : 'El mínimo del 20 % mantiene posibles los duelos desiguales. Compara estos datos antes de cambiar las reglas.'))
    : h('p', { class: 'nota' }, p ? 'Aún no hay mochilas para comparar.' : 'Reinicia el bot para ver la progresión.'));

  $('l-comandos').replaceChildren(...d.comandos.map(([cmd, que]) => h('li', {}, chipCopiar(cmd, cmd), h('span', {}, que))));
  pintarTemporada(d);

  $('l-mochilas').replaceChildren(...(d.mochilas.length
    ? d.mochilas.map((m, i) => h('li', {},
      h('span', { class: 'puesto' }, String(i + 1)),
      h('div', { class: 'mochila-quien' },
        h('strong', {}, m.display_name),
        h('span', { class: 'dato' },
          `⚔️ ${m.poder} · 🎒 ${m.total}/${d.mochilaMax} · 📖 ${m.coleccion}` +
          (m.ganados + m.perdidos ? ` · duelos ${m.ganados}-${m.perdidos}` : '')),
        m.titulo && h('span', { class: 'titulo-loot' }, `«${m.titulo}»`)),
      m.legendarios > 0 && h('span', { class: 'botin r-legendario' }, h('span', { class: 'gema' }), `${m.legendarios}`),
      m.epicos > 0 && h('span', { class: 'botin r-epico' }, h('span', { class: 'gema' }), `${m.epicos}`)))
    : [h('li', { class: 'vacio-lista' }, 'Aún no hay mochilas.')]));

  $('l-probs').replaceChildren(
    h('thead', {}, h('tr', {}, h('th', {}, 'Rareza'), h('th', {}, 'Cofre gratis'), h('th', {}, 'Cofre del tesoro'))),
    h('tbody', {}, Object.keys(RAREZA_LOOT).map((r) => h('tr', {},
      h('td', {}, h('span', { class: `botin ${RAREZA_LOOT[r].clase}` }, h('span', { class: 'gema' }), RAREZA_LOOT[r].nombre)),
      h('td', { class: 'num' }, `${d.probabilidades.cofre[r]} %`),
      h('td', { class: 'num' }, `${d.probabilidades.oro[r]} %`)))),
  );

  $('l-montar').replaceChildren(
    h('li', {}, 'Los cofres gratis no necesitan nada: caen solos durante el directo.'),
    h('li', {}, 'Cofre del tesoro: crea en Streamer.bot la recompensa ', chipCopiar('Cofre del tesoro', 'Cofre del tesoro'),
      ' con coste ', chipCopiar('1500', '1500'), ', espera de 5 min, máximo 2 por persona y directo, y ', h('strong', { class: 'ui' }, 'Skip Queue'),
      '. No hace falta ninguna acción: la abre el bot.'),
    h('li', {}, 'Banner en pantalla: en ', h('strong', { class: 'ui' }, 'Efectos'), ' → ', h('strong', { class: 'ui' }, 'Preparar en OBS'),
      ', marca ', h('strong', { class: 'ui' }, 'Banner del Loot'), '. Lo enseña el bot con cada cofre.'),
  );
}

$('loot-activo').addEventListener('change', async (e) => {
  const valor = e.target.checked;
  try {
    await api('/api/loot/ajustes', { activo: valor });
    tostada(valor ? 'Loot activado' : 'Loot apagado: no caerán cofres');
    cargarLoot();
  } catch (err) {
    e.target.checked = !valor;
    tostada(err.message, true);
  }
});

$('l-soltar').addEventListener('click', async () => {
  try {
    const r = await api('/api/loot/soltar', {});
    tostada(r.enviado ? `Cofre para ${r.reparto.length}` : 'Cofre repartido, pero el mensaje no salió al chat', !r.enviado);
    cargarLoot();
  } catch (err) {
    tostada(err.message, true);
  }
});

// Duelos en pantalla: completo (~10 s) · corto (5 s) · solo en el chat.
$('l-duelos-pantalla').addEventListener('change', async (e) => {
  const valor = e.target.value;
  try {
    await api('/api/loot/ajustes', { duelosPantalla: valor });
    tostada({ completo: 'Duelos en pantalla: completos, con los asaltos', corto: 'Duelos en pantalla: solo el resultado, 5 s', chat: 'Duelos solo en el chat: nada en pantalla' }[valor]);
    cargarLoot();
  } catch (err) {
    tostada(err.message, true);
    cargarLoot();
  }
});

$('loot-canal-juega').addEventListener('change', async (e) => {
  const valor = e.target.checked;
  try {
    await api('/api/loot/ajustes', { canalJuega: valor });
    tostada(valor ? 'Juegas al Loot como uno más' : 'El Loot es solo para el chat');
    cargarLoot();
  } catch (err) {
    e.target.checked = !valor;
    tostada(err.message, true);
  }
});

// Qué jefe invocar. Se guarda aquí porque la tarjeta se repinta cada 5 s.
let jefeElegido = '';
$('l-jefe').addEventListener('change', (e) => {
  if (e.target.id === 'l-jefe-tipo') jefeElegido = e.target.value;
});

for (const accion of ['preparar', 'activar', 'pausar']) {
  $(`l-mision-${accion}`).addEventListener('click', async () => {
    try {
      await api('/api/loot/mision', { accion, tipo: $('l-mision-tipo').value });
      await cargarLoot();
      tostada(accion === 'activar' ? 'Misión en marcha' : accion === 'pausar' ? 'Misión pausada' : 'Objetivo preparado y apagado');
    } catch (err) { tostada(err.message, true); }
  });
}

$('l-jefe').addEventListener('click', async (e) => {
  const boton = e.target.closest('[data-jefe]');
  if (!boton) return;
  const accion = boton.dataset.jefe;
  boton.disabled = true;
  try {
    const r = await api('/api/loot/jefe', { accion, tipo: jefeElegido || undefined });
    tostada(accion === 'retirar' ? 'Jefe retirado' : `🐉 ${r.nombre} aparece con ${r.vida} de vida${r.enviado ? '' : ' (el mensaje no salió al chat)'}`, accion !== 'retirar' && !r.enviado);
    cargarLoot();
  } catch (err) {
    tostada(err.message, true);
    boton.disabled = false;
  }
});

$('p-mecenas').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-prueba]');
  if (!b) return;
  b.disabled = true;
  try {
    await api('/api/pruebas/mecenas', { tipo: b.dataset.prueba });
    tostada(`Prueba lanzada: ${b.textContent.trim()}`);
    setTimeout(cargarLoot, b.dataset.prueba === 'regalo' || b.dataset.prueba === 'bomba' ? 6000 : 800);
  } catch (err) {
    tostada(err.message, true);
  } finally {
    b.disabled = false;
  }
});

$('p-mecenas-borrar').addEventListener('click', async () => {
  try {
    const r = await api('/api/pruebas/mecenas/borrar', {});
    tostada(`Borrado lo de las pruebas (${r.borrados} filas)`);
    cargarLoot();
  } catch (err) { tostada(err.message, true); }
});

$('l-regalo').addEventListener('submit', async (e) => {
  e.preventDefault();
  const para = $('l-regalo-para').value.trim().replace(/^@/, '');
  try {
    const r = await api('/api/loot/regalar', { para, tipo: $('l-regalo-tipo').value });
    const quien = para ? r.reparto[0].quien : `${r.reparto.length} persona${r.reparto.length === 1 ? '' : 's'}`;
    tostada(r.enviado ? `🎁 Cofre regalado a ${quien}` : `Cofre regalado a ${quien}, pero el mensaje no salió al chat`, !r.enviado);
    $('l-regalo-para').value = '';
    cargarLoot();
  } catch (err) {
    tostada(err.message, true);
  }
});

for (const [id, tipo] of [['l-prueba', 'cofre'], ['l-prueba-oro', 'oro']]) {
  $(id).addEventListener('click', async () => {
    try {
      const b = await api('/api/loot/prueba', { tipo });
      const r = RAREZA_LOOT[b.rareza];
      // El objeto en grande: una pastillita sola pasaba desapercibida.
      $('l-revelado').replaceChildren(h('div', { class: `revelado ${r.clase}` },
        h('span', { class: 'revelado-cofre' }, tipo === 'oro' ? '🗝️' : '🎁'),
        h('div', {},
          h('span', { class: 'rareza' }, `${r.nombre} · ${tipo === 'oro' ? 'Cofre del tesoro' : 'cofre gratis'} · de prueba`),
          h('strong', { class: 'revelado-objeto' }, b.objeto))));
      tostada(`${tipo === 'oro' ? '🗝️' : '🎁'} ${r.nombre}: ${b.objeto}${b.enObs ? ' · mira tu OBS' : ''}`);

      // Y el historial de las anteriores, para ver cómo se reparten.
      const caja = $('l-resultado-prueba');
      caja.prepend(h('span', { class: 'prueba-item' }, pildoraBotin(b)));
      while (caja.children.length > 10) caja.lastChild.remove();
    } catch (err) {
      tostada(err.message, true);
    }
  });
}

for (const [id, abierto, texto] of [
  ['l-marcar-directo', true, 'Marcado en directo para probar: no se cerrará solo'],
  ['l-terminar-directo', false, 'Directo terminado: no caerán cofres hasta el próximo'],
]) {
  $(id).addEventListener('click', async () => {
    try {
      await api('/api/loot/directo', { abierto });
      tostada(texto);
      cargarLoot();
      refrescar();
    } catch (err) {
      tostada(err.message, true);
    }
  });
}


// La cuenta atrás se refresca sola mientras miras la pestaña.
DirectoRed.sondear(() => { if (!$('v-loot').hidden) return cargarLoot(); }, 5000, false);

// ---------------------------------------------------------------------------
// Importar en Streamer.bot
// ---------------------------------------------------------------------------

const IMPORTABLES = ['grito', 'pocion', 'maldicion', 'terremoto', 'lag']; // los mismos que importar.ts
let datosEfectos = null;
let obsConectado = null;
let obsSinFreeze = false;
// Lo que marcas se respeta aunque la lista se repinte cada 15 segundos.
const importarMarcados = new Map();
// Los pasos que salen al copiar: sobreviven al repintado.
const pasosImportar = h('ol', { class: 'pasos importar-pasos' });

function pintarImportar() {
  const cuerpo = $('importar-cuerpo');
  if (!cuerpo || !datosEfectos) return;
  const efectos = datosEfectos.efectos.filter((e) => IMPORTABLES.includes(e.id));

  const faltaObs = !obsElegido.escena || !obsElegido.fuente;
  const marcas = efectos.map((e) => {
    const sinPlugin = e.id === 'lag' && obsSinFreeze;
    const marcado = importarMarcados.has(e.id) ? importarMarcados.get(e.id) : !e.montado && !sinPlugin;
    return h('label', { class: 'preparable' },
      h('input', {
        type: 'checkbox', value: e.id, checked: marcado,
        onchange: (ev) => importarMarcados.set(e.id, ev.target.checked),
      }),
      h('span', {},
        h('strong', {}, `${icono(e.id)} ${e.recompensa}`),
        h('small', {}, e.montado ? 'Ya la tienes: si la importas, saldrá repetida.'
          : sinPlugin ? 'Necesita el plugin Freeze Filter. Impórtala cuando lo tengas.' : e.queHace)),
      e.montado && h('span', { class: 'chip ok' }, 'Montado'),
    );
  });

  const pasos = pasosImportar;
  const boton = h('button', {
    class: 'boton primario',
    type: 'button',
    disabled: faltaObs,
    onclick: async () => {
      const ids = [...cuerpo.querySelectorAll('.preparable input:checked')].map((i) => i.value);
      if (!ids.length) return tostada('Marca al menos uno', true);
      try {
        const q = new URLSearchParams({ ids: ids.join(','), escena: obsElegido.escena, fuente: obsElegido.fuente });
        const { codigo } = await api(`/api/efectos/importar?${q}`);
        await copiar(codigo);
        tostada('Código copiado. Ahora, Import en Streamer.bot');
        const elegidos = efectos.filter((e) => ids.includes(e.id));
        pasos.replaceChildren(
          h('li', {}, 'En Streamer.bot, pulsa ', h('strong', { class: 'ui' }, 'Import'), ' (arriba a la izquierda).'),
          h('li', {}, 'Pega el código en ', h('strong', { class: 'ui' }, 'Import String'), ' y pulsa ', h('strong', { class: 'ui' }, 'Import'), '. Aparecerán en el grupo «Efectos».'),
          h('li', {}, 'Crea las recompensas en ', h('strong', { class: 'ui' }, 'Platforms'), ' → ', h('strong', { class: 'ui' }, 'Twitch'), ' → ', h('strong', { class: 'ui' }, 'Channel Point Rewards'), ', con ', h('strong', { class: 'ui' }, 'Skip Queue'), ' marcado:',
            h('ul', { class: 'recompensas' }, elegidos.map((e) => h('li', {},
              chipCopiar(e.recompensa, e.recompensa), ` · coste ${e.coste} · cooldown ${e.cooldownSeg} s`)))),
          h('li', {}, 'En cada acción importada, añade su disparador: ', h('strong', { class: 'ui' }, 'Search to add trigger…'), ' → ', h('strong', { class: 'ui' }, 'Reward Redemption'), ' → su recompensa.'),
          h('li', {}, 'Vuelve aquí: pasarán a ', h('strong', { class: 'ui' }, 'Montado'), ' y podrás ', h('strong', { class: 'ui' }, 'Probar'), 'las.'),
        );
      } catch (err) {
        tostada(err.message, true);
      }
    },
  }, 'Copiar código para Import');

  cuerpo.replaceChildren(
    h('p', { class: 'nota' }, 'Genera las acciones de Streamer.bot con todas sus sub-acciones ya puestas: sonido, OBS, esperas y mensaje. Solo tendrás que crear las recompensas y elegir el disparador de cada una.'),
    faltaObs
      ? h('p', { class: 'aviso' }, obsConectado === false
        ? 'Conecta OBS arriba: el código necesita saber tu escena y tu fuente del juego.'
        : 'Elige arriba la escena y la fuente del juego.')
      : h('p', { class: 'nota' }, 'Usará la escena ', h('strong', {}, obsElegido.escena), ' y la fuente ', h('strong', {}, obsElegido.fuente), ', las mismas de «Preparar OBS».'),
    h('div', { class: 'preparables' }, marcas),
    h('div', { class: 'obs-pie' }, boton),
    pasos,
  );
}

// ---------------------------------------------------------------------------
// Preparar OBS
// ---------------------------------------------------------------------------

const PREPARABLES = [
  { id: 'pocion', titulo: 'Poción de vida', que: 'Fuente «FX Pocion» con el overlay, oculta', necesita: 'escena' },
  { id: 'maldicion', titulo: 'Maldición', que: 'Filtro «FX Maldicion» en blanco y negro, apagado', necesita: 'fuente' },
  { id: 'lag', titulo: 'Lag', que: 'Filtro «FX Lag» que congela la imagen, apagado', necesita: 'fuente', plugin: true },
  { id: 'botin', titulo: 'Banner del Loot', que: 'Fuente «FX Botin»: el banner de cada cofre, oculta', necesita: 'escena' },
  { id: 'jefe', titulo: 'Jefe y duelos', que: 'Fuente «FX Jefe»: la barra del jefe del chat y cada !duelo. Visible, pero cuando no pasa nada no se ve', necesita: 'escena' },
];

// Lo que elegiste la última vez, para no tener que volver a elegirlo.
const obsElegido = { escena: '', fuente: '' };
try { Object.assign(obsElegido, JSON.parse(localStorage.getItem('panel-obs') || '{}')); } catch { /* nada */ }

async function cargarObs() {
  let datos;
  try {
    const q = obsElegido.fuente ? `?fuente=${encodeURIComponent(obsElegido.fuente)}` : '';
    datos = await api(`/api/obs${q}`);
  } catch (err) {
    datos = { conectado: false, motivo: err.message === 'no existe' ? 'Reinicia el bot para usar esto (Ctrl+C y npm start).' : err.message };
  }
  pintarObs(datos);
}

function pintarObs(d) {
  obsConectado = d.conectado;
  obsSinFreeze = d.conectado && d.pluginFreeze === false;
  const estado = $('obs-estado');
  estado.className = `nota ${d.conectado ? 'ok' : 'mal'}`;
  estado.textContent = d.conectado ? '● Conectado a OBS' : '● Sin conexión con OBS';

  if (!d.conectado) {
    $('obs-cuerpo').replaceChildren(
      h('p', { class: 'obs-motivo' }, d.motivo),
      h('ol', { class: 'pasos obs-ayuda' },
        h('li', {}, 'En OBS: ', h('strong', { class: 'ui' }, 'Herramientas'), ' → ', h('strong', { class: 'ui' }, 'Configuración del servidor WebSocket'), '. Comprueba que está activado.'),
        h('li', {}, 'Pulsa ', h('strong', { class: 'ui' }, 'Mostrar información de conexión'), ' y copia la contraseña.'),
        h('li', {}, 'Pégala en el ', h('code', {}, '.env'), ' como ', chipCopiar('OBS_WS_PASSWORD=', 'OBS_WS_PASSWORD='), ' y reinicia el bot.'),
      ),
      h('button', { class: 'boton pequeno', type: 'button', onclick: cargarObs }, 'Volver a comprobar'),
    );
    pintarImportar();
    return;
  }

  if (!d.escenas.includes(obsElegido.escena)) obsElegido.escena = d.escenaActual || d.escenas[0] || '';
  if (!d.fuentes.some((f) => f.nombre === obsElegido.fuente)) {
    obsElegido.fuente = d.fuentes[0]?.nombre || '';
    // Se preguntó sin fuente (o con una que ya no existe): hay que volver a
    // preguntar con la buena para saber qué filtros tiene ya.
    if (obsElegido.fuente) return cargarObs();
  }

  const selector = (clave, etiqueta, opciones, ayuda) => h('label', { class: 'campo' },
    h('span', {}, etiqueta),
    h('select', {
      onchange: (ev) => {
        obsElegido[clave] = ev.target.value;
        try { localStorage.setItem('panel-obs', JSON.stringify(obsElegido)); } catch { /* nada */ }
        if (clave === 'fuente') cargarObs();
        pintarImportar();
      },
    }, opciones.map((o) => h('option', { value: o, selected: o === obsElegido[clave] }, o))),
    h('small', {}, ayuda));

  const marcas = PREPARABLES.map((p) => {
    const sinPlugin = p.plugin && d.pluginFreeze === false;
    const existe = d.existe[p.id];
    return h('label', { class: `preparable ${sinPlugin ? 'bloqueado' : ''}` },
      h('input', { type: 'checkbox', value: p.id, checked: !sinPlugin && existe !== true, disabled: sinPlugin }),
      h('span', {},
        h('strong', {}, p.titulo),
        h('small', {}, sinPlugin ? 'Falta el plugin Freeze Filter. Instálalo y vuelve aquí.' : p.que)),
      existe === true && h('span', { class: 'chip ok' }, 'Ya está'),
    );
  });

  const resultados = h('ul', { class: 'obs-resultados' });

  const boton = h('button', {
    class: 'boton primario',
    type: 'button',
    onclick: async () => {
      const efectos = [...$('obs-cuerpo').querySelectorAll('.preparable input:checked')].map((i) => i.value);
      if (!efectos.length) return tostada('Marca al menos uno', true);
      boton.disabled = true;
      try {
        const r = await api('/api/obs/preparar', { escena: obsElegido.escena, fuente: obsElegido.fuente, efectos });
        resultados.replaceChildren(...r.resultados.map((x) =>
          h('li', { class: x.ok ? 'ok' : 'mal' }, x.ok ? '✓ ' : '✕ ', x.mensaje)));
        const bien = r.resultados.filter((x) => x.ok).length;
        tostada(bien === r.resultados.length ? 'OBS preparado' : `${bien} de ${r.resultados.length} preparados`, bien < r.resultados.length);
        setTimeout(cargarObs, 400);
      } catch (err) {
        tostada(err.message, true);
      } finally {
        boton.disabled = false;
      }
    },
  }, 'Preparar en OBS');

  $('obs-cuerpo').replaceChildren(
    h('p', { class: 'nota' }, 'Crea en OBS lo que necesitan los efectos, así te ahorras la fase «Prepara OBS» de cada guía. Todo se crea oculto o apagado. Puedes pulsarlo las veces que quieras: si algo ya existe, lo actualiza en vez de duplicarlo.'),
    h('div', { class: 'obs-campos' },
      selector('escena', 'Escena del juego', d.escenas, 'Donde aparecerá la poción.'),
      d.fuentes.length
        ? selector('fuente', 'Fuente del juego', d.fuentes.map((f) => f.nombre), 'La captura del juego: ahí van los filtros.')
        : h('p', { class: 'aviso' }, 'No encuentro ninguna captura de juego, de ventana o de pantalla en OBS.')),
    h('div', { class: 'preparables' }, marcas),
    h('div', { class: 'obs-pie' }, boton, h('span', { class: 'nota' }, 'Mejor hazlo sin estar en directo: al crear un filtro, OBS lo enciende un instante antes de que el panel lo apague.')),
    resultados,
  );
  pintarImportar();
}

// ---------------------------------------------------------------------------
// Biblioteca
// ---------------------------------------------------------------------------

async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    // Sin permiso de portapapeles: el truco de siempre.
    const area = h('textarea', { style: 'position:fixed;opacity:0' });
    area.value = texto;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

function botonCopiar(ruta, texto = 'Copiar ruta') {
  const el = h('button', {
    class: 'boton pequeno copiar',
    type: 'button',
    title: ruta,
    onclick: async () => {
      await copiar(ruta);
      el.textContent = '✓ Copiada';
      el.classList.add('hecho');
      setTimeout(() => { el.textContent = texto; el.classList.remove('hecho'); }, 1600);
    },
  }, texto);
  return el;
}

// Un solo reproductor para todo el panel: pulsar otro sonido corta el anterior.
const reproductor = new Audio();
let botonSonando = null;

reproductor.addEventListener('ended', () => marcarSonando(null));

function marcarSonando(boton) {
  if (botonSonando) {
    botonSonando.classList.remove('sonando');
    botonSonando.setAttribute('aria-label', 'Escuchar');
  }
  botonSonando = boton;
  if (boton) {
    boton.classList.add('sonando');
    boton.setAttribute('aria-label', 'Parar');
  }
}

function botonEscuchar(url, tamano = '') {
  const el = h('button', {
    class: `escuchar ${tamano}`,
    type: 'button',
    'aria-label': 'Escuchar',
    onclick: () => {
      if (botonSonando === el) {
        reproductor.pause();
        marcarSonando(null);
        return;
      }
      reproductor.src = url;
      reproductor.currentTime = 0;
      reproductor.play().catch((err) => tostada(`No se pudo reproducir: ${err.message}`, true));
      marcarSonando(el);
    },
  });
  return el;
}

/**
 * «Ver en grande»: los overlays miden 1920×1080 fijos y, abiertos tal cual en una
 * ventana más pequeña, salen recortados. El visor (ver.html) los encoge enteros.
 * modo: escena (overlay de 1920×1080) · pagina (web normal) · imagen · audio · texto.
 */
const enGrande = (src, modo = 'escena', titulo = '') => `/ver.html?${new URLSearchParams({ src, modo, ...(titulo && { titulo }) })}`;

/** «Ver en grande» en una ventana flotante encima del panel (Esc, ✕ o pinchar fuera la cierran). */
function abrirGrande(src, modo = 'escena', titulo = '') {
  let d = $('visor-grande');
  if (!d) {
    d = h('dialog', { class: 'visor-grande', id: 'visor-grande', 'aria-label': 'Ver en grande' },
      h('button', { class: 'visor-grande-cerrar', type: 'button', 'aria-label': 'Cerrar', onclick: () => d.close() }, '✕'),
      h('iframe', { title: 'Vista en grande', allow: 'autoplay' }));
    // Pinchar en el fondo oscuro (fuera de la ventana) también cierra.
    d.addEventListener('click', (ev) => { if (ev.target === d) d.close(); });
    // Al cerrar, fuera la página: que no siga sonando.
    d.addEventListener('close', () => { d.querySelector('iframe').src = 'about:blank'; });
    document.body.append(d);
  }
  d.querySelector('iframe').src = enGrande(src, modo, titulo);
  d.showModal();
}

const tamano = (bytes) => (bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

function vacioBiblioteca(seccion, texto) {
  return h('div', { class: 'vacio-biblioteca' },
    h('p', {}, texto),
    h('button', { class: 'boton pequeno', type: 'button', onclick: () => abrirCarpeta(seccion) }, `Abrir biblioteca/${seccion}`));
}

async function abrirCarpeta(seccion) {
  try {
    await api('/api/biblioteca/abrir', seccion ? { seccion } : {});
  } catch (err) {
    tostada(err.message, true);
  }
}

function usadoEn(lista) {
  return lista.length
    ? h('span', { class: 'usado' }, 'Usado en ', lista.join(', '))
    : h('span', { class: 'usado libre' }, 'Sin usar');
}

// Los overlays miden 1920×1080: la vista previa los encoge al ancho de la tarjeta.
const escalarOverlay = new ResizeObserver((entradas) => {
  for (const e of entradas) if (e.contentRect.width > 0) e.target.style.setProperty('--escala', String(e.contentRect.width / 1920));
});
// 28 sep 2026: encoger la vista completa, no recortar sus 480 px en el móvil.
const escalarRotativo = new ResizeObserver((entradas) => {
  for (const e of entradas) e.target.style.setProperty('--escala', String(e.contentRect.width / 480));
});
for (const visor of document.querySelectorAll('.ovl-panel-vista')) escalarRotativo.observe(visor);

// Las vistas previas van mudas: el jefe y el botín en demo suenan en bucle, y
// siguen sonando aunque cambies de pestaña. En OBS suenan como siempre.
const sinSonido = (url) => `${url}${url.includes('?') ? '&' : '?'}volumen=0`;

async function cargarBiblioteca() {
  await cargarReferencias();
  let lib;
  try {
    lib = await api('/api/biblioteca');
  } catch (err) {
    // 404 = el bot arrancó antes de que existiera la biblioteca.
    tostada(err.message === 'no existe' ? 'Reinicia el bot para ver la Biblioteca (Ctrl+C y npm start)' : err.message, true);
    return;
  }

  $('n-sonidos').textContent = lib.sonidos.length ? `${lib.sonidos.length} archivos · se regeneran con npm run sonidos` : '';
  $('b-sonidos').replaceChildren(...(lib.sonidos.length
    ? lib.sonidos.map((s) => {
      const duracion = h('span', { class: 'dato' }, s.duracionSeg ? `${s.duracionSeg.toFixed(1)} s` : '');
      if (!s.duracionSeg) {
        const meta = new Audio();
        meta.preload = 'metadata';
        meta.addEventListener('loadedmetadata', () => {
          if (Number.isFinite(meta.duration)) duracion.textContent = `${meta.duration.toFixed(1)} s`;
        });
        meta.src = s.url;
      }
      return h('div', { class: 'sonido' },
        botonEscuchar(s.url),
        h('div', { class: 'sonido-info' },
          h('strong', {}, s.nombre),
          h('span', { class: 'sonido-meta' }, usadoEn(s.usadoPor), duracion, h('span', { class: 'dato' }, tamano(s.bytes)))),
        botonCopiar(s.ruta));
    })
    : [vacioBiblioteca('sonidos', 'No hay sonidos. Genera los de los efectos con npm run sonidos, o mete los tuyos.')]));

  const overlaysBiblioteca = lib.overlays.flatMap(o => o.nombre === 'jefe.html' ? [o, { ...o, vista: 'especiales' }, { ...o, vista: 'aliados' }, { ...o, vista: 'duelo' }] : [o]);
  $('b-overlays').replaceChildren(...(overlaysBiblioteca.length
    ? overlaysBiblioteca.map((o) => {
      const vars = VARIANTES_OVERLAY[o.vista || o.nombre] || [];
      let actual = vars[0]?.q ?? '';
      const marco = h('iframe', { src: sinSonido(o.url + actual), sandbox: 'allow-scripts', title: o.nombre, tabindex: '-1' });
      const vista = h('div', { class: 'overlay-vista' }, marco);
      escalarOverlay.observe(vista);
      const chips = vars.length > 1 && h('div', { class: 'variantes chips', role: 'group', 'aria-label': 'Variantes' },
        vars.map((v, i) => h('button', {
          type: 'button', class: 'chip', 'aria-pressed': String(i === 0),
          onclick: (ev) => {
            actual = v.q;
            marco.src = sinSonido(o.url + actual);
            for (const b of ev.currentTarget.parentNode.children) b.setAttribute('aria-pressed', String(b === ev.currentTarget));
          },
        }, v.nombre)));
      return h('article', { class: 'overlay' },
        vista,
        chips,
        h('div', { class: 'overlay-pie' },
          h('div', { class: 'sonido-info' }, h('strong', {}, o.vista === 'duelo' ? 'Duelo · !duelo' : o.vista === 'especiales' ? 'Ataques especiales' : o.vista === 'aliados' ? 'Ataques del chat' : o.nombre === 'jefe.html' ? 'Jefes de raid' : o.nombre === 'escena.html' ? 'Escenas actuales' : o.nombre === 'espectadores.html' ? 'Contador de espectadores' : o.nombre), h('span', { class: 'sonido-meta' }, o.vista === 'duelo' ? 'La misma fuente «FX Jefe», con cada duelo del chat' : o.vista === 'especiales' ? 'Elige un jefe para ver su ataque en bucle' : o.vista === 'aliados' ? 'Subs, regalos y bits contra el jefe, en bucle' : o.nombre === 'escena.html' ? 'Fondos y textos configurados en Escenas' : o.nombre === 'espectadores.html' ? 'El número de Twitch · se oculta sin directo' : usadoEn(o.usadoPor))),
          // Misma dirección no recarga: se pasa por about:blank para repetir la animación.
          h('button', { class: 'boton pequeno', type: 'button', onclick: () => { marco.src = 'about:blank'; setTimeout(() => { marco.src = sinSonido(o.url + actual); }, 30); } }, '↻ Repetir'),
          h('button', { class: 'boton pequeno', type: 'button', title: 'Ver en grande', 'aria-label': `Ver ${o.nombre} en grande`, onclick: () => abrirGrande(sinSonido(o.url + actual), 'escena', o.nombre) }, '↗'),
          botonCopiar(o.ruta)));
    })
    : [vacioBiblioteca('overlays', 'No hay overlays todavía.')]));

  $('c-imagenes').textContent = String(lib.imagenes.length);
  $('c-sonidos').textContent = String(lib.sonidos.length);
  $('c-overlays').textContent = String(overlaysBiblioteca.length);
  $('c-referencias').textContent = String(catalogoReferencias.length);
  galeria.imagenes = lib.imagenes;
  pintarGaleria();
  cargarBocetos();
}

// ---------------------------------------------------------------------------
// Biblioteca → Bocetos (docs/previews): verlo todo y borrar lo que sobra
// ---------------------------------------------------------------------------

const bocetos = { lista: [], bytes: 0, sel: new Set(), carpeta: '', texto: '', sinCitar: false };
const urlBoceto = (ruta) => `/bocetos/${ruta.split('/').map(encodeURIComponent).join('/')}`;
const raizBoceto = (b) => b.carpeta.split('/')[0] || '(sueltos)';
const fechaCorta = (iso) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

async function cargarBocetos() {
  try {
    const r = await api('/api/bocetos');
    bocetos.lista = r.bocetos;
    bocetos.bytes = r.bytes;
  } catch (err) {
    $('b-bocetos').replaceChildren(h('p', { class: 'nota' }, err.message === 'no existe' ? 'Reinicia el bot para ver los bocetos (Ctrl+C y npm start).' : `No se pudieron cargar: ${err.message}`));
    return;
  }
  // Lo seleccionado que ya no existe, fuera.
  const existen = new Set(bocetos.lista.map((b) => b.ruta));
  for (const r of bocetos.sel) if (!existen.has(r)) bocetos.sel.delete(r);
  $('c-bocetos').textContent = String(bocetos.lista.length);
  $('n-bocetos').textContent = `docs/previews · ${bocetos.lista.length} archivos · ${tamano(bocetos.bytes)}`;
  pintarBocetos();
}

function visiblesBocetos() {
  const t = bocetos.texto.trim().toLowerCase();
  return bocetos.lista.filter((b) => (!bocetos.carpeta || raizBoceto(b) === bocetos.carpeta)
    && (!t || `${b.carpeta}/${b.nombre}`.toLowerCase().includes(t))
    && (!bocetos.sinCitar || !b.citadoEn.length));
}

function pintarSeleccionBocetos() {
  const elegidos = bocetos.lista.filter((b) => bocetos.sel.has(b.ruta));
  const bytes = elegidos.reduce((n, b) => n + b.bytes, 0);
  $('bo-n').textContent = elegidos.length ? `${elegidos.length} seleccionado${elegidos.length === 1 ? '' : 's'} · ${tamano(bytes)}` : 'Nada seleccionado';
  $('bo-borrar').disabled = !elegidos.length;
  $('bo-borrar').textContent = elegidos.length ? `🗑 Borrar ${elegidos.length}` : '🗑 Borrar seleccionados';
  $('bo-seleccion').classList.toggle('activa', elegidos.length > 0);
  for (const el of document.querySelectorAll('#b-bocetos [data-ruta]')) {
    const si = bocetos.sel.has(el.dataset.ruta);
    el.classList.toggle('elegido', si);
    el.querySelector('.boceto-marca input').checked = si;
  }
  for (const g of document.querySelectorAll('#b-bocetos [data-grupo]')) {
    const rutas = [...g.querySelectorAll('[data-ruta]')].map((el) => el.dataset.ruta);
    const n = rutas.filter((r) => bocetos.sel.has(r)).length;
    const marca = g.querySelector('.grupo-marca');
    marca.checked = n > 0 && n === rutas.length;
    marca.indeterminate = n > 0 && n < rutas.length;
  }
}

function vistaBoceto(b) {
  const url = urlBoceto(b.ruta);
  const ver = () => abrirGrande(url, b.clase, b.nombre);
  if (b.clase === 'imagen') {
    return h('button', { class: 'imagen-vista cuadros', type: 'button', 'aria-label': `Ver ${b.nombre} en grande`, onclick: ver },
      h('img', { src: url, alt: '', loading: 'lazy', decoding: 'async' }));
  }
  if (b.clase === 'escena' || b.clase === 'pagina') {
    const vista = h('div', { class: 'overlay-vista' },
      h('iframe', { src: url, loading: 'lazy', sandbox: 'allow-scripts', title: b.nombre, tabindex: '-1' }),
      h('button', { class: 'boceto-tapa', type: 'button', 'aria-label': `Ver ${b.nombre} en grande`, onclick: ver }));
    escalarOverlay.observe(vista);
    return vista;
  }
  if (b.clase === 'audio') return h('div', { class: 'overlay-vista boceto-icono' }, botonEscuchar(url, 'grande'));
  return h('button', { class: 'overlay-vista boceto-icono', type: 'button', 'aria-label': `Ver ${b.nombre}`, onclick: ver },
    h('span', {}, '📄'), h('small', {}, b.nombre.split('.').pop().toUpperCase()));
}

function pintarBocetos() {
  // Carpetas de primer nivel, con cuántos hay en cada una.
  const cuenta = new Map();
  for (const b of bocetos.lista) cuenta.set(raizBoceto(b), (cuenta.get(raizBoceto(b)) ?? 0) + 1);
  if (bocetos.carpeta && !cuenta.has(bocetos.carpeta)) bocetos.carpeta = '';
  $('bo-carpetas').replaceChildren(
    h('button', { type: 'button', class: 'chip', 'aria-pressed': String(!bocetos.carpeta), onclick: () => { bocetos.carpeta = ''; pintarBocetos(); } }, `Todas ${bocetos.lista.length}`),
    ...[...cuenta].map(([c, n]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(bocetos.carpeta === c), onclick: () => { bocetos.carpeta = c; pintarBocetos(); } }, `${c} ${n}`)));

  const visibles = visiblesBocetos();
  const grupos = new Map();
  for (const b of visibles) {
    if (!grupos.has(b.carpeta)) grupos.set(b.carpeta, []);
    grupos.get(b.carpeta).push(b);
  }
  $('b-bocetos').replaceChildren(...(grupos.size
    ? [...grupos].map(([carpeta, lista]) => {
      const marcaGrupo = h('input', { type: 'checkbox', class: 'grupo-marca', 'aria-label': `Seleccionar todo ${carpeta || 'docs/previews'}`, onclick: (ev) => ev.stopPropagation(), onchange: (ev) => {
        for (const b of lista) ev.target.checked ? bocetos.sel.add(b.ruta) : bocetos.sel.delete(b.ruta);
        pintarSeleccionBocetos();
      } });
      return h('details', { class: 'grupo-bocetos', open: true, 'data-grupo': carpeta },
        h('summary', {}, marcaGrupo, h('strong', {}, carpeta || 'docs/previews'),
          h('span', { class: 'nota' }, `${lista.length} · ${tamano(lista.reduce((n, b) => n + b.bytes, 0))}`)),
        h('div', { class: 'lista-bocetos' }, lista.map((b) => {
          const citado = b.citadoEn.length
            ? h('span', { class: 'usado', title: b.citadoEn.join('\n') }, 'Citado en ', b.citadoEn.slice(0, 2).map((r) => r.split('/').pop()).join(', '), b.citadoEn.length > 2 ? ` y ${b.citadoEn.length - 2} más` : '')
            : h('span', { class: 'usado libre' }, 'Nadie lo cita');
          return h('article', { class: 'overlay boceto', 'data-ruta': b.ruta },
            vistaBoceto(b),
            h('label', { class: 'boceto-marca', title: 'Seleccionar' }, h('input', { type: 'checkbox', 'aria-label': `Seleccionar ${b.nombre}`, onchange: (ev) => {
              ev.target.checked ? bocetos.sel.add(b.ruta) : bocetos.sel.delete(b.ruta);
              pintarSeleccionBocetos();
            } })),
            h('div', { class: 'overlay-pie' },
              h('div', { class: 'sonido-info' }, h('strong', { title: b.ruta }, b.nombre),
                h('span', { class: 'sonido-meta' }, citado, h('span', { class: 'dato' }, `${tamano(b.bytes)} · ${fechaCorta(b.modificado)}`))),
              h('button', { class: 'boton pequeno', type: 'button', title: 'Ver en grande', 'aria-label': `Ver ${b.nombre} en grande`, onclick: () => abrirGrande(urlBoceto(b.ruta), b.clase, b.nombre) }, '↗'),
              h('button', { class: 'boton pequeno peligro', type: 'button', title: 'Borrar (a la Papelera)', 'aria-label': `Borrar ${b.nombre}`, onclick: () => borrarBocetos([b.ruta]) }, '🗑')));
        })));
    })
    : [h('p', { class: 'nota' }, bocetos.lista.length ? 'Nada con ese filtro.' : 'No hay bocetos: docs/previews está vacía.')]));
  pintarSeleccionBocetos();
}

async function borrarBocetos(rutas) {
  const elegidos = bocetos.lista.filter((b) => rutas.includes(b.ruta));
  if (!elegidos.length) return;
  const citados = elegidos.filter((b) => b.citadoEn.length);
  const nombres = elegidos.slice(0, 8).map((b) => `· ${b.carpeta ? `${b.carpeta}/` : ''}${b.nombre}`).join('\n') + (elegidos.length > 8 ? `\n· y ${elegidos.length - 8} más` : '');
  const aviso = citados.length
    ? `\n\n⚠ ${citados.length === 1 ? 'Uno aparece citado' : `${citados.length} aparecen citados`} en documentos o código (${[...new Set(citados.flatMap((b) => b.citadoEn))].slice(0, 4).join(', ')}): esos enlaces quedarían rotos.`
    : '';
  if (!confirm(`¿Mandar ${elegidos.length === 1 ? 'este archivo' : `estos ${elegidos.length} archivos`} (${tamano(elegidos.reduce((n, b) => n + b.bytes, 0))}) a la Papelera de Windows?\n\n${nombres}${aviso}`)) return;
  $('bo-borrar').disabled = true;
  try {
    const r = await api('/api/bocetos/borrar', { rutas: elegidos.map((b) => b.ruta) });
    for (const ruta of r.borrados) bocetos.sel.delete(ruta);
    tostada(r.fallos.length
      ? `${r.borrados.length} a la Papelera · ${r.fallos.length} no se pudieron borrar: ${r.fallos[0].error}`
      : `${r.borrados.length === 1 ? 'Enviado' : `${r.borrados.length} enviados`} a la Papelera de Windows`, r.fallos.length > 0);
  } catch (err) {
    tostada(err.message, true);
  }
  await cargarBocetos();
}

$('bo-buscar').addEventListener('input', (ev) => { bocetos.texto = ev.target.value; pintarBocetos(); });
$('bo-sin-citar').addEventListener('change', (ev) => { bocetos.sinCitar = ev.target.checked; pintarBocetos(); });
$('bo-todo').addEventListener('click', () => { for (const b of visiblesBocetos()) bocetos.sel.add(b.ruta); pintarSeleccionBocetos(); });
$('bo-nada').addEventListener('click', () => { bocetos.sel.clear(); pintarSeleccionBocetos(); });
$('bo-borrar').addEventListener('click', () => borrarBocetos([...bocetos.sel]));


// ---------------------------------------------------------------------------
// Escenas (Empezamos, Charla, Pausa, Final)
// ---------------------------------------------------------------------------

const ESCENAS_INFO = {
  retro: { icono: '🎮', nombre: 'Empezando pronto · Retro', que: 'Habitación gamer nocturna con lluvia, monitores, luces suaves y un erizo que cruza ocasionalmente.' },
  inicio: { icono: '🌅', nombre: 'Empezamos', que: 'Antes de empezar: título, cuenta atrás, evento de la semana, podio y últimos botines.' },
  charla: { icono: '💬', nombre: 'Charla', que: 'Just Chatting: marco para tu cámara, chat en pantalla con emotes, evento, podio y próximo cofre. Con el avatar, sin cámara.' },
  compartir: { icono: '📺', nombre: 'Charla + compartir', que: 'Webcam a pantalla completa y tu captura a la derecha, opaca o con algo de transparencia. Es una escena independiente de Charla.' },
  pausa: { icono: '⏳', nombre: 'Pausa', que: 'Vuelvo enseguida: reloj de arena y cuenta atrás si la pones.' },
  final: { icono: '🌙', nombre: 'Final', que: 'Gracias por venir: resumen del directo y los nombres de quien ha pasado, en créditos.' },
};

let escenas = null;
let escenasPintadas = false;
let escenaElegida = 'inicio';
function elegirEscena(tipo) {
  if (!ESCENAS_INFO[tipo]) return;
  escenaElegida = tipo;
  for (const b of $('e-selector').children) b.setAttribute('aria-pressed', String(b.dataset.tipo === tipo));
  for (const tarjeta of $('e-lista').children) tarjeta.hidden = tarjeta.dataset.tipo !== tipo;
  const mandos = document.querySelector(`#e-lista [data-tipo="${tipo}"] .escena-controles`);
  if (!mandos) return;
  const vista = mandos.parentElement.querySelector('.escena-vista');
  vista.style.setProperty('--escala', String(vista.clientWidth / 1920));
  if (tipo === 'compartir' || tipo === 'retro') return;
  mandos.append($('e-control-textos'), $('e-control-cuenta'));
  $('e-control-cuenta').hidden = !['inicio', 'pausa'].includes(tipo);
  const claves = { inicio: ['titulo', 'subtitulo'], charla: ['charla'], pausa: ['pausa'], final: ['final'] }[tipo];
  for (const input of document.querySelectorAll('#e-textos [data-clave]')) input.closest('label').hidden = !claves.includes(input.dataset.clave);
}
const descripcionesFondo = {};
/** El selector de fondo de cada escena, para rellenarlo cada vez que se carga. */
const selectoresFondo = {};

function fechaFondo(iso) {
  return new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const estiloActual = () => escenas.estilos.find((e) => e.id === escenas.config.estilo) ?? escenas.estilos[0];
const iconoEstilo = (id) => escenas.estilos.find((e) => e.id === id)?.icono ?? '';

function pintarSelectoresFondo() {
  const estilo = escenas.config.estilo;
  for (const [tipo, sel] of Object.entries(selectoresFondo)) {
    if (document.activeElement === sel) continue;
    const elegido = escenas.config.fondos?.[tipo];
    // Sin elegir: el último de esta escena en este estilo (lo mismo que hace el overlay).
    const propios = escenas.fondos.filter((f) => f.escena === tipo && f.estilo === estilo);
    const actual = elegido === 'dibujado' ? 'dibujado' : elegido ?? propios[0]?.ruta ?? 'dibujado';
    const mismoEstilo = escenas.fondos.filter((f) => f.escena !== tipo && f.estilo === estilo);
    const otros = escenas.fondos.filter((f) => f.estilo !== estilo);
    const opcion = (f) => h('option', { value: f.ruta, selected: f.ruta === actual },
      `${f.estilo === estilo ? '' : `${iconoEstilo(f.estilo)} `}${ESCENAS_INFO[f.escena]?.icono ?? '🖼️'} ${f.titulo ?? ESCENAS_INFO[f.escena]?.nombre ?? 'Fondo'} · ${fechaFondo(f.at)}`);
    sel.replaceChildren(
      h('option', { value: 'dibujado', selected: actual === 'dibujado' }, 'Solo color (sin imagen)'),
      propios.length ? h('optgroup', { label: 'De esta escena' }, propios.map(opcion)) : null,
      mismoEstilo.length ? h('optgroup', { label: 'De otras escenas, mismo estilo' }, mismoEstilo.map(opcion)) : null,
      otros.length ? h('optgroup', { label: 'De otros estilos' }, otros.map(opcion)) : null);
  }
}

/** Los botones de estilo, y lo que depende del estilo: las descripciones por defecto. */
let estiloPintado = null;
function pintarEstilos() {
  const actual = estiloActual();
  $('e-estilos').replaceChildren(...escenas.estilos.map((e) => h('button', {
    type: 'button', class: `estilo estilo-${e.id}`, role: 'radio', 'aria-checked': String(e.id === actual.id),
    onclick: () => { if (e.id !== escenas.config.estilo) guardarEscenas({ estilo: e.id }, `${e.icono} ${e.nombre}: sale en unos segundos`); },
  }, h('span', {
    class: 'estilo-muestra', 'aria-hidden': 'true',
    style: e.propio ? `background: linear-gradient(160deg, ${e.propio.colores.cieloArriba}, ${e.propio.colores.principal} 60%, ${e.propio.colores.secundario})` : null,
  }, e.icono), h('strong', {}, e.nombre), h('span', { class: 'nota estilo-para' }, e.para))));
  $('e-estilo-nota').textContent = `Ahora: ${actual.icono} ${actual.nombre}`;
  $('e-estilo-editar').hidden = !actual.propio;
  $('e-estilo-nuevo').disabled = escenas.estilos.filter((e) => e.propio).length >= (escenas.opcionesEstilo?.max ?? 20);
  if (!generandoTodo) $('e-estilo-generar').disabled = !escenas.imagenIa;
  // Al cambiar de estilo, las descripciones pasan a las del nuevo (si no las estás escribiendo).
  if (estiloPintado === actual.id) return;
  estiloPintado = actual.id;
  for (const [tipo, area] of Object.entries(descripcionesFondo)) {
    if (document.activeElement !== area) area.value = actual.descripciones?.[tipo] ?? '';
  }
  if (document.activeElement !== $('e-avatar-desc')) $('e-avatar-desc').value = actual.descripcionAvatar ?? '';
}

async function cargarEscenas() {
  try {
    escenas = await api('/api/escenas');
    await cargarReferencias();
    if (!document.querySelector('[data-referencias=avatar]')) $('e-avatar-desc').closest('label').after(selectorReferencias('avatar'));
  } catch (err) {
    tostada(err.message === 'no existe' ? 'Reinicia el bot para ver las Escenas (Ctrl+C y npm start)' : err.message, true);
    return;
  }
  const c = escenas.config;
  for (const input of document.querySelectorAll('#e-textos [data-clave]')) {
    if (document.activeElement !== input) input.value = c[input.dataset.clave] ?? '';
  }
  if (document.activeElement !== $('e-avatar-dice')) $('e-avatar-dice').value = c.avatarTexto;
  $('e-avatar').checked = c.avatar;
  $('e-avatar-texto-estado').textContent = c.avatar ? 'Avatar encendido' : 'Avatar apagado';
  pintarCuentaEscenas();
  cargarOverlays();
  if (escenasPintadas) { pintarSelectoresFondo(); pintarEstilos(); }
  pintarPersonajes();

  // Las tarjetas, una vez: rehacerlas recargaría las vistas previas.
  if (escenasPintadas) return;
  escenasPintadas = true;
  $('e-avatar-vista').src = '/biblioteca/overlays/avatar.html?siempre=1&fondo=1&bocadillo=reacciones';
  $('e-avatar-generar').disabled = !escenas.imagenIa;
  $('e-selector').replaceChildren(...Object.entries(ESCENAS_INFO).map(([tipo, info]) => h('button', {
    type: 'button', class: 'boton', 'data-tipo': tipo, 'aria-pressed': String(tipo === escenaElegida),
    onclick: () => elegirEscena(tipo),
  }, `${info.icono} ${info.nombre}`)));
  $('e-lista').replaceChildren(...escenas.escenas.map((e) => {
    const info = ESCENAS_INFO[e.tipo];
    const ruta = `/biblioteca/overlays/escena.html?tipo=${e.tipo}`;
    const vista = h('div', { class: 'overlay-vista escena-vista' }, h('iframe', { src: ruta, sandbox: 'allow-scripts', title: info.nombre, tabindex: '-1' }));
    escalarOverlay.observe(vista);
    const resultado = h('ul', { class: 'escena-resultado', hidden: true });
    const crear = h('button', { class: 'boton primario', type: 'button' }, '🎬 Crear en OBS');
    crear.addEventListener('click', async () => {
      const extra = e.tipo === 'charla' ? ' con el overlay, tu cámara en el hueco del marco y la barra del jefe' : ' con el overlay';
      if (!confirm(`Se creará (o completará) la escena «${e.escena}» en OBS${extra}.\n\nNo cambia la escena que estás emitiendo ni borra nada. ¿Sigo?`)) return;
      crear.disabled = true;
      try {
        const r = await api('/api/escenas/obs', { tipo: e.tipo });
        resultado.hidden = false;
        resultado.replaceChildren(...r.hecho.map((x) => h('li', {}, x)));
        tostada(`«${e.escena}» lista en OBS`);
      } catch (err) {
        tostada(err.message, true);
      } finally {
        crear.disabled = false;
      }
    });
    // El fondo: uno de los generados, o generar otro con IA.
    const selFondo = h('select', { 'aria-label': `Fondo de ${info.nombre}` });
    selectoresFondo[e.tipo] = selFondo;
    selFondo.addEventListener('change', () => guardarEscenas({ fondos: { [e.tipo]: selFondo.value || null } }, 'Fondo cambiado: sale en unos segundos'));
    const descripcion = h('textarea', { rows: '2', maxlength: '600', spellcheck: 'false' });
    descripcionesFondo[e.tipo] = descripcion;
    const titulo = h('input', { type: 'text', maxlength: '40', autocomplete: 'off', placeholder: 'Vacío = sale de la descripción' });
    const generar = h('button', { class: 'boton', type: 'button', disabled: !escenas.imagenIa }, '🎨 Generar fondo con IA');
    generar.addEventListener('click', async () => {
      generar.disabled = true;
      generar.textContent = '🎨 Generando… (unos 30 s)';
      try {
        const r = await api('/api/escenas/fondo', { escena: e.tipo, descripcion: descripcion.value, titulo: titulo.value, referencias: seleccionReferencias(e.tipo) });
        await cargarEscenas();
        const nuevo = escenas.fondos.find((f) => f.ruta === r.ruta);
        tostada(`Fondo nuevo en ${info.nombre}: «${nuevo?.titulo ?? 'sin título'}»`);
        titulo.value = '';
      } catch (err) {
        tostada(err.message, true);
      } finally {
        generar.disabled = !escenas.imagenIa;
        generar.textContent = '🎨 Generar fondo con IA';
      }
    });
    const renombrar = h('button', { class: 'boton', type: 'button', title: 'Cambiar el título de este fondo', 'aria-label': 'Cambiar el título' }, '✏️');
    renombrar.addEventListener('click', () => renombrarImagen(selFondo.value, escenas.fondos.find((f) => f.ruta === selFondo.value)?.titulo));
    const borrar = h('button', { class: 'boton peligro', type: 'button', title: 'Borrar este fondo para siempre', 'aria-label': 'Borrar este fondo' }, '🗑');
    borrar.addEventListener('click', () => borrarImagen(selFondo.value, escenas.fondos.find((f) => f.ruta === selFondo.value)?.titulo));
    descripcion.placeholder = 'Ejemplo: Castillo de Aden de Lineage 2, de día';
    const bloqueFondo = h('div', { class: 'escena-fondo' },
      h('div', { class: 'campo' }, h('span', {}, 'Fondo · se aplica al elegir'), h('div', { class: 'con-boton' }, selFondo, renombrar, borrar)),
      h('details', { class: 'escena-avanzado' }, h('summary', {}, 'Crear un fondo con IA · de pago'),
        h('label', { class: 'campo' }, h('span', {}, 'Qué quieres ver: juego, lugar y ambiente'), descripcion),
        h('p', { class: 'nota' }, 'Tu descripción se envía literal y tiene prioridad sobre el estilo. El nombre de abajo solo sirve para organizar el fondo; no describe la imagen.'),
        selectorReferencias(e.tipo),
        h('label', { class: 'campo' }, h('span', {}, 'Nombre para guardar en la biblioteca'), titulo),
        h('div', { class: 'escena-botones' }, generar,
          h('span', { class: 'nota' }, escenas.imagenIa ? '1 imagen de pago · requiere confirmación' : 'Generación no configurada'))));

    return h('article', { class: 'tarjeta escena', 'data-tipo': e.tipo, hidden: e.tipo !== escenaElegida },
      h('div', { class: 'escena-presentacion' }, vista,
      h('div', { class: 'escena-pie' },
        h('div', {}, h('h2', {}, `${info.icono} ${info.nombre}`), h('p', { class: 'nota' }, info.que),
          h('p', { class: 'nota' }, 'En OBS: ', h('code', {}, e.escena))),
        h('div', { class: 'escena-botones' },
          h('button', { class: 'boton', type: 'button', onclick: () => abrirGrande(ruta, 'escena', info.nombre) }, '↗ Ver en grande'),
          botonCopiar(e.url, 'Copiar dirección'))),
        h('details', { class: 'escena-avanzado escena-obs' }, h('summary', {}, 'Configurar esta escena en OBS'), crear, resultado)),
      h('div', { class: 'escena-controles' }, bloqueFondo));
  }));
  const rutaCompartir = '/biblioteca/overlays/charla-compartida.html';
  let opacidadInicial = 100;
  try {
    const guardada = Number(localStorage.getItem('charla-compartida-opacidad-v2'));
    if (guardada >= 65 && guardada <= 100) opacidadInicial = guardada;
  } catch { /* sin almacenamiento, se usa el valor por defecto */ }
  const rutaDemoCompartir = (n) => `${rutaCompartir}?demo=1&opacidad=${n / 100}`;
  const vistaCompartir = h('div', { class: 'overlay-vista escena-vista' },
    h('iframe', { src: rutaDemoCompartir(opacidadInicial), sandbox: 'allow-scripts', title: 'Vista previa de Charla + compartir', tabindex: '-1' }));
  escalarOverlay.observe(vistaCompartir);
  const elegirCaptura = h('select', { id: 'e-compartir-fuente', 'aria-label': 'Captura que vas a compartir' },
    h('option', { value: '' }, 'Sin captura todavía'));
  const valorOpacidad = h('output', {}, `${opacidadInicial} %`);
  const elegirOpacidad = h('input', { id: 'e-compartir-opacidad', type: 'range', min: '65', max: '100', step: '1', value: String(opacidadInicial), 'aria-label': 'Opacidad del contenido compartido' });
  let rutaCompartirGrande = rutaDemoCompartir(opacidadInicial);
  const verCompartirGrande = h('button', { class: 'boton', type: 'button', onclick: () => abrirGrande(rutaCompartirGrande, 'escena', 'Charla + compartir') }, '↗ Ver en grande');
  let esperaOpacidad;
  elegirOpacidad.addEventListener('input', () => {
    valorOpacidad.textContent = `${elegirOpacidad.value} %`;
    clearTimeout(esperaOpacidad);
    esperaOpacidad = setTimeout(() => {
      const ruta = rutaDemoCompartir(Number(elegirOpacidad.value));
      vistaCompartir.querySelector('iframe').src = ruta;
      rutaCompartirGrande = ruta;
      try { localStorage.setItem('charla-compartida-opacidad-v2', elegirOpacidad.value); } catch { /* sin almacenamiento */ }
    }, 180);
  });
  const resultadoCompartir = h('ul', { class: 'escena-resultado', hidden: true });
  const crearCompartir = h('button', { class: 'boton primario', type: 'button' }, '🎬 Crear en OBS');
  crearCompartir.addEventListener('click', async () => {
    if (!confirm('Se creará la escena «✦ Charla + compartir» en OBS con tu webcam, la captura elegida y el overlay. No cambia la escena en emisión. ¿Sigo?')) return;
    crearCompartir.disabled = true;
    try {
      const r = await api('/api/escenas/obs', { tipo: 'compartir', fuenteCompartida: elegirCaptura.value, opacidad: Number(elegirOpacidad.value) / 100 });
      resultadoCompartir.hidden = false;
      resultadoCompartir.replaceChildren(...r.hecho.map((x) => h('li', {}, x)));
      tostada('Charla + compartir lista en OBS');
    } catch (err) { tostada(err.message, true); }
    finally { crearCompartir.disabled = false; }
  });
  $('e-lista').append(h('article', { class: 'tarjeta escena', 'data-tipo': 'compartir', hidden: escenaElegida !== 'compartir' },
    h('div', { class: 'escena-presentacion' }, vistaCompartir,
      h('div', { class: 'escena-pie' },
        h('div', {}, h('h2', {}, '📺 Charla + compartir'), h('p', { class: 'nota' }, ESCENAS_INFO.compartir.que),
          h('p', { class: 'nota' }, 'La vista previa usa imágenes de ejemplo. En OBS se verá tu webcam y la fuente que elijas.')),
        h('div', { class: 'escena-botones' }, verCompartirGrande, botonCopiar(`${location.origin}${rutaCompartir}`, 'Copiar dirección'))),
      h('div', { class: 'escena-controles' },
        h('label', { class: 'campo' }, h('span', {}, 'Qué compartes'), elegirCaptura),
        h('label', { class: 'campo' }, h('span', {}, 'Opacidad del contenido · ', valorOpacidad), elegirOpacidad),
        h('p', { class: 'nota' }, 'La webcam llena el fondo y la captura va a la derecha: al 100 % se lee mejor; por debajo deja ver la webcam a través. Es tu misma captura (si cambias de ventana, aquí también). El ajuste se aplica en OBS al pulsar «Crear en OBS».'),
        h('div', { class: 'escena-botones' }, crearCompartir), resultadoCompartir))));
  const rutaRetro = '/biblioteca/overlays/empezando-pronto.html';
  const vistaRetro = h('div', { class: 'overlay-vista escena-vista' }, h('iframe', { src: rutaRetro, sandbox: 'allow-scripts', title: ESCENAS_INFO.retro.nombre, tabindex: '-1' }));
  escalarOverlay.observe(vistaRetro);
  const resultadoRetro = h('ul', { class: 'escena-resultado', hidden: true });
  const crearRetro = h('button', { class: 'boton primario', type: 'button' }, '🎬 Crear en OBS');
  crearRetro.addEventListener('click', async () => {
    if (!confirm('Se creará o completará «✦ Empezando pronto · Retro» en OBS. No cambia la escena que estás emitiendo. ¿Sigo?')) return;
    crearRetro.disabled = true;
    try {
      const r = await api('/api/escenas/obs', { tipo: 'retro' });
      resultadoRetro.hidden = false;
      resultadoRetro.replaceChildren(...r.hecho.map((x) => h('li', {}, x)));
      tostada('Empezando pronto · Retro lista en OBS');
    } catch (err) { tostada(err.message, true); }
    finally { crearRetro.disabled = false; }
  });
  $('e-lista').append(h('article', { class: 'tarjeta escena', 'data-tipo': 'retro', hidden: escenaElegida !== 'retro' },
    h('div', { class: 'escena-presentacion' }, vistaRetro,
      h('div', { class: 'escena-pie' },
        h('div', {}, h('h2', {}, '🎮 Empezando pronto · Retro'), h('p', { class: 'nota' }, ESCENAS_INFO.retro.que),
          h('p', { class: 'nota' }, 'En OBS: ', h('code', {}, '✦ Empezando pronto · Retro'))),
        h('div', { class: 'escena-botones' },
          h('button', { class: 'boton', type: 'button', onclick: () => abrirGrande(rutaRetro, 'escena', ESCENAS_INFO.retro.nombre) }, '↗ Ver en grande'),
          botonCopiar(`${location.origin}${rutaRetro}`, 'Copiar dirección'))),
      h('div', { class: 'escena-controles' }, h('p', { class: 'nota' }, 'La vista previa es la escena animada real. Crear en OBS solo prepara una escena independiente.'),
        h('div', { class: 'escena-botones' }, crearRetro), resultadoRetro))));
  cargarEscenasObs();
  pintarSelectoresFondo();
  pintarEstilos();
  elegirEscena(escenaElegida);
}

function pintarCuentaEscenas() {
  if (!escenas) return;
  const hasta = escenas.config.hasta ? new Date(escenas.config.hasta) : null;
  const falta = hasta ? hasta.getTime() - Date.now() : 0;
  $('e-cuenta-estado').textContent = !hasta
    ? 'Sin cuenta atrás'
    : falta > 0
      ? `Hasta las ${hasta.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} · faltan ${mmss(Math.ceil(falta / 1000))}`
      : 'Terminada: sale «¡Arrancamos!»';
}
setInterval(() => { if (!$('v-escenas').hidden) pintarCuentaEscenas(); }, 1000);

async function guardarEscenas(cambios, aviso) {
  try {
    escenas = { ...escenas, ...(await api('/api/escenas', cambios)) };
    if (aviso) tostada(aviso);
    cargarEscenas();
  } catch (err) {
    tostada(err.message, true);
  }
}

$('e-cuenta').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-min]');
  if (!b) return;
  guardarEscenas({ hasta: new Date(Date.now() + Number(b.dataset.min) * 60_000).toISOString() }, `Cuenta atrás de ${b.dataset.min} min`);
});
$('e-hora-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const [hh, mm] = $('e-hora').value.split(':').map(Number);
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  // Si esa hora ya ha pasado hoy, es la de mañana.
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  guardarEscenas({ hasta: d.toISOString() }, `Cuenta atrás hasta las ${$('e-hora').value}`);
});
$('e-quitar').addEventListener('click', () => guardarEscenas({ hasta: null }, 'Cuenta atrás quitada'));
$('e-avatar').addEventListener('change', (ev) => guardarEscenas({ avatar: ev.target.checked }, ev.target.checked ? '🧙 Avatar en pantalla' : 'Vuelve la cámara'));
$('e-avatar-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  guardarEscenas({ avatarTexto: $('e-avatar-dice').value }, 'Bocadillo guardado');
});
function pintarPersonajes() {
  const sel = $('e-avatar-personaje');
  if (document.activeElement === sel) return;
  const actual = escenas.config.avatarImagen ?? '';
  const estilo = escenas.config.estilo;
  const nombre = (p) => (p.ruta.endsWith('/errante') ? 'El errante (el primero)' : `${p.titulo ?? 'Personaje'} · ${fechaFondo(p.at)}`);
  const propios = (escenas.personajes ?? []).filter((p) => p.estilo === estilo);
  const otros = (escenas.personajes ?? []).filter((p) => p.estilo !== estilo);
  // Sin elegir: el último de este estilo, y si aún no hay, el errante.
  sel.replaceChildren(
    h('option', { value: '', selected: !actual }, propios.length ? 'El último de este estilo' : 'El errante (este estilo aún no tiene personaje)'),
    propios.length ? h('optgroup', { label: 'De este estilo' }, propios.map((p) => h('option', { value: p.ruta, selected: p.ruta === actual }, nombre(p)))) : null,
    otros.length ? h('optgroup', { label: 'De otros estilos' }, otros.map((p) => h('option', { value: p.ruta, selected: p.ruta === actual }, `${iconoEstilo(p.estilo)} ${nombre(p)}`))) : null);
}

/** Cambia el título de un fondo o de un personaje generado. */
async function renombrarImagen(ruta, actual) {
  if (!ruta || ruta === 'dibujado') return tostada('Elige primero un fondo o personaje generado', true);
  const nuevo = prompt('Nuevo título (máximo 40 letras):', actual ?? '');
  if (nuevo === null || !nuevo.trim()) return;
  try {
    const r = await api('/api/escenas/titulo', { ruta, titulo: nuevo });
    tostada(`Ahora se llama «${r.titulo}»`);
    await cargarEscenas();
  } catch (err) {
    tostada(err.message, true);
  }
}
/** Borra de verdad un fondo o un personaje generado (pregunta antes). */
async function borrarImagen(ruta, titulo) {
  if (!ruta || ruta === 'dibujado') return tostada('Elige primero un fondo o personaje generado', true);
  if (ruta === 'imagenes/avatar/errante') return tostada('El errante no se borra: es el que sale cuando un estilo no tiene personaje', true);
  if (!confirm(`¿Borrar «${titulo ?? 'esta imagen'}» para siempre?

Se elimina el archivo; si estaba puesto, sale el último que quede.`)) return;
  try {
    await api('/api/escenas/imagen/borrar', { ruta });
    tostada(`«${titulo ?? 'Imagen'}» borrada`);
    await cargarEscenas();
  } catch (err) {
    tostada(err.message, true);
  }
}
$('e-avatar-borrar').addEventListener('click', () => {
  const sel = $('e-avatar-personaje');
  const ruta = sel.value || escenas.personajes.find((p) => p.estilo === escenas.config.estilo)?.ruta || 'imagenes/avatar/errante';
  borrarImagen(ruta, escenas.personajes.find((p) => p.ruta === ruta)?.titulo);
});
$('e-avatar-local').addEventListener('click', () => {
  const ruta = $('e-avatar-personaje').value || escenas.personajes.find(p => p.estilo === escenas.config.estilo)?.ruta || 'imagenes/avatar/errante';
  abrirAvatarLocal(ruta, escenas.personajes.find(p => p.ruta === ruta)?.titulo ?? 'Personaje');
});
$('e-avatar-parpadeo').addEventListener('click', async (ev) => {
  const sel = $('e-avatar-personaje');
  const ruta = sel.value || escenas.personajes.find((p) => p.estilo === escenas.config.estilo)?.ruta || 'imagenes/avatar/errante';
  const nombre = escenas.personajes.find((p) => p.ruta === ruta)?.titulo ?? 'este personaje';
  if (!confirm(`Se rehacen los ojos entornados, cerrados y la sonrisa de «${nombre}» retocando solo su cara, y un modelo que ve comprueba cada una (si alguna sale mal, se repite una vez).

3 imágenes de tu OpenAI (hasta 6 si hay que repetir; más llamadas de visión; precio según modelo y calidad). ¿Sigo?`)) return;
  const b = ev.currentTarget;
  b.disabled = true;
  b.textContent = '⏳';
  try {
    const r = await api('/api/escenas/avatar-rehacer', { ruta, maxImagenes: 6 });
    const aviso = !r.zonas ? 'Rehecho, pero no se localizó la cara: puede seguir moviéndose al parpadear'
      : r.dudosas?.length ? `Rehecho, pero ${r.dudosas.join(' y ')} no ha salido bien ni a la segunda: vuelve a pulsar 👁` : `Parpadeo arreglado en «${nombre}»`;
    tostada(aviso, !r.zonas || !!r.dudosas?.length);
    $('e-avatar-vista').src = $('e-avatar-vista').src;
  } catch (err) {
    tostada(err.message, true);
  } finally {
    b.disabled = false;
    b.textContent = '👁';
  }
});
$('e-avatar-renombrar').addEventListener('click', () => {
  const sel = $('e-avatar-personaje');
  // «El último de este estilo» no es una ruta: el que se ve es el primero de los suyos.
  const ruta = sel.value || escenas.personajes.find((p) => p.estilo === escenas.config.estilo)?.ruta || 'imagenes/avatar/errante';
  renombrarImagen(ruta, escenas.personajes.find((p) => p.ruta === ruta)?.titulo);
});

$('e-avatar-personaje').addEventListener('change', (ev) => guardarEscenas({ avatarImagen: ev.target.value || null }, 'Personaje cambiado'));
$('e-avatar-generar').addEventListener('click', async (ev) => {
  const b = ev.currentTarget;
  b.disabled = true;
  b.textContent = '🎨 Creando… (≈1 min)';
  try {
    const r = await api('/api/escenas/avatar-ia', { descripcion: $('e-avatar-desc').value, titulo: $('e-avatar-titulo').value, referencias: seleccionReferencias('avatar') });
    await cargarEscenas();
    tostada(`Personaje nuevo: «${escenas.personajes.find((p) => p.ruta === r.ruta)?.titulo ?? 'sin nombre'}», ya es el del avatar`);
    $('e-avatar-titulo').value = '';
  } catch (err) {
    tostada(err.message, true);
  } finally {
    b.disabled = !escenas.imagenIa;
    b.textContent = '🎨 Crear personaje';
  }
});

// ---------------------------------------------------------------------------
// Escenas → Estilo propio: el formulario, su vista previa y «Generar»
// ---------------------------------------------------------------------------

/** Ejemplos que rellenan el formulario: se pueden cambiar antes de guardar. */
const IDEAS_ESTILO = [
  { nombre: 'Aniimo', icono: '🦁', tematica: 'Mundo de fantasía de un RPG de anime moderno con criaturas legendarias, islas flotantes, ruinas antiguas y cielos luminosos al atardecer', base: 'redondo', letra: 'moderna', particulas: 'luces', colores: { principal: '#ffc53d', secundario: '#6ee7ff', cieloArriba: '#0d1a3a', cieloAbajo: '#e07a5f' } },
  { nombre: 'Neón', icono: '🌆', tematica: 'Ciudad cyberpunk de noche bajo la lluvia, rascacielos, carteles de neón rosa y cian, reflejos en el suelo mojado', base: 'oscuro', letra: 'futurista', particulas: 'lluvia', colores: { principal: '#ff2bd6', secundario: '#19e6ff', cieloArriba: '#0a0620', cieloAbajo: '#3a0a4a' } },
  { nombre: 'Retro', icono: '👾', tematica: 'Pixel art de videojuego clásico de 16 bits, colinas verdes, castillo a lo lejos, nubes redondas y monedas', base: 'redondo', letra: 'pixel', particulas: 'destellos', colores: { principal: '#ffb000', secundario: '#2a5bd7', cieloArriba: '#6cc4ff', cieloAbajo: '#c8f0ff' } },
  { nombre: 'Invierno', icono: '❄️', tematica: 'Pueblo nevado de montaña con cabañas de madera iluminadas, pinos cubiertos de nieve y auroras boreales', base: 'redondo', letra: 'editorial', particulas: 'nieve', colores: { principal: '#4fc3f7', secundario: '#5c6bc0', cieloArriba: '#1a2a5a', cieloAbajo: '#9ec9f0' } },
  { nombre: 'Océano', icono: '🌊', tematica: 'Mundo submarino mágico con arrecifes de coral de colores, medusas brillantes, rayos de luz y ruinas hundidas', base: 'redondo', letra: 'moderna', particulas: 'luces', colores: { principal: '#00e0c6', secundario: '#2b59c3', cieloArriba: '#0b3d91', cieloAbajo: '#3fd0e0' } },
];

const CAMPOS_COLOR = ['principal', 'secundario', 'cieloArriba', 'cieloAbajo'];
let editandoEstilo = null; // id del propio que se edita, o null si es nuevo

function datosFormEstilo() {
  return {
    nombre: $('ef-nombre').value, icono: $('ef-icono').value, tematica: $('ef-tematica').value,
    base: $('ef-base').value, letra: $('ef-letra').value, particulas: $('ef-particulas').value,
    colores: Object.fromEntries(CAMPOS_COLOR.map((k) => [k, $(`ef-${k}`).value])),
  };
}

function rellenarFormEstilo(e) {
  $('ef-nombre').value = e.nombre ?? '';
  $('ef-icono').value = e.icono ?? '';
  $('ef-tematica').value = e.tematica ?? '';
  $('ef-base').value = e.base ?? 'redondo';
  $('ef-letra').value = e.letra ?? 'moderna';
  $('ef-particulas').value = e.particulas ?? 'luces';
  for (const k of CAMPOS_COLOR) if (e.colores?.[k]) $(`ef-${k}`).value = e.colores[k];
  vistaEstilo();
}

// La vista previa se rehace al cambiar algo, con un respiro para no recargar a cada tecla.
let vistaTemporizador = null;
function vistaEstilo() {
  clearTimeout(vistaTemporizador);
  vistaTemporizador = setTimeout(() => {
    const d = datosFormEstilo();
    const ap = { base: d.base, letra: d.letra, particulas: d.particulas, colores: d.colores };
    $('ef-vista-marco').src = `/biblioteca/overlays/escena.html?tipo=inicio&demo=1&intro=0&ap=${encodeURIComponent(JSON.stringify(ap))}`;
  }, 250);
}

function abrirFormEstilo(estilo) {
  editandoEstilo = estilo?.id ?? null;
  rellenarFormEstilo(estilo ?? IDEAS_ESTILO[0]);
  if (!estilo) { $('ef-nombre').value = ''; $('ef-icono').value = ''; }
  $('ef-borrar').hidden = !editandoEstilo;
  $('e-estilo-form').hidden = false;
  escalarOverlay.observe($('ef-vista'));
  $('ef-nombre').focus();
}

$('e-estilo-ideas').replaceChildren(...IDEAS_ESTILO.map((idea) => h('button', { type: 'button', class: 'chip', onclick: () => rellenarFormEstilo(idea) }, `${idea.icono} ${idea.nombre}`)));
$('e-estilo-form').addEventListener('input', vistaEstilo);
$('e-estilo-nuevo').addEventListener('click', () => abrirFormEstilo(null));
$('e-estilo-editar').addEventListener('click', () => abrirFormEstilo(estiloActual().propio));
$('ef-cancelar').addEventListener('click', () => { $('e-estilo-form').hidden = true; });

$('e-estilo-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const generar = ev.submitter?.dataset.generar === '1';
  if (generar && !confirmarGenerar($('ef-nombre').value)) return;
  try {
    const r = await api('/api/escenas/estilo', { ...datosFormEstilo(), id: editandoEstilo ?? undefined });
    $('e-estilo-form').hidden = true;
    tostada(editandoEstilo ? 'Estilo guardado' : `${$('ef-icono').value || '✨'} Estilo creado: ya está puesto`);
    await cargarEscenas();
    if (generar) await generarTodoEstilo();
  } catch (err) {
    tostada(err.message, true);
  }
});

$('ef-borrar').addEventListener('click', async () => {
  if (!editandoEstilo || !confirm('¿Borrar este estilo? Sus imágenes se quedan en la Biblioteca.')) return;
  try {
    await api('/api/escenas/estilo/borrar', { id: editandoEstilo });
    $('e-estilo-form').hidden = true;
    tostada('Estilo borrado');
    await cargarEscenas();
  } catch (err) {
    tostada(err.message, true);
  }
});

function confirmarGenerar(nombre) {
  return confirm(`Se generarán como máximo 11 imágenes con tu OpenAI para «${nombre}»: los 4 fondos (Empezamos, Charla, Pausa y Final) y el personaje (1 base + 3 variantes × 2 intentos = hasta 7 imágenes).\n\nTambién hay llamadas de texto y visión. El precio depende del modelo y la calidad. ¿Sigo?`);
}

$('e-estilo-generar').addEventListener('click', () => {
  if (confirmarGenerar(estiloActual().nombre)) generarTodoEstilo();
});

/**
 * Los 4 fondos y el personaje del estilo elegido, uno detrás de otro, con las
 * descripciones del estilo (las de cada escena, si las has cambiado abajo).
 * Si falla uno, para y lo dice: lo ya hecho se queda.
 */
let generandoTodo = false;
async function generarTodoEstilo() {
  if (generandoTodo) return;
  generandoTodo = true;
  const boton = $('e-estilo-generar');
  boton.disabled = true;
  const pasos = [...Object.keys(ESCENAS_INFO).map((tipo) => ({ tipo })), { avatar: true }];
  try {
    for (const [i, paso] of pasos.entries()) {
      $('e-estilo-progreso').textContent = paso.avatar
        ? `🎨 Personaje (${i + 1} de ${pasos.length}, ~1 min)…`
        : `🎨 Fondo de ${ESCENAS_INFO[paso.tipo].nombre} (${i + 1} de ${pasos.length})…`;
      if (paso.avatar) await api('/api/escenas/avatar-ia', { descripcion: $('e-avatar-desc').value, referencias: seleccionReferencias('avatar'), maxImagenes: 7 });
      else await api('/api/escenas/fondo', { escena: paso.tipo, descripcion: descripcionesFondo[paso.tipo]?.value ?? '', referencias: seleccionReferencias(paso.tipo), maxImagenes: 1 });
      await cargarEscenas();
    }
    $('e-estilo-progreso').textContent = '✅ Listo: fondos y personaje nuevos';
    tostada('Estilo completo: ya sale en las escenas');
  } catch (err) {
    $('e-estilo-progreso').textContent = `Se paró: ${err.message}`;
    tostada(err.message, true);
  } finally {
    generandoTodo = false;
    boton.disabled = !escenas?.imagenIa;
  }
}

// ---------------------------------------------------------------------------
// Música (core/musica.ts). 28 sep 2026, más simple: eliges canción (o al azar
// de una carpeta), play, y marcas las escenas de OBS en las que suena.
// ---------------------------------------------------------------------------

let musicaDatos = null;
let musicaObs = null; // { escenas, escenaActual } de OBS, o null si no está abierto
const NOMBRES_LISTA = { inicio: 'Empezamos', pausa: 'Pausa', final: 'Final', fondo: 'De fondo' };
const nombreLista = (id) => NOMBRES_LISTA[id] ?? id;

async function cargarMusica(releer = false) {
  try {
    musicaDatos = await api(`/api/musica${releer ? '?releer=1' : ''}`);
  } catch (err) {
    tostada(err.message === 'no existe' ? 'Reinicia el bot para ver la Música (Ctrl+C y npm start)' : err.message, true);
    return;
  }
  pintarMusicaAhora();
  pintarElegirMusica();
  pintarEscenasMusica();
  $('m-carpeta').textContent = musicaDatos.carpeta;
  const n = musicaDatos.sueltas ?? 0;
  $('m-sueltas').hidden = !n;
  $('m-sueltas').textContent = n ? `⚠️ Hay ${n} ${n === 1 ? 'canción suelta' : 'canciones sueltas'} en la carpeta de música: no suenan hasta que las metas en fondo, inicio, pausa o final.` : '';
  if (releer) {
    const total = musicaDatos.listas.reduce((n, l) => n + l.canciones.length, 0);
    tostada(`${total} ${total === 1 ? 'canción' : 'canciones'} en las carpetas`);
  }
}

async function accionMusica(cuerpo, aviso) {
  try {
    const e = await api('/api/musica', cuerpo);
    musicaDatos = { ...musicaDatos, ...e };
    if (aviso) tostada(aviso);
    pintarMini(e);
    pintarMusicaAhora();
    pintarElegirMusica();
    pintarEscenasMusica();
  } catch (err) {
    tostada(err.message, true);
  }
}

function pintarMusicaAhora() {
  const m = musicaDatos;
  if (!m) return;
  const p = m.pista;
  $('m-titulo').textContent = p ? p.titulo : 'Nada';
  $('m-artista').textContent = p ? [p.artista, nombreLista(p.lista)].filter(Boolean).join(' · ') : 'Elige una canción arriba y dale al ▶';
  $('m-play').textContent = m.sonando ? '⏸' : '▶';
  $('m-play').disabled = !p && !m.listas?.some((l) => l.canciones.length);
  $('m-barras').classList.toggle('quietas', !m.sonando || m.enEscena === false);
  $('m-estado').textContent = !m.sonando ? (p ? 'En pausa' : '')
    : m.enEscena === false ? `Callada en «${m.escenaObs}»` : 'Sonando';
  // Un volumen para todo: se guarda igual en todas las carpetas.
  const vol = m.ajustes.volumen[m.lista ?? 'fondo'];
  if (document.activeElement !== $('m-volumen')) $('m-volumen').value = String(Math.round(vol * 100));
  $('m-volumen-n').textContent = `${Math.round(vol * 100)} %`;
  const pr = m.progreso;
  $('m-progreso').style.width = pr && pr.dur ? `${Math.min(100, (pr.pos / pr.dur) * 100)}%` : '0';
  $('m-pos').textContent = pr ? mmss(Math.floor(pr.pos)) : '';
  $('m-dur').textContent = pr ? mmss(Math.floor(pr.dur)) : '';
  $('m-aviso-obs').textContent = !m.overlay
    ? '⚠️ La fuente de música no está abierta en OBS: no suena nada hasta que la pongas en tus escenas (a la derecha) o abras OBS.'
    : m.sonando && m.enEscena === false ? `🔇 «${m.escenaObs}» no está marcada: la música espera ahí y sigue al volver a una escena marcada.` : '';
  $('m-aviso').checked = m.ajustes.aviso;
}

/** El desplegable: al azar de una carpeta, o una canción concreta. */
function pintarElegirMusica() {
  const m = musicaDatos;
  if (!m || document.activeElement === $('m-elegir')) return;
  const conCanciones = m.listas.filter((l) => l.canciones.length);
  const opciones = [h('option', { value: '', disabled: true, selected: !m.pista }, conCanciones.length ? 'Elige una canción…' : 'No hay canciones: mira «Meter canciones» abajo')];
  if (conCanciones.length) {
    opciones.push(h('optgroup', { label: '🎲 Al azar' }, conCanciones.map((l) =>
      h('option', { value: `lista:${l.id}` }, `Al azar · ${l.nombre} (${l.canciones.length})`))));
  }
  for (const l of conCanciones) {
    opciones.push(h('optgroup', { label: l.nombre }, l.canciones.map((c) =>
      h('option', { value: `pista:${c.id}`, selected: m.pista?.id === c.id }, c.artista ? `${c.titulo} · ${c.artista}` : c.titulo))));
  }
  $('m-elegir').replaceChildren(...opciones);
}

/** Las escenas de OBS con su casilla: marcadas = ahí suena. */
function pintarEscenasMusica() {
  const cont = $('m-escenas');
  const marcadas = musicaDatos?.ajustes.escenas ?? [];
  if (!musicaObs) {
    $('m-obs-estado').textContent = 'OBS no está conectado';
    cont.replaceChildren(h('p', { class: 'nota' }, marcadas.length
      ? `Marcadas: ${marcadas.join(', ')}. Abre OBS para cambiarlas.`
      : 'Abre OBS para elegir las escenas. Mientras no marques ninguna, suena en todas.'));
    $('m-obs').disabled = true;
    return;
  }
  $('m-obs-estado').textContent = marcadas.length ? `${marcadas.length} marcada${marcadas.length === 1 ? '' : 's'}` : 'En todas';
  $('m-obs').disabled = !marcadas.length;
  // Las marcadas que ya no existen en OBS también salen, para poder quitarlas.
  const escenas = [...new Set([...musicaObs.escenas, ...marcadas])];
  cont.replaceChildren(...escenas.map((e) => {
    const casilla = h('input', { type: 'checkbox', value: e, checked: marcadas.includes(e) });
    casilla.addEventListener('change', () => {
      const nuevas = [...document.querySelectorAll('#m-escenas input:checked')].map((i) => i.value);
      accionMusica({ accion: 'ajustes', ajustes: { escenas: nuevas } }, nuevas.length ? null : 'Sin escenas marcadas: suena en todas');
    });
    const etiqueta = e === musicaObs.escenaActual ? `${e} (en emisión)` : musicaObs.escenas.includes(e) ? e : `${e} (ya no está en OBS)`;
    return h('label', { class: `interruptor-fila${e === musicaDatos?.escenaObs ? ' actual' : ''}` }, casilla, h('span', {}, etiqueta));
  }));
}

async function cargarMusicaObs() {
  try {
    const o = await api('/api/obs');
    musicaObs = o.conectado ? { escenas: o.escenas, escenaActual: o.escenaActual } : null;
  } catch {
    musicaObs = null;
  }
  pintarEscenasMusica();
}

$('m-elegir').addEventListener('change', (ev) => {
  const [tipo, valor] = [ev.target.value.slice(0, ev.target.value.indexOf(':')), ev.target.value.slice(ev.target.value.indexOf(':') + 1)];
  ev.target.blur();
  if (tipo === 'lista') accionMusica({ accion: 'lista', lista: valor }, `🎲 ${nombreLista(valor)}`);
  else if (tipo === 'pista') accionMusica({ accion: 'pista', id: valor });
});
$('m-releer').addEventListener('click', () => cargarMusica(true));
$('m-play').addEventListener('click', () => {
  // Sin nada puesto aún: al azar de la de fondo (o de la primera con canciones).
  if (!musicaDatos?.pista) {
    const l = musicaDatos?.listas.find((x) => x.id === 'fondo' && x.canciones.length) ?? musicaDatos?.listas.find((x) => x.canciones.length);
    if (l) accionMusica({ accion: 'lista', lista: l.id });
    return;
  }
  accionMusica({ accion: musicaDatos.sonando ? 'pausar' : 'reanudar' });
});
$('m-siguiente').addEventListener('click', () => accionMusica({ accion: 'siguiente' }));
$('m-anterior').addEventListener('click', () => accionMusica({ accion: 'anterior' }));
$('m-volumen').addEventListener('input', () => { $('m-volumen-n').textContent = `${$('m-volumen').value} %`; });
$('m-volumen').addEventListener('change', () => {
  const v = Number($('m-volumen').value) / 100;
  accionMusica({ accion: 'ajustes', ajustes: { volumen: { inicio: v, pausa: v, final: v, fondo: v } } });
});
$('m-aviso').addEventListener('change', (ev) => accionMusica({ accion: 'ajustes', ajustes: { aviso: ev.target.checked } }));
$('m-abrir').addEventListener('click', () => api('/api/biblioteca/abrir', { seccion: 'musica' }).catch((err) => tostada(err.message, true)));
$('m-obs').addEventListener('click', async () => {
  const elegidas = musicaDatos?.ajustes.escenas ?? [];
  if (!elegidas.length) return tostada('Marca al menos una escena', true);
  if (!confirm(`Se añadirá la fuente de música a:\n\n${elegidas.join('\n')}\n\nNo cambia la escena que estás emitiendo ni borra nada; en las que ya la tengan, no hace nada. ¿Sigo?`)) return;
  try {
    const r = await api('/api/musica/obs', { escenas: elegidas });
    $('m-obs-resultado').hidden = false;
    $('m-obs-resultado').replaceChildren(...r.hecho.map((x) => h('li', {}, x)));
    tostada('Música puesta en OBS');
  } catch (err) {
    tostada(err.message, true);
  }
});
// ---- Mini reproductor de la barra lateral: pausar o cambiar desde cualquier
// sección. Sale en cuanto hay una canción puesta (has empezado la música) y
// no en la propia pestaña Música, que ya tiene el suyo.
var miniEstado = null; // var: irA() lo usa al cargar, antes de llegar aquí
function pintarMini(e = miniEstado) {
  miniEstado = e;
  const enMusica = !$('v-musica').hidden;
  $('mm').hidden = !e?.pista || enMusica || (e?.ajustes?.fuente && e.ajustes.fuente !== 'local');
  if (!e?.pista) return;
  $('mm-titulo').textContent = e.pista.titulo;
  $('mm-artista').textContent = [e.pista.artista, nombreLista(e.pista.lista)].filter(Boolean).join(' · ');
  $('mm-play').textContent = e.sonando ? '⏸' : '▶';
  $('mm-play').setAttribute('aria-label', e.sonando ? 'Pausar' : 'Reproducir');
  $('mm-barras').classList.toggle('quietas', !e.sonando);
  const pr = e.progreso;
  $('mm-progreso').style.width = pr && pr.dur ? `${Math.min(100, (pr.pos / pr.dur) * 100)}%` : '0';
  $('mm').title = e.overlay ? '' : 'La fuente «MUS Música» no está abierta en OBS: no suena nada';
  $('mm').classList.toggle('sin-obs', !e.overlay);
}
async function accionMini(accion) {
  try {
    const e = await api('/api/musica', { accion });
    if (musicaDatos) musicaDatos = { ...musicaDatos, ...e };
    pintarMini(e);
  } catch (err) {
    tostada(err.message, true);
  }
}
$('mm-play').addEventListener('click', () => accionMini(miniEstado?.sonando ? 'pausar' : 'reanudar'));
$('mm-siguiente').addEventListener('click', () => accionMini('siguiente'));
$('mm-anterior').addEventListener('click', () => accionMini('anterior'));
$('mm-ir').addEventListener('click', () => irA('musica'));
DirectoRed.sondear(async () => {
  if (!$('v-musica').hidden) return; // allí ya pregunta la pestaña
  try { pintarMini(await api('/api/musica/estado')); } catch {}
}, 2000, false);
api('/api/musica/estado').then(pintarMini, () => {});

// Mientras la pestaña está abierta: lo que suena y por dónde va.
DirectoRed.sondear(async () => {
  if ($('v-musica').hidden || !musicaDatos) return;
  try {
    const e = await api('/api/musica');
    const cambio = e.pista?.id !== musicaDatos.pista?.id || e.lista !== musicaDatos.lista || e.escenaObs !== musicaDatos.escenaObs;
    musicaDatos = e;
    pintarMini(e);
    pintarMusicaAhora();
    if (cambio) { pintarElegirMusica(); pintarEscenasMusica(); }
  } catch {}
}, 2000, false);

// ---------------------------------------------------------------------------
// Temas para hablar (temas.ts): titulares, guion y lo que sale en pantalla
// ---------------------------------------------------------------------------

let temasDatos = null;
const temasFiltro = { categoria: null, texto: '' };
const preparando = new Set();

function haceCuanto(iso) {
  if (!iso) return '';
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 60) return `hace ${Math.max(1, min)} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`;
}

async function cargarTemas(forzar = false) {
  $('t-estado').textContent = forzar ? 'Actualizando…' : $('t-estado').textContent || 'Leyendo los titulares…';
  try {
    temasDatos = await api(`/api/temas${forzar ? '?forzar=1' : ''}`);
  } catch (err) {
    tostada(err.message === 'no existe' ? 'Reinicia el bot para ver los Temas (Ctrl+C y npm start)' : err.message, true);
    return;
  }
  pintarTemas();
}

function pintarTemas() {
  const d = temasDatos;
  if (!d) return;
  const cuenta = (c) => d.noticias.filter((n) => !c || n.categoria === c).length;
  $('t-categorias').replaceChildren(
    ...[[null, 'Todas'], ...Object.entries(d.categorias)].map(([c, nombre]) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(temasFiltro.categoria === c),
      onclick: () => { temasFiltro.categoria = c; pintarTemas(); },
    }, nombre, h('span', { class: 'cuenta' }, String(cuenta(c))))));
  const fallos = d.errores.length ? ` · sin respuesta: ${d.errores.map((e) => e.fuente).join(', ')}` : '';
  const ia = d.ia.disponible ? '' : ` · «Preparar» necesita la IA local: ${d.ia.motivo}`;
  $('t-estado').textContent = `${d.noticias.length} titulares de los últimos 3 días, de ${d.fuentes.length} medios${fallos}${ia}`;

  const texto = temasFiltro.texto.trim().toLowerCase();
  const enGuion = new Set(d.guion.map((g) => g.noticia.id));
  const lista = d.noticias.filter((n) => (!temasFiltro.categoria || n.categoria === temasFiltro.categoria)
    && (!texto || `${n.titulo} ${n.resumen} ${n.fuente}`.toLowerCase().includes(texto))).slice(0, 80);
  $('t-noticias').replaceChildren(...(lista.length
    ? lista.map((n) => tarjetaNoticia(n, enGuion.has(n.id)))
    : [h('p', { class: 'vacio-lista' }, texto ? `Nada coincide con «${temasFiltro.texto}».` : 'No hay titulares ahora mismo. Prueba a actualizar.')]));
  pintarGuion();
  pintarPantalla();
}

/** Lo preparado por la IA: resumen, preguntas (copiar, al chat, en pantalla) y encuesta. */
function bloquePreparado(n, p) {
  const alChat = (texto) => h('button', { class: 'boton pequeno', type: 'button', title: 'Lo escribe el bot en el chat', onclick: async () => {
    try { await api('/api/chat', { texto }); tostada('Enviado al chat'); } catch (err) { tostada(err.message, true); }
  } }, '💬 Al chat');
  const encuesta = p.encuesta.pregunta ? `${p.encuesta.pregunta} ${p.encuesta.opciones.map((o, i) => `${i + 1}) ${o}`).join('  ')}` : '';
  return h('div', { class: 'tema-preparado' },
    h('p', {}, p.resumen),
    h('ul', { class: 'tema-preguntas' }, p.preguntas.map((q) => h('li', {}, h('span', {}, q),
      h('span', { class: 'tema-acciones' }, botonCopiar(q, 'Copiar'), alChat(q),
        h('button', { class: 'boton pequeno', type: 'button', title: 'Sale en la escena Charla, debajo del titular', onclick: () => accionTema({ accion: 'pantalla', id: n.id, pregunta: q }, '📺 En pantalla con esa pregunta') }, '📺'))))),
    encuesta ? h('div', { class: 'tema-encuesta' }, h('strong', {}, '📊 Encuesta: '), h('span', {}, encuesta), botonCopiar(encuesta, 'Copiar')) : null);
}

function tarjetaNoticia(n, apartada) {
  const p = n.preparado;
  const preparar = h('button', { class: 'boton', type: 'button', disabled: !temasDatos.ia.disponible || preparando.has(n.id) },
    preparando.has(n.id) ? '✨ Preparando… (~30 s)' : p ? '✨ Otra vez' : '✨ Preparar');
  preparar.addEventListener('click', async () => {
    preparando.add(n.id);
    pintarTemas();
    try {
      const r = await api('/api/temas', { accion: 'preparar', id: n.id });
      const x = temasDatos.noticias.find((y) => y.id === n.id);
      if (x) x.preparado = r.preparado;
      temasDatos.guion = r.guion;
    } catch (err) {
      tostada(err.message, true);
    } finally {
      preparando.delete(n.id);
      pintarTemas();
    }
  });
  return h('article', { class: `tarjeta noticia${apartada ? ' apartada' : ''}` },
    n.imagen ? h('img', { class: 'noticia-img', src: n.imagen, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
    h('div', { class: 'noticia-cuerpo' },
      h('div', { class: 'noticia-meta' }, h('span', { class: `chip cat-${n.categoria}` }, temasDatos.categorias[n.categoria]), h('span', { class: 'nota' }, `${n.fuente} · ${haceCuanto(n.fecha)}`)),
      h('h3', {}, h('a', { href: n.enlace, target: '_blank', rel: 'noopener noreferrer' }, n.titulo)),
      n.resumen ? h('p', { class: 'nota' }, n.resumen) : null,
      p ? bloquePreparado(n, p) : null,
      h('div', { class: 'escena-botones' },
        preparar,
        h('button', { class: `boton${apartada ? '' : ' primario'}`, type: 'button', onclick: () => accionTema({ accion: apartada ? 'quitar' : 'apartar', id: n.id }, apartada ? 'Quitado del guion' : '📝 Al guion') },
          apartada ? '✓ En el guion' : '📝 Al guion'),
        h('button', { class: 'boton', type: 'button', title: 'Sale en la escena Charla', onclick: () => accionTema({ accion: 'pantalla', id: n.id }, '📺 En pantalla') }, '📺 En pantalla'))));
}

function pintarGuion() {
  const g = temasDatos.guion;
  $('t-guion').replaceChildren(...(g.length
    ? g.map((x, i) => h('li', { class: x.hecho ? 'hecho' : '' },
      h('label', { class: 'interruptor-fila' },
        h('input', { type: 'checkbox', checked: x.hecho, onchange: (ev) => accionTema({ accion: 'hecho', id: x.noticia.id, hecho: ev.target.checked }) }),
        h('span', {}, h('strong', {}, x.noticia.titulo), h('span', { class: 'nota' }, ` · ${x.noticia.fuente}`))),
      x.preparado ? h('details', {}, h('summary', {}, 'Resumen y preguntas'), bloquePreparado(x.noticia, x.preparado)) : null,
      h('div', { class: 'tema-acciones' },
        h('button', { class: 'boton pequeno', type: 'button', disabled: i === 0, 'aria-label': 'Subir', onclick: () => accionTema({ accion: 'mover', id: x.noticia.id, paso: -1 }) }, '↑'),
        h('button', { class: 'boton pequeno', type: 'button', disabled: i === g.length - 1, 'aria-label': 'Bajar', onclick: () => accionTema({ accion: 'mover', id: x.noticia.id, paso: 1 }) }, '↓'),
        h('button', { class: 'boton pequeno', type: 'button', onclick: () => accionTema({ accion: 'pantalla', id: x.noticia.id, pregunta: x.preparado?.preguntas[0] ?? null }, '📺 En pantalla') }, '📺'),
        h('button', { class: 'boton pequeno peligro', type: 'button', 'aria-label': 'Quitar', onclick: () => accionTema({ accion: 'quitar', id: x.noticia.id }) }, '✕'))))
    : [h('li', { class: 'nota' }, 'Vacío. Aparta aquí los temas del directo con «📝 Al guion».')]));
}

function pintarPantalla() {
  const p = temasDatos.pantalla;
  $('t-pantalla').replaceChildren(...(p
    ? [h('p', {}, h('strong', {}, p.titulo), h('span', { class: 'nota' }, ` · ${p.fuente}`)),
      p.pregunta ? h('p', { class: 'nota' }, `💬 ${p.pregunta}`) : null,
      h('button', { class: 'boton', type: 'button', onclick: () => accionTema({ accion: 'pantalla', id: null }, 'Quitado de la pantalla') }, 'Quitar de la pantalla')]
    : [h('p', { class: 'nota' }, 'Nada. Con «📺 En pantalla», el titular sale en la escena Charla en lugar de los datos del Loot.')]));
}

async function accionTema(cuerpo, aviso) {
  try {
    const r = await api('/api/temas', cuerpo);
    temasDatos = { ...temasDatos, guion: r.guion, pantalla: r.pantalla };
    if (aviso) tostada(aviso);
    pintarTemas();
  } catch (err) {
    tostada(err.message, true);
  }
}

$('t-actualizar').addEventListener('click', () => cargarTemas(true));
$('t-buscar').addEventListener('input', (ev) => { temasFiltro.texto = ev.target.value; pintarTemas(); });
$('t-vaciar').addEventListener('click', () => { if (confirm('¿Vaciar el guion del directo?')) accionTema({ accion: 'vaciar' }, 'Guion vacío'); });

// ---------------------------------------------------------------------------
// Escenas → Alertas y panel rotativo (core/alertas.ts)
// ---------------------------------------------------------------------------

let ovl = null;
const TIPOS_ALERTA = [['follow', '✦ Follows (captura)'], ['bits', '◆ Bits'], ['raid', '⚔ Raids']];
const PARTES_PANEL = [['cofre', '🎁 Próximo cofre'], ['top', '🏆 Líder de Loot'], ['follow', '❤ Último follow'], ['sub', '★ Último sub'], ['meta', '🎯 Meta']];

async function cargarOverlays() {
  try {
    ovl = await api('/api/overlays');
  } catch {
    $('o-panel-estado').textContent = 'No se pueden consultar los datos del bot ahora mismo.';
    return; // Bot sin reiniciar: la tarjeta se queda sin datos.
  }
  pintarOverlays();
  actualizarEstadoPanel();
}

async function actualizarEstadoPanel() {
  try {
    const d = await api('/api/overlay/panel');
    const disponibles = [];
    const activo = (clave) => ovl?.ajustes?.rotativo?.includes(clave);
    if (activo('cofre') && d.cofre?.activo && d.cofre.quedanSeg !== null) disponibles.push('próximo cofre');
    if (activo('top') && d.top?.podio?.length) disponibles.push('líder de Loot');
    if (activo('follow') && d.ultimoFollow) disponibles.push('último follow');
    if (activo('sub') && d.ultimoSub) disponibles.push('último sub');
    if (activo('meta') && d.meta) disponibles.push('meta');
    $('o-panel-estado').textContent = disponibles.length
      ? `Datos reales del bot: ${disponibles.join(', ')}.`
      : 'Aún no hay datos para las tarjetas activas; el panel queda transparente hasta que lleguen.';
  } catch {
    $('o-panel-estado').textContent = 'No se pueden consultar los datos del bot ahora mismo.';
  }
}

setInterval(() => {
  if (ovl && !document.hidden) actualizarEstadoPanel();
}, 10_000);

async function guardarOverlays(cuerpo, aviso) {
  try {
    ovl = { ...ovl, ...(await api('/api/overlays', cuerpo)) };
    if (aviso) tostada(aviso);
    pintarOverlays();
    actualizarEstadoPanel();
  } catch (err) {
    tostada(err.message, true);
  }
}

function pintarOverlays() {
  const a = ovl.ajustes;
  $('o-tipos').replaceChildren(...TIPOS_ALERTA.map(([t, nombre]) => h('div', { class: 'ovl-tipo' },
    h('label', { class: 'interruptor-fila' }, h('input', { type: 'checkbox', checked: a.alertas[t], onchange: (ev) => guardarOverlays({ accion: 'ajustes', ajustes: { alertas: { [t]: ev.target.checked } } }) }), h('span', {}, nombre)),
    h('div', { class: 'ovl-acciones' },
      h('button', { class: 'boton pequeno', type: 'button', 'data-prueba-alerta': t, onclick: () => verAlertaAqui(t, nombre) }, 'Ver aquí'),
      h('button', { class: 'boton pequeno', type: 'button', onclick: () => guardarOverlays({ accion: 'probar', tipo: t }, `Alerta de prueba: ${nombre}`) }, 'Emitir prueba')))));
  if (document.activeElement !== $('o-volumen')) $('o-volumen').value = String(Math.round(a.volumen * 100));
  $('o-volumen-n').textContent = `${Math.round(a.volumen * 100)} %`;
  const orden = [...a.rotativo, ...PARTES_PANEL.map(([k]) => k).filter(k => !a.rotativo.includes(k))];
  $('o-rotativo').replaceChildren(...orden.map(k => {
    const nombre = PARTES_PANEL.find(([x]) => x === k)[1];
    const indice = a.rotativo.indexOf(k);
    const mover = (paso) => {
      const rotativo = [...a.rotativo];
      [rotativo[indice], rotativo[indice + paso]] = [rotativo[indice + paso], rotativo[indice]];
      guardarOverlays({ accion: 'ajustes', ajustes: { rotativo } });
    };
    return h('div', { class: 'ovl-tipo', 'data-tarjeta': k },
      h('label', { class: 'interruptor-fila' },
        h('input', { type: 'checkbox', checked: indice >= 0, onchange: ev => {
          const rotativo = ev.target.checked ? [...a.rotativo, k] : a.rotativo.filter(x => x !== k);
          guardarOverlays({ accion: 'ajustes', ajustes: { rotativo } });
        } }), h('span', {}, nombre)),
      h('div', { class: 'ovl-acciones' },
        h('button', { class: 'boton pequeno', type: 'button', disabled: indice <= 0, 'aria-label': `Subir ${nombre}`, onclick: () => mover(-1) }, '↑'),
        h('button', { class: 'boton pequeno', type: 'button', disabled: indice < 0 || indice === a.rotativo.length - 1, 'aria-label': `Bajar ${nombre}`, onclick: () => mover(1) }, '↓')));
  }));
  const previaRotativo = document.querySelector('.ovl-panel-vista iframe');
  const marco = a.marco || 'pergamino';
  const opacidad = Number.isFinite(a.opacidad) ? a.opacidad : .72;
  const previaSrc = `/biblioteca/overlays/panel.html?orden=${a.rotativo.join(',')}&segundos=${a.segundos}&marco=${marco}&opacidad=${Math.round(opacidad * 100)}`;
  if (previaRotativo.getAttribute('src') !== previaSrc) previaRotativo.src = previaSrc;
  if (document.activeElement !== $('o-segundos')) $('o-segundos').value = String(a.segundos);
  $('o-marco').value = marco;
  if (document.activeElement !== $('o-opacidad')) $('o-opacidad').value = String(Math.round(opacidad * 100));
  $('o-opacidad-n').textContent = `${Math.round(opacidad * 100)} %`;
  for (const [id, k] of [['o-meta-tipo', 'tipo'], ['o-meta-titulo', 'titulo'], ['o-meta-objetivo', 'objetivo'], ['o-meta-base', 'base']]) {
    if (document.activeElement !== $(id)) $(id).value = String(a.meta[k]);
  }
  const m = ovl.meta;
  $('o-meta-estado').textContent = m ? `Ahora: ${m.actual} / ${m.objetivo} (${ovl.mes[m.tipo === 'follows' ? 'follows' : 'subs']} contados por el bot este mes + ${a.meta.base} que ya llevabas)` : 'Sin meta: el panel no la enseña.';
  const partes = [];
  if (ovl.ultimoFollow) partes.push(`Último follow: ${ovl.ultimoFollow.quien}`);
  if (ovl.ultimoSub) partes.push(`Último sub: ${ovl.ultimoSub.quien}`);
  $('o-ultimos').textContent = partes.length ? partes.join(' · ') : 'Aún no ha llegado ningún follow ni sub desde que el bot los escucha.';
}

// La vista de alertas: una franja de 1000×260 para los avisos de arriba, o la
// pantalla entera (16:9) para la captura del follow, que ocupa el centro.
const anchoVistaAlertas = () => ($('o-vista-alertas').classList.contains('completa') ? 1920 : 1000);
new ResizeObserver(entradas => {
  for (const e of entradas) e.target.style.setProperty('--escala', String(e.contentRect.width / anchoVistaAlertas()));
}).observe($('o-vista-alertas'));
function verAlertaAqui(tipo, nombre) {
  const vista = $('o-vista-alertas');
  const completa = tipo === 'follow';
  vista.classList.toggle('completa', completa);
  vista.style.setProperty('--escala', String(vista.clientWidth / anchoVistaAlertas()));
  vista.querySelector('iframe').src = `/biblioteca/overlays/alertas.html?demo=1&volumen=0${completa ? '' : '&encuadre=1'}&tipo=${tipo}`;
  $('o-prueba-estado').textContent = `Prueba local: ${nombre} · sin sonido · solo en este panel.`;
}
$('o-grande').addEventListener('click', () => {
  const actual = new URL($('o-vista-alertas').querySelector('iframe').src);
  actual.searchParams.delete('encuadre');
  abrirGrande(actual.pathname + actual.search, 'escena', 'Alertas');
});
$('o-volumen').addEventListener('input', () => { $('o-volumen-n').textContent = `${$('o-volumen').value} %`; });
$('o-volumen').addEventListener('change', () => guardarOverlays({ accion: 'ajustes', ajustes: { volumen: Number($('o-volumen').value) / 100 } }));
$('o-segundos').addEventListener('change', () => guardarOverlays({ accion: 'ajustes', ajustes: { segundos: Number($('o-segundos').value) } }));
$('o-marco').addEventListener('change', () => guardarOverlays({ accion: 'ajustes', ajustes: { marco: $('o-marco').value } }));
$('o-opacidad').addEventListener('input', () => { $('o-opacidad-n').textContent = `${$('o-opacidad').value} %`; });
$('o-opacidad').addEventListener('change', () => guardarOverlays({ accion: 'ajustes', ajustes: { opacidad: Number($('o-opacidad').value) / 100 } }));
$('o-meta').addEventListener('submit', (ev) => {
  ev.preventDefault();
  guardarOverlays({ accion: 'ajustes', ajustes: { meta: {
    tipo: $('o-meta-tipo').value, titulo: $('o-meta-titulo').value, objetivo: Number($('o-meta-objetivo').value), base: Number($('o-meta-base').value),
  } } }, 'Meta guardada');
});
$('o-obs').addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-cual]');
  if (!b) return;
  const escena = $('o-escena').value;
  if (!escena) return tostada('Abre OBS para elegir la escena', true);
  const que = b.dataset.cual === 'alertas' ? 'las alertas (a pantalla completa, encima de todo)' : 'el panel rotativo (arriba a la izquierda)';
  if (!confirm(`Se añadirá ${que} a «${escena}».\n\nNo cambia la escena que estás emitiendo ni borra nada. ¿Sigo?`)) return;
  try {
    const r = await api('/api/overlays', { accion: 'obs', cual: b.dataset.cual, escena });
    $('o-obs-resultado').textContent = r.hecho;
    tostada('Añadido en OBS');
  } catch (err) {
    tostada(err.message, true);
  }
});

/** Las escenas de OBS, para elegir dónde va el avatar. Por defecto, la que está en emisión. */
async function cargarEscenasObs() {
  const sel = $('e-avatar-escena');
  const compartir = $('e-compartir-fuente');
  try {
    const o = await api('/api/obs');
    if (!o.conectado) {
      sel.replaceChildren(h('option', { value: '' }, 'OBS no está conectado'));
      if (compartir) compartir.replaceChildren(h('option', { value: '' }, 'OBS no está conectado'));
      return;
    }
    sel.replaceChildren(...o.escenas.map((e) => h('option', { value: e, selected: e === o.escenaActual }, e === o.escenaActual ? `${e} (en emisión)` : e)));
    $('o-escena').replaceChildren(...o.escenas.map((e) => h('option', { value: e, selected: e === o.escenaActual }, e === o.escenaActual ? `${e} (en emisión)` : e)));
    if (compartir) {
      const anterior = compartir.value;
      const fuentes = o.fuentes.filter((f) => /^(monitor_capture|window_capture|game_capture|screen_capture|xcomposite_input|pipewire)/.test(f.tipo) && f.nombre !== 'ESC Compartir contenido');
      compartir.replaceChildren(h('option', { value: '' }, 'Sin captura todavía'), ...fuentes.map((f) => h('option', { value: f.nombre, selected: f.nombre === anterior }, `${f.nombre} · ${f.tipo}`)));
    }
  } catch {
    sel.replaceChildren(h('option', { value: '' }, 'OBS no está conectado'));
    if (compartir) compartir.replaceChildren(h('option', { value: '' }, 'OBS no está conectado'));
  }
}

$('e-avatar-obs').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const escena = $('e-avatar-escena').value;
  if (!escena) return tostada('Abre OBS para elegir la escena', true);
  if (!confirm(`Se añadirá el avatar a «${escena}», abajo a la derecha.\n\nMientras esté apagado aquí es transparente: no se verá nada hasta que lo enciendas. ¿Sigo?`)) return;
  try {
    const r = await api('/api/escenas/obs', { tipo: 'avatar', escena });
    $('e-avatar-resultado').textContent = r.hecho.join(' ');
    tostada('Avatar añadido en OBS');
  } catch (err) {
    tostada(err.message, true);
  }
});

$('e-textos').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const cambios = {};
  for (const input of document.querySelectorAll('#e-textos [data-clave]')) cambios[input.dataset.clave] = input.value;
  guardarEscenas(cambios, 'Textos guardados: ya salen en las escenas');
});

// ---------------------------------------------------------------------------
// Galería de imágenes
// ---------------------------------------------------------------------------

/**
 * Cómo se enseña cada overlay en la vista previa. Sin esto, la barra del jefe
 * sale vacía (sin jefe es transparente) y el banner, siempre Legendario.
 */
const VARIANTES_OVERLAY = {
  'charla-compartida.html': [{ nombre: 'Webcam + contenido', q: '?demo=1' }],
  'espectadores.html': [{ nombre: 'Con etiqueta', q: '?demo=1' }, { nombre: 'Solo el número', q: '?demo=1&etiqueta=0' }],
  'alertas.html': [{ nombre: 'Oscuro', q: '?demo=1' }, { nombre: 'Vibrante', q: '?demo=1&estilo=alegre' }, { nombre: 'Cálido', q: '?demo=1&estilo=acogedor' }],
  'panel.html': [{ nombre: 'Pergamino real', q: '?marco=pergamino' }, { nombre: 'Cristal arcano', q: '?marco=cristal' }, { nombre: 'Estandarte ligero', q: '?marco=estandarte' }],
  'avatar.html': [
    { nombre: 'Con fondo', q: '?demo=1&fondo=1&bocadillo=todo' },
    { nombre: 'Transparente', q: '?demo=1' },
  ],
  'escena.html': [
    ...[['inicio', 'Empezamos'], ['charla', 'Charla'], ['pausa', 'Pausa'], ['final', 'Final']]
      .map(([tipo, nombre]) => ({ nombre, q: `?tipo=${tipo}&intro=0` })),
  ],
  'jefe.html': [
    ...[['dragon', '🐉 Dragón'], ['esqueleto', '💀 Esqueleto'], ['hidra', '🐍 Hidra'], ['golem', '🗿 Gólem'], ['liche', '☠️ Liche'],
      ['arana', '🕷️ Araña'], ['kraken', '🐙 Kraken'], ['minotauro', '🐂 Minotauro'], ['tanque', '🛡️ Tanque'], ['lag', '📶 Lag']]
      .map(([tipo, nombre]) => ({ nombre, q: `?demo=1&jefe=${tipo}` })),
  ],
  especiales: [
    { nombre: '❄ Dragón', q: '?demo=especial&jefe=dragon' },
    { nombre: '💀 Esqueleto', q: '?demo=especial&jefe=esqueleto' },
    { nombre: '🐍 Hidra', q: '?demo=especial&jefe=hidra' },
    { nombre: '◆ Gólem', q: '?demo=especial&jefe=golem' },
    { nombre: '✦ Liche', q: '?demo=especial&jefe=liche' },
    { nombre: '🕸️ Araña', q: '?demo=especial&jefe=arana' },
    { nombre: '🐙 Kraken', q: '?demo=especial&jefe=kraken' },
    { nombre: '🤢 Minotauro', q: '?demo=especial&jefe=minotauro' },
    { nombre: '🛡️ Tanque', q: '?demo=especial&jefe=tanque' },
    { nombre: '⚡ Lag', q: '?demo=especial&jefe=lag' },
  ],
  aliados: [
    { nombre: '📯 Sub · grito', q: '?demo=aliado&clase=grito' },
    { nombre: '🎁 Regalos · refuerzos', q: '?demo=aliado&clase=refuerzos' },
    { nombre: '💎 100 bits', q: '?demo=aliado&clase=cristal' },
    { nombre: '⚡ 500 bits', q: '?demo=aliado&clase=tormenta' },
    { nombre: '🗡️ 1000 bits', q: '?demo=aliado&clase=mecenas' },
  ],
  duelo: [{ nombre: 'Duelo', q: '?demo=duelo' }],
  'botin.html': [
    { nombre: 'Legendario', q: '?rareza=legendario&item=Espada%20del%20Amanecer%20Eterno' },
    { nombre: 'Épico', q: '?rareza=epico&item=Capa%20de%20las%20Sombras' },
    { nombre: 'Raro', q: '?rareza=raro&item=Arco%20de%20tejo%20%C3%A9lfico' },
    { nombre: 'Común', q: '?rareza=comun&item=Calcet%C3%ADn%20del%20tanque' },
    { nombre: 'Maldito', q: '?rareza=epico&maldito=1&item=Calavera%20que%20susurra' },
  ],
};

/** Nombre bonito de cada carpeta de imágenes. Las que no estén, por su ruta. */
const CARPETAS = {
  '': { titulo: 'Iconos', ancho: false },
  twitch: { titulo: 'Twitch · moneda y recompensas', ancho: false },
  'twitch/paneles': { titulo: 'Twitch · paneles', ancho: true },
  fondos: { titulo: 'Fondos de las escenas', ancho: true, panoramica: true },
  jefes: { titulo: 'Jefes', ancho: false },
  objetos: { titulo: 'Objetos del botín', ancho: false },
};
// Cada personaje es una carpeta con fecha (avatar/oscuro-2026-09-27T09-12-36):
// en los filtros van todos juntos, y cada uno se llama por su título.
const esPersonaje = (c) => c.startsWith('avatar/');
const filtroDe = (c) => (esPersonaje(c) ? 'avatar' : c);
function tituloCarpeta(c) {
  if (c === 'avatar') return 'Personajes';
  if (esPersonaje(c)) {
    const t = galeria.imagenes.find((i) => i.carpeta === c && i.titulo)?.titulo;
    return `Personaje · ${t ? t.split(' · ')[0] : c.slice('avatar/'.length)}`;
  }
  return CARPETAS[c]?.titulo ?? c;
}
const rutaCarpeta = (c) => `imagenes/${c ? `${c}/` : ''}`;

// ---------- Apartados de la Biblioteca: uno a la vez, para no bajar por todo ----------

const APARTADOS = ['imagenes', 'sonidos', 'overlays', 'referencias', 'bocetos'];

function verApartado(apartado) {
  if (!APARTADOS.includes(apartado)) apartado = 'imagenes';
  try { localStorage.setItem('panel-biblioteca-apartado', apartado); } catch { /* nada */ }
  for (const b of $('b-apartados').children) {
    b.setAttribute('aria-selected', String(b.dataset.apartado === apartado));
    b.tabIndex = b.dataset.apartado === apartado ? 0 : -1;
  }
  for (const s of document.querySelectorAll('#v-biblioteca > section[data-apartado]')) s.hidden = s.dataset.apartado !== apartado;
}
$('b-apartados').addEventListener('click', (e) => {
  const b = e.target.closest('[data-apartado]');
  if (b) verApartado(b.dataset.apartado);
});
try { verApartado(localStorage.getItem('panel-biblioteca-apartado')); } catch { verApartado('imagenes'); }

// La carpeta elegida y los grupos plegados se recuerdan entre visitas.
const galeria = { imagenes: [], carpeta: null, texto: '', fondo: 'cuadros', visibles: [], plegadas: new Set() };
try { galeria.fondo = localStorage.getItem('panel-galeria-fondo') || 'cuadros'; } catch { /* nada */ }
try { galeria.carpeta = localStorage.getItem('panel-galeria-carpeta') || null; } catch { /* nada */ }
try { galeria.plegadas = new Set(JSON.parse(localStorage.getItem('panel-galeria-plegadas') || '[]')); } catch { /* nada */ }

function guardarGaleria() {
  try {
    if (galeria.carpeta === null) localStorage.removeItem('panel-galeria-carpeta');
    else localStorage.setItem('panel-galeria-carpeta', galeria.carpeta);
    localStorage.setItem('panel-galeria-plegadas', JSON.stringify([...galeria.plegadas]));
  } catch { /* nada */ }
}

function guardarFondo(fondo) {
  galeria.fondo = fondo;
  try { localStorage.setItem('panel-galeria-fondo', fondo); } catch { /* nada */ }
}

/** `cofre-28.png`, `cofre-56.png`, `cofre-112.png` → un solo juego «cofre» con tres tamaños. */
function agrupar(imagenes) {
  const juegos = new Map();
  const sueltas = [];
  for (const i of imagenes) {
    const m = /^(.+)-(\d+)\.(png|webp|gif|jpe?g)$/i.exec(i.nombre);
    if (!m) { sueltas.push(i); continue; }
    const clave = `${i.carpeta}/${m[1]}`;
    if (!juegos.has(clave)) juegos.set(clave, { base: m[1], carpeta: i.carpeta, tamanos: [] });
    juegos.get(clave).tamanos.push({ px: Number(m[2]), img: i });
  }
  const tarjetas = [];
  for (const j of juegos.values()) {
    // Un solo tamaño no es un juego: va como imagen suelta.
    if (j.tamanos.length < 2) sueltas.push(j.tamanos[0].img);
    else tarjetas.push({ tipo: 'juego', carpeta: j.carpeta, nombre: j.base, tamanos: j.tamanos.sort((a, b) => a.px - b.px) });
  }
  for (const i of sueltas) tarjetas.push({ tipo: 'imagen', carpeta: i.carpeta, nombre: i.nombre, img: i });
  return tarjetas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
}

function pintarGaleria() {
  const todas = galeria.imagenes;
  for (const b of $('g-fondos').children) b.setAttribute('aria-pressed', String(b.dataset.fondo === galeria.fondo));
  if (!todas.length) {
    $('g-carpetas').replaceChildren();
    $('b-imagenes').replaceChildren(vacioBiblioteca('imagenes', 'Aquí irán los iconos de las recompensas y las imágenes de los efectos.'));
    return;
  }
  const carpetas = [...new Set(todas.map((i) => i.carpeta))];
  const filtros = [...new Set(carpetas.map(filtroDe))];
  if (galeria.carpeta !== null && !filtros.includes(galeria.carpeta)) galeria.carpeta = null;

  $('n-imagenes').textContent = `${todas.length} imágenes · PNG, GIF, WebP o JPG`;
  const chip = (carpeta, texto, cuenta) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(galeria.carpeta === carpeta),
    onclick: () => { galeria.carpeta = carpeta; guardarGaleria(); pintarGaleria(); },
  }, texto, h('span', { class: 'cuenta' }, String(cuenta)));
  $('g-carpetas').replaceChildren(
    chip(null, 'Todas', todas.length),
    ...filtros.map((f) => chip(f, tituloCarpeta(f), todas.filter((i) => filtroDe(i.carpeta) === f).length)),
  );

  const texto = galeria.texto.trim().toLowerCase();
  const filtradas = todas.filter((i) =>
    (galeria.carpeta === null || filtroDe(i.carpeta) === galeria.carpeta) &&
    (!texto || `${i.carpeta}/${i.nombre} ${i.titulo ?? ''}`.toLowerCase().includes(texto)));
  // El orden en que el visor pasa de una a otra: el de la pantalla.
  galeria.visibles = [];

  // Buscando, todo abierto: que un resultado no quede escondido en un grupo plegado.
  const plegada = (c) => !texto && galeria.plegadas.has(c);
  const conImagenes = carpetas.filter((c) => filtradas.some((i) => i.carpeta === c));
  const grupos = conImagenes
    .map((c) => ({ c, tarjetas: agrupar(filtradas.filter((i) => i.carpeta === c)) }))
    .map(({ c, tarjetas }) => h('details', {
      // Con juegos de tamaños, tarjetas más anchas: 28 + 56 + 112 px no caben en una estrecha.
      class: `grupo-galeria${CARPETAS[c]?.ancho ? ' anchos' : ''}${CARPETAS[c]?.panoramica ? ' panoramicas' : ''}${tarjetas.some((t) => t.tipo === 'juego') ? ' iconos' : ''}${esPersonaje(c) ? ' personaje' : ''}`,
      open: !plegada(c),
      ontoggle: (e) => {
        if (texto) return;
        if (e.target.open) galeria.plegadas.delete(c); else galeria.plegadas.add(c);
        guardarGaleria();
        pintarBotonPlegar(conImagenes);
      },
    },
      h('summary', {}, h('h3', {}, tituloCarpeta(c),
        h('span', { class: 'cuenta' }, String(filtradas.filter((i) => i.carpeta === c).length)),
        h('code', {}, rutaCarpeta(c)))),
      h('div', { class: 'lista-imagenes' }, tarjetas.map(tarjetaImagen))));

  pintarBotonPlegar(texto ? [] : conImagenes);

  $('b-imagenes').replaceChildren(...(grupos.length
    ? [...agruparPersonajes(grupos)]
    : [h('p', { class: 'vacio-lista' }, `Nada coincide con «${galeria.texto}».`)]));
}

/** Los personajes son pocos y pequeños: los seguidos van en rejilla, de dos en dos. */
function* agruparPersonajes(grupos) {
  let caja = null;
  for (const g of grupos) {
    if (!g.classList.contains('personaje')) { caja = null; yield g; continue; }
    if (!caja) { caja = h('div', { class: 'grupos-personajes' }); yield caja; }
    caja.append(g);
  }
}

function pintarBotonPlegar(carpetas) {
  const b = $('g-plegar');
  b.hidden = carpetas.length < 2;
  const todas = carpetas.every((c) => galeria.plegadas.has(c));
  b.textContent = todas ? 'Desplegar todo' : 'Plegar todo';
  b.onclick = () => {
    for (const c of carpetas) { if (todas) galeria.plegadas.delete(c); else galeria.plegadas.add(c); }
    guardarGaleria();
    pintarGaleria();
  };
}

function tarjetaImagen(t) {
  const fondo = `fondo-${galeria.fondo}`;
  if (t.tipo === 'juego') {
    const mayor = t.tamanos.at(-1).img;
    const indice = galeria.visibles.push(mayor) - 1;
    return h('article', { class: 'imagen' },
      h('button', { class: `imagen-vista ${fondo}`, type: 'button', 'aria-label': `Ver ${t.nombre} en grande`, onclick: () => abrirVisor(indice) },
        h('div', { class: 'tamanos' }, t.tamanos.map(({ px, img }) => h('figure', {},
          // A tamaño real, salvo que no quepa en la tarjeta.
          h('img', { src: img.url, alt: '', width: String(Math.min(px, 112)), height: String(Math.min(px, 112)), loading: 'lazy' }),
          h('figcaption', {}, `${px} px`))))),
      h('div', { class: 'overlay-pie' },
        h('div', { class: 'sonido-info' },
          h('strong', {}, t.nombre),
          h('div', { class: 'copias' }, t.tamanos.map(({ px, img }) => botonCopiar(img.ruta, `${px}`))))));
  }
  const i = t.img;
  const indice = galeria.visibles.push(i) - 1;
  const dims = h('span', { class: 'dato' });
  const img = h('img', { src: i.url, alt: i.nombre, loading: 'lazy' });
  img.addEventListener('load', () => { dims.textContent = `${img.naturalWidth}×${img.naturalHeight}`; });
  return h('article', { class: 'imagen' },
    h('button', { class: `imagen-vista ${fondo}`, type: 'button', 'aria-label': `Ver ${i.nombre} en grande`, onclick: () => abrirVisor(indice) }, img),
    h('div', { class: 'overlay-pie' },
      h('div', { class: 'sonido-info' }, h('strong', { title: i.titulo ?? i.nombre }, nombreTarjeta(i)),
        h('span', { class: 'sonido-meta' }, dims, h('span', { class: 'dato' }, tamano(i.bytes)))),
      botonCopiar(i.ruta)));
}

// Dentro del grupo de un personaje el nombre ya está en la cabecera: basta con el gesto.
function nombreTarjeta(i) {
  if (!esPersonaje(i.carpeta) || !i.titulo) return i.titulo ?? i.nombre;
  return i.titulo.split(' · ').slice(1).join(' · ') || 'normal';
}

$('g-buscar').addEventListener('input', (e) => { galeria.texto = e.target.value; pintarGaleria(); });
$('g-fondos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-fondo]');
  if (!b) return;
  guardarFondo(b.dataset.fondo);
  pintarGaleria();
});

// ---------- El visor ----------

let visorIndice = 0;
const FONDOS_VISOR = [['cuadros', '▦ Cuadros'], ['twitch', 'Twitch'], ['claro', 'Claro']];

function abrirVisor(indice) {
  visorIndice = indice;
  pintarVisor();
  if (!$('visor').open) $('visor').showModal();
}

function pintarVisor() {
  const lista = galeria.visibles;
  const i = lista[visorIndice];
  if (!i) return;
  const img = $('visor-img');
  const lienzo = $('visor-lienzo');
  lienzo.className = `visor-lienzo fondo-${galeria.fondo}`;
  $('visor-nombre').textContent = i.nombre;
  $('visor-datos').textContent = `${rutaCarpeta(i.carpeta)} · ${tamano(i.bytes)}`;
  img.style.width = '';
  img.onload = () => {
    // Los iconos pequeños se amplían sin emborronar, para ver cada píxel.
    const pequeno = img.naturalWidth <= 128;
    lienzo.classList.toggle('pixeles', pequeno);
    img.style.width = pequeno ? `${img.naturalWidth * 3}px` : '';
    $('visor-datos').textContent = `${rutaCarpeta(i.carpeta)} · ${img.naturalWidth}×${img.naturalHeight} px · ${tamano(i.bytes)}`;
  };
  img.src = i.url;
  img.alt = i.nombre;
  $('visor-fondos').replaceChildren(...FONDOS_VISOR.map(([id, texto]) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(galeria.fondo === id),
    onclick: () => { guardarFondo(id); pintarVisor(); pintarGaleria(); },
  }, texto)));
  $('visor-acciones').replaceChildren(
    botonCopiar(i.ruta),
    h('a', { class: 'boton pequeno', href: i.url, download: i.nombre }, 'Descargar'),
  );
  const varias = lista.length > 1;
  $('visor-ant').hidden = !varias;
  $('visor-sig').hidden = !varias;
}

function moverVisor(paso) {
  const n = galeria.visibles.length;
  if (n < 2) return;
  visorIndice = (visorIndice + paso + n) % n;
  pintarVisor();
}

$('visor-ant').addEventListener('click', () => moverVisor(-1));
$('visor-sig').addEventListener('click', () => moverVisor(1));
$('visor-cerrar').addEventListener('click', () => $('visor').close());
$('visor').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') { e.preventDefault(); moverVisor(-1); }
  if (e.key === 'ArrowRight') { e.preventDefault(); moverVisor(1); }
});
// Clic en el fondo oscuro, fuera de la ventana: cerrar.
$('visor').addEventListener('click', (e) => { if (e.target === $('visor')) $('visor').close(); });

$('r-biblioteca').addEventListener('click', cargarBiblioteca);

// ---------------------------------------------------------------------------
// Títulos
// ---------------------------------------------------------------------------

// Lo último que elegiste, para no tener que elegirlo cada vez.
const tituloElegido = { juego: '', sesion: '', tono: '', canal: true, emojis: 0 };
try { Object.assign(tituloElegido, JSON.parse(localStorage.getItem('panel-titulos') || '{}')); } catch { /* nada */ }
let titulosCargados = false;

async function cargarTitulos() {
  let d;
  try {
    d = await api('/api/titulos');
  } catch (err) {
    tostada(err.message === 'no existe' ? 'Reinicia el bot para ver Títulos (Ctrl+C y npm start)' : err.message, true);
    return;
  }
  const ia = $('t-ia');
  ia.className = `chip ${d.ia.disponible ? 'ok' : 'falta'}`;
  ia.textContent = d.ia.disponible ? `IA local · ${d.ia.modelo}` : 'IA local apagada';
  ia.title = d.ia.motivo || 'Ollama, en tu PC: gratis y sin salir de casa';
  $('t-generar').disabled = !d.ia.disponible;
  if (!d.ia.disponible) $('t-resultado').replaceChildren(h('p', { class: 'aviso' }, d.ia.motivo));

  if (!titulosCargados) {
    titulosCargados = true;
    $('t-sesion').replaceChildren(...d.sesiones.map((s) => h('option', { value: s, selected: s === tituloElegido.sesion }, s)));
    $('t-tono').replaceChildren(...d.tonos.map((s) => h('option', { value: s, selected: s === tituloElegido.tono }, s)));
    $('t-juego').value = tituloElegido.juego || d.juegos[0] || '';
    $('t-canal').checked = tituloElegido.canal !== false;
    $('t-emojis').value = String(tituloElegido.emojis ?? 0);
  }
  $('t-juegos').replaceChildren(...d.juegos.map((j) => h('option', { value: j })));
  const ctx = $('t-contexto');
  ctx.hidden = !d.contexto.length;
  ctx.textContent = d.contexto.length ? `Del chat esta semana: ${d.contexto.join(' · ')}` : '';

  const fila = (t) => h('li', {},
    botonEstrella(t.id, t.favorito === 1),
    h('span', { class: 'texto-titulo' }, t.texto),
    t.juego && h('span', { class: 'dato' }, t.juego),
    botonCopiarTitulo(t));
  $('t-favoritos').replaceChildren(...(d.favoritos.length ? d.favoritos.map(fila) : [h('li', { class: 'vacio-lista' }, 'Marca con ⭐ los que te gusten.')]));
  $('t-usados').replaceChildren(...(d.usados.length ? d.usados.map(fila) : [h('li', { class: 'vacio-lista' }, 'Cuando copies uno, aparecerá aquí.')]));
}

function botonEstrella(id, marcado) {
  const b = h('button', {
    class: 'estrella', type: 'button', 'aria-pressed': String(marcado), 'aria-label': marcado ? 'Quitar de favoritos' : 'Guardar en favoritos',
    onclick: async () => {
      const nuevo = b.getAttribute('aria-pressed') !== 'true';
      try {
        await api('/api/titulos/marcar', { id, favorito: nuevo });
        b.setAttribute('aria-pressed', String(nuevo));
        cargarTitulos();
      } catch (err) { tostada(err.message, true); }
    },
  }, '★');
  return b;
}

/** Copiar un título también lo apunta como usado: así la IA no lo repite. */
function botonCopiarTitulo(t) {
  const b = h('button', {
    class: 'boton pequeno copiar', type: 'button',
    onclick: async () => {
      await copiar(t.texto);
      b.textContent = '✓ Copiado';
      setTimeout(() => { b.textContent = 'Copiar'; }, 1500);
      api('/api/titulos/marcar', { id: t.id, usado: true }).then(() => cargarTitulos()).catch(() => {});
    },
  }, 'Copiar');
  return b;
}

$('t-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pedido = {
    juego: $('t-juego').value.trim(),
    sesion: $('t-sesion').value,
    tono: $('t-tono').value,
    notas: $('t-notas').value.trim(),
    conCanal: $('t-canal').checked,
    emojis: Number($('t-emojis').value),
  };
  Object.assign(tituloElegido, { juego: pedido.juego, sesion: pedido.sesion, tono: pedido.tono, canal: pedido.conCanal, emojis: pedido.emojis });
  try { localStorage.setItem('panel-titulos', JSON.stringify(tituloElegido)); } catch { /* nada */ }

  const boton = $('t-generar');
  boton.disabled = true;
  $('t-resultado').replaceChildren(h('article', { class: 'tarjeta' },
    h('p', { class: 'pensando' }, 'La IA local está pensando… La primera vez tarda más (carga el modelo en la gráfica): hasta un minuto.')));
  try {
    const r = await api('/api/titulos/sugerir', pedido);
    pintarSugerencia(r);
  } catch (err) {
    $('t-resultado').replaceChildren(h('p', { class: 'aviso' }, err.message));
  } finally {
    boton.disabled = false;
  }
});

function pintarSugerencia(r) {
  $('t-resultado').replaceChildren(h('article', { class: 'tarjeta' },
    h('header', {}, h('h2', {}, 'Sugerencias'), h('span', { class: 'nota' }, 'Copiar lo apunta como usado · ⭐ para guardarlo')),
    h('div', { class: 'sugerencias' }, r.titulos.map((t) => h('div', { class: 'sugerencia' },
      botonEstrella(t.id, false),
      h('span', { class: 'texto-titulo' }, t.texto),
      t.delChat && h('span', { class: 'chip', title: 'Menciona algo del minijuego del chat' }, '💬 del chat'),
      h('span', { class: 'largo' }, `${t.texto.length}/140`),
      botonCopiarTitulo(t)))),
    h('div', { class: 'extras-titulos' },
      h('div', {},
        h('h3', {}, 'Anuncio para redes o Discord'),
        r.anuncio ? h('p', { class: 'anuncio' }, r.anuncio) : h('p', { class: 'nota' }, 'Esta vez no ha salido anuncio.'),
        r.anuncio && botonCopiar(r.anuncio, 'Copiar anuncio')),
      h('div', {},
        h('h3', {}, 'Para Twitch'),
        r.categoria && h('p', {}, 'Categoría: ', chipCopiar(r.categoria, r.categoria)),
        h('div', { class: 'etiquetas' }, r.etiquetas.map((e) => chipCopiar(e, e))),
        r.etiquetas.length > 0 && botonCopiar(r.etiquetas.join(', '), 'Copiar etiquetas'))),
  ));
  cargarTitulos();
}
$('b-abrir').addEventListener('click', () => abrirCarpeta());

// ---------------------------------------------------------------------------
// Interacciones
// ---------------------------------------------------------------------------

async function cargarInteracciones() {
  try {
    const lista = await api('/api/interacciones');
    $('interacciones').replaceChildren(...lista.map((i) =>
      h('tr', {},
        h('td', { class: 'num' }, `#${i.numero}`),
        h('td', {}, h('strong', {}, i.titulo), i.usaIa && h('span', { class: 'detalle' }, 'Usa IA')),
        h('td', {}, i.disparador),
        h('td', {}, i.activa
          ? h('span', { class: 'chip ok' }, 'Activa')
          : h('span', { class: 'chip' }, 'Dormida')),
        h('td', { class: 'num' }, `${i.hoy.enviadas} enviadas`, h('span', { class: 'detalle' }, `${i.hoy.descartadas} descartadas`)),
        h('td', {}, i.ultima
          ? [hace(i.ultima.at), h('span', { class: 'detalle' }, `${i.ultima.status}${i.ultima.detail ? ` · ${i.ultima.detail}` : ''}`)]
          : h('span', { class: 'num' }, 'Nunca')),
      )));
  } catch (err) {
    tostada(err.message, true);
  }
}

$('r-interacciones').addEventListener('click', cargarInteracciones);

// ---------------------------------------------------------------------------
// Espectadores
// ---------------------------------------------------------------------------

let espectadores = [];

/** La ficha, en una fila debajo de la persona. Pulsar otra vez la cierra. */
async function abrirFicha(e, fila) {
  const siguiente = fila.nextElementSibling;
  if (siguiente?.classList.contains('ficha')) { siguiente.remove(); return; }
  let f;
  try {
    f = await api(`/api/espectadores/${e.twitchId}/ficha`);
  } catch (err) { tostada(err.message, true); return; }
  const datosFicha = h('div', { class: 'ficha-datos' },
    h('span', {}, '⚔️ Poder ', h('b', {}, String(f.poder)), f.puesto ? ` · puesto ${f.puesto.puesto} de ${f.puesto.de}` : ''),
    h('span', {}, '🎒 ', h('b', {}, `${f.mochila.length}/20`)),
    h('span', {}, '📖 ', h('b', {}, `${f.coleccion.tiene}/${f.coleccion.de}`)),
    h('span', {}, '⚔️ Duelos ', h('b', {}, `${f.duelos.ganados}-${f.duelos.perdidos}`)),
    h('span', {}, '🔥 Racha ', h('b', {}, String(f.racha)), f.mejorRacha > f.racha ? ` (mejor ${f.mejorRacha})` : ''),
    f.titulo && h('span', { class: 'titulo-loot' }, `«${f.titulo}»`));
  const mochila = f.mochila.length
    ? h('div', { class: 'ficha-mochila' }, f.mochila.map((b) => pildoraBotin(b)))
    : h('p', { class: 'nota' }, 'La mochila está vacía.');
  fila.after(h('tr', { class: 'ficha' }, h('td', { colspan: 7 }, h('div', { class: 'ficha-cuerpo' }, datosFicha, mochila))));
}

async function cargarEspectadores() {
  try {
    espectadores = await api('/api/espectadores');
    pintarEspectadores();
  } catch (err) {
    tostada(err.message, true);
  }
}

function pintarEspectadores() {
  const q = $('buscar').value.trim().toLowerCase();
  const lista = espectadores.filter((e) => !q || e.login.includes(q) || e.nombre.toLowerCase().includes(q));
  $('n-espectadores').textContent = `· ${espectadores.length}`;

  if (!lista.length) {
    $('espectadores').replaceChildren(h('tr', {}, h('td', { class: 'vacio', colspan: 7 },
      espectadores.length ? 'Nadie coincide con la búsqueda.' : 'Todavía no ha escrito nadie.')));
    return;
  }

  $('espectadores').replaceChildren(...lista.map((e) =>
    h('tr', {},
      h('td', {}, h('strong', {}, e.nombre), e.nombre.toLowerCase() !== e.login && h('span', { class: 'detalle' }, e.login)),
      h('td', {}, hace(e.ultimaVez)),
      h('td', { class: 'num' }, fecha(e.primeraVez)),
      h('td', { class: 'num' }, e.racha ? `🔥 ${e.racha}` : '—', e.mejorRacha > e.racha && h('span', { class: 'detalle' }, `mejor: ${e.mejorRacha}`)),
      h('td', { class: 'num' }, e.poder ? `⚔️ ${e.poder}` : '—'),
      h('td', { class: 'num' }, e.recuerdos || '—'),
      h('td', { class: 'acciones-fila' }, h('button', {
        class: 'boton pequeno', type: 'button',
        onclick: (ev) => abrirFicha(e, ev.currentTarget.closest('tr')),
      }, 'Ficha'), h('button', {
        class: 'boton pequeno peligro',
        type: 'button',
        onclick: async () => {
          if (!confirm(`¿Olvidar a ${e.nombre}? Se borra todo lo suyo y el bot no volverá a guardar nada de esta persona. No se puede deshacer desde aquí.`)) return;
          try {
            await api(`/api/espectadores/${e.twitchId}/olvidar`, {});
            tostada(`${e.nombre} olvidado`);
            cargarEspectadores();
          } catch (err) {
            tostada(err.message, true);
          }
        },
      }, 'Olvidar')),
    )));
}

$('buscar').addEventListener('input', pintarEspectadores);
$('r-espectadores').addEventListener('click', cargarEspectadores);

// ---------------------------------------------------------------------------
// Mundo: El Linde del Velo (interactions/mmo)
// ---------------------------------------------------------------------------

const MUNDO_MODOS = { activo: ['Activo', 'ok'], pausado: ['En pausa', 'aviso'], apagado: ['Apagado', ''] };
const MUNDO_FASES = { calma: 'En la Lumbre, esperando a que alguien escriba !explorar', expedicion: 'Expedición en marcha', resultado: 'Volviendo de la expedición' };

function pintarMundo(d) {
  const e = d.estado;
  const [texto, clase] = MUNDO_MODOS[e.modo] ?? [e.modo, ''];
  $('m-modo').textContent = texto;
  $('m-modo').className = `estado ${clase}`;
  // Por qué podría no avanzar aunque esté activo.
  const avisos = [];
  if (e.modo === 'activo' && !d.directo) avisos.push('No hay directo: el mundo espera y !explorar no cuenta hasta que empiece.');
  if (e.modo === 'activo' && !d.interruptor) avisos.push('El bot está apagado (interruptor de abajo a la izquierda): el mundo no avanza.');
  if (e.modo !== 'apagado' && !d.chat) avisos.push('Streamer.bot no está conectado: los !explorar del chat no llegan al mundo.');
  $('m-avisos').replaceChildren(...avisos.map((a) => h('li', {}, a)));
  const filas = [
    ['Ahora', e.modo === 'apagado' ? 'Cerrado' : MUNDO_FASES[e.fase] ?? e.fase],
    [e.fase === 'calma' ? 'Próxima salida' : 'Lugar', e.region.nombre],
  ];
  if (e.fase !== 'calma') {
    filas.push(['Misión', e.region.objetivo]);
    filas.push(['Progreso', `${e.objetivo.actual} / ${e.objetivo.meta}`]);
    if (e.detenido) filas.push(['Tiempo', { 'sin-directo': 'Congelado hasta que vuelva el directo', 'bot-apagado': 'Congelado hasta que enciendas el bot', 'sin-chat': 'Congelado hasta que vuelva Streamer.bot' }[e.detenido] ?? 'Congelado']);
    else if (e.hasta) filas.push([e.fase === 'resultado' ? 'Nueva salida' : 'El Velo se cierra', `en ${Math.max(0, Math.ceil((new Date(e.hasta) - Date.now()) / 60000))} min`]);
    if (e.encrucijada) {
      const [a, b] = e.encrucijada.opciones;
      filas.push(['Encrucijada', e.encrucijada.decision
        ? `${e.encrucijada.pregunta} Decidido: ${e.encrucijada.decision === 2 ? b.texto : a.texto}.`
        : `${e.encrucijada.pregunta} 1: ${a.texto} (${a.votos}) · 2: ${b.texto} (${b.votos})`]);
    }
    filas.push(['Compañía', e.participantes.length ? e.participantes.map((p) => `${p.nombre} (${p.aporte})`).join(', ') : '—']);
  }
  if (e.ultimoSuceso) filas.push(['Último suceso', e.ultimoSuceso]);
  if (e.reliquias) filas.push(['Reliquias', `${e.reliquias.halladas} de ${e.reliquias.total} en la Lumbre`]);
  if (e.cronica) filas.push(['Crónica', `${e.cronica.capitulo === 0 ? 'Prólogo' : `Capítulo ${e.cronica.capitulo} de ${e.cronica.total}`}: «${e.cronica.titulo}»`
    + (e.cronica.siguienteEn === null ? '' : ` · el siguiente en ${e.cronica.siguienteEn} expediciones`)]);
  $('m-datos').replaceChildren(...filas.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
  $('m-activar').disabled = e.modo === 'activo';
  $('m-pausar').disabled = e.modo !== 'activo';
  $('m-apagar').disabled = e.modo === 'apagado';
  $('m-escena').textContent = d.escena;
}

async function cargarMundo() {
  pintarMundo(await api('/api/mmo'));
}

for (const accion of ['activar', 'pausar', 'apagar']) {
  $(`m-${accion}`).addEventListener('click', async () => {
    if (accion === 'apagar' && !confirm('Apagar termina la expedición en curso sin repartir premios. Para dejarla a medias y seguir luego, usa Pausar. ¿Apago el mundo?')) return;
    try {
      pintarMundo(await api('/api/mmo', { accion }));
      tostada({ activar: 'El mundo está activo', pausar: 'El mundo está en pausa', apagar: 'El mundo está apagado' }[accion]);
    } catch (err) {
      tostada(err.message, true);
    }
  });
}

$('m-obs').addEventListener('click', async () => {
  if (!confirm(`Se creará (o completará) la escena «${$('m-escena').textContent}» en OBS.

No cambia la escena que estás emitiendo ni borra nada. ¿Sigo?`)) return;
  $('m-obs').disabled = true;
  try {
    const r = await api('/api/escenas/obs', { tipo: 'mundo' });
    $('m-obs-hecho').replaceChildren(...r.hecho.map((x) => h('li', {}, x)));
    tostada('Escena del mundo lista en OBS');
  } catch (err) {
    tostada(err.message, true);
  } finally {
    $('m-obs').disabled = false;
  }
});
escalarOverlay.observe($('m-vista'));
DirectoRed.sondear(() => ($('v-mundo').hidden ? undefined : cargarMundo()), 3000, false);

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

let [inicial, guiaPendiente] = location.hash.replace(/^#\/?/, '').split('/');
if (!inicial) {
  try { inicial = localStorage.getItem('panel-tab') || 'directo'; } catch { inicial = 'directo'; }
}
if (!$(`v-${inicial}`)) inicial = 'directo';
irA(inicial);
$('hoy').textContent = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

refrescar();
DirectoRed.sondear(refrescar, INTERVALO_MS, false);
if (inicial !== 'efectos') cargarEfectos();
// La botonera se entera sola cuando montas una Action nueva en Streamer.bot.
DirectoRed.sondear(cargarEfectos, 15000, false);
