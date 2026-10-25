// Weather Explorer web viewer: plays the current highlights from static files.
//
// Everything is drawn in the browser: the colour fill on the GPU (WebGL2), isobars, highs and
// lows in a worker, wind particles on a canvas. The server only provides files.
//
// The same script runs a saved copy (save.js builds one): a single HTML file that sets
// window.WEATHER_OFFLINE with every file it needs, so it plays with no connection.

// Each deploy stamps its release into the file names (?v=…), so a browser never mixes a new page
// with old cached scripts. "dev" when run locally.
const VERSION = "dev";
const Units = window.Units;
const OFFLINE = window.WEATHER_OFFLINE || null;

const $ = (s) => document.querySelector(s);
const DATA = "data/";

// A file's URL: from the site, or, in a saved copy, from the data embedded in the page.
const blobUrls = new Map();
const MIME = { webp: "image/webp", json: "application/json", js: "text/javascript" };
function fileUrl(path) {
  if (!OFFLINE) return path;
  if (!blobUrls.has(path)) {
    const b64 = OFFLINE.files[path];
    if (b64 === undefined) return `missing:${path}`;
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    blobUrls.set(path, URL.createObjectURL(new Blob([bytes], { type: MIME[path.split(".").pop()] || "" })));
  }
  return blobUrls.get(path);
}
const dataUrl = (path) => fileUrl(DATA + path);

// What the worker should decode for a frame: its URL, or in a saved copy the bytes themselves.
function frameSource(path) {
  if (!OFFLINE) return DATA + path;
  const bin = atob(OFFLINE.files[DATA + path] || "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { path, bytes };
}
const SPEEDS = [0.5, 1, 2, 4];
const FEED_REFRESH_MS = 10 * 60 * 1000;
const DEG = Math.PI / 180;

const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + Math.max(-85, Math.min(85, lat)) * DEG / 2)) / DEG;
const invMercY = (y) => (2 * Math.atan(Math.exp(y * DEG)) - Math.PI / 2) / DEG;
const parseTime = (s) => new Date(s);     // "2026-10-25T09:00Z" is valid ISO 8601

// ------------------------------------------------------------------------------------------
// State
// ------------------------------------------------------------------------------------------

const S = {
  feed: null,
  entries: [],          // [{key, item, requested}]
  entry: null,
  sceneIndex: 0,
  meta: null,           // the package's meta.json
  pkg: "",
  fill: [],             // per frame: {tex, data} once loaded
  uv: [],               // per frame: Uint8Array of u/v pairs
  contour: null,        // {segs, levels, centres, key}
  tracked: [],          // contour labels on screen, in grid units: [{gx, gy, v}]
  pos: 0,
  playing: false,
  speed: 1,
  view: null,           // {cx, cy, s}: centre in (lon, mercY) and pixels per degree
  token: 0,             // bumps on every scene load, to ignore stale results
};

// ------------------------------------------------------------------------------------------
// Worker
// ------------------------------------------------------------------------------------------

// A saved copy starts the worker from its embedded source; if the browser won't run a worker
// from a local file, the same code runs on the page instead (slower, but it works).
function inPageWorker() {
  let reply = null;
  const self = { postMessage: (data) => setTimeout(() => reply?.({ data })), onmessage: null };
  new Function("self", OFFLINE.worker)(self);
  return { postMessage: (data) => self.onmessage({ data }), set onmessage(f) { reply = f; } };
}
function startWorker() {
  if (!OFFLINE) return new Worker(`worker.js?v=${VERSION}`);
  let real;
  try {
    real = new Worker(URL.createObjectURL(new Blob([OFFLINE.worker], { type: "text/javascript" })));
  } catch {
    return inPageWorker();
  }
  // Some browsers refuse it only once it starts: then switch over and resend what was asked.
  let target = real, handler = null, answered = false;
  const sent = [];
  real.onmessage = (e) => { answered = true; handler?.(e); };
  real.onerror = () => {
    if (answered || target !== real) return;
    target = inPageWorker();
    target.onmessage = handler;
    for (const m of sent) target.postMessage(m);
  };
  return {
    postMessage: (m) => { if (!answered) sent.push(m); target.postMessage(m); },
    set onmessage(f) { handler = f; if (target !== real) target.onmessage = f; },
  };
}
const worker = startWorker();
let nextId = 1;
const pending = new Map();
worker.onmessage = ({ data }) => {
  const p = pending.get(data.id);
  if (!p) return;
  pending.delete(data.id);
  data.error ? p.reject(new Error(data.error)) : p.resolve(data);
};
function ask(msg) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id });
  });
}

// ------------------------------------------------------------------------------------------
// Canvases
// ------------------------------------------------------------------------------------------

const mapEl = $("#map");
const base = $("#base"), field = $("#field"), overlay = $("#overlay"), particles = $("#particles");
let W = 0, H = 0, DPR = 1;

function resize() {
  const r = mapEl.getBoundingClientRect();
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = r.width; H = r.height;
  for (const c of [base, field, overlay, particles]) {
    c.width = Math.round(W * DPR);
    c.height = Math.round(H * DPR);
  }
  // Keep the scene fitted until the viewer pans or zooms.
  if (S.entry && (!S.view || !S.view.touched)) fit();
  drawAll();
}

// World (lon, mercY) <-> screen (CSS pixels).
function toScreen(lon, y) {
  const v = S.view;
  return [(lon - v.cx) * v.s + W / 2, (v.cy - y) * v.s + H / 2];
}
function toWorld(px, py) {
  const v = S.view;
  return [v.cx + (px - W / 2) / v.s, v.cy - (py - H / 2) / v.s];
}

function sceneBox() {
  const sc = S.entry.item.scenes[S.sceneIndex];
  let [w, s, e, n] = sc.bbox;
  if (e <= w) e += 360;
  return { w, s, e, n };
}

function fit() {
  if (!W || !H) {
    const r = mapEl.getBoundingClientRect();
    W = r.width; H = r.height;
  }
  const b = sceneBox();
  const y0 = mercY(b.s), y1 = mercY(b.n);
  const s = Math.min(W / (b.e - b.w), H / (y1 - y0)) * 0.94;
  S.view = { cx: (b.w + b.e) / 2, cy: (y0 + y1) / 2, s, fit: s };
}

// ------------------------------------------------------------------------------------------
// Basemap: Natural Earth land and borders, drawn in the same Mercator as the data
// ------------------------------------------------------------------------------------------

let basemap = null;
fetch(fileUrl("basemap.json")).then((r) => r.json()).then((j) => {
  const decode = (arr) => {
    const out = new Float32Array(arr.length);
    let x = 0, y = 0;
    for (let i = 0; i < arr.length; i += 2) {
      x += arr[i]; y += arr[i + 1];
      out[i] = x / j.scale;
      out[i + 1] = mercY(y / j.scale);
    }
    return out;
  };
  basemap = { land: j.land.map(decode), borders: j.borders.map(decode) };
  drawBase();
}).catch(() => {});

// Map styles, as in the app. Satellite uses NASA's Blue Marble imagery from GIBS (public domain,
// no key), in the same Web Mercator tiling as the data.
const MAP_STYLES = {
  dark: { ocean: "#0d1923", land: "#1b2731", coast: "rgba(170,190,205,0.55)", border: "rgba(170,190,205,0.28)",
          line: "rgba(255,255,255,0.78)", streak: "rgba(255,255,255,0.75)" },
  light: { ocean: "#c4d3de", land: "#eceee8", coast: "rgba(70,85,100,0.6)", border: "rgba(70,85,100,0.35)",
           line: "rgba(20,30,40,0.78)", streak: "rgba(20,30,40,0.7)" },
  satellite: { ocean: "#08131f", land: null, coast: "rgba(255,255,255,0.35)", border: "rgba(255,255,255,0.28)",
               line: "rgba(255,255,255,0.85)", streak: "rgba(255,255,255,0.8)",
               tiles: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg",
               maxZoom: 8, credit: "Imagery: NASA Blue Marble (GIBS)" },
};
const STYLE_KEY = "weather-explorer-map";
let mapStyle = "dark";
try { mapStyle = MAP_STYLES[localStorage.getItem(STYLE_KEY)] ? localStorage.getItem(STYLE_KEY) : "dark"; } catch { /* default */ }
const style = () => MAP_STYLES[mapStyle];

const tiles = new Map();
let tileRedraw = 0;
function tile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  let t = tiles.get(key);
  if (!t) {
    t = new Image();
    t.decoding = "async";
    t.onload = () => { if (!tileRedraw) tileRedraw = requestAnimationFrame(() => { tileRedraw = 0; drawBase(); }); };
    t.src = style().tiles.replace("{z}", z).replace("{x}", x).replace("{y}", y);
    tiles.set(key, t);
    if (tiles.size > 400) tiles.delete(tiles.keys().next().value);
  }
  return t.complete && t.naturalWidth ? t : null;
}

function drawTiles(g, st) {
  // Tiles where 1 tile pixel is about 1 screen pixel; a coarser tile fills in until it loads.
  const z = Math.max(0, Math.min(st.maxZoom, Math.ceil(Math.log2(S.view.s * DPR * 360 / 256))));
  const draw = (zz) => {
    const n = 2 ** zz;
    const [lonL, yT] = toWorld(0, 0), [lonR, yB] = toWorld(W, H);
    const tx0 = Math.floor((lonL + 180) / 360 * n), tx1 = Math.floor((lonR + 180) / 360 * n);
    const ty0 = Math.max(0, Math.floor((180 - yT) / 360 * n)), ty1 = Math.min(n - 1, Math.floor((180 - yB) / 360 * n));
    let missing = false;
    for (let tx = tx0; tx <= tx1; tx++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        const img = tile(zz, ((tx % n) + n) % n, ty);
        if (!img) { missing = true; continue; }
        const [x0, y0] = toScreen(tx / n * 360 - 180, 180 - ty / n * 360);
        const [x1, y1] = toScreen((tx + 1) / n * 360 - 180, 180 - (ty + 1) / n * 360);
        g.drawImage(img, x0, y0, x1 - x0 + 0.5, y1 - y0 + 0.5);
      }
    }
    return missing;
  };
  if (z > 2) draw(Math.max(0, z - 3));
  draw(z);
}

function drawBase() {
  const g = base.getContext("2d");
  const st = style();
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.fillStyle = st.ocean;
  g.fillRect(0, 0, W, H);
  if (!S.view) return;
  if (st.tiles) drawTiles(g, st);
  if (!basemap) return;
  const [lonL] = toWorld(0, 0), [lonR] = toWorld(W, 0);
  const shifts = [-360, 0, 360].filter((k) => lonR >= -180 + k && lonL <= 180 + k);
  const path = (arrs, close) => {
    g.beginPath();
    for (const k of shifts) {
      for (const a of arrs) {
        for (let i = 0; i < a.length; i += 2) {
          const [x, y] = toScreen(a[i] + k, a[i + 1]);
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        if (close) g.closePath();
      }
    }
  };
  path(basemap.land, true);
  if (st.land) {
    g.fillStyle = st.land;
    g.fill("evenodd");
  }
  g.lineWidth = 0.8;
  g.strokeStyle = st.coast;
  g.stroke();
  path(basemap.borders, false);
  g.lineWidth = 0.6;
  g.strokeStyle = st.border;
  g.stroke();
}

// ------------------------------------------------------------------------------------------
// Colour fill (WebGL2)
// ------------------------------------------------------------------------------------------

const gl = field.getContext("webgl2", { premultipliedAlpha: true, antialias: false });
let prog = null, lutTex = null, quad = null;

function setupGL() {
  if (!gl) return;
  const vs = `#version 300 es
    in vec2 p; uniform vec4 rect; out vec2 uv;
    void main() { uv = p; vec2 c = rect.xy + p * rect.zw; gl_Position = vec4(c.x, -c.y, 0.0, 1.0); }`;
  const fs = `#version 300 es
    precision highp float;
    in vec2 uv; out vec4 o;
    uniform sampler2D A, B, LUT;
    uniform float mixT, lo, hi, rlo, rhi, sq;
    void main() {
      float a = texture(A, uv).r, b = texture(B, uv).r;
      if (a > 0.997 || b > 0.997) discard;
      float t = mix(a, b, mixT) * 255.0 / 254.0;
      if (sq > 0.5) t = t * t;
      float v = lo + (hi - lo) * t;
      float k = clamp((v - rlo) / (rhi - rlo), 0.0, 1.0);
      vec4 c = texture(LUT, vec2(k * 255.0 / 256.0 + 0.5 / 256.0, 0.5));
      o = vec4(c.rgb * c.a, c.a);
    }`;
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
}

function parseColour(hex) {
  let h = hex.replace("#", "");
  if (h.length === 6) h += "ff";
  const n = parseInt(h, 16);
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

function rampSample(stops, v) {
  const s = stops.map(([value, c]) => [value, parseColour(c)]).sort((a, b) => a[0] - b[0]);
  if (v <= s[0][0]) return s[0][1];
  if (v >= s[s.length - 1][0]) return s[s.length - 1][1];
  for (let i = 1; i < s.length; i++) {
    if (v <= s[i][0]) {
      const t = (v - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
      return s[i - 1][1].map((x, k) => x + (s[i][1][k] - x) * t);
    }
  }
  return s[s.length - 1][1];
}

function makeLUT(stops) {
  const lo = Math.min(...stops.map((s) => s[0])), hi = Math.max(...stops.map((s) => s[0]));
  const px = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const c = rampSample(stops, lo + (hi - lo) * i / 255);
    px.set(c.map(Math.round), i * 4);
  }
  if (gl) {
    if (!lutTex) lutTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, lutTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  return { lo, hi };
}

function frameTexture(data, nx, ny) {
  if (!gl) return null;
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, nx, ny, 0, gl.RED, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

// The two loaded frames either side of the position, and the blend between them.
function bracket(list, pos) {
  const n = list.length;
  if (!n) return null;
  let i = Math.max(0, Math.min(n - 1, Math.floor(pos)));
  let j = Math.min(n - 1, i + 1);
  let t = Math.max(0, Math.min(1, pos - i));
  while (i > 0 && !list[i]) i--;
  if (!list[i]) return null;
  if (!list[j]) { j = i; t = 0; }
  return { i, j, t };
}

function drawField() {
  if (!gl || !prog) return;
  gl.viewport(0, 0, field.width, field.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const m = S.meta?.fill;
  const br = m && bracket(S.fill, S.pos);
  if (!br) return;
  const b = m.box;
  const east = b.east <= b.west ? b.east + 360 : b.east;
  const [x0, y0] = toScreen(b.west, mercY(b.north));
  const [x1, y1] = toScreen(east, mercY(b.south));
  gl.useProgram(prog);
  gl.uniform4f(gl.getUniformLocation(prog, "rect"), x0 / W * 2 - 1, y0 / H * 2 - 1, (x1 - x0) / W * 2, (y1 - y0) / H * 2);
  const tex = (unit, t, name) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(gl.getUniformLocation(prog, name), unit);
  };
  tex(0, S.fill[br.i].tex, "A");
  tex(1, S.fill[br.j].tex, "B");
  tex(2, lutTex, "LUT");
  const u = (n, v) => gl.uniform1f(gl.getUniformLocation(prog, n), v);
  u("mixT", br.t); u("lo", m.lo); u("hi", m.hi); u("rlo", S.ramp.lo); u("rhi", S.ramp.hi);
  u("sq", m.scale === "sqrt" ? 1 : 0);
  const loc = gl.getAttribLocation(prog, "p");
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// ------------------------------------------------------------------------------------------
// Overlay: isobars, highs and lows, focus places
// ------------------------------------------------------------------------------------------

function gridToScreen(meta, gx, gy) {
  const b = meta.box;
  const east = b.east <= b.west ? b.east + 360 : b.east;
  const yN = mercY(b.north), yS = mercY(b.south);
  return toScreen(b.west + (east - b.west) * gx / meta.nx, yN + (yS - yN) * gy / meta.ny);
}

function contourMeta() {
  const m = S.meta;
  if (m?.contours?.contour_interval) return { meta: m.contours, role: "contours" };
  if (m?.fill?.contour_interval) return { meta: m.fill, role: "fill" };
  return null;
}

function drawOverlay() {
  const g = overlay.getContext("2d");
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.clearRect(0, 0, W, H);
  if (!S.view || !S.meta) return;
  const cm = contourMeta();
  const c = S.contour;
  const placed = [];
  if (cm && c) {
    const segs = c.segs;
    g.beginPath();
    for (let k = 0; k < segs.length; k += 4) {
      const [ax, ay] = gridToScreen(cm.meta, segs[k], segs[k + 1]);
      const [bx, by] = gridToScreen(cm.meta, segs[k + 2], segs[k + 3]);
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
    }
    g.strokeStyle = style().line;
    g.lineWidth = 1.1;
    g.stroke();

    // Highs and lows.
    for (const e of c.centres) {
      const [x, y] = gridToScreen(cm.meta, e.x, e.y);
      if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
      placed.push([x, y]);
      g.textAlign = "center";
      g.shadowColor = "rgba(0,0,0,0.85)";
      g.shadowBlur = 4;
      g.fillStyle = e.high ? "#6bb3ff" : "#ff615c";
      g.font = "800 22px -apple-system, system-ui, sans-serif";
      g.fillText(e.high ? "H" : "L", x, y + 4);
      g.fillStyle = "#fff";
      g.font = "600 10.5px ui-monospace, SFMono-Regular, Menlo, monospace";
      g.fillText(String(Math.round(e.value)), x, y + 17);
      g.shadowBlur = 0;
    }

    // A few contour values, spread out and clear of the centres. As in the app, labels already
    // showing follow their contour to its nearest point, so they glide rather than jump; one is
    // dropped only if its contour has gone or it runs into an edge, a centre or another label.
    const gap = Math.max(140, Math.min(W, H) / 3.2), maxLabels = W > 700 ? 12 : 7;
    const labels = [];
    const label = (k) => {
      const gx = (segs[k] + segs[k + 2]) / 2, gy = (segs[k + 1] + segs[k + 3]) / 2;
      const [x, y] = gridToScreen(cm.meta, gx, gy);
      const [ax, ay] = gridToScreen(cm.meta, segs[k], segs[k + 1]);
      const [bx, by] = gridToScreen(cm.meta, segs[k + 2], segs[k + 3]);
      return { x, y, gx, gy, a: Math.atan2(by - ay, bx - ax), v: c.levels[k / 4] };
    };
    const fits = (p, minGap) => p.x >= 30 && p.y >= 60 && p.x <= W - 30 && p.y <= H - 50
      && !placed.some(([x, y]) => Math.hypot(x - p.x, y - p.y) < 60)
      && !labels.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < minGap);
    const radius = Math.max(2, Math.min(cm.meta.nx, cm.meta.ny) / 25);
    for (const t of S.tracked) {
      let best = -1, bd = radius * radius;
      for (let k = 0; k < segs.length; k += 4) {
        if (c.levels[k / 4] !== t.v) continue;
        const dx = (segs[k] + segs[k + 2]) / 2 - t.gx, dy = (segs[k + 1] + segs[k + 3]) / 2 - t.gy;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = k; }
      }
      if (best < 0) continue;
      const p = label(best);
      if (fits(p, gap * 0.6)) labels.push(p);
    }
    // Then new ones, if there's room, from a fixed pseudo-random order.
    const step = Math.max(1, Math.floor(segs.length / 4 / 400));
    const cands = [];
    for (let k = 0, n = 0; k < segs.length; k += 4 * step, n++) cands.push({ k, h: (n * 2654435761) >>> 0 });
    cands.sort((p, q) => p.h - q.h);
    for (const { k } of cands) {
      if (labels.length >= maxLabels) break;
      const p = label(k);
      if (fits(p, gap)) labels.push(p);
    }
    S.tracked = labels.map((p) => ({ gx: p.gx, gy: p.gy, v: p.v }));
    g.font = "600 10.5px ui-monospace, SFMono-Regular, Menlo, monospace";
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const p of labels) {
      let a = p.a;
      if (a > Math.PI / 2) a -= Math.PI; else if (a < -Math.PI / 2) a += Math.PI;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(a);
      g.lineWidth = 3;
      g.strokeStyle = "rgba(0,0,0,0.75)";
      g.strokeText(String(Math.round(p.v)), 0, 0);
      g.fillStyle = "rgba(255,255,255,0.95)";
      g.fillText(String(Math.round(p.v)), 0, 0);
      g.restore();
    }
    g.textBaseline = "alphabetic";
  }

  // Focus places.
  const sc = S.entry.item.scenes[S.sceneIndex];
  g.font = "600 12px -apple-system, system-ui, sans-serif";
  g.textAlign = "left";
  for (const f of sc.focus || []) {
    let lon = f.lon;
    const b = sceneBox();
    while (lon < b.w - 180) lon += 360;
    while (lon > b.e + 180) lon -= 360;
    const [x, y] = toScreen(lon, mercY(f.lat));
    if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue;
    g.beginPath();
    g.arc(x, y, 4, 0, 2 * Math.PI);
    g.fillStyle = "#ffffff";
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = "#0b1218";
    g.stroke();
    g.lineWidth = 3;
    g.strokeStyle = "rgba(0,0,0,0.7)";
    g.strokeText(f.label, x + 8, y + 4);
    g.fillStyle = "#fff";
    g.fillText(f.label, x + 8, y + 4);
  }
}

let contourBusy = false, contourWant = null;
function updateContours() {
  const cm = contourMeta();
  if (!cm) { S.contour = null; return; }
  const list = cm.role === "fill" ? S.fill : S.contourFrames;
  const br = bracket(list, S.pos);
  if (!br) return;
  const q = Math.round(br.t * 4) / 4;
  const key = `${S.token}:${br.i}:${br.j}:${q}`;
  if (S.contour?.key === key || contourWant?.key === key) return;
  contourWant = { key, br, q, cm, token: S.token };
  if (!contourBusy) runContours();
}
async function runContours() {
  const w = contourWant;
  if (!w) return;
  contourWant = null;
  contourBusy = true;
  const src = (i) => frameSource(`${S.pkg}/${w.cm.role}/${String(i).padStart(3, "0")}.c12.webp`);
  try {
    const r = await ask({ type: "contours", srcA: src(w.br.i), srcB: src(w.br.j), q: w.q, centres: w.cm.meta.layer === "mslp",
      top: 4095,
      meta: { nx: w.cm.meta.nx, ny: w.cm.meta.ny, lo: w.cm.meta.lo, hi: w.cm.meta.hi,
              contour_interval: w.cm.meta.contour_interval } });
    if (w.token === S.token) {
      S.contour = { key: w.key, segs: r.segs, levels: r.levels, centres: r.centres };
      drawOverlay();
    }
  } catch (e) { /* the frame will be retried when it loads */ }
  contourBusy = false;
  if (contourWant) runContours();
}

// ------------------------------------------------------------------------------------------
// Wind particles
// ------------------------------------------------------------------------------------------

let parts = [];
function vectorMeta() {
  const m = S.meta;
  for (const role of ["vectors", "fill", "contours"]) if (m?.[role]?.vectors) return { meta: m[role], role };
  return null;
}
function windAt(vm, br, x, y) {
  // Screen point -> fraction of the vector grid, then bilinear u/v blended between two frames.
  const m = vm.meta, b = m.box, east = b.east <= b.west ? b.east + 360 : b.east;
  const [lon, my] = toWorld(x, y);
  const fx = (lon - b.west) / (east - b.west), fy = (mercY(b.north) - my) / (mercY(b.north) - mercY(b.south));
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
  const nx = m.vectors.nx, ny = m.vectors.ny;
  const gx = Math.min(nx - 1.001, Math.max(0, fx * nx - 0.5)), gy = Math.min(ny - 1.001, Math.max(0, fy * ny - 0.5));
  const i = Math.floor(gx), j = Math.floor(gy), tx = gx - i, ty = gy - j;
  const span = m.vectors.hi - m.vectors.lo;
  const sample = (d, c) => {
    const at = (ii, jj) => d[(jj * nx + ii) * 2 + c];
    const v = at(i, j) * (1 - tx) * (1 - ty) + at(i + 1, j) * tx * (1 - ty) + at(i, j + 1) * (1 - tx) * ty + at(i + 1, j + 1) * tx * ty;
    return m.vectors.lo + span * v / 254;
  };
  const A = S.uv[br.i], B = S.uv[br.j];
  return [sample(A, 0) * (1 - br.t) + sample(B, 0) * br.t, sample(A, 1) * (1 - br.t) + sample(B, 1) * br.t];
}
function stepParticles() {
  const g = particles.getContext("2d");
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  const vm = vectorMeta();
  const br = vm && bracket(S.uv, S.pos);
  if (!br) { g.clearRect(0, 0, W, H); return; }
  g.globalCompositeOperation = "destination-in";
  g.fillStyle = "rgba(0,0,0,0.9)";
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = "source-over";
  const want = Math.round(Math.min(2500, W * H / 450));
  while (parts.length < want) parts.push({ x: Math.random() * W, y: Math.random() * H, age: Math.random() * 80 | 0, life: 40 + Math.random() * 60 | 0 });
  parts.length = want;
  const ref = vm.meta.layer === "jet250" ? 70 : 22;
  g.strokeStyle = style().streak;
  g.lineWidth = 1;
  g.beginPath();
  for (const p of parts) {
    const w = windAt(vm, br, p.x, p.y);
    if (!w || ++p.age > p.life) {
      p.x = Math.random() * W; p.y = Math.random() * H; p.age = 0;
      continue;
    }
    const k = 2.2 / ref * Math.min(2.5, Math.sqrt(S.view.s / S.view.fit));
    const nx = p.x + w[0] * k * 3, ny = p.y - w[1] * k * 3;
    g.moveTo(p.x, p.y);
    g.lineTo(nx, ny);
    p.x = nx; p.y = ny;
  }
  g.stroke();
}

// ------------------------------------------------------------------------------------------
// Loading a scene
// ------------------------------------------------------------------------------------------

function frameSrc(role, i, uv) {
  return frameSource(`${S.pkg}/${role}/${String(i).padStart(3, "0")}${uv ? ".uv" : ""}.webp`);
}

// opts (from a shared link): time = the valid time to show, paused; view = {lon, lat, z}.
async function loadScene(entry, sceneIndex, opts = {}) {
  const token = ++S.token;
  S.entry = entry;
  S.sceneIndex = sceneIndex;
  const scene = entry.item.scenes[sceneIndex];
  S.pkg = scene.package;
  S.meta = null;
  S.fill = []; S.uv = []; S.contourFrames = []; S.contour = null; S.tracked = []; parts = [];
  S.pos = 0;
  worker.postMessage({ type: "reset" });
  renderList();
  renderScenes();
  renderDetails();
  status("Loading…");
  S.view = null;
  const meta = await fetch(dataUrl(`${S.pkg}/meta.json`)).then((r) => r.json());
  if (token !== S.token) return;
  S.meta = meta;
  S.ramp = makeLUT(meta.fill.stops);
  fit();
  if (opts.view) {
    S.view = { ...S.view, cx: opts.view.lon, cy: mercY(opts.view.lat), s: S.view.fit * opts.view.z, touched: true };
  }
  // A shared moment: the nearest frame, shown paused.
  let first = 0;
  if (opts.time) {
    const want = parseTime(opts.time).getTime();
    meta.fill.frames.forEach((f, i) => {
      if (Math.abs(parseTime(f.valid_time) - want) < Math.abs(parseTime(meta.fill.frames[first].valid_time) - want)) first = i;
    });
    S.pos = first;
  }
  renderLegend();
  setupTimeline();
  drawAll();

  // Frames: the one to show first straight away, then the rest in order, a few at a time.
  const n = meta.fill.frames.length;
  const vm = vectorMeta();
  const cm = contourMeta();
  const jobs = [];
  for (let i = 0; i < n; i++) {
    jobs.push(async () => {
      const r = await ask({ type: "frame", src: frameSrc("fill", i), channels: 1 });
      if (token !== S.token) return;
      S.fill[i] = { data: r.data, tex: frameTexture(r.data, meta.fill.nx, meta.fill.ny) };
      if (vm) {
        const u = await ask({ type: "frame", src: frameSrc(vm.role, i, true), channels: 2 });
        if (token !== S.token) return;
        S.uv[i] = u.data;
      }
      if (cm && cm.role === "contours") S.contourFrames[i] = true;
      markLoaded(i);
      if (i === first) { status(null); frameChanged(); drawAll(); }
    });
  }
  const order = [first, ...jobs.keys()].filter((i, k, a) => a.indexOf(i) === k);
  let next = 1;
  const run = async () => {
    while (next < order.length && token === S.token) {
      const job = jobs[order[next++]];
      try { await job(); } catch (e) { console.warn(e); }
    }
  };
  await jobs[first]().catch((e) => { status("This scene could not be loaded."); console.warn(e); });
  await Promise.all([run(), run(), run(), run()]);
  if (token === S.token && !S.playing && S.fill.length && !opts.time) play(true);
}

function status(text) {
  const el = $("#status");
  el.hidden = !text;
  el.textContent = text || "";
}

// ------------------------------------------------------------------------------------------
// Timeline and playback
// ------------------------------------------------------------------------------------------

const scrub = $("#scrub");
function setupTimeline() {
  const n = S.meta.fill.frames.length;
  scrub.max = String(Math.max(0, n - 1));
  scrub.value = "0";
  const ticks = $("#ticks");
  ticks.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const t = document.createElement("i");
    t.style.left = n > 1 ? `calc(${(i / (n - 1)) * 100}% - 0.5px)` : "0";
    ticks.appendChild(t);
  }
  updateTime();
}
function markLoaded(i) {
  $("#ticks").children[i]?.classList.add("loaded");
}

function updateTime() {
  const fr = S.meta?.fill.frames;
  if (!fr?.length) return;
  const i = Math.round(S.pos);
  const f = fr[Math.max(0, Math.min(fr.length - 1, i))];
  const valid = parseTime(f.valid_time);
  const run = f.run ? parseTime(f.run) : null;
  const lead = run ? Math.round((valid - run) / 3.6e6) : null;
  const runText = run ? `${String(run.getUTCHours()).padStart(2, "0")} UTC run` : "";
  const tag = lead === null ? "" : lead <= 0 ? `analysis, ${runText}` : `T+${lead} h, ${runText}`;
  $("#when").innerHTML = `${esc(Units.formatTime(valid))}<small>${tag}</small>`;
  scrub.value = String(S.pos);

  // Caption: the latest one whose time has passed.
  const sc = S.entry.item.scenes[S.sceneIndex];
  const t = timeAt(S.pos);
  const cap = (sc.captions || []).filter((c) => parseTime(c.at) <= t).pop();
  const el = $("#caption");
  el.hidden = !cap;
  el.textContent = cap ? loc(cap.text) : "";
}
function timeAt(pos) {
  const fr = S.meta.fill.frames;
  const i = Math.max(0, Math.min(fr.length - 1, Math.floor(pos)));
  const j = Math.min(fr.length - 1, i + 1);
  const a = parseTime(fr[i].valid_time).getTime(), b = parseTime(fr[j].valid_time).getTime();
  return new Date(a + (b - a) * Math.max(0, Math.min(1, pos - i)));
}

function play(on) {
  S.playing = on;
  $("#play").textContent = on ? "❚❚" : "▶";
  $("#play").setAttribute("aria-label", on ? "Pause" : "Play");
}
$("#play").onclick = () => {
  if (!S.meta) return;
  if (!S.playing && S.pos >= S.meta.fill.frames.length - 1) S.pos = 0;
  play(!S.playing);
};
$("#speed").onclick = () => {
  S.speed = SPEEDS[(SPEEDS.indexOf(S.speed) + 1) % SPEEDS.length];
  $("#speed").textContent = S.speed < 1 ? "½×" : `${S.speed}×`;
};
scrub.oninput = () => {
  S.pos = parseFloat(scrub.value);
  play(false);
  frameChanged();
};

function frameChanged() {
  updateTime();
  drawField();
  updateContours();
}

let last = performance.now();
function tick(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (S.playing && S.meta) {
    const n = S.meta.fill.frames.length;
    const next = Math.min(n - 1, S.pos + dt * S.speed);
    // Wait for frames that haven't arrived yet rather than skipping them.
    if (S.fill[Math.min(n - 1, Math.ceil(next))]) {
      S.pos = next;
      frameChanged();
      status(null);
    } else {
      status("Loading frames…");
    }
    // Hold the last frame for a moment, then loop.
    if (S.pos >= n - 1) {
      S.held = (S.held || 0) + dt;
      if (S.held > 1.5) { S.held = 0; S.pos = 0; frameChanged(); }
    }
  }
  stepParticles();
  requestAnimationFrame(tick);
}

// ------------------------------------------------------------------------------------------
// Pan, zoom and click readout
// ------------------------------------------------------------------------------------------

const pointers = new Map();
let dragStart = null, moved = false;
mapEl.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".zoom")) return;
  mapEl.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
  dragStart = { x: e.offsetX, y: e.offsetY };
  moved = false;
  mapEl.classList.add("dragging");
});
mapEl.addEventListener("pointermove", (e) => {
  if (!pointers.has(e.pointerId) || !S.view) return;
  const prev = pointers.get(e.pointerId);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const before = Math.hypot(a[0] - b[0], a[1] - b[1]);
    pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
    const [c, d] = [...pointers.values()];
    const after = Math.hypot(c[0] - d[0], c[1] - d[1]);
    if (before > 0) zoomAt((c[0] + d[0]) / 2, (c[1] + d[1]) / 2, after / before);
    moved = true;
    return;
  }
  pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
  if (Math.hypot(e.offsetX - dragStart.x, e.offsetY - dragStart.y) > 4) moved = true;
  S.view.cx -= (e.offsetX - prev[0]) / S.view.s;
  S.view.cy += (e.offsetY - prev[1]) / S.view.s;
  viewChanged();
});
const up = (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  mapEl.classList.remove("dragging");
  if (!moved && pointers.size === 0) readout(e.offsetX, e.offsetY);
};
mapEl.addEventListener("pointerup", up);
mapEl.addEventListener("pointercancel", (e) => { pointers.delete(e.pointerId); mapEl.classList.remove("dragging"); });
mapEl.addEventListener("wheel", (e) => {
  e.preventDefault();
  zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });

function zoomAt(px, py, k) {
  if (!S.view) return;
  const [lon, y] = toWorld(px, py);
  S.view.s = Math.max(S.view.fit * 0.5, Math.min(S.view.fit * 10, S.view.s * k));
  S.view.cx = lon - (px - W / 2) / S.view.s;
  S.view.cy = y + (py - H / 2) / S.view.s;
  viewChanged();
}
$("#zoomIn").onclick = () => zoomAt(W / 2, H / 2, 1.5);
$("#zoomOut").onclick = () => zoomAt(W / 2, H / 2, 1 / 1.5);
$("#zoomFit").onclick = () => { fit(); viewChanged(false); };

// Full screen: the map and timeline cover the page. Where the browser allows it (not iPhone
// Safari), the browser's own controls are hidden too.
const stage = $(".stage");
function setFull(on) {
  stage.classList.toggle("full", on);
  $("#fullscreen").setAttribute("aria-label", on ? "Exit full screen" : "Full screen");
  $("#fullscreen").title = on ? "Exit full screen" : "Full screen";
  document.body.style.overflow = on ? "hidden" : "";
}
$("#fullscreen").onclick = async () => {
  const root = document.documentElement;
  const isFull = document.fullscreenElement || document.webkitFullscreenElement;
  if (stage.classList.contains("full")) {
    setFull(false);
    if (isFull) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {});
    return;
  }
  setFull(true);
  try {
    const req = root.requestFullscreen || root.webkitRequestFullscreen;
    if (req) await req.call(root);
  } catch { /* the page-filling view is enough */ }
};
const fsChange = () => {
  if (!(document.fullscreenElement || document.webkitFullscreenElement) && stage.classList.contains("full")) setFull(false);
};
document.addEventListener("fullscreenchange", fsChange);
document.addEventListener("webkitfullscreenchange", fsChange);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && stage.classList.contains("full")) setFull(false); });

function viewChanged(touched = true) {
  if (S.view) S.view.touched = touched;
  $("#readout").hidden = true;
  particles.getContext("2d").clearRect(0, 0, particles.width, particles.height);
  drawAll();
}

function readout(px, py) {
  const el = $("#readout");
  const m = S.meta?.fill;
  const i = Math.round(S.pos);
  const f = S.fill[i];
  if (!m || !f) { el.hidden = true; return; }
  const [lon, y] = toWorld(px, py);
  const b = m.box, east = b.east <= b.west ? b.east + 360 : b.east;
  let L = lon;
  while (L < b.west) L += 360;
  while (L > east) L -= 360;
  const fx = (L - b.west) / (east - b.west), fy = (mercY(b.north) - y) / (mercY(b.north) - mercY(b.south));
  if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) { el.hidden = true; return; }
  const q = f.data[Math.floor(fy * m.ny) * m.nx + Math.floor(fx * m.nx)];
  if (q === 255) { el.hidden = true; return; }
  let t = q / 254;
  if (m.scale === "sqrt") t *= t;
  const v = m.lo + (m.hi - m.lo) * t;
  const lat = invMercY(y);
  const ll = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"} ${Math.abs(((L + 540) % 360) - 180).toFixed(1)}°${((L + 540) % 360) - 180 >= 0 ? "E" : "W"}`;
  el.innerHTML = `<b>${esc(Units.format(v, m.units))}</b> <span class="muted">${ll}</span>`;
  el.style.left = `${px}px`;
  el.style.top = `${py}px`;
  el.hidden = false;
}

function drawAll() {
  if (!S.view) { drawBase(); return; }
  drawBase();
  drawField();
  drawOverlay();
  updateContours();
}

// ------------------------------------------------------------------------------------------
// Panels
// ------------------------------------------------------------------------------------------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const loc = Units.localize;
const safeUrl = (u) => /^https?:\/\//i.test(u || "") ? u : null;

function navigate(entry, scene) {
  location.hash = new URLSearchParams({ h: entry.key, s: String(scene) }).toString();
}

function renderList() {
  const el = $("#list");
  const row = (e) => {
    const n = e.item.scenes.length;
    const where = [e.item.where?.label, n > 1 ? `${n} scenes` : ""].filter(Boolean).join(" · ");
    return `<button class="entry" data-key="${esc(e.key)}" aria-current="${S.entry === e}">
      <span class="t">${esc(loc(e.item.title))}</span><span class="w">${esc(where)}</span></button>`;
  };
  const main = S.entries.filter((e) => !e.requested), req = S.entries.filter((e) => e.requested);
  const shared = S.shared && !S.entries.includes(S.shared) ? [S.shared] : [];
  el.innerHTML = (shared.length ? `<h2>Shared with you</h2>${shared.map(row).join("")}` : "")
    + `<h2>Highlights</h2>${main.map(row).join("")}` + (req.length ? `<h2>Requested</h2>${req.map(row).join("")}` : "");
  for (const b of el.querySelectorAll(".entry")) {
    b.onclick = () => {
      const e = [...shared, ...S.entries].find((x) => x.key === b.dataset.key);
      if (e && e !== S.entry) navigate(e, 0);
    };
  }
}

// Scene tabs above the map: each highlight tells its story in one or more scenes.
function renderScenes() {
  const sc = S.entry.item.scenes;
  const el = $("#scenes");
  el.innerHTML = sc.map((s, i) => `<button class="tab" role="tab" data-i="${i}" aria-selected="${i === S.sceneIndex}">
      <span class="n">${i + 1}</span><span class="tt">${esc(loc(s.title) || `Scene ${i + 1}`)}</span></button>`).join("");
  $("#sceneLabel").textContent = sc.length > 1 ? `${sc.length} scenes` : "Scene";
  for (const b of el.querySelectorAll(".tab")) {
    b.onclick = () => { if (+b.dataset.i !== S.sceneIndex) navigate(S.entry, +b.dataset.i); };
  }
  // Bring the current tab into view within the row only (scrollIntoView would move the page too).
  const cur = el.querySelector('[aria-selected="true"]');
  if (cur && (cur.offsetLeft < el.scrollLeft || cur.offsetLeft + cur.offsetWidth > el.scrollLeft + el.clientWidth)) {
    el.scrollLeft = cur.offsetLeft - 8;
  }
}

function renderDetails() {
  const it = S.entry.item;
  const fmt = (s) => s ? Units.formatTime(parseTime(s)) : "";
  const when = it.when ? [it.when.start && `from ${fmt(it.when.start)}`, it.when.peak && `peak ${fmt(it.when.peak)}`].filter(Boolean).join(" · ") : "";
  const evidence = (it.evidence || []).map((e) => {
    const u = safeUrl(e.url);
    const text = esc(loc(e.text));
    return `<li><span class="k">${esc(e.kind || "")}</span>${u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${text}</a>` : text}</li>`;
  }).join("");
  const archived = S.entry.archived
    ? `<p class="archived">This shared highlight is from an earlier set and may be out of date.${OFFLINE ? "" : ` <a href="#" id="latest">See the latest highlights</a>`}</p>` : "";
  $("#details").innerHTML = `${archived}
    <h2>${esc(loc(it.title))}</h2>
    <p class="where">${esc(it.where?.label || "")}${when ? `<br>${esc(when)}` : ""}</p>
    ${it.hazards?.length ? `<div class="chips">${it.hazards.map((h) => `<span class="chip">${esc(h.replace(/-/g, " "))}</span>`).join("")}</div>` : ""}
    <h3>What's happening</h3><p>${esc(loc(it.summary))}</p>
    ${it.why_interesting ? `<h3>Why it's interesting</h3><p>${esc(loc(it.why_interesting))}</p>` : ""}
    ${evidence ? `<h3>Sources</h3><ul class="evidence">${evidence}</ul>` : ""}
    ${it.confidence ? `<h3>Confidence</h3><p>${esc(loc(it.confidence))}</p>` : ""}`;
  const latest = $("#latest");
  if (latest) latest.onclick = (e) => { e.preventDefault(); if (S.entries[0]) navigate(S.entries[0], 0); };
}

function notice(text) {
  const el = $("#notice");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(notice.timer);
  notice.timer = setTimeout(() => { el.hidden = true; }, 9000);
}
$("#notice").onclick = () => { $("#notice").hidden = true; };

// Key labels, as in the app: round values in the viewer's units (e.g. 50, 100, 150, 200 km/h),
// about `n` across the bar, each placed where it falls. Returns [[fraction, text], ...].
function legendTicks(lo, hi, units, n) {
  const a = Units.convert(lo, units), b = Units.convert(hi, units);
  const dlo = Math.min(a, b), dhi = Math.max(a, b);
  if (!(dhi > dlo)) return [];
  const raw = (dhi - dlo) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((x) => x * mag).find((x) => x >= raw) || 10 * mag;
  const out = [];
  for (let t = Math.ceil(dlo / step - 1e-9) * step; t <= dhi + 1e-9; t += step) {
    const f = (t - dlo) / (dhi - dlo);
    if (f < -1e-9 || f > 0.96) continue;                   // the right end is left clear
    if (f > 0 && f < 0.04) continue;                       // too close to a label at the left end
    const v = Math.round(t * 1e6) / 1e6;
    out.push([a <= b ? f : 1 - f, v === Math.round(v) ? String(v) : String(Math.abs(v) < 1 ? +v.toPrecision(2) : v.toFixed(1))]);
  }
  return out;
}

function renderLegend() {
  const m = S.meta.fill;
  const lo = S.ramp.lo, hi = S.ramp.hi;
  const cm = contourMeta();
  const el = $("#legend");
  const scale = legendTicks(lo, hi, m.units, matchMedia("(max-width: 720px)").matches ? 4 : 6)
    .map(([f, text]) => `<span style="left:${(f * 100).toFixed(1)}%">${esc(text)}</span>`).join("");
  el.innerHTML = `<div class="lt">${esc(m.title)} <span class="muted">(${esc(Units.unit(m.units))})</span></div>
    <canvas width="200" height="10"></canvas>
    <div class="scale">${scale}</div>
    ${cm ? `<div class="note">Lines: ${esc(cm.meta.title.toLowerCase())} every ${cm.meta.contour_interval} ${esc(cm.meta.units)}</div>` : ""}
    ${vectorMeta() ? `<div class="note">Streaks: ${esc(vectorMeta().meta.title.toLowerCase())}</div>` : ""}
    <div class="note">${esc(m.model)}</div>
    ${style().credit ? `<div class="note credit">${esc(style().credit)}</div>` : ""}`;
  const c = el.querySelector("canvas"), g = c.getContext("2d");
  for (let x = 0; x < 200; x++) {
    const [r, gg, b, a] = rampSample(m.stops, lo + (hi - lo) * x / 199);
    g.fillStyle = `rgba(${r},${gg},${b},${Math.max(0.12, a / 255)})`;
    g.fillRect(x, 0, 1, 10);
  }
}

function setupHelp() {
  const dlg = $("#help");
  $("#helpBtn").onclick = () => (dlg.showModal ? dlg.showModal() : dlg.setAttribute("open", ""));
  $("#helpClose").onclick = () => dlg.close();
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });   // click outside
}

// Units: "Automatic" follows the browser's region; choices are remembered in this browser.
const GEAR = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h9M15 5h2M3 10h3M9 10h8M3 15h7M13 15h4"/><circle cx="13.5" cy="5" r="1.6"/><circle cx="7.5" cy="10" r="1.6"/><circle cx="11.5" cy="15" r="1.6"/></svg>`;
function setupUnits() {
  const btn = $("#unitsBtn"), panel = $("#unitsPanel");
  const names = { C: "°C", F: "°F", mm: "mm", in: "inches" };
  for (const sel of panel.querySelectorAll("select[data-kind]")) {
    const kind = sel.dataset.kind;
    const auto = Units.CHOICES[kind].find(([v]) => v === Units.DEVICE[kind]);
    sel.innerHTML = [["auto", `Automatic (${auto ? auto[1] : names[Units.DEVICE[kind]]})`], ...Units.CHOICES[kind]]
      .map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join("");
    sel.value = Units.choice(kind);
    sel.onchange = () => {
      Units.setChoice(kind, sel.value);
      btn.innerHTML = GEAR + esc(Units.summary());
      unitsChanged();
    };
  }
  const tz = $("#timeZone");
  tz.innerHTML = `<option value="utc">UTC</option><option value="local">${esc(Units.zoneName(new Date(), true))}</option>`;
  tz.value = Units.choice("time") === "local" ? "local" : "utc";
  tz.onchange = () => {
    Units.setChoice("time", tz.value);
    btn.innerHTML = GEAR + esc(Units.summary());
    unitsChanged();
  };
  btn.innerHTML = GEAR + esc(Units.summary());
  btn.onclick = (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    btn.setAttribute("aria-expanded", String(!panel.hidden));
  };
  document.addEventListener("click", (e) => {
    if (!panel.hidden && !e.target.closest(".units")) { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); }
  });
}
// Map style: the layers button on the map opens dark / light / satellite.
function setupLayers() {
  const btn = $("#layersBtn"), panel = $("#layersPanel");
  const open = (on) => { panel.hidden = !on; btn.setAttribute("aria-expanded", String(on)); };
  btn.onclick = (e) => { e.stopPropagation(); open(panel.hidden); };
  for (const b of panel.querySelectorAll("button")) {
    b.onclick = (e) => {
      e.stopPropagation();
      mapStyle = b.dataset.style;
      try { localStorage.setItem(STYLE_KEY, mapStyle); } catch { /* applied, not kept */ }
      applyMapStyle();
      open(false);
    };
  }
  document.addEventListener("click", (e) => { if (!panel.hidden && !e.target.closest(".layers")) open(false); });
  applyMapStyle();
}
function applyMapStyle() {
  for (const b of $("#layersPanel").querySelectorAll("button")) b.setAttribute("aria-checked", String(b.dataset.style === mapStyle));
  mapEl.style.background = style().ocean;
  particles.getContext("2d").clearRect(0, 0, particles.width, particles.height);
  if (S.meta) renderLegend();
  drawAll();
}
function unitsChanged() {
  renderList();
  renderFresh();
  if (S.entry) { renderScenes(); renderDetails(); }
  if (S.meta) { renderLegend(); updateTime(); }
  $("#readout").hidden = true;
}

function renderFresh() {
  const f = S.feed;
  if (!f?.generated_utc) return;
  const t = parseTime(f.generated_utc);
  if (OFFLINE) {
    const saved = parseTime(OFFLINE.saved);
    $("#fresh").textContent = `Saved copy · highlights from ${Units.formatTime(t)} · saved ${Units.formatTime(saved)}`;
  } else {
    const h = (Date.now() - t) / 3.6e6;
    const age = h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : `${Math.round(h)} h ago`;
    $("#fresh").textContent = `Highlights from ${Units.formatTime(t, { day: false })} (${age}) · refreshed twice a day`;
  }
  if (f.attribution) $("#attribution").textContent = f.attribution;
}

// ------------------------------------------------------------------------------------------
// Feed and routing
// ------------------------------------------------------------------------------------------

async function loadFeed() {
  const feed = await fetch(dataUrl("feed.json"), { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  });
  const changed = feed.synced_utc !== S.feed?.synced_utc;
  S.feed = feed;
  Units.setYear(parseTime(feed.generated_utc || "").getUTCFullYear());
  S.entries = [
    ...feed.items.map((item) => ({ key: item.ref || item.id, item })),
    ...(feed.requested || []).map((r) => ({ key: r.item.ref || r.item.id, item: r.item, requested: true })),
  ];
  renderFresh();
  return changed;
}

// Links: #h=<tag>/<id>&s=<scene>, plus t=<valid time>, map=<style> and v=<lon>,<lat>,<zoom> in
// shared links. The older form #<id>/<scene> still works.
function parseHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (!h) return {};
  if (!h.includes("=")) {
    const [key, n] = h.split("/");
    return { key, scene: parseInt(n || "0", 10) || 0 };
  }
  const p = new URLSearchParams(h);
  const v = (p.get("v") || "").split(",").map(Number);
  return {
    key: p.get("h"), scene: parseInt(p.get("s") || "0", 10) || 0, time: p.get("t"), map: p.get("map"),
    view: v.length === 3 && v.every(Number.isFinite) && v[2] > 0 ? { lon: v[0], lat: v[1], z: v[2] } : null,
  };
}

async function route() {
  const r = parseHash();
  let entry = r.key ? S.entries.find((e) => e.key === r.key || e.item.id === r.key) : null;
  if (!entry && S.shared?.key === r.key) entry = S.shared;
  if (r.key && !entry) {
    // A shared highlight that has since been replaced: kept for a week after it was last listed.
    if (!OFFLINE && /^[0-9A-Za-z]+\/[0-9A-Za-z_.\-]+$/.test(r.key)) {
      try {
        const item = await fetch(dataUrl(`items/${r.key}.json`)).then((x) => { if (!x.ok) throw new Error(x.status); return x.json(); });
        entry = S.shared = { key: r.key, item, archived: true };
      } catch { /* expired */ }
    }
    if (!entry) notice("That shared highlight is no longer available (they are kept for a week). Here are the latest highlights.");
  }
  entry ||= S.entries[0];
  if (!entry) {
    $("#list").innerHTML = `<p class="muted pad">No highlights at the moment.</p>`;
    return;
  }
  if (r.map && MAP_STYLES[r.map] && r.map !== mapStyle) {
    mapStyle = r.map;                       // for this visit; the viewer's own choice isn't changed
    applyMapStyle();
  }
  const i = Math.max(0, Math.min(entry.item.scenes.length - 1, r.scene || 0));
  if (entry === S.entry && i === S.sceneIndex && !r.time && !r.view) return;
  play(false);
  loadScene(entry, i, { time: r.time, view: r.view });
}

// ------------------------------------------------------------------------------------------
// Sharing: a link to exactly what is on screen (highlight, scene, moment, map, view). Units are
// left out, so each person sees their own.
// ------------------------------------------------------------------------------------------

function shareLink() {
  const p = new URLSearchParams({ h: S.entry.key, s: String(S.sceneIndex) });
  const fr = S.meta?.fill.frames;
  if (fr?.length) p.set("t", fr[Math.max(0, Math.min(fr.length - 1, Math.round(S.pos)))].valid_time);
  p.set("map", mapStyle);
  if (S.view?.touched) {
    p.set("v", [S.view.cx.toFixed(2), invMercY(S.view.cy).toFixed(2), (S.view.s / S.view.fit).toFixed(2)].join(","));
  }
  return `${location.origin}${location.pathname}#${p.toString()}`;
}

$("#share").onclick = async () => {
  if (!S.entry) return;
  const url = shareLink();
  history.replaceState(null, "", url);
  const title = loc(S.entry.item.title);
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    try { await navigator.share({ title: `${title} — Weather Explorer`, url }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  try {
    await navigator.clipboard.writeText(url);
    notice("Link copied. It opens this scene at this moment, with this map and view.");
  } catch {
    window.prompt("Copy this link:", url);
  }
};

// ------------------------------------------------------------------------------------------
// Saving a copy: one HTML file holding the viewer and the data, which plays with no connection
// (like a saved highlight in the app).
// ------------------------------------------------------------------------------------------

const MB = (b) => b >= 1e6 ? `${(b / 1e6).toFixed(b >= 1e7 ? 0 : 1)} MB` : `${Math.max(1, Math.round(b / 1e3))} kB`;
const itemBytes = (it) => it.scenes.reduce((n, s) => n + (s.bytes || 0), 0);

function setupSave() {
  const btn = $("#save"), panel = $("#savePanel");
  const open = (on) => { panel.hidden = !on; btn.setAttribute("aria-expanded", String(on)); };
  btn.onclick = (e) => {
    e.stopPropagation();
    if (panel.hidden) {
      // Saved files hold every frame as text, about a third bigger than the downloads.
      const one = itemBytes(S.entry.item), all = S.entries.reduce((n, x) => n + itemBytes(x.item), 0);
      $("#saveOne").lastElementChild.textContent = one ? `about ${MB(one * 1.2)}` : "";
      $("#saveAll").lastElementChild.textContent = all ? `about ${MB(all * 1.2)}` : "";
      $("#saveAll").hidden = S.entry.archived;
      $("#saveStatus").textContent = "";
    }
    open(panel.hidden);
  };
  document.addEventListener("click", (e) => { if (!panel.hidden && !e.target.closest(".save")) open(false); });
  $("#saveOne").onclick = () => saveCopy([S.entry]);
  $("#saveAll").onclick = () => saveCopy(S.entries);
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

let saving = false;
async function saveCopy(entries) {
  if (saving) return;
  saving = true;
  const say = (t) => { $("#saveStatus").textContent = t; };
  try {
    say("Preparing…");
    const get = (p, kind) => fetch(p).then((r) => { if (!r.ok) throw new Error(`${r.status} ${p}`); return r[kind](); });
    const [page, css, units, app, workerSrc, basemapText] = await Promise.all(
      ["index.html", "style.css", "units.js", "app.js", "worker.js", "basemap.json"].map((p) => get(`${p}?v=${VERSION}`, "text")));
    const files = { "basemap.json": toBase64(new TextEncoder().encode(basemapText)) };

    // Every file the viewer reads for these scenes.
    const paths = [];
    for (const e of entries) {
      for (const sc of e.item.scenes) {
        const meta = await get(DATA + sc.package + "/meta.json", "json");
        files[`${DATA}${sc.package}/meta.json`] = toBase64(new TextEncoder().encode(JSON.stringify(meta)));
        const n = meta.fill.frames.length;
        const vec = ["vectors", "fill", "contours"].find((r) => meta[r]?.vectors);
        for (let i = 0; i < n; i++) {
          const f = String(i).padStart(3, "0");
          paths.push(`${sc.package}/fill/${f}.webp`);
          if (meta.fill.contour_interval) paths.push(`${sc.package}/fill/${f}.c12.webp`);
          if (meta.contours?.contour_interval) paths.push(`${sc.package}/contours/${f}.c12.webp`);
          if (vec) paths.push(`${sc.package}/${vec}/${f}.uv.webp`);
        }
      }
    }
    let done = 0;
    const queue = [...paths];
    const collect = async () => {
      while (queue.length) {
        const p = queue.shift();
        files[DATA + p] = toBase64(await get(DATA + p, "arrayBuffer"));
        if (++done % 10 === 0) say(`Collecting frames… ${Math.round(done / paths.length * 100)}%`);
      }
    };
    await Promise.all([collect(), collect(), collect(), collect(), collect(), collect()]);

    const items = entries.filter((e) => !e.requested).map((e) => e.item);
    const requested = entries.filter((e) => e.requested).map((e) => ({ item: e.item }));
    const feed = { generated_utc: S.feed.generated_utc, attribution: S.feed.attribution, items, requested };
    files[DATA + "feed.json"] = toBase64(new TextEncoder().encode(JSON.stringify(feed)));
    const saved = new Date().toISOString().slice(0, 16) + "Z";
    const offline = JSON.stringify({ saved, worker: workerSrc, files }).replace(/</g, "\\u003c");

    say("Writing the file…");
    const SCRIPT = "script";       // keeps a closing tag out of this file, which saved copies inline
    const html = page
      .replace(/<link rel="stylesheet" href="style\.css[^"]*">/, () => `<style>\n${css}\n</style>`)
      .replace(new RegExp(`<${SCRIPT} src="units\\.js[^"]*"></${SCRIPT}>`), () => `<${SCRIPT}>window.WEATHER_OFFLINE = ${offline};</${SCRIPT}>\n<${SCRIPT}>\n${units}\n</${SCRIPT}>`)
      .replace(new RegExp(`<${SCRIPT} src="app\\.js[^"]*"></${SCRIPT}>`), () => `<${SCRIPT}>\n${app}\n</${SCRIPT}>`);
    const name = entries.length === 1 ? entries[0].item.id : `highlights-${S.feed.generated_utc.slice(0, 10)}`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    a.download = `weather-explorer-${name}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    say(`Saved ${MB(html.length)}. Open the file in a browser to play it, even offline.`);
  } catch (e) {
    console.warn(e);
    say("Sorry, the copy could not be made. Please try again.");
  }
  saving = false;
}

window.addEventListener("hashchange", route);
new ResizeObserver(resize).observe(mapEl);

(async function start() {
  try {
    setupGL();
  } catch (e) {
    console.warn(e);
  }
  if (!gl) status("This browser can't show the weather layer (WebGL2 is needed).");
  setupUnits();
  setupLayers();
  setupHelp();
  if (OFFLINE) {
    $("#share").hidden = true;
    $(".save").hidden = true;
  } else {
    setupSave();
  }
  try {
    await loadFeed();
    await route();
  } catch (e) {
    $("#list").innerHTML = `<p class="muted pad">The highlights could not be loaded. Please try again later.</p>`;
    console.warn(e);
  }
  requestAnimationFrame(tick);
  if (OFFLINE) return;
  setInterval(async () => {
    try {
      if (await loadFeed()) {
        if (!S.entries.includes(S.entry) && S.entry !== S.shared) {
          const same = S.entries.find((e) => e.key === S.entry?.key);
          if (same) S.entry = same; else route();
        }
        renderList();
      }
    } catch { /* keep showing what we have */ }
  }, FEED_REFRESH_MS);
})();
