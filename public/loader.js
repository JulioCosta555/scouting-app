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
  let ast;
  try {
    ast = parseCell(source);
  } catch (err) {
    console.error("PARSE FAILED on this cell:\n", source);
    throw err;
  }

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

  // Map each input to a safe local identifier used inside the function.
  // Plain refs keep their name; viewof/mutable refs (which contain a space)
  // get a safe alias like "$view_radar_player" / "$mut_count".
  const localName = (inp) => {
    if (inp.startsWith("viewof ")) return "$view_" + inp.slice(7);
    if (inp.startsWith("mutable ")) return "$mut_" + inp.slice(8);
    return inp;
  };
  const params = inputs.map(localName);

  // Rewrite the body so any `viewof x` / `mutable x` reference text becomes its
  // safe alias. We use the parser's exact offsets so we never touch unrelated
  // text. References are processed right-to-left to keep offsets valid.
  const bodyStart = ast.body.start;
  let bodyText = source.slice(bodyStart, ast.body.end);
  const special = (ast.references || [])
    .filter((r) => r.type === "ViewExpression" || r.type === "MutableExpression")
    .map((r) => ({
      start: r.start - bodyStart,
      end: r.end - bodyStart,
      alias:
        r.type === "ViewExpression"
          ? "$view_" + r.id.name
          : "$mut_" + r.id.name,
    }))
    .sort((a, b) => b.start - a.start);
  for (const ref of special) {
    bodyText =
      bodyText.slice(0, ref.start) + ref.alias + bodyText.slice(ref.end);
  }

  const async = ast.async;
  const generator = ast.generator;

  const isBlock = ast.body.type === "BlockStatement";

  // Block body: run it as an inner IIFE so its own `const`s get a fresh scope,
  // separate from the parameters. Expression body: just return it.
  const inner = isBlock
    ? `return (${async ? "async " : ""}${generator ? "function*" : "function"} ()${bodyText})();`
    : `return (${bodyText});`;

  const fnBody = inner;

  let definition;
  try {
    if (async && generator) {
      const C = Object.getPrototypeOf(async function* () {}).constructor;
      definition = new C(...params, fnBody);
    } else if (async) {
      const C = Object.getPrototypeOf(async function () {}).constructor;
      definition = new C(...params, fnBody);
    } else if (generator) {
      const C = Object.getPrototypeOf(function* () {}).constructor;
      definition = new C(...params, fnBody);
    } else {
      definition = new Function(...params, fnBody);
    }
  } catch (err) {
    console.error("Failed to compile cell:", name || "(anonymous)", err);
    console.error(source);
    throw err;
  }

  return { name, isViewof, isMutable, inputs, definition };
}

// ---------------------------------------------------------------------------
// Some original cells bundle several top-level definitions (the Quarto compiler
// split these automatically; our extraction kept them together). parseCell only
// accepts ONE cell at a time, so we split a source into individual cells at
// top-level assignment boundaries — i.e. a line starting a new
// `name =`, `viewof name =`, or `mutable name =` while at depth 0 and not
// inside a string/comment.
// ---------------------------------------------------------------------------
function splitCells(source) {
  const lines = source.split("\n");
  let depth = 0;
  let inBlockComment = false;
  const boundaries = []; // line indices where a new cell starts
  const assignRe = /^\s*(?:viewof |mutable )?[A-Za-z_$][\w$]*\s*=(?!=)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // At depth 0 and not mid-comment, a line that looks like an assignment
    // begins a new cell.
    if (depth === 0 && !inBlockComment && assignRe.test(line)) {
      boundaries.push(i);
    }

    // Track bracket depth, ignoring chars inside strings / comments.
    for (let j = 0; j < line.length; j++) {
      const c = line[j];
      const next = line[j + 1];
      if (inBlockComment) {
        if (c === "*" && next === "/") {
          inBlockComment = false;
          j++;
        }
        continue;
      }
      if (c === "/" && next === "/") break; // line comment
      if (c === "/" && next === "*") {
        inBlockComment = true;
        j++;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        // skip to matching quote (no nested template handling needed here)
        const q = c;
        j++;
        while (j < line.length && line[j] !== q) {
          if (line[j] === "\\") j++;
          j++;
        }
        continue;
      }
      if (c === "{" || c === "(" || c === "[") depth++;
      else if (c === "}" || c === ")" || c === "]") depth--;
    }
  }

  // No internal boundaries (or only the first line) -> single cell.
  if (boundaries.length <= 1) return [source];

  const chunks = [];
  for (let b = 0; b < boundaries.length; b++) {
    const start = boundaries[b];
    const end = b + 1 < boundaries.length ? boundaries[b + 1] : lines.length;
    const chunk = lines.slice(start, end).join("\n").trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
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
    DashboardDownloader: "#downloads",
  };

  // Split multi-definition cells, then compile each resulting single cell.
  const sources = cellSources.flatMap(splitCells);
  const compiled = sources.map(compileCell);

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
