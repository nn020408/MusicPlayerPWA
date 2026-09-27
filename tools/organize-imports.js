// Keeps the import/export lines of every module under js/ exactly right, so moving
// code between files never means hand-editing them:
//   - each module imports precisely the names it uses from other modules
//   - a declaration is exported only if another module imports it
//
//   node tools/organize-imports.js            check only (exit 1 if anything would change)
//   node tools/organize-imports.js --write    fix the files
//
// Needs acorn + eslint-scope (cd tools && npm install). Top-level names must be
// unique across modules (the tests rely on that too); a clash is reported.
// A module's import block is only rewritten when the set of imports changes, and
// side-effect-only imports (`import "./x.js"`) keep their place relative to the
// named ones, because module evaluation order follows import order.
const fs = require("fs");
const path = require("path");
const acorn = require(path.join(__dirname, "node_modules", "acorn"));
const eslintScope = require(path.join(__dirname, "node_modules", "eslint-scope"));

const ROOT = path.join(__dirname, "..");
const WRITE = process.argv.includes("--write");
const DIR_RANK = ["core", "data", "state", "player", "ui"];

function moduleFiles(dir = "js") {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const p = dir + "/" + e.name;
    if (e.isDirectory()) return e.name === "vendor" ? [] : moduleFiles(p);
    return e.name.endsWith(".js") ? [p] : [];
  });
}
function boundNames(p, out) {
  if (p.type === "Identifier") out.push(p.name);
  else if (p.type === "ObjectPattern") p.properties.forEach((x) => boundNames(x.value || x.argument, out));
  else if (p.type === "ArrayPattern") p.elements.forEach((e) => e && boundNames(e, out));
  else if (p.type === "AssignmentPattern") boundNames(p.left, out);
  else if (p.type === "RestElement") boundNames(p.argument, out);
  return out;
}
const rank = (f) => {
  const r = DIR_RANK.indexOf(f.split("/")[1]);
  return [f === "js/main.js" ? 99 : r < 0 ? 50 : r, f];
};
const byRank = (a, b) => {
  const [ra, fa] = rank(a);
  const [rb, fb] = rank(b);
  return ra - rb || fa.localeCompare(fb);
};
const oneLine = (s) => s.replace(/\s+/g, " ");

const mods = new Map();
for (const file of moduleFiles()) {
  const raw = fs.readFileSync(path.join(ROOT, file), "utf8");
  const crlf = raw.includes("\r\n");
  const text = raw.split("\r\n").join("\n");
  const ast = acorn.parse(text, { ecmaVersion: 2022, sourceType: "module", ranges: true, locations: true });
  const sm = eslintScope.analyze(ast, { ecmaVersion: 2022, sourceType: "module" });
  const statements = [];
  for (const n of ast.body) {
    const decl = n.type === "ExportNamedDeclaration" && n.declaration ? n.declaration : n;
    const names = [];
    if (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") names.push(decl.id.name);
    else if (decl.type === "VariableDeclaration") decl.declarations.forEach((d) => boundNames(d.id, names));
    statements.push({ node: n, names, exported: n.type === "ExportNamedDeclaration" && !!n.declaration });
  }
  const own = new Set(statements.flatMap((s) => s.names));
  // names used that this module doesn't declare itself (imports included: those are rebuilt)
  const used = new Set();
  for (const scope of sm.scopes) for (const ref of scope.references) {
    const v = ref.resolved;
    if (!v || v.defs.some((d) => d.type === "ImportBinding")) used.add(ref.identifier.name);
  }
  mods.set(file, { file, crlf, text, statements, own, used, imports: ast.body.filter((n) => n.type === "ImportDeclaration") });
}

const owner = new Map();
for (const m of mods.values()) for (const n of m.own) {
  if (owner.has(n) && owner.get(n) !== m.file) throw new Error(`top-level name "${n}" is declared in both ${owner.get(n)} and ${m.file}`);
  owner.set(n, m.file);
}

const importedByOthers = new Map();
const needs = new Map();
for (const m of mods.values()) {
  const need = new Map();
  for (const n of m.used) {
    const from = owner.get(n);
    if (!from || from === m.file) continue;
    if (!need.has(from)) need.set(from, new Set());
    need.get(from).add(n);
    if (!importedByOthers.has(from)) importedByOthers.set(from, new Set());
    importedByOthers.get(from).add(n);
  }
  needs.set(m.file, need);
}

let changed = 0;
for (const m of mods.values()) {
  const text = m.text;
  const wantExport = importedByOthers.get(m.file) || new Set();
  const edits = [];

  // exports: add where another module needs the name, remove where none does
  for (const s of m.statements) {
    if (!s.names.length) continue;
    const needed = s.names.some((n) => wantExport.has(n));
    if (needed && !s.exported) edits.push({ start: s.node.start, end: s.node.start, replacement: "export " });
    if (!needed && s.exported) edits.push({ start: s.node.start, end: s.node.declaration.start, replacement: "" });
  }

  // imports
  const need = needs.get(m.file);
  const wantLines = [];
  for (const from of [...need.keys()].sort(byRank)) {
    let rel = path.posix.relative(path.posix.dirname(m.file), from);
    if (!rel.startsWith(".")) rel = "./" + rel;
    wantLines.push(`import { ${[...need.get(from)].sort((x, y) => x.localeCompare(y)).join(", ")} } from "${rel}";`);
  }
  const named = m.imports.filter((i) => i.specifiers.length > 0);
  const haveKey = named.map((i) => oneLine(text.slice(i.start, i.end))).sort().join("\n");
  const wantKey = [...wantLines].sort().join("\n");
  if (haveKey !== wantKey) {
    const eolAfter = (i) => { const e = text.indexOf("\n", i.end); return e < 0 ? text.length : e; };
    const withComment = (i) => {
      const tail = text.slice(i.end, eolAfter(i));
      return text.slice(i.start, i.end) + (/^[ \t]*\/\//.test(tail) ? tail : "");
    };
    const firstNamed = named.length ? named[0].start : Infinity;
    const before = m.imports.filter((i) => i.specifiers.length === 0 && i.start < firstNamed).map(withComment);
    const after = m.imports.filter((i) => i.specifiers.length === 0 && i.start > firstNamed).map(withComment);
    const block = [...before, ...wantLines, ...after];
    if (m.imports.length) {
      const first = m.imports[0].start;
      const last = m.imports[m.imports.length - 1];
      let end = last.end;
      const tail = text.slice(end, eolAfter(last));
      if (/^[ \t]*\/\//.test(tail)) end += tail.length;
      if (block.length) edits.push({ start: first, end, replacement: block.join("\n") });
      else edits.push({ start: first, end: end + 1, replacement: "" });
    } else if (block.length) {
      // no imports yet: they go after the leading header comment block
      const L = text.split("\n");
      let idx = 0;
      if (L[0].startsWith("//")) {
        let j = 0;
        while (j < L.length && L[j].startsWith("//")) j++;
        if (L[j] !== undefined && L[j].trim() === "") {
          while (j < L.length && L[j].trim() === "") j++;
          idx = j;
        }
      }
      const offset = L.slice(0, idx).join("\n").length + (idx ? 1 : 0);
      edits.push({ start: offset, end: offset, replacement: block.join("\n") + "\n\n" });
    }
  }

  let out = text;
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  for (const e of edits) out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  if (out !== text) {
    changed++;
    console.log((WRITE ? "fixed      " : "would fix  ") + m.file);
    if (WRITE) fs.writeFileSync(path.join(ROOT, m.file), m.crlf ? out.split("\n").join("\r\n") : out);
  }
}
console.log(changed ? `${changed} module(s) ${WRITE ? "updated" : "need updating (run with --write)"}` : "imports and exports are all in order");
process.exit(changed && !WRITE ? 1 : 0);
