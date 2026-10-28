import * as THREE from 'three';

// Each skill moves the ball along a path near the player's feet and drives the
// feet with ankle targets in body space (x left, y up, z forward). Leg IK turns
// those targets into hip and knee angles, so a foot can genuinely circle over the
// ball, wrap around it or sit on top of it. Moves are authored for the right foot
// (side = 1) and mirrored for the left (side = -1).

const ease = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const easeIn = (t) => t * t;
const clamp01 = (t) => Math.min(Math.max(t, 0), 1);
const bell = (t) => Math.sin(Math.PI * clamp01(t));
const env = (t, a = 0.1, b = 0.16) => ease(clamp01(t / a)) * ease(clamp01((1 - t) / b));
const span = (t, a, b) => clamp01((t - a) / (b - a)); // 0..1 across [a, b]
const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

const R = 0.11;
const A = 0.08; // ankle height, boot flat on the grass
const REST_R = [-0.11, A, 0.04];
const REST_L = [0.11, A, 0.02];

/** Catmull-Rom spline through keys [[t, x, y, z], ...]; smooth through every key. */
export function track(keys, t) {
  if (t <= keys[0][0]) return keys[0].slice(1);
  const n = keys.length;
  if (t >= keys[n - 1][0]) return keys[n - 1].slice(1);
  let i = 0;
  while (keys[i + 1][0] < t) i++;
  const p0 = keys[Math.max(i - 1, 0)], p1 = keys[i], p2 = keys[i + 1], p3 = keys[Math.min(i + 2, n - 1)];
  const u = (t - p1[0]) / (p2[0] - p1[0]);
  const out = [];
  for (let k = 1; k < 4; k++) {
    const a = p0[k], b = p1[k], c = p2[k], d = p3[k];
    out.push(0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u));
  }
  return out;
}

// mirror an authored right-foot point for the left foot
const mx = (p, s) => [p[0] * s, p[1], p[2]];
// assign the acting / supporting foot by side
function feet(s, act, sup) { return s > 0 ? { footR: act, footL: sup } : { footL: mx(act, -1), footR: mx(sup, -1) }; }
// arms out for balance, mirrored
const arms = (k, s = 1) => ({ shLz: 0.15 + 0.5 * k, shRz: -0.15 - 0.5 * k, elL: -0.5, elR: -0.5, shL: -0.1 * s * k, shR: 0.1 * s * k });

// where the ball currently is, in the player's body space (handles spins and turns)
const ballBody = (g) => { const b = g.player.toBody(g.ball.pos); return [b.x, b.y, b.z]; };

export const SKILLS = {
  // Right foot lifts inside the ball, circles over the top of it and lands wide on
  // the outside, selling the move that way; you then burst off the other way.
  stepover: {
    name: 'Step Over', points: 100, dur: 0.62, sounds: [[0.45, 'swish']],
    start(g, s) { return { g, s, withBall: g.ballAtFeet(1.1) }; },
    update(g, st, t, dt) {
      if (st.withBall) g.holdBall(g.player.toWorld(-0.03 * st.s, R, 0.46), dt, t);
    },
    end(g, st) {
      const { player, ball } = g;
      const dir = player.left().multiplyScalar(st.s * 0.85).add(player.forward().multiplyScalar(0.6)).normalize();
      player.vel.copy(dir).multiplyScalar(5.0);
      if (st.withBall) { ball.kinematic = false; ball.vel.copy(dir).multiplyScalar(5.0); }
      return st.withBall;
    },
    pose(st, t) {
      const s = st.s, b = bell(t);
      const act = track([
        [0, ...REST_R], [0.16, 0.0, 0.17, 0.2], [0.33, 0.13, 0.3, 0.44], [0.5, 0.0, 0.34, 0.68],
        [0.66, -0.28, 0.24, 0.62], [0.82, -0.4, A, 0.38], [1, -0.38, A, 0.3],
      ], t);
      return {
        w: env(t, 0.06, 0.12), ...feet(s, act, [0.14, A, 0.12]),
        pitchR: s > 0 ? 0.2 * b : 0, pitchL: s < 0 ? 0.2 * b : 0,
        drop: 0.05 + 0.05 * b, spineX: 0.22, spineZ: s * 0.24 * b, spineY: -s * 0.3 * bell(t * 1.15),
        yaw: -s * 0.18 * b, ...arms(0.8, s),
      };
    },
  },

  // Outside of the right foot pushes the ball out, the foot wraps around it, and the
  // inside snaps it back across the body.
  elastico: {
    name: 'Elastico', points: 200, dur: 0.54, sounds: [[0.14, 'touch'], [0.46, 'swish'], [0.56, 'touch']],
    ballAt(s, t) {
      const lx = t < 0.4 ? -0.04 - 0.28 * easeOut(t / 0.4) : -0.32 + 0.9 * easeIn((t - 0.4) / 0.6);
      return [lx * s, R, 0.44 + 0.12 * t];
    },
    start(g, s) { return { g, s, withBall: g.ballAtFeet(1.0) }; },
    update(g, st, t, dt) {
      if (st.withBall) g.holdBall(g.player.toWorld(...this.ballAt(st.s, t)), dt, t);
    },
    end(g, st) {
      const { player, ball } = g;
      const dir = player.left().multiplyScalar(st.s * 0.9).add(player.forward().multiplyScalar(0.55)).normalize();
      player.vel.copy(dir).multiplyScalar(5.2);
      if (st.withBall) { ball.kinematic = false; ball.vel.copy(dir).multiplyScalar(5.3); }
      return st.withBall;
    },
    pose(st, t) {
      const s = st.s;
      const b = (k) => mx(this.ballAt(1, k), 1);
      const act = track([
        [0, ...REST_R],
        [0.12, ...add3(b(0.12), [0.15, -0.03, -0.07])],   // outside of the boot on the ball's inner side
        [0.38, ...add3(b(0.38), [0.15, -0.03, -0.07])],   // pushing it out
        [0.46, ...add3(b(0.46), [0.0, 0.15, 0.06])],      // wrapping over the top
        [0.54, ...add3(b(0.54), [-0.16, -0.02, -0.04])],  // inside of the boot on the far side
        [0.84, ...add3(b(0.84), [-0.16, -0.03, -0.05])],  // snapping it back across
        [1, 0.02, A, 0.34],
      ], t);
      return {
        w: env(t, 0.08, 0.12), ...feet(s, act, [0.15, A, 0.16]),
        drop: 0.06, spineX: 0.24, spineZ: -s * 0.18 * bell(span(t, 0.3, 1)), spineY: s * 0.2 * bell(t),
        ...arms(0.7, s),
      };
    },
  },

  // Marseille turn: right sole drags the ball as you spin, then the left sole takes
  // over to finish the turn.
  roulette: {
    name: 'Roulette', points: 250, dur: 0.82, sounds: [[0.1, 'sole'], [0.55, 'sole']],
    start(g, s) { return { g, s, withBall: g.ballAtFeet(1.1) }; },
    update(g, st, t, dt) {
      const { player } = g;
      player.vel.copy(player.left().multiplyScalar(-st.s * 1.2)).addScaledVector(player.forward(), Math.max(1.3, st.fwd * 0.6));
      if (!st.withBall) return;
      const th = st.s * Math.PI * 2 * ease(t);
      const x0 = THREE.MathUtils.lerp(-0.05, 0.05, ease(span(t, 0.42, 0.58))), z0 = 0.33;
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
      const s = st.s;
      const sole = (x) => [x, R + R + 0.05, 0.29];
      const r = ease(span(t, 0.03, 0.12)) * (1 - ease(span(t, 0.46, 0.56)));
      const l = ease(span(t, 0.5, 0.6)) * (1 - ease(span(t, 0.88, 0.98)));
      const footR = lerp3([-0.14, A, -0.02], sole(-0.05), r); footR[1] += 0.06 * bell(span(t, 0.0, 0.14)) + 0.06 * bell(span(t, 0.46, 0.6));
      const footL = lerp3([0.14, A, -0.02], sole(0.05), l); footL[1] += 0.06 * bell(span(t, 0.48, 0.62)) + 0.06 * bell(span(t, 0.86, 1));
      return {
        w: env(t, 0.06, 0.1) * 0.95 + 0.05, footR, footL,
        yaw: s * Math.PI * 2 * ease(t), drop: 0.06, spineX: 0.12, ...arms(1, s),
      };
    },
  },

  // Left foot steps in front of the ball, the right foot rolls it up the back of the
  // left calf, and the left heel flicks it over your head.
  rainbow: {
    name: 'Rainbow Flick', points: 300, dur: 0.82, mirror: true, sounds: [[0.12, 'sole'], [0.38, 'kick']],
    start(g, s) { return { g, s, withBall: g.ballAtFeet(1.0), released: false }; },
    update(g, st, t, dt) {
      const { player, ball } = g;
      if (!st.withBall || st.released) return;
      if (t < 0.36) {
        // drawn back under the right sole, then rolled up the back of the left calf
        const back = ease(span(t, 0.08, 0.24)), up = ease(span(t, 0.22, 0.36));
        g.holdBall(player.toWorld((-0.04 + 0.1 * back) * st.s, R + 0.26 * Math.pow(up, 1.3), 0.42 - 0.12 * back), dt, t);
      } else {
        st.released = true;
        ball.kinematic = false;
        ball.vel.copy(player.vel).addScaledVector(player.forward(), 1.0).setY(5.7);
        ball.spin.copy(player.left()).multiplyScalar(-14);
      }
    },
    end(g, st) { return st.withBall; },
    pose(st, t) {
      const footL = track([
        [0, ...REST_L], [0.14, 0.13, 0.15, 0.4], [0.24, 0.12, A, 0.62], [0.34, 0.12, A, 0.62],
        [0.44, 0.1, 0.44, 0.3], [0.6, 0.1, 0.2, 0.32], [0.8, ...REST_L], [1, ...REST_L],
      ], t);
      // right toe gets behind and under the ball and lifts it against the left calf
      const footR = track([
        [0, ...REST_R], [0.12, -0.03, 0.2, 0.3], [0.24, 0.0, 0.1, 0.13], [0.36, 0.03, 0.2, 0.15],
        [0.5, -0.11, A, 0.16], [1, ...REST_R],
      ], t);
      const flick = bell(span(t, 0.34, 0.56));
      return {
        w: env(t, 0.06, 0.15), footL, footR, pitchL: -0.4 * flick,
        drop: 0.05, spineX: 0.28 - 0.4 * flick, ...arms(0.9),
      };
    },
  },

  // Sole on the ball, drag it back under you and turn to face it.
  dragback: {
    name: 'Drag Back', points: 120, dur: 0.56, stopsPlayer: true, sounds: [[0.1, 'sole']],
    start(g, s) {
      const { player } = g;
      return { g, s, withBall: g.ballAtFeet(1.0), yaw0: player.yaw, f0: player.forward(), l0: player.left() };
    },
    update(g, st, t, dt) {
      const { player, ball } = g;
      player.vel.multiplyScalar(Math.exp(-5 * dt));
      const yaw = st.yaw0 + st.s * Math.PI * ease(span(t, 0.28, 0.95));
      g.turnPlayer(yaw - player.yaw);
      if (!st.withBall) return;
      const p = player.pos.clone().addScaledVector(st.f0, 0.42 - 0.95 * ease(span(t, 0.08, 0.75)))
        .addScaledVector(st.l0, -0.06 * st.s).setY(R);
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
      const on = ease(span(t, 0.02, 0.1)) * (1 - ease(span(t, 0.72, 0.84)));
      const b = st.withBall ? mx(ballBody(st.g), st.s) : [-0.06, R, 0.4];
      const act = lerp3(REST_R, [b[0], b[1] + R + 0.05, b[2] - 0.04], on);
      return {
        w: env(t, 0.06, 0.14), ...feet(st.s, act, [0.14, A, 0.06]),
        drop: 0.06, spineX: 0.25, spineY: st.s * 0.25 * bell(t), ...arms(0.6),
      };
    },
  },

  // La Croqueta: the inside of one foot pushes the ball across to the other foot,
  // which carries it on. Quick, flat, sideways.
  croqueta: {
    name: 'La Croqueta', points: 180, dur: 0.46, sounds: [[0.1, 'touch'], [0.58, 'touch']],
    ballAt(t) { return [-0.06 + 0.42 * ease(span(t, 0.06, 0.55)), R, 0.42 + 0.14 * ease(span(t, 0.55, 1))]; },
    start(g, s) { return { g, s, withBall: g.ballAtFeet(1.0) }; },
    update(g, st, t, dt) {
      const { player } = g;
      player.vel.copy(player.left().multiplyScalar(st.s * 1.9)).addScaledVector(player.forward(), Math.max(1.2, st.fwd * 0.8));
      if (st.withBall) g.holdBall(player.toWorld(...mx(this.ballAt(t), st.s)), dt, t);
    },
    end(g, st) {
      const { player, ball } = g;
      const dir = player.left().multiplyScalar(st.s * 0.4).add(player.forward()).normalize();
      player.vel.copy(dir).multiplyScalar(4.8);
      if (st.withBall) { ball.kinematic = false; ball.vel.copy(dir).multiplyScalar(5.0); }
      return st.withBall;
    },
    pose(st, t) {
      const b = (k) => this.ballAt(k);
      const act = track([
        [0, ...REST_R], [0.08, ...add3(b(0.08), [-0.16, -0.03, -0.05])], [0.48, ...add3(b(0.48), [-0.16, -0.03, -0.05])],
        [0.7, -0.08, 0.14, 0.18], [1, ...REST_R],
      ], t);
      const sup = track([
        [0, ...REST_L], [0.22, 0.3, 0.16, 0.2], [0.42, 0.36, A, 0.3],
        [0.56, ...add3(b(0.56), [0.16, -0.03, -0.05])], [0.86, ...add3(b(0.86), [0.15, -0.03, -0.07])], [1, ...REST_L],
      ], t);
      return {
        w: env(t, 0.06, 0.1), ...feet(st.s, act, sup),
        drop: 0.07, spineX: 0.22, spineZ: -st.s * 0.12 * bell(t), ...arms(0.7, st.s),
      };
    },
  },

  // Cruyff turn: shape to shoot, then drag the ball behind your standing leg with the
  // inside of the foot and turn away with it.
  cruyff: {
    name: 'Cruyff Turn', points: 160, dur: 0.74, stopsPlayer: true, sounds: [[0.44, 'touch'], [0.6, 'sole']],
    start(g, s) {
      const { player } = g;
      return { g, s, withBall: g.ballAtFeet(1.0), yaw0: player.yaw, f0: player.forward(), l0: player.left() };
    },
    update(g, st, t, dt) {
      const { player } = g;
      player.vel.multiplyScalar(Math.exp(-4 * dt));
      g.turnPlayer(st.yaw0 + st.s * 2.36 * ease(span(t, 0.52, 0.96)) - player.yaw);
      if (!st.withBall) return;
      const u = ease(span(t, 0.4, 0.66));
      const p = player.pos.clone()
        .addScaledVector(st.f0, THREE.MathUtils.lerp(0.44, -0.2, u))
        .addScaledVector(st.l0, st.s * THREE.MathUtils.lerp(-0.04, 0.3, u)).setY(R);
      g.holdBall(p, dt, t);
    },
    end(g, st) {
      const { player, ball } = g;
      g.turnPlayer(st.yaw0 + st.s * 2.36 - player.yaw);
      if (st.withBall) { ball.kinematic = false; ball.vel.copy(player.forward()).multiplyScalar(2.6); }
      player.vel.copy(player.forward()).multiplyScalar(4.0);
      return st.withBall;
    },
    pose(st, t) {
      const s = st.s;
      const drag = span(t, 0.4, 0.66);
      let act = track([[0, ...REST_R], [0.18, -0.12, 0.2, -0.1], [0.34, -0.13, 0.34, -0.28], [0.42, -0.1, 0.22, 0.4]], t);
      if (t > 0.42 && st.withBall) {
        const b = ballBody(st.g);
        act = lerp3(act, add3(mx(b, s), [-0.13, -0.03, 0.07]), ease(span(t, 0.42, 0.48)));
        if (t > 0.7) act = lerp3(act, REST_R, ease(span(t, 0.7, 0.95)));
      } else if (t > 0.42) act = lerp3(act, REST_R, ease(span(t, 0.5, 0.9)));
      return {
        w: env(t, 0.08, 0.12), ...feet(s, act, [0.2, A, 0.34]),
        drop: 0.06 + 0.03 * bell(drag), spineX: 0.18 + 0.12 * bell(span(t, 0.1, 0.45)),
        spineY: s * 0.35 * bell(span(t, 0.0, 0.42)), ...arms(0.8, s),
        shL: s > 0 ? -0.5 * bell(span(t, 0, 0.45)) : 0, shR: s < 0 ? -0.5 * bell(span(t, 0, 0.45)) : 0,
      };
    },
  },

  // Sole roll: right sole on top of the ball rolls it across in front of you while
  // you shuffle sideways with it.
  soleroll: {
    name: 'Sole Roll', points: 120, dur: 0.58, sounds: [[0.1, 'sole'], [0.45, 'sole']],
    ballAt(t) { return [-0.06 + 0.44 * ease(span(t, 0.08, 0.88)), R, 0.36]; },
    start(g, s) { return { g, s, withBall: g.ballAtFeet(1.0) }; },
    update(g, st, t, dt) {
      const { player } = g;
      player.vel.copy(player.left()).multiplyScalar(st.s * 1.1 * bell(t)).addScaledVector(player.forward(), st.fwd * 0.5);
      if (st.withBall) g.holdBall(player.toWorld(...mx(this.ballAt(t), st.s)), dt, t);
    },
    end(g, st) {
      const { player, ball } = g;
      if (st.withBall) { ball.kinematic = false; ball.vel.copy(player.vel).multiplyScalar(0.5); }
      return st.withBall;
    },
    pose(st, t) {
      const on = ease(span(t, 0.0, 0.08)) * (1 - ease(span(t, 0.86, 0.96)));
      const b = this.ballAt(t);
      const act = lerp3(REST_R, [b[0] - 0.01, R + R + 0.05, b[2] - 0.04], on);
      const sup = track([[0, ...REST_L], [0.3, 0.3, 0.17, 0.06], [0.48, 0.34, A, 0.04], [1, 0.3, A, 0.02]], t);
      return {
        w: env(t, 0.06, 0.12), ...feet(st.s, act, sup),
        drop: 0.06, spineX: 0.2, spineZ: st.s * 0.1 * bell(t), ...arms(0.7, st.s),
      };
    },
  },

  // Sombrero flick: get the toe under the ball, lift it onto the boot and flick it up
  // over a defender's head, then run onto it.
  sombrero: {
    name: 'Sombrero Flick', points: 280, dur: 0.6, mirror: true, sounds: [[0.26, 'touch'], [0.4, 'kick']],
    start(g, s) { return { g, s, withBall: g.ballAtFeet(1.0), released: false }; },
    update(g, st, t, dt) {
      const { player, ball } = g;
      if (!st.withBall || st.released) return;
      if (t < 0.38) {
        const u = ease(span(t, 0.24, 0.38));
        g.holdBall(player.toWorld(-0.04 * st.s, R + 0.15 * u, 0.44 - 0.04 * u), dt, t);
      } else {
        st.released = true;
        ball.kinematic = false;
        ball.vel.copy(player.vel).addScaledVector(player.forward(), 2.4).setY(5.4);
        ball.spin.copy(player.left()).multiplyScalar(-10);
      }
    },
    end(g, st) { return st.withBall; },
    pose(st, t) {
      const footR = track([
        [0, ...REST_R], [0.14, -0.06, 0.12, 0.2], [0.26, -0.04, A, 0.3], [0.38, -0.04, 0.16, 0.32],
        [0.5, -0.05, 0.56, 0.5], [0.7, -0.08, 0.2, 0.3], [1, ...REST_R],
      ], t);
      return {
        w: env(t, 0.06, 0.15), footR, footL: [0.15, A, 0.18],
        pitchR: -0.5 * bell(span(t, 0.2, 0.42)) + 0.4 * bell(span(t, 0.4, 0.6)),
        drop: 0.06, spineX: 0.22 - 0.25 * bell(span(t, 0.38, 0.7)), ...arms(0.8),
      };
    },
  },
};

/**
 * Mirror a pose left to right: swaps the feet and limbs and flips sideways values.
 * Used for moves authored only for the right foot (flagged \`mirror: true\`).
 */
export function mirrorPose(p) {
  const o = { ...p };
  const swap = (a, b, f = (v) => v) => {
    const A1 = p[a], B1 = p[b];
    if (B1 === undefined) delete o[a]; else o[a] = f(B1);
    if (A1 === undefined) delete o[b]; else o[b] = f(A1);
  };
  swap('footL', 'footR', (v) => mx(v, -1));
  swap('pitchL', 'pitchR');
  swap('hipL', 'hipR');
  swap('hipLz', 'hipRz', (v) => -v);
  swap('kneeL', 'kneeR');
  swap('shL', 'shR');
  swap('shLz', 'shRz', (v) => -v);
  swap('elL', 'elR');
  for (const k of ['spineZ', 'spineY', 'yaw']) if (k in p) o[k] = -p[k];
  return o;
}
