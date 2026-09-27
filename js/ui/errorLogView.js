// Settings > View error log.

import { clearErrorLog, loadErrorLog } from "../core/errorlog.js";
import { escapeHtml } from "../core/text.js";
import { el } from "../core/dom.js";
import { showToast } from "./toast.js";

function renderErrorLog() {
  const log = loadErrorLog();
  el.errorLogList.innerHTML = "";
  if (log.length === 0) {
    el.errorLogList.innerHTML = `<p class="status-msg">No errors logged.</p>`;
    return;
  }
  log.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "error-log-row";
    const time = new Date(entry.time).toLocaleString();
    row.innerHTML = `
      <div class="error-log-time">${escapeHtml(time)}</div>
      <div class="error-log-message">${escapeHtml(entry.message)}</div>
    `;
    el.errorLogList.appendChild(row);
  });
}

el.errorLogBtn.addEventListener("click", () => {
  renderErrorLog();
  el.errorLogOverlay.classList.remove("hidden");
});

el.errorLogBackBtn.addEventListener("click", () => el.errorLogOverlay.classList.add("hidden"));

el.errorLogClearBtn.addEventListener("click", () => {
  clearErrorLog();
  renderErrorLog();
});

el.errorLogCopyBtn.addEventListener("click", async () => {
  const log = loadErrorLog();
  const text = log.map((entry) => `[${new Date(entry.time).toLocaleString()}] ${entry.message}`).join("\n\n");
  try {
    await navigator.clipboard.writeText(text || "No errors logged.");
    showToast("Error log copied");
  } catch {
    showToast("Couldn't copy — clipboard unavailable");
  }
});