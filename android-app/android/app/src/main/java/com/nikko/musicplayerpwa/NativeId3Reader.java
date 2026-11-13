package com.nikko.musicplayerpwa;

import android.media.MediaMetadataRetriever;
import android.util.Log;

import java.util.HashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

// Reads the real embedded title/artist/album straight from the audio file's
// own tags (ID3/MP4/FLAC -- whatever Android's own media framework already
// understands via MediaMetadataRetriever), entirely in native code. This is
// what lets native auto-advance/Next/Previous show the real tag instead of
// OneDrive's lighter folder-listing guess (see NativeQueueManager.
// TrackDescriptor) even while the WebView is fully frozen -- the one gap
// player.js's own readId3Tags()-based correction can't reach on its own,
// since that only ever runs once the WebView wakes back up.
//
// Best-effort only, by design: a failure or slow network here just means
// NativePlayerPlugin's already-correct fallback (the lightweight guess) keeps
// showing instead of whatever this would have upgraded it to -- never blocks
// or delays actual playback starting, which has already begun by the time
// this is even called.
class NativeId3Reader {
    private static final String TAG = "NativeId3Reader";
    // Two threads, not one -- a single stuck MediaMetadataRetriever call (no
    // network-level timeout of its own) would otherwise wedge every later
    // read behind it indefinitely instead of just degrading gracefully.
    private static final ExecutorService executor = Executors.newFixedThreadPool(2);

    static class Tags {
        final String title;
        final String artist;
        final String album;

        Tags(String title, String artist, String album) {
            this.title = title;
            this.artist = artist;
            this.album = album;
        }
    }

    interface Callback {
        void onTags(Tags tags); // null if unavailable -- caller's own fallback applies
    }

    // Fires `callback` on this reader's own background thread, never the
    // caller's -- callers that touch ExoPlayer must hop back to main
    // themselves (same convention as the rest of this native layer).
    static void readTagsAsync(String url, Callback callback) {
        executor.execute(() -> callback.onTags(readTagsBlocking(url)));
    }

    private static Tags readTagsBlocking(String url) {
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(url, new HashMap<>());
            String title = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE);
            String artist = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST);
            String album = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM);
            if (title == null && artist == null && album == null) return null;
            return new Tags(title, artist, album);
        } catch (Exception e) {
            Log.w(TAG, "Couldn't read embedded tags for " + url, e);
            return null;
        } finally {
            try {
                retriever.release();
            } catch (Exception ignored) {
                // Nothing meaningful to do about a failed release.
            }
        }
    }
}
