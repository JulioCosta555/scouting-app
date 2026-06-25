# Scouting Dashboard — Cloudflare Pages

A fully static, client-side football scouting dashboard. The browser loads
parquet data directly from Cloudflare R2 via DuckDB-WASM and renders everything
with d3 — there is **no server**. Cloudflare Pages just serves the static files.

## Structure

```
scouting_app_2/
├── .gitignore
└── public/                 <- this is the build output directory
    ├── index.html
    ├── app.js              entry point
    ├── loader.js           compiles the OJS cells into the Observable runtime
    ├── cells.js            the 72 dashboard cells (raw Observable JS, logic untouched)
    ├── css/
    │   └── style.css
    └── vendor/             vendored libraries (same-origin, edge-cached)
        ├── runtime.js
        ├── stdlib.js
        ├── parser.js
        └── inspector.css
```

## First-time setup

The `vendor/` library files are fetched once (see `public/vendor/README.md`),
then committed. After that the repo is self-contained — no build step, no npm.

```bash
cd public/vendor
curl -L -o runtime.js    https://cdn.jsdelivr.net/npm/@observablehq/runtime@5/dist/runtime.js
curl -L -o stdlib.js     https://cdn.jsdelivr.net/npm/@observablehq/stdlib@5/dist/stdlib.js
curl -L -o parser.js     https://cdn.jsdelivr.net/npm/@observablehq/parser@6/dist/parser.js
curl -L -o inspector.css https://cdn.jsdelivr.net/npm/@observablehq/inspector@5/dist/inspector.css
cd ../..
```

## Cloudflare Pages settings

In the Pages project (Settings → Builds & deployments):

| Setting                | Value     |
| ---------------------- | --------- |
| Framework preset       | None      |
| Build command          | *(empty)* |
| Build output directory | `public`  |

Pages serves `public/` directly. No Node, no Express, no Wrangler config needed.

## Local preview (optional)

Any static file server works, e.g.:

```bash
npx serve public
# or
python3 -m http.server -d public 8000
```

Open the printed URL. (You can't just double-click `index.html` — ES modules
need to be served over http, not file://.)

## Data / CORS

The dashboard fetches parquet from `https://data.juliocostavizz.uk/*.parquet`
and a few CSVs from GitHub, all from the browser. The **R2 bucket's CORS policy
must allow `GET` and `HEAD` from your Pages domain** (e.g.
`your-project.pages.dev` and any custom domain). If the dashboard loads but
charts stay empty, open the browser console — a CORS error on the parquet
requests is the usual cause.

## Editing

- Change a chart / metric → edit the relevant entry in `public/cells.js`
  (each array element is one Observable cell; reactivity is inferred from the
  references inside it).
- Move a chart on the page → edit the `mounts` map in `public/loader.js` and the
  matching `<section>` in `public/index.html`.
- Restyle → `public/css/style.css`.
