package com.nikko.musicplayerpwa;

import android.app.PendingIntent;
import android.content.Intent;
import android.os.Bundle;
import android.support.v4.media.MediaBrowserCompat.MediaItem;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Log;

import androidx.media.MediaBrowserServiceCompat;
import androidx.media.session.MediaButtonReceiver;

import java.util.ArrayList;
import java.util.List;

// Lets Android Auto show NubePlayer and control playback from the car —
// deliberately scoped to just that (play/pause/skip/metadata mirroring the
// phone's own notification), not browsing the library from the car. The
// real library index lives in the WebView's localStorage; browsing it from
// the car would need a native copy of it this app doesn't keep, which is a
// meaningfully bigger (and, without a real head unit to test against here,
// much riskier) feature left for later.
//
// This owns its own MediaSessionCompat rather than reaching into
// MediaSessionService's (the one @jofr/capacitor-media-session drives, see
// that vendored plugin under node_modules) — MediaBrowserServiceCompat's
// contract wants a session token available synchronously before
// onGetRoot() returns, which an async bind to another service's session
// can't reliably guarantee. Instead, every transport button here
// (play/pause/skip) just re-sends the exact same kind of media-button
// PendingIntent the notification's own Play/Pause/Next buttons already use
// (MediaButtonReceiver.buildMediaButtonPendingIntent — see
// MediaSessionService.connectAndInitialize's own comment on why it takes
// exactly one action at a time) — reusing the already-proven JS routing
// with no changes to it at all. Metadata/state going the other way (so the
// car's now-playing screen shows the right title/artist) is pushed in from
// JS via CarMediaSessionPlugin, called alongside the existing
// @jofr/capacitor-media-session calls in js/player/player.js.
public class CarMediaBrowserService extends MediaBrowserServiceCompat {
    private static final String TAG = "CarMediaBrowserService";
    private static final String ROOT_ID = "root";

    // volatile for cross-thread visibility (onDestroy() runs on the main
    // thread, updateMetadata()/updatePlaybackState() on Capacitor's plugin
    // thread) -- but visibility alone isn't enough: see those methods' own
    // comment for why they snapshot this into a local before checking it.
    private static volatile MediaSessionCompat session;

    @Override
    public void onCreate() {
        super.onCreate();

        session = new MediaSessionCompat(this, "CarMediaBrowserService");
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() { sendMediaButton(PlaybackStateCompat.ACTION_PLAY); }
            @Override
            public void onPause() { sendMediaButton(PlaybackStateCompat.ACTION_PAUSE); }
            @Override
            public void onSkipToNext() { sendMediaButton(PlaybackStateCompat.ACTION_SKIP_TO_NEXT); }
            @Override
            public void onSkipToPrevious() { sendMediaButton(PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS); }
        });
        session.setPlaybackState(new PlaybackStateCompat.Builder()
                .setActions(PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PLAY_PAUSE)
                .setState(PlaybackStateCompat.STATE_PAUSED, 0, 1.0f)
                .build());
        session.setSessionActivity(PendingIntent.getActivity(
                this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE));
        session.setActive(true);
        setSessionToken(session.getSessionToken());
    }

    private void sendMediaButton(long action) {
        try {
            MediaButtonReceiver.buildMediaButtonPendingIntent(this, action).send();
        } catch (PendingIntent.CanceledException e) {
            Log.e(TAG, "Couldn't deliver a car media button press", e);
        }
    }

    // Called by CarMediaSessionPlugin (fed from JS) whenever the real
    // playback metadata/state changes.
    static void updateMetadata(String title, String artist, String album, long durationMs) {
        // Snapshotted into a local rather than checked-then-used directly --
        // onDestroy() (main thread) can null the field between the check and
        // the call on this thread (Capacitor's plugin thread); the field
        // itself can't change out from under a local copy, so this is the
        // only way to make the null-check actually mean something here.
        MediaSessionCompat s = session;
        if (s == null) return;
        s.setMetadata(new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs)
                .build());
    }

    static void updatePlaybackState(boolean playing, long positionMs) {
        MediaSessionCompat s = session; // see updateMetadata()'s own comment
        if (s == null) return;
        int state = playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED;
        s.setPlaybackState(new PlaybackStateCompat.Builder()
                .setActions(PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE
                        | PlaybackStateCompat.ACTION_PLAY_PAUSE | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                        | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS)
                .setState(state, positionMs, 1.0f)
                .build());
    }

    @Override
    public BrowserRoot onGetRoot(String clientPackageName, int clientUid, Bundle rootHints) {
        // Scoped to playback controls only (see the class comment above) —
        // every client is allowed to connect, there's just deliberately
        // nothing to browse.
        return new BrowserRoot(ROOT_ID, null);
    }

    @Override
    public void onLoadChildren(String parentId, Result<List<MediaItem>> result) {
        result.sendResult(new ArrayList<>());
    }

    @Override
    public void onDestroy() {
        if (session != null) {
            session.release();
            session = null;
        }
        super.onDestroy();
    }
}
