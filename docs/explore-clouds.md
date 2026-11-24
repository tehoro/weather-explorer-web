# Explore cloud volumes

Explore's regional terrain view uses optional preprocessed, humidity-guided cloud
volumes. The opening globe keeps its existing broad-scale cloud depiction.

`Prepare Explore clouds` runs after the ordinary forecast publisher and hourly as
a catch-up/retry. Its failure cannot block an ordinary forecast. It checks the
current R2 run, downloads indexed ECMWF Open Data humidity, temperature and
geopotential at 12 pressure levels, low/middle/high cloud amounts, surface
pressure, 2 m temperature/dew point, model orography, total and convective rain.
AWS is preferred, with the official ECMWF mirror as fallback. No API inference,
paid model calls, per-user server processing, or wind-drift fields are involved.

Globally shared fixed rules place humidity-supported cloud in vertical columns;
maximum overlap within connected decks and random overlap between decks constrain
band amounts to IFS coverage. Sparse unresolved layers have approximate placement.
Temperature/inversion adjustments and stability/convective-rain texture guidance
vary with the input weather; coefficients are not refitted per run.

Volumes use 128 MSL height nodes over 0–20 km and 0.5/1/2 degree spatial levels.
Twenty-degree tiles have shared edges, filtered coarse levels and polar averaging.
Four byte channels contain density, a reserved zero channel, approximate-placement
flag and illustrative convective texture weight. Original comparison data are not
published. A real current-run test frame was about 27 MB compressed across all LODs.

Each frame/LOD is packed into `global-data/RUN/cloud-v1/STEP/LOD/tiles.bin`, with
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
