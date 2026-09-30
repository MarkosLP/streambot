/* Reproductor oficial de YouTube. La clave vive en el servidor. */
(() => {
  let datos = null, fuente = 'local', busqueda = 0, guardando = false;
  const estado = t => { $('mo-estado').textContent = t; };
  const error = e => estado(e.message || 'No se pudo completar la operación.');
  const pararYoutube = () => $('mo-video').replaceChildren();
  const accion = async (ruta, cuerpo) => api(`/api/musica/online${ruta}`, cuerpo);
  function pintar(d) {
    const primera = datos === null;
    datos = d;
    $('mo-config-campos').disabled = guardando;
    if (primera) {
      $('mo-config-estado').textContent = 'Conexión disponible. Puedes guardar las credenciales.';
      if ($('mo-estado').textContent.startsWith('Cargando')) estado('');
    }
    if (fuente !== d.fuente) { busqueda++; $('mo-resultados').replaceChildren(); $('mo-resultados-nota').textContent = ''; }
    fuente = d.fuente;
    if (fuente !== 'youtube') pararYoutube();
    $('mo-local').hidden = fuente !== 'local';
    $('mo-online').hidden = fuente === 'local';
    $('mo-youtube').hidden = fuente !== 'youtube';
    for (const b of $('mo-fuentes').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.fuente === fuente));
    $('mo-youtube-key').placeholder = d.youtube.configurado ? 'Clave guardada; vacío la conserva' : 'Pega tu clave de YouTube';
  }
  async function cargar() {
    try { pintar(await accion('')); } catch (e) {
      if (!datos) {
        $('mo-config-campos').disabled = true;
        const aviso = e.message === 'no existe' ? 'El servidor sigue con una versión anterior. Reinicia el bot y recarga el panel para habilitar Guardar.' : `No se puede guardar: ${e.message}. Revisa que el bot esté arrancado.`;
        $('mo-config-estado').textContent = aviso; estado(aviso);
      } else error(e);
    }
  }
  async function cambiar(f) {
    if (f === fuente) return;
    const botones = [...$('mo-fuentes').querySelectorAll('button')];
    botones.forEach(b => { b.disabled = true; });
    try {
      pintar(await accion('/fuente', { fuente: f }));
      estado('');
    } finally { botones.forEach(b => { b.disabled = false; }); }
  }
  for (const b of $('mo-fuentes').querySelectorAll('button')) b.onclick = () => cambiar(b.dataset.fuente).catch(error);
  $('mo-config-form').onsubmit = async e => {
    e.preventDefault();
    if (!datos || guardando) return;
    const key = $('mo-youtube-key').value.trim();
    const b = {};
    if ($('mo-borrar-key').checked || key) b.youtubeKey = $('mo-borrar-key').checked ? '' : key;
    guardando = true;
    $('mo-config-campos').disabled = true;
    $('mo-config-estado').textContent = 'Guardando…';
    try {
      const d = await accion('/configurar', b);
      pintar(d);
      $('mo-youtube-key').value = ''; $('mo-borrar-key').checked = false;
      const aviso = 'Configuración guardada. Ya puedes buscar música en YouTube.';
      $('mo-config-estado').textContent = aviso; estado(aviso);
    } catch (err) { $('mo-config-estado').textContent = `No se ha guardado: ${err.message}`; error(err); }
    finally { guardando = false; $('mo-config-campos').disabled = false; }
  };
  function youtube(id) {
    pararYoutube();
    const url = new URL(`https://www.youtube.com/embed/${id}`);
    url.search = new URLSearchParams({ autoplay: '1', playsinline: '1', origin: location.origin }).toString();
    $('mo-video').append(h('iframe', { src: url.href, title: 'Reproductor de YouTube', allow: 'autoplay; encrypted-media; fullscreen; picture-in-picture', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' }));
    estado('Si el vídeo no arranca automáticamente, pulsa Play en el reproductor.');
  }
  $('mo-parar-video').onclick = () => { pararYoutube(); estado('YouTube detenido.'); };
  function resultados(items, proveedor) {
    $('mo-resultados-nota').textContent = items.length ? `${items.length} resultados` : 'No se han encontrado resultados.';
    $('mo-resultados').replaceChildren(...items.map(item => h('article', { class: 'mo-resultado' },
      item.imagen ? h('img', { src: item.imagen, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
      h('div', {}, h('strong', {}, item.titulo), h('p', { class: 'nota' }, item.autor),
        h('a', { href: item.url, target: '_blank', rel: 'noopener' }, 'Abrir en YouTube')),
      h('button', { class: 'boton', type: 'button', onclick: async () => {
        try {
          await cambiar(proveedor);
          youtube(item.id);
        } catch (e) { error(e); }
      } }, '▶ Reproducir'))));
  }
  async function buscar() {
    const proveedor = fuente, turno = ++busqueda;
    if (proveedor === 'local') return;
    $('mo-resultados-nota').textContent = 'Buscando…'; $('mo-resultados').replaceChildren();
    try {
      const items = await accion('/buscar', { proveedor, q: $('mo-consulta').value });
      if (turno !== busqueda) return;
      resultados(items, proveedor); estado('');
    } catch (e) { if (turno === busqueda) { $('mo-resultados-nota').textContent = ''; error(e); } }
  }
  $('mo-buscar').onsubmit = e => { e.preventDefault(); buscar(); };
  for (const b of document.querySelectorAll('[data-busqueda]')) b.onclick = () => { $('mo-consulta').value = b.dataset.busqueda; buscar(); };
  $('mo-enlace').onsubmit = async e => {
    e.preventDefault(); const proveedor = fuente;
    try {
      const r = await accion('/youtube/enlace', { url: $('mo-url').value }); if (fuente === proveedor) youtube(r.id);
    } catch (err) { error(err); }
  };
  cargar();
  // Consulta solo mientras la sección está visible. También refleja cambios de otra pestaña.
  setInterval(async () => { if ((!$('v-musica').hidden && !document.hidden) || $('mo-video').childElementCount) { await cargar(); } }, 15000);
})();
