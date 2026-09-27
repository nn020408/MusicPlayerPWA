// The app's modules use import/export, which the vm sandboxes in these tests
// can't run. flat() turns a module's source back into a plain script by
// dropping import lines and the `export` keyword. That is exactly equivalent
// here because every top-level name in the app is unique, so all modules can
// share one sandbox where the tests can also reach internal state.
// (tests/modules.test.js checks the real import/export wiring separately.)
const fs = require("fs");

function flat(file) {
  return fs
    .readFileSync(file, "utf8")
    .replace(/^import\s[^;]*?from\s+["'][^"']+["'];?[ \t]*\r?\n/gm, "")
    .replace(/^import\s+["'][^"']+["'];?[ \t]*\r?\n/gm, "")
    .replace(/^export\s+/gm, "");
}

module.exports = { flat };
