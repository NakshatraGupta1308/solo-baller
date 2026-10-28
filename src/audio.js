// Synthesised sound effects (Web Audio, no audio files). Each sound is built from
// a few primitives: a pitched "thump" (sine with a falling pitch), filtered noise
// bursts for contact and scuff, and decaying partials for metal.
//
// The context starts on the first user gesture (browsers block audio before that).

let ctx = null, master = null, noiseBuf = null;
const lastPlayed = {};

/** Create the audio context; call from a click or key handler. */
export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createDynamicsCompressor();
  master.threshold.value = -14;
  master.ratio.value = 4;
  const out = ctx.createGain();
  out.gain.value = 0.9;
  master.connect(out).connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

// stereo position and distance falloff for a sound at world point p, heard from the camera
function spatial(p, cam) {
  if (!p || !cam) return { pan: 0, gain: 1 };
  const dx = p.x - cam.position.x, dz = p.z - cam.position.z;
  const dist = Math.hypot(dx, dz, p.y - cam.position.y);
  const e = cam.matrixWorld.elements; // first column is the camera's right vector
  const right = (dx * e[0] + dz * e[2]) / Math.max(Math.hypot(e[0], e[2]) * dist, 0.001);
  return { pan: Math.max(-0.8, Math.min(0.8, right)), gain: 1 / (1 + Math.max(dist - 3, 0) * 0.08) };
}

function bus(vol, at) {
  const g = ctx.createGain();
  g.gain.value = vol * at.gain;
  if (ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = at.pan;
    g.connect(p).connect(master);
  } else g.connect(master);
  return g;
}

function thump(dest, t, f0, f1, dur, vol) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise(dest, t, type, freq, q, dur, vol, attack = 0.002) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf;
  s.playbackRate.value = 0.8 + Math.random() * 0.4;
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(dest);
  s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}

function partial(dest, t, freq, dur, vol) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest);
  o.start(t); o.stop(t + dur + 0.02);
}

// skip a sound that already played within `gap` seconds (stops buzzing on contact jitter)
function throttle(key, gap) {
  const now = ctx.currentTime;
  if (lastPlayed[key] !== undefined && now - lastPlayed[key] < gap) return false;
  lastPlayed[key] = now;
  return true;
}

const ready = () => ctx && ctx.state === 'running';
const vary = (x, k = 0.08) => x * (1 + (Math.random() * 2 - 1) * k);

export const sfx = {
  /** Instep strike. power 0..1 */
  kick(power, p, cam) {
    if (!ready() || !throttle('kick', 0.05)) return;
    const t = ctx.currentTime, b = bus(0.5 + 0.5 * power, spatial(p, cam));
    thump(b, t, vary(170 + 60 * power), 48, 0.16 + 0.06 * power, 0.9);
    noise(b, t, 'bandpass', vary(2600), 1.2, 0.018, 0.55 + 0.3 * power);   // boot on leather click
    noise(b, t, 'bandpass', vary(780), 2.5, 0.07, 0.3 + 0.2 * power);      // ball casing ring
  },
  /** Soft dribble touch or knock-on. soft 0..1 */
  touch(soft, p, cam) {
    if (!ready() || !throttle('touch', 0.07)) return;
    const t = ctx.currentTime, b = bus(0.22 + 0.25 * soft, spatial(p, cam));
    thump(b, t, vary(130), 70, 0.07, 0.6);
    noise(b, t, 'bandpass', vary(1500), 1.5, 0.03, 0.35);
  },
  /** Sole dragging or rolling the ball. */
  sole(p, cam) {
    if (!ready() || !throttle('sole', 0.12)) return;
    const t = ctx.currentTime, b = bus(0.3, spatial(p, cam));
    noise(b, t, 'lowpass', vary(900), 0.7, 0.16, 0.4, 0.02);
    thump(b, t, 95, 60, 0.06, 0.35);
  },
  /** Air swish of a boot whipping around the ball. */
  swish(p, cam) {
    if (!ready() || !throttle('swish', 0.12)) return;
    const t = ctx.currentTime, b = bus(0.18, spatial(p, cam));
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; f.type = 'bandpass'; f.Q.value = 1.4;
    f.frequency.setValueAtTime(600, t); f.frequency.exponentialRampToValueAtTime(2600, t + 0.14);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    s.connect(f).connect(g).connect(b); s.start(t); s.stop(t + 0.2);
  },
  /** Ball landing on grass. speed in m/s */
  bounce(speed, p, cam) {
    if (!ready() || speed < 0.6 || !throttle('bounce', 0.06)) return;
    const k = Math.min(speed / 9, 1), t = ctx.currentTime, b = bus(0.15 + 0.6 * k, spatial(p, cam));
    thump(b, t, vary(105 + 30 * k), 42, 0.12, 0.9);
    noise(b, t, 'lowpass', 500, 0.8, 0.08, 0.4);
  },
  /** Ball off the body. part: head, chest, body, thigh, shin, foot, arm */
  body(part, speed, p, cam) {
    if (!ready() || !throttle('body', 0.08)) return;
    const k = Math.min(speed / 10, 1), t = ctx.currentTime, b = bus(0.25 + 0.55 * k, spatial(p, cam));
    if (part === 'head') { thump(b, t, vary(260), 150, 0.11, 0.8); noise(b, t, 'bandpass', 1100, 2, 0.04, 0.3); }
    else if (part === 'foot' || part === 'shin') { thump(b, t, vary(150), 65, 0.09, 0.8); noise(b, t, 'bandpass', 1900, 1.4, 0.025, 0.4); }
    else { thump(b, t, vary(105), 55, 0.13, 0.9); noise(b, t, 'lowpass', 700, 0.7, 0.07, 0.35); }
  },
  /** Ball off the post or crossbar. */
  post(speed, p, cam) {
    if (!ready() || !throttle('post', 0.15)) return;
    const k = Math.min(speed / 20, 1), t = ctx.currentTime, b = bus(0.35 + 0.5 * k, spatial(p, cam));
    noise(b, t, 'highpass', 3000, 0.7, 0.03, 0.6);
    for (const [f, d, v] of [[523, 1.1, 0.35], [1347, 0.8, 0.22], [2211, 0.55, 0.15], [3170, 0.4, 0.1]]) partial(b, t, vary(f, 0.01), d, v);
    thump(b, t, 140, 70, 0.1, 0.5);
  },
  /** Ball hitting the net. */
  net(speed, p, cam) {
    if (!ready() || !throttle('net', 0.3)) return;
    const k = Math.min(speed / 20, 1), t = ctx.currentTime, b = bus(0.25 + 0.45 * k, spatial(p, cam));
    noise(b, t, 'bandpass', 1400, 0.6, 0.45, 0.6, 0.015);
    noise(b, t, 'highpass', 4500, 0.5, 0.25, 0.25, 0.01);
  },
  /** Bright two-note chime when a skill lands. */
  skill(level = 1) {
    if (!ready() || !throttle('skill', 0.1)) return;
    const t = ctx.currentTime, b = bus(0.1, { pan: 0, gain: 1 });
    const base = 660 * Math.pow(1.06, Math.min(level, 5));
    partial(b, t, base, 0.25, 0.25);
    partial(b, t + 0.06, base * 1.5, 0.3, 0.2);
  },
};
