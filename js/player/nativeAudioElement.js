// A drop-in stand-in for a real HTMLMediaElement, backing player.js's
// `audioEl` on native Android once the real engine (ExoPlayer, via
// NativePlayerPlugin/PlaybackService — see android-app/android/.../
// NativePlayerPlugin.java) owns actual playback instead of a WebView
// <audio> element. That split exists because Chromium freezes a backgrounded
// WebView's JS entirely unless it's judged to be "audibly playing"
// something — a real native foreground service never has that problem, so
// controlling an already-loaded track (play/pause/seek) stops depending on
// the WebView staying unfrozen at all. See js/core/playbackIntent.js for the
// problem this was previously worked around with on the web/old-native path.
//
// Implements only the surface player.js (plus js/ui/playerUI.js, js/ui/
// lyrics.js, js/main.js) actually use against `audioEl` — confirmed by grep:
// src=, currentTime get/set, duration get, paused get, error get,
// playbackRate get, play(), pause(), load(), removeAttribute(), and
// addEventListener for "error"/"play"/"pause"/"seeked"/"ended"/"timeupdate".
// Extending EventTarget gets addEventListener/dispatchEvent for free, so
// none of player.js's existing event-wiring code needs to change at all —
// only the one line that constructs `audioEl` picks this class instead of
// `new Audio()`.
export class NativeAudioElement extends EventTarget {
  constructor(plugin) {
    super();
    this._plugin = plugin;
    this._src = "";
    this._pendingLoad = null;
    this._currentTime = 0;
    this._duration = NaN;
    this._paused = true;
    this._error = null;
    this.preload = "auto"; // unused, kept only for API parity with <audio>
    this.playbackRate = 1;

    plugin.addListener("playbackState", ({ playing, positionMs, durationMs }) => {
      const wasPaused = this._paused;
      this._paused = !playing;
      if (positionMs != null) this._currentTime = positionMs / 1000;
      if (durationMs != null && isFinite(durationMs) && durationMs > 0) this._duration = durationMs / 1000;
      if (wasPaused !== this._paused) this.dispatchEvent(new Event(this._paused ? "pause" : "play"));
    });
    plugin.addListener("positionUpdate", ({ positionMs, durationMs }) => {
      if (positionMs != null) this._currentTime = positionMs / 1000;
      if (durationMs != null && isFinite(durationMs) && durationMs > 0) this._duration = durationMs / 1000;
      this.dispatchEvent(new Event("timeupdate"));
    });
    plugin.addListener("trackEnded", () => {
      this._paused = true;
      this.dispatchEvent(new Event("ended"));
    });
    plugin.addListener("error", ({ message }) => {
      // Treated as MEDIA_ERR_NETWORK-shaped (code 2) — player.js's "error"
      // handler retries network-shaped failures (codes 2 and 4) and this is
      // overwhelmingly what a native playback failure actually is (a bad/
      // expired download URL, a dropped connection); there's no equivalent
      // native distinction worth preserving here.
      this._error = { code: 2, message };
      this.dispatchEvent(new Event("error"));
    });
  }

  get currentTime() {
    return this._currentTime;
  }
  set currentTime(seconds) {
    this._currentTime = seconds;
    // A pending (not yet loaded) src means there's nothing in native to seek
    // on yet — seeking now would hit whatever track is still loaded from
    // BEFORE this .src assignment. play() below reads _currentTime back out
    // and passes it as resumePositionMs instead, so a "src = url; currentTime
    // = resumeAt; play()" sequence (used for both a fresh track's restored
    // position and the error-retry reconnect) resumes at the right spot
    // rather than always restarting at 0. Confirmed on-device: without this
    // guard, reconnecting after a dropped connection silently restarted the
    // track from the beginning instead of resuming.
    if (this._pendingLoad) return;
    this._plugin.seekTo({ positionMs: Math.round(seconds * 1000) });
    // A real <audio> element fires "seeked" asynchronously once the seek
    // actually completes; approximate that here so updatePositionState()
    // (wired to the "seeked" event in player.js) still runs after a seek.
    Promise.resolve().then(() => this.dispatchEvent(new Event("seeked")));
  }

  get duration() {
    return this._duration;
  }

  get paused() {
    return this._paused;
  }

  get error() {
    return this._error;
  }

  get src() {
    return this._src;
  }
  set src(url) {
    this._src = url;
    this._pendingLoad = url;
    this._error = null;
    // A real <audio> element resets position/duration as part of its load
    // algorithm the instant .src is reassigned, not whenever play() later
    // gets around to it — matched here so nothing reads a stale previous
    // track's position/duration in the brief window before play() runs.
    this._currentTime = 0;
    this._duration = NaN;
  }

  play() {
    const url = this._pendingLoad;
    this._pendingLoad = null;
    // Real title/artist/album aren't known yet at this point in player.js's
    // call order (updateMediaSessionMetadata() only runs after play()
    // resolves) — setNowPlayingMetadata() below corrects this moments later,
    // via the plugin's setMetadata(), without needing to restart playback.
    // resumePositionMs carries over whatever currentTime was set to since
    // .src was assigned (see the currentTime setter above) — 0 for a fresh
    // track, or a real resume position for a restored/reconnecting one.
    const request = url
      ? this._plugin.load({ url, title: "", artist: "", album: "", resumePositionMs: Math.round(this._currentTime * 1000) })
      : this._plugin.play();
    return request.then(() => {
      this._paused = false;
      this._error = null;
    });
  }

  pause() {
    this._plugin.pause();
    this._paused = true;
  }

  // Not part of the <audio> element surface — player.js's resetPlayer()
  // (sign-out) calls this (`audioEl.stop && audioEl.stop()`) so the native
  // engine actually lets go of whatever's loaded, instead of leaving the
  // previous (possibly now signed-out) account's track sitting paused in
  // the foreground notification/lock-screen session indefinitely -- pause()/
  // removeAttribute("src")/load() only ever touched local JS state, never
  // told native to release anything.
  stop() {
    this._plugin.stop();
    this._paused = true;
    this._src = "";
    this._pendingLoad = null;
    this._currentTime = 0;
    this._duration = NaN;
  }

  load() {
    this._pendingLoad = null;
  }

  removeAttribute(name) {
    if (name === "src") {
      this._src = "";
      this._pendingLoad = null;
    }
  }

  // Not part of the <audio> element surface — an additive hook player.js
  // checks for (`audioEl.setNowPlayingMetadata && ...`) so the native engine
  // gets real title/artist/album without threading them through every call
  // site that touches .src. Always called after play() has already resolved
  // (see updateMediaSessionMetadata() in player.js), so this always updates
  // the already-loaded item in place via the plugin's setMetadata() —
  // ExoPlayer's replaceMediaItem() under the hood, which doesn't restart
  // playback or lose position.
  setNowPlayingMetadata({ title, artist, album }) {
    this._plugin.setMetadata({ title, artist, album });
  }
}
