// Terrain view (prototype): a scene's surface weather draped over the land, seen at a slant, for
// winds shaped by terrain (gap winds, tip jets, katabatics). Terrain heights come from AWS Terrain
// Tiles (Terrarium PNGs, fetched by the browser for the scene's box); the weather is a sample file
// from tools/make_tilt_sample.py (hourly 10 m wind and gusts at 0.25 deg). Nothing is computed on a
// server. Modelled on the Bris NZ terrain explorer: vertex-coloured terrain, gusts blended onto it,
// and ribbon trails moving with the surface wind.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const SAMPLE = params.get("s") || "wahine-cook-strait";
const TILE = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const KM_PER_DEG = 111.32;
const NT = 360;                 // terrain vertices across (about 1.5 km apart for a 6 degree box)
const TRAILS = 1600, L = 14;    // wind trails and points per trail
const TRAIL_KM_S = 9;           // display km a second per m/s of wind, at speed 1
const TRAIL_STEP = 0.06;        // seconds between the points a trail remembers

const [D, LAKES] = await Promise.all([fetch(`samples/${encodeURIComponent(SAMPLE)}.json`).then((r) => r.json()),
  fetch("lakes.json").then((r) => r.json()).catch(() => ({ lakes: [] }))]);
const [W, S, E, N] = D.bbox;
const midLat = (S + N) / 2;
const kmLon = KM_PER_DEG * Math.cos(midLat * Math.PI / 180);
const WIDTH = (E - W) * kmLon, DEPTH = (N - S) * KM_PER_DEG;
const NTX = NT, NTY = Math.round(NT * DEPTH / WIDTH);
const times = D.times.map((t) => new Date(t.replace("Z", ":00Z")).getTime());
$("title").textContent = D.title;
$("sub").textContent = `${D.source} · surface wind, rain, gusts and temperature, hourly · terrain exaggerated`;
$("source").textContent = D.source;
$("credit").textContent = `${D.attribution} Terrain: AWS Terrain Tiles (Mapzen; SRTM, GMTED2010, ETOPO1 and others). Lakes: Natural Earth. `
  + "Weather on a 0.25° grid (about 25 km): sharper terrain does not add forecast detail. Trails show surface wind, not air rising over hills.";

// ---- Terrain heights: Terrarium tiles mosaicked and sampled onto a regular grid --------------
const z = 8, n2 = 2 ** z;
const tx = (lon) => (lon + 180) / 360 * n2 * 256;
const ty = (lat) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n2 * 256; };
const x0 = Math.floor(tx(W) / 256), x1 = Math.floor(tx(E) / 256), y0 = Math.floor(ty(N) / 256), y1 = Math.floor(ty(S) / 256);
const mosaic = new Map();
await Promise.all([...Array(x1 - x0 + 1).keys()].flatMap((i) => [...Array(y1 - y0 + 1).keys()].map(async (j) => {
  const bmp = await createImageBitmap(await (await fetch(TILE(z, x0 + i, y0 + j))).blob());
  const c = new OffscreenCanvas(256, 256), g = c.getContext("2d");
  g.drawImage(bmp, 0, 0);
  mosaic.set(`${x0 + i}/${y0 + j}`, g.getImageData(0, 0, 256, 256).data);
})));
function rawHeight(lon, lat) {
  const px = tx(lon), py = ty(lat), d = mosaic.get(`${Math.floor(px / 256)}/${Math.floor(py / 256)}`);
  if (!d) return 0;
  const k = ((Math.floor(py) % 256) * 256 + (Math.floor(px) % 256)) * 4;
  return d[k] * 256 + d[k + 1] + d[k + 2] / 256 - 32768;   // metres; negative over the sea
}
const H = new Float32Array(NTX * NTY);
for (let j = 0; j < NTY; j++) for (let i = 0; i < NTX; i++) {
  let s = 0;   // a 3 x 3 average takes out single-pixel noise
  for (const dj of [-0.3, 0, 0.3]) for (const di of [-0.3, 0, 0.3])
    s += rawHeight(W + (i + 0.5 + di) / NTX * (E - W), N - (j + 0.5 + dj) / NTY * (N - S));
  H[j * NTX + i] = s / 9;
}

// ---- Scene -----------------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
$("scene").appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color("#07131f");
scene.fog = new THREE.Fog("#07131f", WIDTH * 1.6, WIDTH * 3.2);
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 1, WIDTH * 10);
camera.position.set(-WIDTH * 0.15, WIDTH * 0.55, DEPTH * 0.95);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.maxPolarAngle = Math.PI * 0.47;
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight("#cfe6ff", "#1a2a1a", 1.1));
const sun = new THREE.DirectionalLight("#fff4dc", 1.6);
sun.position.set(-WIDTH, WIDTH * 0.9, -DEPTH * 0.6);
scene.add(sun);

const xOf = (lon) => (lon - W) * kmLon - WIDTH / 2;
const zOf = (lat) => (N - lat) * KM_PER_DEG - DEPTH / 2;
let ex = Number($("ex").value);
const yOf = (h) => Math.max(0, h) / 1000 * ex;

const geo = new THREE.BufferGeometry();
const pos = new Float32Array(NTX * NTY * 3), col = new Float32Array(NTX * NTY * 3), idx = [];
for (let j = 0; j < NTY; j++) for (let i = 0; i < NTX; i++) {
  const k = j * NTX + i;
  pos[k * 3] = (i / (NTX - 1) - 0.5) * WIDTH;
  pos[k * 3 + 2] = (j / (NTY - 1) - 0.5) * DEPTH;
  if (i < NTX - 1 && j < NTY - 1) idx.push(k, k + NTX, k + 1, k + 1, k + NTX, k + NTX + 1);
}
geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
geo.setIndex(idx);
const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.02 }));
scene.add(ground);
function setHeights() {
  for (let k = 0; k < H.length; k++) pos[k * 3 + 1] = yOf(H[k]);
  geo.attributes.position.needsUpdate = true;
  geo.computeVertexNormals();
}
setHeights();

// ---- Colours: terrain by height, gusts blended on top ------------------------------------------
const hex = (s) => { const n = parseInt(s.replace("#", "").padEnd(8, "f"), 16); return [(n >>> 24 & 255) / 255, (n >>> 16 & 255) / 255, (n >>> 8 & 255) / 255, (n & 255) / 255]; };
const TERRAIN = [[0, "#3f5f3a"], [300, "#5e7448"], [800, "#857c5a"], [1500, "#a39a86"], [2200, "#d7d4cf"], [3000, "#ffffff"]].map(([v, c]) => [v, hex(c)]);
const SEA = hex("#0f2c40");
// The viewer's own colours for each layer that can lie on the ground.
const STOPS = Object.fromEntries(Object.entries(D.stops).map(([k, st]) => [k, st.map(([v, c]) => [v, hex(c)])]));
// Temperature uses its own scale fitted to the scene (the map's runs from -40 to 48 deg C, which would
// leave a few degrees of föhn warming invisible), widened for the height adjustment.
{
  let lo = Infinity, hi = -Infinity;
  for (const f of D.frames) for (const v of f.t2m) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  lo = Math.floor(lo - 6); hi = Math.ceil(hi + 1);
  const cols = ["#2b2d84ee", "#2f6fc4ee", "#5fb3d6ee", "#d8eef0dd", "#f6e27aee", "#f4a24aee", "#d9473aee", "#8f1d3aee"];
  D.stops.t2m_local = cols.map((c, i) => [Math.round((lo + (hi - lo) * i / (cols.length - 1)) * 10) / 10, c]);
  STOPS.t2m_local = D.stops.t2m_local.map(([v, c]) => [v, hex(c)]);
}
const LAYER = { rain: "precip", gust: "gust", t2m: "t2m_local" };
function ramp(stops, v) {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) {
    const f = (v - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
    return stops[i - 1][1].map((a, q) => a + (stops[i][1][q] - a) * f);
  }
  return stops[stops.length - 1][1];
}
// The key: the layer's colour stops spaced evenly, labelled with their values.
function key() {
  const mode = $("ground").value, st = D.stops[LAYER[mode]];
  $("keyTitle").textContent = { rain: "Rain (mm/h)", gust: "Gust (km/h)", t2m: "Temperature (°C)", none: "" }[mode];
  $("keyBar").style.background = st ? `linear-gradient(90deg, ${st.map(([, c], i) => `${c.slice(0, 7)} ${(i / (st.length - 1) * 100).toFixed(0)}%`).join(", ")})` : "none";
  $("keyTicks").innerHTML = st ? st.filter((_, i) => i % Math.ceil(st.length / 5) === 0 || i === st.length - 1)
    .map(([v]) => `<span>${mode === "gust" ? Math.round(v * 3.6) : v}</span>`).join("") : "";
  const t = mode === "t2m", adjusted = t && $("adjust").checked;
  $("adjustRow").hidden = $("adjustNote").hidden = !t;
  $("caveat").hidden = !adjusted;
  if (adjusted) $("keyTitle").textContent = "Temperature (°C) · ADJUSTED ESTIMATE";
}
// Lakes (Natural Earth, tools/make_lakes.py): vertices inside a lake's outer ring and outside its
// islands are water. The terrain tiles give heights only, so lakes would otherwise look like land.
const LAKE = hex("#1f5574"), lake = new Uint8Array(NTX * NTY);
function inside(ring, lon, lat) {
  let c = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const [xi, yi, xj, yj] = [ring[i], ring[i + 1], ring[j], ring[j + 1]];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
for (const l of LAKES.lakes) {
  const [lw, ls, le, ln] = l.bbox;
  if (le < W || lw > E || ln < S || ls > N) continue;
  const i0 = Math.max(0, Math.floor((lw - W) / (E - W) * (NTX - 1))), i1 = Math.min(NTX - 1, Math.ceil((le - W) / (E - W) * (NTX - 1)));
  const j0 = Math.max(0, Math.floor((N - ln) / (N - S) * (NTY - 1))), j1 = Math.min(NTY - 1, Math.ceil((N - ls) / (N - S) * (NTY - 1)));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const lon = W + i / (NTX - 1) * (E - W), lat = N - j / (NTY - 1) * (N - S);
    if (inside(l.rings[0], lon, lat) && !l.rings.slice(1).some((r) => inside(r, lon, lat))) lake[j * NTX + i] = 1;
  }
}
const baseCol = new Float32Array(NTX * NTY * 3);   // per-vertex terrain colour, computed once
for (let k = 0; k < H.length; k++) {
  const c = H[k] <= 0 ? SEA : lake[k] ? LAKE : ramp(TERRAIN, H[k]);
  baseCol.set(c.slice(0, 3), k * 3);
}

// ---- Weather: bilinear in space, linear in time -----------------------------------------------
const NX = D.nx, NY = D.ny;
function field(name, f, lon, lat) {
  const fx = Math.min(NX - 1.001, Math.max(0, (lon - W) / D.res)), fy = Math.min(NY - 1.001, Math.max(0, (N - lat) / D.res));
  const i = Math.floor(fx), j = Math.floor(fy), a = fx - i, b = fy - j, arr = f === null ? D[name] : D.frames[f][name];
  return (arr[j * NX + i] * (1 - a) + arr[j * NX + i + 1] * a) * (1 - b) + (arr[(j + 1) * NX + i] * (1 - a) + arr[(j + 1) * NX + i + 1] * a) * b;
}
let pos01 = 0;   // playback position in frames
const at = (name, lon, lat) => {
  const f = Math.min(Math.floor(pos01), D.frames.length - 2), t = pos01 - f;
  return field(name, f, lon, lat) * (1 - t) + field(name, f + 1, lon, lat) * t;
};
const vLon = new Float32Array(NTX), vLat = new Float32Array(NTY);
for (let i = 0; i < NTX; i++) vLon[i] = W + (i / (NTX - 1)) * (E - W);
for (let j = 0; j < NTY; j++) vLat[j] = N - (j / (NTY - 1)) * (N - S);
// ERA5's 2 m temperature belongs to its own smoothed terrain; moved to the detailed terrain at a
// standard lapse rate, a peak is colder and a valley warmer, as they would be.
const LAPSE = -0.0065;   // deg C per m
const orog = new Float32Array(NTX * NTY);
for (let j = 0; j < NTY; j++) for (let i = 0; i < NTX; i++) orog[j * NTX + i] = field("orog", null, vLon[i], vLat[j]);
function paint() {
  const mode = $("ground").value, st = STOPS[LAYER[mode]], adjust = $("adjust").checked;
  for (let j = 0; j < NTY; j++) for (let i = 0; i < NTX; i++) {
    const k = j * NTX + i;
    let r = baseCol[k * 3], g = baseCol[k * 3 + 1], b = baseCol[k * 3 + 2];
    if (st) {
      let v = at(mode, vLon[i], vLat[j]);
      if (mode === "t2m" && adjust) v += LAPSE * (Math.max(0, H[k]) - orog[k]);
      const c = ramp(st, v), a = c[3] * 0.85;
      r += (c[0] - r) * a; g += (c[1] - g) * a; b += (c[2] - b) * a;
    }
    col[k * 3] = r; col[k * 3 + 1] = g; col[k * 3 + 2] = b;
  }
  geo.attributes.color.needsUpdate = true;
}

// ---- Wind trails: flat ribbons lying on the surface, moved by the 10 m wind --------------------
const BANDS = ["#fff3b0", "#ffd12f", "#ff851b", "#ff334f", "#e64dff"].map((c) => new THREE.Color(c));
const band = (kmh) => (kmh >= 120 ? 4 : kmh >= 90 ? 3 : kmh >= 60 ? 2 : kmh >= 30 ? 1 : 0);
const groundH = (lon, lat) => {
  const fi = (lon - W) / (E - W) * (NTX - 1), fj = (N - lat) / (N - S) * (NTY - 1);
  const i = Math.max(0, Math.min(NTX - 1, Math.round(fi))), j = Math.max(0, Math.min(NTY - 1, Math.round(fj)));
  return H[j * NTX + i];
};
const parts = Array.from({ length: TRAILS }, () => ({ lon: 0, lat: 0, age: 0, life: 0, since: 0, pts: [] }));
function respawn(p) {
  p.lon = W + Math.random() * (E - W); p.lat = S + Math.random() * (N - S);
  p.age = 0; p.life = 2 + Math.random() * 3;
  p.pts = Array.from({ length: L }, () => [p.lon, p.lat]);
}
parts.forEach((p) => { respawn(p); p.age = Math.random() * p.life; });
const segs = TRAILS * (L - 1);
const tGeo = new THREE.BufferGeometry();
const tPos = new Float32Array(segs * 4 * 3), tCol = new Float32Array(segs * 4 * 3), tIdx = new Uint32Array(segs * 6);
for (let s = 0; s < segs; s++) tIdx.set([s * 4, s * 4 + 1, s * 4 + 2, s * 4 + 2, s * 4 + 1, s * 4 + 3], s * 6);
tGeo.setAttribute("position", new THREE.BufferAttribute(tPos, 3).setUsage(THREE.DynamicDrawUsage));
tGeo.setAttribute("color", new THREE.BufferAttribute(tCol, 3).setUsage(THREE.DynamicDrawUsage));
tGeo.setIndex(new THREE.BufferAttribute(tIdx, 1));
const trails = new THREE.Mesh(tGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false }));
trails.renderOrder = 2;
scene.add(trails);
function stepTrails(dt) {
  const k = Number($("speed").value) * TRAIL_KM_S;
  for (let n = 0; n < TRAILS; n++) {
    const p = parts[n];
    p.age += dt;
    const u = at("u", p.lon, p.lat), v = at("v", p.lon, p.lat), speed = Math.hypot(u, v);
    p.lon += u * k * dt / kmLon; p.lat += v * k * dt / KM_PER_DEG;
    if (p.age > p.life || p.lon < W || p.lon > E || p.lat < S || p.lat > N) respawn(p);
    p.since += dt;
    if (p.since >= TRAIL_STEP) { p.since = 0; p.pts.pop(); p.pts.unshift([p.lon, p.lat]); } else p.pts[0] = [p.lon, p.lat];
    const c = BANDS[band(speed * 3.6)], w = 0.6 + Math.min(speed, 45) / 45 * 2.4;   // km
    const fadeIn = Math.min(1, p.age / 0.4), fadeOut = Math.min(1, (p.life - p.age) / 0.6);
    for (let q = 0; q < L - 1; q++) {
      const [la, pa] = p.pts[q], [lb, pb] = p.pts[q + 1];
      const ax = xOf(la), az = zOf(pa), bx = xOf(lb), bz = zOf(pb);
      let nx = -(bz - az), nz = bx - ax; const len = Math.hypot(nx, nz) || 1;
      const wq = w * (1 - q / L) / 2; nx = nx / len * wq; nz = nz / len * wq;
      const ay = yOf(groundH(la, pa)) + 0.35 * ex, by = yOf(groundH(lb, pb)) + 0.35 * ex;
      const o = (n * (L - 1) + q) * 12;
      tPos.set([ax + nx, ay, az + nz, ax - nx, ay, az - nz, bx + nx, by, bz + nz, bx - nx, by, bz - nz], o);
      const f = (1 - q / L) * Math.max(0, Math.min(fadeIn, fadeOut));
      for (let r = 0; r < 4; r++) tCol.set([c.r * f, c.g * f, c.b * f], o + r * 3);
    }
  }
  tGeo.attributes.position.needsUpdate = true;
  tGeo.attributes.color.needsUpdate = true;
}

// ---- Place labels ------------------------------------------------------------------------------
const labels = D.places.map((p) => {
  const el = document.createElement("span"); el.textContent = p.label; $("labels").appendChild(el);
  return { el, p };
});
// The mesh's height at display (x, z), on the same two triangles per cell as the mesh.
function meshY(x, z) {
  const fx = (x / WIDTH + 0.5) * (NTX - 1), fz = (z / DEPTH + 0.5) * (NTY - 1);
  if (fx < 0 || fz < 0 || fx >= NTX - 1 || fz >= NTY - 1) return NaN;
  const i = Math.floor(fx), j = Math.floor(fz), a = fx - i, b = fz - j, k = j * NTX + i;
  const h = (q) => yOf(H[q]);
  return a + b <= 1 ? h(k) * (1 - a - b) + h(k + 1) * a + h(k + NTX) * b
    : h(k + 1) * (1 - b) + h(k + NTX) * (1 - a) + h(k + NTX + 1) * (a + b - 1);
}
// A town's dot is hidden when terrain lies between it and the camera, as in the Bris terrain
// explorer: the line of sight can only pass below the surface between the places where it crosses
// a grid line or a cell's diagonal, so checking those points is exact, without raycasting faces.
function terrainBlocks(eye, target) {
  const g = (v) => [(v.x / WIDTH + 0.5) * (NTX - 1), (v.z / DEPTH + 0.5) * (NTY - 1)];
  const [ax, az] = g(eye), [bx, bz] = g(target), cuts = [0, 1];
  for (const [a, b, max] of [[ax, bx, NTX - 1], [az, bz, NTY - 1], [ax + az, bx + bz, NTX + NTY - 2]]) {
    if (Math.abs(b - a) < 1e-10) continue;
    for (let v = Math.max(0, Math.ceil(Math.min(a, b))); v <= Math.min(max, Math.floor(Math.max(a, b))); v++) {
      const t = (v - a) / (b - a);
      if (t > 0 && t < 1) cuts.push(t);
    }
  }
  return cuts.some((t) => {
    const ground = meshY(eye.x + (target.x - eye.x) * t, eye.z + (target.z - eye.z) * t);
    return Number.isFinite(ground) && ground > eye.y + (target.y - eye.y) * t + 0.005;
  });
}
let lastSight = 0;
function placeLabels(now) {
  const check = now - lastSight > 120;   // the sight lines need not be redone every frame
  if (check) lastSight = now;
  for (const l of labels) {
    const dot = new THREE.Vector3(xOf(l.p.lon), meshY(xOf(l.p.lon), zOf(l.p.lat)) + 0.05, zOf(l.p.lat));
    if (check) l.blocked = terrainBlocks(camera.position, dot);
    const v = dot.clone().project(camera);
    l.el.hidden = v.z > 1 || l.blocked;
    l.el.style.left = `${(v.x + 1) / 2 * innerWidth}px`; l.el.style.top = `${(1 - v.y) / 2 * innerHeight}px`;
  }
}

// ---- Time --------------------------------------------------------------------------------------
// Browsers often have no name for a zone in past decades (1968 Wellington is "GMT+12"): use this
// year's name for the same offset there.
function zoneName(d) {
  const name = (dd, loc) => new Intl.DateTimeFormat(loc, { timeZone: D.tz, timeZoneName: "short" }).formatToParts(dd).find((x) => x.type === "timeZoneName").value;
  const n = name(d, "en-NZ");
  if (!/^GMT[+-]/.test(n)) return n;
  const off = name(d, "en-GB"), y = new Date().getUTCFullYear();
  const same = [new Date(Date.UTC(y, 0, 15)), new Date(Date.UTC(y, 6, 15))].find((x) => name(x, "en-GB") === off);
  const m = same && name(same, "en-NZ");
  return m && !/^GMT/.test(m) ? m : n.replace("GMT", "UTC");
}
const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: D.tz, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
function showTime() {
  const t = new Date(times[0] + pos01 * (times[1] - times[0]));
  $("time").textContent = `${fmt.format(t)} ${zoneName(t)}`;
  $("slider").value = String(pos01 / (D.frames.length - 1) * 1000);
}

// ---- Controls and loop -------------------------------------------------------------------------
let playing = true, lastPaint = 0;
$("play").onclick = () => { playing = !playing; $("play").textContent = playing ? "❚❚" : "▶"; };
$("slider").oninput = () => { pos01 = Number($("slider").value) / 1000 * (D.frames.length - 1); paint(); showTime(); };
$("ex").oninput = () => { ex = Number($("ex").value); $("exLabel").textContent = `${ex}×`; setHeights(); };
$("speed").oninput = () => { $("speedLabel").textContent = `${$("speed").value} h/s`; };
$("ground").onchange = () => { key(); paint(); };
$("adjust").onchange = () => { key(); paint(); };
addEventListener("resize", () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
const clock = new THREE.Clock();
key(); paint(); showTime();
$("loading").remove();
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta()), now = performance.now();
  if (playing) {
    pos01 += dt * Number($("speed").value);
    if (pos01 >= D.frames.length - 1) pos01 = 0;
    if (now - lastPaint > 100) { paint(); lastPaint = now; }
    showTime();
  }
  stepTrails(dt);
  controls.update();
  renderer.render(scene, camera);
  placeLabels(now);
});

