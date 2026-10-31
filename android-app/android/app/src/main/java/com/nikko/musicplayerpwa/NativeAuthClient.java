package com.nikko.musicplayerpwa;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

// Native-side half of the refresh-token grant -- mirrors js/data/auth.js's
// nativeGetAccessToken() exactly (same token endpoint, same five POST
// params, same "keep the old refresh token if the response omits one" rule).
// Needed so Next/Previous/auto-advance's Graph calls (see NativeGraphClient)
// can get a bearer token without the WebView being awake. Initial sign-in
// (system browser, PKCE) stays entirely in JS -- this class only ever does
// the refresh-token grant, fed by tokens auth.js pushes in via
// NativePlayerPlugin.setAuthTokens() (sign-in, a JS-side refresh, and once at
// JS startup).
class NativeAuthClient {
    private static final String PREFS = "native_auth";
    private static final String KEY_ACCESS = "accessToken";
    private static final String KEY_REFRESH = "refreshToken";
    private static final String KEY_EXPIRES = "expiresAt";

    // Mirrors js/core/config.js's APP_CONFIG -- kept in sync by hand, same as
    // APP_VERSION/sw.js's CACHE_NAME already are elsewhere in this codebase.
    private static final String AUTHORITY = "https://login.microsoftonline.com/consumers";
    private static final String CLIENT_ID = "d5dfb518-91f5-4082-ad30-b2df5adc1ae5";
    private static final String SCOPES = "Files.ReadWrite offline_access User.Read";

    // Microsoft explicitly rejected the refresh request (a 4xx response, not a
    // connectivity failure -- see post()) -- the stored refresh token is dead
    // and retrying with it again will fail identically every time. Confirmed
    // on-device as the real cause of a sustained outage: NativeGraphClient's
    // retry-with-backoff used to treat this the same as an ordinary network
    // blip and retried the SAME now-dead token up to 8 times in quick
    // succession, which is exactly a "client request loop" to Microsoft's
    // server -- it started responding with AADSTS50196 ("the server
    // encountered a client request loop") and refusing the request outright,
    // turning one bad token into a recurring several-minute outage across
    // multiple songs instead of a single clean failure.
    static class TokenRejectedException extends IOException {
        TokenRejectedException(String message) {
            super(message);
        }
    }

    // How long to refuse even trying a refresh again right after Microsoft
    // rejected one -- confirmed on-device as a real, separate contributor to
    // the AADSTS50196 lockout alongside the retry-loop bug: rapidly mashing
    // Next/Previous (an entirely reasonable reaction when the UI looks
    // frozen) made each press try its own refresh in quick succession, which
    // looks the same to Microsoft's abuse detection as one request retrying
    // itself. This absorbs that burst locally -- short enough that a real fix
    // (signing in again, which calls setTokens() and clears this below) is
    // noticed almost immediately, long enough to cover a few seconds of rapid
    // repeat taps.
    private static final long REJECTION_COOLDOWN_MS = 15000;

    private static NativeAuthClient instance;

    private final SharedPreferences prefs;
    private String accessToken;
    private String refreshToken;
    private long expiresAt;
    private long rejectedUntil = 0;

    static synchronized NativeAuthClient getInstance(Context context) {
        if (instance == null) instance = new NativeAuthClient(context.getApplicationContext());
        return instance;
    }

    private NativeAuthClient(Context context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        accessToken = prefs.getString(KEY_ACCESS, null);
        refreshToken = prefs.getString(KEY_REFRESH, null);
        expiresAt = prefs.getLong(KEY_EXPIRES, 0);
    }

    synchronized void setTokens(String access, String refresh, long expiresAtMs) {
        accessToken = access;
        refreshToken = refresh;
        expiresAt = expiresAtMs;
        rejectedUntil = 0; // a fresh token (sign-in or a successful refresh) -- any earlier cooldown no longer applies
        prefs.edit().putString(KEY_ACCESS, access).putString(KEY_REFRESH, refresh).putLong(KEY_EXPIRES, expiresAtMs).apply();
    }

    synchronized void clearTokens() {
        accessToken = null;
        refreshToken = null;
        expiresAt = 0;
        prefs.edit().clear().apply();
    }

    // Blocking network call -- only ever invoked from NativeGraphClient on a
    // background executor thread, never from main. Returns a valid access
    // token, refreshing first if it's within 60s of expiry (same buffer as
    // auth.js's nativeGetAccessToken()) or already expired. `synchronized` is
    // this class's single-flight guard, mirroring auth.js's refreshPromise --
    // a burst of concurrent native Graph calls near expiry shares one refresh
    // instead of racing a rotating refresh token against itself.
    synchronized String getAccessToken() throws IOException {
        return getAccessToken(false);
    }

    // `force` skips the "still fresh by our own clock" shortcut -- for when a
    // Graph resource call (a completely different endpoint; this class never
    // sees it) came back 401 with a token this clock-based check still
    // considers valid. Only the caller who saw the actual 401 knows the
    // cached token is bad; this class can't infer that on its own.
    synchronized String getAccessToken(boolean force) throws IOException {
        // Checked before anything else -- see REJECTION_COOLDOWN_MS's own
        // comment. A rapid-fire burst of Next/Previous presses within this
        // window never reaches the network at all, instead of each one
        // trying (and failing) its own refresh.
        if (System.currentTimeMillis() < rejectedUntil) {
            throw new TokenRejectedException("Sign-in was just rejected -- waiting before trying again");
        }
        // Same non-retryable family as a rejected refresh (see
        // TokenRejectedException) -- a missing token won't appear on retry
        // either, only once JS pushes fresh ones in via setAuthTokens().
        if (refreshToken == null) throw new TokenRejectedException("Not signed in");
        if (!force && accessToken != null && expiresAt - 60000 > System.currentTimeMillis()) return accessToken;
        refresh();
        return accessToken;
    }

    // Exposes the full current token set (after ensuring it's fresh, same as
    // getAccessToken()) for NativePlayerPlugin.getAccessToken() -- the single
    // path JS now goes through instead of keeping its own separate refresh
    // logic in auth.js. Confirmed on-device as the real cause behind
    // AADSTS50196 ("client request loop"): native and JS each had their own
    // independent "is my token stale" check and could both decide to refresh
    // within the same second, each unaware of the other -- three refreshes
    // within 3 seconds, the third one rejected, is what Microsoft's own
    // abuse detection saw. This class's `synchronized` already serializes
    // every caller correctly; the fix is routing JS through this one
    // implementation instead of running a second, uncoordinated copy of it.
    synchronized String[] getTokenSnapshot(boolean force) throws IOException {
        getAccessToken(force);
        return new String[]{accessToken, refreshToken, String.valueOf(expiresAt)};
    }

    private void refresh() throws IOException {
        String body = "client_id=" + enc(CLIENT_ID)
                + "&grant_type=refresh_token"
                + "&refresh_token=" + enc(refreshToken)
                + "&scope=" + enc(SCOPES);
        JSONObject data;
        try {
            data = post(AUTHORITY + "/oauth2/v2.0/token", body);
        } catch (TokenRejectedException e) {
            // Microsoft rejected this exact refresh token -- clear it instead
            // of leaving it in place for the next advance attempt to retry
            // and fail identically (see TokenRejectedException's own
            // comment).
            clearTokens();
            rejectedUntil = System.currentTimeMillis() + REJECTION_COOLDOWN_MS;
            // Tells JS to forget its own cached copy too, instead of trusting
            // it (by locally-cached expiresAt alone) for up to ~55 more
            // minutes while native has already given up on the same tokens.
            NativePlayerPlugin plugin = NativePlayerPlugin.getInstance();
            if (plugin != null) plugin.notifyAuthTokensCleared();
            throw e;
        }
        String newAccess = data.optString("access_token", null);
        if (newAccess == null) throw new IOException("Token refresh returned no access_token");
        // Refresh response may omit it -- keep the one we have, same rule as auth.js.
        String newRefresh = data.optString("refresh_token", refreshToken);
        long expiresIn = data.optLong("expires_in", 3600);
        long newExpiresAt = System.currentTimeMillis() + expiresIn * 1000;
        setTokens(newAccess, newRefresh, newExpiresAt);

        // Keep JS's own copy (localStorage) in sync, in case native rotated
        // the refresh token while the WebView was frozen -- see auth.js's
        // "nativeAuthTokensUpdated" listener.
        NativePlayerPlugin plugin = NativePlayerPlugin.getInstance();
        if (plugin != null) plugin.notifyAuthTokensUpdated(newAccess, newRefresh, newExpiresAt);
    }

    private static String enc(String s) throws IOException {
        return URLEncoder.encode(s, "UTF-8");
    }

    private static JSONObject post(String urlStr, String body) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        try {
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.getBytes(StandardCharsets.UTF_8));
            }
            int status = conn.getResponseCode();
            String responseBody = readAll(status >= 200 && status < 300 ? conn.getInputStream() : conn.getErrorStream());
            JSONObject json;
            try {
                json = new JSONObject(responseBody);
            } catch (Exception e) {
                json = new JSONObject();
            }
            if (status < 200 || status >= 300) {
                // Reaching here means the server actually answered (just with
                // a rejection) -- a real connectivity failure (timeout, no
                // route, DNS) throws its own IOException earlier, from
                // openConnection()/getOutputStream()/getResponseCode()
                // itself, and never reaches this line. That split is what
                // lets callers retry a connectivity hiccup but not a
                // confirmed-bad token -- see TokenRejectedException.
                String msg = json.has("error_description") ? json.optString("error_description") : "Token request failed (" + status + ")";
                throw new TokenRejectedException(msg);
            }
            return json;
        } finally {
            conn.disconnect();
        }
    }

    private static String readAll(InputStream in) throws IOException {
        if (in == null) return "";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
        return out.toString("UTF-8");
    }
}
