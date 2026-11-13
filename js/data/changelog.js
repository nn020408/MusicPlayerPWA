// What's shown in Settings > Help > What's new (see ui/changelogView.js).
// User-facing language, not commit messages -- what changed for someone
// listening to music, not how. Newest first. Hand-maintained; add an entry
// here (and bump APP_VERSION in core/config.js) on any release worth telling
// the user about, skip ones that are purely internal.
export const CHANGELOG = [
  {
    version: "v188",
    items: [
      "Fixed the title and artist sometimes showing a different song than what was actually playing, on both the phone and the car's Bluetooth display.",
      "The car's Bluetooth display now matches the phone's artist name instead of sometimes falling back to \"Unknown Artist\".",
      "Fixed deleting the currently playing song doing nothing when repeat-one was on, instead of moving to the next song.",
      "A deliberate pause now stays paused through a brief Bluetooth disconnect/reconnect, instead of resuming on its own.",
      "Improved reliability of reading a song's real title/artist over a weak connection.",
    ],
  },
  {
    version: "v187",
    items: [
      "Fixed the Now Playing artist sometimes staying blank instead of showing \"Unknown Artist\" while the real tag was still loading.",
    ],
  },
  {
    version: "v186",
    items: [
      "The real artist and title now get read directly on the phone, so songs reached while your screen is off show the right info immediately instead of a placeholder.",
    ],
  },
  {
    version: "v185",
    items: [
      "Fixed the car's Bluetooth display sometimes freezing on an old artist name while the song title kept changing correctly.",
      "Reduced the white flash some phones showed when reopening the app from the background.",
    ],
  },
  {
    version: "v184",
    items: [
      "Song title/artist corrections now stick for the rest of a song's time in the queue, instead of reverting to a guess every time it comes up again with the screen off.",
      "Playback now tries to resume on its own after a brief Bluetooth drop, instead of staying paused until you unlock your phone.",
    ],
  },
  {
    version: "v183",
    items: [
      "Fixed the lyrics auto-scroll button not visibly changing color when toggled.",
      "Android Auto now shows Next/Previous buttons instead of 10-second skip buttons.",
    ],
  },
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
