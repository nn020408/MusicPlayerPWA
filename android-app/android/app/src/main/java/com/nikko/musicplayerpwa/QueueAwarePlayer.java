package com.nikko.musicplayerpwa;

import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.Player;

// Wraps the real ExoPlayer for the ONE purpose of making next/previous
// (notification taps, hardware/Bluetooth media buttons) actually do
// something. ExoPlayer itself only ever has ONE MediaItem loaded at a time
// (see NativePlayerPlugin.load()), so by default Player.hasNextMediaItem()/
// hasPreviousMediaItem() are always false and seekToNext()/seekToPrevious()
// are correctly-but-uselessly no-ops.
//
// Delegates to NativePlayerPlugin.requestNext()/requestPrevious() -- the
// SAME methods the in-app Next/Previous buttons reach via the next()/
// previous() plugin calls (see js/player/player.js's playNext()/
// playPrevious()) -- so there is exactly one implementation of "what does
// Next/Previous mean" (repeat-all wraparound, restart-if-more-than-3s-in),
// not two that could silently drift apart. Earlier versions of this class
// forwarded the raw action to JS instead (notifyRemoteAction) -- replaced
// because that still depended on the WebView being unfrozen to do anything;
// see the architecture plan (native queue + Graph migration) for why.
//
// This wrapper is used ONLY to build the MediaSession (see PlaybackService.
// onCreate()) -- NativePlayerPlugin's own load()/play()/pause()/seekTo()/
// getState() keep talking to the real, unwrapped ExoPlayer directly.
class QueueAwarePlayer extends ForwardingPlayer {
    QueueAwarePlayer(Player player) {
        super(player);
    }

    @Override
    public boolean hasNextMediaItem() {
        return true;
    }

    @Override
    public boolean hasPreviousMediaItem() {
        return true;
    }

    @Override
    public Commands getAvailableCommands() {
        return super.getAvailableCommands().buildUpon()
                .add(Player.COMMAND_SEEK_TO_NEXT)
                .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
                .add(Player.COMMAND_SEEK_TO_PREVIOUS)
                .add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                .build();
    }

    @Override
    public void seekToNext() {
        requestNext();
    }

    @Override
    public void seekToNextMediaItem() {
        requestNext();
    }

    @Override
    public void seekToPrevious() {
        requestPrevious();
    }

    @Override
    public void seekToPreviousMediaItem() {
        requestPrevious();
    }

    private void requestNext() {
        NativePlayerPlugin plugin = NativePlayerPlugin.getInstance();
        if (plugin != null) plugin.requestNext();
    }

    private void requestPrevious() {
        NativePlayerPlugin plugin = NativePlayerPlugin.getInstance();
        if (plugin != null) plugin.requestPrevious();
    }
}
