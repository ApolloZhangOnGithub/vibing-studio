// bridge.js —— Paimon App 在页面最开始（document-start、只在主框架）注入：window.nadosNative
// 只给允许的源（原生那边收到消息时按来源再查一次）。协议见 apps/macos/README.md：
//   nadosNative.call(命令, 参数) → Promise：成功给 value；失败抛 Error，带 code（E_ARGS、E_PERMISSION……）
//   nadosNative.on(事件, fn) → 取消订阅的函数；事件同时以 window 上的 "nados-native" CustomEvent 发出
(function () {
  "use strict";
  var ALLOWED = __ALLOWED__, INFO = __INFO__;
  if (window.nadosNative || ALLOWED.indexOf(location.origin) < 0) return;
  var mh = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.nados;
  if (!mh) return;
  var subs = {};
  var api = {
    platform: INFO.platform, app: INFO.app, version: INFO.version, protocol: INFO.protocol, local: !!INFO.local, // local：Paimon Terminal（shell、agent 的工具在这台 Mac 上）
    call: function (cmd, args) {
      return Promise.resolve(mh.postMessage({ cmd: String(cmd), args: args == null ? {} : args })).then(function (r) {
        if (r && r.ok) return r.value;
        var e = new Error((r && r.error && r.error.message) || "native call failed");
        e.code = (r && r.error && r.error.code) || "E_FAILED";
        throw e;
      });
    },
    on: function (type, fn) { (subs[type] = subs[type] || []).push(fn); return function () { api.off(type, fn); }; },
    off: function (type, fn) { subs[type] = (subs[type] || []).filter(function (f) { return f !== fn; }); },
    // 原生 → 页面（通知被点、窗口到前台 / 退到后台、全屏）
    _emit: function (type, detail) {
      (subs[type] || []).slice().forEach(function (f) { try { f(detail); } catch (e) { console.error(e); } });
      window.dispatchEvent(new CustomEvent("nados-native", { detail: { type: type, detail: detail } }));
    },
  };
  // 连着另一台 Mac 的窗口（?mac=<那台的设备号>，见 AppDelegate.newWindow）：这台的桥换个名字交给 remote.js——它搭一个 nadosNative，
  //   终端、文件、会话转到那台 Mac，窗口、菜单、剪贴板、通知、内置浏览器还用这里的。原生这边的事件照旧发给 window.nadosNative._emit（就是它搭的那个）
  var mac = new URLSearchParams(location.search).get("mac");
  Object.defineProperty(window, mac && mac !== "off" ? "__nadosLocal" : "nadosNative", { value: Object.freeze(api), enumerable: false, configurable: false, writable: false });
})();
