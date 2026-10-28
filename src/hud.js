// DOM overlay: score, combo, popups, charge meter, gesture trail.

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const score = $('score'), combo = $('combo'), best = $('best');
  const pop = $('pop'), popTitle = $('pop-title'), popSub = $('pop-sub');
  const toast = $('toast'), charge = $('charge'), chargeFill = $('charge-fill');
  const mode = $('mode'), juggle = $('juggle'), juggleN = $('juggle-n');
  const reticle = $('reticle'), feed = $('feed');
  const trail = $('trail'), tctx = trail.getContext('2d');
  let popTimer = 0, toastTimer = 0, trailPts = null, trailFade = 0, trailLabel = '', trailSide = 'R';
  const free = $('free');

  function resize() {
    const dpr = Math.min(devicePixelRatio, 2);
    trail.width = innerWidth * dpr; trail.height = innerHeight * dpr;
    tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  addEventListener('resize', resize);

  function drawTrail() {
    tctx.clearRect(0, 0, innerWidth, innerHeight);
    if (!trailPts || trailFade <= 0) return;
    const cx = innerWidth / 2, cy = innerHeight / 2;
    tctx.globalAlpha = Math.min(trailFade, 1);
    tctx.lineCap = 'round'; tctx.lineJoin = 'round';
    // left foot draws in ink on the left half, right foot in green on the right half
    const ox = trailSide === 'L' ? -innerWidth * 0.12 : innerWidth * 0.12;
    const tint = trailSide === 'L' ? '28,31,29' : '24,176,90';
    tctx.translate(ox, 0);
    tctx.strokeStyle = `rgba(${tint},0.9)`;
    tctx.lineWidth = 4;
    tctx.beginPath();
    trailPts.forEach((p, i) => (i ? tctx.lineTo(cx + p.x, cy + p.y) : tctx.moveTo(cx + p.x, cy + p.y)));
    tctx.stroke();
    const last = trailPts[trailPts.length - 1];
    tctx.fillStyle = `rgb(${tint})`;
    tctx.beginPath(); tctx.arc(cx + last.x, cy + last.y, 6, 0, Math.PI * 2); tctx.fill();
    tctx.beginPath(); tctx.arc(cx, cy, 4, 0, Math.PI * 2); tctx.strokeStyle = 'rgba(28,31,29,0.6)'; tctx.lineWidth = 1.5; tctx.stroke();
    if (trailLabel) {
      tctx.font = '600 13px "IBM Plex Mono", monospace';
      tctx.fillStyle = 'rgba(28,31,29,0.85)';
      tctx.fillText(trailLabel.toUpperCase(), cx + last.x + 12, cy + last.y - 10);
    }
    tctx.globalAlpha = 1;
    tctx.translate(-ox, 0);
  }

  return {
    setScore(v) { score.textContent = v.toLocaleString(); },
    setCombo(mult, t) {
      combo.textContent = 'x' + mult;
      combo.parentElement.classList.toggle('hot', mult > 1);
      combo.parentElement.style.setProperty('--t', String(t));
    },
    setBest(v) { best.textContent = v; },
    pop(title, sub = '', kind = '') {
      popTitle.textContent = title;
      popSub.textContent = sub;
      pop.className = 'show ' + kind;
      void pop.offsetWidth;
      pop.classList.add('anim');
      popTimer = kind === 'big' ? 2.0 : 1.2;
    },
    toast(text, t = 1.4) { toast.textContent = text; toast.classList.add('show'); toastTimer = t; },
    feed(text) {
      const li = document.createElement('li');
      li.textContent = text;
      feed.prepend(li);
      while (feed.children.length > 5) feed.lastChild.remove();
      setTimeout(() => li.classList.add('old'), 2500);
    },
    setCharge(v) {
      charge.classList.toggle('show', v !== null);
      if (v !== null) chargeFill.style.width = `${Math.round(v * 100)}%`;
    },
    setMode(fp) { mode.textContent = fp ? '1ST PERSON' : '3RD PERSON'; reticle.classList.toggle('fp', fp); },
    setJuggle(on, n = 0) { juggle.classList.toggle('show', on); juggleN.textContent = n; },
    gesture(pts, label = '', side = 'R') { trailPts = pts; trailFade = 1.4; trailLabel = label; trailSide = side; },
    setFree(on) { free.classList.toggle('show', on); },
    update(dt) {
      if (popTimer > 0 && (popTimer -= dt) <= 0) pop.className = '';
      if (toastTimer > 0 && (toastTimer -= dt) <= 0) toast.classList.remove('show');
      if (trailFade > 0) { trailFade -= dt * (trailLabel ? 1.2 : 0); drawTrail(); }
      else if (trailPts) { trailPts = null; drawTrail(); }
    },
  };
}
