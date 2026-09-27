// Toast messages: the small notices at the bottom of the screen.

import { el } from "../core/dom.js";

let toastHideTimer = null;

let toastRemoveTimer = null;

// duration: null means persistent — stays up until hideToast() is called or
// another showToast() replaces it. Used for "still retrying…" messages,
// which must not vanish on their own timer partway through a multi-minute
// reconnect attempt — that reads as "gave up" even when it's still working.
export function showToast(message, duration = 2500) {
  clearTimeout(toastHideTimer);
  clearTimeout(toastRemoveTimer);
  el.toast.textContent = message;
  el.toast.classList.remove("hidden");
  requestAnimationFrame(() => el.toast.classList.add("show"));
  if (duration != null) {
    toastHideTimer = setTimeout(() => {
      el.toast.classList.remove("show");
      toastRemoveTimer = setTimeout(() => el.toast.classList.add("hidden"), 200);
    }, duration);
  }
}

export function hideToast() {
  clearTimeout(toastHideTimer);
  clearTimeout(toastRemoveTimer);
  el.toast.classList.remove("show");
  toastRemoveTimer = setTimeout(() => el.toast.classList.add("hidden"), 200);
}