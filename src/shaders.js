// Shared GLSL for the ground, the sky dome and the grass blades.
// The look borrows from graph-paper construction sheets: a pale paper sheet with
// fine ink lines and green major lines, with a mown grass pitch laid on top.

export const NOISE = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
`;

// Pitch layout in world metres (x across, y here = world z).
// Touchlines x = +-26, goal line z = -34, halfway line z = 18.
export const PITCH = /* glsl */ `
uniform vec3 uGrassA, uGrassB;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float grassMask(vec2 p) {
  float d = sdRoundBox(p - vec2(0.0, -8.0), vec2(31.0, 30.0), 7.0);
  d += (fbm(p * 0.18) - 0.5) * 5.0 + (vnoise(p * 1.3) - 0.5) * 0.8;
  return 1.0 - smoothstep(-1.2, 0.6, d);
}
vec3 grassColor(vec2 p) {
  float n = fbm(p * 0.22);
  float stripe = mod(floor((p.y + 34.0) / 5.2), 2.0);
  vec3 c = mix(uGrassA, uGrassB, smoothstep(0.25, 0.8, n));
  c *= mix(0.92, 1.07, stripe);
  c *= 0.9 + 0.18 * vnoise(p * 2.7);
  return c;
}
float segD(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
float cornerArc(vec2 p, vec2 c, vec2 inward) {
  vec2 q = (p - c) * inward;
  return (q.x > 0.0 && q.y > 0.0) ? abs(length(q) - 1.0) : 1e5;
}
float pitchLineDist(vec2 p) {
  float d = 1e5;
  d = min(d, segD(p, vec2(-26.0, -34.0), vec2(26.0, -34.0)));
  d = min(d, segD(p, vec2(-26.0, 18.0), vec2(26.0, 18.0)));
  d = min(d, segD(p, vec2(-26.0, -34.0), vec2(-26.0, 18.0)));
  d = min(d, segD(p, vec2(26.0, -34.0), vec2(26.0, 18.0)));
  d = min(d, segD(p, vec2(-20.16, -34.0), vec2(-20.16, -17.5)));
  d = min(d, segD(p, vec2(20.16, -34.0), vec2(20.16, -17.5)));
  d = min(d, segD(p, vec2(-20.16, -17.5), vec2(20.16, -17.5)));
  d = min(d, segD(p, vec2(-9.16, -34.0), vec2(-9.16, -28.5)));
  d = min(d, segD(p, vec2(9.16, -34.0), vec2(9.16, -28.5)));
  d = min(d, segD(p, vec2(-9.16, -28.5), vec2(9.16, -28.5)));
  vec2 ps = p - vec2(0.0, -23.0);
  d = min(d, max(length(ps) - 0.16, 0.0));
  if (p.y > -17.5) d = min(d, abs(length(ps) - 9.15));
  vec2 cs = p - vec2(0.0, 18.0);
  if (p.y < 18.0) d = min(d, abs(length(cs) - 9.15));
  d = min(d, max(length(cs) - 0.16, 0.0));
  d = min(d, cornerArc(p, vec2(-26.0, -34.0), vec2(1.0, 1.0)));
  d = min(d, cornerArc(p, vec2(26.0, -34.0), vec2(-1.0, 1.0)));
  d = min(d, cornerArc(p, vec2(-26.0, 18.0), vec2(1.0, -1.0)));
  d = min(d, cornerArc(p, vec2(26.0, 18.0), vec2(-1.0, -1.0)));
  return d;
}
`;

export const GROUND_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const GROUND_FRAG = /* glsl */ `
varying vec3 vWorld;
uniform vec3 uPaper, uInk, uAccent, uLine, uCam;
uniform vec4 uBall;    // xyz, radius
uniform vec4 uPlayer;  // xyz, facing yaw
uniform float uFogNear, uFogFar;
${NOISE}
${PITCH}
float gridPx(vec2 p, float s, float px, vec2 fw) {
  vec2 g = abs(fract(p / s + 0.5) - 0.5) * s / fw;
  float d = min(g.x, g.y);
  float aa = 1.0 - smoothstep(px * 0.5, px * 0.5 + 1.0, d);
  return aa * (1.0 - smoothstep(0.12, 0.35, max(fw.x, fw.y) / s));
}
void main() {
  vec2 p = vWorld.xz;
  vec2 fw = max(fwidth(p), vec2(1e-4));
  float aa = max(fw.x, fw.y);

  float gMinor = gridPx(p, 1.0, 1.0, fw);
  float gMajor = gridPx(p, 5.0, 1.5, fw);
  float gBig = gridPx(p, 25.0, 2.2, fw);

  vec3 paper = uPaper;
  paper = mix(paper, uInk, gMinor * 0.13);
  paper = mix(paper, uAccent, gMajor * 0.38);
  paper = mix(paper, uAccent, gBig * 0.7);

  vec3 grass = grassColor(p);
  float fine = hash12(floor(p * 38.0));
  grass *= mix(1.0, 0.86 + 0.26 * fine, 1.0 - smoothstep(0.01, 0.035, aa));
  grass = mix(grass, grass * 0.86, gMinor * 0.4);
  grass = mix(grass, grass * 1.12, gMajor * 0.35);
  float lines = 1.0 - smoothstep(0.06 - aa, 0.06 + aa, pitchLineDist(p));
  grass = mix(grass, uLine, lines * 0.93);

  float m = grassMask(p);
  float rim = smoothstep(0.0, 0.5, m) * (1.0 - smoothstep(0.5, 1.0, m));
  vec3 col = mix(paper, grass, m);
  col = mix(col, uAccent * 0.6, rim * 0.25);

  // soft contact shadows for the ball and the player
  float h = max(uBall.y - uBall.w, 0.0);
  float r = uBall.w * 1.1 + h * 0.35;
  vec2 db = p - uBall.xz;
  float sb = exp(-dot(db, db) / (r * r)) * 0.55 / (1.0 + h * 0.9);
  vec2 q = p - uPlayer.xz;
  float c = cos(uPlayer.w), s = sin(uPlayer.w);
  q = vec2(c * q.x - s * q.y, s * q.x + c * q.y) / vec2(0.36, 0.26);
  float sp = exp(-dot(q, q)) * 0.38 / (1.0 + uPlayer.y * 1.5);
  col *= (1.0 - sb) * (1.0 - sp);

  float dist = length(vWorld - uCam);
  col = mix(col, uPaper, smoothstep(uFogNear, uFogFar, dist));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export const SKY_VERT = GROUND_VERT;

export const SKY_FRAG = /* glsl */ `
varying vec3 vWorld;
uniform vec3 uPaper, uInk, uAccent, uCam;
float lineAt(float v, float s, float fw, float px) {
  float d = abs(fract(v / s + 0.5) - 0.5) * s / max(fw, 1e-4);
  return 1.0 - smoothstep(px * 0.5, px * 0.5 + 1.0, d);
}
void main() {
  vec3 d = normalize(vWorld - uCam);
  float el = degrees(asin(clamp(d.y, -1.0, 1.0)));
  float az = degrees(atan(d.z, d.x));
  float az2 = degrees(atan(-d.z, -d.x));
  float fwAz = min(fwidth(az), fwidth(az2));
  float fwEl = fwidth(el);

  float minor = max(lineAt(az, 7.5, fwAz, 1.0), lineAt(el, 7.5, fwEl, 1.0));
  float major = max(lineAt(az, 30.0, fwAz, 1.4), lineAt(el, 30.0, fwEl, 1.4));
  float vis = smoothstep(1.0, 9.0, el) * (1.0 - smoothstep(68.0, 86.0, el));

  vec3 col = uPaper * (1.0 - 0.035 * smoothstep(0.0, 90.0, el));
  col = mix(col, uInk, minor * 0.06 * vis);
  col = mix(col, uAccent, major * 0.22 * vis);
  float horizon = 1.0 - smoothstep(0.6, 1.6, abs(el) / max(fwEl, 1e-4));
  col = mix(col, uAccent, horizon * 0.35);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export const GRASS_VERT = /* glsl */ `
attribute vec2 aOffset;
attribute vec4 aRand;
uniform vec2 uCenter;
uniform float uSize, uTime;
uniform vec4 uBall, uPlayer;
uniform vec3 uCam, uLine;
varying vec3 vColor;
varying float vFog;
uniform float uFogNear, uFogFar;
${NOISE}
${PITCH}
void main() {
  vec2 rel = mod(aOffset - uCenter + uSize * 0.5, uSize) - uSize * 0.5;
  vec2 wp = uCenter + rel;
  float edge = 1.0 - smoothstep(uSize * 0.3, uSize * 0.48, length(rel));
  float mask = smoothstep(0.55, 0.95, grassMask(wp));
  float hgt = (0.045 + 0.07 * aRand.x) * edge * mask;

  float ang = aRand.y * 6.2831;
  vec2 dir = vec2(cos(ang), sin(ang));
  vec3 lp = position;
  vec2 side = dir * lp.x;
  float t = lp.y;

  // wind sway plus a push away from the ball and the player's feet
  float wind = sin(uTime * 1.6 + wp.x * 0.55 + wp.y * 0.35) * 0.5 + 0.5;
  vec2 bend = vec2(0.6, 0.35) * (0.15 + 0.35 * wind) * (0.6 + aRand.z);
  vec2 fb = wp - uBall.xz;
  float nb = (1.0 - smoothstep(0.08, 0.32, length(fb))) * (1.0 - smoothstep(0.15, 0.4, uBall.y - uBall.w));
  bend += normalize(fb + 1e-4) * nb * 2.5;
  vec2 fp = wp - uPlayer.xz;
  float np = (1.0 - smoothstep(0.1, 0.35, length(fp))) * (1.0 - smoothstep(0.05, 0.2, uPlayer.y));
  bend += normalize(fp + 1e-4) * np * 2.0;

  vec3 world = vec3(wp.x + side.x, 0.0, wp.y + side.y);
  world.xz += bend * t * t * hgt;
  world.y = t * hgt * (1.0 - 0.3 * min(length(bend), 1.5) * t);

  vec3 base = grassColor(wp);
  float onLine = 1.0 - smoothstep(0.05, 0.09, pitchLineDist(wp));
  base = mix(base, uLine * 0.95, onLine);
  vColor = base * mix(0.72, 1.28, t) * (0.9 + 0.2 * aRand.w);

  vFog = smoothstep(uFogNear, uFogFar, length(world - uCam));
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

export const GRASS_FRAG = /* glsl */ `
uniform vec3 uPaper;
varying vec3 vColor;
varying float vFog;
void main() {
  gl_FragColor = vec4(mix(vColor, uPaper, vFog), 1.0);
  #include <colorspace_fragment>
}
`;
