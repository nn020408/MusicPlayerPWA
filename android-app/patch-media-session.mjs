// Patches a bug in the vendored @jofr/capacitor-media-session plugin's Android
// source: its notification's Play/Pause button has no action at all.
//
// MediaButtonReceiver.buildMediaButtonPendingIntent(Context, long action) only
// recognizes a single PlaybackStateCompat.ACTION_* value (it maps it to one
// KeyEvent keycode) — the plugin passes two actions OR'd together
// (ACTION_PLAY_PAUSE | ACTION_PLAY, and the equivalent for pause), which
// doesn't match any single known action, so it silently returns null and the
// button has nothing to do when tapped. Confirmed via `adb shell dumpsys
// notification`: every other button (Previous/Next) had a real PendingIntent,
// only Play/Pause didn't.
//
// node_modules is reinstalled from scratch on a fresh `npm install`, wiping
// this edit, so this script re-applies it — run automatically as part of
// `npm run sync`, so every build stays patched with no manual step.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const file = join(
  here,
  "node_modules",
  "@jofr",
  "capacitor-media-session",
  "android",
  "src",
  "main",
  "java",
  "io",
  "github",
  "jofr",
  "capacitor",
  "mediasessionplugin",
  "MediaSessionService.java"
);

const BROKEN = [
  'MediaButtonReceiver.buildMediaButtonPendingIntent(this, (PlaybackStateCompat.ACTION_PLAY_PAUSE | PlaybackStateCompat.ACTION_PLAY))',
  'MediaButtonReceiver.buildMediaButtonPendingIntent(this, (PlaybackStateCompat.ACTION_PLAY_PAUSE | PlaybackStateCompat.ACTION_PAUSE))',
];
const FIXED = [
  'MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_PLAY)',
  'MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_PAUSE)',
];

let src;
try {
  src = readFileSync(file, "utf8");
} catch (err) {
  console.log(`patch-media-session: ${file} not found (dependency missing or renamed?) — skipping`);
  process.exit(0);
}

if (!src.includes(BROKEN[0]) && !src.includes(BROKEN[1])) {
  const alreadyFixed = src.includes(FIXED[0]) && src.includes(FIXED[1]);
  console.log(alreadyFixed ? "patch-media-session: already patched" : "patch-media-session: expected text not found (plugin version changed?) — leaving it alone");
  process.exit(0);
}

for (let i = 0; i < BROKEN.length; i++) src = src.split(BROKEN[i]).join(FIXED[i]);
writeFileSync(file, src);
console.log("patch-media-session: fixed the notification's Play/Pause button (was missing its action)");
