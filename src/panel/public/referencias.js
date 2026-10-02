// Selección explícita, independiente para cada escena y para el avatar.
let catalogoReferencias = [];
const referenciasElegidas = new Map();
const urlReferencia = ruta => `/api/referencias/imagen?ruta=${encodeURIComponent(ruta)}`;
function seleccionReferencias(clave) {
  return (referenciasElegidas.get(clave) || []).filter(r => r.ruta).map(({ ruta, uso }) => ({ ruta, uso }));
}
async function cargarReferencias() {
  const nuevas = await api('/api/referencias');
  const cambio = JSON.stringify(nuevas) !== JSON.stringify(catalogoReferencias);
  catalogoReferencias = nuevas;
  if (cambio) for (const el of document.querySelectorAll('[data-referencias]')) pintarReferencias(el);
  const lista = document.getElementById('ref-lista');
  if (lista) lista.replaceChildren(...(nuevas.length ? nuevas.map(r => h('figure', { class: 'referencia-mini' },
    h('img', { src: urlReferencia(r.ruta), alt: r.nombre, loading: 'lazy' }),
    h('figcaption', {}, h('strong', {}, r.nombre), h('span', { class: 'nota' }, r.juego)))) : [h('p', { class: 'nota' }, 'Todavía no hay referencias. Sube una captura del juego o del personaje.') ]));
}
function selectorReferencias(clave) {
  const el = h('details', { class: 'escena-avanzado', 'data-referencias': clave });
  pintarReferencias(el);
  return el;
}
function pintarReferencias(el) {
  const clave = el.dataset.referencias;
  const elegidas = referenciasElegidas.get(clave) || Array.from({ length: 3 }, () => ({ ruta: '', uso: 'estilo' }));
  referenciasElegidas.set(clave, elegidas);
  el.replaceChildren(h('summary', {}, 'Referencias visuales · hasta 3'),
    h('p', { class: 'nota' }, 'Súbelas en Biblioteca. Solo se enviarán las que elijas aquí al generar. Las imágenes de entrada también cuentan para el coste.'),
    h('button', { type: 'button', class: 'boton pequeno', onclick: () => { verApartado('referencias'); irA('biblioteca'); } }, 'Gestionar referencias'),
    ...elegidas.map((r, i) => {
      const mini = h('img', { class: 'referencia-elegida', alt: `Referencia ${i + 1}`, hidden: !r.ruta, ...(r.ruta && { src: urlReferencia(r.ruta) }) });
      const sel = h('select', { 'aria-label': `Referencia ${i + 1}`, onchange: ev => {
        r.ruta = ev.target.value; mini.hidden = !r.ruta;
        if (r.ruta) mini.src = urlReferencia(r.ruta); else mini.removeAttribute('src');
      } }, h('option', { value: '', selected: !r.ruta }, 'Sin referencia'),
      ...catalogoReferencias.map(f => h('option', { value: f.ruta, selected: f.ruta === r.ruta }, `${f.juego} · ${f.nombre}`)),
      r.ruta && !catalogoReferencias.some(f => f.ruta === r.ruta) ? h('option', { value: r.ruta, selected: true }, 'Referencia no disponible · vuelve a elegir') : null);
      return h('div', { class: 'referencia-fila' },
        h('label', { class: 'campo' }, h('span', {}, `Imagen ${i + 1}`), sel),
        h('label', { class: 'campo' }, h('span', {}, 'Usar como'), h('select', { 'aria-label': `Propósito ${i + 1}`, onchange: ev => { r.uso = ev.target.value; } },
          ...[['estilo', 'Estilo visual'], ['lugar', 'Lugar exacto'], ['personaje', 'Personaje']].map(([valor, nombre]) => h('option', { value: valor, selected: r.uso === valor }, nombre)))), mini);
    }));
}
async function pngReferencia(archivo) {
  if (!archivo || !['image/png', 'image/jpeg', 'image/webp'].includes(archivo.type) || archivo.size > 15 * 1024 * 1024) throw Error('Elige un PNG, JPG o WebP de hasta 15 MB');
  const imagen = await createImageBitmap(archivo);
  try {
    const factor = Math.min(1, 2048 / Math.max(imagen.width, imagen.height));
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.max(1, Math.round(imagen.width * factor)); lienzo.height = Math.max(1, Math.round(imagen.height * factor));
    lienzo.getContext('2d').drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
    const png = lienzo.toDataURL('image/png').split(',')[1];
    if (png.length > Math.ceil(4 * 1024 * 1024 / 3) * 4) throw Error('La referencia convertida supera 4 MB: recorta la imagen o reduce su tamaño');
    return png;
  } finally { imagen.close(); }
}
document.getElementById('ref-subir').addEventListener('submit', async ev => {
  ev.preventDefault();
  const boton = ev.currentTarget.querySelector('button[type=submit]'); boton.disabled = true;
  const estado = document.getElementById('ref-estado'); estado.textContent = 'Guardando referencia local…';
  try {
    const png = await pngReferencia(document.getElementById('ref-archivo').files[0]);
    await api('/api/referencias', { nombre: document.getElementById('ref-nombre').value, juego: document.getElementById('ref-juego').value, png });
    await cargarReferencias(); document.getElementById('ref-archivo').value = '';
    estado.textContent = 'Referencia guardada. Ya puedes seleccionarla en Escenas o Avatar. No se ha generado ninguna imagen.';
  } catch (err) { estado.textContent = err.message; }
  finally { boton.disabled = false; }
});
