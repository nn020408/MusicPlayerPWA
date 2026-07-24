// Shown in Settings and on the login screen so a deploy/build can be visually
// confirmed instead of guessed at. Kept in sync with sw.js's CACHE_NAME by
// hand (bump both together) — a plain constant instead of asking the service
// worker, since the Android app has no service worker at all.
const APP_VERSION = "v86";

// Azure app registration settings — from portal.azure.com > App registrations > MusicPlayer
const APP_CONFIG = {
  clientId: "d5dfb518-91f5-4082-ad30-b2df5adc1ae5",
  // Personal Microsoft accounts only (Supported account types = "All Microsoft account users")
  authority: "https://login.microsoftonline.com/consumers",
  scopes: ["Files.Read", "offline_access", "User.Read"],
};
