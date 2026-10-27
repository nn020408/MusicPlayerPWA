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

    private static NativeAuthClient instance;

    private final SharedPreferences prefs;
    private String accessToken;
    private String refreshToken;
    private long expiresAt;

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
        if (refreshToken == null) throw new IOException("Not signed in");
        if (accessToken != null && expiresAt - 60000 > System.currentTimeMillis()) return accessToken;
        refresh();
        return accessToken;
    }

    private void refresh() throws IOException {
        String body = "client_id=" + enc(CLIENT_ID)
                + "&grant_type=refresh_token"
                + "&refresh_token=" + enc(refreshToken)
                + "&scope=" + enc(SCOPES);
        JSONObject data = post(AUTHORITY + "/oauth2/v2.0/token", body);
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
                String msg = json.has("error_description") ? json.optString("error_description") : "Token request failed (" + status + ")";
                throw new IOException(msg);
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
