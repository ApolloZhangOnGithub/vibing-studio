const sleep = (ms) => new Promise(r => setTimeout(r, ms)), out = { errs: [] };
window.addEventListener("error", (e) => out.errs.push(String(e.message || e.error).slice(0, 200) + " @" + (e.filename || "").split("/").pop() + ":" + e.lineno));
window.addEventListener("unhandledrejection", (e) => out.errs.push("rej: " + String(e.reason && (e.reason.stack || e.reason)).slice(0, 200)));
try {
  await sleep(5000);
  const tw = () => TSU_TERM.front();
  for (const os of ["vscode", "claude", "macos", "terminal"]) {
    STUDIO.previewSet("os", os); STUDIO.applySettings(); await sleep(1500);
    try { STUDIO.showPage(tw(), "settings", null); } catch (e) { out.errs.push(os + " settings: " + e.message); }
    await sleep(900);
    try { TSU_CHANGELOG.open(tw()); await sleep(500); TSU_CHANGELOG.close(); } catch (e) { out.errs.push(os + " changelog: " + e.message); }
    try { STUDIO.openPage(tw(), "explorer", "~/Documents"); } catch (e) { out.errs.push(os + " explorer: " + e.message); }
    await sleep(900);
    if (os === "macos") { try { TSU_MACOS.mission(); await sleep(700); TSU_MACOS.mission(); await sleep(600); } catch (e) { out.errs.push("mc: " + e.message); } }
    out[os] = document.documentElement.className.split(" ").filter(c => /^st-(os|macos|gui)|mc-on|light/.test(c)).join(" ");
  }
  // 关键接口都在（导出那一行被误注释掉之类的回归），打开设置的某一节也不出错
  ["settings", "showPage", "openPage", "menu", "setv", "get", "previewSet", "applySettings", "toggle", "togglePanel", "palette", "command"].forEach(k => { if (typeof STUDIO[k] !== "function") out.errs.push("STUDIO." + k + " missing"); });
  for (const os of ["vscode", "claude"]) {
    STUDIO.previewSet("os", os); STUDIO.applySettings(); await sleep(900);
    for (const sec of ["account", "appearance", "connectors"]) { try { STUDIO.settings(tw(), sec); await sleep(600); } catch (e) { out.errs.push(os + " settings(" + sec + "): " + String(e.message || e).slice(0, 160)); } }
    try { let M; while (STUDIO.modal && STUDIO.modal.top && (M = STUDIO.modal.top())) STUDIO.modal.close(M); } catch (e) { out.errs.push(os + " modal close: " + e.message); } await sleep(300);
  }
  // VS Code：Agent 标签页、Claude Code 会话、辅助侧栏、面板、TUI/GUI、设置——右上角的布局开关一直在，没有报错
  STUDIO.previewSet("os", "vscode"); STUDIO.applySettings(); await sleep(1200);
  const W = tw(), wasSide = STUDIO.isOpen(), wasPanel = STUDIO.panelOpen(), opened = [];
  const chk = (tag) => { if (!document.querySelector("#win .bar .st-lay button")) out.errs.push("layout controls missing: " + tag); };
  try {
    const ag = (TSU_AGENTS.list() || []).find(a => !a.archived && !/^c[cx]:/.test(a.id));
    if (ag) { TSU_TERM.agent(ag.id); await sleep(1500); opened.push(W.ws.active); chk("agent"); }
    TSU_TERM.agent("cc:751371a1-9dae-41c7-b3f7-105bcaf37317"); await sleep(2200); opened.push(W.ws.active); chk("claude");
    STUDIO.toggle(W, true); await sleep(1000); chk("aside");
    STUDIO.togglePanel(W, true); await sleep(800); chk("panel");
    for (const ui of ["gui", "tui"]) { STUDIO.previewSet("ui", ui); STUDIO.applySettings(); await sleep(1300); chk(ui); }
    STUDIO.showPage(W, "settings", null); await sleep(900); chk("settings");
  } catch (e) { out.errs.push("vscode tabs: " + String(e.stack || e).slice(0, 300)); }
  STUDIO.previewSet("ui", null); STUDIO.toggle(W, wasSide); STUDIO.togglePanel(W, wasPanel);
  opened.forEach(p => { try { if (p && W.ws.closePane) W.ws.closePane(p); } catch (e) {} });
  await sleep(600);
} catch (e) { out.errs.push("top: " + String(e.stack || e).slice(0, 300)); }
return out;
