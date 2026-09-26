// UI smoke test that runs INSIDE the app (WebView or browser). Non-destructive:
// it opens and closes screens, searches, and browses a folder, then checks that
// nothing was written to the app's error log. Driven by tests/phone-smoke.js,
// which evaluates this file over the Chrome DevTools Protocol.
//
// Evaluates to a JSON string: { passed, failed, results: [[name, ok, detail]] }.
(async () => {
  const results = [];
  const check = (name, ok, detail = "") => results.push([name, !!ok, String(detail)]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (sel) => document.querySelector(sel);
  const visible = (sel) => { const e = $(sel); return !!e && !e.classList.contains("hidden"); };
  const click = (sel) => { const e = $(sel); if (!e) throw new Error("missing " + sel); e.click(); };
  const waitFor = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(50); } return false; };
  const startedAt = new Date().toISOString(); // error log is capped, so compare by time, not length

  try {
    check("boot: app screen is showing", visible("#app-screen") && !visible("#login-screen"));
    check("boot: version is set", typeof APP_VERSION === "string" && APP_VERSION.startsWith("v"), APP_VERSION);
    check("boot: library is loaded", libraryTracks.length > 0, libraryTracks.length + " songs");

    // Browse: open the first folder, see songs or folders, come back
    const crumbBefore = $("#breadcrumb").textContent;
    const folderRow = $("#file-list .folder-row");
    check("browse: folder rows are listed", !!folderRow);
    if (folderRow) {
      folderRow.click();
      const moved = await waitFor(() => $("#breadcrumb").textContent !== crumbBefore);
      check("browse: opening a folder updates the breadcrumb", moved, $("#breadcrumb").textContent.replace(/\s+/g, " ").trim());
      await waitFor(() => $("#file-list .row"), 6000);
      const rows = document.querySelectorAll("#file-list .row").length;
      check("browse: the folder shows rows", rows > 0, rows + " rows");
      const trackRows = [...document.querySelectorAll("#file-list .track-row")];
      if (trackRows.length) {
        const withArtist = trackRows.filter((r) => r.querySelector(".row-sub")).length;
        check("browse: song rows show their artist when known", withArtist > 0 || !libraryTracks.some((t) => t.audio && t.audio.artist), withArtist + "/" + trackRows.length);
        const cs = getComputedStyle(trackRows[0].querySelector(".row-name"));
        check("browse: song names can't be text-selected", (cs.webkitUserSelect || cs.userSelect) === "none");
      }
      const crumbLinks = document.querySelectorAll("#breadcrumb *");
      const homeCrumb = [...crumbLinks].find((c) => c.dataset && (c.dataset.index !== undefined || c.dataset.idx !== undefined)) || crumbLinks[0];
      if (homeCrumb) { homeCrumb.click(); await sleep(400); }
    }

    // Select mode toggles on and off
    click("#select-toggle-btn");
    await sleep(150);
    check("select: mode turns on", visible("#select-header-bar"));
    click("#select-cancel-btn");
    await sleep(150);
    check("select: mode turns off", !visible("#select-header-bar"));

    // Search: songs and artists
    click("#search-btn");
    check("search: overlay opens", await waitFor(() => visible("#search-overlay")));
    const input = $("#search-input");
    input.value = "jorge";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(600);
    const hits = document.querySelectorAll("#search-results .row").length;
    check("search: typing finds results", hits > 0 || searchLibrary("jorge").length === 0, hits + " rows");
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    click("#search-close-btn");
    check("search: overlay closes", await waitFor(() => !visible("#search-overlay")));

    // Playlists
    click("#playlists-btn");
    check("playlists: overlay opens", await waitFor(() => visible("#playlists-overlay")));
    click("#playlists-close-btn");
    check("playlists: overlay closes", await waitFor(() => !visible("#playlists-overlay")));

    // Settings hides the mini player, error log opens and closes
    click("#settings-btn");
    check("settings: overlay opens", await waitFor(() => visible("#settings-overlay")));
    await sleep(100);
    const bar = $("#now-playing-bar");
    check("settings: mini player is hidden", getComputedStyle(bar).display === "none");
    click("#error-log-btn");
    check("error log: opens", await waitFor(() => visible("#error-log-overlay")));
    click("#error-log-back-btn");
    check("error log: closes", await waitFor(() => !visible("#error-log-overlay")));
    click("#settings-close-btn");
    check("settings: overlay closes", await waitFor(() => !visible("#settings-overlay")));
    await sleep(100);
    check("settings: mini player is back after closing (if a song is loaded)", getComputedStyle(bar).display !== "none" || bar.classList.contains("hidden"));

    // Welcome guide sits above the mini player so Next is reachable
    click("#settings-btn");
    await waitFor(() => visible("#settings-overlay"));
    click("#show-intro-btn");
    check("intro: welcome guide opens", await waitFor(() => visible("#intro-overlay")));
    check("intro: it sits above the mini player", Number(getComputedStyle($("#intro-overlay")).zIndex) > Number(getComputedStyle(bar).zIndex));
    const next = $("#intro-next-btn").getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    const covered = !bar.classList.contains("hidden") && next.bottom > barRect.top && next.top < barRect.bottom && Number(getComputedStyle(bar).zIndex) > Number(getComputedStyle($("#intro-overlay")).zIndex);
    check("intro: Next button is not covered", !covered);
    for (let i = 0; i < 4 && visible("#intro-overlay"); i++) {
      const finish = $("#intro-finish-btn");
      if (finish && finish.offsetParent) { finish.click(); break; }
      $("#intro-next-btn").click();
      await sleep(120);
    }
    await waitFor(() => !visible("#intro-overlay"), 3000);
    if (visible("#settings-overlay")) click("#settings-close-btn");
    await sleep(150);

    // Full player, when something is loaded
    if (!$("#now-playing-bar").classList.contains("hidden")) {
      $("#now-playing-bar .np-title").click();
      const opened = await waitFor(() => visible("#full-player"));
      check("player: full player opens from the mini player", opened);
      if (opened) {
        click("#full-player-close-btn");
        check("player: full player closes", await waitFor(() => !visible("#full-player")));
      }
    }
  } catch (err) {
    check("smoke run threw", false, err && err.message);
  }

  const newErrors = loadErrorLog().filter((e) => e.time >= startedAt);
  check("error log: nothing new was logged", newErrors.length === 0, newErrors.map((e) => e.message.slice(0, 120)).join(" | "));

  const failed = results.filter((r) => !r[1]).length;
  return JSON.stringify({ passed: results.length - failed, failed, results });
})()
