// data/auth.js's native token refresh: concurrent callers near expiry must
// share one refresh request, not fire one each. Refresh tokens are typically
// single-use/rotating, so two requests racing with the same (about to be
// invalidated) refresh token can have the second one rejected even though
// the first actually succeeded — forcing a spurious full sign-out in an app
// that routinely has several Graph requests in flight at once (the indexer,
// prefetching, a folder listing).
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
process.chdir(ROOT);
let bad = 0;
const check = (name, ok, detail = "") => {
  if (!ok) bad++;
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  [" + detail + "]" : ""));
};

// Minimal native-platform + storage stub — auth.js touches no DOM at all, so
// this doesn't need jsdom, same as tests/playback-intent.test.js.
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

let postCalls = 0;
let postDelayMs = 20; // a window a second concurrent call could race into
globalThis.window = {
  location: { origin: "https://localhost", pathname: "/index.html" }, // auth.js's web-side MSAL config reads this unconditionally at module load
  Capacitor: {
    isNativePlatform: () => true,
    Plugins: {
      CapacitorHttp: {
        post: (opts) => new Promise((resolve) => {
          setTimeout(() => {
            postCalls++;
            resolve({ status: 200, data: { access_token: "fresh-token-" + postCalls, refresh_token: "fresh-refresh-" + postCalls, expires_in: 3600 } });
          }, postDelayMs);
        }),
      },
      App: { addListener: () => {} }, // auth.js registers its OAuth-redirect listener unconditionally at module load on the native side
      Browser: { open: () => {}, close: () => Promise.resolve() },
    },
  },
};
globalThis.msal = { PublicClientApplication: function () { return {}; } }; // auth.js constructs this unconditionally at module load, web side

(async () => {
  const { getAccessToken } = await import(pathToFileURL(path.join(ROOT, "js", "data", "auth.js")).href);

  // ---- no tokens stored at all: a clear "not signed in" error, no network call
  let threwNotSignedIn = false;
  try { await getAccessToken(); } catch (e) { threwNotSignedIn = /Not signed in/.test(e.message); }
  check("no stored tokens: throws a clear error, no request made", threwNotSignedIn && postCalls === 0);

  // ---- an already-expired token: concurrent callers share ONE refresh request
  store.nativeAuthTokens = JSON.stringify({ accessToken: "stale", refreshToken: "refresh-1", expiresAt: Date.now() - 1000 });
  const [a, b, c] = await Promise.all([getAccessToken(), getAccessToken(), getAccessToken()]);
  check("only one refresh request was actually sent for 3 concurrent callers", postCalls === 1, `${postCalls} requests`);
  check("every concurrent caller got the same fresh token", a === b && b === c, `${a} / ${b} / ${c}`);

  // ---- a still-valid token: returned directly, no network call at all
  postCalls = 0;
  store.nativeAuthTokens = JSON.stringify({ accessToken: "still-good", refreshToken: "refresh-2", expiresAt: Date.now() + 10 * 60 * 1000 });
  const direct = await getAccessToken();
  check("a non-expired token is returned without refreshing", direct === "still-good" && postCalls === 0);

  // ---- a failed refresh clears the stored tokens and gives a clear error
  store.nativeAuthTokens = JSON.stringify({ accessToken: "stale2", refreshToken: "bad-refresh", expiresAt: Date.now() - 1000 });
  globalThis.window.Capacitor.Plugins.CapacitorHttp.post = async () => ({ status: 400, data: { error: "invalid_grant" } });
  let threwExpired = false;
  try { await getAccessToken(); } catch (e) { threwExpired = /Sign-in expired/.test(e.message); }
  check("a failed refresh clears the stored tokens and says sign-in expired", threwExpired && store.nativeAuthTokens === undefined);

  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log("FAIL auth-refresh test crashed: " + (e && e.stack || e)); process.exit(1); });
