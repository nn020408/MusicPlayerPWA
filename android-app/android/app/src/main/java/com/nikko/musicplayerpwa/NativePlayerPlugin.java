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

// JS-facing surface for the native playback engine (feature/native-playback
// — see js/player/nativeAudioElement.js, which this exists to back). Events
// go through notifyListeners() rather than the setKeepAlive()+re-resolve
// trick @jofr/capacitor-media-session uses: that pattern is vendored
// third-party code, not this codebase's own convention, and notifyListeners()
// is Capacitor's ordinary mechanism for exactly this ("repeated events,
// possibly more than one listener") case.
@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin {
    private static final long POSITION_TICK_MS = 500;

    private final Handler main = new Handler(Looper.getMainLooper());
    private Player.Listener playerListener;
    // Which ExoPlayer instance playerListener is currently attached to --
    // PlaybackService can be killed and recreated (onTaskRemoved, or the OS
    // reclaiming it under memory pressure) with a brand new ExoPlayer, and
    // "playerListener != null" alone can't tell the old, orphaned listener
    // apart from one that's actually attached to the current player.
    private ExoPlayer listenerAttachedTo;
    private final Runnable positionTicker = this::tickPosition;
    private boolean tickerRunning = false;

    // The load()/play() call waiting for playback to genuinely start (not
    // just "requested") -- mirrors the exact contract player.js already
    // depends on for the web <audio> element: loadedTrackId is set only once
    // audioEl.play() has actually resolved, not right after .src is
    // assigned, specifically so a load that's requested but never actually
    // starts (buffering failure, network drop) doesn't get treated as
    // "loaded" by resumePlayback()'s fast path. See player.js's comment on
    // loadedTrackId for the bug this guards against.
    private PluginCall pendingStartCall;

    private ExoPlayer currentPlayer() {
        PlaybackService service = PlaybackService.getInstance();
        return service != null ? service.getPlayer() : null;
    }

    // startForegroundService() returning doesn't mean the Service has
    // actually run onCreate() yet -- this crude poll-with-timeout stands in
    // for a proper bind/ready callback; fine since PlaybackService.onCreate()
    // itself calls startForeground() synchronously (see its own comment), so
    // in practice this resolves on the very first or second poll.
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

    private void resolvePendingStart() {
        if (pendingStartCall != null) {
            pendingStartCall.resolve();
            pendingStartCall = null;
        }
    }

    private void rejectPendingStart(String message) {
        if (pendingStartCall != null) {
            pendingStartCall.reject(message);
            pendingStartCall = null;
        }
    }

    private void startPositionTicker() {
        if (tickerRunning) return;
        tickerRunning = true;
        main.post(positionTicker);
    }

    private void stopPositionTicker() {
        tickerRunning = false;
        main.removeCallbacks(positionTicker);
    }

    private void tickPosition() {
        if (!tickerRunning) return;
        ExoPlayer player = currentPlayer();
        if (player != null) {
            JSObject data = new JSObject();
            data.put("positionMs", player.getCurrentPosition());
            data.put("durationMs", player.getDuration());
            notifyListeners("positionUpdate", data);
        }
        main.postDelayed(positionTicker, POSITION_TICK_MS);
    }

    private void attachListenerIfNeeded(ExoPlayer player) {
        if (listenerAttachedTo == player) return;
        playerListener = new Player.Listener() {
            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                JSObject data = new JSObject();
                data.put("playing", isPlaying);
                data.put("positionMs", player.getCurrentPosition());
                data.put("durationMs", player.getDuration());
                notifyListeners("playbackState", data);
                if (isPlaying) {
                    startPositionTicker();
                    resolvePendingStart();
                } else {
                    stopPositionTicker();
                }
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_ENDED) {
                    stopPositionTicker();
                    notifyListeners("trackEnded", new JSObject());
                    // Reached the end without ever actually playing (e.g. a
                    // corrupt/zero-length file) -- nothing left to wait for.
                    rejectPendingStart("Playback ended before it started");
                }
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                JSObject data = new JSObject();
                data.put("message", error.getMessage());
                notifyListeners("error", data);
                rejectPendingStart(error.getMessage());
            }
        };
        player.addListener(playerListener);
        listenerAttachedTo = player;
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
        long resumePositionMs = Math.round(call.getDouble("resumePositionMs", 0.0));

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
                    rejectPendingStart("Superseded by a newer load/play call");
                    pendingStartCall = call;
                    MediaMetadata metadata = new MediaMetadata.Builder()
                            .setTitle(title)
                            .setArtist(artist)
                            .setAlbumTitle(album)
                            .build();
                    MediaItem item = new MediaItem.Builder().setUri(url).setMediaMetadata(metadata).build();
                    player.setMediaItem(item, resumePositionMs);
                    player.prepare();
                    player.play();
                }),
                () -> call.reject("Playback service didn't start in time")
        );
    }

    @PluginMethod
    public void play(PluginCall call) {
        main.post(() -> {
            ExoPlayer player = currentPlayer();
            if (player == null) {
                call.reject("Playback service not available");
                return;
            }
            if (player.isPlaying()) {
                call.resolve();
                return;
            }
            rejectPendingStart("Superseded by a newer load/play call");
            pendingStartCall = call;
            player.play();
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        main.post(() -> {
            ExoPlayer player = currentPlayer();
            if (player != null) player.pause();
            // playWhenReady=false means onIsPlayingChanged(true) will never
            // fire for whatever load()/play() call is still waiting -- left
            // unresolved otherwise, confirmed on-device to hang forever
            // (e.g. resetPlayer() pausing while a track is still buffering).
            rejectPendingStart("Paused before playback started");
        });
        call.resolve();
    }

    // Used by resetPlayer() (sign-out) to fully let go of whatever's loaded,
    // rather than leaving the previous (possibly now signed-out) account's
    // track sitting paused in the foreground notification/lock-screen
    // session indefinitely.
    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> {
            ExoPlayer player = currentPlayer();
            if (player != null) {
                player.stop();
                player.clearMediaItems();
            }
            rejectPendingStart("Stopped");
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

    // Updates the currently-loaded item's metadata (title/artist/album) once
    // the real ID3 tags resolve, without restarting playback or losing
    // position -- ExoPlayer's replaceMediaItem() is specifically designed to
    // preserve both across a metadata-only change. See player.js's
    // updateMediaSessionMetadata()/the id3Promise .then() block, which call
    // this the same way they already call the (now-redundant but harmless)
    // old native plugin's setMetadata().
    @PluginMethod
    public void setMetadata(PluginCall call) {
        String title = call.getString("title", "");
        String artist = call.getString("artist", "");
        String album = call.getString("album", "");
        main.post(() -> {
            ExoPlayer player = currentPlayer();
            if (player == null || player.getCurrentMediaItem() == null) {
                call.resolve();
                return;
            }
            MediaItem current = player.getCurrentMediaItem();
            MediaMetadata metadata = new MediaMetadata.Builder()
                    .setTitle(title)
                    .setArtist(artist)
                    .setAlbumTitle(album)
                    .build();
            MediaItem updated = current.buildUpon().setMediaMetadata(metadata).build();
            player.replaceMediaItem(player.getCurrentMediaItemIndex(), updated);
            call.resolve();
        });
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
