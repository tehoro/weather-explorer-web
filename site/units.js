// Display units, as in the app: the data stay in m/s, °C and mm/h; labels, readouts and the
// measurements inside the text are converted. "Automatic" follows the browser's region; the
// viewer can override each choice, remembered in this browser only.
//
// A plain script (window.Units) rather than a module, so a saved copy can inline it.
window.Units = (() => {

const KEY = "weather-explorer-units";

function region() {
  for (const tag of navigator.languages?.length ? navigator.languages : [navigator.language || "en-GB"]) {
    try {
      const r = new Intl.Locale(tag).maximize().region;
      if (r) return r;
    } catch { /* try the next one */ }
  }
  return "GB";
}

// Countries that use Fahrenheit, miles per hour or inches of rain for weather.
const F_REGIONS = new Set(["US", "PR", "GU", "VI", "AS", "MP", "UM", "BS", "BZ", "KY", "PW", "LR", "FM", "MH"]);
const MPH_REGIONS = new Set(["US", "PR", "GU", "VI", "AS", "MP", "UM", "GB", "IM", "JE", "GG", "LR", "MM"]);
const IN_REGIONS = new Set(["US", "PR", "GU", "VI", "AS", "MP", "UM", "LR", "MM"]);

const R = region();
const DEVICE = {
  temperature: F_REGIONS.has(R) ? "F" : "C",
  wind: MPH_REGIONS.has(R) ? "mph" : "kmh",
  rain: IN_REGIONS.has(R) ? "in" : "mm",
};

const CHOICES = {
  temperature: [["C", "°C"], ["F", "°F"]],
  wind: [["kmh", "km/h"], ["mph", "mph"], ["ms", "m/s"], ["kn", "knots"]],
  rain: [["mm", "mm"], ["in", "inches"]],
};

let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { saved = {}; }

function choice(kind) {
  return saved[kind] || "auto";
}
function setChoice(kind, value) {
  saved = { ...saved, [kind]: value };
  try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* not kept, still applied */ }
}
function eff(kind) {
  const c = choice(kind);
  return c === "auto" ? DEVICE[kind] : c;
}

const WIND = { kmh: [3.6, "km/h"], mph: [2.236936, "mph"], ms: [1, "m/s"], kn: [1.943844, "kn"] };

/** Display unit for a data unit. */
function unit(u) {
  if (u === "m/s") return WIND[eff("wind")][1];
  if (u === "°C") return eff("temperature") === "F" ? "°F" : "°C";
  if (u === "mm/h") return eff("rain") === "in" ? "in/h" : "mm/h";
  if (u === "mm") return eff("rain") === "in" ? "in" : "mm";
  return u;
}

/** A value in a data unit, converted to the display unit. */
function convert(v, u) {
  if (u === "m/s") return v * WIND[eff("wind")][0];
  if (u === "°C") return eff("temperature") === "F" ? v * 9 / 5 + 32 : v;
  if (u === "mm/h" || u === "mm") return eff("rain") === "in" ? v / 25.4 : v;
  return v;
}

/** Value with sensible precision, optionally followed by its unit. */
function format(v, u, withUnit = true) {
  const c = convert(v, u), du = unit(u);
  let digits;
  if (du.startsWith("in")) digits = Math.abs(c) < 1 ? 2 : 1;
  else if (u === "mm/h" || u === "mm") digits = Math.abs(c) < 10 ? 1 : 0;
  else if (u === "%") digits = 0;
  else digits = Math.abs(c) < 10 && c !== Math.round(c) ? 1 : 0;
  const n = c.toFixed(digits);
  if (!withUnit || !du) return n;
  return du.startsWith("°") || du === "%" ? n + du : `${n} ${du}`;
}

/** Short summary for the units button, e.g. "°C · km/h · mm". */
function summary() {
  return [unit("°C"), unit("m/s"), unit("mm")].join(" · ");
}

// ---- Measurements inside text ("60 m/s", "60–80 mph", "250 mm", "35 °C") -----------------

const U = "(m/s|km/h|kmh|mph|knots|kts?|mm/h|mm|inches|°C|ºC|°F|ºF)";
const NUM = "(\\d+(?:\\.\\d+)?)";
const RANGE = `${NUM}(?:\\s*(?:–|-|to)\\s*${NUM})?`;
const MEASURE = new RegExp(`(?<![\\w.])${RANGE}\\s?${U}(?![\\w/])`, "g");
const PART = `\\d+(?:\\.\\d+)?(?:\\s*(?:–|-|to)\\s*\\d+(?:\\.\\d+)?)?\\s?(m/s|km/h|kmh|mph|knots|kts?|mm|inches|°C|ºC|°F|ºF)`;
const PAIR = new RegExp(`((?<![\\w.])${PART})\\s*\\(\\s*(${PART})\\s*\\)`, "g");

const kindOf = (u) => (["mm", "inches"].includes(u) ? "rain" : /[CF]$/.test(u) ? "temp" : "wind");

function rewrite(a, b, u) {
  const join = (x, y, unitText) => {
    const n = y === null ? x : `${x}–${y}`;
    return unitText.startsWith("°") ? n + unitText : `${n} ${unitText}`;
  };
  if (["m/s", "km/h", "kmh", "mph", "knots", "kt", "kts"].includes(u)) {
    const toMS = u.startsWith("km") ? 1 / 3.6 : u === "mph" ? 0.44704 : u.startsWith("k") ? 0.514444 : 1;
    const target = eff("wind");
    const same = (u === "m/s" && target === "ms") || (u.startsWith("km") && target === "kmh")
      || (u === "mph" && target === "mph") || (u.startsWith("k") && !u.startsWith("km") && target === "kn");
    if (same) return null;
    const f = (v) => String(Math.round(v * toMS * WIND[target][0]));
    return join(f(a), b === null ? null : f(b), WIND[target][1]);
  }
  if (u === "mm" || u === "mm/h") {
    if (eff("rain") === "mm") return null;
    const f = (v) => { const i = v / 25.4; return i < 1 ? i.toFixed(2) : i.toFixed(1); };
    return join(f(a), b === null ? null : f(b), u === "mm/h" ? "in/h" : "in");
  }
  if (u === "inches") {
    if (eff("rain") === "in") return null;
    const f = (v) => String(Math.round(v * 25.4));
    return join(f(a), b === null ? null : f(b), "mm");
  }
  if (u === "°C" || u === "ºC") {
    if (eff("temperature") === "C") return null;
    const f = (v) => String(Math.round(v * 9 / 5 + 32));
    return join(f(a), b === null ? null : f(b), "°F");
  }
  if (u === "°F" || u === "ºF") {
    if (eff("temperature") === "F") return null;
    const f = (v) => String(Math.round((v - 32) * 5 / 9));
    return join(f(a), b === null ? null : f(b), "°C");
  }
  return null;
}

function localizeAll(text) {
  return text.replace(MEASURE, (m, a, b, u) => rewrite(parseFloat(a), b === undefined ? null : parseFloat(b), u) ?? m);
}

/** Rewrites the measurements in a piece of text in the viewer's units. */
function localize(text) {
  if (!text) return text;
  // "60–80 mph (130–140 km/h)" becomes one measurement, so it isn't shown twice after conversion;
  // keep whichever half needs no conversion, exactly as written.
  const collapsed = String(text).replace(PAIR, (m, first, u1, second, u2) => {
    if (kindOf(u1) !== kindOf(u2)) return m;
    return localizeAll(second) === second ? second : first;
  });
  return localizeAll(collapsed);
}

return { DEVICE, CHOICES, choice, setChoice, unit, convert, format, summary, localize };
})();
