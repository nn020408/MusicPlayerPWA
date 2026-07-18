// Handles sign-in with a personal Microsoft account via MSAL.js (redirect flow,
// which is far more reliable than popups on mobile browsers).

const msalInstance = new msal.PublicClientApplication({
  auth: {
    clientId: APP_CONFIG.clientId,
    authority: APP_CONFIG.authority,
    // Always the site root, regardless of what path the app was actually
    // opened from — the home-screen shortcut launches via the manifest's
    // start_url ("/index.html"), which doesn't match the root path
    // registered as the redirect URI in Azure. Using window.location.pathname
    // here would send a redirect_uri that only matches when opened via a
    // plain browser tab at "/", causing "redirect_uri is not valid" from
    // the shortcut specifically.
    redirectUri: window.location.origin + "/",
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
