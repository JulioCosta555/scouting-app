# public/vendor — third-party libraries (vendored)

These files are served same-origin from Cloudflare's edge for a faster first
load (no cross-origin CDN round-trip). They are NOT in this archive because the
build environment had no network access — fetch them once on your machine with
the commands below, then commit them.

Run from the project root:

```bash
cd public/vendor

curl -L -o runtime.js   https://cdn.jsdelivr.net/npm/@observablehq/runtime@5/dist/runtime.js
curl -L -o stdlib.js    https://cdn.jsdelivr.net/npm/@observablehq/stdlib@5/dist/stdlib.js
curl -L -o parser.js    https://cdn.jsdelivr.net/npm/@observablehq/parser@6/dist/parser.js
curl -L -o inspector.css https://cdn.jsdelivr.net/npm/@observablehq/inspector@5/dist/inspector.css
```

After this, `public/vendor/` should contain:

```
runtime.js
stdlib.js
parser.js
inspector.css
```

## Important: these are ES modules with their own imports

`stdlib.js` and `runtime.js` may import other Observable packages by bare
specifier (e.g. `import ... from "@observablehq/..."`). The single-file `dist`
bundles linked above are self-contained, so this works as-is. If you ever see a
console error like *"Failed to resolve module specifier"*, it means a bundle is
pulling in a sub-dependency — fetch that file into this folder too and update
the import path, OR switch that one import back to the CDN URL. The dist bundles
above are chosen specifically because they avoid this.

## Pinning versions

The `@5` / `@6` tags pin major versions. To lock exact versions for
reproducibility, replace e.g. `@5` with a full version like `@5.9.0`.
