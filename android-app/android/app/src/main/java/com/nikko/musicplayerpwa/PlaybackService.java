package com.nikko.musicplayerpwa;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;

import android.support.v4.media.session.PlaybackStateCompat;

import androidx.core.app.NotificationCompat;
import androidx.media.session.MediaButtonReceiver;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import androidx.media3.session.MediaStyleNotificationHelper;

// Native audio engine (feature/native-playback) — replaces the WebView
// <audio> element for actual decode/playback, so controlling an
// already-loaded track (play/pause/seek) no longer depends on Chromium's
// background-tab JS freeze exemption staying intact (see js/core/
// playbackIntent.js and js/player/player.js for the problem this solves).
public class PlaybackService extends MediaSessionService {
    private static final String CHANNEL_ID = "playback";
    private static final int NOTIFICATION_ID = 1;

    private static PlaybackService instance;

    private ExoPlayer player;
    private MediaSession mediaSession;
    private NotificationManager notificationManager;

    public static PlaybackService getInstance() {
        return instance;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        player = new ExoPlayer.Builder(this)
                // Explicit rather than relying on ExoPlayer's own defaults —
                // USAGE_MEDIA/CONTENT_TYPE_MUSIC (not the unknown/movie-ish
                // default) is what correctly identifies this to Android as
                // music specifically, and setAudioAttributes's second
                // argument turns on ExoPlayer's own automatic audio-focus
                // handling: duck/pause when another app (turn-by-turn
                // directions, a phone call, another media app) needs focus,
                // and resume when it's given back. Reported as "the app
                // always plays on top of other apps' audio" — which this
                // addresses directly, on top of also no longer running the
                // WebView keep-alive tone concurrently (see js/core/
                // playbackIntent.js), itself a second, independent audio
                // focus request fighting over the same thing.
                .setAudioAttributes(
                        new AudioAttributes.Builder()
                                .setUsage(C.USAGE_MEDIA)
                                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                                .build(),
                        /* handleAudioFocus= */ true
                )
                // Pauses automatically on ACTION_AUDIO_BECOMING_NOISY (e.g. a
                // Bluetooth disconnect) instead of suddenly blasting through
                // the phone's own speaker.
                .setHandleAudioBecomingNoisy(true)
                .build();
        // The session is given a QueueAwarePlayer wrapper, not the raw
        // ExoPlayer directly, so hardware/notification Next/Previous
        // actually reach JS's real queue instead of silently no-op'ing
        // against ExoPlayer's own always-single-item "playlist" — see
        // QueueAwarePlayer's own comment for why. getPlayer() below still
        // returns the raw, unwrapped player for everything else.
        mediaSession = new MediaSession.Builder(this, new QueueAwarePlayer(player)).build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            notificationManager = getSystemService(NotificationManager.class);
            if (notificationManager.getNotificationChannel(CHANNEL_ID) == null) {
                notificationManager.createNotificationChannel(new NotificationChannel(CHANNEL_ID, "Playback", NotificationManager.IMPORTANCE_LOW));
            }
        } else {
            notificationManager = getSystemService(NotificationManager.class);
        }

        // Context.startForegroundService() REQUIRES Service.startForeground()
        // within a few seconds, or the system kills the whole process with
        // ForegroundServiceDidNotStartInTimeException — confirmed on-device:
        // relying on Media3's own automatic notification/foreground handling
        // wasn't enough by itself here, so this builds and posts a real
        // notification (with working transport buttons — see buildNotification()
        // below) synchronously in onCreate(), immediately after the service
        // process starts, same as the old @jofr plugin's MediaSessionService.
        // connectAndInitialize() did.
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        player.addListener(new Player.Listener() {
            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                updateNotification();
            }

            @Override
            public void onMediaMetadataChanged(MediaMetadata mediaMetadata) {
                updateNotification();
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                updateNotification();
            }
        });
    }

    // Built by hand, not left to Media3's own automatic notification manager
    // — confirmed on-device via `dumpsys notification` that relying on the
    // default behavior here posted a notification with zero action buttons
    // (no play/pause/skip at all), presumably because calling
    // startForeground() with a manually-built notification in onCreate()
    // (required for the timing reason above) pre-empts Media3's own first
    // post. MediaStyleNotificationHelper.MediaStyle is Media3's own
    // notification-style helper for exactly this hand-built case; actions
    // still route through the same androidx.media MediaButtonReceiver the
    // old @jofr plugin used (see the receiver declaration in
    // AndroidManifest.xml), which the session is already configured to
    // expect (confirmed via dumpsys media_session showing that component as
    // the session's mediaButtonReceiver even before this was added).
    private Notification buildNotification() {
        MediaMetadata metadata = player.getMediaMetadata();
        String title = metadata.title != null ? metadata.title.toString() : "NubePlayer";
        String artist = metadata.artist != null ? metadata.artist.toString() : "";
        boolean isPlaying = player.isPlaying();

        Intent contentIntent = new Intent(this, MainActivity.class);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(artist)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentIntent(PendingIntent.getActivity(this, 0, contentIntent, PendingIntent.FLAG_IMMUTABLE))
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(isPlaying)
                .addAction(
                        android.R.drawable.ic_media_previous, "Previous",
                        MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS)
                )
                .addAction(
                        isPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                        isPlaying ? "Pause" : "Play",
                        MediaButtonReceiver.buildMediaButtonPendingIntent(
                                this,
                                isPlaying ? PlaybackStateCompat.ACTION_PAUSE : PlaybackStateCompat.ACTION_PLAY
                        )
                )
                .addAction(
                        android.R.drawable.ic_media_next, "Next",
                        MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_SKIP_TO_NEXT)
                )
                .setStyle(
                        new MediaStyleNotificationHelper.MediaStyle(mediaSession)
                                .setShowActionsInCompactView(0, 1, 2)
                );
        return builder.build();
    }

    private void updateNotification() {
        if (notificationManager != null) notificationManager.notify(NOTIFICATION_ID, buildNotification());
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
