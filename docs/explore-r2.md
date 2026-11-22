# Explore forecast storage in Cloudflare R2

Status: publishing code prepared on development; no bucket or credentials created,
no forecast uploaded and no production website changed by this setup.

## Owner setup

1. Open Cloudflare → **R2 Object Storage**. Activate R2 if prompted (Cloudflare may
   request billing details even when usage fits the free allowance).
2. Create a **Standard** bucket named `weather-explorer-forecasts`. Use the normal
   automatic location; no special jurisdiction is needed.
3. In the bucket → Settings → **Custom Domains**, add
   `weatherdata.neilgordon.me`. Review and connect the new DNS record. This is a
   separate hostname: leave the existing `weatherexplorer` Pages CNAME alone.
   Wait for Active. The public r2.dev development URL is not required.
4. In Settings → **CORS policy**, paste the contents of `explore-r2-cors.json`
   beside this guide. Add the exact local preview origin if it uses another port.
5. On the R2 overview → Account Details → **Manage API Tokens**, create an R2 token
   with **Object Read & Write**, restricted to this bucket. Keep the Access Key ID
   and Secret Access Key (shown once). Do not paste either into chat or commit them.
6. In GitHub repository `tehoro/weather-explorer-web` → Settings → Secrets and
   variables → Actions, add repository secrets:
   - `R2_ACCESS_KEY_ID`: the Access Key ID
   - `R2_SECRET_ACCESS_KEY`: the Secret Access Key
7. In the same page's Variables tab, add:
   - `R2_BUCKET`: `weather-explorer-forecasts`
   - `R2_ENDPOINT`: the S3 API endpoint shown by Cloudflare, normally
     `https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com`
   - `EXPLORE_R2_ENABLED`: `true` when ready to run the prepared workflow.

Tell the coding agent when these settings exist. The agent will run the first
publication and verify browser CORS/range downloads before switching Explore's
`forecast-host.json` to
`{"baseUrl":"https://weatherdata.neilgordon.me/global-data"}`.
The checked-in default remains the local `/global-data` server until then.
The workflow must be on the default branch for scheduled runs. Do not merge just
to activate scheduling before the wider Explore release is ready.

## Retention and publishing

`explore-data.yml` prepares once daily at 23:45 UTC and also supports manual runs.
It is disabled unless `EXPLORE_R2_ENABLED` is `true`. Runs are serialised and a
new invocation cannot cancel an upload halfway through. Preparation fetches only
indexed official ECMWF Open Data messages, shared by all viewers.

Every required tile is decompressed and checked before uploading. Gzip tiles are
concatenated into `tiles.bin` packs with `tiles.json` byte-offset indexes. The
browser requests individual tile ranges and decompresses them in its worker.
This avoids tens of thousands of uploads per run. Do not set Content-Encoding:
gzip on packs: they contain independently compressed members.

Only after all uploads succeed does `global-data/latest.json` change. It records
the current run and previous published complete run. Older run prefixes are
then deleted. A failed build/upload preserves the current pointer and previous
run. A failed cleanup is reported and retried on a subsequent publication.
Partial uploads can temporarily consume extra space until that cleanup succeeds.
Only numeric YYYYMMDDHH directories under `global-data/` are eligible for removal.
Do not add a blanket age-based lifecycle deletion rule: a failed update must not
expire the last usable forecasts. Do not run a second independent publisher.

Latest uses `Cache-Control: no-store`; dated packs are immutable. Do not configure
a Cache Everything rule that overrides latest.json's cache headers. An optional
future cache rule can target only dated run paths. CORS is not access control:
these forecast files are publicly readable, as expected for the unlisted preview.

## Contents and costs

Prepared 0.1° IFS surface weather, cloud fractions, precipitation type, point
forecast extras, snow/sea-ice display and snowline fields, plus coarse global
previews and manifests. No raw GRIB, credentials, user locations or full global
terrain archive. Current and previous packages total about 2.6 GB; transient
preparation/upload can temporarily add another run.

R2 Standard includes 10 GB-month, 1 million Class A requests and 10 million Class B
requests monthly; egress is free. Allowances are account-wide. This preview should
fit them with packed uploads and modest use, but it is not a guaranteed zero bill.

Official setup references:
- https://developers.cloudflare.com/r2/buckets/public-buckets/
- https://developers.cloudflare.com/r2/buckets/cors/
- https://developers.cloudflare.com/r2/api/tokens/
- https://developers.cloudflare.com/r2/pricing/
