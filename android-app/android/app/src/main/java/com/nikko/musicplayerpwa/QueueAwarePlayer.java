package com.nikko.musicplayerpwa;

import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.Player;

// Wraps the real ExoPlayer for the ONE purpose of making next/previous
// (notification taps, hardware/Bluetooth media buttons) actually do
// something. The real queue lives in JS (js/player/player.js's queue/
// playOrder) — ExoPlayer itself only ever has ONE MediaItem loaded at a
// time (see NativePlayerPlugin.load()), so by default it has no next/
// previous item to advance to at all: Player.hasNextMediaItem()/
// hasPreviousMediaItem() are always false, seekToNext()/seekToPrevious()
// are correctly-but-uselessly no-ops, and (confirmed on-device) the
// notification's Next button does nothing when tapped despite having a
// real, working PendingIntent -- the command reaches the player just fine,
// the player just has nowhere to go.
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
        notifyRemote("next");
    }

    @Override
    public void seekToNextMediaItem() {
        notifyRemote("next");
    }

    @Override
    public void seekToPrevious() {
        notifyRemote("previous");
    }

    @Override
    public void seekToPreviousMediaItem() {
        notifyRemote("previous");
    }

    // Deliberately does NOT touch the underlying ExoPlayer at all -- the
    // actual track swap happens the same way auto-advance already does: JS
    // resolves the next/previous track's URL from its own queue and calls
    // NativePlayerPlugin.load() again.
    private void notifyRemote(String action) {
        NativePlayerPlugin plugin = NativePlayerPlugin.getInstance();
        if (plugin != null) plugin.notifyRemoteAction(action);
    }
}
