# Weather Explorer — web viewer

A public, read-only web page that plays the current Weather Explorer highlights:
**https://tehoro.github.io/weather-explorer-web/**

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
- `site/` — the viewer: `index.html` (including the Help text), `style.css`, `app.js` (WebGL2 colour fill, pan/zoom,
  timeline, wind particles, panels), `worker.js` (frame decoding, isobars, highs and lows) and
  `basemap.json` (Natural Earth 1:50m land and borders, public domain).
- `tools/make_basemap.py` — rebuilds `basemap.json` from the world-atlas TopoJSON.
- `.github/workflows/deploy.yml` — the schedule (09:45–10:45 and 21:45–22:45 UTC after each sweep, plus every three hours for requested events), sync, cache and Pages deploy.

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
project folder.

## Operations

- Secret: repository secret `APP_KEY` (the key built into the app). If the app key changes,
  update it with `gh secret set APP_KEY --repo tehoro/weather-explorer-web`.
- Run now: Actions › Sync and deploy › Run workflow (or `gh workflow run deploy.yml`).
- GitHub pauses scheduled workflows in a repository with no commits for 60 days; it emails a
  warning, and re-enabling is one click in the Actions tab.
- Traffic: GitHub Pages has a soft limit of about 100 GB a month. If the viewer outgrows it, the
  same `site/` folder can be published unchanged to Cloudflare Pages (no bandwidth charge).
