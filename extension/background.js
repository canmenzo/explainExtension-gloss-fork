const api = globalThis.browser ?? globalThis.chrome;
const DEFAULT_MODEL = "gemini-3.8-flash";
let corePromise;

api.runtime.onMessage.addListener((message) => {
  if (message?.type === "save-key" && typeof message.key === "string") {
    const model = typeof message.model === "string" ? message.model : DEFAULT_MODEL;
    return api.storage.session.set({ geminiKey: message.key, geminiModel: model }).then(() => ({ ok: true }));
  }
  if (message?.type === "enable-tab") return enableTab();
  if (message?.type === "explain") return explain(message);
});

async function enableTab() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { error: "No active page." };
  try {
    await api.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    return { ok: true };
  } catch {
    return { error: "This page does not allow extensions." };
  }
}

async function explain(message) {
  const core = await loadCore();
  const selection = typeof message.selection === "string" ? message.selection : "";
  const state = core.transition(0, 1);
  if (!state || !core.isValidSelection(selection)) return { error: "Select some text first." };
  const requesting = core.transition(state, 2);
  if (requesting !== 2) return { error: "Select some text first." };
  const { geminiKey, geminiModel = DEFAULT_MODEL } = await api.storage.session.get(["geminiKey", "geminiModel"]);
  if (!geminiKey) {
    core.transition(requesting, 4);
    return { error: "Add your Google Gemini API key in the Explain extension menu." };
  }
  let request;
  try {
    request = core.buildRequest(
      geminiModel,
      typeof message.title === "string" ? message.title : "",
      typeof message.context === "string" ? message.context : "",
      selection,
    );
  } catch {
    core.transition(requesting, 4);
    return { error: "Could not prepare this explanation." };
  }
  if (request.error) {
    core.transition(requesting, 4);
    return request;
  }
  const { model, ...body } = request;
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
      body: JSON.stringify(body),
    });
    const result = core.parseResponse(response.status, await response.text());
    core.transition(requesting, result.answer ? 3 : 4);
    return result;
  } catch {
    core.transition(requesting, 4);
    return { error: "Could not reach Google Gemini. Check your connection and try again." };
  }
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
  };
}
