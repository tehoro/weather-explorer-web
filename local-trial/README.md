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
