package com.nikko.musicplayerpwa;

import android.content.Context;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

// Mirrors js/data/graph.js's refreshDownloadUrl(): same endpoint, same "no
// $select" rule (selecting fields unreliably drops
// @microsoft.graph.downloadUrl on personal OneDrive accounts), same retry
// profile (retryWithBackoff: 8 attempts, exponential, 30s cap, 404
// excluded). Needed so Next/Previous/auto-advance can resolve a fresh
// streaming URL without the WebView/JS being awake at all.
class NativeGraphClient {
    private static final String GRAPH_ROOT = "https://graph.microsoft.com/v1.0";

    // Mirrors Graph returning 404 for a deleted/moved OneDrive item -- callers
    // drop that track from the queue rather than retrying it indefinitely.
    static class ItemGoneException extends IOException {
        ItemGoneException(String message) {
            super(message);
        }
    }

    static String resolveDownloadUrl(Context context, String itemId) throws IOException {
        int maxAttempts = 8;
        long delay = 2000;
        final long maxDelay = 30000;
        IOException lastError = null;
        for (int attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                return resolveOnce(context, itemId);
            } catch (ItemGoneException e) {
                throw e; // not retryable, same as graph.js's shouldRetry
            } catch (IOException e) {
                lastError = e;
                if (attempt == maxAttempts - 1) break;
                try {
                    Thread.sleep(delay);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw e;
                }
                delay = Math.min(delay * 2, maxDelay);
            }
        }
        throw lastError != null ? lastError : new IOException("Couldn't resolve download URL");
    }

    private static String resolveOnce(Context context, String itemId) throws IOException {
        String token = NativeAuthClient.getInstance(context).getAccessToken();
        HttpURLConnection conn = (HttpURLConnection) new URL(GRAPH_ROOT + "/me/drive/items/" + itemId).openConnection();
        try {
            conn.setRequestMethod("GET");
            conn.setRequestProperty("Authorization", "Bearer " + token);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
            int status = conn.getResponseCode();
            if (status == 404) throw new ItemGoneException("OneDrive item not found: " + itemId);
            String body = readAll(status >= 200 && status < 300 ? conn.getInputStream() : conn.getErrorStream());
            if (status < 200 || status >= 300) throw new IOException("Graph request failed: " + status);
            JSONObject json = new JSONObject(body);
            String url = json.optString("@microsoft.graph.downloadUrl", null);
            if (url == null) throw new IOException("OneDrive didn't provide a download link for this item");
            return url;
        } catch (JSONException e) {
            throw new IOException("Couldn't parse Graph response", e);
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
