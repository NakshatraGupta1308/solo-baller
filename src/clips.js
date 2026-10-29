import * as THREE from 'three';

// Keyframed football animations converted from Gameplay Football / Google Research
// Football (public domain, see tools/gf-anims). Each clip holds local joint
// rotations, a root offset per key, and the frame and spot where the boot meets the
// ball. Space is the game's: x left, y up, z forward; 100 frames per second.

export const CLIP_NAMES = ['trap', 'turn90', 'turn180', 'shot'];

/** Fetch and prepare every clip. Resolves to { name: clip }. */
export async function loadClips(base = 'assets/anims/') {
  const out = {};
  await Promise.all(CLIP_NAMES.map(async (name) => {
    const res = await fetch(base + name + '.json');
    if (!res.ok) throw new Error(`clip ${name}: ${res.status}`);
    out[name] = prepare(await res.json(), name);
  }));
  return out;
}

function prepare(c, name) {
  const joints = {};
  for (const [j, keys] of Object.entries(c.joints)) {
    joints[j] = { f: keys.map((k) => k[0]), q: keys.map((k) => new THREE.Quaternion(k[1], k[2], k[3], k[4])) };
  }
  const root = { f: c.root.map((k) => k[0]), p: c.root.map((k) => new THREE.Vector3(k[1], k[2], k[3])) };
  return { ...c, name, joints, root };
}

// index of the last key at or before frame
function keyIndex(frames, f) {
  let i = 0;
  while (i < frames.length - 2 && frames[i + 1] <= f) i++;
  return i;
}

const _a = new THREE.Quaternion(), _b = new THREE.Quaternion();
function sampleQuat(track, f, out) {
  const i = keyIndex(track.f, f);
  const f0 = track.f[i], f1 = track.f[Math.min(i + 1, track.f.length - 1)];
  const u = f1 > f0 ? THREE.MathUtils.clamp((f - f0) / (f1 - f0), 0, 1) : 0;
  _a.copy(track.q[i]);
  _b.copy(track.q[Math.min(i + 1, track.q.length - 1)]);
  return out.copy(_a).slerp(_b, u);
}

/** Root offset at a frame (metres, clip space). */
export function rootAt(clip, f, out = new THREE.Vector3()) {
  const r = clip.root;
  const i = keyIndex(r.f, f);
  const f0 = r.f[i], f1 = r.f[Math.min(i + 1, r.f.length - 1)];
  const u = f1 > f0 ? THREE.MathUtils.clamp((f - f0) / (f1 - f0), 0, 1) : 0;
  return out.copy(r.p[i]).lerp(r.p[Math.min(i + 1, r.p.length - 1)], u);
}

const SWAP = (j) => (j.startsWith('left_') ? 'right_' + j.slice(5) : j.startsWith('right_') ? 'left_' + j.slice(6) : j);

/**
 * Pose of a clip at frame f: { joints: { name: Quaternion }, root: Vector3 }.
 * mirror swaps left and right (reflects across the x = 0 plane).
 */
export function sampleClip(clip, f, mirror, out = { joints: {}, root: new THREE.Vector3() }) {
  for (const j of Object.keys(clip.joints)) {
    const dst = mirror ? SWAP(j) : j;
    const q = out.joints[dst] ?? (out.joints[dst] = new THREE.Quaternion());
    sampleQuat(clip.joints[j], f, q);
    if (mirror) { q.y = -q.y; q.z = -q.z; }
  }
  rootAt(clip, f, out.root);
  if (mirror) out.root.x = -out.root.x;
  return out;
}

/** A clip value that flips with mirroring: positions negate x, turns negate. */
export function mirrored(clip, mirror) {
  const touch = clip.touch && { frame: clip.touch.frame, pos: clip.touch.pos.slice() };
  if (touch && mirror) touch.pos[0] = -touch.pos[0];
  const foot = clip.foot && (mirror ? (clip.foot === 'L' ? 'R' : 'L') : clip.foot);
  return { touch, foot, turn: mirror ? -clip.turn : clip.turn };
}
