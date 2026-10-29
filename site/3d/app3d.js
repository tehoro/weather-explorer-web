// Weather Explorer 3D — a three.js "diorama" of one tropical-cyclone highlight, from the bundle
// build3d.py writes (data/3d/<item>-<run>/). Opened from the viewer's 3D button:
//   3d/?d=3d/<folder>&t=<valid time to start at>&back=<viewer hash to return to>
// World units are 100 km horizontally; heights are exaggerated (slider). x = east, y = up, z = south.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const $ = (id) => document.getElementById(id);
const KM = 100;            // km per world unit
// Wind particles are sped up 7000x: fast enough to read the circulation, but not on the same clock as the
// playback (6 forecast hours per second is about 21600x, which would be too fast to follow).
const VS = 7000;           // particle speed-up: real seconds per screen second
const HOURS_PER_SEC = 6;   // playback: forecast hours per second

const params = new URLSearchParams(location.search);
const folder = params.get("d") || "";
// Back to the map view the 3D view was opened from (its share-link hash).
const back = () => location.assign(`../${params.get("back") ? `#${params.get("back")}` : ""}`);
$("back").onclick = back;
let meta, buf;
try {
  if (!/^3d\/[\w.-]+$/.test(folder)) throw new Error("no 3D view named");
  const base = `../data/${folder}`;
  meta = await (await fetch(`${base}/meta.json`)).json();
  const r = await fetch(`${base}/bundle.bin.gz`);
  if (!r.ok) throw new Error(`bundle ${r.status}`);
  // Served as a plain .gz file (no Content-Encoding), so it is unpacked here.
  const total = meta.bytes || 0;
  let got = 0;
  const counted = r.body.pipeThrough(new TransformStream({ transform(chunk, c) {
    got += chunk.length;
    if (total) $("loading").textContent = `Loading the storm… ${Math.min(99, Math.round((got / total) * 100))}%`;
    c.enqueue(chunk);
  } }));
  buf = await new Response(counted.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
} catch (e) {
  console.warn(e);
  $("loading").innerHTML = `This 3D view isn't available any more. <button id="back2">Back to the map</button>`;
  $("back2").onclick = back;
  throw e;
}
const arr = (name) => {
  const a = meta.arrays[name];
  const n = a.shape.reduce((x, y) => x * y, 1);
  return new (a.dtype === "int8" ? Int8Array : Uint8Array)(buf, a.offset, n);
};
const RH = arr("rh"), WARM = arr("warm"), WIND = arr("wind"), WIND10 = arr("wind10"),
  MSL = arr("msl"), RAIN = arr("rain"), LSM = arr("lsm");
const { nx: NX, ny: NY, nz: NZ, top_km: TOP } = meta;
const [W, S, E, N] = meta.bbox, RES = meta.res || 0.25;
const NF = meta.times.length, PLANE = NX * NY, VOL = PLANE * NZ;
const times = meta.times.map((t) => new Date(t.replace("Z", ":00Z")));

// ------------------------------------------------------------------------------------------
// Geometry helpers
// ------------------------------------------------------------------------------------------
const latC = (S + N) / 2, lonC = (W + E) / 2;
const kmLon = 111.32 * Math.cos((latC * Math.PI) / 180), kmLat = 111.32;
const BW = ((E - W) * kmLon) / KM, BD = ((N - S) * kmLat) / KM;
let exag = 60;
const toX = (lon) => ((lon - lonC) * kmLon) / KM;
const toZ = (lat) => (-(lat - latC) * kmLat) / KM;
const toY = (km) => (km * exag) / KM;
const stdKm = (p) => 44.3308 * (1 - (p / 1013.25) ** 0.190263);

// ------------------------------------------------------------------------------------------
// Renderer, camera, controls
// ------------------------------------------------------------------------------------------
const mobile = matchMedia("(max-width: 700px)").matches;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 500);
camera.position.set(BW * 0.35, BW * 0.55, BD * 1.25);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 1.5;
controls.maxDistance = 120;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.35;
controls.addEventListener("start", () => (controls.autoRotate = false));

const sun = new THREE.Vector3(-0.45, 0.8, 0.4).normalize();
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dl = new THREE.DirectionalLight(0xffffff, 1.4);
dl.position.copy(sun).multiplyScalar(50);
scene.add(dl);

// ------------------------------------------------------------------------------------------
// Per-frame textures: surface (2D) and volume (3D), two of each, blended in the shaders
// ------------------------------------------------------------------------------------------
const h = THREE.DataUtils.toHalfFloat;
// Pressure is stored in 0.5 hPa steps: smooth it so the isobars don't come out as staircases.
const smooth = (src, passes) => {
  let a = Float32Array.from(src);
  for (let p = 0; p < passes; p++) {
    const b = new Float32Array(PLANE);
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      let s = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const jj = j + dj, ii = i + di;
        if (jj >= 0 && jj < NY && ii >= 0 && ii < NX) { s += a[jj * NX + ii]; n++; }
      }
      b[j * NX + i] = s / n;
    }
    a = b;
  }
  return a;
};
const surfData = (f) => {
  const out = new Uint16Array(PLANE * 4), o = f * PLANE;
  const msl = smooth(MSL.subarray(o, o + PLANE), 2);
  for (let k = 0; k < PLANE; k++) {
    const u = WIND10[(f * 2) * PLANE + k], v = WIND10[(f * 2 + 1) * PLANE + k];
    out[k * 4] = h(Math.hypot(u, v));
    out[k * 4 + 1] = h(msl[k] / 2 + 900 - 1000);
    out[k * 4 + 2] = h((RAIN[o + k] / 255) ** 2 * 100);
    out[k * 4 + 3] = h(LSM[k] / 255);
  }
  return out;
};
const volCache = new Map();
const volData = (f) => {
  if (volCache.has(f)) return volCache.get(f);
  const out = new Uint8Array(VOL * 2), o = f * VOL;
  for (let k = 0; k < VOL; k++) { out[k * 2] = RH[o + k]; out[k * 2 + 1] = WARM[o + k]; }
  volCache.set(f, out);
  return out;
};
const surfTex = () => {
  const t = new THREE.DataTexture(surfData(0), NX, NY, THREE.RGBAFormat, THREE.HalfFloatType);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
};
const volTex = () => {
  const t = new THREE.Data3DTexture(volData(0), NX, NY, NZ);
  t.format = THREE.RGFormat;
  t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
};
const tex = { sA: surfTex(), sB: surfTex(), vA: volTex(), vB: volTex(), frame: -1 };
function setFrames(a) {
  if (a === tex.frame) return;
  tex.frame = a;
  tex.sA.image.data = surfData(a); tex.sA.needsUpdate = true;
  tex.sB.image.data = surfData(a + 1); tex.sB.needsUpdate = true;
  tex.vA.image.data = volData(a); tex.vA.needsUpdate = true;
  tex.vB.image.data = volData(a + 1); tex.vB.needsUpdate = true;
}

// ------------------------------------------------------------------------------------------
// Sea surface and plinth
// ------------------------------------------------------------------------------------------
// Shared by the sea and cloud shaders (one object, so updating it updates both).
const eyeUniforms = { eyeC: { value: new THREE.Vector2() }, offA: { value: new THREE.Vector2() }, offB: { value: new THREE.Vector2() },
  eyeR: { value: new THREE.Vector2(6 / (E - W), 6 / (N - S)) } };
const seaMat = new THREE.ShaderMaterial({
  uniforms: {
    sA: { value: tex.sA }, sB: { value: tex.sB }, mixF: { value: 0 }, ...eyeUniforms, isoOn: { value: 1 }, time: { value: 0 },
    box: { value: new THREE.Vector4(W, S, E, N) }, sunDir: { value: sun },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv; varying vec3 vWorld;
    void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D sA, sB; uniform float mixF, isoOn, time; uniform vec4 box; uniform vec3 sunDir;
    uniform vec2 eyeC, offA, offB, eyeR;   // eye now, shifts to frames A and B (texture units), radius
    vec4 eyeTc(vec2 tc) { vec2 d = (tc - eyeC) / eyeR; float w = exp(-dot(d, d)); return vec4(tc + w * offA, tc + w * offB); }

    varying vec2 vUv; varying vec3 vWorld;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + 1.0), f.x), f.y); }
    void main() {
      vec4 et = eyeTc(vUv);
      vec4 s = mix(texture2D(sA, et.xy), texture2D(sB, et.zw), mixF);
      float spd = s.r, msl = s.g + 1000.0, rain = s.b, land = s.a;
      vec3 col = mix(vec3(0.015, 0.05, 0.11), vec3(0.03, 0.24, 0.34), smoothstep(8.0, 32.0, spd));
      float n = noise(vWorld.xz * 6.0 + time * 0.7) * 0.6 + noise(vWorld.xz * 17.0 - time * 1.3) * 0.4;
      col = mix(col, vec3(0.82, 0.93, 1.0), smoothstep(26.0, 60.0, spd) * smoothstep(0.35, 0.9, n) * 0.9);
      col *= 1.0 - 0.35 * smoothstep(1.0, 20.0, rain);
      vec3 V = normalize(cameraPosition - vWorld); vec3 H = normalize(V + sunDir);
      col += vec3(1.0, 0.9, 0.75) * pow(max(H.y, 0.0), 200.0) * 0.5 * (1.0 - land);
      col = mix(col, vec3(0.22, 0.30, 0.16), smoothstep(0.3, 0.6, land));
      vec2 ll = vec2(mix(box.x, box.z, vUv.x), mix(box.y, box.w, vUv.y)) / 5.0;
      vec2 g = abs(fract(ll - 0.5) - 0.5) / fwidth(ll);
      col += vec3(0.05, 0.09, 0.15) * (1.0 - min(min(g.x, g.y), 1.0));
      float v = msl / 4.0; float l = abs(fract(v - 0.5) - 0.5) / fwidth(v);
      col = mix(col, vec3(0.85, 0.9, 0.95), (1.0 - min(l, 1.0)) * 0.55 * isoOn);
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const sea = new THREE.Mesh(new THREE.PlaneGeometry(BW, BD), seaMat);
sea.rotation.x = -Math.PI / 2;
scene.add(sea);

const plinthH = 0.8;
const plinth = new THREE.Mesh(new THREE.BoxGeometry(BW, plinthH, BD),
  new THREE.MeshStandardMaterial({ color: 0x0c1626, roughness: 0.7, metalness: 0.3 }));
plinth.position.y = -plinthH / 2 - 0.003;
scene.add(plinth);
const edges = new THREE.LineSegments(new THREE.EdgesGeometry(plinth.geometry),
  new THREE.LineBasicMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.35 }));
edges.position.copy(plinth.position);
scene.add(edges);

const coastMat = new THREE.LineBasicMaterial({ color: 0xdfe8cf, transparent: true, opacity: 0.85 });
for (const line of meta.coast) {
  const pts = line.filter(([lo, la]) => lo >= W && lo <= E && la >= S && la <= N)
    .map(([lo, la]) => new THREE.Vector3(toX(lo), 0.01, toZ(la)));
  if (pts.length > 1) scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), coastMat));
}

// ------------------------------------------------------------------------------------------
// Cloud and warm-core volume (ray-marched)
// ------------------------------------------------------------------------------------------
const volMat = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  uniforms: {
    volA: { value: tex.vA }, volB: { value: tex.vB }, mixF: { value: 0 }, ...eyeUniforms,
    thr: { value: 0.85 }, dens: { value: 1.4 }, cloudOn: { value: 1 }, warmOn: { value: 0 },
    steps: { value: mobile ? 64 : 112 }, lightSteps: { value: mobile ? 0 : 4 },
    camLocal: { value: new THREE.Vector3() }, sunLocal: { value: new THREE.Vector3() }, boxScale: { value: new THREE.Vector3() },
  },
  vertexShader: /* glsl */ `
    out vec3 vPos;
    void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    precision highp float; precision highp sampler3D;
    uniform sampler3D volA, volB; uniform float mixF, thr, dens, cloudOn, warmOn, lightSteps; uniform int steps;
    uniform vec2 eyeC, offA, offB, eyeR;   // eye now, shifts to frames A and B (texture units), radius
    vec4 eyeTc(vec2 tc) { vec2 d = (tc - eyeC) / eyeR; float w = exp(-dot(d, d)); return vec4(tc + w * offA, tc + w * offB); }

    uniform vec3 camLocal, sunLocal, boxScale;
    in vec3 vPos;
    out vec4 fragColor;
    vec2 hitBox(vec3 o, vec3 d) {
      vec3 inv = 1.0 / d, t0 = (vec3(-0.5) - o) * inv, t1 = (vec3(0.5) - o) * inv;
      vec3 mn = min(t0, t1), mx = max(t0, t1);
      return vec2(max(max(mn.x, mn.y), mn.z), min(min(mx.x, mx.y), mx.z));
    }
    vec2 vol(vec3 p) {
      vec3 tc = vec3(p.x + 0.5, 0.5 - p.z, p.y + 0.5); vec4 et = eyeTc(tc.xy);
      return mix(texture(volA, vec3(et.xy, tc.z)).rg, texture(volB, vec3(et.zw, tc.z)).rg, mixF);
    }
    float cloud(vec2 s, vec3 p) {
      float rh = s.r * 1.275;   // stored as 2 x percent
      vec3 t = p + 0.5;
      float edge = smoothstep(0.0, 0.025, min(min(t.x, 1.0 - t.x), min(t.z, 1.0 - t.z)));
      // Above about 8 km moist air is mostly thin cirrus, not thick cloud: draw it faint, and fade
      // out the near-saturated tropopause layer at the top of the box.
      float cirrus = mix(1.0, 0.12, smoothstep(0.5, 0.75, t.y)) * (1.0 - smoothstep(0.86, 0.96, t.y));
      return smoothstep(thr, thr + 0.1, rh) * edge * smoothstep(0.0, 0.04, t.y) * cirrus * cloudOn;
    }
    void main() {
      vec3 d = normalize(vPos - camLocal);
      vec2 b = hitBox(camLocal, d); b.x = max(b.x, 0.0);
      if (b.x >= b.y) discard;
      float dt = (b.y - b.x) / float(steps);
      float j = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      vec3 p = camLocal + d * (b.x + dt * j);
      float worldStep = length(d * boxScale) * dt;
      vec3 col = vec3(0.0); float alpha = 0.0;
      for (int i = 0; i < 200; i++) {
        if (i >= steps) break;
        vec2 s = vol(p);
        float c = cloud(s, p);
        float w = warmOn * smoothstep(0.42, 0.85, s.g);   // about +3 K to +12 K
        float ext = c * dens + w * 1.2;
        if (ext > 0.001) {
          float a = 1.0 - exp(-ext * worldStep);
          float T = 1.0;
          if (lightSteps > 0.5) {
            float od = 0.0; vec3 q = p;
            for (int k = 0; k < 6; k++) {
              if (float(k) >= lightSteps) break;
              q += sunLocal * 0.5;
              if (any(lessThan(q, vec3(-0.5))) || any(greaterThan(q, vec3(0.5)))) break;
              od += cloud(vol(q), q) * dens * 0.5;
            }
            T = exp(-od);
          }
          float hgt = p.y + 0.5;
          vec3 lit = mix(vec3(0.16, 0.20, 0.30), vec3(1.0, 0.98, 0.94), T) * (0.7 + 0.4 * hgt);
          vec3 cc = mix(lit, vec3(1.0, 0.42, 0.10) * 1.6, clamp(w * 1.2 / ext, 0.0, 1.0));
          col += (1.0 - alpha) * a * cc; alpha += (1.0 - alpha) * a;
          if (alpha > 0.97) break;
        }
        p += d * dt;
      }
      if (alpha < 0.004) discard;
      fragColor = vec4(col / alpha, alpha);
    }`,
  side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: false,
});
const volume = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), volMat);
volume.renderOrder = 2;
scene.add(volume);

// ------------------------------------------------------------------------------------------
// Sampling helpers (bilinear in space, linear in time)
// ------------------------------------------------------------------------------------------
// continuous frame index, base frame, fraction; starts at the time the viewer was showing (?t=)
let tNow = 0, fa = 0, ff = 0;
{
  const want = Date.parse(params.get("t") || "");
  if (want >= times[0] && want <= times[NF - 1]) {
    const i = Math.min(times.findIndex((t, k) => k === NF - 1 || times[k + 1] >= want), NF - 2);
    tNow = i + Math.max(0, Math.min(1, (want - times[i]) / (times[i + 1] - times[i])));
  }
}
// Storm centre (lowest pressure in the box) at each time, and interpolated to now.
const eyes = [];
for (let f = 0; f < NF; f++) {
  let mn = 255, sx = 0, sy = 0, n = 0;
  for (let k = 0; k < PLANE; k++) mn = Math.min(mn, MSL[f * PLANE + k]);
  for (let k = 0; k < PLANE; k++) if (MSL[f * PLANE + k] <= mn + 1) { sx += k % NX; sy += (k / NX) | 0; n++; }
  eyes.push({ lon: W + (sx / n) * RES, lat: S + (sy / n) * RES, hpa: mn / 2 + 900 });
}
const eyeNow = () => {
  const a = eyes[fa], b = eyes[fa + 1];
  return { lon: a.lon + (b.lon - a.lon) * ff, lat: a.lat + (b.lat - a.lat) * ff, hpa: a.hpa + (b.hpa - a.hpa) * ff };
};
// Near the eye, each frame is sampled shifted so its eye lines up with the interpolated one: blending
// two frames then moves the storm, instead of fading one copy out while another fades in.
const R2 = 36;   // (6 deg)^2: how far round the eye the shift reaches
function eyeShift(lon, lat) {
  const e = eyeNow(), a = eyes[fa], b = eyes[fa + 1], x = (lon - e.lon) * Math.cos((e.lat * Math.PI) / 180), y = lat - e.lat;
  const w = Math.exp(-(x * x + y * y) / R2);
  return [w * (a.lon - e.lon), w * (a.lat - e.lat), w * (b.lon - e.lon), w * (b.lat - e.lat)];
}
function bil(data, base, lon, lat) {
  const x = Math.min(Math.max((lon - W) / RES, 0), NX - 1.001), y = Math.min(Math.max((lat - S) / RES, 0), NY - 1.001);
  const i = x | 0, j = y | 0, fx = x - i, fy = y - j, k = base + j * NX + i;
  return (data[k] * (1 - fx) + data[k + 1] * fx) * (1 - fy) + (data[k + NX] * (1 - fx) + data[k + NX + 1] * fx) * fy;
}
function lerpT(data, perFrame, off, lon, lat) {
  const [ax, ay, bx, by] = eyeShift(lon, lat);
  return bil(data, fa * perFrame + off, lon + ax, lat + ay) * (1 - ff) + bil(data, (fa + 1) * perFrame + off, lon + bx, lat + by) * ff;
}
const windAt = (li, lon, lat) => [lerpT(WIND, 6 * PLANE, 2 * li * PLANE, lon, lat), lerpT(WIND, 6 * PLANE, (2 * li + 1) * PLANE, lon, lat)];
const rainAt = (lon, lat) => (lerpT(RAIN, PLANE, 0, lon, lat) / 255) ** 2 * 100;

// ------------------------------------------------------------------------------------------
// Wind particles with fading trails
// ------------------------------------------------------------------------------------------
const glowMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
// Each particle is a tapering ribbon (flat, at its level) with a glowing head, so the direction of
// travel reads at a glance. Particles are seeded where the wind is strong, so they gather in the storm.
const ribbonMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
const dot = document.createElement("canvas");
dot.width = dot.height = 64;
{
  const g = dot.getContext("2d"), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.25, "rgba(255,255,255,0.8)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
}
let flowGlow = 0.3;   // brightness of the wind arrows (slider)
const headMat = new THREE.PointsMaterial({ size: 0.15, map: new THREE.CanvasTexture(dot), vertexColors: true, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
class Flow {
  constructor(level, n, lo, hi, order) {
    this.li = meta.wind_levels.indexOf(level); this.km = stdKm(level); this.n = n; this.T = 36;
    this.lo = new THREE.Color(lo); this.hi = new THREE.Color(hi);
    this.lon = new Float32Array(n * this.T); this.lat = new Float32Array(n * this.T);
    this.age = new Float32Array(n); this.life = new Float32Array(n); this.acc = 0;
    for (let i = 0; i < n; i++) { this.spawn(i); this.age[i] = Math.random() * this.life[i]; }
    const T = this.T, verts = n * T * 2;
    this.pos = new Float32Array(verts * 3); this.col = new Float32Array(verts * 3);
    const idx = new Uint32Array(n * (T - 1) * 6);
    for (let i = 0, o = 0; i < n; i++) for (let k = 0; k < T - 1; k++) {
      const v = (i * T + k) * 2;
      idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], o); o += 6;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.ribbons = new THREE.Mesh(g, ribbonMat);
    this.hpos = new Float32Array(n * 3); this.hcol = new Float32Array(n * 3);
    const hg = new THREE.BufferGeometry();
    hg.setAttribute("position", new THREE.BufferAttribute(this.hpos, 3).setUsage(THREE.DynamicDrawUsage));
    hg.setAttribute("color", new THREE.BufferAttribute(this.hcol, 3).setUsage(THREE.DynamicDrawUsage));
    this.heads = new THREE.Points(hg, headMat);
    this.obj = new THREE.Group();
    for (const m of [this.ribbons, this.heads]) { m.frustumCulled = false; m.renderOrder = order; this.obj.add(m); }
    scene.add(this.obj);
  }
  spawn(i) {
    let lo, la;
    for (let tries = 0; tries < 30; tries++) {
      lo = W + Math.random() * (E - W); la = S + Math.random() * (N - S);
      const [u, v] = windAt(this.li, lo, la);
      if (Math.random() < (Math.hypot(u, v) / 45) ** 3) break;
    }
    const b = i * this.T;
    this.lon.fill(lo, b, b + this.T); this.lat.fill(la, b, b + this.T);
    this.age[i] = 0; this.life[i] = 2 + Math.random() * 2.5;
  }
  // Move particles near the storm with it (weight fades over ~6 deg), so swirls stay centred on the
  // eye as it moves instead of leaving trails round where it used to be.
  carry(dLon, dLat, eye) {
    const cl = Math.cos((eye.lat * Math.PI) / 180);
    for (let i = 0; i < this.n; i++) {
      const b = i * this.T, x = (this.lon[b] - eye.lon) * cl, y = this.lat[b] - eye.lat;
      const w = Math.exp(-(x * x + y * y) / 36);
      if (w < 0.01) continue;
      for (let k = 0; k < this.T; k++) { this.lon[b + k] += w * dLon; this.lat[b + k] += w * dLat; }
    }
  }
  reset() { for (let i = 0; i < this.n; i++) { this.spawn(i); this.age[i] = Math.random() * this.life[i]; } }
  step(dt) {
    const T = this.T, y = toY(this.km), c = new THREE.Color(), half = 0.055;
    this.acc += dt;
    const push = this.acc >= 1 / 30;
    if (push) this.acc = 0;
    for (let i = 0; i < this.n; i++) {
      const b = i * T;
      this.age[i] += dt;
      let lo = this.lon[b], la = this.lat[b];
      if (this.age[i] > this.life[i] || lo < W || lo > E || la < S || la > N) { this.spawn(i); lo = this.lon[b]; la = this.lat[b]; }
      const [u, v] = windAt(this.li, lo, la);
      if (push) for (let k = T - 1; k > 0; k--) { this.lon[b + k] = this.lon[b + k - 1]; this.lat[b + k] = this.lat[b + k - 1]; }
      this.lon[b] = lo + (u * VS * dt) / (111320 * Math.cos((la * Math.PI) / 180));
      this.lat[b] = la + (v * VS * dt) / 111320;
      const speed = Math.hypot(u, v);
      c.copy(this.lo).lerp(this.hi, Math.min(speed / 50, 1));
      const fade = flowGlow * Math.min(this.age[i] / 0.5, (this.life[i] - this.age[i]) / 0.5, 1) * (0.45 + Math.min(speed / 30, 1) * 0.55);
      let px = 0, pz = 1;
      for (let k = 0; k < T; k++) {
        const x = toX(this.lon[b + k]), z = toZ(this.lat[b + k]);
        const k2 = Math.min(k + 1, T - 1), dx = x - toX(this.lon[b + k2]), dz = z - toZ(this.lat[b + k2]), len = Math.hypot(dx, dz);
        if (len > 1e-5) { px = -dz / len; pz = dx / len; }
        const f = 1 - k / (T - 1), w = half * f, a = fade * Math.sqrt(f), o = (b + k) * 6;
        this.pos[o] = x + px * w; this.pos[o + 1] = y; this.pos[o + 2] = z + pz * w;
        this.pos[o + 3] = x - px * w; this.pos[o + 4] = y; this.pos[o + 5] = z - pz * w;
        this.col[o] = this.col[o + 3] = c.r * a; this.col[o + 1] = this.col[o + 4] = c.g * a; this.col[o + 2] = this.col[o + 5] = c.b * a;
      }
      this.hpos[i * 3] = toX(this.lon[b]); this.hpos[i * 3 + 1] = y; this.hpos[i * 3 + 2] = toZ(this.lat[b]);
      this.hcol[i * 3] = c.r * fade; this.hcol[i * 3 + 1] = c.g * fade; this.hcol[i * 3 + 2] = c.b * fade;
    }
    for (const m of [this.ribbons, this.heads]) {
      m.geometry.attributes.position.needsUpdate = true;
      m.geometry.attributes.color.needsUpdate = true;
    }
  }
}
// Both flows are drawn over the clouds so they stay readable from above.
const inflow = new Flow(925, mobile ? 500 : 1000, 0x1fb5b0, 0xc8fff6, 3);
const outflow = new Flow(200, mobile ? 500 : 1000, 0xd9711c, 0xffe8b8, 3);

// ------------------------------------------------------------------------------------------
// Rain streaks
// ------------------------------------------------------------------------------------------
class Rain {
  constructor(n) {
    this.n = n; this.lon = new Float32Array(n); this.lat = new Float32Array(n); this.km = new Float32Array(n); this.rate = new Float32Array(n);
    this.pos = new Float32Array(n * 6); this.col = new Float32Array(n * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.obj = new THREE.LineSegments(g, glowMat);
    this.obj.frustumCulled = false; this.obj.renderOrder = 1;
    scene.add(this.obj);
    for (let i = 0; i < n; i++) { this.spawn(i); this.km[i] *= Math.random(); }
  }
  spawn(i) {
    this.rate[i] = 0; this.km[i] = -1;
    for (let tries = 0; tries < 6; tries++) {
      const lo = W + Math.random() * (E - W), la = S + Math.random() * (N - S), r = rainAt(lo, la);
      if (r > 1 && Math.random() < r / 40) { this.lon[i] = lo; this.lat[i] = la; this.rate[i] = r; this.km[i] = 3.5 + Math.random() * 1.5; return; }
    }
  }
  step(dt) {
    for (let i = 0; i < this.n; i++) {
      this.km[i] -= dt * 7;
      if (this.km[i] < 0) this.spawn(i);
      const o = i * 6, x = toX(this.lon[i]), z = toZ(this.lat[i]), a = this.km[i] < 0 ? 0 : 0.25 + Math.min(this.rate[i] / 25, 1) * 0.55;
      this.pos[o] = x; this.pos[o + 1] = toY(Math.max(this.km[i], 0)); this.pos[o + 2] = z;
      this.pos[o + 3] = x; this.pos[o + 4] = toY(Math.max(this.km[i], 0) + 0.7); this.pos[o + 5] = z;
      this.col[o] = 0.55 * a; this.col[o + 1] = 0.72 * a; this.col[o + 2] = 1.0 * a;
      this.col[o + 3] = 0; this.col[o + 4] = 0; this.col[o + 5] = 0;
    }
    this.obj.geometry.attributes.position.needsUpdate = true;
    this.obj.geometry.attributes.color.needsUpdate = true;
  }
}
const rain = new Rain(mobile ? 3000 : 7000);

// ------------------------------------------------------------------------------------------
// Storm track (lowest pressure in the box at each time), labels
// ------------------------------------------------------------------------------------------
const track = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints(eyes.map((e) => new THREE.Vector3(toX(e.lon), 0.02, toZ(e.lat)))),
  new THREE.LineDashedMaterial({ color: 0xffd27a, dashSize: 0.25, gapSize: 0.18, transparent: true, opacity: 0.8 }));
track.computeLineDistances();
scene.add(track);

const labels = [];
function addLabel(text, cls, getPos, show) {
  const el = document.createElement("div");
  el.className = `label ${cls}`; el.textContent = text;
  $("labels").appendChild(el);
  labels.push({ el, getPos, show });
  return el;
}
for (const p of meta.places || []) addLabel(p.label, "place", () => new THREE.Vector3(toX(p.lon), 0, toZ(p.lat)));
const eyeLabel = addLabel("", "eye", () => { const e = eyeNow(); return new THREE.Vector3(toX(e.lon), toY(TOP) + 0.3, toZ(e.lat)); });
// A faint frame round the box at each flow's height, labelled, so it's clear where each one sits.
const levelFrames = [[inflow, 0x4fe3d0, "Inflow · 925 hPa, about 0.8 km up"], [outflow, 0xffb547, "Outflow · 200 hPa, about 12 km up"]].map(([flow, color, text]) => {
  const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3((a * BW) / 2, 0, (b * BD) / 2))),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 }));
  scene.add(ring);
  const farCorner = () => {   // the back corner, which is nearly always in view
    const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3((a * BW) / 2, toY(flow.km), (b * BD) / 2));
    return c.reduce((m, v) => (v.distanceTo(camera.position) > m.distanceTo(camera.position) ? v : m));
  };
  const el = addLabel(text, "level", farCorner, () => flow.obj.visible);
  el.style.color = `#${color.toString(16).padStart(6, "0")}`;
  return { flow, ring };
});
// N/E/S/W on the box edges, and a compass dial that turns as you orbit (click it to put north up).
for (const [t, x, z] of [["N", 0, -BD / 2 - 0.9], ["E", BW / 2 + 0.9, 0], ["S", 0, BD / 2 + 0.9], ["W", -BW / 2 - 0.9, 0]])
  addLabel(t, `cardinal${t === "N" ? " n" : ""}`, () => new THREE.Vector3(x, 0, z));
const dialTexts = [...document.querySelectorAll("#dial text")];
function turnCompass() {
  const deg = (controls.getAzimuthalAngle() * 180) / Math.PI;
  $("dial").setAttribute("transform", `rotate(${deg})`);
  for (const t of dialTexts) t.setAttribute("transform", `rotate(${-deg} ${t.getAttribute("x") || 0} ${t.getAttribute("y") || 0})`);
}
let northUp = null;   // remaining turn while easing back to north-up
$("compass").onclick = () => { controls.autoRotate = false; northUp = -controls.getAzimuthalAngle(); };
function easeNorth() {
  if (northUp === null) return;
  const step = Math.abs(northUp) < 0.002 ? northUp : northUp * 0.15;
  const off = camera.position.clone().sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), step);
  camera.position.copy(controls.target).add(off);
  northUp -= step;
  if (northUp === 0) northUp = null;
}
const v3 = new THREE.Vector3();
function placeLabels() {
  for (const l of labels) {
    v3.copy(l.getPos()).project(camera);
    const hidden = (l.show && !l.show()) || v3.z > 1 || Math.abs(v3.x) > 1.1 || Math.abs(v3.y) > 1.1;
    l.el.style.display = hidden ? "none" : "";
    if (hidden) continue;
    let x = ((v3.x + 1) / 2) * innerWidth;
    if (l.el.classList.contains("level")) x = Math.min(Math.max(x, 8), innerWidth - l.el.offsetWidth - 8);   // keep on screen
    l.el.style.left = `${x}px`; l.el.style.top = `${((1 - v3.y) / 2) * innerHeight}px`;
  }
}

// ------------------------------------------------------------------------------------------
// UI
// ------------------------------------------------------------------------------------------
const run = new Date(meta.run.replace("Z", ":00Z"));
const fmt = (d, opts) => d.toLocaleString("en-GB", { timeZone: "UTC", ...opts });
$("h1").textContent = meta.title;
$("sub").textContent = `${meta.label} · IFS HRES run ${fmt(run, { hour: "2-digit", minute: "2-digit" })} UTC ${fmt(run, { day: "numeric", month: "short" })}`;
$("credit").textContent = `${meta.attribution} Clouds inferred from humidity; heights exaggerated.`;
document.title = `${meta.title} · 3D`;

let playing = false;
const setPlaying = (p) => { playing = p; $("play").textContent = p ? "❚❚" : "▶"; };
$("play").onclick = () => setPlaying(!playing);
addEventListener("keydown", (e) => { if (e.code === "Space") { e.preventDefault(); setPlaying(!playing); } });
$("slider").oninput = (e) => { tNow = (e.target.value / 1000) * (NF - 1); setPlaying(false); };
$("slider").value = (tNow / (NF - 1)) * 1000;
const bindCheck = (id, fn) => { $(id).onchange = (e) => fn(e.target.checked); fn($(id).checked); };
bindCheck("L-cloud", (on) => (volMat.uniforms.cloudOn.value = on ? 1 : 0));
bindCheck("L-warm", (on) => (volMat.uniforms.warmOn.value = on ? 1 : 0));
bindCheck("L-in", (on) => (inflow.obj.visible = on));
bindCheck("L-out", (on) => (outflow.obj.visible = on));
bindCheck("L-rain", (on) => (rain.obj.visible = on));
bindCheck("L-iso", (on) => (seaMat.uniforms.isoOn.value = on ? 1 : 0));
let follow = false;
bindCheck("L-follow", (on) => (follow = on));
$("fg").oninput = (e) => (flowGlow = e.target.value / 100);
$("ex").oninput = (e) => { exag = +e.target.value; $("exv").textContent = `${exag}×`; };
$("th").oninput = (e) => { volMat.uniforms.thr.value = e.target.value / 100; $("thv").textContent = `${e.target.value}%`; };
$("dn").oninput = (e) => (volMat.uniforms.dens.value = e.target.value / 10);
let high = !mobile;
const setQuality = () => {
  volMat.uniforms.steps.value = high ? 112 : 56;
  volMat.uniforms.lightSteps.value = high ? 4 : 0;
  renderer.setPixelRatio(Math.min(devicePixelRatio, high ? 2 : 1));
  $("quality").textContent = `Quality: ${high ? "high" : "fast"}`;
};
$("quality").onclick = () => { high = !high; setQuality(); };
setQuality();
$("toggle-layers").onclick = () => $("layers").classList.add("open");
renderer.domElement.addEventListener("pointerdown", () => $("layers").classList.remove("open"));
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});

const timeText = (t) => `${fmt(t, { weekday: "short", day: "numeric", month: "short" })}, ${fmt(t, { hour: "2-digit", minute: "2-digit" })} UTC`;
const leadText = (t) => `+${Math.round((t - run) / 3.6e6)} h · lowest ${eyeNow().hpa.toFixed(0)} hPa`;
const timeNow = () => new Date(times[fa].getTime() + ff * (times[fa + 1] - times[fa]));

function updateTime() {
  fa = Math.min(Math.floor(tNow), NF - 2); ff = tNow - fa;
  setFrames(fa);
  seaMat.uniforms.mixF.value = volMat.uniforms.mixF.value = ff;
  const e = eyeNow(), ea = eyes[fa], eb = eyes[fa + 1], tu = (lon) => lon / (E - W), tv = (lat) => lat / (N - S);
  eyeUniforms.eyeC.value.set(tu(e.lon - W), tv(e.lat - S));
  eyeUniforms.offA.value.set(tu(ea.lon - e.lon), tv(ea.lat - e.lat));
  eyeUniforms.offB.value.set(tu(eb.lon - e.lon), tv(eb.lat - e.lat));
  const t = timeNow();
  $("time").innerHTML = `${timeText(t)}<div class="lead">${leadText(t)}</div>`;
  eyeLabel.textContent = `${eyeNow().hpa.toFixed(0)} hPa`;
  if (playing) $("slider").value = (tNow / (NF - 1)) * 1000;
}

// ------------------------------------------------------------------------------------------
// Loop: one step of everything, driven by the clock on screen and frame by frame for a video
// ------------------------------------------------------------------------------------------
const clock = new THREE.Clock();
const camLocal = new THREE.Vector3();
let lastEye = null;
function frame(dt) {
  updateTime();
  const H = toY(TOP);
  volume.scale.set(BW, H, BD); volume.position.set(0, H / 2, 0); volume.updateMatrixWorld();
  volMat.uniforms.boxScale.value.set(BW, H, BD);
  volMat.uniforms.sunLocal.value.set(sun.x / BW, sun.y / H, sun.z / BD);
  volMat.uniforms.camLocal.value.copy(volume.worldToLocal(camLocal.copy(camera.position)));
  seaMat.uniforms.time.value += dt;

  for (const { flow, ring } of levelFrames) { ring.visible = flow.obj.visible; ring.position.y = toY(flow.km); }
  const eye = eyeNow();
  if (lastEye) {
    const dLon = eye.lon - lastEye.lon, dLat = eye.lat - lastEye.lat;
    if (Math.hypot(dLon, dLat) > 2) { inflow.reset(); outflow.reset(); }   // scrubbed or looped: start afresh
    else { inflow.carry(dLon, dLat, eye); outflow.carry(dLon, dLat, eye); }
  }
  lastEye = eye;
  if (inflow.obj.visible) inflow.step(dt);
  if (outflow.obj.visible) outflow.step(dt);
  if (rain.obj.visible) rain.step(dt);
  if (follow) {
    const target = new THREE.Vector3(toX(eye.lon), H * 0.3, toZ(eye.lat)), shift = target.sub(controls.target).multiplyScalar(0.05);
    controls.target.add(shift); camera.position.add(shift);
  }
  easeNorth();
  controls.update();
  renderer.render(scene, camera);
}
const loop = () => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (playing) tNow = (tNow + (dt * HOURS_PER_SEC) / 3) % (NF - 1);
  frame(dt);
  placeLabels();
  turnCompass();
};
$("loading").remove();
renderer.setAnimationLoop(loop);

// ------------------------------------------------------------------------------------------
// Video: the whole forecast from the current viewpoint and layer settings, drawn frame by frame
// at 30 fps with title, time, labels, compass and credit, and encoded in the browser as an MP4
// (WebCodecs, with mp4-muxer to write the file), as the map viewer's Video does.
// ------------------------------------------------------------------------------------------
const VIDEO_FORMATS = { square: [1080, 1080], portrait: [1080, 1350], landscape: [1920, 1080] };
const VIDEO_FPS = 30;
const MUXER_URL = "https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.5/build/mp4-muxer.min.js";
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
let making = false;

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = url; el.onload = resolve; el.onerror = () => reject(new Error(`could not load ${url}`));
    document.head.appendChild(el);
  });
}

function wrap(g, text, width, max) {
  const lines = [];
  let line = "";
  for (const w of String(text).split(/\s+/)) {
    const t = line ? `${line} ${w}` : w;
    if (g.measureText(t).width <= width || !line) line = t; else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines.slice(0, max);
}

// Everything drawn over the 3D picture, in CSS pixels of a (w x h) frame shown at DPR 2.
function drawVideoOverlay(g, w, h) {
  const shadow = (on) => { g.shadowColor = on ? "rgba(0,0,0,0.9)" : "transparent"; g.shadowBlur = on ? 6 : 0; };
  g.textBaseline = "alphabetic";
  // labels in the scene
  for (const l of labels) {
    if (l.show && !l.show()) continue;
    v3.copy(l.getPos()).project(camera);
    if (v3.z > 1 || Math.abs(v3.x) > 1.05 || Math.abs(v3.y) > 1.05) continue;
    const x = ((v3.x + 1) / 2) * w, y = ((1 - v3.y) / 2) * h, cls = l.el.classList;
    const size = cls.contains("cardinal") ? 15 : cls.contains("level") ? 11.5 : 12;
    g.font = `${cls.contains("place") ? 500 : 700} ${size}px ${FONT}`;
    g.fillStyle = cls.contains("eye") ? "#ffd27a" : cls.contains("cardinal") ? (cls.contains("n") ? "#ff8a7a" : "rgba(255,255,255,0.75)")
      : l.el.style.color || "#fff";
    g.textAlign = cls.contains("level") ? "left" : "center";
    shadow(true);
    g.fillText(l.el.textContent, x, cls.contains("cardinal") ? y + size / 3 : y - (cls.contains("place") ? 22 : 4));
    if (cls.contains("place")) { g.fillStyle = "rgba(255,255,255,0.6)"; g.fillRect(x - 0.5, y - 19, 1, 18); }
  }
  shadow(false);
  // title band
  const grad = g.createLinearGradient(0, 0, 0, 110);
  grad.addColorStop(0, "rgba(4,8,16,0.85)"); grad.addColorStop(1, "rgba(4,8,16,0)");
  g.fillStyle = grad; g.fillRect(0, 0, w, 110);
  g.textAlign = "left"; g.fillStyle = "#fff"; g.font = `700 19px ${FONT}`;
  const title = wrap(g, meta.title, w - 120, 2);
  title.forEach((t, i) => g.fillText(t, 16, 32 + i * 24));
  g.font = `500 12.5px ${FONT}`; g.fillStyle = "#b5c2d4";
  g.fillText(`${meta.label} · 3D view`, 16, 32 + title.length * 24);
  // time and credit band
  const gb = g.createLinearGradient(0, h - 90, 0, h);
  gb.addColorStop(0, "rgba(4,8,16,0)"); gb.addColorStop(1, "rgba(4,8,16,0.85)");
  g.fillStyle = gb; g.fillRect(0, h - 90, w, 90);
  const t = timeNow();
  g.fillStyle = "#fff"; g.font = `700 17px ${FONT}`; g.fillText(timeText(t), 16, h - 40);
  g.fillStyle = "#b5c2d4"; g.font = `500 12px ${FONT}`; g.fillText(leadText(t), 16, h - 22);
  g.font = `500 9.5px ${FONT}`; g.fillStyle = "rgba(200,210,225,0.8)";
  g.fillText(`${meta.attribution} Clouds inferred from humidity; heights ×${exag}.`, 16, h - 7);
  // compass
  const cx = w - 40, cy = h - 50, a = controls.getAzimuthalAngle();
  g.save(); g.translate(cx, cy);
  g.fillStyle = "rgba(10,16,28,0.7)"; g.beginPath(); g.arc(0, 0, 24, 0, Math.PI * 2); g.fill();
  g.rotate(a);
  g.fillStyle = "#ff6b5b"; g.beginPath(); g.moveTo(0, -15); g.lineTo(4, 0); g.lineTo(-4, 0); g.fill();
  g.fillStyle = "rgba(255,255,255,0.55)"; g.beginPath(); g.moveTo(0, 15); g.lineTo(4, 0); g.lineTo(-4, 0); g.fill();
  g.font = `700 9px ${FONT}`; g.textAlign = "center";
  for (const [txt, x, y] of [["N", 0, -19], ["E", 19, 0], ["S", 0, 19], ["W", -19, 0]]) {
    g.save(); g.translate(x, y); g.rotate(-a);
    g.fillStyle = txt === "N" ? "#ff6b5b" : "#c9d4e3"; g.fillText(txt, 0, 3.5); g.restore();
  }
  g.restore();
}

async function makeVideo(format) {
  if (making) return;
  making = true;
  const [fw, fh] = VIDEO_FORMATS[format];
  const say = (t) => { $("videoStatus").textContent = t; $("recording").textContent = t; };
  const saved = { t: tNow, playing, high, aspect: camera.aspect };
  setPlaying(false);
  renderer.setAnimationLoop(null);
  $("recording").hidden = false;
  try {
    say("Preparing…");
    if (!window.Mp4Muxer) await loadScript(MUXER_URL);
    const muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: "avc", width: fw, height: fh }, fastStart: "in-memory" });
    let failure = null;
    const encoder = new VideoEncoder({ output: (chunk, m) => muxer.addVideoChunk(chunk, m), error: (e) => { failure = e; } });
    let config = null;
    for (const codec of ["avc1.640032", "avc1.640028", "avc1.4d0032", "avc1.42e032"]) {
      const c = { codec, width: fw, height: fh, bitrate: 10e6, framerate: VIDEO_FPS };
      if ((await VideoEncoder.isConfigSupported(c)).supported) { config = c; break; }
    }
    if (!config) throw new Error("no supported H.264 encoder");
    encoder.configure(config);

    // Render at the video's size, best quality.
    renderer.setPixelRatio(1);
    renderer.setSize(fw, fh, false);
    camera.aspect = fw / fh; camera.updateProjectionMatrix();
    volMat.uniforms.steps.value = 112; volMat.uniforms.lightSteps.value = 4;
    const out = document.createElement("canvas");
    out.width = fw; out.height = fh;
    const g = out.getContext("2d");

    const dt = 1 / VIDEO_FPS, hold = Math.round(1.5 * VIDEO_FPS);
    const total = Math.round(((NF - 1) * 3 / HOURS_PER_SEC) * VIDEO_FPS) + 1 + hold;
    tNow = 0; lastEye = null; inflow.reset(); outflow.reset();
    for (let k = 0; k < 60; k++) frame(dt);           // let the wind trails build up first
    for (let f = 0; f < total; f++) {
      if (failure) throw failure;
      tNow = Math.min(NF - 1 - 1e-6, (f * dt * HOURS_PER_SEC) / 3);
      frame(dt);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(renderer.domElement, 0, 0);
      g.setTransform(2, 0, 0, 2, 0, 0);
      drawVideoOverlay(g, fw / 2, fh / 2);
      const vf = new VideoFrame(out, { timestamp: Math.round((f * 1e6) / VIDEO_FPS), duration: Math.round(1e6 / VIDEO_FPS) });
      encoder.encode(vf, { keyFrame: f % (VIDEO_FPS * 2) === 0 });
      vf.close();
      if (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
      if (f % 10 === 0) { say(`Making the video… ${Math.round((f / total) * 100)}%`); await new Promise((r) => setTimeout(r, 0)); }
    }
    await encoder.flush();
    if (failure) throw failure;
    muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `weather-explorer-3d-${meta.id}-${format}.mp4`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    $("videoStatus").textContent = `Saved ${(blob.size / 1e6).toFixed(1)} MB (${Math.round(total / VIDEO_FPS)} s, ${fw}×${fh}).`;
  } catch (e) {
    console.warn(e);
    $("videoStatus").textContent = "Sorry, the video could not be made in this browser.";
  } finally {
    $("recording").hidden = true;
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    setQuality();
    tNow = saved.t; lastEye = null;
    setPlaying(saved.playing);
    clock.getDelta();
    renderer.setAnimationLoop(loop);
    making = false;
  }
}

if ("VideoEncoder" in window) {
  const panel = $("videoPanel");
  $("video").onclick = (e) => {
    e.stopPropagation();
    if (panel.hidden) {
      $("videoNote").textContent = `The whole forecast (${Math.round(((NF - 1) * 3) / HOURS_PER_SEC + 1.5)} s) from this viewpoint, with the layers and settings you've chosen.`;
      $("videoStatus").textContent = "";
    }
    panel.hidden = !panel.hidden;
  };
  document.addEventListener("click", (e) => { if (!panel.hidden && !e.target.closest("#videoPanel, #video")) panel.hidden = true; });
  for (const b of panel.querySelectorAll("[data-format]")) b.onclick = () => makeVideo(b.dataset.format);
} else {
  $("video").hidden = true;
}
const fsEl = document.documentElement;
if (fsEl.requestFullscreen) {
  $("fullscreen").onclick = () => (document.fullscreenElement ? document.exitFullscreen() : fsEl.requestFullscreen());
} else {
  $("fullscreen").hidden = true;   // iPhone Safari: the page already fills the screen
}
