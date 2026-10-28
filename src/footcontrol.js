// Mouse foot control. The left button is the left foot and the right button the
// right foot. Two modes:
//  - gestures (default): hold a button and draw a short stroke; it is read as one
//    move for that foot (see recognizeFoot)
//  - free foot (toggle with F): while a button is held, that boot follows the mouse
//    around the ball in real time and the ball reacts to it physically
//
// Screen strokes use y down. "Outward" is away from the body on that foot's side
// (screen right for the right foot). A skill's side value is +1 for right-foot moves.

const A = 0.08; // ankle height with the boot flat

/** Turn a resampled stroke into numbers the recogniser needs. */
function measure(raw) {
  let L = 0;
  for (let i = 1; i < raw.length; i++) L += Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y);
  const N = 32, pts = [raw[0]];
  if (L > 0) {
    const step = L / (N - 1);
    let acc = 0;
    for (let i = 1; i < raw.length && pts.length < N; i++) {
      let a = raw[i - 1];
      const b = raw[i];
      let d = Math.hypot(b.x - a.x, b.y - a.y);
      while (acc + d >= step && pts.length < N) {
        const t = (step - acc) / d;
        a = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        pts.push(a);
        d = Math.hypot(b.x - a.x, b.y - a.y);
        acc = 0;
      }
      acc += d;
    }
  }
  while (pts.length < N) pts.push(raw[raw.length - 1]);

  // total signed turning, skipping near-zero segments whose direction is noise
  let turn = 0, lastAng = null;
  for (let i = 1; i < N; i++) {
    const sx = pts[i].x - pts[i - 1].x, sy = pts[i].y - pts[i - 1].y;
    if (Math.hypot(sx, sy) < (L / N) * 0.3) continue;
    const a = Math.atan2(sy, sx);
    if (lastAng !== null) {
      let da = a - lastAng;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      turn += da;
    }
    lastAng = a;
  }
  let iMax = 0, iMin = 0;
  for (let i = 0; i < N; i++) { if (pts[i].y > pts[iMax].y) iMax = i; if (pts[i].y < pts[iMin].y) iMin = i; }
  const p0 = pts[0], pe = pts[N - 1];
  const chord = Math.hypot(pe.x - p0.x, pe.y - p0.y);
  // sideways bulge of the stroke's middle from its chord, as a fraction of the chord (+ = bends right)
  const mid = pts[N >> 1];
  const bulge = chord > 1 ? ((pe.x - p0.x) * (mid.y - p0.y) - (pe.y - p0.y) * (mid.x - p0.x)) / (chord * chord) : 0;
  return { L, pts, turn, chord, iMax, iMin, p0, pe, bulge };
}

/**
 * Read a stroke drawn with one foot.
 * @param raw     stroke points {x, y} in screen pixels (y down), starting at 0,0
 * @param side    'L' or 'R'
 * @param dur     seconds the button was held
 * @param charged true when the button was held still long enough to charge a shot
 * @returns {action, s?, curl?, label} where action is tap, pass, shoot, or a skill key
 */
export function recognizeFoot(raw, side, dur, charged) {
  const fs = side === 'R' ? 1 : -1;
  const out = fs; // screen x direction that points outward for this foot
  const m = measure(raw);
  const foot = side === 'R' ? 'right' : 'left';
  if (charged) {
    const curl = m.chord > 30 ? Math.max(-1, Math.min(1, -m.bulge * 3)) : 0;
    return { action: 'shoot', curl, label: `${foot} foot shot${curl ? (curl > 0 ? ', curled right' : ', curled left') : ''}` };
  }
  if (m.L < 14) return { action: 'tap', label: `${foot} foot touch` };

  const { L, pts, p0, pe, turn } = m;
  const dx = pe.x - p0.x, dy = pe.y - p0.y;

  if (Math.abs(turn) > 4.4) return { action: 'stepover', s: fs, label: `circle: ${foot} step over` };
  const down = pts[m.iMax].y - p0.y, up = p0.y - pts[m.iMin].y;
  if (down > 0.3 * L && pts[m.iMax].y - pe.y > 0.6 * down && Math.abs(dx) < 0.7 * down) {
    return { action: 'rainbow', s: fs, label: 'down-up: rainbow flick' };
  }
  if (up > 0.3 * L && pe.y - pts[m.iMin].y > 0.6 * up && Math.abs(dx) < 0.7 * up) {
    return { action: 'sombrero', s: fs, label: 'up-down: sombrero flick' };
  }
  const k = pts[m.iMax];
  const s1x = k.x - p0.x, s1y = k.y - p0.y, s2x = pe.x - k.x, s2y = pe.y - k.y;
  if (s1y > 0.25 * L && Math.abs(s2x) > 0.3 * L && Math.abs(s2y) < 0.5 * Math.abs(s2x) && Math.abs(s1x) < 0.6 * s1y) {
    return { action: 'cruyff', s: s2x < 0 ? 1 : -1, label: 'L-shape: cruyff turn' };
  }
  // a smooth half circle (reversals above are sharp, an arc bends steadily and has width)
  const width = Math.max(...pts.map((q) => q.x)) - Math.min(...pts.map((q) => q.x));
  if (Math.abs(turn) > 2.2 && m.chord < 0.8 * L && width > 0.25 * L) {
    const s = turn > 0 ? 1 : -1;
    return { action: 'roulette', s, label: 'half circle: roulette' };
  }

  if (-dy > Math.abs(dx)) {
    const curl = Math.max(-1, Math.min(1, -m.bulge * 3));
    return { action: 'pass', curl, length: L, label: `${foot} foot pass` };
  }
  if (dy > Math.abs(dx)) return { action: 'dragback', s: fs, label: `pull back: ${foot} drag back` };
  const inward = dx * out < 0;
  const speed = L / Math.max(dur, 0.05);
  if (speed > 450) {
    return inward
      ? { action: 'croqueta', s: fs, label: 'swipe in: la croqueta' }
      : { action: 'elastico', s: fs, label: 'swipe out: elastico' };
  }
  return { action: 'soleroll', s: dx < 0 ? 1 : -1, label: 'slow drag: sole roll' };
}

/**
 * Free foot: the boot follows the mouse in body space (x left, z forward) while the
 * button is held. Moving fast lifts the boot, so a quick circle carries it over the
 * ball; a slow push keeps it low and moves the ball. Step overs done by hand are
 * detected: the boot passes over the ball without touching it and lands on the other side.
 */
export function createFreeFoot() {
  const PX = 0.0018; // metres of boot travel per pixel of mouse
  return {
    on: false,       // free foot mode toggled on
    active: null,    // the foot being driven: { side, x, z, y, lift, px, speed, t, over, from, touched }

    start(side) {
      const sx = side === 'L' ? 1 : -1;
      this.active = { side, x: sx * 0.11, z: 0.08, y: A, lift: 0, px: 0, speed: 0, t: 0, over: false, from: 0, touched: false };
    },
    move(dx, dy) {
      const a = this.active;
      if (!a) return;
      a.x = Math.max(-0.5, Math.min(0.5, a.x - dx * PX));
      a.z = Math.max(-0.4, Math.min(0.85, a.z - dy * PX));
      a.px += Math.hypot(dx, dy);
    },
    end() { this.active = null; },

    /**
     * Advance one step. ball: {x, y, z} in body space. Returns 'stepover' when a
     * hand-drawn step over completes.
     */
    update(dt, ball) {
      const a = this.active;
      if (!a) return null;
      a.t += dt;
      a.speed += (a.px / dt - a.speed) * (1 - Math.exp(-10 * dt));
      a.px = 0;
      const want = Math.max(0, Math.min(1, (a.speed - 280) / 900)) * 0.27;
      a.lift += (want - a.lift) * (1 - Math.exp(-14 * dt));
      a.y = A + 0.02 + a.lift;

      const rel = a.x - ball.x;
      const near = Math.hypot(rel, a.z - ball.z) < 0.13;
      if (!a.over && !a.from && Math.abs(rel) > 0.08) a.from = Math.sign(rel);
      if (near && a.y > ball.y + 0.16) { if (!a.over) a.touched = false; a.over = true; }
      if (a.over && a.y < A + 0.07 && Math.abs(rel) > 0.13) {
        const crossed = a.from && Math.sign(rel) !== a.from;
        const clean = !a.touched;
        a.over = false;
        a.from = Math.sign(rel);
        if (crossed && clean) return 'stepover';
      }
      return null;
    },

    /** Pose override for the driven foot, with the other foot planted. */
    pose() {
      const a = this.active;
      if (!a) return null;
      const w = Math.min(a.t / 0.08, 1);
      const sx = a.side === 'L' ? 1 : -1;
      const driven = [a.x, a.y, a.z], planted = [-sx * 0.13, A, 0.02];
      return {
        w,
        ['foot' + a.side]: driven,
        ['foot' + (a.side === 'L' ? 'R' : 'L')]: planted,
        ['pitch' + a.side]: 0.5 * (a.lift / 0.27),
        drop: 0.06, spineX: 0.2, spineZ: sx * -0.08,
        shLz: 0.5, shRz: -0.5, elL: -0.5, elR: -0.5,
      };
    },
  };
}
