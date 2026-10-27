package com.nikko.musicplayerpwa;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

// The native-side queue: a flat, already-ordered sequence (JS flattens its
// own shuffle/repeat playOrder before handing it over -- this class never
// recomputes shuffle order itself) plus a position and repeat mode,
// persisted to SharedPreferences so a killed-and-recreated PlaybackService
// still knows what it was holding. See js/player/nativeQueueSync.js, which
// pushes every mutation here via NativePlayerPlugin.setQueue()/
// setRepeatMode(). Resuming audio after a full process death (re-resolving
// the current item's URL on PlaybackService.onCreate()) is explicitly out of
// scope for this pass -- see the architecture plan.
class NativeQueueManager {
    static class TrackDescriptor {
        final String id;
        final String name;
        final String artist;

        TrackDescriptor(String id, String name, String artist) {
            this.id = id;
            this.name = name;
            this.artist = artist;
        }
    }

    private static final String PREFS = "native_queue";
    private static final String KEY_TRACKS = "tracks";
    private static final String KEY_POSITION = "position";
    private static final String KEY_REPEAT = "repeatMode";

    private static NativeQueueManager instance;

    private final SharedPreferences prefs;
    private final List<TrackDescriptor> tracks = new ArrayList<>();
    private int position = -1;
    private String repeatMode = "off";

    static synchronized NativeQueueManager getInstance(Context context) {
        if (instance == null) instance = new NativeQueueManager(context.getApplicationContext());
        return instance;
    }

    private NativeQueueManager(Context context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        load();
    }

    private synchronized void load() {
        try {
            JSONArray arr = new JSONArray(prefs.getString(KEY_TRACKS, "[]"));
            tracks.clear();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject t = arr.getJSONObject(i);
                tracks.add(new TrackDescriptor(t.getString("id"), t.optString("name", ""), t.optString("artist", "")));
            }
            position = prefs.getInt(KEY_POSITION, -1);
            repeatMode = prefs.getString(KEY_REPEAT, "off");
        } catch (Exception e) {
            tracks.clear();
            position = -1;
            repeatMode = "off";
        }
    }

    private synchronized void persist() {
        JSONArray arr = new JSONArray();
        for (TrackDescriptor t : tracks) {
            JSONObject o = new JSONObject();
            try {
                o.put("id", t.id);
                o.put("name", t.name);
                o.put("artist", t.artist);
            } catch (Exception ignored) {
                // JSONException only ever comes from a null key here, which never happens.
            }
            arr.put(o);
        }
        prefs.edit()
                .putString(KEY_TRACKS, arr.toString())
                .putInt(KEY_POSITION, position)
                .putString(KEY_REPEAT, repeatMode)
                .apply();
    }

    synchronized void setQueue(List<TrackDescriptor> newTracks, int newPosition, String newRepeatMode) {
        tracks.clear();
        tracks.addAll(newTracks);
        position = newPosition;
        repeatMode = newRepeatMode != null ? newRepeatMode : "off";
        persist();
    }

    synchronized void setRepeatMode(String mode) {
        repeatMode = mode != null ? mode : "off";
        persist();
    }

    synchronized String getRepeatMode() {
        return repeatMode;
    }

    synchronized int getPosition() {
        return position;
    }

    synchronized TrackDescriptor getCurrentTrack() {
        return getTrackAt(position);
    }

    synchronized TrackDescriptor getTrackAt(int pos) {
        if (pos < 0 || pos >= tracks.size()) return null;
        return tracks.get(pos);
    }

    synchronized int size() {
        return tracks.size();
    }

    // Mirrors player.js's advanceOrderPos(): wraps only on repeat-all, returns
    // false if there's nowhere to go (e.g. end of queue with repeat off).
    synchronized boolean advance(int delta) {
        if (tracks.isEmpty()) return false;
        int pos = position + delta;
        if (pos < 0) {
            if ("all".equals(repeatMode)) pos = tracks.size() - 1;
            else return false;
        } else if (pos >= tracks.size()) {
            if ("all".equals(repeatMode)) pos = 0;
            else return false;
        }
        position = pos;
        persist();
        return true;
    }

    // Drops a confirmed-gone (404) track from the sequence so a stale queue
    // entry isn't retried forever -- see NativePlayerPlugin's resolve-and-load
    // loop. Leaves `position` pointing at whatever slides into this slot (the
    // next candidate in the same direction).
    synchronized void removeAt(int pos) {
        if (pos < 0 || pos >= tracks.size()) return;
        tracks.remove(pos);
        if (tracks.isEmpty()) {
            position = -1;
        } else if (position >= tracks.size()) {
            position = "all".equals(repeatMode) ? 0 : tracks.size() - 1;
        }
        persist();
    }
}
