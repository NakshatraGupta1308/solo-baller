import * as THREE from 'three';

// Each skill drives the player's pose and, when the ball is at the player's feet,
// moves the ball kinematically, then releases it with a velocity.

const ease = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const easeIn = (t) => t * t;
const clamp01 = (t) => Math.min(Math.max(t, 0), 1);
const bell = (t) => Math.sin(Math.PI * clamp01(t));
const env = (t) => clamp01(t / 0.12) * clamp01((1 - t) / 0.15);

const R = 0.11;

export const SKILLS = {
  stepover: {
    name: 'Step Over', points: 100, dur: 0.6,
    start(g, s) { return { s, withBall: g.ballAtFeet(1.1) }; },
    update(g, st, t, dt) {
      g.player.vel.multiplyScalar(Math.exp(-3 * dt));
      if (st.withBall) g.holdBall(g.player.toWorld(-0.04, R, 0.44), dt, t);
    },
    end(g, st) {
      const { player, ball } = g;
      const dir = player.left().multiplyScalar(st.s * 0.85).add(player.forward().multiplyScalar(0.6)).normalize();
      player.vel.copy(dir).multiplyScalar(5.0);
      if (st.withBall) { ball.kinematic = false; ball.vel.copy(dir).multiplyScalar(5.0); }
      return st.withBall;
    },
    pose(st, t) {
      const b = bell(t), out = st.s > 0 ? -1 : 1, leg = st.s > 0 ? 'R' : 'L';
      return {
        w: env(t),
        ['hip' + leg]: -0.55 * b,
        ['hip' + leg + 'z']: out * (-0.35 + 0.9 * ease(t)) * b,
        ['knee' + leg]: 0.2 + 1.1 * b,
        spineZ: st.s * 0.25 * b, spineX: 0.2, drop: 0.07 * b,
        shLz: 0.55, shRz: -0.55,
      };
    },
  },

  elastico: {
    name: 'Elastico', points: 200, dur: 0.55,
    start(g, s) { return { s, withBall: g.ballAtFeet(1.0) }; },
    update(g, st, t, dt) {
      g.player.vel.multiplyScalar(Math.exp(-2.5 * dt));
      if (!st.withBall) return;
      const s = st.s;
      const lx = t < 0.4 ? -s * (0.05 + 0.32 * easeOut(t / 0.4)) : -s * 0.37 + s * 1.0 * easeIn((t - 0.4) / 0.6);
      g.holdBall(g.player.toWorld(lx, R, 0.42 + 0.15 * t), dt, t);
    },
    end(g, st) {
      const { player, ball } = g;
      const dir = player.left().multiplyScalar(st.s * 0.9).add(player.forward().multiplyScalar(0.55)).normalize();
      player.vel.copy(dir).multiplyScalar(5.2);
      if (st.withBall) { ball.kinematic = false; ball.vel.copy(dir).multiplyScalar(5.3); }
      return st.withBall;
    },
    pose(st, t) {
      const out = st.s > 0 ? -1 : 1, leg = st.s > 0 ? 'R' : 'L';
      const z = t < 0.4 ? out * 0.4 * easeOut(t / 0.4) : THREE.MathUtils.lerp(out * 0.4, -out * 0.35, ease((t - 0.4) / 0.6));
      return {
        w: env(t),
        ['hip' + leg]: -0.35, ['hip' + leg + 'z']: z, ['knee' + leg]: 0.35,
        spineZ: -out * 0.2 * bell(t), spineX: 0.22, drop: 0.06,
        shLz: 0.5, shRz: -0.5,
      };
    },
  },

  roulette: {
    name: 'Roulette', points: 250, dur: 0.85,
    start(g, s) { return { s, withBall: g.ballAtFeet(1.1) }; },
    update(g, st, t, dt) {
      const { player } = g;
      const side = player.left().multiplyScalar(-st.s * 1.2);
      player.vel.copy(side).addScaledVector(player.forward(), 1.4);
      if (!st.withBall) return;
      const th = st.s * Math.PI * 2 * ease(t);
      const x0 = -0.04, z0 = 0.44;
      const lx = x0 * Math.cos(th) + z0 * Math.sin(th);
      const lz = -x0 * Math.sin(th) + z0 * Math.cos(th);
      g.holdBall(player.toWorld(lx, R, lz), dt, t);
    },
    end(g, st) {
      const { player, ball } = g;
      player.vel.copy(player.forward()).multiplyScalar(4.2);
      if (st.withBall) { ball.kinematic = false; ball.vel.copy(player.forward()).multiplyScalar(5.0); }
      return st.withBall;
    },
    pose(st, t) {
      const first = t < 0.5;
      return {
        w: env(t) * 0.9 + 0.1,
        yaw: st.s * Math.PI * 2 * ease(t),
        hipR: first ? -0.45 * bell(t * 2) : 0.1, kneeR: first ? 0.5 : 0.2,
        hipL: first ? 0.1 : -0.45 * bell((t - 0.5) * 2), kneeL: first ? 0.2 : 0.5,
        spineX: 0.05, shLz: 0.7, shRz: -0.7, drop: 0.05,
      };
    },
  },

  rainbow: {
    name: 'Rainbow Flick', points: 300, dur: 0.85,
    start(g) { return { withBall: g.ballAtFeet(1.0), released: false }; },
    update(g, st, t, dt) {
      const { player, ball } = g;
      if (!st.withBall || st.released) return;
      if (t < 0.35) {
        const u = ease(t / 0.35);
        g.holdBall(player.toWorld(-0.08, R + 0.22 * u + 0.08 * Math.sin(Math.PI * u), THREE.MathUtils.lerp(0.42, -0.3, u)), dt, t);
      } else {
        st.released = true;
        ball.kinematic = false;
        ball.vel.copy(player.vel).addScaledVector(player.forward(), 1.0).setY(5.7);
        ball.spin.copy(player.left()).multiplyScalar(-14);
      }
    },
    end(g, st) { return st.withBall; },
    pose(st, t) {
      const a = t < 0.35, flick = t >= 0.35 && t < 0.6;
      return {
        w: env(t),
        hipL: -0.3, kneeL: 0.25,
        hipR: a ? 0.4 * ease(t / 0.35) : flick ? 0.75 : 0.3,
        kneeR: a ? 1.2 * ease(t / 0.35) : flick ? 1.9 : 0.8,
        spineX: a ? 0.25 : -0.05, shLz: 0.8, shRz: -0.8, shL: -0.3, shR: -0.3,
        drop: a ? 0.04 : -0.02,
      };
    },
  },

  dragback: {
    name: 'Drag Back', points: 120, dur: 0.6,
    start(g, s) {
      const { player } = g;
      return { s, withBall: g.ballAtFeet(1.0), yaw0: player.yaw, f0: player.forward(), l0: player.left() };
    },
    update(g, st, t, dt) {
      const { player, ball } = g;
      player.vel.multiplyScalar(Math.exp(-8 * dt));
      const yaw = st.yaw0 + st.s * Math.PI * ease(clamp01((t - 0.25) / 0.7));
      g.turnPlayer(yaw - player.yaw);
      if (!st.withBall) return;
      const p = player.pos.clone().addScaledVector(st.f0, 0.42 - 0.95 * ease(clamp01(t / 0.75)))
        .addScaledVector(st.l0, -0.06).setY(R);
      g.holdBall(p, dt, t);
    },
    end(g, st) {
      const { player, ball } = g;
      g.turnPlayer(st.yaw0 + st.s * Math.PI - player.yaw);
      if (st.withBall) { ball.kinematic = false; ball.vel.copy(player.forward()).multiplyScalar(1.6); }
      player.vel.copy(player.forward()).multiplyScalar(2.5);
      return st.withBall;
    },
    pose(st, t) {
      return {
        w: env(t),
        hipR: THREE.MathUtils.lerp(-0.5, 0.35, ease(clamp01(t / 0.6))), kneeR: 0.45,
        hipL: 0.05, kneeL: 0.3, spineX: 0.25, drop: 0.05, shLz: 0.4, shRz: -0.4,
      };
    },
  },
};

// Mouse gestures, drawn while holding the right button.
// Returns { skill, side, label } or null.
export function recognize(raw) {
  if (raw.length < 3) return null;
  let L = 0;
  for (let i = 1; i < raw.length; i++) L += Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y);
  if (L < 40) return null;

  // resample to evenly spaced points
  const N = 32, step = L / (N - 1), pts = [raw[0]];
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
  while (pts.length < N) pts.push(raw[raw.length - 1]);

  let turn = 0, rev = 0, lastSx = 0, firstSx = 0, lastAng = null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < N; i++) {
    minX = Math.min(minX, pts[i].x); maxX = Math.max(maxX, pts[i].x);
    minY = Math.min(minY, pts[i].y); maxY = Math.max(maxY, pts[i].y);
    // sum the turning between segments, skipping near-zero ones whose direction is noise
    if (i >= 1) {
      const sx = pts[i].x - pts[i - 1].x, sy = pts[i].y - pts[i - 1].y;
      if (Math.hypot(sx, sy) > step * 0.3) {
        const a = Math.atan2(sy, sx);
        if (lastAng !== null) {
          let da = a - lastAng;
          while (da > Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          turn += da;
        }
        lastAng = a;
      }
    }
  }
  for (let i = 3; i < N; i += 3) {
    const dx = pts[i].x - pts[i - 3].x;
    if (Math.abs(dx) < step * 0.8) continue;
    const sx = Math.sign(dx);
    if (!firstSx) firstSx = sx;
    if (lastSx && sx !== lastSx) rev++;
    lastSx = sx;
  }
  const w = maxX - minX, h = maxY - minY;
  const dx = pts[N - 1].x - pts[0].x, dy = pts[N - 1].y - pts[0].y;

  if (Math.abs(turn) > 4.2) {
    const s = turn > 0 ? 1 : -1;
    return { skill: 'roulette', side: s, label: s > 0 ? 'circle  ↻' : 'circle  ↺' };
  }
  if (rev >= 2 && w > h * 0.8) return { skill: 'stepover', side: firstSx > 0 ? 1 : -1, label: 'zig-zag' };
  if (Math.abs(dx) > Math.abs(dy)) {
    return { skill: 'elastico', side: dx > 0 ? -1 : 1, label: dx > 0 ? 'swipe →' : 'swipe ←' };
  }
  if (dy < 0) return { skill: 'rainbow', side: 1, label: 'flick ↑' };
  return { skill: 'dragback', side: 1, label: 'pull ↓' };
}
