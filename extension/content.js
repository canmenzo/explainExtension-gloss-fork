(() => {
  if (globalThis.explainListening) return;
  globalThis.explainListening = true;

  const api = globalThis.browser ?? globalThis.chrome;
  // A reloaded extension injects into a fresh world; drop the card the old one left behind.
  document.querySelectorAll("[data-explain-host]").forEach((node) => node.remove());
  const host = document.createElement("div");
  host.dataset.explainHost = "";
  host.setAttribute("aria-label", "Explain selection");
  host.dataset.state = "closed";
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host{all:initial}
    *{box-sizing:border-box}
    .card{position:fixed;display:flex;flex-direction:column;width:340px;max-width:calc(100vw - 24px);max-height:min(360px,calc(100vh - 24px));overflow:hidden;background:#FFF;color:#1F2937;color-scheme:light;font:14px/1.6 ui-sans-serif,system-ui,sans-serif;border-radius:16px;box-shadow:0 0 0 1px #0F172A0F,0 2px 6px #0F172A0A,0 16px 40px #0F172A1A;pointer-events:auto;opacity:0;transform:translateY(4px) scale(.98);transition:opacity 150ms cubic-bezier(.22,1,.36,1),transform 150ms cubic-bezier(.22,1,.36,1)}
    .card.is-open{opacity:1;transform:none;transition-duration:250ms}
    .card[hidden]{display:none}
    .header{display:flex;align-items:center;gap:8px;flex-shrink:0;padding:10px 8px 6px 14px}
    .mark{display:inline-grid;place-items:center;flex-shrink:0;width:22px;height:22px;border-radius:7px;background:linear-gradient(160deg,#4B76C8,#315DAD);color:#FFF;font-size:14px;font-weight:600;line-height:1}
    .title{flex:1;min-width:0;margin:0;overflow:hidden;color:#6B7686;font-size:12px;font-weight:500;line-height:20px;white-space:nowrap;text-overflow:ellipsis}
    button{appearance:none;border:0;font:600 13px/1 ui-sans-serif,system-ui,sans-serif;cursor:pointer;transition:background-color 150ms ease-out,color 150ms ease-out,transform 150ms ease-out}
    button:active{transform:scale(.96)}button:focus-visible{outline:none;box-shadow:0 0 0 3px #315DAD29}
    .close{display:grid;place-items:center;flex-shrink:0;width:28px;height:28px;padding:0;border-radius:8px;background:transparent;color:#6B7686}.close:hover{background:#EDF2FC;color:#1F2937}
    .close svg{width:14px;height:14px;stroke:currentColor;stroke-width:1.6;fill:none}
    .body{min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:2px 16px 14px;scrollbar-width:thin;scrollbar-color:#CDD6E4 transparent}
    .body:focus-visible{outline:none;box-shadow:inset 0 0 0 2px #315DAD29}
    .answer{margin:0;color:#1F2937;font-size:14px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}
    .answer span{animation:fade 250ms cubic-bezier(.22,1,.36,1)}
    .caret{display:inline-block;width:2px;height:1em;margin-left:2px;border-radius:1px;vertical-align:-2px;background:#315DAD;animation:blink 1s steps(2,start) infinite}
    .thinking{display:flex;align-items:center;gap:10px;margin:0;color:#6B7686;font-size:13px;line-height:22px}
    .dots{display:inline-flex;gap:4px}.dots i{width:5px;height:5px;border-radius:50%;background:#8AA6DB;animation:pulse 1.2s ease-in-out infinite}.dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}
    .error-text{margin:0 0 12px;color:#B0444B;font-size:13px;line-height:1.5;overflow-wrap:anywhere}
    .retry{padding:9px 14px;border-radius:10px;background:#EDF2FC;color:#315DAD}.retry:hover{background:#E1E9F9}
    @keyframes fade{from{opacity:0}}
    @keyframes blink{to{visibility:hidden}}
    @keyframes pulse{0%,100%{opacity:.35;transform:scale(.85)}50%{opacity:1;transform:none}}
    @media(prefers-reduced-motion:reduce){.card{transition:none;transform:none}.answer span,.caret,.dots i{animation:none}button:active{transform:none}}
  `;
  const card = document.createElement("section");
  card.className = "card";
  card.setAttribute("aria-label", "Explanation");
  card.hidden = true;
  card.inert = true;
  const header = document.createElement("div");
  header.className = "header";
  header.innerHTML = '<span class="mark" aria-hidden="true">e</span>';
  const title = document.createElement("p");
  title.className = "title";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "close";
  close.setAttribute("aria-label", "Dismiss explanation");
  close.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg>';
  close.addEventListener("click", () => dismiss());
  header.append(title, close);
  const body = document.createElement("div");
  body.className = "body";
  body.tabIndex = 0;
  body.setAttribute("aria-live", "polite");
  body.setAttribute("aria-label", "Explanation text");
  card.append(header, body);
  shadow.append(style, card);
  document.documentElement.append(host);

  let port;
  let payload;
  let range;
  let side;
  let hideTimer;

  function capture(fallback) {
    const selection = getSelection();
    const text = (selection?.toString().trim() || fallback.trim()).slice(0, 12000);
    if (!text) return null;
    range = selection?.rangeCount && !selection.isCollapsed ? selection.getRangeAt(0).cloneRange() : null;
    const node = range?.commonAncestorContainer;
    const element = (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement) ?? document.activeElement;
    const block = element?.closest?.("p,li,blockquote,pre,h1,h2,h3,h4,h5,h6,td,th,dd,figcaption");
    const nearby = block?.innerText || (typeof element?.value === "string" ? element.value : element?.innerText);
    return { selection: text, context: (nearby || text).slice(0, 5000), title: document.title };
  }

  function anchorRect() {
    const rect = range?.getBoundingClientRect();
    if (rect && (rect.width || rect.height)) return rect;
    const active = document.activeElement;
    return active && active !== document.body && active !== document.documentElement ? active.getBoundingClientRect() : null;
  }

  function place() {
    if (host.dataset.state === "closed") return;
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    const anchor = anchorRect();
    let left = (innerWidth - width) / 2;
    let top = 24;
    if (anchor) {
      left = anchor.left + anchor.width / 2 - width / 2;
      side ??= anchor.bottom + 10 + height <= innerHeight - 12 || anchor.top - 10 < innerHeight / 2 ? "below" : "above";
      top = side === "below" ? anchor.bottom + 10 : anchor.top - height - 10;
    }
    card.style.left = `${Math.max(12, Math.min(innerWidth - width - 12, left))}px`;
    card.style.top = `${Math.max(12, Math.min(innerHeight - height - 12, top))}px`;
    host.dataset.placement = side ?? "center";
  }

  function open() {
    clearTimeout(hideTimer);
    card.inert = false;
    card.removeAttribute("aria-hidden");
    if (card.hidden) {
      card.hidden = false;
      void card.offsetWidth;
    }
    card.classList.add("is-open");
    host.dataset.state = "open";
  }

  function dismiss() {
    port?.disconnect();
    port = null;
    if (host.dataset.state === "closed") return;
    host.dataset.state = "closed";
    delete host.dataset.phase;
    card.inert = true;
    card.setAttribute("aria-hidden", "true");
    card.classList.remove("is-open");
    hideTimer = setTimeout(() => {
      card.hidden = true;
    }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 150);
  }

  function showError(message) {
    port?.disconnect();
    port = null;
    host.dataset.phase = "error";
    body.setAttribute("aria-busy", "false");
    const text = document.createElement("p");
    text.className = "error-text";
    text.textContent = message;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "retry";
    retry.textContent = "Try again";
    retry.addEventListener("click", run);
    body.replaceChildren(text, retry);
    place();
  }

  function run() {
    port?.disconnect();
    host.dataset.phase = "loading";
    body.setAttribute("aria-busy", "true");
    const thinking = document.createElement("p");
    thinking.className = "thinking";
    thinking.setAttribute("role", "status");
    thinking.innerHTML = '<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>';
    thinking.append("Reading the passage…");
    body.replaceChildren(thinking);
    body.scrollTop = 0;
    open();
    place();
    let answer;
    let caret;
    const current = api.runtime.connect({ name: "explain" });
    port = current;
    current.onMessage.addListener((message) => {
      if (current !== port) return;
      if (message.error) return showError(message.error);
      if (message.text) {
        if (!answer) {
          answer = document.createElement("p");
          answer.className = "answer";
          caret = document.createElement("i");
          caret.className = "caret";
          caret.setAttribute("aria-hidden", "true");
          answer.append(caret);
          body.replaceChildren(answer);
          host.dataset.phase = "streaming";
        }
        const following = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
        const piece = document.createElement("span");
        piece.textContent = message.text;
        caret.before(piece);
        if (following) body.scrollTop = body.scrollHeight;
        place();
      }
      if (message.done) {
        current.disconnect();
        port = null;
        answer.textContent = answer.textContent.trim();
        host.dataset.phase = "done";
        body.setAttribute("aria-busy", "false");
        place();
      }
    });
    current.onDisconnect.addListener(() => {
      if (current === port) showError("The extension stopped responding. Try again.");
    });
    current.postMessage(payload);
  }

  api.runtime.onMessage.addListener((message) => {
    if (message?.type !== "explain") return;
    const next = capture(typeof message.selection === "string" ? message.selection : "");
    if (!next) return;
    payload = next;
    side = undefined;
    title.textContent = `“${next.selection.replace(/\s+/g, " ")}”`;
    run();
  });

  document.addEventListener("pointerdown", (event) => {
    if (!event.composedPath().includes(host)) dismiss();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && host.dataset.state !== "closed") dismiss();
  }, true);
  window.addEventListener("scroll", place, true);
  window.addEventListener("resize", place);
})();
