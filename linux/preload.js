// preload.js —— 页面最开始（主框架、只给允许的源）装上 window.nadosNative（同 app/Resources/bridge.js：call / on / off，事件同时发 window 的 "nados-native"）。
//   隔离世界里只留一条通道（__vsNative），nadosNative 本身建在页面自己的世界里（CustomEvent 的 detail 才能原样交给页面）
//   键盘：Linux 上按 Ctrl 当 ⌘（同 VS Code 的 Linux 版）——终端、会话里 Ctrl 还是 Ctrl（Ctrl+C、Ctrl+R、Ctrl+T 这些归它们），App 的快捷键用 Ctrl+Shift
"use strict";
const { contextBridge, ipcRenderer } = require("electron");

const BOOT = ipcRenderer.sendSync("nados:boot");
if (BOOT && Array.isArray(BOOT.allowed) && BOOT.allowed.indexOf(location.origin) >= 0) {
  contextBridge.exposeInMainWorld("__vsNative", {
    info: BOOT.info,
    call: (cmd, args) => ipcRenderer.invoke("nados:call", String(cmd), args == null ? {} : args),
    listen: (fn) => { ipcRenderer.on("nados:event", (_e, type, detail) => fn(type, detail)); },
  });
  contextBridge.executeInMainWorld({
    func: function () {
      var B = window.__vsNative;
      if (!B || window.nadosNative) return;
      var INFO = B.info, subs = {};
      var api = {
        platform: INFO.platform, app: INFO.app, version: INFO.version, protocol: INFO.protocol, local: !!INFO.local,
        call: function (cmd, args) {
          return B.call(cmd, args).then(function (r) {
            if (r && r.ok) return r.value;
            var e = new Error((r && r.error && r.error.message) || "native call failed");
            e.code = (r && r.error && r.error.code) || "E_FAILED";
            throw e;
          });
        },
        on: function (type, fn) { (subs[type] = subs[type] || []).push(fn); return function () { api.off(type, fn); }; },
        off: function (type, fn) { subs[type] = (subs[type] || []).filter(function (f) { return f !== fn; }); },
        _emit: function (type, detail) {
          (subs[type] || []).slice().forEach(function (f) { try { f(detail); } catch (e) { console.error(e); } });
          window.dispatchEvent(new CustomEvent("nados-native", { detail: { type: type, detail: detail } }));
        },
      };
      B.listen(function (type, detail) { api._emit(type, detail); });
      Object.defineProperty(window, "nadosNative", { value: Object.freeze(api), enumerable: false, configurable: false, writable: false });
      var mark = function () { if (document.documentElement) document.documentElement.classList.add("linux-app"); }; // 页面的 <html class="termapp"> 还没解析出来时加上的会被换掉：解析完再加一次
      mark(); document.addEventListener("DOMContentLoaded", mark);
      // 右上角的窗口按钮（Electron 画的）：颜色、高度同页面最上面那一条（换配色、换应用风格都跟上；量一下没变就不发）
      var tbSig = "";
      var tbSync = function () {
        var bar = document.querySelector("#win .bar");
        if (!bar || !bar.offsetParent) return;
        var bg = getComputedStyle(bar).backgroundColor, fg = getComputedStyle(document.documentElement).getPropertyValue("--st-fg").trim() || getComputedStyle(bar).color, h = Math.round(bar.getBoundingClientRect().height);
        if (/rgba\(.*,\s*0\)$/.test(bg) || bg === "transparent") bg = getComputedStyle(document.body).backgroundColor;
        var sig = bg + "|" + fg + "|" + h;
        if (sig === tbSig) return;
        tbSig = sig;
        api.call("window.titlebar", { color: bg, symbol: fg, height: h }).catch(function () {});
      };
      document.addEventListener("DOMContentLoaded", function () { tbSync(); setInterval(tbSync, 1000); });

      // ---- 键盘：Ctrl 当 ⌘ ----
      //   终端（xterm）、Agent / Claude Code 的对话和输入框、代码编辑器里：Ctrl+字母归它们（shell、Claude Code、编辑器自己的快捷键）；
      //     在这些地方 App 的快捷键按 Ctrl+Shift+字母（同 GNOME 终端：Ctrl+Shift+T 新标签页、Ctrl+Shift+W 关闭）；终端里 Ctrl+Shift+C / V 是拷贝 / 粘贴
      //   别处：Ctrl+… 就是 ⌘+…（Ctrl+, 设置、Ctrl+T 新标签页、Ctrl+Shift+P 命令面板）；输入框里 Ctrl+A / C / V / X / Z / Y 照旧是编辑
      var own = function (t) { return !!(t && t.closest && t.closest(".xterm, .st-cm, .cm-editor, .foot, .tpane .screen, .gv-comp, .gv-input")); };
      var editable = function (t) { return !!(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))); };
      var as = function (e, meta, shift) {
        Object.defineProperty(e, "metaKey", { value: meta, configurable: true });
        Object.defineProperty(e, "ctrlKey", { value: false, configurable: true });
        Object.defineProperty(e, "shiftKey", { value: shift, configurable: true });
      };
      window.addEventListener("keydown", function (e) {
        if (!e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
        var t = e.target, k = String(e.key || "");
        if (/^(Control|Shift|Alt|Meta)$/.test(k)) return;
        if (own(t)) {
          if (!e.shiftKey) return;
          if (t.closest && t.closest(".xterm")) {
            if (/^c$/i.test(k)) { e.preventDefault(); e.stopImmediatePropagation(); document.execCommand("copy"); return; }
            if (/^v$/i.test(k)) return; // Chromium 自己粘贴
          }
          as(e, true, false);
          return;
        }
        if (!e.shiftKey && /^[acvxyz]$/i.test(k) && (editable(t) || String(window.getSelection() || ""))) return;
        as(e, true, e.shiftKey);
      }, true);
    },
  });
}
