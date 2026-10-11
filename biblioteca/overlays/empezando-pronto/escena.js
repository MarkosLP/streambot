(() => {
  const config = new URLSearchParams(location.search);
  const scene = document.getElementById('scene');
  const resize = () => scene.style.setProperty('--scale', Math.min(innerWidth / 1920, innerHeight / 1080));
  addEventListener('resize', resize); resize();

  const title = (config.get('title') || 'EMPEZANDO PRONTO').trim();
  document.getElementById('title').textContent = title;
  const brand = (config.get('brand') || 'CRID4M').trim();
  document.getElementById('brand').firstChild.textContent = brand;
  document.getElementById('side-brand').textContent = brand;
  const clock = document.getElementById('clock');
  const tick = () => clock.textContent = new Intl.DateTimeFormat('es-ES',{hour:'2-digit',minute:'2-digit'}).format(new Date());
  tick(); setInterval(tick, 15_000);

  const canvas = document.getElementById('weather');
  if (config.get('rain') === '0') canvas.hidden = true;
  else {
    const ctx = canvas.getContext('2d');
    // Solo cristal alto: el borde inferior queda por encima de los tres monitores.
    const panes = [{x:822,y:56,w:625,h:232},{x:1494,y:42,w:232,h:247}];
    const previewLightning = config.get('preview-lightning') === '1';
    let flashUntil = 0;
    if (config.get('lightning') !== '0' && !previewLightning) {
      const flash = () => {
        flashUntil = performance.now() + 210;
        setTimeout(flash, 52_000 + Math.random() * 40_000);
      };
      setTimeout(flash, config.get('demo') === '1' ? 1700 : 27_000);
    }
    const drops = Array.from({length:84}, () => {
      const pane = panes[Math.random() < .72 ? 0 : 1];
      return {pane,x:pane.x+Math.random()*pane.w,y:pane.y+Math.random()*pane.h,s:.3+Math.random()*.7,l:3+Math.random()*7};
    });
    let last = 0;
    const draw = now => {
      if(now-last > 32){
        last=now;ctx.clearRect(0,0,1920,1080);
        ctx.save();ctx.beginPath();for(const p of panes) ctx.rect(p.x,p.y,p.w,p.h);ctx.clip();
        ctx.strokeStyle='rgba(178,211,252,.24)';ctx.fillStyle='rgba(210,229,255,.24)';ctx.lineWidth=1;
        for(const d of drops){
          ctx.beginPath();ctx.arc(d.x,d.y,1.1,0,Math.PI*2);ctx.fill();
          ctx.beginPath();ctx.moveTo(d.x,d.y);ctx.lineTo(d.x-.5,d.y+d.l);ctx.stroke();
          d.y+=d.s;if(d.y>d.pane.y+d.pane.h){d.y=d.pane.y-10;d.x=d.pane.x+Math.random()*d.pane.w}
        }
        if (previewLightning || now < flashUntil) {
          ctx.fillStyle = 'rgba(198,222,255,.075)';
          for (const p of panes) ctx.fillRect(p.x,p.y,p.w,p.h);
          ctx.beginPath();
          ctx.moveTo(1393,74);ctx.lineTo(1381,105);ctx.lineTo(1392,110);
          ctx.lineTo(1370,151);ctx.lineTo(1377,157);ctx.lineTo(1357,190);
          ctx.strokeStyle = 'rgba(218,235,255,.48)';ctx.lineWidth = 2;
          ctx.shadowColor = '#c7ddff';ctx.shadowBlur = 10;ctx.stroke();
        }
        ctx.restore();
      }
      requestAnimationFrame(draw);
    }; requestAnimationFrame(draw);
  }

  const runner = document.getElementById('runner');
  if(config.get('preview-runner') === '1') {
    runner.style.transform = 'translateX(930px)';
    runner.style.opacity = '1';
  } else if(config.get('runner') !== '0') {
    const pass = () => {runner.classList.remove('go');void runner.offsetWidth;runner.classList.add('go');setTimeout(() => {runner.classList.remove('go');setTimeout(pass, 18_000 + Math.random()*10_000)}, 2900)};
    setTimeout(pass, config.get('demo') === '1' ? 1000 : 5_000);
  }

  const goku = document.getElementById('goku');
  if (config.get('preview-goku') === '1') {
    goku.classList.add('preview');
  } else if (config.get('preview-goku-front') === '1') {
    goku.classList.add('preview-front');
  } else if (config.get('goku') !== '0') {
    const appear = () => {
      goku.classList.remove('go','aim','fire');void goku.offsetWidth;goku.classList.add('go');
      setTimeout(() => goku.classList.add('aim'), 1750);
      setTimeout(() => goku.classList.add('fire'), 1970);
      setTimeout(() => {goku.classList.remove('go','aim','fire');setTimeout(appear, 32_000 + Math.random()*13_000)}, 5300);
    };
    setTimeout(appear, config.get('demo') === '1' ? 1500 : 12_000);
  }
})();
