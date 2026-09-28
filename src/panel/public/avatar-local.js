/* Calibración local: nunca llama al motor de imágenes. Las vistas están congeladas. */
(() => {
  const $ = id => document.getElementById(id), dialogo = $('avatar-local');
  const lienzo = $('al-lienzo'), ctx = lienzo.getContext('2d');
  let personaje = '', base, puntos = [], vista = null, paso = 'base', turno = 0;
  const revisados = new Set();
  const nombres = ['ojo izquierdo: esquina izquierda', 'ojo izquierdo: esquina derecha', 'ojo derecho: esquina izquierda', 'ojo derecho: esquina derecha'];
  const estado = texto => { $('al-estado').textContent = texto; };
  const datos = () => ({ puntos, altura: Number($('al-altura').value) });
  function invalidar() { turno++; vista = null; paso = 'base'; revisados.clear(); $('al-revisado').checked = false; $('al-guardar').disabled = true; for (const b of dialogo.querySelectorAll('[data-paso]')) b.disabled = b.dataset.paso !== 'base'; }
  function pintar() {
    if (!base) return;
    ctx.clearRect(0, 0, lienzo.width, lienzo.height); ctx.drawImage(base, 0, 0);
    if (paso === 'base') puntos.forEach((p, i) => {
      const x = p.x * lienzo.width, y = p.y * lienzo.height;
      ctx.strokeStyle = '#00ffff'; ctx.lineWidth = 2; ctx.beginPath();ctx.moveTo(x - 8, y);ctx.lineTo(x + 8, y);ctx.moveTo(x, y - 8);ctx.lineTo(x, y + 8);ctx.stroke();
      ctx.font = 'bold 16px sans-serif';ctx.fillStyle = '#00ffff';ctx.fillText(String(i + 1), x + 10, y - 10);
    });
    $('al-instruccion').textContent = puntos.length < 4 ? `Marca ${puntos.length + 1}/4: ${nombres[puntos.length]} (según lo ves).` : 'Cuatro esquinas marcadas. Ajusta la altura y calcula las vistas.';
    $('al-calcular').disabled = puntos.length !== 4;
    $('al-coordenadas').replaceChildren(...puntos.map((p, i) => {
      const grupo = document.createElement('fieldset'), leyenda = document.createElement('legend');leyenda.textContent = `${i + 1}. ${nombres[i]}`;grupo.append(leyenda);
      for (const eje of ['x', 'y']) { const label = document.createElement('label'), input = document.createElement('input');label.textContent = `${eje.toUpperCase()} (%) `;input.type = 'number';input.min = '2';input.max = '98';input.step = '.1';input.value = (p[eje] * 100).toFixed(1);input.addEventListener('change', () => {p[eje] = Number(input.value) / 100;invalidar();pintar();});label.append(input);grupo.append(label); }
      return grupo;
    }));
    for (const b of dialogo.querySelectorAll('[data-paso]')) b.setAttribute('aria-pressed', String(b.dataset.paso === paso));
  }
  const cargar = src => new Promise((resolve, reject) => { const img = new Image();img.onload = () => resolve(img);img.onerror = () => reject(Error('No se pudo cargar la imagen'));img.src = src; });
  window.abrirAvatarLocal = async (ruta, nombre) => {
    personaje = ruta;puntos = [];base = null;invalidar();$('al-altura').value = '.20';$('al-nombre').textContent = nombre;
    ctx.clearRect(0, 0, lienzo.width, lienzo.height);dialogo.showModal();estado('Cargando la base…');
    const actual = turno;
    try {
      const [img, r] = await Promise.all([cargar(`/biblioteca/${ruta}/base.png`), api(`/api/escenas/avatar-local?personaje=${encodeURIComponent(ruta)}`)]);
      if (actual !== turno || !dialogo.open) return;
      base = img;lienzo.width = img.naturalWidth;lienzo.height = img.naturalHeight;
      if (r.calibracion) { puntos = r.calibracion.puntos;$('al-altura').value = String(r.calibracion.altura); }
      pintar();estado('Solo píxeles de la base. No hay llamadas de IA ni imágenes de pago.');
    } catch (e) { estado(e.message); }
  };
  lienzo.addEventListener('click', e => {
    if (!base || puntos.length === 4 || paso !== 'base') return;
    const r = lienzo.getBoundingClientRect();puntos.push({x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height});invalidar();pintar();
  });
  $('al-anadir').onclick = () => {if (puntos.length < 4 && base) {puntos.push({x: [.4,.46,.54,.6][puntos.length],y: .33});invalidar();pintar();}};
  $('al-deshacer').onclick = () => {puntos.pop();invalidar();pintar();};
  $('al-altura').oninput = () => {invalidar();pintar();};
  $('al-calcular').onclick = async () => {
    invalidar();pintar();const actual = turno;$('al-calcular').disabled = true;estado('Calculando dos vistas locales…');
    try {
      const r = await api('/api/escenas/avatar-local/vista', {personaje, calibracion: datos()});
      if (actual !== turno || !dialogo.open) return;
      vista = r;revisados.add('base');for (const b of dialogo.querySelectorAll('[data-paso]')) b.disabled = false;
      estado('Revisa Medio y Cerrado. Cada paso queda congelado; cambiar una esquina invalida la revisión.');
    } catch (e) { if(actual === turno)estado(e.message); }
    finally {if(actual === turno)$('al-calcular').disabled = puntos.length !== 4;}
  };
  for (const b of dialogo.querySelectorAll('[data-paso]')) b.onclick = async () => {
    const actual = ++turno;paso = b.dataset.paso;
    const img = paso === 'base' ? base : await cargar(vista[paso]).catch(e => {estado(e.message);return null;});
    if (!img || actual !== turno) return;
    pintar();ctx.drawImage(img, 0, 0);revisados.add(paso);
    $('al-guardar').disabled = revisados.size !== 3 || !$('al-revisado').checked || !vista;
  };
  $('al-revisado').onchange = () => { $('al-guardar').disabled = revisados.size !== 3 || !$('al-revisado').checked || !vista; };
  $('al-guardar').onclick = async () => {
    if (!vista || revisados.size !== 3 || !$('al-revisado').checked) return;
    $('al-guardar').disabled = true;
    try {await api('/api/escenas/avatar-local', {personaje,calibracion: datos(),hash: vista.hash,revisado:true});estado('Calibración guardada y activada para este personaje.');}
    catch(e) {estado(e.message);$('al-guardar').disabled = false;}
  };
  $('al-desactivar').onclick = async () => {
    try {await api('/api/escenas/avatar-local', {personaje,desactivar:true});invalidar();pintar();estado('Parpadeo local desactivado. Se usarán las variantes anteriores disponibles.');}catch(e){estado(e.message);}
  };
  $('al-cerrar').onclick = () => dialogo.close();dialogo.addEventListener('close', () => {turno++;});
})();
