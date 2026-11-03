# Weather Explorer: web viewer

A public, read-only web page that plays the current Weather Explorer highlights:
**https://weatherexplorer.neilgordon.me/** (the original https://tehoro.github.io/weather-explorer-web/ redirects here)

Weather Explorer is a prototype for exploring animated ECMWF weather forecasts. Twice a day an AI
research agent picks about fifteen interesting weather situations around the world and describes
how to show them; this viewer animates them on an interactive map, with a 3D view for tropical
cyclones. The research runs in the backend: https://github.com/tehoro/weather-explorer-backend

> **Please read [Important caveats](#important-caveats) before using anything here.** This is a
> prototype. It is not an ECMWF service, its weather content is model guidance chosen and written
> by an AI model, and its code was written by an AI model.

## Who made this, and how

All of the code and documentation in this repository was written by **Claude Opus 5.5**, an AI
model made by [Anthropic](https://www.anthropic.com), working in
[Claude Code](https://claude.com/claude-code) at the direction of **Neil Gordon**. Neil set the
goals, the design rules and the priorities, tested the results and decided what to keep. Claude
wrote the code, ran the tests and wrote the commit messages.

Neil developed Weather Explorer as an **ECMWF Visiting Scientist**. ECMWF supported
the work by providing the Claude Opus 5.5 usage, through its enterprise account, with which the
code was written. That support does not make it an ECMWF product or service (see below).

Two of Neil's rules shape the design: only ECMWF's free **Open Data** is used, so anyone can
reproduce every field; and everything that scales with the number of viewers (decoding, colouring,
contours, particles, the 3D view) runs **in the browser**, so the site is static files on GitHub
Pages with no server doing work per viewer.

## Important caveats

**Not an official forecast or warning.** Everything shown is model guidance from ECMWF's
forecasts, chosen and described by an AI model. It can be wrong, out of date or misleading. For
forecasts and warnings, use your national weather service. Nobody should rely on this for safety,
travel, operations or any decision.

**Not an ECMWF service.** It uses ECMWF's free Open Data and was developed with ECMWF's support
(see above), but it is not an official or operational ECMWF product or service. ECMWF does not
run it, maintain it or vouch for its content.

**AI-chosen and AI-written content.** The highlights, captions and citations are written by an AI
model, checked automatically for structure but not reviewed by a person before publication.
Visuals are simplified: in the 3D view, clouds are *inferred from humidity*, heights are
*exaggerated*, and wind particles are sped up thousands of times.

**AI-written code.** The code was written by an AI model and tested in use, not audited line by
line. It is a working prototype, not production software, and may contain bugs. There is **no
warranty** (see the [licence](LICENSE)) and no support.

**Privacy.** The site counts visits with [GoatCounter](https://www.goatcounter.com), which uses no
cookies and collects no personal data. Units and time-zone choices are kept in your own browser.

## A reading guide to the code

There is no build step: plain JavaScript, HTML and CSS, so you can read and change the files
directly. Start with:

- [**Code map**](docs/code-map.md): every file, and `app.js` section by section, with experiments
  to try.
- [**One highlight, end to end**](https://github.com/tehoro/weather-explorer-backend/blob/main/docs/walkthrough.md):
  a real highlight followed from the forecast files, through the AI research and the backend, to
  the shader that colours each pixel.
- [**Glossary**](https://github.com/tehoro/weather-explorer-backend/blob/main/docs/glossary.md) and
  [**design decisions**](https://github.com/tehoro/weather-explorer-backend/blob/main/docs/design-decisions.md)
  (in the backend repository, shared by both).

The main files:

| Read | To see |
|---|---|
| `site/app.js` | The map: an equal-area (Lambert azimuthal) projection centred on the view, a WebGL2 shader that inverts the projection per pixel to colour the weather field, wind particles, the timeline, Share, Save and Video. |
| `site/worker.js` | A Web Worker that decodes frames and traces isobars (marching squares) and highs and lows off the main thread. |
| `site/units.js` | Units and time zones: converting measurements inside text, choosing defaults from the browser's time zone. |
| `site/3d/app3d.js` | three.js: ray-marched cloud volume, a sea shader with isobars, particle ribbons, storm-relative blending of frames. |
| `sync.py` | Turning the backend's JSON scenes into small lossless WebP images, 8 bits per value. |
| `build3d.py` | Fetching about 1,500 pieces of GRIB2 files from Open Data with HTTP Range requests and packing them into a 3D bundle. |

The rest of this README describes each part in detail.

## How it fits together

It is an addition to the iPhone app and its backend, and changes neither. A scheduled GitHub
Action reads the backend's existing endpoints with the app key, as one more app would, converts
the scene data into small static files, and publishes them with the viewer to GitHub Pages. Viewer
traffic goes to GitHub's CDN; the backend sees one download of each scene per sweep.

```
backend (Replit) ──/api/highlights, /api/requests, /scenes──▶ sync.py (GitHub Actions, after each sweep)
                                                                │ WebP frames + feed.json
                                                                ▼
                                                     GitHub Pages ──▶ browsers
```

## Pieces

- `sync.py` — fetches the feed, requested events and scene files; writes `site/data/`. Scene files
  never change once built, so each is converted once (kept in the Actions cache). Exit 3 means
  nothing new, and the workflow then skips deploying.
- `site/` — the viewer: `index.html` (including the Help text), `style.css`, `app.js` (equal-area map projection centred on the view,
  WebGL2 colour fill, pan/zoom, timeline, wind particles, panels), `worker.js` (frame decoding, isobars, highs and lows) and
  `basemap.json` (Natural Earth 1:50m land and borders, public domain).
- `tools/make_basemap.py` — rebuilds `basemap.json` from the world-atlas TopoJSON.
- `.github/workflows/deploy.yml` — sync and deploy, then the 3D jobs (see "3D view" below). Runs when the backend signals new highlights (`repository_dispatch`, see the backend's `web_notify.py`), with a fallback schedule (03:30–04:20 and 15:30–16:20 UTC, plus every three hours); sync, cache and Pages deploy.

## Sharing and saving

- **Share** copies (or, on phones and iPads, offers through the share sheet) a link to exactly what
  is on screen: `#h=<tag>/<id>&s=<scene>&t=<valid time>&map=<style>&v=<lon>,<lat>,<zoom>`. Units
  and the time zone are left out, so each person sees their own. Each highlight is kept in `data/items/` for 7 days
  after it was last listed, so links keep working after the next sweep; an older one opens with a
  note that it may be out of date, and an expired one opens the latest highlights.
- **Save** builds a single HTML file in the browser, from files already on the site: the viewer
  plus every frame of one highlight (a few MB) or all current highlights (tens of MB), embedded as
  base64. It plays with no connection, like a saved highlight in the app. Satellite imagery still
  needs a connection; the dark and light maps don't. `units.js` and `app.js` are plain scripts
  (not modules) so the saved copy can inline them.

- **Video** draws the current scene frame by frame at 30 fps (at the viewer's playback speed) with the
  title, time, key, caption and credit, and encodes an MP4 in the browser with WebCodecs and
  [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (loaded from jsDelivr only when used). Square,
  4:5 and 16:9. The button is hidden where the browser has no `VideoEncoder`, and in saved copies.

## 3D view (tropical cyclones)

Highlights tagged `tropical-cyclone` get a **3D** button. `site/3d/` is a three.js model of the
highlight's box that you can turn, tilt and zoom: clouds and the warm core ray-marched from
humidity and temperature on 12 pressure levels, wind particles at 925 hPa (inflow) and 200 hPa
(outflow), rain, and the sea coloured by 10 m wind with isobars. It opens at the moment the map was
showing, returns to the same map view, and makes its own MP4 (same encoder as the map's Video).

`build3d.py` fetches the fields straight from ECMWF Open Data for the highlights' own run, about
1,500 range requests per storm (6–15 minutes each on GitHub's runners), and writes
`data/3d/<item>-<run>/meta.json` and `bundle.bin.gz` (4–12 MB, unpacked in the browser). The item
gets `"view3d"`. The backend is not involved.

So the map update never waits for it, it runs as separate workflow jobs **after** the site is
deployed (`build3d`, then `deploy3d` if anything changed). `sync.py` only attaches bundles that
already exist. A new storm therefore shows its 3D button one deploy later than its map. A storm
whose build fails has no 3D button, and is retried after the next sync. Bundles are kept while
the item is listed and rebuilt only for a new run.

```bash
uv run build3d.py          # build missing bundles for site/data/feed.json; exit 0 = changed, 3 = nothing new
```

## Data format

Each scene becomes `data/p/<tag>/<item>-<n>/` with `meta.json` and one lossless greyscale WebP per
frame and role (`fill/`, `contours/`; `NNN.uv.webp` holds wind u/v in red/green). Values are
8-bit: 0–254 between `lo` and `hi`, 255 missing; precipitation uses a square-root scale. This is
about a third of the size of the backend's JSON, often far less for smooth fields.

Requested events are published by their researched item only; the anonymous request text is not.

## Running locally

```bash
uv run sync.py
```

```bash
python3 -m http.server 8090 --directory site
```

`sync.py` reads `APP_KEY` from the environment, or `../backend/data/.app_key` when run inside the
project folder. Without the key you can't sync from the live backend, but everything the viewer
loads is public: the published files are under
https://weatherexplorer.neilgordon.me/data/ (`feed.json`, then the paths it lists), or run
your own backend with your own key.

## Operations

- Secret: repository secret `APP_KEY` (the key built into the app). If the app key changes,
  update it with `gh secret set APP_KEY --repo tehoro/weather-explorer-web`.
- Run now: Actions › Sync and deploy › Run workflow (or `gh workflow run deploy.yml`).
- GitHub pauses scheduled workflows in a repository with no commits for 60 days; it emails a
  warning, and re-enabling is one click in the Actions tab.
- Traffic: GitHub Pages has a soft limit of about 100 GB a month. If the viewer outgrows it, the
  same `site/` folder can be published unchanged to Cloudflare Pages (no bandwidth charge).

## Data sources and acknowledgements

**Weather data**
- **ECMWF Open Data**: IFS HRES and IFS ENS forecasts, © ECMWF, licensed under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Read from the
  [AWS mirror](https://registry.opendata.aws/ecmwf-forecasts/) and
  [data.ecmwf.int](https://www.ecmwf.int/en/forecasts/datasets/open-data). Fields are regridded and
  unit-converted. The viewer always shows *"Data: © ECMWF, CC BY 4.0. Regridded and
  unit-converted."*
- Highlights cite official warnings from national weather services, MeteoAlarm, GDACS and the WMO
  (see the backend's README). Each warning belongs to the service that issued it.

**Maps**
- Land and borders: [Natural Earth](https://www.naturalearthdata.com) 1:50m (public domain), via
  the [world-atlas](https://github.com/topojson/world-atlas) package.
- Relief: [NOAA ETOPO 2022](https://www.ncei.noaa.gov/products/etopo-global-relief-model)
  (NOAA National Centers for Environmental Information, public domain), shaded into tiles by
  `tools/make_relief.py`.
- Satellite: NASA [Blue Marble](https://earthobservatory.nasa.gov/features/BlueMarble) imagery
  through [GIBS](https://www.earthdata.nasa.gov/gibs) (NASA Earthdata).

**Software** (each under its own licence): [three.js](https://threejs.org) (MIT),
[mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (MIT), both loaded from
[jsDelivr](https://www.jsdelivr.com); [ecCodes](https://github.com/ecmwf/eccodes) (ECMWF,
Apache 2.0), [NumPy](https://numpy.org), [Pillow](https://python-pillow.org) and
[truststore](https://github.com/sethmlarson/truststore) for the data scripts (versions in
`uv.lock`); [GoatCounter](https://www.goatcounter.com) for visit counts.

**AI.** The code was written by Claude Opus 5.5 ([Anthropic](https://www.anthropic.com)). The
highlights are chosen and written by an AI model in the backend (currently GPT-6.1 Sol from
[OpenAI](https://openai.com); Claude Opus 5.5 is the alternative).

**ECMWF** supported the development, as part of Neil Gordon's role as an ECMWF Visiting Scientist,
by providing Claude Opus 5.5 usage through its enterprise account.

**People.** Neil Gordon directed the project. Thanks to the early testers.

## Licence

The code is released under the [MIT Licence](LICENSE), © 2026 Neil Gordon. You may use, copy,
change and share it, including commercially, as long as you keep the copyright and licence
notice. It comes with no warranty.

The licence covers the code only. Weather data, maps, imagery and the highlight texts keep their
own licences and terms, listed above. Because the code was written by an AI model, the extent of
copyright in it may be limited in some countries; the licence grants what rights exist.
