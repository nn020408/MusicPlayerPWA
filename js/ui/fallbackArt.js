// Generated colorful placeholder art for songs with no cover art.

import { el } from "../core/dom.js";

// Same track name always hashes to the same gradient, so an untagged song
// looks consistent every time instead of showing an identical gray icon.
const NOTE_SVG = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="6.5" cy="18.5" r="2.5" fill="white"/>
  <circle cx="16.5" cy="16.5" r="2.5" fill="white"/>
  <path d="M9 18.5V4.5L19 2.5V16.5" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function gradientForName(name) {
  const h = hashString((name || "untitled").toLowerCase().trim());
  const hue1 = h % 360;
  const hue2 = (hue1 + 26 + (h % 44)) % 360;
  return `linear-gradient(135deg, hsl(${hue1} 58% 40%), hsl(${hue2} 62% 22%))`;
}

export function paintFallbackArt(track) {
  const gradient = gradientForName(track.name);
  el.miniArtFallback.style.background = gradient;
  el.miniArtFallback.innerHTML = NOTE_SVG;
  el.fullArtFallback.style.background = gradient;
  el.fullArtFallback.innerHTML = NOTE_SVG;
}