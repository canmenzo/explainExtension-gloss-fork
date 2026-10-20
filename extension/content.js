(() => {
  if (document.documentElement.dataset.explainReady) return;
  document.documentElement.dataset.explainReady = "true";

  const api = globalThis.browser ?? globalThis.chrome;
  const host = document.createElement("div");
  host.setAttribute("aria-label", "Explain selection");
  host.dataset.state = "closed";
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host{all:initial}
    *{box-sizing:border-box}
    .surface{position:fixed;max-width:calc(100vw - 24px);background:#FFF;color:#202B3A;color-scheme:light;font:14px/1.5 ui-sans-serif,system-ui,sans-serif;border-radius:12px;box-shadow:0 0 0 1px #0000000d,0 4px 8px #00000008,0 16px 40px #0000001a;pointer-events:none;opacity:0;transform:translateY(4px);transition:opacity 150ms cubic-bezier(.22,1,.36,1),transform 150ms cubic-bezier(.22,1,.36,1)}
    .surface.is-open{pointer-events:auto;opacity:1;transform:translateY(0);transition-duration:250ms}
    .surface[hidden]{display:none}
    button{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:36px;border:0;border-radius:8px;padding:0 12px;background:#315DAD;color:#FFF;font:600 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;transition:background-color 150ms ease-out,transform 150ms ease-out}
    button:hover{background:#244B92}button:active{transform:scale(.96)}button:focus-visible{outline:2px solid #315DAD;outline-offset:3px}
    .box{display:flex;align-items:center;gap:4px;padding:4px}
    .explain{min-height:40px;background:#FFF;color:#202B3A;padding:0 12px 0 8px}.explain:hover{background:#EAF0FB}
    .mark{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;flex-shrink:0;border-radius:4px;background:#315DAD;color:#FFF;font-size:20px;font-weight:600;line-height:1}
    .shortcut{margin-left:8px;color:#59677A;font-size:12px;font-weight:400}
    .close{width:36px;min-width:36px;min-height:36px;padding:0;background:transparent;color:#59677A}.close:hover{background:#EAF0FB;color:#202B3A}.close svg{width:16px;height:16px;stroke:currentColor;stroke-width:1.5;fill:none}
    .result{display:flex;flex-direction:column;width:384px;max-height:calc(100vh - 24px);overflow:hidden}
    .header{display:flex;align-items:center;gap:8px;flex-shrink:0;padding:12px 12px 12px 16px}.header h2{flex:1;margin:0;font-size:14px;font-weight:600;line-height:24px}.header .mark{width:24px;height:24px}
    .quote{flex-shrink:0;min-height:0;margin:0 16px 16px;padding:12px;border-left:2px solid #315DAD;border-radius:0 4px 4px 0;background:#F8FAFC;overflow:hidden}
    .quote-label{margin:0 0 4px;color:#59677A;font-size:12px;line-height:16px}.quote-text{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin:0;color:#59677A;font-size:12px;line-height:20px;overflow-wrap:anywhere}
    .body{min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:0 16px 16px;scrollbar-width:thin;scrollbar-color:#CDD6E4 transparent}
    .body:focus-visible{outline:2px solid #315DAD;outline-offset:-2px}.answer{margin:0;color:#202B3A;font-size:14px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere}
    .status{margin:0 0 16px;color:#59677A;font-size:12px;line-height:20px}.skeleton{display:grid;gap:8px;padding-bottom:8px}.skeleton span{height:8px;border-radius:4px;background:#EAF0FB}.skeleton span:nth-child(2){width:92%}.skeleton span:last-child{width:64%}
    .error-title{margin:0 0 8px;color:#AD3C43;font-size:14px;font-weight:600;line-height:20px}.error-text{margin:0 0 16px;color:#59677A;font-size:14px;line-height:1.5;overflow-wrap:anywhere}
    .footer{flex-shrink:0;margin:0;border-top:1px solid #EAF0FB;padding:12px 16px;color:#59677A;font-size:12px;line-height:16px;background:#F8FAFC}kbd{font:inherit}
    @media(prefers-reduced-motion:reduce){.surface,button{transition:none}.surface{transform:none}button:active{transform:none}}
  `;
  const box = document.createElement("div");
  box.className = "surface box";
  box.setAttribute("role", "toolbar");
  box.setAttribute("aria-label", "Explain selected text");
  box.hidden = true;
  box.inert = true;
  const explainButton = document.createElement("button");
  explainButton.type = "button";
  explainButton.className = "explain";
  explainButton.setAttribute("aria-label", "Explain selected text");
  explainButton.innerHTML = '<span class="mark" aria-hidden="true">e</span><span>Explain</span><span class="shortcut" aria-hidden="true">Enter</span>';

  function dismissButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "close";
    button.setAttribute("aria-label", "Dismiss explanation");
    button.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg>';
    button.addEventListener("click", () => dismiss(true));
    return button;
  }

  box.append(explainButton, dismissButton());
  const result = document.createElement("section");
  result.className = "surface result";
  result.setAttribute("aria-label", "Explanation");
  result.hidden = true;
  result.inert = true;
  const header = document.createElement("div");
  header.className = "header";
  header.innerHTML = '<span class="mark" aria-hidden="true">e</span><h2>Explanation</h2>';
  header.append(dismissButton());
  const preview = document.createElement("blockquote");
  preview.className = "quote";
  const quoteLabel = document.createElement("p");
  quoteLabel.className = "quote-label";
  quoteLabel.textContent = "Selected text";
  const quoteText = document.createElement("p");
  quoteText.className = "quote-text";
  preview.append(quoteLabel, quoteText);
  const body = document.createElement("div");
  body.className = "body";
  body.setAttribute("aria-live", "polite");
  body.setAttribute("aria-atomic", "true");
  body.tabIndex = 0;
  body.setAttribute("aria-label", "Explanation text");
  const footer = document.createElement("p");
  footer.className = "footer";
  footer.innerHTML = '<kbd>Esc</kbd> to dismiss';
  result.append(header, preview, body, footer);
  shadow.append(style, box, result);
  document.documentElement.append(host);

  let timer;
  let activeInfo;
  let dismissed = false;
  let request = 0;
  const hideTimers = new Map();

  function setVisible(surface, visible) {
    clearTimeout(hideTimers.get(surface));
    surface.inert = !visible;
    surface.setAttribute("aria-hidden", String(!visible));
    if (visible) {
      if (surface.hidden) {
        surface.hidden = false;
        void surface.offsetWidth;
      }
      surface.classList.add("is-open");
    } else {
      surface.classList.remove("is-open");
      hideTimers.set(surface, setTimeout(() => {
        surface.hidden = true;
      }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 150));
    }
  }

  function dismiss(clearSelection = false) {
    ++request;
    clearTimeout(timer);
    dismissed = clearSelection;
    host.dataset.state = "closed";
    delete host.dataset.phase;
    delete host.dataset.placement;
    setVisible(box, false);
    setVisible(result, false);
    if (clearSelection) window.getSelection()?.removeAllRanges();
  }

  function selectionInfo() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const text = selection.toString().trim();
    if (!text || text.length > 12000) return null;
    const range = selection.getRangeAt(0);
    if (!document.contains(range.commonAncestorContainer)) return null;
    const element = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    if (element?.isContentEditable || element?.closest("input,textarea,select")) return null;
    const block = element?.closest("p,li,blockquote,pre,h1,h2,h3,h4,h5,h6,td,th");
    const context = (block?.innerText || element?.innerText || text).slice(0, 5000);
    return { text, context, range: range.cloneRange() };
  }

  function place(surface) {
    if (!activeInfo) return;
    const rect = activeInfo.range.getBoundingClientRect();
    const width = surface.offsetWidth;
    const height = surface.offsetHeight;
    const left = Math.max(12, Math.min(innerWidth - width - 12, rect.left + rect.width / 2 - width / 2));
    const above = rect.top - height - 12 >= 12;
    const top = above ? rect.top - height - 12 : rect.bottom + 12;
    surface.style.left = `${left}px`;
    surface.style.top = `${Math.max(12, Math.min(innerHeight - height - 12, top))}px`;
    host.dataset.placement = above ? "above" : "below";
    surface.style.transformOrigin = above ? "bottom center" : "top center";
  }

  function show(info) {
    if (dismissed) return;
    const sameSelection = activeInfo?.text === info.text && activeInfo.context === info.context
      && activeInfo.range.startContainer === info.range.startContainer && activeInfo.range.startOffset === info.range.startOffset
      && activeInfo.range.endContainer === info.range.endContainer && activeInfo.range.endOffset === info.range.endOffset;
    if (host.dataset.state === "result" && sameSelection) return;
    if (!sameSelection || host.dataset.state !== "actions") ++request;
    activeInfo = info;
    setVisible(result, false);
    setVisible(box, true);
    host.dataset.state = "actions";
    delete host.dataset.phase;
    place(box);
  }

  function scan() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const info = selectionInfo();
      if (info) show(info);
      else {
        dismissed = false;
        if (host.dataset.state === "actions" && !box.matches(":focus-within")) dismiss();
      }
    }, 120);
  }

  document.addEventListener("selectionchange", scan);
  document.addEventListener("pointerdown", (event) => {
    if (event.target !== host) dismiss();
  }, true);
  document.addEventListener("pointerup", (event) => {
    if (event.target !== host) dismissed = false;
  }, true);
  window.addEventListener("scroll", (event) => {
    if (event.target === host || host.dataset.state === "closed") return;
    place(host.dataset.state === "actions" ? box : result);
  }, true);
  window.addEventListener("resize", () => {
    if (host.dataset.state !== "closed") place(host.dataset.state === "actions" ? box : result);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && host.dataset.state !== "closed") {
      if (event.target === host) event.preventDefault();
      dismiss(true);
    } else if (event.key === "Enter" && host.dataset.state === "actions" && !box.matches(":focus-within") && !event.target.isContentEditable && !event.target.closest?.("input,textarea,select,button,a[href],summary,[role=button],[role=link]")) {
      event.preventDefault();
      void runExplain();
    }
  }, true);
  explainButton.addEventListener("click", () => void runExplain());

  function showError(message) {
    host.dataset.phase = "error";
    body.setAttribute("aria-busy", "false");
    const title = document.createElement("p");
    title.className = "error-title";
    title.textContent = "Could not explain this selection";
    const detail = document.createElement("p");
    detail.className = "error-text";
    detail.textContent = message;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Try again";
    retry.addEventListener("click", () => void runExplain());
    body.replaceChildren(title, detail, retry);
    place(result);
  }

  async function runExplain() {
    if (!activeInfo) return;
    clearTimeout(timer);
    const info = activeInfo;
    const current = ++request;
    host.dataset.state = "result";
    host.dataset.phase = "loading";
    quoteText.textContent = info.text.length > 320 ? `${info.text.slice(0, 320)}\u2026` : info.text;
    body.setAttribute("aria-busy", "true");
    const status = document.createElement("p");
    status.className = "status";
    status.setAttribute("role", "status");
    status.textContent = "Preparing your explanation\u2026";
    const skeleton = document.createElement("div");
    skeleton.className = "skeleton";
    skeleton.setAttribute("aria-hidden", "true");
    skeleton.innerHTML = "<span></span><span></span><span></span>";
    body.replaceChildren(status, skeleton);
    body.scrollTop = 0;
    setVisible(box, false);
    setVisible(result, true);
    place(result);
    try {
      const response = await api.runtime.sendMessage({ type: "explain", selection: info.text, context: info.context, title: document.title });
      if (current !== request) return;
      if (!response?.answer) {
        showError(response?.error || "No explanation was returned. Try again.");
        return;
      }
      host.dataset.phase = "answer";
      body.setAttribute("aria-busy", "false");
      const answer = document.createElement("p");
      answer.className = "answer";
      answer.textContent = response.answer;
      body.replaceChildren(answer);
      place(result);
    } catch {
      if (current !== request) return;
      showError("The extension could not connect. Enable Explain on this page again, then try again.");
    }
  }

  scan();
})();
