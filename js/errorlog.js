// A small persisted log of what's gone wrong, viewable from Settings, so a
// bug can be reported ("check Settings > View error log") without needing
// adb logcat hooked up to the phone. Loaded first (before every other app
// script) so console.error is already wrapped before anything else runs.

const ERROR_LOG_KEY = "errorLog";
const ERROR_LOG_MAX = 50;

function loadErrorLog() {
  try {
    return JSON.parse(localStorage.getItem(ERROR_LOG_KEY) || "[]");
  } catch {
    return [];
  }
}

function clearErrorLog() {
  localStorage.removeItem(ERROR_LOG_KEY);
}

function appendErrorLog(message) {
  const log = loadErrorLog();
  log.unshift({ time: new Date().toISOString(), message });
  localStorage.setItem(ERROR_LOG_KEY, JSON.stringify(log.slice(0, ERROR_LOG_MAX)));
}

function formatLogArg(arg) {
  if (arg instanceof Error) return `${arg.message}${arg.stack ? "\n" + arg.stack : ""}`;
  if (typeof arg === "object" && arg !== null) {
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}

// Every existing console.error() call across the app — there are dozens,
// one in nearly every catch block — already carries the exact context
// needed. Piggybacking here captures all of them for the log above without
// having to touch each call site individually.
const nativeConsoleError = console.error.bind(console);
console.error = (...args) => {
  nativeConsoleError(...args);
  appendErrorLog(args.map(formatLogArg).join(" "));
};

window.addEventListener("error", (e) => {
  appendErrorLog(`Uncaught: ${e.message} (${e.filename}:${e.lineno})`);
});
window.addEventListener("unhandledrejection", (e) => {
  appendErrorLog(`Unhandled rejection: ${formatLogArg(e.reason)}`);
});
