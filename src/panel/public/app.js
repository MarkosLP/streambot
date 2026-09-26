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
  efectos: () => { cargarEfectos(); cargarObs(); },
  biblioteca: cargarBiblioteca,
  loot: cargarLoot,
  interacciones: cargarInteracciones,
  espectadores: cargarEspectadores,
};

function irA(tab) {
  for (const b of document.querySelectorAll('.pestanas button')) {
    b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  }
  for (const v of document.querySelectorAll('.vista')) v.hidden = v.id !== `v-${tab}`;
  try { localStorage.setItem('panel-tab', tab); } catch { /* sin almacenamiento, da igual */ }
  // "#/efectos" y no "#efectos": hay elementos con esos ids y el navegador saltaría a ellos.
  if (location.hash !== `#/${tab}`) history.replaceState(null, '', `#/${tab}`);
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
        if (!montado) {
          irA('efectos');
          return abrirGuia(e);
        }
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
      e.material?.length > 0 && h('div', { class: 'material' }, e.material.map(filaMaterial)),
      h('div', { class: 'pie' },
        botonProbar(e.accionId),
        h('button', {
          class: `boton ${e.montado === false && !e.necesita ? 'destacado' : ''}`,
          type: 'button',
          onclick: () => abrirGuia(e),
        }, e.montado ? 'Ver la guía' : 'Cómo montarlo'),
      ),
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
    : e.montado ? h('span', { class: 'chip ok' }, 'Montado') : h('span', { class: 'chip falta' }, 'Por montar');

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
      botonProbar(e.accionId)),
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
const ORIGEN = { cofre: 'cofre', oro: 'Cofre del tesoro', panel: 'desde el panel', regalo: 'regalo', jefe: 'jefe de raid', forja: 'forjado', guerra: 'cofre de guerra', maldicion: 'Maldición' };

function mmss(seg) {
  const m = Math.floor(seg / 60);
  return m >= 1 ? `${m} min ${String(seg % 60).padStart(2, '0')} s` : `${seg} s`;
}

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
      h('button', { class: 'boton primario', type: 'button', 'data-jefe': 'invocar' }, '🐉 Invocar jefe'),
    ]));

  const enChat = d.enElChat || [];
  $('l-en-chat').textContent = enChat.length
    ? `En el chat ahora: ${enChat.length} (sin bots ni tú)`
    : 'Ahora mismo no hay nadie en el chat';
  $('l-regalo-lista').replaceChildren(...enChat.map((v) => h('option', { value: v.login }, v.nombre)));
  $('l-sin-directo').hidden = d.directo;
  $('l-con-directo').hidden = !d.directo;

  $('l-recientes').replaceChildren(...(d.recientes.length
    ? d.recientes.map((f) => h('li', {},
      pildoraBotin(f),
      h('span', { class: 'quien' }, f.display_name),
      h('span', { class: 'dato' }, `${ORIGEN[f.origen] || f.origen} · ${hace(f.at)}`)))
    : [h('li', { class: 'vacio-lista' }, 'Todavía no ha caído nada. El primer cofre llegará en el próximo directo.')]));

  $('l-comandos').replaceChildren(...d.comandos.map(([cmd, que]) => h('li', {}, chipCopiar(cmd, cmd), h('span', {}, que))));

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

$('l-jefe').addEventListener('click', async (e) => {
  const boton = e.target.closest('[data-jefe]');
  if (!boton) return;
  const accion = boton.dataset.jefe;
  boton.disabled = true;
  try {
    const r = await api('/api/loot/jefe', { accion });
    tostada(accion === 'retirar' ? 'Jefe retirado' : `🐉 ${r.nombre} aparece con ${r.vida} de vida${r.enviado ? '' : ' (el mensaje no salió al chat)'}`, accion !== 'retirar' && !r.enviado);
    cargarLoot();
  } catch (err) {
    tostada(err.message, true);
    boton.disabled = false;
  }
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
  ['l-marcar-directo', true, 'Directo marcado como en marcha'],
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
setInterval(() => { if (!$('v-loot').hidden) cargarLoot(); }, 5000);

// ---------------------------------------------------------------------------
// Importar en Streamer.bot
// ---------------------------------------------------------------------------

const IMPORTABLES = ['grito', 'pocion', 'maldicion', 'lag'];
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
    h('div', { class: 'obs-pie' }, boton, h('span', { class: 'nota' }, 'El Terremoto no está: se genera cuando tengas el plugin y lo configuremos.')),
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
  { id: 'jefe', titulo: 'Jefe y duelos', que: 'Fuente «FX Jefe»: la barra del jefe de raid y cada !duelo. Visible, pero cuando no pasa nada no se ve', necesita: 'escena' },
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
  for (const e of entradas) e.target.style.setProperty('--escala', String(e.contentRect.width / 1920));
});

async function cargarBiblioteca() {
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

  $('b-overlays').replaceChildren(...(lib.overlays.length
    ? lib.overlays.map((o) => {
      const vars = VARIANTES_OVERLAY[o.nombre] || [];
      let actual = vars[0]?.q ?? '';
      const marco = h('iframe', { src: o.url + actual, sandbox: 'allow-scripts', title: o.nombre, tabindex: '-1' });
      const vista = h('div', { class: 'overlay-vista' }, marco);
      escalarOverlay.observe(vista);
      const chips = vars.length > 1 && h('div', { class: 'variantes chips', role: 'group', 'aria-label': 'Variantes' },
        vars.map((v, i) => h('button', {
          type: 'button', class: 'chip', 'aria-pressed': String(i === 0),
          onclick: (ev) => {
            actual = v.q;
            marco.src = o.url + actual;
            for (const b of ev.currentTarget.parentNode.children) b.setAttribute('aria-pressed', String(b === ev.currentTarget));
          },
        }, v.nombre)));
      return h('article', { class: 'overlay' },
        vista,
        chips,
        h('div', { class: 'overlay-pie' },
          h('div', { class: 'sonido-info' }, h('strong', {}, o.nombre), h('span', { class: 'sonido-meta' }, usadoEn(o.usadoPor))),
          // Misma dirección no recarga: se pasa por about:blank para repetir la animación.
          h('button', { class: 'boton pequeno', type: 'button', onclick: () => { marco.src = 'about:blank'; setTimeout(() => { marco.src = o.url + actual; }, 30); } }, '↻ Repetir'),
          botonCopiar(o.ruta)));
    })
    : [vacioBiblioteca('overlays', 'No hay overlays todavía.')]));

  galeria.imagenes = lib.imagenes;
  pintarGaleria();
}

// ---------------------------------------------------------------------------
// Galería de imágenes
// ---------------------------------------------------------------------------

/**
 * Cómo se enseña cada overlay en la vista previa. Sin esto, la barra del jefe
 * sale vacía (sin jefe es transparente) y el banner, siempre Legendario.
 */
const VARIANTES_OVERLAY = {
  'jefe.html': [{ nombre: 'Jefe', q: '?demo=1' }, { nombre: 'Duelos', q: '?demo=duelo' }],
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
};
const tituloCarpeta = (c) => CARPETAS[c]?.titulo ?? c;
const rutaCarpeta = (c) => `imagenes/${c ? `${c}/` : ''}`;

const galeria = { imagenes: [], carpeta: null, texto: '', fondo: 'cuadros', visibles: [] };
try { galeria.fondo = localStorage.getItem('panel-galeria-fondo') || 'cuadros'; } catch { /* nada */ }

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
  if (galeria.carpeta !== null && !carpetas.includes(galeria.carpeta)) galeria.carpeta = null;

  $('n-imagenes').textContent = `${todas.length} imágenes · PNG, GIF, WebP o JPG`;
  const chip = (carpeta, texto, cuenta) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(galeria.carpeta === carpeta),
    onclick: () => { galeria.carpeta = carpeta; pintarGaleria(); },
  }, texto, h('span', { class: 'cuenta' }, String(cuenta)));
  $('g-carpetas').replaceChildren(
    chip(null, 'Todas', todas.length),
    ...carpetas.map((c) => chip(c, tituloCarpeta(c), todas.filter((i) => i.carpeta === c).length)),
  );

  const texto = galeria.texto.trim().toLowerCase();
  const filtradas = todas.filter((i) =>
    (galeria.carpeta === null || i.carpeta === galeria.carpeta) &&
    (!texto || `${i.carpeta}/${i.nombre}`.toLowerCase().includes(texto)));
  // El orden en que el visor pasa de una a otra: el de la pantalla.
  galeria.visibles = [];

  const grupos = carpetas
    .filter((c) => filtradas.some((i) => i.carpeta === c))
    .map((c) => ({ c, tarjetas: agrupar(filtradas.filter((i) => i.carpeta === c)) }))
    .map(({ c, tarjetas }) => h('section', {
      // Con juegos de tamaños, tarjetas más anchas: 28 + 56 + 112 px no caben en una estrecha.
      class: `grupo-galeria${CARPETAS[c]?.ancho ? ' anchos' : ''}${tarjetas.some((t) => t.tipo === 'juego') ? ' iconos' : ''}`,
    },
      h('h3', {}, tituloCarpeta(c), h('code', {}, rutaCarpeta(c))),
      h('div', { class: 'lista-imagenes' }, tarjetas.map(tarjetaImagen))));

  $('b-imagenes').replaceChildren(...(grupos.length
    ? grupos
    : [h('p', { class: 'vacio-lista' }, `Nada coincide con «${galeria.texto}».`)]));
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
      h('div', { class: 'sonido-info' }, h('strong', { title: i.nombre }, i.nombre),
        h('span', { class: 'sonido-meta' }, dims, h('span', { class: 'dato' }, tamano(i.bytes)))),
      botonCopiar(i.ruta)));
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

let [inicial, guiaPendiente] = location.hash.replace(/^#\/?/, '').split('/');
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
