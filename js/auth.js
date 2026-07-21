// Handles sign-in with a personal Microsoft account.
//
// Two completely separate implementations, chosen by isNative():
// - Web (the real website): MSAL.js redirect flow, unchanged from before.
// - Native (the Capacitor Android app): @capacitor-community/generic-oauth2,
//   which opens the system browser (Custom Tabs) and returns via a custom
//   msauth:// URL scheme. MSAL's loginRedirect flow can't be used here — it
//   depends on the OAuth redirect landing back on Capacitor's embedded
//   WebView at its virtual https://localhost origin, and that specific kind
//   of external-redirect-driven navigation is a documented, unresolved
//   Capacitor/Android limitation (net::ERR_CONNECTION_REFUSED even though
//   the login itself succeeds — confirmed via device logs). See
//   nativeMediaSession() in player.js for the same isNative() pattern.
//
// Both sides expose the same five functions (initAuth, signIn, signOut,
// getAccessToken, getActiveAccount) so js/app.js and js/graph.js need no
// platform-specific code at all.

function isNative() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform());
}

// ---------- Web: MSAL.js redirect flow ----------

const msalInstance = new msal.PublicClientApplication({
  auth: {
    clientId: APP_CONFIG.clientId,
    authority: APP_CONFIG.authority,
    // The directory containing index.html (works whether the app is hosted
    // at the domain root or under a subpath, e.g. GitHub Pages project sites
    // at "https://user.github.io/repo/"). manifest.json's start_url/scope are
    // both "./" (relative), so the home-screen shortcut resolves to this same
    // directory too — keeping this in sync with however the app was opened.
    redirectUri: window.location.origin + window.location.pathname.replace(/[^/]*$/, ""),
  },
  cache: {
    cacheLocation: "localStorage",
    storeAuthStateInCookie: false,
  },
});

async function webInitAuth() {
  await msalInstance.initialize();
  const response = await msalInstance.handleRedirectPromise();
  if (response && response.account) {
    msalInstance.setActiveAccount(response.account);
  }
  return webGetActiveAccount();
}

function webGetActiveAccount() {
  const active = msalInstance.getActiveAccount();
  if (active) return active;
  const accounts = msalInstance.getAllAccounts();
  if (accounts.length > 0) {
    msalInstance.setActiveAccount(accounts[0]);
    return accounts[0];
  }
  return null;
}

async function webSignIn() {
  await msalInstance.loginRedirect({ scopes: APP_CONFIG.scopes });
}

function webSignOut() {
  msalInstance.logoutRedirect();
}

async function webGetAccessToken() {
  const account = webGetActiveAccount();
  if (!account) throw new Error("Not signed in");
  try {
    const result = await msalInstance.acquireTokenSilent({
      scopes: APP_CONFIG.scopes,
      account,
    });
    return result.accessToken;
  } catch (err) {
    // Silent refresh failed (expired session, etc.) — fall back to interactive.
    await msalInstance.acquireTokenRedirect({ scopes: APP_CONFIG.scopes });
    throw err; // page will redirect away before this matters
  }
}

// ---------- Native: hand-rolled Authorization Code + PKCE flow ----------
// Bypasses @capacitor-community/generic-oauth2 entirely. That plugin wraps
// AppAuth-Android, whose internal Activity/requestCode handling kept hitting
// Android-specific dispatch bugs (redirect format, a cancellation race, a
// response-parsing error, a duplicate-relay-activity bug, and finally the
// same "Capacitor can't match this requestCode to a plugin" failure even
// after fixing all of those) — never reliably completing a sign-in.
//
// This uses only Capacitor's own core plugins instead: Browser (opens the
// system browser for the login page) and App (a plain "appUrlOpen" event
// when the browser hands off to our custom URL scheme) — neither involves
// any ActivityResult/requestCode plumbing at all. The token exchange itself
// is a completely standard OAuth2 Authorization Code + PKCE POST, done via
// CapacitorHttp (routed through native Android networking) rather than
// fetch() — a plain WebView fetch() to Microsoft's token endpoint risks CORS
// rejection, since our origin (https://localhost) isn't a registered
// Single-page-application redirect origin the way the real website's is.

const NATIVE_TOKEN_KEY = "nativeAuthTokens"; // {accessToken, refreshToken, expiresAt} — parallels MSAL's own localStorage cache, no key collision
const NATIVE_PENDING_KEY = "nativeAuthPending"; // {codeVerifier, state}, held only between opening the browser and getting the redirect back
const NATIVE_REDIRECT_URL = "com.nikko.musicplayerpwa://auth"; // must match capacitor.config.json's appId + the manifest's custom-scheme intent-filter host

function base64UrlEncode(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomPkceString() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function sha256Base64Url(input) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return base64UrlEncode(new Uint8Array(digest));
}

function getStoredNativeTokens() {
  try {
    return JSON.parse(localStorage.getItem(NATIVE_TOKEN_KEY) || "null");
  } catch {
    return null;
  }
}

function storeNativeTokens(tokens) {
  localStorage.setItem(NATIVE_TOKEN_KEY, JSON.stringify(tokens));
}

// Routed through native networking (see file-header comment) rather than
// fetch(), so this only ever runs on the native side.
async function tokenEndpointRequest(params) {
  const result = await window.Capacitor.Plugins.CapacitorHttp.post({
    url: `${APP_CONFIG.authority}/oauth2/v2.0/token`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    data: params,
  });
  if (result.status < 200 || result.status >= 300) {
    const msg = (result.data && (result.data.error_description || result.data.error)) || `Token request failed (${result.status})`;
    throw new Error(msg);
  }
  return result.data;
}

function tokensFromResponse(data) {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
}

async function nativeInitAuth() {
  return nativeGetActiveAccount();
}

function nativeGetActiveAccount() {
  return getStoredNativeTokens() ? { native: true } : null;
}

let pendingSignIn = null; // {resolve, reject} for the in-flight nativeSignIn() promise, settled from the appUrlOpen listener below

async function nativeSignIn() {
  const codeVerifier = randomPkceString();
  const state = randomPkceString();
  const codeChallenge = await sha256Base64Url(codeVerifier);
  localStorage.setItem(NATIVE_PENDING_KEY, JSON.stringify({ codeVerifier, state }));

  const authUrl =
    `${APP_CONFIG.authority}/oauth2/v2.0/authorize?` +
    `client_id=${encodeURIComponent(APP_CONFIG.clientId)}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(NATIVE_REDIRECT_URL)}` +
    `&scope=${encodeURIComponent(APP_CONFIG.scopes.join(" "))}` +
    `&code_challenge=${encodeURIComponent(codeChallenge)}` +
    `&code_challenge_method=S256` +
    `&state=${encodeURIComponent(state)}`;

  return new Promise((resolve, reject) => {
    pendingSignIn = { resolve, reject };
    window.Capacitor.Plugins.Browser.open({ url: authUrl });
  });
}

// Registered once at load — handles the OAuth redirect whenever the system
// browser hands off to our custom scheme, regardless of when that happens.
if (isNative()) {
  window.Capacitor.Plugins.App.addListener("appUrlOpen", async (event) => {
    if (!event.url || !event.url.startsWith(NATIVE_REDIRECT_URL)) return;
    window.Capacitor.Plugins.Browser.close().catch(() => {});

    const callback = pendingSignIn;
    pendingSignIn = null;
    const pending = JSON.parse(localStorage.getItem(NATIVE_PENDING_KEY) || "null");
    localStorage.removeItem(NATIVE_PENDING_KEY);

    try {
      const url = new URL(event.url);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error_description") || url.searchParams.get("error");
      if (error) throw new Error(error);
      if (!code || !pending || state !== pending.state) throw new Error("Sign-in response invalid or expired");

      const data = await tokenEndpointRequest({
        client_id: APP_CONFIG.clientId,
        grant_type: "authorization_code",
        code,
        redirect_uri: NATIVE_REDIRECT_URL,
        code_verifier: pending.codeVerifier,
        scope: APP_CONFIG.scopes.join(" "),
      });
      storeNativeTokens(tokensFromResponse(data));
      callback && callback.resolve();
    } catch (err) {
      callback && callback.reject(err);
    }
  });
}

function nativeSignOut() {
  localStorage.removeItem(NATIVE_TOKEN_KEY);
}

async function nativeGetAccessToken() {
  const tokens = getStoredNativeTokens();
  if (!tokens) throw new Error("Not signed in");
  if (tokens.expiresAt - 60000 > Date.now()) return tokens.accessToken;

  try {
    const data = await tokenEndpointRequest({
      client_id: APP_CONFIG.clientId,
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
      scope: APP_CONFIG.scopes.join(" "),
    });
    const fresh = tokensFromResponse(data);
    if (!fresh.refreshToken) fresh.refreshToken = tokens.refreshToken; // refresh response may omit it, keep the one we have
    storeNativeTokens(fresh);
    return fresh.accessToken;
  } catch (err) {
    localStorage.removeItem(NATIVE_TOKEN_KEY);
    throw new Error("Sign-in expired — please sign in again");
  }
}

// ---------- Public API — picks a side, used by app.js / graph.js ----------

function initAuth() {
  return isNative() ? nativeInitAuth() : webInitAuth();
}

function getActiveAccount() {
  return isNative() ? nativeGetActiveAccount() : webGetActiveAccount();
}

function signIn() {
  return isNative() ? nativeSignIn() : webSignIn();
}

function signOut() {
  return isNative() ? nativeSignOut() : webSignOut();
}

function getAccessToken() {
  return isNative() ? nativeGetAccessToken() : webGetAccessToken();
}
