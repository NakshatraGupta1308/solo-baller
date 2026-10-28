import * as THREE from 'three';
import { GOAL, TARGETS, PALETTE } from './world.js';

const G = 9.81;
const R = 0.11;
const AIR_DRAG = 0.010; // quadratic, per metre
const ROLL_DECEL = 1.3; // m/s^2 on grass
const ROLL_DAMP = 0.28; // extra linear damping while rolling
const MAGNUS = 0.010;
const MU_SLIDE = 0.45; // grass friction while the ball skids
const MU_BOUNCE = 0.35; // grip during a bounce, scaled by the impact
const SPIN_DECAY_AIR = 0.25;

function ballGeometry() {
  // classic panel look: dark patches around the 12 icosahedron vertices
  const geo = new THREE.IcosahedronGeometry(R, 12);
  const ico = new THREE.IcosahedronGeometry(1, 0).getAttribute('position');
  const centres = [];
  for (let i = 0; i < ico.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(ico, i).normalize();
    if (!centres.some((c) => c.distanceTo(v) < 1e-3)) centres.push(v);
  }
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const dark = new THREE.Color(PALETTE.ink);
  const accent = new THREE.Color(PALETTE.accent);
  const light = new THREE.Color('#FBFBF8');
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(pos, i).normalize();
    let best = -1, idx = 0;
    centres.forEach((c, k) => { const d = c.dot(n); if (d > best) { best = d; idx = k; } });
    const c = best > 0.955 ? (idx % 4 === 0 ? accent : dark) : light;
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

export function createBall(scene) {
  const mesh = new THREE.Mesh(ballGeometry(), new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.42, flatShading: false,
  }));
  scene.add(mesh);

  const ball = {
    radius: R,
    mesh,
    pos: new THREE.Vector3(0, R, 6),
    vel: new THREE.Vector3(),
    spin: new THREE.Vector3(), // angular velocity, rad/s
    kinematic: false,
    inNet: false,
    onGround: true,
    events: [],
    lastPos: new THREE.Vector3(0, R, 6),

    place(p, v) {
      this.pos.copy(p);
      this.vel.copy(v ?? new THREE.Vector3());
      this.spin.set(0, 0, 0);
      this.inNet = false;
      this.onGround = this.pos.y <= R + 1e-3;
    },

    // drive the ball directly (skills); velocity is derived so releasing is smooth
    setKinematic(p, dt) {
      if (dt > 0) this.vel.subVectors(p, this.pos).divideScalar(dt);
      this.pos.copy(p);
      this.kinematic = true;
    },

    controlled: false, // held at the player's feet; spin follows the roll

    // rolling without slipping: angular velocity that matches the ground speed
    rollSpin(out = this.spin) { return out.set(this.vel.z / R, out === this.spin ? this.spin.y : 0, -this.vel.x / R); },

    step(dt, cones) {
      this.lastPos.copy(this.pos);
      if (this.kinematic) { this.rollSpin(); this.spinMesh(dt); return; }
      const v = this.vel, w = this.spin;
      const speed = v.length();

      // gravity, drag, magnus curl / dip / lift
      v.y -= G * dt;
      if (speed > 0.01) v.addScaledVector(v, -AIR_DRAG * speed * dt);
      if (!this.onGround) {
        v.addScaledVector(new THREE.Vector3().crossVectors(w, v), MAGNUS * dt);
        w.multiplyScalar(Math.exp(-SPIN_DECAY_AIR * dt));
      }

      this.pos.addScaledVector(v, dt);

      // ground contact: bounce, then friction at the contact point turns skid into roll
      this.onGround = false;
      if (this.pos.y <= R) {
        this.pos.y = R;
        const vn = -v.y;
        if (vn > 0.9) {
          const e = THREE.MathUtils.clamp(0.64 - 0.025 * vn, 0.42, 0.64); // softer on hard landings
          v.y = vn * e;
          this.grip(MU_BOUNCE * vn * (1 + e));
          this.events.push({ type: 'bounce', speed: v.y });
        } else {
          v.y = 0;
          this.onGround = true;
        }
      }
      if (this.onGround) {
        if (this.controlled) this.rollSpin();
        else this.grip(MU_SLIDE * G * dt);
        const h = Math.hypot(v.x, v.z);
        if (h > 0) {
          const k = Math.max(h - (ROLL_DECEL + ROLL_DAMP * h) * dt, 0) / h;
          v.x *= k; v.z *= k; w.x *= k; w.z *= k;
        }
        w.y *= Math.exp(-3 * dt);
      }

      this.collideGoal();
      for (const c of cones) this.collideCapsule(
        new THREE.Vector3(c.x, 0, c.z), new THREE.Vector3(c.x, c.h, c.z), c.r, 0.4);
      this.spinMesh(dt);
    },

    // Friction impulse at the contact point, capped at maxJ (m/s). For a hollow
    // sphere (I = 2/3 m R^2) a velocity change J shifts the slip by 2.5 J.
    grip(maxJ) {
      const v = this.vel, w = this.spin;
      const ux = v.x + R * w.z, uz = v.z - R * w.x;
      const u = Math.hypot(ux, uz);
      if (u < 1e-6) return;
      const j = Math.min(u / 2.5, maxJ);
      const jx = (-ux / u) * j, jz = (-uz / u) * j;
      v.x += jx; v.z += jz;
      w.x += (1.5 / R) * -jz;
      w.z += (1.5 / R) * jx;
    },

    collideCapsule(a, b, r, restitution) {
      const ab = new THREE.Vector3().subVectors(b, a);
      const t = THREE.MathUtils.clamp(new THREE.Vector3().subVectors(this.pos, a).dot(ab) / ab.lengthSq(), 0, 1);
      const closest = a.clone().addScaledVector(ab, t);
      const n = new THREE.Vector3().subVectors(this.pos, closest);
      const d = n.length();
      if (d >= R + r || d === 0) return false;
      n.divideScalar(d);
      this.pos.copy(closest).addScaledVector(n, R + r);
      const vn = this.vel.dot(n);
      if (vn < 0) {
        this.vel.addScaledVector(n, -(1 + restitution) * vn);
        if (-vn > 2) this.events.push({ type: 'woodwork', speed: -vn });
      }
      return true;
    },

    collideGoal() {
      const { z, halfWidth: hw, height: h, depth: d, post: pr } = GOAL;
      const p = this.pos;
      const L = new THREE.Vector3();
      this.collideCapsule(L.set(-hw, 0, z), new THREE.Vector3(-hw, h, z), pr, 0.6);
      this.collideCapsule(L.set(hw, 0, z), new THREE.Vector3(hw, h, z), pr, 0.6);
      this.collideCapsule(L.set(-hw, h, z), new THREE.Vector3(hw, h, z), pr, 0.6);

      // crossing the line between the posts: goal
      if (!this.inNet && this.lastPos.z > z && p.z <= z && Math.abs(p.x) < hw && p.y < h) {
        this.inNet = true;
        const t = (this.lastPos.z - z) / Math.max(this.lastPos.z - p.z, 1e-6);
        const cx = THREE.MathUtils.lerp(this.lastPos.x, p.x, t);
        const cy = THREE.MathUtils.lerp(this.lastPos.y, p.y, t);
        const ring = TARGETS.find((tg) => Math.hypot(cx - tg.x, cy - tg.y) < tg.r);
        this.events.push({ type: 'goal', speed: this.vel.length(), topBin: !!ring });
      }

      // net: soft walls, catching the ball inside or keeping it out
      const inside = Math.abs(p.x) < hw + R && p.z < z + R && p.z > z - d - R && p.y < h + R;
      if (!inside) return;
      const soak = 0.15;
      if (this.inNet) {
        if (p.z < z - d + R) { p.z = z - d + R; if (this.vel.z < 0) this.vel.z *= -soak; this.vel.x *= 0.6; this.vel.y *= 0.6; }
        if (p.x > hw - R) { p.x = hw - R; if (this.vel.x > 0) this.vel.x *= -soak; }
        if (p.x < -hw + R) { p.x = -hw + R; if (this.vel.x < 0) this.vel.x *= -soak; }
        if (p.y > h - R) { p.y = h - R; if (this.vel.y > 0) this.vel.y *= -soak; }
      } else if (p.z < z) {
        // hitting the outside of the net from the side, back or top
        const pen = [
          { v: p.x - (hw + R), ax: 'x', s: 1 },
          { v: -hw - R - p.x, ax: 'x', s: -1 },
          { v: (z - d - R) - p.z, ax: 'z', s: -1 },
          { v: p.y - (h + R), ax: 'y', s: 1 },
        ].map((o) => ({ ...o, depth: -o.v })).sort((a, b) => a.depth - b.depth)[0];
        if (pen.depth > 0) {
          p[pen.ax] += pen.s * pen.depth;
          if (Math.sign(this.vel[pen.ax]) === -pen.s) this.vel[pen.ax] *= -soak;
        }
      }
    },

    spinMesh(dt) {
      const ang = this.spin.length() * dt;
      if (ang > 1e-6) {
        const q = new THREE.Quaternion().setFromAxisAngle(this.spin.clone().normalize(), ang);
        mesh.quaternion.premultiply(q);
      }
      mesh.position.copy(this.pos);
    },
  };
  ball.mesh.position.copy(ball.pos);
  return ball;
}
