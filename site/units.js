// Display units, as in the app: the data stay in m/s, °C and mm/h; labels, readouts and the
// measurements inside the text are converted. "Automatic" follows the browser's time zone; the
// viewer can override each choice, remembered in this browser only.
//
// A plain script (window.Units) rather than a module, so a saved copy can inline it.
window.Units = (() => {

const KEY = "weather-explorer-units";

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

// Time zones of the places that use °F, mph or inches. The region comes from the time zone, not
// the language: many people elsewhere keep "English (US)", and Safari reports only the language.
const IMPERIAL_ZONES = {
  US: /^(America\/(New_York|Detroit|Chicago|Denver|Phoenix|Boise|Los_Angeles|Anchorage|Juneau|Sitka|Metlakatla|Yakutat|Nome|Adak|Menominee|Indiana\/\w+|Kentucky\/\w+|North_Dakota\/\w+)|Pacific\/Honolulu|US\/\w+)$/,
  PR: /^America\/Puerto_Rico$/, VI: /^America\/St_Thomas$/, GU: /^Pacific\/Guam$/, MP: /^Pacific\/Saipan$/,
  AS: /^Pacific\/Pago_Pago$/, UM: /^Pacific\/(Midway|Wake)$/, BS: /^America\/Nassau$/, BZ: /^America\/Belize$/,
  KY: /^America\/Cayman$/, PW: /^Pacific\/Palau$/, FM: /^Pacific\/(Chuuk|Pohnpei|Kosrae)$/,
  MH: /^Pacific\/(Majuro|Kwajalein)$/, GB: /^(Europe\/London|GB)$/, IM: /^Europe\/Isle_of_Man$/,
  JE: /^Europe\/Jersey$/, GG: /^Europe\/Guernsey$/, LR: /^Africa\/Monrovia$/, MM: /^Asia\/(Yangon|Rangoon)$/,
};

function region() {
  for (const [r, re] of Object.entries(IMPERIAL_ZONES)) if (re.test(ZONE)) return r;
  if (!/^(UTC|Etc\/|GMT)/.test(ZONE)) return "metric";   // a real zone elsewhere: °C, km/h, mm
  // No usable time zone (some privacy settings report UTC): fall back to the language.
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

/** Short summary for the units button, e.g. "°C · km/h · mm · UTC". */
function summary() {
  return [unit("°C"), unit("m/s"), unit("mm"), zoneName(event?.date || new Date())].join(" · ");
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
  return localizeTimes(localizeAll(collapsed));
}

// ---- Times: the browser's own time zone (the default) or UTC ------------------------------
// While a past event is shown, the choice is instead the event's own time zone (the default) or
// UTC, kept separately ("pasttime"): the viewer's own clock means little for London in 1987.

const local = () => choice("time") !== "utc";
let event = null;          // {zone, date} while a past event is shown
/** A past event's IANA time zone and a moment in it, or null to go back to the viewer's own. */
function setEventZone(zone, date) {
  try { event = zone ? (new Intl.DateTimeFormat("en", { timeZone: zone }), { zone, date }) : null; } catch { event = { zone: "UTC", date }; }
}
/** The time zone times are shown in (IANA), or null for UTC. */
function shownZone() {
  if (event) return choice("pasttime") === "utc" ? null : event.zone;
  return local() ? ZONE : null;
}
const eventZone = () => event?.zone ?? null;

// Official abbreviations where the browser's English data lacks them; otherwise "UTC+8" etc.
const ABBR = {
  "Asia/Hong_Kong": "HKT", "Asia/Macau": "CST", "Asia/Shanghai": "CST", "Asia/Taipei": "CST", "Asia/Tokyo": "JST",
  "Asia/Seoul": "KST", "Asia/Singapore": "SGT", "Asia/Kuala_Lumpur": "MYT", "Asia/Manila": "PHT", "Asia/Jakarta": "WIB",
  "Asia/Bangkok": "ICT", "Asia/Ho_Chi_Minh": "ICT", "Asia/Karachi": "PKT", "Asia/Dhaka": "BST", "Asia/Dubai": "GST",
  "Asia/Jerusalem": null, "Europe/Moscow": "MSK", "Africa/Nairobi": "EAT", "Africa/Lagos": "WAT", "Africa/Cairo": null,
};
const ENGLISH = ["en-GB", "en-US", "en-NZ", "en-AU", "en-CA", "en-IE", "en-IN", "en-ZA"];
const abbrCache = new Map();

/** The time zone's name at a moment, e.g. "UTC", "NZDT", "CEST", "EDT" or "UTC+8". */
function zoneName(date, zone = shownZone()) {
  if (!zone) return "UTC";
  const parts = (loc, d = date) => new Intl.DateTimeFormat(loc, { timeZone: zone, timeZoneName: "short" })
    .formatToParts(d).find((p) => p.type === "timeZoneName")?.value || "";
  const offset = parts("en-GB").replace(/^GMT/, "UTC");          // "UTC+13", or "UTC" for no offset
  const key = `${zone} ${offset}`;
  if (abbrCache.has(key)) return abbrCache.get(key);
  const named = (d) => {
    for (const loc of [...(navigator.languages || []), ...ENGLISH]) {
      try {
        const n = parts(loc, d);
        if (n && !/^(GMT|UTC)[+-−]/.test(n) && /^[A-Z]{2,5}$/.test(n)) return n;
      } catch { /* not a usable locale */ }
    }
    return null;
  };
  let name = named(date);
  // Browsers often have no name for a zone in past decades (Wellington in 1968 is "GMT+12"): use
  // this year's name for the same offset there (NZST), from mid-January or mid-July.
  if (!name) {
    const y = new Date().getUTCFullYear();
    const now = [new Date(Date.UTC(y, 0, 15)), new Date(Date.UTC(y, 6, 15))]
      .find((d) => parts("en-GB", d).replace(/^GMT/, "UTC") === offset);
    if (now) name = named(now);
  }
  if (!name && ABBR[zone]) name = ABBR[zone];
  name ||= offset === "UTC" ? "GMT" : offset;
  abbrCache.set(key, name);
  return name;
}

/** A moment for display, e.g. "Mon 26 Oct, 12:00 UTC" or "Tue 27 Oct, 01:00 NZDT"; `year` adds the
 *  year (videos, which outlive the week they show). */
function formatTime(date, { weekday = true, day = true, year = false } = {}) {
  const opts = { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: shownZone() || "UTC" };
  if (weekday) opts.weekday = "short";
  if (day) { opts.day = "numeric"; opts.month = "short"; }
  if (year) opts.year = "numeric";
  return `${new Intl.DateTimeFormat(undefined, opts).format(date)} ${zoneName(date)}`;
}

// Times written in the text with a date, such as "18 UTC 24 Oct" or "06-12 UTC 26 Oct" (the
// highlights skill writes them this way). Model run names ("HRES (18 UTC 24 Oct)",
// "00 UTC 22 Oct run") stay as written: they name the run.
let year = new Date().getUTCFullYear();
function setYear(y) { if (y) year = y; }
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TEXT_TIME = /\b(\d{1,2})(?::(\d{2}))?(?:\s?[-–]\s?(\d{1,2})(?::(\d{2}))?)?\s?UTC,?\s(\d{1,2})\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g;

function localizeTimes(text) {
  const zone = shownZone();
  if (!zone || !text) return text;
  return text.replace(TEXT_TIME, (m, h1, m1, h2, m2, d, mon, at, all) => {
    if (/(HRES|ENS|AIFS|IFS|run)\s*\(?\s*$/i.test(all.slice(Math.max(0, at - 12), at))) return m;
    if (/^\s*run\b/i.test(all.slice(at + m.length))) return m;     // "00 UTC 22 Oct run"
    const when = (h, mi) => new Date(Date.UTC(year, MONTHS.indexOf(mon), +d, +h, +(mi || 0)));
    const a = when(h1, m1);
    const hm = (t) => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: zone }).format(t);
    const dm = (t) => new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: zone }).format(t);
    if (h2 === undefined) return `${hm(a)} ${zoneName(a)} ${dm(a)}`;
    let b = when(h2, m2);
    if (b < a) b = new Date(b.getTime() + 864e5);                 // "21-03 UTC" runs past midnight
    return dm(a) === dm(b) ? `${hm(a)}–${hm(b)} ${zoneName(b)} ${dm(a)}`
      : `${hm(a)} ${zoneName(a)} ${dm(a)} – ${hm(b)} ${zoneName(b)} ${dm(b)}`;
  });
}

return { DEVICE, CHOICES, choice, setChoice, unit, convert, format, summary, localize,
         zoneName, formatTime, setYear, setEventZone, eventZone, ZONE };
})();
