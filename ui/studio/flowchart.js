(() => {
  const selector = 'a[href*="#vs-flow:"]';
  let panel, anchor, pinned, timer;
  let nativeZoom, rectTimer, fileImage;
  function publishZoomRect() {
    if (!window.nadosNative) return;
    const rect = (pinned ? panel : fileImage)?.getBoundingClientRect();
    nadosNative.call("window.diagramZoomRect", rect ? {...rect.toJSON(), wheelZoom: !pinned && !!fileImage} : {}).catch(() => {});
  }
  window.TSU_FILE_ZOOM = (view, enabled) => {
    if (!enabled && fileImage !== view) return;
    fileImage = enabled ? view : null;
    if (!pinned) publishZoomRect();
  };
  window.nadosNative?.on("diagram-magnify", e => {
    if (nativeZoom) return nativeZoom(e);
    if (fileImage?.isConnected && fileImage.contains(document.elementFromPoint(e.x, e.y))) fileImage.magnify(e);
  });
  window.addEventListener("resize", () => { if (nativeZoom || fileImage) publishZoomRect(); });
  function close() {
    const wasPinned = pinned;
    clearTimeout(rectTimer);
    nativeZoom = null;
    clearTimeout(timer);
    panel?.remove();
    panel = anchor = null;
    pinned = false;
    if (wasPinned) publishZoomRect();
  }
  function open(link, full) {
    clearTimeout(timer);
    if (panel && anchor === link && (!full || pinned)) return;
    close();
    anchor = link;
    pinned = full;
    const source = decodeURIComponent(link.hash.slice(9));
    panel = document.createElement("div");
    panel.className = "vs-flow-panel" + (full ? " full" : "");
    const view = panel;
    view.style.visibility = "hidden";
    const img = document.createElement("img");
    img.alt = "流程图";
    const canvas = document.createElement("div");
    canvas.className = "vs-flow-canvas";
    canvas.append(img);
    panel.append(canvas);
    (async () => {
      try {
        await window.loadStudioLibrary("diagram");
        if (view !== panel) return;
        mermaid.initialize({startOnLoad:false,securityLevel:"strict",theme:"base",themeVariables:{fontFamily:"system-ui, sans-serif",primaryColor:"#f2f5f9",primaryTextColor:"#222b37",primaryBorderColor:"#8997a8",lineColor:"#6c798a",edgeLabelBackground:"#ffffff",background:"#ffffff"},flowchart:{htmlLabels:false}});
        const {svg} = await mermaid.render("flow" + crypto.randomUUID().replaceAll("-", ""), source);
        if (view !== panel) return;
        const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
        const [, , width, height] = root.getAttribute("viewBox").split(/[ ,]+/).map(Number);
        root.setAttribute("width", width);
        root.setAttribute("height", height);
        root.style.maxWidth = "none";
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(root));
        const pane = link.closest(".tpane")?.getBoundingClientRect();
        const available = Math.min(innerWidth, pane?.width || innerWidth);
        if (full) {
          const area = {left:innerWidth * .05, top:innerHeight * .08, width:innerWidth * .9, height:innerHeight * .84};
          const fit = Math.min(1, Math.max(1,area.width - 48) / width, Math.max(1,area.height - 92) / height);
          view.style.width = Math.min(area.width - 8, Math.max(96,Math.ceil(width * fit) + 24)) + "px";
          view.style.height = Math.min(area.height - 8, Math.ceil(height * fit) + 46) + "px";
          view.style.left = (area.left + area.width / 2) + "px";
          view.style.top = (area.top + area.height / 2) + "px";
        }
        const scale = full ? Math.min(1,(canvas.clientWidth - 12) / width, (canvas.clientHeight - 12) / height) : Math.min(1, Math.max(100, available - 32) / width, (innerHeight * 0.5) / height);
        img.style.width = Math.ceil(width * scale) + "px";
        img.style.height = Math.ceil(height * scale) + "px";
        if (full) {
          let nextZoom = scale, frame = 0, focalPoint;
          let zoom = scale, gestureStart = null, lastGesture = -Infinity;

          function resize(value, event) {
            const before = img.getBoundingClientRect(), box = view.getBoundingClientRect();
            const x = event.clientX || box.left + box.width / 2;
            const y = event.clientY || box.top + box.height / 2;
            const fx = (x - before.left) / before.width, fy = (y - before.top) / before.height;
            zoom = Math.min(Math.max(6,scale), Math.max(Math.min(.1,scale), value));
            img.style.width = Math.ceil(width * zoom) + "px";
            img.style.height = Math.ceil(height * zoom) + "px";
            view.style.width = Math.min(innerWidth * .9 - 8, Math.max(96, Math.ceil(width * zoom) + 24)) + "px";
            view.style.height = Math.min(innerHeight * .84 - 8, Math.ceil(height * zoom) + 46) + "px";
            clearTimeout(rectTimer);
            rectTimer = setTimeout(publishZoomRect, 100);
            const after = img.getBoundingClientRect();
            canvas.scrollLeft += after.left + fx * after.width - x;
            canvas.scrollTop += after.top + fy * after.height - y;
            img.style.cursor = zoom > scale * 1.01 ? "zoom-out" : "zoom-in";
          }
          function scheduleZoom(value, point) {
            nextZoom = Math.min(Math.max(6,scale), Math.max(Math.min(.1,scale),value));
            focalPoint = {clientX:point.clientX,clientY:point.clientY};
            if (!frame) frame = requestAnimationFrame(() => {
              frame = 0;
              if (panel === view) resize(nextZoom, focalPoint);
            });
          }
          nativeZoom = e => scheduleZoom(nextZoom * (1 + e.delta), {clientX:e.x, clientY:e.y});
          publishZoomRect();
          view.addEventListener("gesturestart", e => { e.preventDefault(); gestureStart = zoom; }, {passive:false});
          view.addEventListener("gesturechange", e => {
            e.preventDefault();
            if (gestureStart !== null) scheduleZoom(gestureStart * e.scale, e);
          }, {passive:false});
          view.addEventListener("gestureend", e => { e.preventDefault(); gestureStart = null; lastGesture = performance.now(); }, {passive:false});
          view.addEventListener("wheel", e => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            if (gestureStart === null) scheduleZoom(nextZoom * Math.exp(-e.deltaY * .01), e);
          }, {passive:false});
          const controls = document.createElement("div");
          controls.className = "vs-flow-zoom";
          for (const [label, factor] of [["−", 1/1.25], ["+", 1.25]]) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = label;
            button.setAttribute("aria-label", factor > 1 ? "放大" : "缩小");
            button.onclick = () => scheduleZoom(nextZoom * factor, {});
            controls.append(button);
          }
          view.append(controls);
          img.onclick = e => {
            if (performance.now() - lastGesture < 250) return;
            scheduleZoom(zoom > scale * 1.01 ? scale : Math.max(1, scale * 1.25), e);
          };
        } else {
          const rect = link.getBoundingClientRect();
          view.style.left = Math.max(4, Math.min((pane ? pane.left + pane.width / 2 : innerWidth / 2) - view.offsetWidth / 2, innerWidth - view.offsetWidth - 4)) + "px";
          view.style.top = Math.max(4, rect.top >= view.offsetHeight + 6 ? rect.top - view.offsetHeight - 4 : Math.min(innerHeight - view.offsetHeight - 4, rect.bottom + 4)) + "px";
        }
        view.style.visibility = "visible";
      } catch (error) {
        view.style.visibility = "visible";
        if (view === panel) img.replaceWith(document.createTextNode("流程图绘制失败：" + error.message));
      }
    })();
    if (full) {
      panel.tabIndex = -1;
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", "流程图，点击图片缩放，按 Esc 收起");
      document.body.append(panel);
      panel.focus({preventScroll:true});
    } else {
      document.body.append(panel);
      const rect = link.getBoundingClientRect();
      panel.style.left = Math.max(4, Math.min(rect.left, innerWidth - panel.offsetWidth - 4)) + "px";
      panel.style.top = Math.max(4, rect.bottom + panel.offsetHeight < innerHeight ? rect.bottom : rect.top - panel.offsetHeight) + "px";
    }
  }
  document.addEventListener("pointerover", e => {
    const link = e.target.closest(selector);
    if (link && !pinned && anchor?.href !== link.href) { clearTimeout(timer); timer = setTimeout(() => open(link,false), 180); }
  });
  document.addEventListener("pointerout", e => {
    const link = e.target.closest(selector);
    if (!link || pinned || e.relatedTarget?.closest?.(selector)?.href === link.href) return;
    const {clientX:x,clientY:y} = e;
    requestAnimationFrame(() => {
      if (pinned) return;
      const current = document.elementFromPoint(x,y)?.closest(selector);
      if (current?.href === link.href) { anchor = current; return; }
      if (!anchor || anchor.href === link.href) close();
    });
  });
  document.addEventListener("click", e => {
    if (pinned && panel.contains(e.target) && (e.target.closest("button") || e.target.tagName === "IMG")) return;
    if (pinned) { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    const link = e.target.closest(selector);
    if (link) { e.preventDefault(); e.stopImmediatePropagation(); open(link,true); }
  },true);
  window.addEventListener("keydown", e => {
    if (panel && e.key === "Escape") {e.preventDefault(); e.stopImmediatePropagation(); close();}
  },true);
})();
