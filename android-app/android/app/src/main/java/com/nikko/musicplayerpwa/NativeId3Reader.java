package com.nikko.musicplayerpwa;

import android.media.MediaMetadataRetriever;
import android.util.Log;

import java.util.HashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

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
    // How long readTagsAsync() waits for a single read before giving up on it
    // -- see its own comment for why this can't actually stop the underlying
    // MediaMetadataRetriever call.
    private static final long READ_TIMEOUT_MS = 8000;
    // Cached, not fixed -- confirmed as a real bug with a fixed 2-thread pool:
    // MediaMetadataRetriever.setDataSource() has no network-level timeout of
    // its own, so on a flaky connection two slow/hung reads could permanently
    // occupy both pool threads, silently and permanently wedging every LATER
    // read behind them for the rest of the app process's life (the car/phone
    // would just keep showing the lightweight guess forever, with no error
    // anywhere). A cached pool means a later read always gets its own fresh
    // thread no matter how many earlier ones are still stuck.
    private static final ExecutorService executor = Executors.newCachedThreadPool();

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
    // themselves (same convention as the rest of this native layer). Always
    // fires within READ_TIMEOUT_MS, even if the underlying read never
    // actually returns -- that read keeps running on its own thread
    // regardless (there's no safe way to force-stop it), but this caller
    // stops waiting on it and gets a null (best-effort, same as any other
    // failure) instead of hanging indefinitely.
    static void readTagsAsync(String url, Callback callback) {
        executor.execute(() -> {
            Future<Tags> future = executor.submit(() -> readTagsBlocking(url));
            Tags tags;
            try {
                tags = future.get(READ_TIMEOUT_MS, TimeUnit.MILLISECONDS);
            } catch (TimeoutException e) {
                tags = null;
            } catch (Exception e) {
                tags = null;
            }
            callback.onTags(tags);
        });
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
