import * as THREE from 'three';
import { GROUND_VERT, GROUND_FRAG, SKY_VERT, SKY_FRAG, GRASS_VERT, GRASS_FRAG } from './shaders.js';

export const PALETTE = {
  paper: '#F6F6F2',
  ink: '#1C1F1D',
  accent: '#18B05A',
  accentDeep: '#0E7A3D',
  grassA: '#3C8A3E',
  grassB: '#6CB64B',
  line: '#F4F7F0',
  bone: '#ECE8DF',
  boot: '#1A1D1B',
};

export const GOAL = { z: -34, halfWidth: 3.66, height: 2.44, depth: 2.0, post: 0.06 };
export const TARGETS = [
  { x: -2.95, y: 1.85, r: 0.5 },
  { x: 2.95, y: 1.85, r: 0.5 },
];

const FOG_NEAR = 70;
const FOG_FAR = 230;
const GRASS_PATCH = 36;
const GRASS_COUNT = 42000;

function col(hex) { return new THREE.Color(hex); }

export function createWorld(scene) {
  const shared = {
    uPaper: { value: col(PALETTE.paper) },
    uInk: { value: col(PALETTE.ink) },
    uAccent: { value: col(PALETTE.accent) },
    uLine: { value: col(PALETTE.line) },
    uGrassA: { value: col(PALETTE.grassA) },
    uGrassB: { value: col(PALETTE.grassB) },
    uCam: { value: new THREE.Vector3() },
    uBall: { value: new THREE.Vector4(0, 0.11, 0, 0.11) },
    uPlayer: { value: new THREE.Vector4() },
    uFogNear: { value: FOG_NEAR },
    uFogFar: { value: FOG_FAR },
    uTime: { value: 0 },
  };

  scene.background = col(PALETTE.paper);

  // paper sheet + pitch
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(640, 640, 1, 1).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({ uniforms: shared, vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG }),
  );
  scene.add(ground);

  // graph-paper sky dome that follows the camera
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(400, 48, 24),
    new THREE.ShaderMaterial({
      uniforms: shared, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      side: THREE.BackSide, depthWrite: false,
    }),
  );
  sky.renderOrder = -1;
  scene.add(sky);

  // short grass blades on a patch that wraps around the camera
  const blade = new THREE.BufferGeometry();
  const w = 0.012;
  blade.setAttribute('position', new THREE.Float32BufferAttribute([
    -w, 0, 0, w, 0, 0, -w * 0.6, 0.5, 0, w * 0.6, 0.5, 0, 0, 1, 0,
  ], 3));
  blade.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
  const grassGeo = new THREE.InstancedBufferGeometry().copy(blade);
  grassGeo.instanceCount = GRASS_COUNT;
  const offs = new Float32Array(GRASS_COUNT * 2);
  const rand = new Float32Array(GRASS_COUNT * 4);
  for (let i = 0; i < GRASS_COUNT; i++) {
    offs[i * 2] = Math.random() * GRASS_PATCH;
    offs[i * 2 + 1] = Math.random() * GRASS_PATCH;
    for (let k = 0; k < 4; k++) rand[i * 4 + k] = Math.random();
  }
  grassGeo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offs, 2));
  grassGeo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rand, 4));
  const grassUniforms = {
    ...shared,
    uCenter: { value: new THREE.Vector2() },
    uSize: { value: GRASS_PATCH },
  };
  const grass = new THREE.Mesh(grassGeo, new THREE.ShaderMaterial({
    uniforms: grassUniforms, vertexShader: GRASS_VERT, fragmentShader: GRASS_FRAG, side: THREE.DoubleSide,
  }));
  grass.frustumCulled = false;
  scene.add(grass);

  // lights for the player, ball and props
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6f8f5a, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-20, 40, 25);
  scene.add(sun);

  const props = buildProps(scene);

  return {
    shared,
    cones: props.cones,
    rings: props.rings,
    update(dt, camera, ball, player) {
      shared.uTime.value += dt;
      shared.uCam.value.copy(camera.position);
      shared.uBall.value.set(ball.pos.x, ball.pos.y, ball.pos.z, ball.radius);
      shared.uPlayer.value.set(player.pos.x, player.pos.y, player.pos.z, player.yaw);
      sky.position.copy(camera.position);
      grassUniforms.uCenter.value.set(camera.position.x, camera.position.z);
      for (const r of props.rings) r.mesh.rotation.z += dt * 0.6;
    },
  };
}

function buildProps(scene) {
  const white = new THREE.MeshStandardMaterial({ color: PALETTE.line, roughness: 0.45 });
  const green = new THREE.MeshStandardMaterial({ color: PALETTE.accent, roughness: 0.5 });

  // goal frame
  const { z, halfWidth: hw, height: h, depth: d, post: pr } = GOAL;
  const goal = new THREE.Group();
  const postGeo = new THREE.CylinderGeometry(pr, pr, h, 16);
  for (const x of [-hw, hw]) {
    const p = new THREE.Mesh(postGeo, white);
    p.position.set(x, h / 2, z);
    goal.add(p);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(pr, pr, hw * 2 + pr * 2, 16), white);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, h, z);
  goal.add(bar);
  // back supports
  const supGeo = new THREE.CylinderGeometry(0.025, 0.025, 1, 8);
  for (const x of [-hw, hw]) {
    const s = new THREE.Mesh(supGeo, white);
    const len = Math.hypot(d, h);
    s.scale.y = len;
    s.position.set(x, h / 2, z - d / 2);
    s.rotation.x = Math.atan2(d, h);
    goal.add(s);
  }

  // net as fine lines
  const pts = [];
  const step = 0.18;
  const backTop = h * 0.55;
  const topAt = (t) => [z - d * t, h - (h - backTop) * t];
  for (let x = -hw; x <= hw + 1e-3; x += step) {
    pts.push(x, 0, z - d, x, backTop, z - d); // back
    pts.push(x, h, z, x, backTop, z - d); // roof
  }
  for (let y = 0; y <= backTop + 1e-3; y += step) pts.push(-hw, y, z - d, hw, y, z - d);
  for (let t = 0; t <= 1 + 1e-3; t += step / d) {
    const [zz, yy] = topAt(t);
    pts.push(-hw, yy, zz, hw, yy, zz);
  }
  for (const x of [-hw, hw]) {
    for (let t = 0; t <= 1 + 1e-3; t += step / d) {
      const [zz, yy] = topAt(t);
      pts.push(x, 0, zz, x, yy, zz);
    }
    for (let y = 0; y <= h + 1e-3; y += step) {
      const t = y <= backTop ? 1 : 1 - (y - backTop) / (h - backTop);
      pts.push(x, y, z, x, y, z - d * t);
    }
  }
  const netGeo = new THREE.BufferGeometry();
  netGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  goal.add(new THREE.LineSegments(netGeo, new THREE.LineBasicMaterial({
    color: PALETTE.accentDeep, transparent: true, opacity: 0.45,
  })));
  scene.add(goal);

  // top-bin target rings
  const rings = TARGETS.map((t) => {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(t.r, 0.03, 10, 48), green);
    mesh.position.set(t.x, t.y, z + 0.02);
    scene.add(mesh);
    return { ...t, mesh };
  });

  // slalom cones
  const coneGeo = new THREE.ConeGeometry(0.13, 0.32, 20);
  const stripeGeo = new THREE.CylinderGeometry(0.075, 0.095, 0.05, 20);
  const cones = [];
  for (let i = 0; i < 7; i++) {
    const x = -13 + (i % 2) * 1.2;
    const cz = 8 - i * 3.2;
    const c = new THREE.Group();
    const body = new THREE.Mesh(coneGeo, green);
    body.position.y = 0.16;
    const band = new THREE.Mesh(stripeGeo, white);
    band.position.y = 0.17;
    c.add(body, band);
    c.position.set(x, 0, cz);
    scene.add(c);
    cones.push({ x, z: cz, r: 0.13, h: 0.32 });
  }

  // corner flags
  const poleGeo = new THREE.CylinderGeometry(0.015, 0.015, 1.5, 8);
  const flagGeo = new THREE.PlaneGeometry(0.35, 0.24).translate(0.175, 0, 0);
  const flagMat = new THREE.MeshStandardMaterial({ color: PALETTE.accent, side: THREE.DoubleSide });
  for (const [x, fz] of [[-26, -34], [26, -34], [-26, 18], [26, 18]]) {
    const pole = new THREE.Mesh(poleGeo, white);
    pole.position.set(x, 0.75, fz);
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(x, 1.36, fz);
    flag.rotation.y = x < 0 ? 0 : Math.PI;
    scene.add(pole, flag);
  }

  return { cones, rings };
}
