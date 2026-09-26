package com.nikko.musicplayerpwa;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.WebView;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// JS-facing switch for IndexKeepAliveService. start() also keeps the WebView
// treating itself as visible while the app is in the background: without that
// Chromium throttles timers to about one a second once the page is hidden,
// which would crawl the indexer's pacing even though the network is alive.
@CapacitorPlugin(name = "IndexKeepAlive")
public class IndexKeepAlivePlugin extends Plugin {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean active = false;

    private final Runnable keepVisible = new Runnable() {
        @Override
        public void run() {
            if (!active) return;
            WebView web = getBridge() != null ? getBridge().getWebView() : null;
            if (web != null) {
                web.dispatchWindowVisibilityChanged(View.VISIBLE);
                web.resumeTimers();
            }
            handler.postDelayed(this, 4000);
        }
    };

    private void send(String text) {
        Context ctx = getContext();
        Intent i = new Intent(ctx, IndexKeepAliveService.class);
        i.putExtra(IndexKeepAliveService.EXTRA_TEXT, text);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i);
        else ctx.startService(i);
    }

    @PluginMethod
    public void start(PluginCall call) {
        send(call.getString("text", "Reading artist names…"));
        if (!active) {
            active = true;
            handler.post(keepVisible);
        }
        call.resolve();
    }

    @PluginMethod
    public void update(PluginCall call) {
        if (active) send(call.getString("text", "Reading artist names…"));
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        active = false;
        handler.removeCallbacks(keepVisible);
        Intent i = new Intent(getContext(), IndexKeepAliveService.class);
        i.setAction(IndexKeepAliveService.ACTION_STOP);
        getContext().startService(i);
        call.resolve();
    }
}
