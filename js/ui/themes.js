// Color themes.

import { el } from "../core/dom.js";

// Every color in css/style.css is a custom property under :root/:root[data-
// theme=...] (see the block at the top of that file) — switching themes is
// just swapping which block is active, one attribute write. That's a single
// repaint of already-visible pixels, not a layout pass, so it costs nothing
// worth measuring (nothing here runs per-frame or continuously either way).
const THEME_KEY = "colorTheme";

const THEMES = [
  { id: "midnight", name: "Midnight", bg: "#121212", accent: "#1db954" },
  { id: "ocean", name: "Deep Ocean", bg: "#0f1720", accent: "#3ea6ff" },
  { id: "ember", name: "Sunset Ember", bg: "#1c1210", accent: "#ff8a5c" },
  { id: "violet", name: "Violet Nights", bg: "#160f1e", accent: "#b280ff" },
  { id: "daylight", name: "Daylight", bg: "#f6f7f8", accent: "#0f6b35" },
];

function getSavedTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return THEMES.some((t) => t.id === saved) ? saved : "midnight";
  } catch {
    return "midnight";
  }
}

function applyTheme(id) {
  const theme = THEMES.find((t) => t.id === id) || THEMES[0];
  document.documentElement.setAttribute("data-theme", theme.id);
  try {
    localStorage.setItem(THEME_KEY, theme.id);
  } catch {}
  // Matches the browser chrome / status bar to the theme too.
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) metaThemeColor.setAttribute("content", theme.bg);
}

export function renderThemeList() {
  const current = getSavedTheme();
  el.themeList.innerHTML = "";
  THEMES.forEach((theme) => {
    const isActive = theme.id === current;
    const row = document.createElement("div");
    row.className = "row theme-row" + (isActive ? " theme-row-active" : "");
    row.innerHTML = `
      <span class="theme-swatch" style="background:${theme.bg}"><span class="theme-swatch-accent" style="background:${theme.accent}"></span></span>
      <div class="row-text"><div class="row-name">${theme.name}</div></div>
      ${isActive ? '<span class="theme-check">✓</span>' : ""}
    `;
    row.addEventListener("click", () => {
      if (isActive) return;
      applyTheme(theme.id);
      renderThemeList();
    });
    el.themeList.appendChild(row);
  });
}

// The inline script in index.html's <head> already set data-theme before
// first paint (avoiding a flash of the wrong theme) — this just catches the
// status-bar meta tag up to match, which that early script deliberately
// skips (it doesn't need the THEMES list, so it does the least work possible
// pre-paint).
applyTheme(getSavedTheme());