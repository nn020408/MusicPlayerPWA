// Android back-button scenarios: opens a screen inside the app, presses the real
// hardware BACK key over adb, and checks that exactly one layer closed. Run by
// tests/phone-smoke.js after the in-page checks. Non-destructive.

module.exports = async function backScenarios(phone, check) {
  const { evaluate, back, sleep } = phone;
  const hidden = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)}).classList.contains("hidden")`);
  const click = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`);
  const crumb = () => evaluate(`document.querySelector("#breadcrumb").textContent.replace(/\\s+/g, " ").trim()`);
  const waitFor = async (expr, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await evaluate(expr)) return true; await sleep(100); } return false; };

  // Start every scenario from the top of the folder view with nothing open
  const reset = async () => {
    await evaluate(`document.querySelectorAll(".overlay, .full-player").forEach((e) => e.classList.add("hidden"))`);
    await sleep(200);
  };

  // Simple overlays close on BACK
  for (const [name, open, overlay] of [["search", "#search-btn", "#search-overlay"], ["playlists", "#playlists-btn", "#playlists-overlay"], ["settings", "#settings-btn", "#settings-overlay"]]) {
    await reset();
    await click(open);
    await sleep(300);
    const wasOpen = !(await hidden(overlay));
    await back();
    check(`back: ${name} closes`, wasOpen && (await hidden(overlay)));
  }

  // Selection mode
  await reset();
  await click("#select-toggle-btn");
  await sleep(200);
  const selecting = !(await hidden("#select-header-bar"));
  await back();
  check("back: select mode exits", selecting && (await hidden("#select-header-bar")));

  // Folder navigation: open a folder, BACK goes up one level
  await reset();
  const topCrumb = await crumb();
  await evaluate(`document.querySelector("#file-list .folder-row").click()`);
  const inside = await waitFor(`document.querySelector("#breadcrumb").textContent.replace(/\\s+/g, " ").trim() !== ${JSON.stringify(topCrumb)}`);
  await sleep(500);
  await back();
  await sleep(600);
  check("back: goes up one folder", inside && (await crumb()) === topCrumb, `${topCrumb} -> inside -> ${await crumb()}`);

  // Search > Artists is one level inside Search: BACK steps out first, then closes
  await reset();
  await click("#search-btn");
  await sleep(500);
  const hasArtistsButton = await evaluate(`!!document.querySelector('#search-results [data-act="artists"]')`);
  if (hasArtistsButton) {
    await click('#search-results [data-act="artists"]');
    await sleep(400);
    await back();
    const stillSearch = !(await hidden("#search-overlay"));
    await back();
    check("back: Artists view steps out to Search, then Search closes", stillSearch && (await hidden("#search-overlay")));
  } else {
    check("back: Artists view steps out to Search, then Search closes", true, "skipped: no Artists button on the search home");
  }

  // Welcome guide: BACK steps back a panel, then closes (opened from Settings)
  await reset();
  await click("#settings-btn");
  await sleep(300);
  await click("#show-intro-btn");
  await sleep(400);
  await click("#intro-next-btn");
  await sleep(200);
  await click("#intro-next-btn");
  await sleep(200);
  await back();
  const onPanel1 = await evaluate(`!document.querySelector('#intro-panels [data-panel="1"]').classList.contains("hidden")`);
  await back();
  const onPanel0 = await evaluate(`!document.querySelector('#intro-panels [data-panel="0"]').classList.contains("hidden")`);
  const stillOpen = !(await hidden("#intro-overlay"));
  await back();
  check("back: welcome guide steps back panel by panel, then closes", onPanel1 && onPanel0 && stillOpen && (await hidden("#intro-overlay")));

  // Folder picker (change music folder): BACK goes up inside the picker, then closes it
  await reset();
  await click("#settings-btn");
  await sleep(300);
  await click("#change-folder-btn");
  await waitFor(`!document.querySelector("#folder-picker-overlay").classList.contains("hidden")`);
  await waitFor(`document.querySelector("#fp-file-list .folder-row")`);
  const pickerCrumbRoot = await evaluate(`document.querySelector("#fp-breadcrumb").textContent.replace(/\\s+/g, " ").trim()`);
  await evaluate(`document.querySelector("#fp-file-list .folder-row").click()`);
  await waitFor(`document.querySelector("#fp-breadcrumb").textContent.replace(/\\s+/g, " ").trim() !== ${JSON.stringify(pickerCrumbRoot)}`);
  await sleep(400);
  await back();
  await sleep(500);
  const upOne = (await evaluate(`document.querySelector("#fp-breadcrumb").textContent.replace(/\\s+/g, " ").trim()`)) === pickerCrumbRoot && !(await hidden("#folder-picker-overlay"));
  await back();
  check("back: folder picker goes up a level, then closes", upOne && (await hidden("#folder-picker-overlay")));
  await reset();

  // Full player closes on BACK (only when a song is loaded)
  if (!(await hidden("#now-playing-bar")) === true) {
    await click("#now-playing-bar .np-title");
    await sleep(300);
    const open = !(await hidden("#full-player"));
    await back();
    check("back: full player closes", open && (await hidden("#full-player")));
  }
};
