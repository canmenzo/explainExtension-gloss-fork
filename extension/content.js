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
    .card{--ink:#1B2230;--ink-2:#3A4456;--muted:#6B7586;--line:#0F172A10;--blue:#315DAD;--ease:cubic-bezier(.22,1,.36,1);
      position:fixed;display:flex;flex-direction:column;width:360px;max-width:calc(100vw - 24px);max-height:min(400px,calc(100vh - 24px));overflow:hidden;
      background:#FFF;color:var(--ink);color-scheme:light;font:14px/22px ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;
      border-radius:14px;box-shadow:0 0 0 1px #0F172A12,0 2px 4px #0F172A0A,0 12px 32px -8px #0F172A2E,0 28px 56px -20px #0F172A24;
      pointer-events:auto;opacity:0;transform:translateY(4px) scale(.98);transform-origin:50% 0;
      transition:opacity 150ms var(--ease),transform 150ms var(--ease)}
    :host([data-placement="above"]) .card{transform-origin:50% 100%}
    :host([data-placement="above"]) .card:not(.is-open){transform:translateY(-4px) scale(.98)}
    .card.is-open{opacity:1;transform:none;transition-duration:220ms}
    .card[hidden]{display:none}
    .header{display:flex;align-items:flex-start;gap:10px;flex-shrink:0;padding:12px 10px 11px 14px;border-bottom:1px solid var(--line)}
    .mark{display:grid;place-items:center;flex-shrink:0;width:22px;height:22px;border-radius:7px;background:linear-gradient(165deg,#4A77C9,#315DAD 70%);box-shadow:inset 0 1px 0 #FFFFFF38;color:#FFF;font-size:13.5px;font-weight:600;line-height:1;padding-bottom:1px}
    .title{flex:1;min-width:0;margin:0;padding-top:2px;color:var(--ink-2);font-size:13px;font-weight:600;line-height:18px;letter-spacing:-.003em;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow-wrap:anywhere}
    button{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;margin:0;border:0;background:none;color:inherit;font:inherit;cursor:pointer;
      transition:background-color 150ms var(--ease),color 150ms var(--ease),box-shadow 150ms var(--ease),transform 150ms var(--ease)}
    button:active{transform:scale(.96)}
    button:focus-visible,.body:focus-visible{outline:none;box-shadow:0 0 0 3px #315DAD33}
    svg{fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round}
    .close{flex-shrink:0;width:28px;height:28px;margin:-3px 0 -3px;padding:0;border-radius:8px;color:var(--muted)}
    .close:hover{background:#F0F2F6;color:var(--ink)}
    .close svg{width:12px;height:12px;stroke-width:1.75}
    .body{min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:12px 16px 16px;scrollbar-width:thin;scrollbar-color:#CDD5E1 transparent}
    .body:focus-visible{box-shadow:inset 0 0 0 2px #315DAD33}
    .answer{margin:0;color:var(--ink);white-space:pre-wrap;overflow-wrap:anywhere;text-wrap:pretty}
    .skeleton{display:grid;gap:12px;padding:6px 0}
    .skeleton i{display:block;height:10px;border-radius:5px;background:linear-gradient(90deg,#EEF1F6 0,#E1E6EE 40%,#EEF1F6 80%) 0 0/300% 100%;animation:shimmer 1.4s ease-in-out infinite}
    .skeleton i:nth-child(2){width:92%}.skeleton i:nth-child(3){width:58%}
    .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
    .error{display:flex;gap:10px;margin:0;color:var(--ink-2);font-size:13.5px;line-height:20px;overflow-wrap:anywhere}
    .error svg{flex-shrink:0;width:16px;height:16px;margin-top:2px;color:#B0414A;stroke-width:1.6}
    .retry{height:32px;margin:12px 0 0 26px;padding:0 12px 0 10px;border-radius:8px;background:#EDF2FB;color:var(--blue);font-size:13px;font-weight:600}
    .retry:hover{background:#E1E9F8}
    .retry svg{width:14px;height:14px;stroke-width:1.75}
    @keyframes shimmer{from{background-position:100% 0}to{background-position:0 0}}
    @media(prefers-reduced-motion:reduce){.card,:host([data-placement="above"]) .card:not(.is-open){transition:none;transform:none}.skeleton i{animation:none}button:active{transform:none}}
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
  close.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="m2 2 8 8M10 2l-8 8"/></svg>';
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
    const nearby = block?.innerText || (typeof element?.value === "string" && element.type !== "password" ? element.value : element?.innerText);
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
    text.className = "error";
    text.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25"/><path d="M8 4.9v3.4M8 10.9v.1"/></svg>';
    text.append(message);
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "retry";
    retry.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.25 8a5.25 5.25 0 1 1-1.54-3.71M13.25 2.75v3h-3"/></svg>Try again';
    retry.addEventListener("click", run);
    body.replaceChildren(text, retry);
    place();
  }

  // Each new character fades in from violet through pink to the text color, paced evenly
  // (at most 90 a second, and any burst clears within half a second). After CreatorHive/bridle (MIT).
  const FADE = 900;
  const TINT = [
    { offset: 0, opacity: 0, color: "color-mix(in oklab, #8B5CF6 65%, #1B2230)" },
    { offset: 0.35, opacity: 1 },
    { offset: 0.4, color: "color-mix(in oklab, #EC4899 55%, #1B2230)" },
    { offset: 1, opacity: 1, color: "#1B2230" },
  ];
  const segmenter = "Segmenter" in Intl ? new Intl.Segmenter() : null;

  function run() {
    port?.disconnect();
    host.dataset.phase = "loading";
    body.setAttribute("aria-busy", "true");
    const thinking = document.createElement("div");
    thinking.className = "skeleton";
    thinking.setAttribute("role", "status");
    thinking.innerHTML = '<i></i><i></i><i></i><span class="sr">Explaining…</span>';
    body.replaceChildren(thinking);
    body.scrollTop = 0;
    open();
    place();
    let answer;
    let held = "";
    let last = 0;
    const reveal = (text) => {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return answer.append(text);
      const chars = segmenter ? Array.from(segmenter.segment(text), (part) => part.segment) : Array.from(text);
      const step = Math.min(1000 / 90, 500 / chars.length);
      last = Math.max(performance.now(), last);
      for (const char of chars) {
        const span = document.createElement("span");
        span.textContent = char;
        answer.append(span);
        // Started on the document timeline at its own arrival time, so later chunks never restart it.
        const fade = span.animate(TINT, { duration: FADE, fill: "both" });
        fade.startTime = last += step;
        fade.onfinish = () => span.replaceWith(char);
      }
    };
    const current = api.runtime.connect({ name: "explain" });
    port = current;
    current.onMessage.addListener((message) => {
      if (current !== port) return;
      if (message.error) return showError(message.error);
      // Trailing whitespace waits for the next chunk, so the answer never ends on a blank line.
      let text = held + (message.text ?? "");
      if (!answer) text = text.trimStart();
      held = text.match(/\s*$/)[0];
      text = text.slice(0, text.length - held.length);
      if (text) {
        if (!answer) {
          answer = document.createElement("p");
          answer.className = "answer";
          body.replaceChildren(answer);
          host.dataset.phase = "streaming";
        }
        const following = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
        reveal(text);
        if (following) body.scrollTop = body.scrollHeight;
        place();
      }
      if (message.done) {
        current.disconnect();
        port = null;
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
    title.textContent = next.selection.replace(/\s+/g, " ");
    title.title = title.textContent.slice(0, 500);
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
