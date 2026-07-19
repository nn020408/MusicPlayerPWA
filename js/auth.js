// Handles sign-in with a personal Microsoft account via MSAL.js (redirect flow,
// which is far more reliable than popups on mobile browsers).

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

let msalReady;

async function initAuth() {
  msalReady = msalInstance.initialize();
  await msalReady;
  const response = await msalInstance.handleRedirectPromise();
  if (response && response.account) {
    msalInstance.setActiveAccount(response.account);
  }
  return getActiveAccount();
}

function getActiveAccount() {
  const active = msalInstance.getActiveAccount();
  if (active) return active;
  const accounts = msalInstance.getAllAccounts();
  if (accounts.length > 0) {
    msalInstance.setActiveAccount(accounts[0]);
    return accounts[0];
  }
  return null;
}

async function signIn() {
  await msalInstance.loginRedirect({ scopes: APP_CONFIG.scopes });
}

function signOut() {
  msalInstance.logoutRedirect();
}

// Returns a valid access token, refreshing silently when possible.
async function getAccessToken() {
  const account = getActiveAccount();
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
