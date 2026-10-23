package com.nikko.musicplayerpwa;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

// Native audio engine (feature/native-playback) — replaces the WebView
// <audio> element for actual decode/playback, so controlling an
// already-loaded track (play/pause/seek) no longer depends on Chromium's
// background-tab JS freeze exemption staying intact (see js/core/
// playbackIntent.js and js/player/player.js for the problem this solves).
//
// Skeleton stage: one ExoPlayer + one MediaSession, exposed to
// NativePlayerPlugin via a static instance rather than bind/binder — simplest
// thing that lets the very first on-device smoke test (load one hardcoded
// URL, play/pause it via a real remote key while backgrounded+locked) run
// before any queue/retry/persistence logic is ported over.
public class PlaybackService extends MediaSessionService {
    private static final String CHANNEL_ID = "playback";
    private static final int NOTIFICATION_ID = 1;

    private static PlaybackService instance;

    private ExoPlayer player;
    private MediaSession mediaSession;

    public static PlaybackService getInstance() {
        return instance;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        player = new ExoPlayer.Builder(this).build();
        mediaSession = new MediaSession.Builder(this, player).build();

        // Context.startForegroundService() REQUIRES Service.startForeground()
        // within a few seconds, or the system kills the whole process with
        // ForegroundServiceDidNotStartInTimeException — confirmed on-device:
        // relying on Media3's own automatic notification/foreground handling
        // (triggered off player state) wasn't enough by itself here, so this
        // calls startForeground() synchronously in onCreate(), immediately
        // after the service process starts, same as the old @jofr plugin's
        // MediaSessionService.connectAndInitialize() did. Media3's own
        // MediaNotificationManager can still take over updating this
        // notification's content as playback state/metadata change.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                nm.createNotificationChannel(new NotificationChannel(CHANNEL_ID, "Playback", NotificationManager.IMPORTANCE_LOW));
            }
        }
        Intent contentIntent = new Intent(this, MainActivity.class);
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("NubePlayer")
                .setContentText("Loading…")
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentIntent(PendingIntent.getActivity(this, 0, contentIntent, PendingIntent.FLAG_IMMUTABLE))
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return mediaSession;
    }

    public ExoPlayer getPlayer() {
        return player;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Mirrors Media3's own recommended default (stop when the player
        // isn't actively playing and the user swipes the app away from
        // Recents) — revisit once the full queue/retry logic is ported, since
        // "swiped away" vs. "merely backgrounded" needs to keep meaning what
        // it already means for the WebView path (see pauseWithGrace() in
        // js/core/playbackIntent.js — a real design decision, not a default
        // to inherit by accident).
        Player p = getPlayer();
        if (p == null || !p.getPlayWhenReady() || p.getMediaItemCount() == 0) {
            stopSelf();
        }
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        if (mediaSession != null) {
            mediaSession.release();
            mediaSession = null;
        }
        if (player != null) {
            player.release();
            player = null;
        }
        instance = null;
        super.onDestroy();
    }
}
