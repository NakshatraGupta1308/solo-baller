import * as THREE from 'three';
import { PALETTE } from './world.js';
import { loadRig } from './rig.js';

// A faceless mannequin in a green kit, posed procedurally.
// Local +z is forward, local +x is the player's left.

const HIP_H = 0.95;
const ANKLE = 0.08; // ankle height with the boot flat on the grass
const MANNEQUIN_LEGS = { hipX: 0.095, hipY: HIP_H - 0.02, L1: 0.44, L2: 0.44 };
const lerp = THREE.MathUtils.lerp;

/**
 * Two-bone leg IK in body space (x left, y up, z forward), relative to the hip joint.
 * Returns the hip rotation (Euler x then z, as applied to a straight-down leg) and
 * knee flexion that put the ankle on the target, with the knee pointing forward.
 */
export function legIK(tx, ty, tz, L1, L2, out = {}) {
  const d0 = Math.hypot(tx, ty, tz);
  const d = THREE.MathUtils.clamp(d0, Math.abs(L1 - L2) + 0.06, (L1 + L2) * 0.999);
  const sc = d0 > 1e-6 ? d / d0 : 1;
  tx *= sc; ty *= sc; tz *= sc;
  const k = Math.acos(THREE.MathUtils.clamp((d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1));
  const fy = -L1 - L2 * Math.cos(k), fz = -L2 * Math.sin(k);
  const z = Math.asin(THREE.MathUtils.clamp(-tx / fy, -1, 1));
  const x = Math.atan2(tz, ty) - Math.atan2(fz, fy * Math.cos(z));
  out.hip = Math.atan2(Math.sin(x), Math.cos(x));
  out.hipz = z;
  out.knee = k;
  return out;
}

// Gait: each ankle follows a stance phase (planted, sliding back at ground speed so
// it does not skate) and a swing phase (lifted arc forward). Standing blends to an
// idle stance with a slow weight shift.
function gaitPose(pl, sp, dt, dims) {
  const amp = Math.min(sp / 6.5, 1);
  const move = Math.min(sp / 0.6, 1);
  const freq = 1.15 + sp * 0.2;
  if (sp > 0.03) pl.phase += dt * freq * Math.PI * 2;
  const cyc = pl.phase / (Math.PI * 2);
  const run = THREE.MathUtils.smoothstep(sp, 2.2, 4.5);
  const stanceFrac = lerp(0.6, 0.34, run);
  const stanceLen = (sp * stanceFrac) / freq;
  const zc = lerp(0.04, -0.1, run);
  const lift = 0.05 + 0.12 * amp;
  const sway = Math.sin(pl.time * 1.3) * (1 - move);

  const foot = (off, side) => {
    const u = (((cyc + off) % 1) + 1) % 1;
    let z, y, pitch = 0;
    if (u < stanceFrac) {
      z = zc + stanceLen * (0.5 - u / stanceFrac);
      y = ANKLE;
    } else {
      const s = (u - stanceFrac) / (1 - stanceFrac);
      z = zc + stanceLen * (s * s * (3 - 2 * s) - 0.5);
      y = ANKLE + lift * Math.sin(Math.PI * Math.pow(s, 0.75)) + run * 0.16 * Math.sin(Math.PI * s) * (1 - s);
      pitch = 0.45 * Math.sin(Math.PI * s) * amp;
    }
    const x = side * lerp(0.115, dims.hipX * 0.8, move);
    return { at: [x + side * 0.01 * sway, lerp(ANKLE, y, move), lerp(side > 0 ? 0.04 : -0.02, z, move)], pitch: pitch * move };
  };
  const fl = foot(0, 1), fr = foot(0.5, -1);
  const zL = fl.at[2], zR = fr.at[2];
  const air = pl.pos.y > 0.01;

  return {
    footL: air ? [0.1, 0.38, 0.12] : fl.at,
    footR: air ? [-0.1, 0.25, -0.05] : fr.at,
    pitchL: fl.pitch, pitchR: fr.pitch,
    shL: THREE.MathUtils.clamp(-(zR - zc) * 1.3, -0.9, 0.9) * move,
    shR: THREE.MathUtils.clamp(-(zL - zc) * 1.3, -0.9, 0.9) * move,
    shLz: 0.12 + (air ? 0.4 : 0), shRz: -0.12 - (air ? 0.4 : 0),
    elL: -0.3 - 1.0 * amp, elR: -0.3 - 1.0 * amp,
    spineX: 0.03 + 0.17 * amp, spineY: (zL - zR) * 0.3 * move, spineZ: sway * 0.02,
    drop: 0.012 + move * (0.015 + 0.02 * run)
      + move * 0.026 * amp * Math.cos(4 * Math.PI * (cyc - stanceFrac / 2))
      - Math.sin(pl.time * 2) * 0.004 * (1 - move) + sway * 0.006,
    yaw: 0,
  };
}

// Turn ankle targets (footL / footR) into hip, knee and foot angles. Values given
// explicitly in `explicit` (old-style joint angles) win over the IK result.
function resolveLegs(p, dims, explicit = {}) {
  const out = { ...p };
  const hipY = dims.hipY - p.drop;
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    const t = p['foot' + side];
    const ik = legIK(t[0] - sx * dims.hipX, t[1] - hipY, t[2], dims.L1, dims.L2);
    out['hip' + side] = ik.hip;
    out['hip' + side + 'z'] = ik.hipz;
    out['knee' + side] = ik.knee;
    for (const k of ['hip' + side, 'hip' + side + 'z', 'knee' + side]) if (k in explicit) out[k] = explicit[k];
    // keep the sole flat, plus any toe-down pitch
    out['foot' + side + 'x'] = -(out['hip' + side] + out['knee' + side]) + (p['pitch' + side] ?? 0);
  }
  delete out.footL; delete out.footR;
  return out;
}

// Critically damped-ish smoothing on every joint so nothing snaps between poses.
function smoothPose(pl, pose, dt) {
  const s = pl.smooth ?? (pl.smooth = { ...pose });
  const out = {};
  for (const k in pose) {
    if (typeof pose[k] !== 'number') continue;
    const legs = /^(hip|knee|foot)/.test(k);
    const rate = legs ? 38 : k === 'yaw' ? 30 : 16;
    s[k] = (s[k] ?? pose[k]) + (pose[k] - (s[k] ?? pose[k])) * (1 - Math.exp(-rate * dt));
    out[k] = s[k];
  }
  return out;
}

function capsule(r, len, mat) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 14), mat);
  m.position.y = -(len / 2 + r * 0.4);
  return m;
}

function backNumber() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.font = '700 92px Archivo, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('10', 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createPlayer(scene) {
  const skin = new THREE.MeshStandardMaterial({ color: PALETTE.bone, roughness: 0.75 });
  const shirt = new THREE.MeshStandardMaterial({ color: PALETTE.accent, roughness: 0.65 });
  const shorts = new THREE.MeshStandardMaterial({ color: '#F4F4F0', roughness: 0.7 });
  const sock = new THREE.MeshStandardMaterial({ color: PALETTE.accentDeep, roughness: 0.7 });
  const boot = new THREE.MeshStandardMaterial({ color: PALETTE.boot, roughness: 0.4 });

  const root = new THREE.Group();
  const body = new THREE.Group(); // yaw offset for spins
  root.add(body);
  const pelvis = new THREE.Group();
  pelvis.position.y = HIP_H;
  body.add(pelvis);

  const shortsMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.16, 0.2, 18), shorts);
  shortsMesh.scale.z = 0.8;
  shortsMesh.position.y = -0.02;
  pelvis.add(shortsMesh);

  const spine = new THREE.Group();
  spine.position.y = 0.08;
  pelvis.add(spine);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.3, 6, 16), shirt);
  torso.scale.set(1.2, 1, 0.75);
  torso.position.y = 0.26;
  spine.add(torso);
  const num = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshBasicMaterial({
    map: backNumber(), transparent: true, depthWrite: false,
  }));
  num.position.set(0, 0.32, -0.135);
  num.rotation.y = Math.PI;
  spine.add(num);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 10), skin);
  neck.position.y = 0.56;
  spine.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 16), skin);
  head.scale.set(0.92, 1.08, 1);
  head.position.y = 0.7;
  spine.add(head);
  const upper = [torso, num, neck, head, shortsMesh];

  function limb(parent, x, y, r1, l1, r2, l2, m1, m2, jointY) {
    const top = new THREE.Group();
    top.position.set(x, y, 0);
    parent.add(top);
    top.add(capsule(r1, l1, m1));
    const mid = new THREE.Group();
    mid.position.y = -jointY;
    top.add(mid);
    mid.add(capsule(r2, l2, m2));
    return { top, mid };
  }

  const legs = [1, -1].map((s) => {
    const l = limb(pelvis, s * 0.095, -0.02, 0.07, 0.3, 0.055, 0.32, skin, sock, 0.44);
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.078, 0.16, 14), shorts);
    sleeve.position.y = -0.06;
    l.top.add(sleeve);
    upper.push(sleeve);
    const foot = new THREE.Group();
    foot.position.y = -0.44;
    l.mid.add(foot);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.07, 0.26), boot);
    b.position.set(0, -0.05, 0.055);
    foot.add(b);
    return { ...l, foot };
  });
  const arms = [1, -1].map((s) => {
    const a = limb(spine, s * 0.235, 0.46, 0.05, 0.2, 0.043, 0.2, shirt, skin, 0.28);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.048, 10, 8), skin);
    hand.position.y = -0.28;
    a.mid.add(hand);
    upper.push(a.top);
    return a;
  });
  scene.add(root);

  const player = {
    root, body,
    pos: new THREE.Vector3(0, 0, 9),
    vel: new THREE.Vector3(),
    yaw: Math.PI, // facing -z, towards goal
    vy: 0,
    phase: 0,
    speed: 0,
    time: 0,
    override: null, // pose function from the active skill
    bodyYaw: 0,
    rig: null, // the loaded 3D model; the mannequin stands in until it arrives
    clipLayer: null, // returns a keyframed clip pose to blend over the procedural one

    forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); },
    left(out = new THREE.Vector3()) { return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); },
    toWorld(lx, ly, lz, out = new THREE.Vector3()) {
      const f = this.forward(), l = this.left();
      return out.copy(this.pos).addScaledVector(l, lx).addScaledVector(f, lz).setY(this.pos.y + ly);
    },

    setFirstPerson(fp) {
      for (const m of upper) m.visible = !fp;
      this.rig?.setFirstPerson(fp);
    },

    // Pose pipeline: a gait (or idle stance) places both ankles, an active skill or
    // kick may override any value (including ankle targets), leg IK turns ankle
    // targets into hip and knee angles, and every joint is smoothed before applying.
    animate(dt) {
      this.time += dt;
      const sp = Math.hypot(this.vel.x, this.vel.z);
      this.speed = sp;
      const dims = this.rig?.dims ?? MANNEQUIN_LEGS;
      const base = gaitPose(this, sp, dt, dims);

      let pose = resolveLegs(base, dims);
      if (this.override) {
        const o = this.override();
        const w = o.w ?? 1;
        const over = resolveLegs({ ...base, ...o }, dims, o);
        for (const k in over) if (typeof over[k] === 'number' && k in pose) pose[k] = THREE.MathUtils.lerp(pose[k], over[k], w);
      }
      pose = smoothPose(this, pose, dt);

      if (this.rig) {
        this.rig.apply(pose);
        const layer = this.clipLayer?.();
        if (layer) this.rig.applyClip(layer.sample, layer.w, layer.yawFix);
      }
      const [L, Rl] = legs;
      L.top.rotation.set(pose.hipL, 0, pose.hipLz);
      Rl.top.rotation.set(pose.hipR, 0, pose.hipRz);
      L.mid.rotation.x = pose.kneeL;
      Rl.mid.rotation.x = pose.kneeR;
      L.foot.rotation.x = pose.footLx;
      Rl.foot.rotation.x = pose.footRx;
      arms[0].top.rotation.set(pose.shL, 0, pose.shLz);
      arms[1].top.rotation.set(pose.shR, 0, pose.shRz);
      arms[0].mid.rotation.x = pose.elL;
      arms[1].mid.rotation.x = pose.elR;
      spine.rotation.set(pose.spineX, pose.spineY, pose.spineZ);
      pelvis.position.y = HIP_H - pose.drop;
      body.rotation.y = pose.yaw;
      this.bodyYaw = pose.yaw;

      root.position.copy(this.pos);
      root.rotation.y = this.yaw;
      this.rig?.update(dt, this.pos.y);
    },

    // world point -> body space (x left, y up from the ground, z forward), including any spin
    toBody(p, out = new THREE.Vector3()) {
      const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
      const a = this.yaw + this.bodyYaw;
      return out.set(dx * Math.cos(a) - dz * Math.sin(a), p.y - this.pos.y, dx * Math.sin(a) + dz * Math.cos(a));
    },
  };

  loadRig('assets/player.glb', body)
    .then((rig) => { player.rig = rig; pelvis.visible = false; })
    .catch((err) => console.warn('player model failed to load, using the mannequin', err));
  return player;
}
