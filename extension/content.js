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
    :host{all:initial;color:#27251f;font:13px/1.45 ui-sans-serif,system-ui,sans-serif}
    *{box-sizing:border-box}
    .box{position:fixed;display:flex;align-items:center;gap:5px;max-width:calc(100vw - 24px);padding:4px;border:1px solid #e2ddd3;border-radius:11px;background:#fffdf8;box-shadow:0 5px 22px #18140e2a;pointer-events:auto;transform-origin:top center}
    button{appearance:none;min-height:34px;border:0;border-radius:7px;padding:0 11px;background:#5c4937;color:#fffdf8;font:600 12px ui-sans-serif,system-ui,sans-serif;cursor:pointer}
    button:hover{background:#473827}button:focus-visible{outline:2px solid #9c4f3c;outline-offset:2px}
    .close{width:32px;padding:0;background:transparent;color:#6d675e;font-size:17px}.close:hover{background:#f0ece4;color:#27251f}
    .result{position:fixed;width:min(360px,calc(100vw - 24px));padding:13px 14px;border:1px solid #e2ddd3;border-radius:11px;background:#fffdf8;box-shadow:0 5px 22px #18140e2a;pointer-events:auto;color:#363128;font:14px/1.55 Georgia,serif;white-space:pre-wrap;overflow-wrap:anywhere}
    .result[hidden],.box[hidden]{display:none}.result p{margin:0}.result .state{color:#777168;font:12px/1.45 ui-sans-serif,system-ui,sans-serif}
    @media(prefers-reduced-motion:no-preference){.box,.result{animation:appear .12s ease-out}@keyframes appear{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}}
  `;
  const box = document.createElement("div");
  box.className = "box";
  box.setAttribute("role", "toolbar");
  box.setAttribute("aria-label", "Explain selected text");
  box.hidden = true;
  const explainButton = document.createElement("button");
  explainButton.type = "button";
  explainButton.textContent = "Explain";
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "close";
  closeButton.textContent = "×";
  closeButton.setAttribute("aria-label", "Dismiss Explain");
  box.append(explainButton, closeButton);
  const result = document.createElement("div");
  result.className = "result";
  result.setAttribute("role", "status");
  result.setAttribute("aria-live", "polite");
  result.hidden = true;
  shadow.append(style, box, result);
  document.documentElement.append(host);

  let timer;
  let quote = "";
  let dismissed = false;
  let request = 0;

  function selectionInfo() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const text = selection.toString().trim();
    if (!text || text.length > 12000) return null;
    const range = selection.getRangeAt(0);
    if (!document.contains(range.commonAncestorContainer)) return null;
    const block = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer.closest("p,li,blockquote,pre,h1,h2,h3,h4,h5,h6,td,th")
      : range.commonAncestorContainer.parentElement?.closest("p,li,blockquote,pre,h1,h2,h3,h4,h5,h6,td,th");
    const context = (block?.innerText || range.commonAncestorContainer.parentElement?.innerText || text).slice(0, 5000);
    return { text, context, rect: range.getBoundingClientRect() };
  }

  function place(info) {
    const width = box.offsetWidth || 105;
    const height = box.offsetHeight || 42;
    const left = Math.min(innerWidth - width - 12, Math.max(12, info.rect.left + info.rect.width / 2 - width / 2));
    const above = info.rect.top - height - 10 >= 8;
    const top = above ? info.rect.top - height - 10 : Math.min(innerHeight - height - 8, info.rect.bottom + 10);
    box.style.left = `${left}px`;
    box.style.top = `${Math.max(8, top)}px`;
  }

  function show(info) {
    if (dismissed) return;
    quote = info.text;
    result.hidden = true;
    box.hidden = false;
    host.dataset.state = "actions";
    place(info);
  }

  function scan() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const info = selectionInfo();
      if (info) show(info);
      else if (!box.matches(":focus-within") && result.hidden) box.hidden = true;
      if (box.hidden && result.hidden) host.dataset.state = "closed";
    }, 120);
  }

  document.addEventListener("selectionchange", scan);
  document.addEventListener("pointerdown", (event) => {
    if (!host.contains(event.target)) {
      dismissed = false;
      result.hidden = true;
      box.hidden = true;
      host.dataset.state = "closed";
    }
  }, true);
  document.addEventListener("pointerup", (event) => {
    if (!host.contains(event.target)) dismissed = false;
  }, true);
  window.addEventListener("scroll", () => {
    const info = selectionInfo();
    if (info && !box.hidden) place(info);
    else if (!result.hidden) result.hidden = true;
  }, true);
  window.addEventListener("resize", () => {
    const info = selectionInfo();
    if (info && !box.hidden) place(info);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && (!box.hidden || !result.hidden)) {
      dismissed = true;
      box.hidden = true;
      result.hidden = true;
      host.dataset.state = "closed";
      window.getSelection()?.removeAllRanges();
    } else if (event.key === "Enter" && !box.hidden && !box.matches(":focus-within")) {
      event.preventDefault();
      void runExplain();
    }
  }, true);
  closeButton.addEventListener("click", () => {
    dismissed = true;
    box.hidden = true;
    result.hidden = true;
    window.getSelection()?.removeAllRanges();
  });
  explainButton.addEventListener("click", () => void runExplain());

  async function runExplain() {
    const info = selectionInfo();
    const selected = info?.text || quote;
    if (!selected) return;
    const current = ++request;
    box.hidden = true;
    result.hidden = false;
    host.dataset.state = "result";
    result.textContent = "";
    const state = document.createElement("p");
    state.className = "state";
    state.textContent = "Preparing explanation…";
    result.append(state);
    try {
      const response = await api.runtime.sendMessage({ type: "explain", selection: selected, context: info?.context, title: document.title });
      if (current !== request) return;
      result.replaceChildren();
      const paragraph = document.createElement("p");
      paragraph.textContent = response?.answer || response?.error || "No explanation was returned.";
      result.append(paragraph);
    } catch {
      if (current !== request) return;
      result.replaceChildren();
      const paragraph = document.createElement("p");
      paragraph.className = "state";
      paragraph.textContent = "The extension could not reach its background service. Try enabling it on this page again.";
      result.append(paragraph);
    }
  }

  scan();
})();
