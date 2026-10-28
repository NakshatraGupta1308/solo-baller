import * as THREE from 'three';
import { PALETTE } from './world.js';

// A faceless mannequin in a green kit, posed procedurally.
// Local +z is forward, local +x is the player's left.

const HIP_H = 0.95;

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

    forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); },
    left(out = new THREE.Vector3()) { return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); },
    toWorld(lx, ly, lz, out = new THREE.Vector3()) {
      const f = this.forward(), l = this.left();
      return out.copy(this.pos).addScaledVector(l, lx).addScaledVector(f, lz).setY(this.pos.y + ly);
    },

    setFirstPerson(fp) { for (const m of upper) m.visible = !fp; },

    animate(dt) {
      this.time += dt;
      const sp = Math.hypot(this.vel.x, this.vel.z);
      this.speed = sp;
      const amp = Math.min(sp / 6.5, 1);
      const freq = sp > 0.15 ? 1.15 + sp * 0.2 : 0;
      this.phase += dt * freq * Math.PI * 2;
      const ph = this.phase;
      const air = this.pos.y > 0.01;

      // base pose: idle sway or run cycle
      const pose = {
        hipL: -Math.sin(ph) * 0.75 * amp, hipR: Math.sin(ph) * 0.75 * amp,
        hipLz: 0.03, hipRz: -0.03,
        kneeL: 0.08 + amp * (0.1 + 1.15 * Math.max(0, Math.cos(ph))),
        kneeR: 0.08 + amp * (0.1 + 1.15 * Math.max(0, Math.cos(ph + Math.PI))),
        shL: Math.sin(ph) * 0.65 * amp, shR: -Math.sin(ph) * 0.65 * amp,
        shLz: 0.12, shRz: -0.12,
        elL: -0.35 - 0.6 * amp, elR: -0.35 - 0.6 * amp,
        spineX: 0.03 + 0.16 * amp, spineZ: 0, spineY: 0,
        drop: 0.03 * amp - Math.abs(Math.sin(ph)) * 0.035 * amp - Math.sin(this.time * 2) * 0.006 * (1 - amp),
        yaw: 0,
      };
      if (air) { pose.kneeL = 0.9; pose.kneeR = 0.5; pose.hipL = -0.5; pose.hipR = 0.1; pose.shLz = 0.5; pose.shRz = -0.5; }
      if (this.override) {
        const o = this.override();
        const w = o.w ?? 1;
        for (const k in o) if (k !== 'w' && k in pose) pose[k] = THREE.MathUtils.lerp(pose[k], o[k], w);
      }

      const [L, Rl] = legs;
      L.top.rotation.set(pose.hipL, 0, pose.hipLz);
      Rl.top.rotation.set(pose.hipR, 0, pose.hipRz);
      L.mid.rotation.x = pose.kneeL;
      Rl.mid.rotation.x = pose.kneeR;
      L.foot.rotation.x = -pose.kneeL * 0.3;
      Rl.foot.rotation.x = -pose.kneeR * 0.3;
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
    },
  };
  return player;
}
