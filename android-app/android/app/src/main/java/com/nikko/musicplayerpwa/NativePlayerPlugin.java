package com.nikko.musicplayerpwa;

import android.content.Intent;
import android.os.Handler;
import android.os.Looper;

import androidx.core.content.ContextCompat;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// JS-facing surface for the native playback engine (feature/native-playback,
// skeleton stage — see PlaybackService). Events go through notifyListeners()
// rather than the setKeepAlive()+re-resolve trick @jofr/capacitor-media-
// session uses: that pattern is vendored third-party code, not this
// codebase's own convention, and notifyListeners() is Capacitor's ordinary
// mechanism for exactly this ("repeated events, possibly more than one
// listener") case.
@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private Player.Listener playerListener;

    private ExoPlayer currentPlayer() {
        PlaybackService service = PlaybackService.getInstance();
        return service != null ? service.getPlayer() : null;
    }

    // startForegroundService() returning doesn't mean the Service has
    // actually run onCreate() yet — this crude poll-with-timeout stands in
    // for a proper bind/ready callback until the full queue port (milestone
    // 2) replaces it; fine for a first on-device smoke test, not meant to
    // ship as-is.
    private void withPlayerReady(int attemptsLeft, Runnable onReady, Runnable onTimeout) {
        ExoPlayer player = currentPlayer();
        if (player != null) {
            onReady.run();
            return;
        }
        if (attemptsLeft <= 0) {
            onTimeout.run();
            return;
        }
        main.postDelayed(() -> withPlayerReady(attemptsLeft - 1, onReady, onTimeout), 50);
    }

    private void attachListenerIfNeeded(ExoPlayer player) {
        if (playerListener != null) return;
        playerListener = new Player.Listener() {
            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                JSObject data = new JSObject();
                data.put("playing", isPlaying);
                data.put("positionMs", player.getCurrentPosition());
                notifyListeners("playbackState", data);
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_ENDED) {
                    notifyListeners("trackEnded", new JSObject());
                }
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                JSObject data = new JSObject();
                data.put("message", error.getMessage());
                notifyListeners("error", data);
            }
        };
        player.addListener(playerListener);
    }

    @PluginMethod
    public void load(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("No url given");
            return;
        }
        String title = call.getString("title", "");
        String artist = call.getString("artist", "");
        String album = call.getString("album", "");
        double resumePositionMs = call.getDouble("resumePositionMs", 0.0);

        Intent intent = new Intent(getContext(), PlaybackService.class);
        ContextCompat.startForegroundService(getContext(), intent);

        withPlayerReady(
                40, // ~2s worst case
                () -> main.post(() -> {
                    ExoPlayer player = currentPlayer();
                    if (player == null) {
                        call.reject("Playback service not available");
                        return;
                    }
                    attachListenerIfNeeded(player);
                    MediaMetadata metadata = new MediaMetadata.Builder()
                            .setTitle(title)
                            .setArtist(artist)
                            .setAlbumTitle(album)
                            .build();
                    MediaItem item = new MediaItem.Builder().setUri(url).setMediaMetadata(metadata).build();
                    player.setMediaItem(item, Math.round(resumePositionMs));
                    player.prepare();
                    player.play();
                    call.resolve();
                }),
                () -> call.reject("Playback service didn't start in time")
        );
    }

    @PluginMethod
    public void play(PluginCall call) {
        main.post(() -> {
            ExoPlayer player = currentPlayer();
            if (player != null) player.play();
        });
        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        main.post(() -> {
            ExoPlayer player = currentPlayer();
            if (player != null) player.pause();
        });
        call.resolve();
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        double positionMs = call.getDouble("positionMs", 0.0);
        main.post(() -> {
            ExoPlayer player = currentPlayer();
            if (player != null) player.seekTo(Math.round(positionMs));
        });
        call.resolve();
    }

    @PluginMethod
    public void getState(PluginCall call) {
        // ExoPlayer enforces same-thread access (it was built on the main
        // thread in PlaybackService.onCreate()) -- @PluginMethod calls run on
        // Capacitor's own "CapacitorPlugins" thread, not main, so every read
        // has to hop over via main.post() same as the write methods above.
        // Confirmed on-device: calling player.isPlaying() directly from here
        // crashed the app outright (IllegalStateException, wrong thread).
        main.post(() -> {
            ExoPlayer player = currentPlayer();
            JSObject data = new JSObject();
            data.put("playing", player != null && player.isPlaying());
            data.put("positionMs", player != null ? player.getCurrentPosition() : 0);
            data.put("durationMs", player != null ? player.getDuration() : 0);
            call.resolve(data);
        });
    }
}
