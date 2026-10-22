const api = globalThis.browser ?? globalThis.chrome;
const MODEL = "gemini-3.8-flash";
const MENU_ID = "explain-selection";
let corePromise;

api.runtime.onInstalled.addListener(() => api.contextMenus.removeAll().then(() => {
  api.contextMenus.create({ id: MENU_ID, title: "Explain", contexts: ["selection"] });
}));

api.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || tab?.id === undefined) return;
  const { geminiKey } = await api.storage.session.get("geminiKey");
  if (!geminiKey) api.action.openPopup?.()?.catch(() => {});
  const message = { type: "explain", selection: info.selectionText ?? "" };
  // Selections inside cross-origin frames are outside activeTab, so fall back to the top frame.
  for (const frameId of new Set([info.frameId ?? 0, 0])) {
    try {
      await api.scripting.executeScript({ target: { tabId: tab.id, frameIds: [frameId] }, files: ["content.js"] });
      await api.tabs.sendMessage(tab.id, message, { frameId });
      return;
    } catch {}
  }
});

api.runtime.onMessage.addListener((message) => {
  if (message?.type === "save-key" && typeof message.key === "string") {
    return api.storage.session.set({ geminiKey: message.key }).then(() => ({ ok: true }));
  }
});

api.runtime.onConnect.addListener((port) => {
  if (port.name !== "explain") return;
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener((message) => {
    const send = (value) => {
      if (!controller.signal.aborted) port.postMessage(value);
    };
    stream(message, send, controller.signal).catch(() => {
      send({ error: "Could not reach Google Gemini. Check your connection and try again." });
    });
  });
});

async function stream(message, send, signal) {
  const core = await loadCore();
  const selection = typeof message?.selection === "string" ? message.selection : "";
  const state = core.transition(0, 1);
  if (!state || !core.isValidSelection(selection)) return send({ error: "Select some text first." });
  const requesting = core.transition(state, 2);
  const fail = (error) => {
    core.transition(requesting, 4);
    send({ error });
  };
  const { geminiKey } = await api.storage.session.get("geminiKey");
  if (!geminiKey) return fail("Add your Google Gemini API key first. Click the Explain icon in your toolbar.");
  const request = core.buildRequest(
    MODEL,
    typeof message.title === "string" ? message.title : "",
    typeof message.context === "string" ? message.context : "",
    selection,
  );
  if (request.error) return fail(request.error);
  const { model, ...body } = request;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) return fail(core.parseResponse(response.status, await response.text()).error);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answered = false;
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = done ? "" : events.pop();
    for (const event of events) {
      const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
      if (!data) continue;
      const chunk = core.parseChunk(data);
      if (chunk.error) return fail(chunk.error);
      if (chunk.text) {
        answered = true;
        send({ text: chunk.text });
      }
    }
    if (done) break;
  }
  if (!answered) return fail("Google Gemini returned no explanation. Try again.");
  core.transition(requesting, 3);
  send({ done: true });
}

function loadCore() {
  corePromise ??= fetch(api.runtime.getURL("core.wasm"))
    .then((response) => response.arrayBuffer())
    .then((bytes) => WebAssembly.instantiate(bytes, {}))
    .then(({ instance }) => makeCore(instance.exports));
  return corePromise;
}

function makeCore(wasm) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function invokeJson(name, prefix, values) {
    const encoded = values.map((value) => encoder.encode(value));
    const pointers = encoded.map((bytes) => wasm.allocate(bytes.length) >>> 0);
    const capacity = 100000;
    const output = wasm.allocate(capacity) >>> 0;
    try {
      encoded.forEach((bytes, index) => new Uint8Array(wasm.memory.buffer).set(bytes, pointers[index]));
      const args = prefix.concat(pointers.flatMap((pointer, index) => [pointer, encoded[index].length]), [output, capacity]);
      const length = wasm[name](...args);
      return JSON.parse(decoder.decode(new Uint8Array(wasm.memory.buffer, output, length)));
    } finally {
      pointers.forEach((pointer, index) => wasm.release(pointer, encoded[index].length));
      wasm.release(output, capacity);
    }
  }

  return {
    transition: wasm.transition,
    isValidSelection(text) {
      const bytes = encoder.encode(text);
      const pointer = wasm.allocate(bytes.length) >>> 0;
      try {
        new Uint8Array(wasm.memory.buffer).set(bytes, pointer);
        return wasm.selection_is_valid(pointer, bytes.length) === 1;
      } finally {
        wasm.release(pointer, bytes.length);
      }
    },
    buildRequest(model, title, context, selection) {
      return invokeJson("build_request", [], [model, title, context, selection]);
    },
    parseResponse(status, body) {
      return invokeJson("parse_response", [status], [body]);
    },
    parseChunk(data) {
      return invokeJson("parse_chunk", [], [data]);
    },
  };
}
