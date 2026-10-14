// Mirrors playback metadata/state into CarMediaBrowserService's native
// Android Auto session (android-app/.../CarMediaBrowserService.java). That
// service owns its own separate MediaSessionCompat rather than sharing
// @jofr/capacitor-media-session's one (see the comment at the top of that
// Java file for why) — this is the one-way bridge that keeps its "now
// playing" screen in sync with what the phone's own notification shows.
// Android Auto's transport buttons (play/pause/skip) need no JS involvement
// at all: the native side re-dispatches them as ordinary media-button
// presses, which already reach the existing session exactly like a
// Bluetooth/lock-screen button would.

function carMediaSession() {
  return window.Capacitor && window.Capacitor.isNativePlatform() && window.Capacitor.Plugins.CarMediaSession;
}

export function updateCarMetadata(title, artist, album, durationMs) {
  const car = carMediaSession();
  if (car) car.setMetadata({ title, artist, album, durationMs });
}

export function updateCarPlaybackState(playing, positionMs) {
  const car = carMediaSession();
  if (car) car.setPlaybackState({ playing, positionMs });
}
