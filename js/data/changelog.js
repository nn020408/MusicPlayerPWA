// What's shown in Settings > Help > What's new (see ui/changelogView.js).
// User-facing language, not commit messages -- what changed for someone
// listening to music, not how. Newest first. Hand-maintained; add an entry
// here (and bump APP_VERSION in core/config.js) on any release worth telling
// the user about, skip ones that are purely internal.
export const CHANGELOG = [
  {
    version: "v182",
    items: [
      "The app now shows its version briefly when it opens, so you can tell at a glance which build you're on.",
      "Lyrics now have a button to turn off auto-scroll, so you can read at your own pace without the screen jumping.",
      "Added this \"What's new\" screen, under Settings > Help.",
      "Fixed resumed songs briefly jumping back to the start before continuing where you left off.",
    ],
  },
  {
    version: "v181",
    items: ["Fixed the song title/artist sometimes showing the wrong info after the app sat in the background for a while — this was also showing up on the car's Bluetooth display."],
  },
  {
    version: "v180",
    items: ["Deleting a song now removes it from every list showing it, not just the one you deleted it from."],
  },
  {
    version: "v179",
    items: ["Deleting the song that's currently playing now skips to the next song, or stops cleanly if it was the only one queued."],
  },
  {
    version: "v178",
    items: ["Deleting a song now asks you to type a random confirmation code first, so an accidental tap (a phone in your pocket) can't delete anything."],
  },
  {
    version: "v171–v177",
    items: ["Fixed sign-in getting stuck in a failure loop, especially after skipping songs quickly — this was also the cause of repeated \"Connection trouble\" messages."],
  },
  {
    version: "v169",
    items: ["Fixed Next/Previous sometimes feeling slow or doing nothing.", "Fixed songs showing \"OneDrive\" instead of the real artist name."],
  },
  {
    version: "Earlier",
    items: ["Rebuilt playback to run fully natively, so Play/Pause/Next/Previous and auto-advance all keep working reliably with the screen off or the app in the background."],
  },
];
