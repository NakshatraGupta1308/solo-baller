import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PALETTE } from './world.js';

// Loads a Mixamo-rigged humanoid and drives its bones with the same pose
// parameters as the procedural mannequin, so every skill animation carries over.
//
// Each pose value is a rotation in character axes (x = left, y = up, z = forward)
// at a joint, exactly as on the mannequin. For a bone with rest local rotation L
// and parent rest rotation P (in character space), the posed local rotation is
// P^-1 * R * P * L.

const BONES = {
  hips: 'Hips', spine: 'Spine', spine1: 'Spine1', spine2: 'Spine2', head: 'Head',
  upLegL: 'LeftUpLeg', legL: 'LeftLeg', footL: 'LeftFoot', toeL: 'LeftToeBase',
  upLegR: 'RightUpLeg', legR: 'RightLeg', footR: 'RightFoot', toeR: 'RightToeBase',
  armL: 'LeftArm', foreArmL: 'LeftForeArm', handL: 'LeftHand',
  armR: 'RightArm', foreArmR: 'RightForeArm', handR: 'RightHand',
};

// Capsules the ball can bounce off: [from bone, to bone, radius, part]. The head
// capsule runs from the head bone to a point just above it.
const COLLIDERS = [
  ['upLegL', 'legL', 0.08, 'thigh'], ['legL', 'footL', 0.06, 'shin'], ['footL', 'toeL', 0.055, 'foot'],
  ['upLegR', 'legR', 0.08, 'thigh'], ['legR', 'footR', 0.06, 'shin'], ['footR', 'toeR', 0.055, 'foot'],
  ['hips', 'spine2', 0.15, 'body'], ['spine2', 'head', 0.14, 'chest'], ['head', null, 0.11, 'head'],
  ['armL', 'foreArmL', 0.05, 'arm'], ['foreArmL', 'handL', 0.045, 'arm'],
  ['armR', 'foreArmR', 0.05, 'arm'], ['foreArmR', 'handR', 0.045, 'arm'],
];

// Plain kit painted by height on the bind (T) pose: shirt, white shorts, green socks, dark boots.
function kitMaterial(shade) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0 });
  const col = (hex) => new THREE.Color(hex).multiplyScalar(shade);
  const uniforms = {
    uShirt: { value: col(PALETTE.accent) },
    uShorts: { value: col('#F4F4F0') },
    uSock: { value: col(PALETTE.accentDeep) },
    uSkin: { value: col(PALETTE.bone) },
    uBoot: { value: col(PALETTE.boot) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vBind;
uniform vec3 uShirt, uShorts, uSock, uSkin, uBoot;
vec3 kit(vec3 p) {
  float ax = abs(p.x);
  if (p.y > 1.53) return uSkin;                               // head and neck
  if (ax > 0.17 && p.y > 1.2) return ax < 0.36 ? uShirt : uSkin; // sleeves, then bare arms
  if (p.y > 0.97) return uShirt;
  if (p.y > 0.66) return uShorts;
  if (p.y > 0.5) return uSkin;                                // knees
  if (p.y > 0.11) return uSock;
  return uBoot;
}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = kit(vBind);');
  };
  return mat;
}

export async function loadRig(url, parent) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;
  model.updateMatrixWorld(true);

  const bones = {};
  for (const [key, name] of Object.entries(BONES)) {
    bones[key] = model.getObjectByName('mixamorig' + name);
    if (!bones[key]) throw new Error(`model is missing bone ${name}`);
  }
  const materials = [];
  model.traverse((o) => {
    if (o.isSkinnedMesh) {
      o.material = kitMaterial(o.name.includes('Joints') ? 0.72 : 1);
      o.frustumCulled = false;
      materials.push(o.material);
    }
  });

  const modelQ = model.getWorldQuaternion(new THREE.Quaternion()).invert();
  const charQ = (o) => modelQ.clone().multiply(o.getWorldQuaternion(new THREE.Quaternion()));

  // the bind pose is a T-pose; hang the arms down so they match the mannequin's rest
  for (const [key, a] of [['armL', -1], ['armR', 1]]) {
    const b = bones[key];
    const P = charQ(b.parent);
    const down = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a * Math.PI * 0.46);
    b.quaternion.premultiply(P.clone().invert().multiply(down).multiply(P));
    model.updateMatrixWorld(true);
  }

  const rest = {};
  for (const [key, b] of Object.entries(bones)) {
    const P = charQ(b.parent);
    rest[key] = { L: b.quaternion.clone(), P, Pinv: P.clone().invert(), pos: b.position.clone() };
  }
  // character-space "down" expressed in the hips' parent space, for the pelvis drop
  const parentScale = bones.hips.parent.getWorldScale(new THREE.Vector3()).y / model.getWorldScale(new THREE.Vector3()).y;
  const dropDir = new THREE.Vector3(0, -1, 0).applyQuaternion(rest.hips.Pinv).divideScalar(parentScale);

  // leg measurements for the IK, in character space at rest
  const wp = (b) => b.getWorldPosition(new THREE.Vector3());
  const dims = {
    hipX: Math.abs(wp(bones.upLegL).x),
    hipY: wp(bones.upLegL).y,
    L1: wp(bones.upLegL).distanceTo(wp(bones.legL)),
    L2: wp(bones.legL).distanceTo(wp(bones.footL)),
  };

  parent.add(model);

  const colliders = COLLIDERS.map(([from, to, r, part]) => ({
    from: bones[from], to: to && bones[to], r, part, side: from.endsWith('L') ? 'L' : from.endsWith('R') ? 'R' : null,
    a: new THREE.Vector3(), b: new THREE.Vector3(), va: new THREE.Vector3(), vb: new THREE.Vector3(),
  }));
  let primed = false;
  const prev = new THREE.Vector3();

  const e = new THREE.Euler(), q = new THREE.Quaternion();
  function set(key, x, y, z) {
    const r = rest[key];
    q.setFromEuler(e.set(x, y, z));
    bones[key].quaternion.copy(r.Pinv).multiply(q).multiply(r.P).multiply(r.L);
  }

  return {
    model,
    dims,
    apply(p) {
      set('upLegL', p.hipL, 0, p.hipLz);
      set('upLegR', p.hipR, 0, p.hipRz);
      set('legL', p.kneeL, 0, 0);
      set('legR', p.kneeR, 0, 0);
      set('footL', p.footLx, 0, 0);
      set('footR', p.footRx, 0, 0);
      set('armL', p.shL + 0.12, 0, p.shLz + 0.08);
      set('armR', p.shR + 0.12, 0, p.shRz - 0.08);
      set('foreArmL', p.elL * 0.8, 0, 0);
      set('foreArmR', p.elR * 0.8, 0, 0);
      set('spine', p.spineX * 0.5, p.spineY * 0.5, p.spineZ * 0.5);
      set('spine1', p.spineX * 0.5, p.spineY * 0.5, p.spineZ * 0.5);
      bones.hips.position.copy(rest.hips.pos).addScaledVector(dropDir, p.drop);
    },
    colliders,
    // world-space capsules and their velocities, after the pose and root are placed
    update(dt, groundY) {
      model.updateMatrixWorld(true);
      for (const c of colliders) {
        prev.copy(c.a); c.from.getWorldPosition(c.a);
        if (primed && dt > 0) c.va.subVectors(c.a, prev).divideScalar(dt);
        prev.copy(c.b);
        if (c.to) c.to.getWorldPosition(c.b); else c.b.copy(c.a).setY(c.a.y + 0.12);
        if (primed && dt > 0) c.vb.subVectors(c.b, prev).divideScalar(dt);
      }
      primed = true;
    },
    // first person: only the head is folded away, so looking down shows your own
    // shoulders, chest, legs and boots
    setFirstPerson(fp) { bones.head.scale.setScalar(fp ? 0.001 : 1); },
    /** World position between the eyes (the head bone sits at the base of the skull). */
    eyePos(out = new THREE.Vector3()) {
      return bones.head.getWorldPosition(out).add(new THREE.Vector3(0, 0.08, 0));
    },
  };
}
