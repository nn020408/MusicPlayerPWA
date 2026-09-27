// The welcome guide shown on first run (and again from Settings).

import { el } from "../core/dom.js";
import { openFolderPicker } from "./folderPicker.js";
import { pickBackupFile } from "./backup.js";

// Shown once automatically before the onboarding folder picker (see
// showApp()), and reachable again anytime via Settings > "Show welcome guide
// again" — introIsOnboarding tracks which of those two this run is, since
// only the automatic first-time one should hand off into the folder picker
// when it finishes; a revisit from Settings should just close.
export const INTRO_SEEN_KEY = "introSeenV1";

const INTRO_PANEL_COUNT = 4;

let introPanelIndex = 0;

let introIsOnboarding = false;

export function showIntro(isOnboarding) {
  introIsOnboarding = isOnboarding;
  introPanelIndex = 0;
  renderIntroPanel();
  el.introOverlay.classList.remove("hidden");
}

function renderIntroPanel() {
  document.querySelectorAll(".intro-panel").forEach((panel) => {
    panel.classList.toggle("hidden", Number(panel.dataset.panel) !== introPanelIndex);
  });
  document.querySelectorAll(".intro-dot").forEach((dot, i) => {
    dot.classList.toggle("active", i === introPanelIndex);
  });
  el.introBackBtn.classList.toggle("hidden", introPanelIndex === 0);
  // The last panel has its own two action buttons (restore/fresh-start)
  // instead of a generic "Next" — hide that here rather than showing a
  // dead-end "Next" that would just sit on the same panel forever.
  el.introNextBtn.classList.toggle("hidden", introPanelIndex === INTRO_PANEL_COUNT - 1);
}

// Android back while the welcome guide is open: step back a panel first. On the
// first panel: a revisit from Settings just closes; the mandatory first-run
// version has nowhere to go, so it consumes the press instead of letting it
// fall through to exiting the app mid-setup.
export function handleIntroBack() {
  if (introPanelIndex > 0) {
    introPanelIndex--;
    renderIntroPanel();
    return true;
  }
  if (!introIsOnboarding) el.introOverlay.classList.add("hidden");
  return true;
}

function finishIntro() {
  localStorage.setItem(INTRO_SEEN_KEY, "1");
  el.introOverlay.classList.add("hidden");
  if (introIsOnboarding) openFolderPicker("onboarding");
}

el.introNextBtn.addEventListener("click", () => {
  introPanelIndex = Math.min(introPanelIndex + 1, INTRO_PANEL_COUNT - 1);
  renderIntroPanel();
});

el.introBackBtn.addEventListener("click", () => {
  introPanelIndex = Math.max(introPanelIndex - 1, 0);
  renderIntroPanel();
});

el.introFinishBtn.addEventListener("click", finishIntro);

el.introRestoreBtn.addEventListener("click", () => {
  // A failed restore leaves the intro open on the same panel so you can
  // retry or fall back to "No, this is fresh" instead — only a genuine
  // success advances into the folder picker.
  pickBackupFile((succeeded) => {
    if (succeeded) finishIntro();
  });
});

el.showIntroBtn.addEventListener("click", () => {
  el.settingsOverlay.classList.add("hidden");
  showIntro(false);
});