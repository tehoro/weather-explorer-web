# Local performance review — 22 November 2026

The wind-only CPU profile initially identified terrain-height searches as the
largest cost. Geographic buckets now replace the full scan; hidden cloud
meshes no longer resample terrain, and visible cloud updates have a shared
512-vertex budget. Particle counts and buffer uploads reduce with camera distance.

The follow-up streaming/recolour profile identified terrain colouring as the
next large main-thread task. A dedicated module worker now handles GeoTIFF
fetch/decode/resampling, disk-cache access, terrain geometry and colour pixels.
Arrays are transferred back without detaching cached data. GPU installation is
limited to one result per animation frame. Recolour requests are coalesced by
mesh and processed one at a time; obsolete results and disposed meshes are ignored.
The old terrain remains visible until its replacement is ready.

Place-name widths are cached, and stationary views reuse label layout. Terrain,
viewport, camera, UI exclusions and new place data invalidate that layout.
Weather decoding already runs in its own worker. Disabled precipitation returns
early; hidden cloud terrain updates and disabled wind buffer uploads do no work.

Checks: terrain preparation geometry/masks/colours, existing raster/relief and
surface-uniform checks, bounded cloud work, terrain index, particle budgets,
and replay end hold. Browser checks covered streaming UK tiles, colour switches,
wind-only rendering and forecast replay from the final frame. The subsequent
main-thread CPU profile no longer showed terrain colouring among its hotspots;
idle samples dominated. These samples are not a cross-device FPS guarantee.

Remaining costs: GPU uploads/rendering, terrain rebasing, weather geometry/frame
installation, and enabled pressure-contour generation still occur on the main
thread. Network tile retries can delay refinement but do not block playback.
Further changes to those paths should be driven by profiles, particularly on
Safari and at Retina resolution. A full OffscreenCanvas renderer is not required
for this change and has not been introduced.
