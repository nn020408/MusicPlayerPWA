// The architecture rules, enforced. Modules live in layers and may only import
// downwards (see ARCHITECTURE.md):
//
//   core     imports only core                    (platform, events, config, small helpers)
//   data     imports core, data                   (OneDrive, library, playlists, lookups)
//   state    imports core, state                  (what the folder view is showing)
//   player   imports core, data, player           (playback engine)
//   ui       imports core, data, state, player, ui (screens and their wiring)
//   main     imports anything                     (entry point)
//
// and there are no import cycles anywhere. A change that breaks a rule fails here
// with the exact import to fix.
const fs = require("fs");
const path = require("path");
const { allModuleFiles } = require("./helpers/flatten");

const ROOT = path.join(__dirname, "..");
process.chdir(ROOT);

const ALLOWED = {
  core: ["core"],
  data: ["core", "data"],
  state: ["core", "state"],
  player: ["core", "data", "player"],
  ui: ["core", "data", "state", "player", "ui"],
  main: ["core", "data", "state", "player", "ui"],
};
const layerOf = (file) => (file === "js/main.js" ? "main" : file.split("/")[1]);

let bad = 0;
const check = (name, ok, detail = "") => {
  if (!ok) bad++;
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "\n   " + detail : ""));
};

const files = allModuleFiles();
const graph = new Map();
const violations = [];
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const deps = [];
  for (const m of src.matchAll(/^import\s(?:[^;]*?from\s+)?["'](\.[^"']+)["']/gm)) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1]));
    deps.push(target);
    const from = layerOf(f);
    const to = layerOf(target);
    if (!ALLOWED[from]) violations.push(`${f}: is in an unknown layer "${from}" (expected core, data, state, player, ui or main.js)`);
    else if (!ALLOWED[from].includes(to)) violations.push(`${f} (${from}) must not import ${target} (${to})`);
  }
  graph.set(f, deps);
}

check(`layers: all ${files.length} modules only import downwards`, violations.length === 0, violations.join("\n   "));

const cycles = new Set();
const done = new Set();
(function visit(f, stack) {
  if (stack.includes(f)) { cycles.add([...stack.slice(stack.indexOf(f)), f].join(" -> ")); return; }
  if (done.has(f)) return;
  stack.push(f);
  for (const d of graph.get(f) || []) visit(d, stack);
  stack.pop();
  done.add(f);
})("js/main.js", []);
for (const f of files) if (!done.has(f)) (function v(g, stack) { if (stack.includes(g)) { cycles.add([...stack.slice(stack.indexOf(g)), g].join(" -> ")); return; } if (done.has(g)) return; stack.push(g); for (const d of graph.get(g) || []) v(d, stack); stack.pop(); done.add(g); })(f, []);
check("no import cycles", cycles.size === 0, [...cycles].join("\n   "));

// modules stay a readable size (the biggest is the player, which is next to split)
const tooBig = files.filter((f) => fs.readFileSync(f, "utf8").split("\n").length > 900);
check("no module has grown past 900 lines", tooBig.length === 0, tooBig.join(", "));

process.exit(bad ? 1 : 0);
