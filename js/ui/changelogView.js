// Settings > Help > What's new.

import { CHANGELOG } from "../data/changelog.js";
import { el } from "../core/dom.js";

function renderChangelog() {
  el.changelogList.innerHTML = CHANGELOG.map(
    (entry) => `
      <div class="changelog-entry">
        <h3 class="changelog-version">${entry.version}</h3>
        <ul>${entry.items.map((item) => `<li>${item}</li>`).join("")}</ul>
      </div>
    `
  ).join("");
}

el.changelogBtn.addEventListener("click", () => {
  renderChangelog();
  el.changelogOverlay.classList.remove("hidden");
});

el.changelogBackBtn.addEventListener("click", () => el.changelogOverlay.classList.add("hidden"));
