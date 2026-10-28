import * as THREE from 'three';
import { createWorld } from './world.js';
import { createBall } from './ball.js';
import { createPlayer } from './player.js';
import { SKILLS, recognize } from './skills.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
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
const PITCH = { third: -0.28, first: -0.55 };
const R = ball.radius;
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

const cam = { fp: false, yaw: Math.PI, pitch: PITCH.third, dist: 4.6, blend: 0, fov: 62 };

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
  side: { stepover: 1, elastico: 1, roulette: 1, dragback: 1 },

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
  if (!g.started || g.skill || g.juggling || ball.inNet) return;
  const def = SKILLS[key];
  g.skill = def; g.skillKey = key; g.skillT = 0;
  const d = tmp.subVectors(ball.pos, player.pos);
  g.holdFrom = new THREE.Vector3(d.dot(player.left()), ball.pos.y - player.pos.y, d.dot(player.forward()));
  g.skillState = def.start(g, side);
  g.poss.has = false;
  g.charge = null; hud.setCharge(null);
}

function nextSide(key) { g.side[key] *= -1; return g.side[key]; }

function strafeInput() { return (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0); }

function kick(hold) {
  const aimYaw = cam.yaw;
  if (!cam.fp) player.yaw = aimYaw;
  const f = player.forward();
  const contact = player.pos.clone().addScaledVector(f, 0.42);
  const reach = g.poss.has || (g.hdist(ball.pos, contact) < 0.9 && ball.pos.y < 1.0 && !ball.kinematic && !ball.inNet);
  const c = Math.min(hold / 0.9, 1);
  g.anim = { t: 0, dur: 0.38, pose: kickPose(hold < 0.16 ? 0.5 : 0.7 + 0.3 * c) };
  if (!reach) { hud.toast('too far from the ball', 0.8); return; }

  let speed, elev;
  if (hold < 0.16) { speed = 9.5; elev = 0.02; }
  else {
    speed = 11 + 19 * c;
    const base = cam.fp ? PITCH.first : PITCH.third;
    elev = THREE.MathUtils.clamp(0.03 + 0.07 * c + Math.max(0, cam.pitch - base) * 0.7, 0.02, 0.85);
  }
  const dir = new THREE.Vector3(Math.sin(aimYaw) * Math.cos(elev), Math.sin(elev), Math.cos(aimYaw) * Math.cos(elev));
  ball.vel.copy(dir).multiplyScalar(speed).addScaledVector(player.vel, 0.25);
  if (ball.pos.y < R + 0.02) ball.pos.y = R + 0.01;
  // lofted shots get backspin (they float and check up), driven ones a little topspin (they dip);
  // holding A or D adds sidespin to curl it
  const top = elev > 0.28 ? -26 : hold < 0.16 ? 0 : 9 * c;
  ball.spin.set(Math.cos(aimYaw) * top, -strafeInput() * 13, -Math.sin(aimYaw) * top);
  ball.onGround = false;
  g.poss.has = false; g.poss.regain = 0.45;
  g.kickCooldown = 0.35;
  if (g.juggling) endJuggle(true);
}

function kickPose(power) {
  return (t) => {
    const wind = t < 0.35, strike = t >= 0.35 && t < 0.6;
    const w = Math.min(t / 0.1, 1) * Math.min((1 - t) / 0.2, 1);
    return {
      w,
      hipR: wind ? 0.6 * power * (t / 0.35) : strike ? -1.1 * power : -0.6 * power,
      kneeR: wind ? 1.4 * (t / 0.35) : strike ? 0.15 : 0.3,
      hipL: 0.1, kneeL: 0.2, shLz: 0.7, shRz: -0.3, shL: -0.4, spineX: strike ? -0.05 : 0.15,
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
  hud.toast('keepy-uppy: tap SPACE as the ball drops', 2.2);
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
    if (kind === 'knee') return { w: b, hipR: -1.5, kneeR: 1.7, shLz: 0.5, shRz: -0.5 };
    return { w: b, hipR: -0.6, kneeR: 0.45, shLz: 0.45, shRz: -0.45 };
  };
}

function juggleTouch() {
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
  g.anim = { t: 0, dur: 0.26, pose: jugglePose(kind ?? 'foot') };
  if (!kind) return;
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
  input.lock();
}
overlay.addEventListener('click', begin);
input.on('wantLock', () => { if (g.started) input.lock(); });
input.on('lmbDown', () => {
  if (!g.started || g.skill) return;
  if (g.juggling) { juggleTouch(); return; }
  g.charge = 0;
});
input.on('lmbUp', () => {
  if (g.charge === null) return;
  const hold = g.charge;
  g.charge = null; hud.setCharge(null);
  kick(hold);
});
input.on('gestureMove', (pts) => hud.gesture(pts));
input.on('gestureEnd', (pts) => {
  const r = recognize(pts);
  g.lastGesture = { pts, r };
  hud.gesture(pts, r ? `${r.label}  →  ${SKILLS[r.skill].name}` : 'no move');
  if (r) startSkill(r.skill, r.side);
});
input.on('key', (code) => {
  if (!g.started) { if (code === 'Enter') begin(); return; }
  switch (code) {
    case 'KeyQ': startSkill('stepover', nextSide('stepover')); break;
    case 'KeyE': startSkill('elastico', strafeInput() ? -strafeInput() : nextSide('elastico')); break;
    case 'KeyR': startSkill('roulette', nextSide('roulette')); break;
    case 'KeyF': startSkill('rainbow', 1); break;
    case 'KeyC': startSkill('dragback', nextSide('dragback')); break;
    case 'KeyG': g.juggling ? endJuggle(false) : startJuggle(); break;
    case 'Space':
      if (g.juggling) juggleTouch();
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

  // movement (briefly hands-off after a skill so its burst of speed carries you after the ball)
  if (g.escape > 0) g.escape -= dt;
  else if (!g.skill) {
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
      if (want !== null) player.yaw += angleTo(player.yaw, want) * (1 - Math.exp(-rate * dt));
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
    g.skill.update(g, g.skillState, t, dt);
    if (g.skillT >= 1) {
      const def = g.skill, st = g.skillState;
      g.skill = null;
      ball.kinematic = false;
      const withBall = def.end(g, st);
      if (withBall) {
        if (g.skillKey === 'rainbow') g.flicked = 1.8;
        award(def.points, def.name);
      } else hud.toast(`${def.name.toLowerCase()} (no ball)`, 0.8);
      g.poss.regain = g.skillKey === 'rainbow' ? 0.45 : 0.1;
      g.escape = withBall && g.skillKey !== 'dragback' ? 0.3 : 0;
    }
  }

  // short animations
  if (g.anim) { g.anim.t += dt / g.anim.dur; if (g.anim.t >= 1) g.anim = null; }
  if (g.skill) player.override = () => g.skill.pose(g.skillState, Math.min(g.skillT, 1));
  else if (g.anim) player.override = () => g.anim.pose(g.anim.t);
  else player.override = null;

  if (g.charge !== null) { g.charge += dt; hud.setCharge(Math.min(g.charge / 0.9, 1)); }

  g.kickCooldown -= dt;
  g.flicked -= dt;
  closeControl(dt);
  bodyBlock();

  ball.step(dt, world.cones);
  for (const e of ball.events) {
    if (e.type === 'goal') {
      if (e.topBin) award(1000, 'TOP BIN!', `${Math.round(e.speed * 3.6)} km/h`);
      else award(500, 'GOAL!', `${Math.round(e.speed * 3.6)} km/h`);
      g.goalTimer = 2.4;
    } else if (e.type === 'woodwork') hud.toast('off the woodwork!', 1.0);
    else if (e.type === 'bounce' && g.juggling) endJuggle(false);
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
  if (g.skill || g.juggling || ball.kinematic || ball.inNet) { poss.has = false; return; }
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
    if (relV > 6) hud.toast('first touch', 0.6);
  }

  const jog = Math.min(sp / 5, 1);
  const sprint = THREE.MathUtils.clamp((sp - 5.2) / 2, 0, 1);
  const stride = ((player.phase / Math.PI) % 1 + 1) % 1; // 0 at each footfall
  const wave = Math.sin(Math.PI * stride);
  const lz = 0.36 + 0.1 * jog + 0.5 * sprint + (0.04 + 0.08 * jog + 0.4 * sprint) * wave;
  const lx = -0.1 + (1 - jog) * 0.035 * Math.sin(player.time * 1.7); // idle sole roll
  const target = player.toWorld(lx, R, lz, tmp);

  const ex = target.x - ball.pos.x, ez = target.z - ball.pos.z;
  if (Math.hypot(ex, ez) > 1.6 || ball.pos.y > 0.6) { poss.has = false; poss.regain = 0.3; return; }
  const kp = 95 - 40 * sprint, kd = 1.8 * Math.sqrt(kp);
  ball.vel.x += (kp * ex + kd * (player.vel.x - ball.vel.x)) * dt;
  ball.vel.z += (kp * ez + kd * (player.vel.z - ball.vel.z)) * dt;
  if (ball.vel.y > 0) ball.vel.y *= 0.5;
  ball.controlled = true;
}

// keep the ball from passing through the player's legs
function bodyBlock() {
  if (g.skill || g.poss.has || ball.kinematic || ball.pos.y > 1.0 || ball.vel.y > 1) return;
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

  const bob = Math.abs(Math.sin(player.phase)) * 0.025 * Math.min(player.speed / 6, 1);
  const first = player.pos.clone().addScaledVector(player.forward(), 0.24).setY(player.pos.y + 1.62 + bob);

  camPos.lerpVectors(third, first, cam.blend);
  camera.position.copy(camPos);
  camera.lookAt(tmp2.copy(camPos).add(dir));
  player.setFirstPerson(cam.blend > 0.6);

  const sprint = Math.min(Math.max(player.speed - 5, 0) / 2.4, 1);
  const fov = (cam.fp ? 72 : 62) + sprint * 6;
  cam.fov += (fov - cam.fov) * (1 - Math.exp(-6 * dt));
  camera.fov = cam.fov;
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
let acc = 0;
const FIXED = 1 / 120;
function frame() {
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
window.__game = { g, ball, player, cam, input, step, startSkill, kick, resetBall, startJuggle, juggleTouch };
