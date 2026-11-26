# Explore cloud volumes

Explore's regional terrain view uses optional preprocessed, humidity-guided cloud
volumes. The opening globe keeps its existing broad-scale cloud depiction.

`Prepare Explore clouds` runs after the ordinary forecast publisher and hourly as
a catch-up/retry. Its failure cannot block an ordinary forecast. It checks the
current R2 run, downloads indexed ECMWF Open Data humidity, temperature and
geopotential at 12 pressure levels, low/middle/high cloud amounts, surface
pressure, 2 m temperature/dew point, model orography, total and convective rain, and total-column cloud liquid water (`tclw`) and ice water (`tciw`).
AWS is preferred, with the official ECMWF mirror as fallback. No API inference,
paid model calls, per-user server processing, or wind-drift fields are involved.

Globally shared fixed rules place humidity-supported cloud in vertical columns;
maximum overlap within connected decks and random overlap between decks constrain
band amounts to IFS coverage. Sparse unresolved layers have approximate placement.
Temperature/inversion adjustments and stability/convective-rain texture guidance
vary with the input weather; coefficients are not refitted per run.

Volumes use 128 MSL height nodes over 0–20 km and 0.5/1/2 degree spatial levels.
Twenty-degree tiles have shared edges, filtered coarse levels and polar averaging.
Four byte channels contain liquid and ice display extinction (each scaled to 12/km),
an approximate-placement flag and illustrative convective texture weight. Original comparison data are not
published. A real current-run test frame was about 27 MB compressed across all LODs.

Each frame/LOD is packed into `global-data/RUN/cloud-v2/STEP/LOD/tiles.bin`, with
`tiles.json` offsets. The run-scoped cloud manifest is uploaded only after all
validated frames and packs succeed. The existing current/previous forecast-run
retention also removes obsolete cloud packs. Re-run the workflow to retry failures;
a completed matching manifest skips the build. A changed format/algorithm must
use a new versioned path to preserve immutable data and invalidate client caches.

The browser's worker requests only visible tiles for the displayed pair of times,
with a 48 MiB decoded cache. Run, region, time-pair and LOD must match before using
prepared data. Missing manifest, missing/corrupt tile, worker error or timeout uses
standard clouds immediately and retries after a minute. No unrelated run's cloud
fields are substituted. Standard clouds fill continuous illustrative low (0.3–1.8),
middle (3–5.4) and high (7–10.4 km above terrain) bands using the regular IFS cloud
amounts. They do not require the extra preprocessing product.

Both paths retain opacity adjustment and a terrain-depth pass. Cloud rays stop at
the actual displayed terrain, including logarithmic depth and video exports.
Opacity is stronger from below; zero hides all clouds. The cloud envelope remains
stationary at a paused forecast time: wind drift is not included. A single View slider scales terrain and cloud heights together from 1.0× to 2.0×;
it is a display control, not a meteorological correction.

The rendering and noise code is independently written. Research inspiration
includes Wendelin Muth's 2026 cloud visualisation thesis:
https://www.cg.tuwien.ac.at/research/publications/2026/muth-2026-clouds/
No GPL renderer source was copied.

Checks: cloud overlap/coverage and unresolved layers, stability guidance, tile
shape/decompression, packed offsets, manifest-last publication and failed uploads;
local packaged viewer with real current-run frames and intentionally unavailable
cloud data. Actual Actions duration and mobile performance require measurement.

## First published run measurements

The 2026-11-23 12 UTC run produced 760,219,426 compressed bytes for 28 times
and all three levels. Its first Actions build took about 15½ minutes, including
about 5½ minutes of serial upload. Subsequent code uses six bounded upload tasks;
the version-2 measurement below includes those uploads.

For times +33/+36, two NZ-area tiles (`8-6`, `9-6`) plus pack indexes require
about 75 KB at 2°, 190 KB at 1°, or 470 KB at 0.5°. Across the whole timeline
those are about 1.1, 2.8 and 6.7 MB respectively, approximately 10.5 MB if all
levels are visited. Exact amounts vary with weather, extent and tile boundaries.
A whole-world pair at the coarsest level is about 4.8 MB; its full timeline is
about 67 MB. The opening globe does not currently request these volumes.
These sizes exclude terrain and ordinary forecast data. The finest source cloud
field is 0.5°; close-range procedural texture is illustrative, not added forecast
resolution. The renderer bounds its decoded tile cache to 48 MiB and builds two
65×128×65 RGBA textures per interval. It retains at most three interval pairs
(about 12.4 MiB of texture data), including the displayed pair, and prefetches
the following interval. At a three-hour boundary it reuses the shared endpoint
until the next pair is ready, rather than flashing the standard clouds. A failed
request still enables the standard fallback for that unavailable interval.
`node local-trial/test-cloud-handover.mjs` exercises delayed and failed requests,
forward/backward boundaries, cache limits and isolation between runs.

## Live rendering performance (24 November 2026)

Live clouds are traced at half the drawing-buffer width and height, retaining
80 steps and the existing shading. A depth-weighted reconstruction composites
straight-alpha cloud colour into the normal scene, before precipitation and
wind trails. At depth discontinuities with no suitable neighbouring sample it
traces the individual pixel at full resolution, preserving mountain edges.
Terrain and labels remain full resolution; opacity and below-cloud behaviour
use the same uniforms in both paths. The standard three-band fallback uses the
same renderer.

Terrain depth is cached until camera/projection, viewport, terrain revision,
mesh transforms/visibility or height exaggeration changes. Baked detailed tiles
use a depth-only material; custom/displaced materials retain their original
vertex shader. Objects that do not write depth are omitted from this pass.
The cloud image is also reused while camera, terrain and cloud state are unchanged,
so wind and rain can animate without retracing stationary clouds. Forecast changes,
opacity, band selection and newly loaded cloud pairs invalidate the image.
Density, approximation flags and convective weights share each RGBA texture read.

Both live recording and smooth export explicitly select the original full-resolution
80-step ray marcher. They do not upscale the lower-resolution preview. The cheaper
terrain depth pass and mathematically identical texture-read reuse still apply.

`node local-trial/test-cloud-rendering.mjs` checks cache invalidation, output sizes,
full-quality export and renderer-state restoration after errors. Existing cloud
handover tests continue to cover three-hour boundaries and unavailable tiles.

## Column water and optical thickness

Version 2 retains the humidity-guided height envelope and IFS band constraints.
Within that envelope, each column's liquid and ice totals (kg/m²) are distributed
vertically using cloud-density weights and a temperature preference. Liquid preference
rises linearly from zero at −40°C to one at −5°C; ice uses the complement. Each phase
is normalised to its own column total before display scaling. If its preferred
phase has no support, it uses the existing cloud support. Columns with no cloud
support remain empty rather than inventing heights. This is an inferred vertical
distribution of actual column condensate, not a model condensate profile.

Illustrative display extinction coefficients are 15 m²/kg for liquid and 3 m²/kg
for ice. Total extinction is capped at 12/km before eight-bit encoding; small
values can quantise to zero. These deliberately softened choices match the private
trial, not calibrated particle sizes or full radiative transfer. Coarse spatial
levels filter both phase extinction channels. Spatial and temporal interpolation
occurs before calculating the ice fraction used for shading. Ice-rich cloud has
softer shadows and less rounded texture, allowing higher cloud to look thinner.

Optical thickness accumulates extinction along a ray; opacity then follows
1 − exp(−optical thickness). The renderer uses an illustrative horizontal path
scaling, procedural texture and simplified lighting. Finally the opacity slider
scales the integrated cloud transparency, with the existing stronger-from-below
behaviour. It remains possible to see terrain through cloud. These rendering
choices mean apparent image coverage is not guaranteed to equal the input fractions.

The two extra fields are downloaded only during preprocessing. There is no
additional browser voxel channel or raw-field processing. Live half-resolution
cloud rendering and full-resolution video export remain. The version-1 size and
timing figures above are historical; version-2 measurements will differ.

## Verified version-2 publication (26 November 2026 NZDT)

For IFS 2026112506, the cloud job ran from 17:35 to 17:51 UTC on 25 November
(about 16 minutes) and published 355,919,523 compressed tile bytes. These are
run-specific measurements, not a fixed download size. Public verification checked
all 84 pack indexes (28 times × three resolutions), 162 tile entries per pack,
and a representative compressed range from each pack, including its decoded
volume dimensions. The weather and cloud manifests named the same run and steps.
The browser only downloads the ranges needed for its current view and time pair.
