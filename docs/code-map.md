# Code map

A guide to finding your way round the viewer's code. There is no build step and no framework:
the files in `site/` are exactly what the browser runs. Open the live site
(https://tehoro.github.io/weather-explorer-web/) with your browser's developer tools beside this
map.

For the meaning of terms (HRES, GRIB2, CAP, Lambert projection, LUT...), see the backend's
[glossary](https://github.com/tehoro/weather-explorer-backend/blob/main/docs/glossary.md). For one
highlight followed from the forecast files to the screen, see the
[walkthrough](https://github.com/tehoro/weather-explorer-backend/blob/main/docs/walkthrough.md).
For *why* things are built this way, see the
[design decisions](https://github.com/tehoro/weather-explorer-backend/blob/main/docs/design-decisions.md).

## Files

| File | Lines | What it does |
|---|---|---|
| `site/index.html` | ~240 | The page: header, highlight list, map canvases, panels, the units menu and the Help text. |
| `site/style.css` | | Layout and theme. |
| `site/app.js` | ~2,300 | The viewer (sections below). A plain script, not a module, so Save can inline it. |
| `site/worker.js` | ~140 | Web Worker: decodes WebP frames to numbers, traces isobars, finds highs and lows. |
| `site/units.js` | ~240 | Units and time zones; rewrites measurements and dated times inside text. Exposes `window.Units`. |
| `site/basemap.json` | | Land and borders (Natural Earth 1:50m), as longitude/latitude rings. |
| `site/relief/` | | Shaded relief tiles made by `tools/make_relief.py` from NOAA ETOPO 2022. |
| `site/3d/index.html`, `site/3d/app3d.js` | ~850 | The 3D tropical cyclone view (three.js, an ES module). |
| `sync.py` | ~310 | GitHub Action: downloads the feed and scenes from the backend and converts them to WebP. |
| `build3d.py` | ~350 | GitHub Action: builds the 3D bundles straight from ECMWF Open Data. |
| `tools/make_basemap.py`, `tools/make_relief.py` | | One-off scripts that made `basemap.json` and the relief tiles. |
| `.github/workflows/deploy.yml` | | The pipeline: sync, deploy, then build and deploy 3D bundles. |

## `site/app.js`, section by section

Each section starts with a banner comment (`// ------` above and below a title). Search for the
title to jump to it. Line numbers are approximate and drift as the file changes.

| Section (search for) | ~Line | Key functions | What happens |
|---|---|---|---|
| top of file | 1 | `fileUrl`, `track`, `frameSource` | Constants, data URLs, visit counting. `mercY`/`invMercY` convert latitude to and from Web Mercator. |
| `State` | 70 | `S` | One object holds everything that changes: the feed, the chosen highlight and scene, loaded frames, playback position, and the view `{lon, lat, s}` (centre and pixels per Earth radius). |
| `Worker` | 95 | `startWorker`, `ask` | Starts `worker.js` (or runs the same code on the page in a saved copy) and sends it jobs, each answered by a promise. |
| `Canvases` | 147 | `projection`, `toScreen`, `toWorld`, `fit`, `flyTo` | Five stacked canvases (`base`, `field`, `coast`, `overlay`, `particles`). `projection()` holds the Lambert azimuthal equal-area maths: `fwd` (lon/lat to x/y) and `inv` (back). `flyTo` animates between views along the globe. |
| `Basemap` | 349 | `drawTiles`, `drawBase`, `drawGrid` | Map backgrounds: dark and light land from `basemap.json`, relief and satellite tiles warped into the projection on a second WebGL canvas, and the latitude/longitude grid. Land rings that contain the point opposite the view's centre are filled inside out. |
| `Colour fill (WebGL2)` | 724 | `setupGL`, `makeLUT`, `frameTexture`, `drawField` | The heart of the map. A fragment shader runs once per screen pixel: inverse projection to lon/lat, then Web Mercator y, then grid position; it samples two frames, blends them by time (`mixT`), undoes the square-root scale, and looks the value up in a colour table. Categorical layers (precipitation type) skip blending. |
| `Overlay` | 922 | `drawOverlay`, `runContours` | Isobars with labels, H and L centres, and the highlight's labelled `focus` places, drawn on a 2D canvas. |
| `Wind particles` | 1091 | `windAt`, `stepParticles` | Streaks carried by the wind frames, moved by elapsed time (`STREAK_SPEED`) so they look the same on 60 Hz and 120 Hz screens. |
| `Loading a scene` | 1161 | `loadScene` | Reads the scene's `meta.json`, then loads frames in order through the worker, so playback can start before all frames arrive. `S.token` discards results from a scene the viewer has already left. |
| `Timeline and playback` | 1253 | `play`, `tick`, `updateTime` | The animation loop (`requestAnimationFrame`), speed, the slider, and captions shown at their times. |
| `Pan, zoom and click readout` | 1360 | `zoomAt`, `readout` | Mouse, touch and keyboard. Panning turns the globe. Clicking shows the value under the pointer in the viewer's units. |
| `Panels` | 1495 | `renderList`, `renderDetails`, `renderLegend`, `setupUnits` | The highlight list, scene tabs, the text panel, the colour key and the units menu. All text goes through `esc()`, and links through `safeUrl()`, before reaching the page. |
| `Feed and routing` | 1767 | `loadFeed`, `parseHash`, `route` | Loads `data/feed.json` and opens whatever the link (`#h=...&s=...&t=...&v=...`) asks for. |
| `Sharing` | 1833 | `shareLink` | Builds a link to exactly what is on screen. |
| `Saving a copy` | 1877 | `saveCopy` | Builds one offline HTML file: the page, the scripts and every frame as base64. |
| `Making a video` | 1983 | `drawVideoFrame`, `makeVideo` | Redraws each frame at video size with titles and credit, encodes with WebCodecs and packs an MP4 with `mp4-muxer`. |

## `site/3d/app3d.js`

| Section (search for) | What happens |
|---|---|
| top comments | The scale: 100 km per world unit horizontally, heights exaggerated (slider, default 60×); particles sped up 7000×. |
| `Renderer, camera, controls` | three.js scene, orbit controls. |
| `Per-frame textures` | Unpacks the bundle into textures: surface wind, pressure (smoothed), rain, and a 3D texture of humidity and temperature. |
| `Sea surface and plinth` | A shader colouring the sea by 10 m wind, with foam, isobars (drawn with `fwidth` for even line widths), graticule and sun glint. |
| `Cloud and warm-core volume` | Ray marching through the 3D texture: cloud where humidity passes the threshold, thinned above about 8 km, with self-shadowing; the warm core in orange. |
| `Storm centre`, `eyeShift` | Storm-relative blending: near the eye, each 3-hourly frame is shifted so the eyes line up before blending, which avoids a "double eye". |
| `Wind particles with fading trails` | Ribbons at 925 hPa (inflow, teal) and 200 hPa (outflow, amber). |
| `Rain streaks`, `Storm track`, `placeLabels` | Rain, the track of minimum pressure, and labels (places, eye pressure, N/E/S/W). |
| `Loop` | One step of everything per screen refresh, or per video frame. |
| `Video` | Renders the whole forecast to an MP4 with overlays. |

## Data scripts

- **`sync.py`**: `to_u8` turns the backend's 16-bit values into 8-bit (square root for
  precipitation), wind becomes `NNN.uv.webp` (u in red, v in green) and contour fields `NNN.c12.webp`
  (12 bits split over two channels). It keeps each highlight for 7 days so shared links work, and
  exits with 3 when nothing changed so the workflow skips deploying.
- **`build3d.py`**: for each tropical cyclone, fetches IFS HRES fields on 12 pressure levels for
  the highlight's box and window (about 1,500 HTTP Range requests, 8 at a time), decodes them with
  ecCodes, interpolates humidity and temperature to 24 heights, and writes `meta.json` and
  `bundle.bin.gz`.

## Good first experiments

- Change a colour in a layer's stops (in the backend's `fields.py`) or the shader's blending in
  `drawField`, and reload.
- In the console, try `S.view` and change it, then call `drawAll()`.
- Log `projection(S.view).fwd(174.8, -41.3)` (Wellington) and check `inv` gives it back.
- Slow `STREAK_SPEED` or change the particle count and watch the wind.
- In the 3D view, change the humidity threshold and see how much "cloud" depends on it.
