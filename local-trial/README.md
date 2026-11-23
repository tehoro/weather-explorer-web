# Local development trial

> **Development checkpoint — 20 November 2026.** The current trial supports
> worldwide terrain and weather, global location search, forecast clouds on the
> globe, and a staged globe-to-regional transition. The early sections below
> describe the original NZ experiment; later sections record the worldwide work.
> This directory is separate from `site/` and is not deployed by GitHub Pages.
> Saving it in the public web repository preserves the code, not a private copy
> of the generated forecast datasets.

Local-only Weather Explorer experiment for Cook Strait to Manawatū Gorge and
the Southern Alps. Nothing in this directory is included in the production
GitHub Pages workflow: that workflow deploys `site/`, not this directory.
There are no Replit changes, new production endpoints or paid model calls.

From `web/`:

```sh
.venv/bin/python local-trial/serve.py --port 8091
```

Open <http://127.0.0.1:8091/>. The server binds to loopback only. Local opens a
spinning globe, with region buttons, click selection and an offline NZ place
dropdown (or latitude, longitude). Now and Past events show the existing local
web viewer. Neither those snapshots nor the Local forecast refresh automatically.

Choose a location to fly northwards into the terrain. Drag/orbit, zoom, pan,
use the three-hour timeline, and switch **Cloud display** between:

* Humidity volumes: IFS relative humidity and forecast geopotential heights at
  1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100 and 50 hPa.
  Surface pressure masks below-ground levels. Threshold, opacity and vertical
  exaggeration are display settings.
* Low/middle/high cloud cover: actual IFS `lcc`, `mcc`, `hcc` fractions, with
  opacity proportional to fraction. Schematic bands are 0.4–1.9 km above the
  estimated model terrain, roughly 3–5.5 km ASL (raised above high terrain),
  and 8–11 km ASL. These are not cloud-base or cloud-top predictions.

The cloud-cover files are separate: switching to this mode does not download the
vertical humidity arrays for subsequent times. Rain and snow remain independent
of cloud mode and RH threshold. They are mean rates over the preceding three
hours, derived from accumulation differences within a single IFS run. Snow is
water equivalent. Wind is IFS 10 m wind; fine DEM terrain does not downscale it.

## Prepare another forecast

Use an available IFS run, three-hour steps from 3 through 144:

```sh
.venv/bin/python local-trial/prepare.py --run YYYYMMDDHH --start 12 --end 84
```

The builder checks the actual surface/pressure-level indexes and requests only
selected messages from AWS, with ECMWF as fallback. Both regions are cut from
each decode. Static forecast files and reference terrain are in gitignored
`data/`. Raw GRIB messages are cached outside Dropbox at
`/private/tmp/weather-explorer-local-ifs-cache/` to avoid syncing gigabytes of
temporary downloads. Interrupted builds reuse completed files and cached messages.
The operating system may eventually clear that temporary cache; it can be downloaded again.
The manifest is replaced only after the requested forecast is complete.

For a genuinely lighter preparation, `--clouds cover` omits the humidity profiles
and their heights. It still needs 925 hPa temperature and height to estimate the
model surface elevation. `--out /path/to/private-output` makes an isolated set.
Native model surface geopotential is not in the checked surface index; the
estimated elevation is labelled and is not a substitute for the detailed DEM.

`--name example --bounds WEST EAST SOUTH NORTH` can prepare a different rectangle.
The current renderer and Copernicus tile supply are configured for the two NZ
regions; preparing other weather rectangles alone does not add terrain support.
The CLI currently excludes dateline-wrapping boxes and the polar caps.

## Why preparation is needed

A Range request selects a field/level/time, not a geographic crop. The downloaded
message is still global. For this experiment the expensive part is done once on
the Mac, and the browser reads small static regional arrays. The raw GRIB cache
can supply another region without another download for the same fields and run.

Worldwide browser access is possible with a browser GRIB decoder, CORS-compatible
access and sufficient bandwidth/memory. A cloud-cover-only product would be a
useful first candidate. Preparing global weather tiles once per run is a different
option: small browser downloads, but substantially more preparation and storage.
Neither route needs per-visitor processing on the Replit highlights server.

## Terrain and source provenance

The renderer, worker, page styling and OrbitControls were copied from Neil
Gordon's public Weather3D site on 20 November 2026, renderer version
`0182af7634c2`, worker version `ae3f5aa7df65`, and adapted for this private trial.
Three.js is the reference viewer's vendored **0.180.0** (MIT licence headers
retained). The production cyclone viewer remains on its existing version.
Changes for this trial were written by OpenAI Codex at Neil Gordon's direction.

The local server reads and caches only existing static terrain tiles at
`weather3d.neilgordon.me/terrain-assets/adaptive-v1/{otaki,alps}/tiles/...`.
No Bris forecast data is used in the trial. Initial low-detail Copernicus terrain
and coastline samples were extracted from the reference viewer's `terrain.json`.
The archived reference samples are under `data/reference/`; a fresh checkout
without those samples falls back to estimated model terrain until adaptive tiles
arrive. Zooming to a new area needs network access for uncached DEM tiles.

Terrain credit: Copernicus DEM GLO-90, © DLR e.V. 2010–2014 and © Airbus Defence
and Space GmbH 2014–2018. Coast masks: ESA WorldCover 2021 v200, CC BY 4.0;
Natural Earth public domain. Weather: © 2026 ECMWF, CC BY 4.0. Regridded and
unit-converted. Illustrative model guidance, not an operational ECMWF service.

### Terrain redistribution and open source

Checked 20 November 2026: the specific GLO-90 licence grants reproduction,
distribution, public communication and modification, free of charge. These are
conditional rights, not a public-domain dedication. The terrain retains its
own licence independently of the application source-code licence.

Before publishing any original or processed terrain, include the exact source
notice (or modified-data notice), liability notice and downstream obligations
from Article 6, and do not imply official endorsement. Keep provenance and the
licence link with exported data, not only in the viewer. This applies to a
separate static tile store as well as files distributed with the code.

Official source: [GLO-90 licence, PDF pages 19–21, Articles 4–6](https://dataspace.copernicus.eu/sites/default/files/media/files/2025-06/copernicus_contributing_mission_data_access_v2_cop_dem_licenses.pdf#page=19).
The same PDF contains other, restrictive licences: use the GLO-90 section,
not the general restricted-data terms at its beginning. Nothing in this trial
publishes a terrain mirror or changes the data licence.

The inherited Weather3D view-count and AI text-forecast requests were removed.
Point inspection works; the separate point-forecast and AI products are not part
of this trial. The global globe is navigable, but the place list and prepared
weather are deliberately limited to NZ for this first visual trial.

## Checks

```sh
.venv/bin/python -m unittest discover -s local-trial -p test_trial.py -v
node local-trial/test-clouds.mjs
node --check local-trial/assets/terrain.js
node --check local-trial/globe.js
```

The Python checks compare prepared winds, temperature, height, humidity masks and
three-hour precipitation with the actual cached GRIB values. The worker check
verifies zero/partial/full cover and no invented middle cloud. Browser checks
cover both regions, both cloud modes, time changes, place search and terrain LOD.

Verified 20 November 2026 with the 19 November 18 UTC IFS run: 25 times per
region, from 20 November 19:00 to 23 November 19:00 NZDT. The native-GRIB checks
and worker checks pass. Browser checks include Wellington search/flight, zoomed
terrain, both regions and cloud modes, three-hour stepping and the final +84 h
cloud-cover frame. The global message cache is 1,706 MB; the prepared trial data,
reference overviews and currently cached terrain tiles total about 48 MB.

## Global preparation benchmark (20 November 2026)

### Worldwide streaming update

#### Coastline, joins, colours and loading fixes

The distant stepped black boundary was a coverage-selection defect, not a cache
miss: only a radius around the orbit target was requested. Selection now also
intersects coarse one-degree tiles with the camera's ground footprint, including
the upper corners of a tilted view. These distant tiles use 25 cells per degree
and 64-pixel colour maps; the foreground retains its existing adaptive detail.
A global Natural Earth land/sea basemap is present immediately underneath the
streamed geometry, extending across the view without a stepped tile boundary.
It preserves geographic land rather than assuming all unloaded ground is ocean.
An above-horizon view uses a blue background rather than black.

The working set is at most 64 foreground plus 192 coarse background patches,
with up to 36 older meshes retained while replacements arrive. Resize and orbit
changes recompute coverage. These background changes do not add a server-side
processing step or any external deployment.

The reported false land west of the North Island was reproduced at
40.4586°S, 174.5048°E: WorldCover class 0 (no data) and Copernicus height 0.
The previous fallback coloured this as land. Zero-filled, unclassified sea-level
pixels now use the water colour; explicitly classified land at sea level stays
land, and missing classification at nonzero elevations does not become water.

Terrain sampling now uses exact geographic positions and the TIFF's point/area
pixel convention, including the centre shift of averaged overviews. Patch edges
have a single source-file ownership rule, and share one-sample halos for normals.
The old independent rounded-window resize was removed. A real-data check compares
both heights and normal differences across 175°E; they match exactly.

The default is Relief + land cover, blending Weather3D elevation colours with
muted WorldCover land classes. Lighting follows Weather3D. The Landscape colours
selector also offers pure Weather3D relief and land cover.
Elevation colours' pale summits are not current snow. The optional land-cover
palette's snow/ice class is static 2021 mapping, also not current snow. A forecast
snow overlay is still separate future work.

Build 20 Nov B labels the full-view version in the sidebar and versions its local
JavaScript module URLs so an older cached script cannot hide the coverage fix.

Terrain appears before its water/land-cover refinement. GeoTIFF file and image
objects are reused, decoded blocks are now actually cached (the previous
`fromUrl` option did not enable the decoder cache), and successful immutable
range responses allow browser caching. The local disk byte cache survives browser
reloads; decoded blocks do not survive a full page reload. New geography still
requires downloads. In the regression run a repeat decoded DEM grid took 4.9 ms;
this is not a whole-view/network loading benchmark.

Checks: `node local-trial/test-raster.mjs` and, with port 8092 running,
`node local-trial/test-raster.mjs --live`. The latter checks actual cross-file
edge heights/normals and the reported offshore water samples.

`global-test.html` now streams terrain automatically as the view pans, rather
than requiring prepared local areas. Drag to pan, right-drag to orbit, and scroll
or pinch to zoom. The location list is a set of shortcuts, not a coverage limit;
arbitrary coordinates work too. A local tangent view wraps across the date line;
navigation is limited to 89.85° north/south rather than the exact poles.

Detail adjusts automatically from roughly 1.5 km in wide views to 93 m nearby.
Only the required TIFF overview or native pixel windows are decoded. The browser
keeps at most 64 foreground and 192 coarse background patches, up to 36 older
meshes during refinement, and 12
TIFF handles. Previous surfaces stay visible while new detail arrives. Skirts
cover minor joins between resolutions. Terrain heights are exaggerated 1.5×.

WorldCover 2021 v200 class 80 colours sea, lakes and mapped rivers blue, including
lakes above sea level. Small waterways are limited by the source classification
and displayed resolution. Water classification is static, not an ice forecast;
snow/ice treatment is deferred. If a water source is unavailable the viewer shows
terrain and an explicit notice rather than inventing water. Ocean-only DEM tiles
are identified by the source catalogue. Terrain failures remain retryable.

Run `Start Worldwide Terrain.command` (port 8092), or use the Python command below.
The loopback server now retrieves and caches immutable upstream byte ranges in
`/private/tmp/weather-explorer-range-cache`, restricted to Copernicus DEM and ESA
WorldCover URL patterns. It does no decoding, regridding or weather computation.
This local static-byte gateway removes the need for manual tile preparation and
works around upstream browser access restrictions. GitHub Pages alone cannot run
this gateway: a public version will need CORS-enabled static tiles or a suitable
byte-serving cache. No public service has been created.

The globe opens this view for globe clicks and location searches anywhere. The
two explicitly labelled regional weather buttons retain the original animations.
Worldwide animated cloud/wind layers are not yet wired
into this terrain renderer; centre-point IFS readings are available globally.

Checks: `node local-trial/test-stream.mjs`, JavaScript/Python syntax checks and
browser checks of coastal water, zoom refinement and new terrain on panning.
Verified in-browser: Cook Strait at 371 m then 93 m, blue sea/harbours and mapped
waterways; Lake Geneva loaded without any manual preparation; dragging from
6.5000°E to 7.0303°E loaded new terrain (34/34 patches), then zooming out selected
741 m sampling. Lake surfaces are blue at their DEM elevation. Seasonal snow
and frozen-water classification remain deferred.

### Earlier preparation measurements

The separate technical test is at `http://127.0.0.1:8092/global-test.html`:

```sh
.venv/bin/python local-trial/global_weather.py --run 2026111918 --start 12 --end 84
.venv/bin/python local-trial/prepare_dem.py --point 45.83 6.86 --point -43.6 170.14
.venv/bin/python local-trial/global_serve.py
.venv/bin/python -m unittest discover -s local-trial -p test_global.py -v
```

Outputs are outside Dropbox, under `/private/tmp/weather-explorer-global` and
`/private/tmp/weather-explorer-dem`. They are disposable local caches; regenerate
them if the OS removes temporary files. The new server serves static bytes only,
with HTTP Range support. Neither server is exposed beyond loopback.

Measured complete global weather, 25 three-hour frames (+12 to +84 h):

| Item | Result |
| --- | --- |
| Indexed source GRIB messages | 479,499,900 bytes |
| Native 0.1° tiles | 555,158,170 bytes |
| 1° preview tiles | 15,533,393 bytes |
| Local preparation | 34.496 seconds |
| New downloads in this benchmark | Zero; existing GRIB cache reused |

These timings exclude cold downloads and uploads. The tile set is 570.7 MB of
compressed payload (about 624 MiB allocated on this filesystem because of many
small files). Each resolution has 648 ten-degree tiles per frame. Each fine
tile includes 101×101 samples, with shared edges. Longitude is normalised from
the GRIB's 180° start to 0°; no spatial interpolation. The coarse version samples
every tenth point for preview, not area-average quantitative use.

Fields are 10 m u/v, 2 m temperature, MSL pressure, preceding three-hour total
precipitation and snow rates, and low/middle/high cloud fractions. Wind,
temperature and pressure quantisation is 0.1 in their display units; cloud
fractions are 8-bit; precipitation uses a square-root encoding. There are no
humidity profiles. Tests passed against ecCodes' independent nearest-point
lookup in both hemispheres, near both poles and the date line, and checked tile
seams and all 25 frames' tile inventories.

Six original one-degree terrain COGs were downloaded: Mont Blanc, Aoraki,
Everest, Andes, Svalbard and Fiji near the date line. These took 1.9–12.5 seconds
each on this connection and occupy about 26 MiB with the global catalogue.
The browser decoded Mont Blanc's 300×300 overview using 0.31 MB of HTTP range
payload in 0.37 seconds, and its 1200×1200 native grid using 3.91 MB in 0.78
seconds. Svalbard's native grid is 400×1200 (longitude spacing varies with
latitude), and loaded 1.06 MB in 0.38 seconds. These browser timings use local
static files, excluding internet latency. Direct AWS browser access failed;
the tested AWS response did not include an Access-Control-Allow-Origin header.

The earlier version of this page measured one-degree COG loading, manually switching
overview/native resolution. It also reads the global weather tile at the chosen
point. It is not continuous worldwide terrain LOD or the finished global Local
viewer. In that earlier version, new terrain locations had to
first be cached with `prepare_dem.py`; the streaming update removes that requirement. Missing land files are reported, not
silently replaced by flat ground. The catalogue identifies ocean-only tiles.

The next integration can use smaller prebuilt terrain tiles and a static object
store with browser CORS support. Terrain preparation is a one-off job; weather
preparation runs for each selected new IFS cycle, only publishing a new manifest
after a complete build. GitHub Actions can run that preparation later, independently
of the highlights pipeline. Keep at least the previous complete weather run while
publishing the next; two runs alone exceed 1 GB, before existing viewer data or
terrain. No Actions workflow or external storage has been enabled.

Build 20 Nov C matches Weather3D navigation: left-drag rotates/tilts,
Shift-left-drag or right-drag pans, and wheel/middle-drag zooms. Touch uses
one finger to rotate and two fingers to pan/pinch. Panning stays parallel
to the ground.

### Worldwide weather display (build 20 Nov D)

`weather-data.mjs` decodes the static global fine tiles to physical units before
bilinear sampling (including squaring precipitation before interpolation). It
loads only the view's tiles, with four concurrent fetches and a 96-tile LRU.
Superseded views stop scheduling requests; a failed frame keeps the previous
valid forecast and shows a retry control. No weather processing runs on the server.

`weather-view.mjs` adds accelerated 10 m wind ribbons following display terrain,
precipitation streaks, three independently switchable cloud layers, 2 hPa
isobars, temperature/wind/precipitation surface colours and a 25-frame timeline.
Playback advances every three seconds after loading, with a 1.2-second visual
blend. It stops at the final forecast. It uses the existing prepared run; this
change does not install automatic forecast refresh or deploy a workflow.

Cloud fractions use IFS lcc/mcc/hcc, with textured transparent slabs at schematic
heights above the displayed terrain. Their thickness, texture and placement are
illustrative, not modelled cloud geometry. High cloud is thinner. No humidity
fields are loaded. See ECMWF's definitions (pressure/surface pressure):
https://confluence.ecmwf.int/spaces/FCST/pages/111155326/How%2Bare%2Blow%2Bmedium%2Band%2Bhigh%2Bcloud%2Bcover%2Bdefined
Low > 0.8; middle 0.45–0.8; high <= 0.45. Overlapping cloud fractions must not
be added to derive total cover. Precipitation is independent of cloud visibility,
and represents the preceding three-hour mean total precipitation; streaks turn
white where snowfall supplies most of that water equivalent.

The centre reading is interpolated. Trail movement is accelerated for legibility;
it does not resolve local wind effects below the IFS grid spacing. Surface colour
ranges and wind colours are described in the panel. Terrain continues to refine
independently; cloud geometry adjusts to arriving terrain every two seconds. Surface weather
and isobars are shaded directly on terrain meshes, avoiding a separate sheet
cutting through hills. Cloud opacity is adjustable without altering cloud fractions.

Checks: `node local-trial/test-weather.mjs` verifies real tile decoding and seams,
dateline sampling, interpolation and superseded request handling; existing
terrain/raster checks remain applicable. Browser checks cover Cook Strait,
Southern Alps, time playback, controls and wet-weather rendering.

### Weather3D-style controls (build 20 Nov E)

The worldwide viewer now has a bottom forecast timeline and playback bar, a
collapsible settings panel on the right, and a large local forecast clock at the
upper right of the unobscured scene. Settings group location, weather, view and
terrain, centre readings and loading details. Help contains interpretation notes.
Clean view hides controls; the header restores them. Playback provides previous /
next three-hour frame, speed, and Now (nearest available forecast, clamped to the
prepared range). Model initialisation remains labelled in UTC.

`local-time.mjs` resolves the view centre to an IANA time zone and formats every
forecast timestamp, including timeline endpoints, using that zone's daylight
saving rules. The coordinates stay in the browser. Ocean zones are supplied by
the lookup dataset; boundaries are approximate. The displayed zone identifier
and UTC offset tooltip make the chosen zone explicit.

Vendored dependency: `@photostructure/tz-lookup` **11.7.0**, from
https://cdn.jsdelivr.net/npm/@photostructure/tz-lookup@11.7.0/tz.js
(CC0-1.0, licence in `assets/LICENSE.tz-lookup`). Source and boundary-data
provenance: https://github.com/photostructure/tz-lookup . No runtime CDN call or
new server endpoint is required. Browser Intl supplies the time-zone rules.

Checks: `node local-trial/test-local-time.mjs` covers NZ summer/winter, European
and US locations, the Chathams' quarter-hour offset and longitude wrapping.

### Place labels and clock contrast (build 20 Nov F)

`prepare_places.py` converts GeoNames `cities500.zip` into five-degree static JSON
files in `data/places/`, with a manifest recording the source hash and preparation
time. The current extract contains 225,672 populated places after excluding city
sections and historical/abandoned settlements. Source names are retained in UTF-8.
Data: GeoNames, CC BY 4.0, filtered and tiled; attribution is shown in the viewer.
Rebuild with `python local-trial/prepare_places.py /path/to/cities500.zip`.

`place-labels.mjs` loads only geographic tiles needed by the view, with four
concurrent requests and a bounded cache. It projects candidates onto the screen,
then `place-selection.mjs` favours population and separation, with a small bonus
to retain existing labels. Up to five names appear, avoiding controls and each
other; sampled terrain occlusion rejects places behind ridges. Zooming narrows
the pool, bringing smaller towns into consideration. Sparse views can have fewer
than five; this settlement extract is not a complete village or natural-feature
gazetteer. Labels can be switched off under View & terrain.

The time-zone line has larger, heavier white text on a dark translucent backing
to preserve contrast over snow and cloud. Checks: `node local-trial/test-places.mjs`
covers date-line tile selection, ranking, overlap, panel avoidance and sparse views.

### Globe continent wrapping (build 20 Nov G)

The Natural Earth basemap stores continuous, unwrapped rings. Its connected
Africa/Europe/Asia ring spans approximately −378° to −170° longitude. Drawing it
only once on a −180° to +180° texture omitted most of those continents.
`basemap-texture.mjs` now draws periodic copies intersecting the canvas without
splitting or changing the rings. Both the initial globe and the worldwide terrain
context map use this helper. `node local-trial/test-basemap.mjs` checks actual
land coverage in every continent, both sides of the date line and ocean samples.

### Worldwide location search (20 November, build J)

The globe and terrain settings share `location-search.mjs`. `prepare_search.py`
builds static prefix shards from the same GeoNames cities500 source as the labels,
including alternative names, country and administrative codes. Only the requested
two-character prefix is fetched; results prefer exact names then population.
Search accepts a country after a comma (for example `Wellington, New Zealand`),
accented or alternative names, and latitude/longitude. The catalogue covers
settlements worldwide, not every named mountain, street or geographical feature;
coordinates or globe selection reach those locations. No external search API,
key or per-request server processing is needed. GeoNames attribution is retained.
The regional cards, outlined NZ areas and settings presets have been removed.
Run `node local-trial/test-search.mjs` to check global names and coordinates.

### Terrain transition coverage (20 November, build L)

Fixed gaps where a fine quarter-degree patch suppressed its entire one-degree
background tile. Partially occupied parents now request each remaining visible
quarter, using coarse geometry without overlapping fine meshes. Transition
patches have priority over distant background requests; the 256-patch bound
remains. `test-stream.mjs` checks continuous coverage at three zoom distances
around San Francisco and across the date line, alongside the existing LOD tests.

### Forecast globe and regional approach (20 November, build N)

Local uses the Highlights globe's published OLR WebP frames, the same .22–.85
opacity transfer, interpolation and three forecast hours per second. These are
forecast cloud-top illustrations, not observed satellite images. Refresh the local
static cache with `python3 local-trial/prepare_globe.py`; nothing is published.
The current cache is the 19 November 12 UTC run. The globe clock shows valid time.

The Three.js globe has dark land/sea, boundaries, graticule and an atmospheric
rim. It is not the Highlights renderer itself. `globe-places.mjs` uses the GeoNames
overview generated by `prepare_places.py`, adding the existing full place tiles
when close. About five visible place buttons are selected with collision avoidance
and preference for retained labels. Positions update every render frame; selection
updates less frequently to prevent flicker. Dragging or zooming pauses rotation;
Resume rotation restarts it. Globe points, labelled places and initial search
share the same destination path.

The destination iframe loads during the spherical approach. Once its three
central terrain patches are ready (or some terrain after 12 seconds), the globe
crossfades into a downward regional approach, finishing about 150 scene kilometres
from the target. Other tiles keep refining. This is a staged zoom and crossfade,
not a single continuous Earth/terrain renderer. The selected cloud time is passed
to the nearest available Local forecast frame. Reduced motion removes the camera
animation and fade. Return to Globe restores the previous camera position.

Browser-checked Sydney label selection through to terrain, weather, timeline and
23/23 loaded terrain patches, plus return to the globe. Regression checks cover
place selection, terrain coverage, search and weather decoding.

## Contour work in progress at the branch checkpoint

The trial now has JavaScript marching-squares contour segments with saddle-point
handling, adaptive 4/2/1 hPa intervals and a Top-down/Slanted view selector.
`test-isobars.mjs` checks gradients, closed lows, saddle points and interval
hysteresis. Visual validation and the following work remain unfinished:

- Add pressure labels that retain their positions on successive contours.
- Connect `prepare_pressure.py` native Float32 hPa tiles to the browser reader.
  The script reads cached IFS GRIB messages and adds a `pressure_path` to the
  manifest after all tiles are built; the current reader still uses the packed
  0.1 hPa pressure channel.
- Review smooth movement of low centres and frame interpolation before release.

The production highlights are a useful reference: `site/worker.js` builds
marching-squares segments and finds pressure extrema. `site/app.js` retains
contour labels near their previous grid positions, adds new labels in a stable
order, and excludes overlaps. Its `eyeShift` and worker `values` functions
interpolate fields relative to a known storm track, avoiding double centres.
Those storm tracks are prepared by `backend/tracks.py`; arbitrary local views
have no corresponding track yet. Do not assume ordinary field blending gives
the same result or copy a highlight's storm track into an unrelated region.

## What the branch preserves

All trial source, vendored runtime libraries and licences, tests, source
provenance and preparation scripts are versioned. `data/`, logs, PID files and
Python caches are deliberately ignored. Generated forecast tiles and raw GRIB
caches under `/private/tmp/weather-explorer-*` are also outside Git and can be
cleared by the operating system. Existing local data is left in place. Rebuild
using the preparation commands above with an available Open Data run; the
November 2026 forecast will not remain downloadable indefinitely. An exact
archive of that forecast requires a separate data backup.

This is a development checkpoint, not a release. Merge and deployment require
separate approval and completion of the outstanding validation. Keeping the
trial directory separate means merging this checkpoint alone does not replace
the production viewer.

## Labelled pressure contours and wider views (20 November, build S)

The Local viewer now carries across the highlights' persistent contour-label
approach. Labels follow the nearest point of their previous pressure level;
new labels use a stable candidate order. Both view angles use terrain-draped
lines of constant screen width, with labels projected every render frame.
Labels avoid controls and place names and are suppressed behind terrain.
The isobar interval is automatically 4, 2 or 1 hPa, with zoom hysteresis.

High/low markers use local extrema with a wider neighbourhood check, as in the
highlights, plus a sub-grid quadratic fit. For adjacent frames up to six hours
apart, mutually unambiguous centres are matched within a distance/time and
pressure-change limit. Their surrounding pressure fields are shifted towards
the interpolated centre before blending, with influence tapered to zero at the
edge. Ambiguous matches, disappearing centres and large scrubs use ordinary
field blending. These local matches are not authoritative named storm tracks.
Readouts retain the unmodified forecast interpolation; contour smoothing and
motion interpolation are display treatments.

The native-precision pressure supplement is now read when `pressure_path` is in
the manifest. Run `.venv/bin/python local-trial/prepare_pressure.py` after the
global builder to produce it from cached GRIB. Older manifests remain supported
using their 0.1 hPa packed pressure. The current local run has the supplement.
The earlier checkpoint's outstanding label and pressure-reader tasks are done.

The regional camera can now pull back to 1,200 km (previously 300 km); the weather
footprint and far clipping plane were expanded with it. At wide scales the
static global basemap supplies context outside the bounded terrain tile budget.
This remains a regional planar view, not a return to the rotating globe.

Validation: analytic moving lows retain their depth and move continuously;
sub-grid centre fitting, ambiguous match rejection, exact endpoint fields,
label anchoring and Float32 decoding are covered by `test-pressure-motion.mjs`.
Existing contour, weather and terrain-stream tests pass. Browser checks cover
Alaska pressure labels, a low marker, both view angles and wider zoom.

## Globe point selection (build T)

Click a named marker once, or double-click any unlabelled point on the globe,
to use the same regional approach. A single background click pauses rotation;
dragging only rotates. Point picking raycasts the visible sphere and transforms
the hit back through the globe's current rotation before deriving coordinates.
Repeated clicks during an approach are ignored so they cannot restart the flight.
Verified by rotating the globe and double-clicking unlabelled inland Australia.

## Rain streaks, colours and automatic buffering (22 November, build B)

Mixed landscape colours now use 90% elevation relief and 10% WorldCover colour;
pure relief and pure land-cover options remain. Water classification is unchanged.

Settings > Precipitation style offers the original raindrops/snowflakes (default)
or rain streaks/drifting snow. The latter uses 8,000 candidate particles on desktop
and 3,000 on narrow screens. Density follows total IFS precipitation; its snow
fraction determines how many become small soft white snow particles. Snow falls
more slowly with lateral flutter. Rain slants with the 10 m wind. Both terminate
at the terrain. Heights, speeds and particle sizes are illustrative, not cloud-base
measurements. No CA3D source was copied; the new renderer uses the trial's data.

There is no Freeze or Prepare mode. New views automatically buffer all forecast
times for their current footprint, prioritising upcoming times, and wait for the
bounded terrain/land-cover tile set. A small loading status shows progress while
wind, precipitation and cloud effects continue. Forecast playback waits until
ready, then continues if Play is active; a user-paused timeline remains paused.
Panning to a different footprint invalidates the old buffer. Failures stop forecast
playback and offer retry instead of silently claiming completion. Camera controls
remain usable. Automatic IFS run refresh is described below (build E).

The viewport forecast grids are kept in memory for immediate playback. Raw tile
cache size remains bounded. Detailed terrain still has the existing tile budget;
'ready' means the selected detail for this view, not full 90 m coverage of the
whole visible region at wide zoom.

Validation: precipitation tests cover rain-only, snow-only, dry fields, terrain
clearance and visibility toggling. Existing weather and terrain-stream tests pass.
Browser checks at Sydney reached 43/43 terrain patches and 25/25 forecast frames,
then played buffered frames and paused while retaining moving weather effects.
Both precipitation styles were selected successfully.

### Coarse global terrain and repeat visits (build C)

A bundled 3.8 MB gzip grid of NOAA ETOPO1 surface elevations now supplies real
coarse relief everywhere, including the poles, beneath the streamed Copernicus
terrain. It uses 10 arc-minute sampling (about 18.5 km north–south), the same
relief colour ramp, and the same 1.5× height exaggeration. The renderer samples
this grid on a moving viewport mesh; no global high-resolution download is needed.
The land/sea backdrop remains an emergency fallback if this asset cannot load.
ETOPO1 is public domain; source and rebuild instructions are in
`prepare_global_relief.py`. Coarse coastlines and mountains will change as finer
Copernicus/WorldCover data arrives. This is elevation, not current snow cover.

Camera controls never wait for downloads. Existing geographically located weather
continues moving while new coverage loads. The loading panel is non-blocking.
Readiness is checked against every selected terrain/land-cover patch even when
a zoom changes detail without changing the forecast footprint. Zoomed-out views
are still bounded by the terrain budget; coarse global relief fills beyond it.

Sampled elevation and land-cover grids are now cached in IndexedDB, keyed by
source version, location, sampling resolution and halo. The limit is 256 MiB,
with older entries evicted first. Cached grids survive reloads and revisits in the
same browser/origin; private browsing, clearing site data, or browser eviction can
remove them. Cache errors fall back to normal streaming. A small in-memory mesh
reserve makes returning to a recent zoom faster. The existing loopback server's
raw byte-range cache is unchanged. Forecast buffers remain scoped to their run.
Previously unseen finer detail still needs downloading; a ready wide view does
not promise every possible close-up is already cached.

Checks: `test-global-relief.mjs` verifies real mountain heights, sea level, poles,
longitude wrapping and malformed data. `test-terrain-cache.html` exercises actual
browser persistence, resolution keys, eviction and unavailable-storage fallback.
A Sydney reload reused 84 sampled grids, and zoom controls remained usable while
a larger viewport was still loading terrain and forecast frames.
`test-buffering.html` also checks waiting for both terrain and forecast data,
reusing prepared frames during terrain-only refinement, preserving the paused/
playing choice, and ignoring completion from superseded view requests.

### Wider national overview (build D)

The camera can now pull back to 3,200 km rather than 1,200 km. At the existing
42° field of view, a top-down view covers about 2,457 km vertically, enough to
fit the North, South and Stewart islands comfortably when centred on New Zealand.
The far clipping plane and tilted-camera footprint limit increase alongside it.
Terrain selection retains its bounded tile budget and global relief foundation.


### Automatic forecast refresh and clearer rain (build E)

`global_serve.py` starts a separate low-priority `auto_refresh.py --watch` process.
While the local server runs, it checks Open Data every ten minutes, AWS first and
ECMWF as fallback. Every required surface field and forecast time must be present
before a run is selected. It builds global 0.1° tiles for +3 to +84 hours, including
native pressure, and validates every tile before atomically replacing `latest.json`.
Failed or incomplete builds leave the previous forecast available. The newest and
preceding completed packages are retained; older generated packages are pruned.
The builder needs at least 4 GiB free disk space. This is background preparation,
not per-request computation, and does not alter production deployment.

The browser checks for a published replacement every 30 seconds. It loads all
new forecast times for the current footprint into a separate buffer while the old
run keeps animating. It then blends to the nearest valid time in the new run,
preserving the camera and Play/Pause choice. Panning invalidates pending adoption;
loading resumes for the new footprint. Settings shows refresh progress or retries.
Run-specific cache keys prevent mixing forecasts. On first opening, the timeline
selects the time nearest now unless the URL requests a particular forecast time.

Rain streaks now use screen-width strips rather than single-device-pixel WebGL
lines: two CSS pixels wide, 50% longer and brighter. Their density still follows
forecast precipitation. Original raindrops and drifting snow remain available.

Checks: `test_refresh.py` covers complete-run discovery and atomic publication,
including failure retention. `test-run-refresh.mjs` covers staging, adoption,
failures and changed views. Precipitation tests cover the strip instance count.
Browser verification showed the new run and visible streaks without console errors.

### Snow visibility and consistent loading status (build F)

Drifting snow uses brighter five-CSS-pixel soft discs (previously three pixels),
with a fuller centre. Rain has a slightly stronger blue tint to distinguish it
from yellow wind trails; snow stays white. Snow still falls over seven seconds through the particle
layer, compared with 1.5 seconds for rain. Density and original symbols are unchanged.

Loading details now separates elevation meshes from water/land-cover completeness.
Both displays use the same viewport-only counts. Missing cover can no longer look
like a fully ready view just because its elevation mesh is present. Buffering keeps
watching after tile failures, so a successful terrain Retry clears the warning
automatically and preserves the Play/Pause choice. Camera and effects keep moving.
The buffering browser test covers this recovery; particle tests check slower snow.

### Weather over coarse relief (build G)

Surface weather colours now also shade the global ETOPO1 relief mesh, using its
shader-displaced world positions and the same forecast uniforms as detailed tiles.
Previously only downloaded terrain meshes and the flat emergency backdrop received
weather shading, leaving rectangular breaks where the coarse relief covered them.
Rain sampling also uses the grid-node-to-texel-centre mapping used by other fields.
Terrain appearance still refines during loading, but precipitation coverage no
longer waits for detailed terrain. Browser verification near Pori at +9 h showed
continuous precipitation while only 5/68 terrain/cover patches were ready, without
shader errors.

### Wind-driven precipitation (build H)

Drifting snow discs increase from five to seven CSS pixels. Rain and snow now
advect visibly with the sampled 10 m wind: eastward u moves east and northward v
moves north. The illustrative drift scales with the falling layer height so it
remains legible at different zooms. Snow retains its seven-second descent versus
1.5 seconds for rain, and its gentle flutter is bounded relative to the wind.
Rain ribbon tails follow the same velocity as their moving heads. Original symbol
particles also advect with surface wind. These are illustrative accelerated motions,
not a physical simulation of individual hydrometeors. Particle tests cover both
wind directions, both phases, ribbon orientation and slower snow descent.

### Weather-only playback readiness (build I)

Forecast playback now waits only for weather buffering, not terrain or land cover.
The terrain progress monitor continues independently, including retry warnings and
recovery, while forecast time can advance over the available coarse/detail surface.
The Play/Pause choice is preserved. Missing weather still holds playback. Browser
buffering checks cover zero terrain ready, failed cover tiles, terrain-only detail
changes, missing weather and stale requests. This replaces the earlier requirement
that both weather and terrain be complete before time playback starts.

### Global previews and quiet refinement (builds J–K)

A worker preloads the complete one-degree global forecast (all nine fields, all
28 times in the current run: 10.7 MB compressed). Compressed frames and detailed
weather tiles are reused from IndexedDB, with a 256 MiB weather-cache budget.
Detailed viewport grids are prepared separately. Loading priority follows the
selected time, previous frame, remaining future frames, then earlier backfill;
scrubbing updates that order. Play uses the coarse forecast while detail loads.
Only an unavailable next weather frame holds the clock, retaining Play and
retrying automatically. Terrain readiness never gates playback or resets its clock.
New global previews are built and validated before a refreshed run is published.

Global ETOPO1 fallback terrain is now five arc-minute sampling (about 9.3 km
north–south), 14.5 MB compressed. It is cached with the terrain grids; their
combined disk budget is 512 MiB. Browser storage is best-effort and can be evicted.
This is data reuse, not a complete offline application. The fallback samples
colour and relief shading per fragment, independently of its 512-square mesh,
so a distant/slanted footprint does not reduce the colour map to large triangles.
Fine terrain still replaces the coarse relief as it arrives; fine coastlines and
fjords cannot be supplied by the global fallback alone.

The map shows only “Refining map detail…” during background terrain loading.
Patch counts and failures stay in Loading details. Failed visible patches retry
quietly with a 15-second delay backing off to two minutes. Manual Retry remains
available; obsolete view failures are discarded. Failed source objects are cleared
on retry so cached decoder failures cannot prevent recovery.

Checks: global pack values and all times; poles and dateline; native pressure;
worker/IndexedDB reuse across worker restarts; loading priority; playback with
partial weather, zero terrain and failed cover; automatic run validation. The
browser fixture `test-relief-view.html` shows Norway using only the bundled
fallback, with no detailed terrain downloads.

### Synchronous forecast clock (build L)

Playback now uses the full three seconds per three-hour interval at 1× to blend
weather continuously. The clock, date, forecast lead and fractional slider follow
that same interpolation. The clock displays minutes (one forecast hour per real
second at 1×). Pause freezes temporal interpolation, while illustrative particles
continue moving. Changing playback speed preserves progress. Manual scrubbing
snaps to the nearest source frame; the previous/next buttons retain three-hour
steps. Detail upgrades do not replace a frame partway through a time transition.
Browser checks cover interpolation speed, pause/resume, missing-frame holds and
partial terrain; time tests cover intermediate timestamps and local time zones.

### Wide-view cloud depth (build M)

The camera near plane now scales to 0.5% of the viewing distance (minimum 30 m).
Keeping it fixed at 30 m while viewing hundreds of kilometres lost enough depth
precision for low cloud and sea fragments to collide, producing horizontal bands.
The scaled plane retains depth testing against terrain and keeps cloud layers
visible, including when forecast time is paused.

### Cloud stability when tilting (build N)

The near-plane adjustment alone did not cover distant grazing views. The renderer
now uses logarithmic depth, with the same depth chunks added to every custom
weather shader as to built-in terrain materials. This preserves cloud/sea
separation near the horizon. Cloud procedural detail is filtered by screen-pixel
footprint and its contrast fades at grazing angles to avoid thin horizontal
texture stripes and shimmer. Forecast cloud coverage and layer switches remain.
Browser checks cover paused Southland views tilted towards the horizon and rotated,
including wind, both precipitation styles and isobars; shaders compile without errors.

### Sharper opening globe (22 November)

The Local opening globe now shares the bundled 5-arc-minute ETOPO1 elevation,
relief palette, hill shading and sea colour with Local's coarse terrain.
It does not fetch worldwide detailed DEM or WorldCover tiles.

Clouds remain pseudo-infrared OLR, with the existing brightness transfer.
Run `web/.venv/bin/python web/local-trial/prepare_globe.py` from the root
to build native 0.25-degree frames (1440 × 721) directly from Open Data.
The optional `--public-cache` uses the smaller published 0.5-degree preview.
The cloud shader reads dimensions from metadata and supports both; mipmaps
reduce shimmer when zoomed out, and the displayed time follows interpolation.
The public site's builder still defaults to 0.5 degrees.

### Town sight lines (22 November)

Place visibility now tests the town's rendered ground position, independently of
the text offset or GeoNames elevation. It checks every crossed terrain grid edge
and triangle diagonal, following the approach in the Weather3D viewer. Local's
coarse relief supplies the fallback outside streamed tiles. Hidden candidates
are rejected during selection, so visible alternatives can fill all five slots.
The existing camera/terrain revision cache avoids repeat checks while stationary.

Checked with synthetic narrow-ridge, near-town, reversed-view and replacement
tests, plus low-angle Geneva views and rotation in the browser.

### Point forecasts and meteograms (22 November)

Click terrain or a visible town to open its forecast; **Fly here** preserves the
view direction and distance, allowing clearance over terrain. The point replaces
the old view-centre weather readout. Its time zone follows the selected location.
Local uses the same Units module and choices as Highlights, including the local
preview's separate ports. Opening-globe location controls now sit on the right.

The movable, resizable meteogram follows Weather3D's aligned panels: green
temperature/orange dew point, precipitation amounts over the preceding three
hours, wind and gust together with flow arrows above, and total cloud. Lines join
three-hourly spot values without smoothing. Night shading is approximate. A red
cursor follows the viewport's interpolated time; chart clicks select a three-hour
frame. Display bounds keep dew point at or below temperature and gust at or above
wind speed without modifying source arrays. Numeric wind directions are not shown.
The current IFS gust field covers the preceding hour, not three hours.

`prepare_ptype.py` and `prepare_point_fields.py` check Open Data indexes before
preparing optional static sidecars for actual surface precipitation type, dew
point, gust and total cloud. They are included in background run preparation and
validated before publication. Surface precipitation colours use the existing
ECMWF chart palette, with faint shading for light amounts. No terrain lapse-rate
or snow-level correction is applied: this remains model guidance at model height.
Streaks/drifting snow are the default; alternate particles and wind density/speed
controls are under Advanced settings.

Checks: `test-meteogram.mjs`, `test-point-values.mjs`,
`test-precipitation-type.mjs`, weather/grid tests and `test_refresh.py`;
browser checks cover point selection, flight, chart time selection and cursors.

The expanded meteogram now divides the available window height between all four
plots, with compact headings and an adaptive plot area; it needs no panel scroll.
Point wind readouts use whole selected units on a separate line, for example
`Wind: E 15 g 33 km/h`. After **Fly here**, the town's ground point remains the
wheel-zoom/orbit target, including when detailed elevation arrives. A deliberate
pan releases that focus. Flights defer coordinate rebasing until arrival.
Verified all four panels inside a 1280 × 720 viewport (no scroll overflow), and
wheel zoom in/out retained the selected town within a fraction of a screen pixel.

**Centre here** replaces Fly here. Clicking a town label or double-clicking the
terrain selects its forecast and centres automatically; a single terrain click
only opens its forecast. Search and globe arrivals initialise the orbit/zoom
pivot at the destination's ground height, retaining it as detail arrives.
Tilt now reaches near-horizontal views. **View & terrain → Near ground · about
500 m** lowers the eye to that clearance above local terrain; the camera floor
uses the same 1.5× vertical scale as the terrain (0.75 scene km).

### Automatic orbit

The playback ribbon's **Orbit** button starts/stops a circuit around the current
camera target, preserving the chosen distance and tilt. Default: 120 seconds per
turn. Advanced settings stores a custom period (10–3600 seconds). Orbit is
independent of forecast playback and pauses for manual drag/zoom, camera presets
or a new destination. It follows Weather3D's manual-takeover convention. Terrain
clearance can lift the eye over rising ground. Streaming refreshes periodically
during continuous rotation rather than waiting for camera motion to stop.
`test-camera-orbit.mjs` checks period, refresh-rate independence and geometry;
browser checks confirm the centred marker stays fixed and wheel input pauses.

Place labels now reproject the five selected towns on every rendered frame, so
orbiting does not move labels in 200 ms steps. Candidate ranking, collision checks,
terrain sampling and line-of-sight work remain throttled to five times a second.
The fast path only projects cached ground points and updates CSS transforms.
Nearby settlements receive priority, existing labels get a modest retention bonus,
and the candidate radius follows zoom distance instead of a 950 km minimum.
During automatic orbit, ranking is frozen for the selected set: visible existing
labels are retained even if a more important town becomes a candidate. Off-screen,
terrain-occluded or panel-covered labels release slots for nearby replacements.
Tests cover retention against a stronger challenger and replacement on occlusion.

### Forecast snow and sea ice

The optional `surface-cover-v6` package uses indexed IFS Open Data `sd`, `sithick`,
`lsm` and surface `z` at **step 0**. Model terrain height is `z / 9.80665` metres;
no temperature/pressure estimate is used. Positive valid ice thickness denotes
ice presence, not concentration. Snow whitening saturates at 20 mm SWE (a display
convention). Latitude-aware smoothing and linear spatial sampling soften edges; missing samples are excluded. Coarse previews average nearby samples before subsampling to avoid polar aliasing.
The detailed land/water mask clips Local snow, and elevation clips ocean ice.

A roughly 90 km neighbourhood compares snowy (at least 5 mm SWE) and effectively
bare (at most 0.5 mm) model points. Both groups must occupy at least 8% of the
neighbourhood, with snowy points at least 300 m higher on average and separation
exceeding the sum of their elevation standard deviations. Otherwise no snowline
is inferred. Supported boundary estimates are spatially blended, using a 300 m
soft elevation transition and fading the adjustment where evidence is sparse.
The calculation uses real terrain heights, unaffected by display exaggeration.
This is an illustrative terrain adjustment, not an observed snowline or a
high-resolution forecast. It is disabled beyond 85 degrees latitude.

The background builder prepares seven uint16 arrays (snow, ice, weighted local snowline
in km, local evidence weight, weighted regional snowline, regional evidence weight,
and actual model terrain height in km), 0.1° tiles and a 1° global preview. It publishes the
manifest only when every frame is ready. HTTP requests only serve static files.
The decoder still accepts v1 and packages without cover. Both views interpolate
with forecast time; the globe matches absolute cloud time and hides unavailable
periods. Local has a **Snow & sea ice on the surface** switch.

High terrain now uses rock colours rather than automatic elevation-based white.
In Local's relief/land-cover blend, WorldCover snow/ice retains its mapped white
appearance, and bare/sparse land has stronger rock/soil colouring. These static
classes are separate from the forecast snow overlay; they do not establish a
universal treeline. The globe retains its coarse relief base.

### Global land-cover base (23 November)

Globe and Local's coarse fallback now use a bundled 5-arc-minute WorldCover 2021
class overview. `prepare_global_landcover.py` reads only the internal overviews
of all 2,651 official 3-degree COGs, then samples 36×36 display cells per tile.
The reproducible builder runs with `uv run --with rasterio --no-project python
local-trial/prepare_global_landcover.py`; intermediate samples remain in /private/tmp.
No browser requests the worldwide full-resolution map or an external map service.

`land-cover-palette.mjs` supplies the same colours/weights to the detailed terrain
worker and globe: mapped snow/ice fully replaces the elevation colour, bare/sparse
vegetation blends at 65%, other classes at 10%. Premultiplied colour filtering
softens class transitions without inventing intermediate category numbers. Missing
coverage and water retain the relief/coast base. These are static 2021 classes,
not evidence of present seasonal snow. Forecast snow and sea ice remain separate.
The texture loads in the background, is cached on disk, and preserves hill shading.

Source: https://esa-worldcover.org/en/data-access · © ESA WorldCover project 2021 /
Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover
consortium; CC BY 4.0. The packaged raster is resampled for display.

### Regional snowline fallback (23 November)

Where the local boundary is weak, a fallback searches supported half-degree donor
locations within 150 km, then 300 km (great-circle distance, including the date line).
At least three donors with local confidence >= 0.5 must agree: their distance-weighted
snowline standard deviation must not exceed 200 m. Distance, donor support and agreement
reduce confidence, capped at 0.7 for the near search and 0.5 for the wider search.
Latitude alone never supplies a snowline, and no inference is made beyond 85 degrees.
This does not establish that neighbouring slopes share the same exposure or snow history.

Both renderers use the same shader. Regional snow only adds whitening to ground
300–600 m above the actual IFS model terrain, fading in with height. Strong local
evidence takes priority; the fallback cannot remove existing model snow. This
per-pixel height gate avoids preloading detailed terrain merely to decide eligibility.
The globe has the same rule but cannot resolve peaks absent from its coarse DEM.

Both local and regional estimates are recomputed from each forecast step's `sd`,
then interpolated in time. Orography is static. Where no nearby boundary is supported,
including isolated NZ summits in some frames, broad cover and WorldCover remain.
No latitude climatology, invented summit snow, or temperature-only accumulation is used.
Seven fields use format 3 (14 bytes/point); older packages remain readable.

### NZ illustrative snowline (23 November)

A second fallback covers NZ only (165–180 E, 47–33 S, feathered by half a degree).
It uses the upper quartile of Southern Alps boundaries between 42.5–46 S and
167–172.5 E, normalised to 44 S. Each supported half-degree bin contributes one
median; at least three bins must agree within a 300 m standard deviation.
The assumed northward rise is 150 m per degree, a depiction tuning choice rather
than an observed relationship. The soft transition is centred 150 m above that
boundary, to keep inferred summit caps modest. Confidence is capped at 0.45.

Supported nearby regional estimates take priority, and the shared shader still
puts local evidence first and requires actual terrain 300–600 m above model
terrain. No changes are made outside NZ. No source evidence means no borrowed
snowline. The Southern Alps reference follows each forecast frame, damped with a
six-hour exponential response and a maximum change of 100 m per three hours.
Mapped permanent snow remains separate. The reference is recorded in the manifest
for inspection; the satellite examples supplied by the owner are visual checks,
not assimilated measurements or fixed snowline heights.

The same prepared fields feed Local and the globe without additional browser
computation. Narrow summit caps can remain unresolved by the globe's coarse DEM.

### Explore controls and recording (23 November 2026)

Explore uses the Highlights/Past Events action styling, a compact timeline, one
Clouds switch and view-specific Help. Restore Controls stays at the top right and
restores the interface. Settings toggles only the sidebar, including during Clean
view. Neither action moves the camera. Closing a point forecast also resets the meteogram's expanded state.
Units remain shared with the other modes; `explore-time-mode` independently
selects view location (default), browser time or UTC. View links include this mode.

`video-recording.mjs` composites the WebGL scene immediately after rendering with
place labels, the forecast clock and data credits. Record / Stop & save uses
MediaRecorder at up to 1920×1080 and 30 fps, preferring MP4 and falling back to
WebM. No screen-capture permission, audio or server upload is used. Panels are
omitted. A download link is offered when recording stops. Browser support is
checked before enabling Record; capture/encoder errors are reported in its panel.


Recording defaults to 720p for smoother orbit/forecast playback, with a 1080p
option for more detail. During capture the renderer uses the selected video pixel
budget (the CSS viewport and camera are unchanged), then restores normal display
resolution on stop or error. Capture preserves the 30 Hz fractional remainder
and explicitly requests each completed frame where supported, avoiding two
independent capture timers. This targets 30 fps, not a guarantee on every device.
Globe destination clicks and searches start the local timeline at Now; local
recentre actions retain their forecast time and playback.

### Smooth video export (23 November 2026)

Explore's Video panel also offers a 5–300 second, fixed 1920×1080 / 30 fps MP4
export through WebCodecs and mp4-muxer 5.1.5 (the same pinned encoder packaging
used by Highlights). It takes the current Orbit and Play states and playback
speed. Every frame advances simulation by 1/30 second; slow encoding never drops
simulation steps. Forecast time holds at the final forecast value. Other aspect
ratios are fitted within 1080p without changing the camera framing.

Export snapshots camera and forecast state, suspends live rendering and terrain
installation, prepares the required weather grids, and prevents background run
adoption/refinement from replacing the snapshot. Wind, precipitation, clouds,
labels and orbit advance on simulated time. Encoder backpressure bounds queued
frames. Progress and Cancel are in a modal dialog; cancel also works during data
preparation. Completion, cancellation and errors restore the camera, forecast and
playback state. Existing terrain detail is retained, with coarse relief outside
loaded patches. Live recording remains available separately. Nothing is uploaded.

Weather controls now order Clouds before Isobars (on/off defaults respectively).
Snow & sea ice remains enabled by default under Advanced settings. Navigation
instructions explain zooming in or out from the centred place; the redundant
globe link has been removed from Settings.

The R2 workflow now probes hourly at minute 37 UTC, covering all four IFS cycles
rather than a single daily check. Discovery requires every necessary field at
all +3 to +84 h steps before building; only a newer complete run is uploaded.
GitHub scheduling can be delayed. Publication keeps the preceding complete run
and changes latest.json only after all objects have uploaded successfully.

New-place arrivals use a north-facing camera 50 km south and 18 km above the
centre's terrain. View has two live camera sliders: horizontal
centre distance and MSL altitude. They retain the target and bearing, pause
Orbit when adjusted, and respect camera distance and terrain-clearance limits.
Readings also show straight-line distance and clearance above the displayed
terrain beneath the camera (including terrain exaggeration). Values refresh
at 5 Hz while View is open; logarithmic slider spacing allows
fine adjustment near the ground without losing the wide-view range.

Reset view restores this north-facing arrival camera around the current centre,
without changing forecast time. Camera readouts use miles for mph wind units
and kilometres for km/h, m/s or knots (including resolved Automatic units).


### Explore pre-sharing review (23 November 2026)

Compared the live Highlights and Past Events controls and units with Explore.
The outer header now replaces its Help button with Clean View / Restore Controls
while a landscape is open. The landscape retains its own Help; the redundant
inner clean-view button is hidden when embedded. Settings remains a separate
sidebar toggle. Help explains progressive terrain loading and browser caching,
including private-browsing and cache-eviction limitations.

Performance fixes:
- Reuse the nine cloud meshes and shader materials between forecast frames;
  update their texture uniforms. Rebuild geometry only when bounds change;
  terrain refinement still updates geometry incrementally.
- Preserve cloud texture-animation time across forecast transitions.
- Cache bounded Intl date formatters and the terrain exaggeration value.
- Avoid per-particle colour objects in the wind update and duplicate globe-clock
  formatting on every frame.
- Retain a staged newer forecast when video export temporarily prevents adoption.

Validation: all 45 local-trial Node checks pass, including new cloud reuse and
forecast-adoption deferral checks. Browser-tested orbit plus forecast playback,
Help, Clean View and independent Settings. No browser console errors observed.
A 9.1-second pre-change CPU sample included 850 shader-query samples; a
17-second post-change sample had none. These are diagnostic samples with
changing terrain/loading state, not a controlled FPS comparison or a guarantee
of frame rate on other devices. Remaining principal CPU work is particles,
terrain sampling and label layout; terrain preparation remains worker-based.

### Video presentation (23 November 2026)

Live recording and smooth export share output-space title and footer bands,
matching Highlights' presentation. The title names the selected place and active
weather layers; it does not invent a researched forecast narrative. The footer
shows forecast date/time/time zone, lead, model run, website and data/terrain
credits. Text uses safe margins and bounded widths independently of browser size.
Verified with a five-second orbit/playback MP4: 1920×1080, 30 fps, 150 frames.
All 46 local-trial checks pass, including layout bounds at landscape, square and
portrait sizes. Existing downloaded videos are not modified.


### Isolated NZ snowline gaps (23 November 2026)

A missing Southern Alps reference at +9 h in run 2026112218 disabled the NZ
fallback, although +6 h and +12 h both supported it. Preparation now bridges a
single interior missing reference only when its neighbours are no more than six
hours apart and differ by at most 300 m. End gaps, multiple gaps and disagreeing
neighbours remain unsupported. Existing local snow and regional evidence keep
priority; the terrain shader is unchanged.

The manual `repair_snow` option in the serialised Explore data workflow rebuilds
only affected frames from official IFS fields. It copies unaffected surface packs
unchanged to a new immutable namespace and publishes a versioned manifest only
after all tiles validate and upload. Old cached URLs are never overwritten.
Reload Explore to adopt a same-run repair; ordinary new-run refresh is unchanged.
