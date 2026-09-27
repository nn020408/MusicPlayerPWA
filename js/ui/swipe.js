// Swipe gestures on the mini player, the full player and the album art.

import { el } from "../core/dom.js";
import { playNext, playPrevious } from "../player/player.js";
import { closeFullPlayer, openFullPlayer } from "./playerUI.js";

// Taps are handled via a plain native "click" listener — that event is
// guaranteed by the browser to target the exact element the touch landed on
// (same as touchstart's target), so it can never "leak" to a different
// element underneath. Touch events here are used ONLY to detect an actual
// swipe (real finger movement past a threshold); once a swipe is confirmed
// we preventDefault so the browser doesn't also fire a trailing click.
function attachSwipe(element, handlers) {
  let startX = 0,
    startY = 0,
    tracking = false,
    swiped = false,
    ignore = false;

  element.addEventListener(
    "touchstart",
    (e) => {
      // .lyrics-panel is excluded too — it's the one scrollable area inside
      // the full player, and swipe-down-to-dismiss would otherwise hijack
      // any vertical drag past 15px (see touchmove below) before native
      // scrolling ever gets a chance to run.
      ignore = !!e.target.closest("button, input, .row-menu-btn, .lyrics-panel");
      if (ignore) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
      swiped = false;
    },
    { passive: true }
  );

  element.addEventListener(
    "touchmove",
    (e) => {
      if (ignore || !tracking) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (!swiped && (Math.abs(dx) > 15 || Math.abs(dy) > 15)) {
        swiped = true;
      }
      if (swiped) e.preventDefault();
    },
    { passive: false }
  );

  element.addEventListener("touchend", (e) => {
    if (ignore || !tracking) return;
    tracking = false;
    if (!swiped) return; // plain tap — let the native click event handle it

    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (absDy > 60 && absDy > absDx * 1.2 && dy > 0) {
      handlers.onSwipeDown && handlers.onSwipeDown();
      return;
    }
    if (absDx > 60 && absDx > absDy * 1.2) {
      if (dx < 0) handlers.onSwipeLeft && handlers.onSwipeLeft();
      else handlers.onSwipeRight && handlers.onSwipeRight();
    }
  });

  if (handlers.onTap) {
    element.addEventListener("click", (e) => {
      if (e.target.closest("button, input, .row-menu-btn")) return;
      handlers.onTap();
    });
  }
}

attachSwipe(el.nowPlayingBar, {
  onTap: openFullPlayer,
  onSwipeLeft: playNext,
  onSwipeRight: playPrevious,
});

attachSwipe(el.fullPlayer, {
  onSwipeDown: closeFullPlayer,
});

// Swiping the album art itself (not the whole screen) skips tracks — same
// left/right convention as the mini-player bar above. Layering this on top
// of the full-player's own swipe-down listener is safe: each attachSwipe
// call tracks its own touch sequence independently, and a horizontal drag
// never satisfies that listener's vertical-dominant condition, so there's no
// double-handling of the same gesture.
attachSwipe(el.fullPlayerArt, {
  onSwipeLeft: playNext,
  onSwipeRight: playPrevious,
});