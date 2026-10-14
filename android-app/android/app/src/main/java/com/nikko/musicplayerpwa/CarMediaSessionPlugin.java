package com.nikko.musicplayerpwa;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Mirrors playback metadata/state into CarMediaBrowserService's session, so
// Android Auto's now-playing screen shows the same thing as the phone's own
// notification — see the comment at the top of CarMediaBrowserService for
// why that's a separate session from @jofr/capacitor-media-session's,
// rather than reusing it directly. Called from js/player/carMediaSession.js.
@CapacitorPlugin(name = "CarMediaSession")
public class CarMediaSessionPlugin extends Plugin {
    @PluginMethod
    public void setMetadata(PluginCall call) {
        CarMediaBrowserService.updateMetadata(
                call.getString("title", ""),
                call.getString("artist", ""),
                call.getString("album", ""),
                Math.round(call.getDouble("durationMs", 0.0))
        );
        call.resolve();
    }

    @PluginMethod
    public void setPlaybackState(PluginCall call) {
        CarMediaBrowserService.updatePlaybackState(
                Boolean.TRUE.equals(call.getBoolean("playing", false)),
                Math.round(call.getDouble("positionMs", 0.0))
        );
        call.resolve();
    }
}
