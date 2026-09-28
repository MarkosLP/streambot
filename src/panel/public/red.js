// Consultas del panel y overlays. 28 sep 2026: ninguna espera de red es ilimitada.
(() => {
  const lecturas = new Map();
  const fallos = new Set();
  const reinicios = new Set();
  let sesion = null;
  let generacion = 0;
  function cancelarLecturas() {
    ++generacion;
    for (const p of lecturas.values()) p.control.abort();
    lecturas.clear();
  }
  function consultar(ruta, opciones = {}, limite = 10000) {
    const lectura = !opciones.method || opciones.method === 'GET';
    const clave = String(ruta);
    if (lectura && lecturas.has(clave)) return lecturas.get(clave).promesa;
    if (!lectura) cancelarLecturas();
    const control = new AbortController(), turno = generacion;
    let agotado = false;
    const reloj = setTimeout(() => { agotado = true; control.abort(); }, limite);
    const registro = { control };
    registro.promesa = (async () => {
      try {
        const r = await fetch(ruta, { cache: 'no-store', ...opciones, signal: control.signal });
        const d = await r.json();
        if (control.signal.aborted || (lectura && turno !== generacion)) throw new DOMException('Consulta reemplazada', 'AbortError');
        if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
        const recibida = r.headers?.get('X-Sesion-Overlay');
        if (recibida && sesion !== recibida) {
          const reinicio = sesion !== null;
          sesion = recibida;
          if (reinicio) for (const fn of reinicios) fn();
        }
        fallos.delete(clave.split('?')[0]);
        return d;
      } catch (causa) {
        const error = agotado ? new DOMException('Se agotó el tiempo de respuesta', 'TimeoutError') : causa;
        const recurso = clave.split('?')[0];
        if (error.name !== 'AbortError' && !fallos.has(recurso)) {
          if (fallos.size >= 50) fallos.clear();
          fallos.add(recurso); console.warn('Consulta sin datos actuales', recurso, error);
        }
        throw error;
      } finally {
        clearTimeout(reloj);
        if (lecturas.get(clave) === registro) lecturas.delete(clave);
      }
    })();
    if (lectura) lecturas.set(clave, registro);
    return registro.promesa;
  }
  function sondear(trabajo, cada, inmediato = true) {
    let parado = false, reloj, aviso = false;
    const paso = async () => {
      try { await trabajo(); aviso = false; }
      catch (error) { if (error.name !== 'AbortError' && !aviso) { console.warn('Sondeo sin datos actuales', error); aviso = true; } }
      finally { if (!parado) reloj = setTimeout(paso, cada); }
    };
    if (inmediato) paso(); else reloj = setTimeout(paso, cada);
    return () => { parado = true; clearTimeout(reloj); };
  }
  function overlay(ruta, pintar, cada) {
    return sondear(async () => {
      try { const d = await consultar(ruta); pintar(d); document.documentElement.dataset.datos = 'actuales'; }
      catch (error) { document.documentElement.dataset.datos = 'obsoletos'; throw error; }
    }, cada);
  }
  function memoria(maximo = 500) {
    const vistos = new Set();
    return { has: (id) => vistos.has(id), clear: () => vistos.clear(), get size() { return vistos.size; },
      add(id) { vistos.add(id); while (vistos.size > maximo) vistos.delete(vistos.values().next().value); } };
  }
  function encolar(cola, valor, maximo = 30, vigencia = 120000) {
    while (cola.length && cola[0].__hasta <= Date.now()) cola.shift();
    if (cola.length >= maximo) cola.shift();
    cola.push({ ...valor, __hasta: Date.now() + vigencia });
  }
  function extraer(cola) {
    while (cola.length) { const v = cola.shift(); if (v.__hasta > Date.now()) return v; }
    return null;
  }
  globalThis.DirectoRed = { consultar, cancelarLecturas, sondear, overlay, memoria, encolar, extraer,
    alReiniciar: (fn) => { reinicios.add(fn); return () => reinicios.delete(fn); } };
})();
