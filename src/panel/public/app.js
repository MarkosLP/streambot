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

async function api(ruta, cuerpo) {
  const opciones = cuerpo === undefined
    ? {}
    : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Panel': '1' }, body: JSON.stringify(cuerpo) };
  const res = await fetch(ruta, opciones);
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(datos.error || `Error ${res.status}`);
  return datos;
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
  if (coste >= 1500) return { clase: 'r-legendario', nombre: 'Legendario' };
  if (coste >= 1000) return { clase: 'r-epico', nombre: 'Épico' };
  if (coste >= 800) return { clase: 'r-raro', nombre: 'Raro' };
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
  efectos: cargarEfectos,
  interacciones: cargarInteracciones,
  espectadores: cargarEspectadores,
};

function irA(tab) {
  for (const b of document.querySelectorAll('.pestanas button')) {
    b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  }
  for (const v of document.querySelectorAll('.vista')) v.hidden = v.id !== `v-${tab}`;
  try { localStorage.setItem('panel-tab', tab); } catch { /* sin almacenamiento, da igual */ }
  if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
  cargadores[tab]?.();
}

document.querySelector('.pestanas').addEventListener('click', (e) => {
  const tab = e.target.closest('button')?.dataset.tab;
  if (tab) irA(tab);
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
  } catch {
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

function pintarAjustes(bot) {
  // No se pisa un interruptor mientras lo estás pulsando.
  if (document.activeElement !== $('a-espontaneas')) $('a-espontaneas').checked = bot.espontaneas;
  if (document.activeElement !== $('a-revision')) $('a-revision').checked = bot.revision;
}

for (const [id, campo, textos] of [
  ['a-espontaneas', 'espontaneas', ['Interacciones espontáneas encendidas', 'Interacciones espontáneas apagadas']],
  ['a-revision', 'revision', ['Modo revisión activado', 'Modo revisión desactivado: la IA publica sin preguntar']],
]) {
  $(id).addEventListener('change', async (e) => {
    const valor = e.target.checked;
    try {
      await api('/api/ajustes', { [campo]: valor });
      tostada(valor ? textos[0] : textos[1]);
    } catch (err) {
      e.target.checked = !valor;
      tostada(err.message, true);
    }
  });
}

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
  const recientes = lineas.filter((l) => l.level !== 'debug').slice(-18);
  corto.replaceChildren(...(recientes.length
    ? lineasLog(recientes)
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

async function cargarEfectos() {
  try {
    const datos = await api('/api/efectos');
    $('efectos-sin-sb').hidden = datos.conectado;
    $('efectos').replaceChildren(...datos.efectos.map(tarjetaEfecto));
    pintarBotonera(datos);

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

async function lanzar(accionId) {
  await api(`/api/acciones/${accionId}/ejecutar`, {});
}

function pintarBotonera(datos) {
  const botones = datos.efectos.map((e) => {
    const r = rareza(e.coste);
    const montado = Boolean(e.accionId);
    const el = h('button', {
      class: `boton-fx ${r.clase} ${montado ? '' : 'no-montado'}`,
      type: 'button',
      title: montado ? `${e.queHace} Lo lanza sin gastar puntos.` : 'Todavía no está montado en Streamer.bot. Pulsa para ver cómo.',
      onclick: async () => {
        if (!montado) return irA('efectos');
        try {
          await lanzar(e.accionId);
          el.classList.remove('lanzado');
          void el.offsetWidth; // reinicia la animación
          el.classList.add('lanzado');
          tostada(`${icono(e.id)} ${e.recompensa} lanzado`);
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
    title: !accionId ? 'Todavía no existe en Streamer.bot' : !habilitada ? 'La Action está desactivada en Streamer.bot' : 'Ejecuta la Action, sin gastar puntos',
    onclick: async () => {
      try {
        await lanzar(accionId);
        tostada('Efecto lanzado');
      } catch (err) {
        tostada(err.message, true);
      }
    },
  }, 'Probar');
}

function tarjetaEfecto(e) {
  const estadoChip = e.montado === null
    ? h('span', { class: 'chip' }, 'Sin conexión')
    : e.montado
      ? h('span', { class: 'chip ok' }, 'Montado')
      : h('span', { class: 'chip falta' }, 'Por montar');

  const pasos = [
    `En Streamer.bot: Platforms → Twitch → Channel Point Rewards → Add. Título «${e.recompensa}», coste ${e.coste}, cooldown ${e.cooldownSeg} s, marca «Skip reward queue».`,
    `Actions → Add, con este nombre exacto: «${e.accion}». Trigger: Twitch → Channel Reward → Reward Redemption → ${e.recompensa}.`,
    ...e.pasos,
  ];

  const r = rareza(e.coste);
  return h('article', { class: `tarjeta efecto ${r.clase}` },
    h('div', { class: 'efecto-cabeza' },
      h('span', { class: 'icono' }, icono(e.id)),
      h('div', {}, h('span', { class: 'rareza' }, r.nombre), h('h3', {}, e.recompensa)),
      estadoChip),
    h('div', { class: 'efecto-cuerpo' },
      h('p', {}, e.queHace),
      h('div', { class: 'meta' },
        h('span', { class: 'coste' }, `🪙 ${e.coste.toLocaleString('es-ES')}`),
        h('span', {}, `· cooldown ${cooldownTexto(e.cooldownSeg)}`),
        e.necesita && h('span', { class: 'chip plugin' }, e.necesita),
      ),
      h('details', { open: e.montado === false && !e.necesita },
        h('summary', {}, 'Cómo montarlo'),
        h('ol', {}, pasos.map((p) => h('li', {}, p))),
      ),
      h('div', { class: 'pie' }, botonProbar(e.accionId)),
    ),
  );
}

$('r-efectos').addEventListener('click', cargarEfectos);

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
    $('espectadores').replaceChildren(h('tr', {}, h('td', { class: 'vacio', colspan: 6 },
      espectadores.length ? 'Nadie coincide con la búsqueda.' : 'Todavía no ha escrito nadie.')));
    return;
  }

  $('espectadores').replaceChildren(...lista.map((e) =>
    h('tr', {},
      h('td', {}, h('strong', {}, e.nombre), e.nombre.toLowerCase() !== e.login && h('span', { class: 'detalle' }, e.login)),
      h('td', {}, hace(e.ultimaVez)),
      h('td', { class: 'num' }, fecha(e.primeraVez)),
      h('td', { class: 'num' }, e.racha ? `🔥 ${e.racha}` : '—', e.mejorRacha > e.racha && h('span', { class: 'detalle' }, `mejor: ${e.mejorRacha}`)),
      h('td', { class: 'num' }, e.recuerdos || '—'),
      h('td', {}, h('button', {
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
// Arranque
// ---------------------------------------------------------------------------

let inicial = location.hash.slice(1);
if (!inicial) {
  try { inicial = localStorage.getItem('panel-tab') || 'directo'; } catch { inicial = 'directo'; }
}
if (!$(`v-${inicial}`)) inicial = 'directo';
irA(inicial);
$('hoy').textContent = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

refrescar();
setInterval(refrescar, INTERVALO_MS);
if (inicial !== 'efectos') cargarEfectos();
// La botonera se entera sola cuando montas una Action nueva en Streamer.bot.
setInterval(cargarEfectos, 15000);
