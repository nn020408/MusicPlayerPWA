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

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

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
    // Bounds the 404-drop-and-retry loop in resolveAndLoad() so a fully-stale
    // queue can't spin forever.
    private static final int MAX_QUEUE_ADVANCE_RETRIES = 25;

    // Lets QueueAwarePlayer (owned by PlaybackService, a separate Android
    // component with no direct reference to this plugin instance) reach back
    // into native Next/Previous handling below -- the reverse direction of
    // PlaybackService.getInstance(). Also reached by NativeAuthClient to
    // report a token it rotated on its own back to JS.
    private static NativePlayerPlugin instance;

    private final Handler main = new Handler(Looper.getMainLooper());
    // Resolving a queue advance means a blocking Graph network call (see
    // NativeGraphClient) -- run off both main and Capacitor's own plugin
    // thread so neither is ever blocked waiting on it.
    private final ExecutorService queueExecutor = Executors.newSingleThreadExecutor();
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

    @Override
    public void load() {
        instance = this;
        // Pre-warm both from SharedPreferences so a hardware key or a track
        // genuinely ending can be served immediately, even if this is the
        // very first thing to touch either class this process.
        NativeQueueManager.getInstance(getContext());
        NativeAuthClient.getInstance(getContext());
    }

    public static NativePlayerPlugin getInstance() {
        return instance;
    }

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
                    // Fired only for UI/state fidelity now (see
                    // NativeAudioElement's "trackEnded" listener) -- nothing
                    // in JS treats this as a trigger anymore. What happens
                    // next is decided right here, unconditionally, since
                    // there's no reliable way to know from native code
                    // whether JS is even awake to react to it.
                    notifyListeners("trackEnded", new JSObject());
                    rejectPendingStart("Playback ended before it started");
                    NativeQueueManager qm = NativeQueueManager.getInstance(getContext());
                    if ("one".equals(qm.getRepeatMode())) {
                        player.seekTo(0);
                        player.play();
                    } else {
                        requestNext();
                    }
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

    // Shared by QueueAwarePlayer (hardware/Bluetooth/notification presses)
    // and the next()/previous() plugin methods below (in-app taps) -- see
    // this class's own javadoc-style comment and QueueAwarePlayer's for why
    // there's exactly one implementation of each.
    void requestNext() {
        advanceQueue(1);
    }

    // Reads position and decides restart-vs-go-back on queueExecutor, the
    // SAME single thread every advance runs on -- NOT a quick check on main
    // racing an in-flight Next's background network resolve. Confirmed
    // on-device that doing the check on main while a prior Next/Previous was
    // still resolving in the background could read a stale, pre-switch
    // position and make the wrong call; routing everything through one
    // single-thread executor makes rapid repeated presses process strictly
    // in order, each seeing the result of the one before it, instead of racing.
    void requestPrevious() {
        queueExecutor.execute(() -> {
            long pos = currentPositionBlocking();
            if (pos > 3000) {
                main.post(() -> {
                    ExoPlayer player = currentPlayer();
                    if (player != null) player.seekTo(0); // restart current track, like most players
                });
            } else {
                resolveAndLoad(-1, MAX_QUEUE_ADVANCE_RETRIES);
            }
        });
    }

    private void advanceQueue(int delta) {
        queueExecutor.execute(() -> resolveAndLoad(delta, MAX_QUEUE_ADVANCE_RETRIES));
    }

    // ExoPlayer enforces same-thread (main) access -- called only from
    // queueExecutor, so this hops to main and blocks briefly waiting for the
    // answer rather than racing it.
    private long currentPositionBlocking() {
        CountDownLatch latch = new CountDownLatch(1);
        long[] result = {-1};
        main.post(() -> {
            ExoPlayer player = currentPlayer();
            result[0] = player != null ? player.getCurrentPosition() : -1;
            latch.countDown();
        });
        try {
            latch.await(2, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        return result[0];
    }

    // Runs on queueExecutor -- resolving a download URL is a blocking network
    // call. Handles both an explicit Next/Previous (delta=±1, and the single
    // retry step after dropping a 404'd track uses delta=0 since `qm` is
    // already sitting on the next candidate) and natural track-end.
    private void resolveAndLoad(int delta, int attemptsLeft) {
        NativeQueueManager qm = NativeQueueManager.getInstance(getContext());
        if (attemptsLeft <= 0 || !qm.advance(delta)) return;
        NativeQueueManager.TrackDescriptor track = qm.getCurrentTrack();
        if (track == null) return;
        try {
            String url = NativeGraphClient.resolveDownloadUrl(getContext(), track.id);
            int position = qm.getPosition();
            main.post(() -> loadResolvedTrack(track, url, position));
        } catch (NativeGraphClient.ItemGoneException e) {
            JSObject data = new JSObject();
            data.put("itemId", track.id);
            notifyListeners("itemUnavailable", data);
            qm.removeAt(qm.getPosition());
            resolveAndLoad(0, attemptsLeft - 1);
        } catch (Exception e) {
            JSObject data = new JSObject();
            data.put("message", e.getMessage());
            notifyListeners("error", data);
        }
    }

    private void loadResolvedTrack(NativeQueueManager.TrackDescriptor track, String url, int position) {
        ExoPlayer player = currentPlayer();
        if (player == null) return;
        attachListenerIfNeeded(player);
        MediaMetadata metadata = new MediaMetadata.Builder()
                .setTitle(track.name)
                .setArtist(track.artist)
                .build();
        MediaItem item = new MediaItem.Builder().setUri(url).setMediaMetadata(metadata).build();
        player.setMediaItem(item, 0);
        player.prepare();
        player.play();
        // UI-sync only (see js/player/nativeQueueSync.js) -- never blocks the
        // actual swap above, which has already happened by the time this fires.
        JSObject data = new JSObject();
        data.put("itemId", track.id);
        data.put("position", position);
        data.put("name", track.name);
        data.put("artist", track.artist);
        notifyListeners("trackChanged", data);
    }

    // Native rotated the refresh token on its own (a Graph call while the
    // WebView was frozen needed a refresh) -- keeps JS's own localStorage
    // copy in sync. See auth.js's "nativeAuthTokensUpdated" listener.
    void notifyAuthTokensUpdated(String accessToken, String refreshToken, long expiresAt) {
        JSObject data = new JSObject();
        data.put("accessToken", accessToken);
        data.put("refreshToken", refreshToken);
        data.put("expiresAt", (double) expiresAt);
        notifyListeners("nativeAuthTokensUpdated", data);
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

    // In-app Next/Previous taps reach the exact same code (requestNext()/
    // requestPrevious()) hardware/notification presses do via
    // QueueAwarePlayer -- see this class's own comment on why.
    @PluginMethod
    public void next(PluginCall call) {
        requestNext();
        call.resolve();
    }

    @PluginMethod
    public void previous(PluginCall call) {
        requestPrevious();
        call.resolve();
    }

    // Pushed by js/player/nativeQueueSync.js on every queue mutation
    // (setQueue/addToQueue/toggleShuffle/playIndex/setUpcomingOrder) --
    // `tracks` is already the flattened play order, never raw shuffle state.
    @PluginMethod
    public void setQueue(PluginCall call) {
        JSArray tracksArray = call.getArray("tracks");
        int position = (int) Math.round(call.getDouble("position", -1.0));
        String repeatMode = call.getString("repeatMode", "off");
        List<NativeQueueManager.TrackDescriptor> tracks = new ArrayList<>();
        if (tracksArray != null) {
            try {
                for (int i = 0; i < tracksArray.length(); i++) {
                    JSONObject t = tracksArray.getJSONObject(i);
                    tracks.add(new NativeQueueManager.TrackDescriptor(
                            t.getString("id"),
                            t.optString("name", ""),
                            t.optString("artist", "")
                    ));
                }
            } catch (JSONException e) {
                call.reject("Invalid tracks array", e);
                return;
            }
        }
        NativeQueueManager.getInstance(getContext()).setQueue(tracks, position, repeatMode);
        call.resolve();
    }

    @PluginMethod
    public void setRepeatMode(PluginCall call) {
        NativeQueueManager.getInstance(getContext()).setRepeatMode(call.getString("repeatMode", "off"));
        call.resolve();
    }

    // Pushed by js/data/auth.js at sign-in, after a JS-side refresh, and once
    // at startup -- see NativeAuthClient's javadoc-style comment.
    @PluginMethod
    public void setAuthTokens(PluginCall call) {
        String accessToken = call.getString("accessToken");
        String refreshToken = call.getString("refreshToken");
        long expiresAt = Math.round(call.getDouble("expiresAt", 0.0));
        NativeAuthClient.getInstance(getContext()).setTokens(accessToken, refreshToken, expiresAt);
        call.resolve();
    }

    @PluginMethod
    public void clearAuthTokens(PluginCall call) {
        NativeAuthClient.getInstance(getContext()).clearTokens();
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
            NativeQueueManager qm = NativeQueueManager.getInstance(getContext());
            NativeQueueManager.TrackDescriptor track = qm.getCurrentTrack();
            data.put("queuePosition", qm.getPosition());
            if (track != null) data.put("itemId", track.id);
            call.resolve(data);
        });
    }
}
