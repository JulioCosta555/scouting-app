// loader.js
// Compiles the raw Observable cells (cells.js) and runs them inside the
// Observable runtime, wiring named cells to DOM mount points.
//
// Libraries are loaded LOCALLY from /vendor (same-origin, edge-cached by
// Cloudflare) instead of a third-party CDN — faster first paint and no
// external runtime dependency. See vendor/README for how the files get there.

import { Runtime, Inspector } from "/vendor/runtime.js";
import { Library } from "/vendor/stdlib.js";
import { parseCell } from "/vendor/parser.js";
import { cellSources } from "/cells.js";

// ---------------------------------------------------------------------------
// Compile one Observable cell source string into a runtime definition.
// No cell logic is rewritten — we parse it, extract references + body, and
// define it in the runtime exactly as the original Quarto OJS runtime did.
// ---------------------------------------------------------------------------
function compileCell(source) {
  const ast = parseCell(source);

  let name = null;
  let isViewof = false;
  let isMutable = false;
  if (ast.id) {
    if (ast.id.type === "ViewExpression") {
      isViewof = true;
      name = ast.id.id.name;
    } else if (ast.id.type === "MutableExpression") {
      isMutable = true;
      name = ast.id.id.name;
    } else if (ast.id.type === "Identifier") {
      name = ast.id.name;
    }
  }

  const inputs = (ast.references || []).map((r) => {
    if (r.type === "ViewExpression") return "viewof " + r.id.name;
    if (r.type === "MutableExpression") return "mutable " + r.id.name;
    return r.name;
  });

  const bodyText = source.slice(ast.body.start, ast.body.end);
  const async = ast.async;
  const generator = ast.generator;
  const argNames = inputs.map((_, i) => "$" + i);

  // Re-bind plain-identifier inputs to their real names inside the body.
  const bindings = inputs
    .map((inp, i) => (inp.includes(" ") ? null : `const ${inp} = ${argNames[i]};`))
    .filter(Boolean)
    .join("\n");

  const isBlock = ast.body.type === "BlockStatement";
  const wrapped = isBlock
    ? `${bindings}\nreturn (${async ? "async " : ""}${
        generator ? "function*" : "function"
      } ()${bodyText})()`
    : `${bindings}\nreturn (${bodyText});`;

  let definition;
  try {
    if (async && generator) {
      const C = Object.getPrototypeOf(async function* () {}).constructor;
      definition = new C(...argNames, wrapped);
    } else if (async) {
      const C = Object.getPrototypeOf(async function () {}).constructor;
      definition = new C(...argNames, wrapped);
    } else if (generator) {
      const C = Object.getPrototypeOf(function* () {}).constructor;
      definition = new C(...argNames, wrapped);
    } else {
      definition = new Function(...argNames, wrapped);
    }
  } catch (err) {
    console.error("Failed to compile cell:", name || "(anonymous)", err);
    console.error(source);
    throw err;
  }

  return { name, isViewof, isMutable, inputs, definition };
}

// ---------------------------------------------------------------------------
// Define every cell in the runtime and mount the top-level UI cells.
// ---------------------------------------------------------------------------
export async function boot() {
  const library = new Library();
  const runtime = new Runtime(library);
  const main = runtime.module();

  const mounts = {
    scout_controls_bar: "#controls",
    scout_dashboard: "#dashboard",
    DashboardDownloader2: "#downloads",
  };

  const compiled = cellSources.map(compileCell);

  for (const cell of compiled) {
    const { name, isViewof, isMutable, inputs, definition } = cell;

    if (isViewof) {
      main.variable().define("viewof " + name, inputs, definition);
      main
        .variable()
        .define(name, ["viewof " + name], (view) =>
          library.Generators.input(view)
        );
      continue;
    }

    if (isMutable) {
      main.variable().define("initial " + name, inputs, definition);
      main
        .variable()
        .define("mutable " + name, ["initial " + name], (init) =>
          new library.Mutable(init)
        );
      main.variable().define(name, ["mutable " + name], (m) => m.generator);
      continue;
    }

    if (name && mounts[name]) {
      const target = document.querySelector(mounts[name]);
      main.variable(new Inspector(target)).define(name, inputs, definition);
    } else if (name) {
      main.variable().define(name, inputs, definition);
    } else {
      main.variable().define(inputs, definition);
    }
  }

  return { runtime, main };
}
