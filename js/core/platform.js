// Which platform the app is running on: the Android app wrapper (Capacitor) or a
// plain browser.

export function isNative() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform());
}
