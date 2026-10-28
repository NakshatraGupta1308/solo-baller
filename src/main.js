import * as THREE from 'three';
import { createWorld } from './world.js';
import { createBall } from './ball.js';
import { createPlayer } from './player.js';
import { SKILLS, track, mirrorPose } from './skills.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';
import { recognizeFoot, createFreeFoot } from './footcontrol.js';
import { initAudio, sfx } from './audio.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.localClippingEnabled = true;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.05, 900);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
resize();
addEventListener('resize', resize);

const world = createWorld(scene);
const ball = createBall(scene);
const player = createPlayer(scene);
const input = createInput(canvas);
const hud = createHud();

const SENS = 0.0022;
const PITCH = { third: -0.28, first: -0.48 };
const CHARGE_DELAY = 0.2; // hold a foot button still this long to start charging a shot
const BOB_LEVELS = [1, 0.5, 0.15]; // first person head motion: full, half, minimal
const R = ball.radius;
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

const cam = { fp: false, yaw: Math.PI, pitch: PITCH.third, dist: 4.6, blend: 0, fov: 62, roll: 0, bob: 0, lastYaw: Math.PI };

const g = {
  player, ball, cam,
  started: false,
  skill: null, skillKey: '', skillT: 0, skillState: null,
  anim: null, // short kick / juggle animations: { t, dur, pose }
  charge: null,
  kickCooldown: 0, goalTimer: 0,
  juggling: false, juggles: 0, best: 0,
  score: 0, combo: 1, comboTimer: 0,
  flicked: 0, escape: 0,
  poss: { has: false, regain: 0, show: 0, cushioned: false }, // close control: is the ball glued to your feet
  pendingKick: null,
  queued: null,        // a move asked for mid-skill, started as soon as the current one allows
  cue: 0,              // next sound cue of the running skill
  press: { L: null, R: null }, // foot buttons held: { t, charged }
  free: createFreeFoot(),
  lastCyc: 0,

  hdist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); },
  front(out = new THREE.Vector3()) { return player.toWorld(-0.04, 0, 0.42, out); },
  // the ball counts as "at your feet" anywhere in a strip just ahead of the player,
  // so skills still work between dribble touches
  ballAtFeet(scale = 1) {
    if (this.poss.has) return true;
    if (ball.inNet || ball.kinematic || ball.pos.y > 0.5) return false;
    const d = tmp2.subVectors(ball.pos, player.pos);
    const lz = d.x * Math.sin(player.yaw) + d.z * Math.cos(player.yaw);
    const lx = d.x * Math.cos(player.yaw) - d.z * Math.sin(player.yaw);
    return lz > -0.25 && lz < 1.7 * scale && Math.abs(lx) < 0.65 * scale;
  },
  // skills move the ball along a path; ease in from wherever the ball was when the skill began
  holdFrom: null,
  holdBall(p, dt, t) {
    const k = Math.min(t / 0.22, 1);
    const from = player.toWorld(this.holdFrom.x, this.holdFrom.y, this.holdFrom.z);
    ball.setKinematic(from.lerp(p, k * k * (3 - 2 * k)), dt);
  },
  turnPlayer(d) { player.yaw += d; if (cam.fp) cam.yaw += d; },
};

try { g.best = Number(localStorage.getItem('solo-baller.best') || 0); } catch { g.best = 0; }
hud.setBest(g.best);
hud.setMode(false);

// ---------------------------------------------------------------- scoring
function award(points, title, sub) {
  g.comboTimer = 2.6;
  const total = points * g.combo;
  g.score += total;
  hud.setScore(g.score);
  hud.pop(title, `+${total}${g.combo > 1 ? `  ·  x${g.combo} combo` : ''}${sub ? '  ·  ' + sub : ''}`);
  hud.feed(`${title.toLowerCase()}  +${total}`);
  g.combo = Math.min(g.combo + 1, 5);
}

// ---------------------------------------------------------------- actions
function startSkill(key, side) {
  if (!g.started || g.juggling || g.pendingKick || ball.inNet) return;
  if (g.skill) {
    // late in a move, cut straight into the next one; earlier, remember it for later
    if (g.skillT > 0.55) finishSkill(); else { g.queued = [key, side]; return; }
  }
  const def = SKILLS[key];
  g.skill = def; g.skillKey = key; g.skillT = 0; g.cue = 0;
  const d = tmp.subVectors(ball.pos, player.pos);
  g.holdFrom = new THREE.Vector3(d.dot(player.left()), ball.pos.y - player.pos.y, d.dot(player.forward()));
  g.skillState = def.start(g, side);
  g.skillState.fwd = Math.max(player.vel.dot(player.forward()), 0);
  g.poss.has = false;
  g.charge = null; hud.setCharge(null);
}

function finishSkill() {
  const def = g.skill, st = g.skillState, key = g.skillKey;
  g.skill = null;
  ball.kinematic = false;
  const withBall = def.end(g, st);
  if (withBall) {
    if (key === 'rainbow' || key === 'sombrero') g.flicked = 1.8;
    award(def.points, def.name);
    sfx.skill(g.combo);
  } else hud.toast(`${def.name.toLowerCase()} (no ball)`, 0.8);
  g.poss.regain = key === 'rainbow' || key === 'sombrero' ? 0.45 : 0.08;
  g.escape = withBall && !def.stopsPlayer ? 0.16 : 0;
  if (g.queued) { const [k, sd] = g.queued; g.queued = null; startSkill(k, sd); }
}

function strafeInput() { return (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0); }

/**
 * Strike the ball with one foot. opts: { pass, speed } for a pass, or { power 0..1 }
 * for a shot; curl -1..1 bends it (positive curls right).
 */
function kick(side, opts) {
  const aimYaw = cam.yaw;
  if (!cam.fp) player.yaw = aimYaw;
  const f = player.forward();
  const contact = player.pos.clone().addScaledVector(f, 0.42);
  const reach = g.poss.has || (g.hdist(ball.pos, contact) < 0.9 && ball.pos.y < 1.0 && !ball.kinematic && !ball.inNet);
  const c = opts.pass ? 0 : opts.power;
  const bz = THREE.MathUtils.clamp(player.toBody(ball.pos).z, 0.3, 0.6);
  g.anim = { t: 0, dur: opts.pass ? 0.32 : 0.38, pose: kickPose(opts.pass ? 0.45 : 0.7 + 0.3 * c, bz), mirror: side === 'L' };
  if (!reach) { hud.toast('too far from the ball', 0.8); return; }

  let speed, elev;
  if (opts.pass) { speed = opts.speed; elev = 0.02; }
  else {
    speed = 11 + 19 * c;
    const base = cam.fp ? PITCH.first : PITCH.third;
    elev = THREE.MathUtils.clamp(0.03 + 0.07 * c + Math.max(0, cam.pitch - base) * 0.7, 0.02, 0.85);
  }
  const dir = new THREE.Vector3(Math.sin(aimYaw) * Math.cos(elev), Math.sin(elev), Math.cos(aimYaw) * Math.cos(elev));
  // lofted shots get backspin (they float and check up), driven ones a little topspin (they dip);
  // the bend of the stroke adds sidespin to curl it
  const top = elev > 0.28 ? -26 : opts.pass ? 0 : 9 * c;
  const spin = new THREE.Vector3(Math.cos(aimYaw) * top, -(opts.curl ?? 0) * 14, -Math.sin(aimYaw) * top);
  // the ball leaves when the swinging boot reaches it, not when the button is released
  g.pendingKick = { t: opts.pass ? 0.14 : 0.17, dir, speed, spin, power: opts.pass ? 0.35 : 0.5 + 0.5 * c };
  if (g.juggling) endJuggle(true);
}

/** A quick knock-on with one foot: push the ball a few metres ahead and run onto it. */
function footTouch(side) {
  if (!g.ballAtFeet(1.0) || g.skill) { g.anim = { t: 0, dur: 0.22, pose: jugglePose('foot'), mirror: side === 'L' }; return; }
  const f = player.forward(), l = player.left();
  const lat = side === 'L' ? -0.25 : 0.25; // the outside of each boot nudges it slightly inward
  ball.kinematic = false;
  ball.vel.copy(player.vel).addScaledVector(f, 3.4).addScaledVector(l, lat).setY(0);
  g.poss.has = false; g.poss.regain = 0.28;
  g.anim = { t: 0, dur: 0.24, pose: kickPose(0.25, 0.42), mirror: side === 'L' };
  sfx.touch(0.6, ball.pos, camera);
}

function launchKick() {
  const k = g.pendingKick;
  g.pendingKick = null;
  if (ball.inNet || ball.kinematic || g.hdist(ball.pos, player.pos) > 1.3) return;
  ball.vel.copy(k.dir).multiplyScalar(k.speed).addScaledVector(player.vel, 0.25);
  if (ball.pos.y < R + 0.02) ball.pos.y = R + 0.01;
  ball.spin.copy(k.spin);
  ball.onGround = false;
  g.poss.has = false; g.poss.regain = 0.45;
  g.kickCooldown = 0.35;
  sfx.kick(k.power, ball.pos, camera);
}

// plant the standing foot beside the ball, draw the kicking leg back, swing the
// ankle through the ball and follow through
function kickPose(power, bz) {
  const A = 0.08;
  const keys = [
    [0, -0.11, A, 0.04], [0.3, -0.14, 0.18 + 0.2 * power, -0.08 - 0.3 * power],
    [0.45, -0.06, 0.12, bz - 0.1], [0.68, -0.02, 0.3 + 0.4 * power, 0.55 + 0.3 * power], [1, -0.11, A, 0.08],
  ];
  return (t) => {
    const w = Math.min(t / 0.12, 1) * Math.min((1 - t) / 0.22, 1);
    const strike = Math.sin(Math.PI * THREE.MathUtils.clamp((t - 0.3) / 0.45, 0, 1));
    return {
      w, footR: track(keys, t), footL: [0.2, A, bz - 0.1], pitchR: 0.5 * strike,
      drop: 0.06, spineX: 0.2 - 0.25 * strike, spineY: -0.35 * strike + 0.2 * (t < 0.35 ? t / 0.35 : 0),
      shLz: 0.8, shRz: -0.3, shL: -0.4 * strike, shR: 0.3 * strike, elL: -0.5, elR: -0.6,
    };
  };
}

function startJuggle() {
  if (!g.ballAtFeet(0.6)) { hud.toast('get the ball at your feet first'); return; }
  g.juggling = true; g.juggles = 0;
  g.poss.has = false;
  ball.kinematic = false;
  ball.vel.copy(player.vel).setY(3.6);
  ball.pos.copy(player.toWorld(-0.04, R + 0.02, 0.35));
  ball.onGround = false;
  g.anim = { t: 0, dur: 0.28, pose: jugglePose('foot') };
  hud.setJuggle(true, 0);
  sfx.touch(0.5, ball.pos, camera);
  hud.toast('keepy-uppy: click a foot as the ball drops', 2.2);
}

function endJuggle(volley) {
  if (!g.juggling) return;
  g.juggling = false;
  hud.setJuggle(false);
  const n = g.juggles;
  if (n > g.best) {
    g.best = n; hud.setBest(n);
    try { localStorage.setItem('solo-baller.best', String(n)); } catch { /* storage unavailable */ }
  }
  if (n >= 3) award(n * 15, volley ? 'Juggle Volley' : `${n} Touches`, n === g.best ? 'new best' : '');
  else if (!volley) hud.toast('dropped it');
}

function jugglePose(kind) {
  return (t) => {
    const b = Math.sin(Math.PI * Math.min(t, 1));
    if (kind === 'head') return { w: b, spineX: -0.25 + 0.4 * b, drop: -0.04 * b, shLz: 0.4, shRz: -0.4 };
    if (kind === 'knee') return { w: b, hipR: -1.5, kneeR: 1.7, footR: [-0.08, 0.6, 0.3], shLz: 0.5, shRz: -0.5 };
    return { w: b, footR: [-0.07, 0.1 + 0.32 * b, 0.32], pitchR: -0.25 * b, footL: [0.12, 0.08, 0.02], drop: 0.04, shLz: 0.45, shRz: -0.45 };
  };
}

function juggleTouch(side = 'R') {
  const f = player.forward();
  const target = player.pos.clone().addScaledVector(f, 0.3);
  const hd = g.hdist(ball.pos, target);
  const y = ball.pos.y;
  let kind = null;
  if (hd < 0.75) {
    if (y < 0.62) kind = 'foot';
    else if (y < 1.1) kind = 'knee';
    else if (y > 1.4 && y < 2.05) kind = 'head';
  }
  g.anim = { t: 0, dur: 0.26, pose: jugglePose(kind ?? 'foot'), mirror: side === 'L' };
  if (!kind) return;
  if (kind === 'foot') sfx.touch(0.5, ball.pos, camera); else sfx.body(kind === 'head' ? 'head' : 'thigh', 3, ball.pos, camera);
  const up = { foot: 3.7, knee: 3.1, head: 2.7 }[kind];
  ball.vel.set((target.x - ball.pos.x) * 1.1 + (Math.random() - 0.5) * 0.7, up + Math.random() * 0.35,
    (target.z - ball.pos.z) * 1.1 + (Math.random() - 0.5) * 0.7);
  g.juggles++;
  hud.setJuggle(true, g.juggles);
  if (kind !== 'foot') hud.toast(kind, 0.5);
}

// ---------------------------------------------------------------- input wiring
const overlay = document.getElementById('overlay');
function begin() {
  if (!g.started) { g.started = true; overlay.classList.add('hidden'); }
  initAudio();
  input.lock();
}
overlay.addEventListener('click', begin);
input.on('wantLock', () => { if (g.started) input.lock(); });
// Mouse feet: left button = left foot, right button = right foot.
input.on('footDown', (side) => {
  if (!g.started) return;
  initAudio();
  const other = side === 'L' ? 'R' : 'L';
  // both buttons together flick the ball up into keepy-uppy (or end it)
  if (g.press[other] && g.press[other].t < 0.15) {
    g.press = { L: null, R: null };
    g.charge = null; hud.setCharge(null);
    if (g.free.active) g.free.end();
    if (g.juggling) endJuggle(false); else startJuggle();
    return;
  }
  if (g.juggling) { juggleTouch(side); return; }
  g.press[side] = { t: 0, charged: false };
  if (g.free.on) { g.free.start(side); g.poss.has = false; }
});
input.on('footMove', (side, dx, dy, pts) => {
  if (g.free.active?.side === side) { g.free.move(dx, dy); return; }
  if (g.press[side]) hud.gesture(pts, '', side);
});
input.on('footUp', (side, pts, dur) => {
  const press = g.press[side];
  g.press[side] = null;
  if (!press) return;
  if (g.free.active?.side === side) { g.free.end(); g.poss.regain = 0.12; return; }
  const r = recognizeFoot(pts, side, dur, press.charged);
  g.lastGesture = { pts, r };
  hud.gesture(pts, r.label, side);
  if (g.charge?.side === side) { g.charge = null; hud.setCharge(null); }
  if (r.action === 'tap') footTouch(side);
  else if (r.action === 'pass') kick(side, { pass: true, speed: THREE.MathUtils.clamp(7 + r.length * 0.03, 7, 16), curl: r.curl * 0.6 });
  else if (r.action === 'shoot') kick(side, { power: Math.min((press.t - CHARGE_DELAY) / 0.9, 1), curl: r.curl });
  else startSkill(r.action, r.s);
});
input.on('key', (code) => {
  if (!g.started) { if (code === 'Enter') begin(); return; }
  initAudio();
  switch (code) {
    case 'KeyG': g.juggling ? endJuggle(false) : startJuggle(); break;
    case 'KeyF':
      g.free.on = !g.free.on;
      if (!g.free.on) g.free.end();
      hud.setFree(g.free.on);
      hud.toast(g.free.on ? 'free foot: hold a mouse button and move your boot' : 'gesture controls', 1.6);
      break;
    case 'KeyK':
      cam.bob = (cam.bob + 1) % BOB_LEVELS.length;
      hud.toast(`first person head motion: ${['full', 'half', 'minimal'][cam.bob]}`, 1.2);
      break;
    case 'Space':
      if (g.juggling) juggleTouch('R');
      else if (player.pos.y <= 0 && !g.skill) player.vy = 4.0;
      break;
    case 'KeyV':
      cam.fp = !cam.fp;
      cam.pitch = cam.fp ? PITCH.first : PITCH.third;
      if (cam.fp) cam.yaw = player.yaw;
      hud.setMode(cam.fp);
      break;
    case 'KeyB': resetBall(); break;
    case 'KeyH': document.getElementById('help').classList.toggle('collapsed'); break;
  }
});

function resetBall() {
  if (g.juggling) endJuggle(false);
  ball.kinematic = false;
  ball.place(player.toWorld(-0.04, R, 0.45));
  g.poss.has = true; g.poss.regain = 0;
  g.goalTimer = 0;
}

// ---------------------------------------------------------------- simulation
const angleTo = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

function step(dt) {
  // look
  const [mx, my] = input.takeLook();
  const keyLook = (input.down('ArrowLeft') ? 1 : 0) - (input.down('ArrowRight') ? 1 : 0);
  const keyPitch = (input.down('ArrowUp') ? 1 : 0) - (input.down('ArrowDown') ? 1 : 0);
  cam.yaw += -mx * SENS + keyLook * 2.2 * dt;
  cam.pitch += -my * SENS + keyPitch * 1.4 * dt;
  cam.pitch = cam.fp ? THREE.MathUtils.clamp(cam.pitch, -1.35, 0.9) : THREE.MathUtils.clamp(cam.pitch, -1.2, 0.45);
  cam.dist = THREE.MathUtils.clamp(cam.dist + input.takeWheel() * 0.4, 2.4, 9);

  // movement keeps going through most skills, so moves happen on the run; a brief
  // hands-off after a skill lets its burst of speed carry you after the ball
  if (g.escape > 0) g.escape -= dt;
  else if (!g.skill || !g.skill.stopsPlayer) {
    const sprinting = input.down('ShiftLeft') || input.down('ShiftRight');
    const fwd = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    const str = strafeInput();
    const cf = tmp.set(Math.sin(cam.yaw), 0, Math.cos(cam.yaw));
    const wish = new THREE.Vector3(-cf.z, 0, cf.x).multiplyScalar(str).addScaledVector(cf, fwd);
    if (wish.lengthSq() > 1) wish.normalize();
    const max = g.juggling ? 2.2 : g.charge !== null ? 3.2
      : g.poss.has ? (sprinting ? 7.2 : 4.8) : (sprinting ? 7.6 : 5.2);
    const target = wish.multiplyScalar(max);
    const rate = target.lengthSq() > 0 ? 9 : 11;
    const k = 1 - Math.exp(-rate * dt);
    player.vel.x += (target.x - player.vel.x) * k;
    player.vel.z += (target.z - player.vel.z) * k;
  }

  // facing
  if (!g.skill) {
    if (cam.fp) player.yaw = cam.yaw;
    else {
      const sp = Math.hypot(player.vel.x, player.vel.z);
      let want = null;
      if (g.charge !== null || g.juggling) want = cam.yaw;
      else if (sp > 0.4) want = Math.atan2(player.vel.x, player.vel.z);
      const rate = g.poss.has ? 9 : 12;
      if (want !== null && !g.free.active) player.yaw += angleTo(player.yaw, want) * (1 - Math.exp(-rate * dt));
    }
  }

  // jump / gravity
  if (player.pos.y > 0 || player.vy > 0) {
    player.vy -= 9.81 * dt;
    player.pos.y += player.vy * dt;
    if (player.pos.y <= 0) { player.pos.y = 0; player.vy = 0; }
  }
  player.pos.x += player.vel.x * dt;
  player.pos.z += player.vel.z * dt;

  // skill
  if (g.skill) {
    g.skillT += dt / g.skill.dur;
    const t = Math.min(g.skillT, 1);
    const def = g.skill, st = g.skillState;
    def.update(g, st, t, dt);
    // contact sounds at the moments the boot meets the ball
    while (def.sounds && g.cue < def.sounds.length && t >= def.sounds[g.cue][0]) {
      const kind = def.sounds[g.cue++][1];
      if (kind === 'swish') sfx.swish(ball.pos, camera);
      else if (st.withBall) {
        if (kind === 'kick') sfx.kick(0.3, ball.pos, camera);
        else if (kind === 'sole') sfx.sole(ball.pos, camera);
        else sfx.touch(0.5, ball.pos, camera);
      }
    }
    if (g.skillT >= 1) finishSkill();
  }

  // a foot button held still charges a shot with that foot
  for (const side of ['L', 'R']) {
    const pr = g.press[side];
    if (!pr || g.free.active) continue;
    pr.t += dt;
    const st = input.stroke(side);
    const moved = st ? Math.hypot(st.pts[st.pts.length - 1].x, st.pts[st.pts.length - 1].y) : 0;
    if (!pr.charged && pr.t > CHARGE_DELAY && moved < 12) { pr.charged = true; g.charge = { side, t: 0 }; }
  }
  if (g.charge) { g.charge.t += dt; hud.setCharge(Math.min(g.charge.t / 0.9, 1)); }

  // free foot: the boot follows the mouse; a hand-drawn step over still counts
  if (g.free.active) {
    const ev = g.free.update(dt, player.toBody(ball.pos));
    if (ev === 'stepover') { award(SKILLS.stepover.points, 'Step Over', 'by hand'); sfx.skill(g.combo); }
  }

  // short animations
  if (g.anim) { g.anim.t += dt / g.anim.dur; if (g.anim.t >= 1) g.anim = null; }
  if (g.skill) {
    player.override = () => {
      const p = g.skill.pose(g.skillState, Math.min(g.skillT, 1));
      return g.skill.mirror && g.skillState.s < 0 ? mirrorPose(p) : p;
    };
  } else if (g.anim) player.override = () => (g.anim.mirror ? mirrorPose(g.anim.pose(g.anim.t)) : g.anim.pose(g.anim.t));
  else if (g.free.active) player.override = () => g.free.pose();
  else player.override = null;

  if (g.pendingKick && (g.pendingKick.t -= dt) <= 0) launchKick();

  g.kickCooldown -= dt;
  g.flicked -= dt;
  closeControl(dt);
  bodyCollide();

  ball.step(dt, world.cones);
  for (const e of ball.events) {
    if (e.type === 'goal') {
      sfx.net(e.speed, ball.pos, camera);
      if (e.topBin) award(1000, 'TOP BIN!', `${Math.round(e.speed * 3.6)} km/h`);
      else award(500, 'GOAL!', `${Math.round(e.speed * 3.6)} km/h`);
      g.goalTimer = 2.4;
    } else if (e.type === 'woodwork') { hud.toast('off the woodwork!', 1.0); sfx.post(e.speed, ball.pos, camera); }
    else if (e.type === 'bounce') { sfx.bounce(e.speed * 1.6, ball.pos, camera); if (g.juggling) endJuggle(false); }
  }
  ball.events.length = 0;
  if (g.juggling && ball.onGround) endJuggle(false);

  if (g.goalTimer > 0 && (g.goalTimer -= dt) <= 0) resetBall();
  if (g.comboTimer > 0 && (g.comboTimer -= dt) <= 0) g.combo = 1;
  hud.setCombo(g.combo, Math.max(g.comboTimer / 2.6, 0));
}

// Close control. While you have the ball a soft spring holds it just ahead of your
// boot; the touch distance pulses with your stride and grows when sprinting. A loose
// ball is collected when it comes within reach, and dropping balls are cushioned.
function closeControl(dt) {
  const poss = g.poss;
  ball.controlled = false;
  if (g.skill || g.juggling || ball.kinematic || ball.inNet || g.free.active) { poss.has = false; return; }
  poss.regain -= dt;
  const f = player.forward();
  const sp = player.speed;

  if (!poss.has) {
    if (poss.regain > 0 || g.kickCooldown > 0) return;
    const chest = g.hdist(ball.pos, tmp.copy(player.pos).addScaledVector(f, 0.25));
    if (ball.onGround) poss.cushioned = false;
    if (!poss.cushioned && ball.pos.y > 0.3 && ball.pos.y < 1.7 && chest < 0.6 && ball.vel.y < -1) {
      // kill the pace once and let it drop onto the foot
      poss.cushioned = true;
      ball.vel.set(player.vel.x + f.x * 0.4, -0.5, player.vel.z + f.z * 0.4);
      ball.spin.set(0, 0, 0);
      poss.regain = 0.12;
      sfx.body('chest', 4, ball.pos, camera);
      if (g.flicked > 0) { g.flicked = 0; award(150, 'Clean Control', 'rainbow complete'); }
      else hud.toast('cushioned', 0.6);
      return;
    }
    const d = g.hdist(ball.pos, g.front(tmp2));
    const relV = Math.hypot(ball.vel.x - player.vel.x, ball.vel.z - player.vel.z);
    const reach = 0.7 + Math.min(sp, 7) * 0.05;
    if (ball.pos.y > 0.45 || d > reach || relV > 14) return;
    poss.has = true;
    poss.cushioned = false;
    sfx.touch(Math.min(relV / 8, 1), ball.pos, camera);
    if (relV > 6) hud.toast('first touch', 0.6);
  }

  const jog = Math.min(sp / 5, 1);
  const sprint = THREE.MathUtils.clamp((sp - 5.2) / 2, 0, 1);
  const stride = ((player.phase / Math.PI) % 1 + 1) % 1; // 0 at each footfall
  const wave = Math.sin(Math.PI * stride);
  const lz = 0.36 + 0.1 * jog + 0.5 * sprint + (0.04 + 0.08 * jog + 0.4 * sprint) * wave;
  const lx = -0.1 + (1 - jog) * 0.035 * Math.sin(player.time * 1.7); // idle sole roll
  const target = player.toWorld(lx, R, lz, tmp);
  // a soft touch sound once per stride, when the boot meets the ball
  const cyc = ((player.phase / (Math.PI * 2)) % 1 + 1) % 1;
  if (sp > 1 && cyc < g.lastCyc) sfx.touch(0.15 + 0.35 * jog + 0.3 * sprint, ball.pos, camera);
  g.lastCyc = cyc;

  const ex = target.x - ball.pos.x, ez = target.z - ball.pos.z;
  if (Math.hypot(ex, ez) > 1.6 || ball.pos.y > 0.6) { poss.has = false; poss.regain = 0.3; return; }
  const kp = 95 - 40 * sprint, kd = 1.8 * Math.sqrt(kp);
  ball.vel.x += (kp * ex + kd * (player.vel.x - ball.vel.x)) * dt;
  ball.vel.z += (kp * ez + kd * (player.vel.z - ball.vel.z)) * dt;
  if (ball.vel.y > 0) ball.vel.y *= 0.5;
  ball.controlled = true;
}

// Loose balls bounce off whatever part of the body they hit. The response uses the
// limb's own velocity, so a swinging leg or a rising head sends the ball away, and
// friction across the contact puts spin on it.
const BODY_BOUNCE = { head: 0.6, chest: 0.3, body: 0.3, thigh: 0.42, shin: 0.48, foot: 0.5, arm: 0.35 };
const _ab = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3();
const _vp = new THREE.Vector3(), _rel = new THREE.Vector3(), _t = new THREE.Vector3();
function bodyCollide() {
  if (g.skill || g.poss.has || g.juggling || ball.kinematic || g.kickCooldown > 0) return;
  const cols = player.rig?.colliders;
  if (!cols) return bodyBlock();
  for (const c of cols) {
    _ab.subVectors(c.b, c.a);
    const t = THREE.MathUtils.clamp(_c.subVectors(ball.pos, c.a).dot(_ab) / Math.max(_ab.lengthSq(), 1e-8), 0, 1);
    _c.copy(c.a).addScaledVector(_ab, t);
    _n.subVectors(ball.pos, _c);
    const d = _n.length(), min = R + c.r;
    if (d >= min || d < 1e-6) continue;
    _n.divideScalar(d);
    ball.pos.copy(_c).addScaledVector(_n, min);
    if (ball.pos.y < R) ball.pos.y = R;

    // only part of a limb's swing reaches the ball (legs are not rigid), so running
    // into it nudges it on instead of blasting it away
    const driven = g.free.active && c.side === g.free.active.side && (c.part === 'foot' || c.part === 'shin');
    _vp.lerpVectors(c.va, c.vb, t).sub(player.vel).multiplyScalar(driven ? 1 : 0.35).add(player.vel);
    _rel.subVectors(ball.vel, _vp);
    const vn = _rel.dot(_n);
    if (vn >= 0) continue;
    const e = BODY_BOUNCE[c.part];
    _t.copy(_rel).addScaledVector(_n, -vn); // sliding across the contact
    ball.vel.copy(_vp).addScaledVector(_t, 0.75).addScaledVector(_n, -vn * e);
    ball.spin.addScaledVector(_c.crossVectors(_n, _t), 0.25 * 1.5 / R);
    ball.onGround = false;
    g.lastBump = c.part;
    if (driven) { g.free.active.touched = true; sfx.touch(Math.min(-vn / 4, 1), ball.pos, camera); }
    else { sfx.body(c.part, -vn, ball.pos, camera); if (-vn > 2.5) hud.toast(`off the ${c.part}`, 0.6); }
  }
}

// fallback for the plain mannequin: keep the ball out of the player's legs
function bodyBlock() {
  if (ball.pos.y > 1.0 || ball.vel.y > 1) return;
  const dx = ball.pos.x - player.pos.x, dz = ball.pos.z - player.pos.z;
  const d = Math.hypot(dx, dz), min = 0.2 + R;
  if (d < min && d > 1e-5) {
    ball.pos.x = player.pos.x + (dx / d) * min;
    ball.pos.z = player.pos.z + (dz / d) * min;
    const vn = (ball.vel.x * dx + ball.vel.z * dz) / d;
    if (vn < 0) { ball.vel.x -= (dx / d) * vn * 1.4; ball.vel.z -= (dz / d) * vn * 1.4; }
  }
}

// ---------------------------------------------------------------- camera
const camPos = new THREE.Vector3();
function updateCamera(dt) {
  cam.blend += ((cam.fp ? 1 : 0) - cam.blend) * (1 - Math.exp(-9 * dt));
  const dir = new THREE.Vector3(
    Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch));

  // over-the-shoulder framing so the ball is not hidden behind the player
  const shoulder = new THREE.Vector3(-Math.cos(cam.yaw), 0, Math.sin(cam.yaw)).multiplyScalar(0.55);
  const target = tmp.copy(player.pos).add(shoulder).setY(player.pos.y + 1.35);
  const third = target.clone().addScaledVector(dir, -cam.dist);
  third.y = Math.max(third.y, 0.25);

  // First person rides the model's head: real head motion from the run and from
  // every skill, damped so it never jerks, and blended toward a steady eye line by
  // the comfort setting (K). The camera leans into turns and strafes.
  // Only the head's motion relative to a steady eye point is damped; the steady point
  // moves exactly with the player, so the camera never trails behind the head.
  const f = player.forward();
  const steady = player.pos.clone().addScaledVector(f, 0.14).setY(player.pos.y + 1.66);
  const head = player.rig ? player.rig.eyePos(new THREE.Vector3()).addScaledVector(f, 0.14) : steady.clone();
  const offset = head.sub(steady).multiplyScalar(BOB_LEVELS[cam.bob]);
  if (!cam.fpOffset) cam.fpOffset = offset.clone();
  cam.fpOffset.lerp(offset, 1 - Math.exp(-22 * dt));
  const first = steady.add(cam.fpOffset);

  camPos.lerpVectors(third, first, cam.blend);
  camera.position.copy(camPos);
  camera.lookAt(tmp2.copy(camPos).add(dir));
  const yawRate = angleTo(cam.lastYaw, player.yaw) / Math.max(dt, 1e-3);
  cam.lastYaw = player.yaw;
  const side = player.vel.dot(player.left());
  const rollWant = THREE.MathUtils.clamp(yawRate * 0.025 + side * 0.012, -0.1, 0.1) * BOB_LEVELS[cam.bob];
  cam.roll += (rollWant - cam.roll) * (1 - Math.exp(-6 * dt));
  camera.rotateZ(cam.roll * cam.blend);
  player.setFirstPerson(cam.blend > 0.6);

  const sprint = Math.min(Math.max(player.speed - 5, 0) / 2.4, 1);
  const fov = (cam.fp ? 78 : 62) + sprint * 6;
  cam.fov += (fov - cam.fov) * (1 - Math.exp(-6 * dt));
  camera.fov = cam.fov;
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
let acc = 0;
const FIXED = 1 / 120;
function frame() {
  if (g.paused) { requestAnimationFrame(frame); return; } // set from the console or tests to freeze time
  const dt = Math.min(clock.getDelta(), 0.1);
  acc += dt;
  while (acc >= FIXED) { step(FIXED); acc -= FIXED; }
  player.animate(dt);
  updateCamera(dt);
  g.poss.show += ((g.poss.has ? 1 : 0) - g.poss.show) * (1 - Math.exp(-10 * dt));
  world.shared.uPossess.value = g.poss.show;
  world.update(dt, camera, ball, player);
  hud.update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// handy for debugging from the console
window.__game = {
  g, ball, player, cam, input, step, startSkill, kick, resetBall, startJuggle, juggleTouch,
  // draw one frame without advancing time (pair with g.paused)
  render() { updateCamera(1 / 60); world.update(0, camera, ball, player); renderer.render(scene, camera); },
};
