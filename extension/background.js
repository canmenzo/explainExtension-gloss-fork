const api = globalThis.browser ?? globalThis.chrome;
const DEFAULT_MODEL = "gemini-3.8-flash";
const MODELS = [DEFAULT_MODEL, "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
let corePromise;

api.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "save-key" && typeof message.key === "string") {
    const model = MODELS.includes(message.model) ? message.model : DEFAULT_MODEL;
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
  if (typeof message.selection !== "string") return { error: "Select some text first." };
  const { geminiKey, geminiModel = DEFAULT_MODEL } = await api.storage.session.get(["geminiKey", "geminiModel"]);
  if (!geminiKey) return { error: "Add your Google Gemini API key in the Explain extension menu." };
  const core = await loadCore();
  const selectionBytes = new TextEncoder().encode(message.selection);
  const selectionPointer = core.allocate(selectionBytes.length) >>> 0;
  new Uint8Array(core.memory.buffer).set(selectionBytes, selectionPointer);
  const valid = core.selection_is_valid(selectionPointer, selectionBytes.length);
  core.release(selectionPointer, selectionBytes.length);
  if (!valid) return { error: "Select some text first." };
  const encoder = new TextEncoder();
  const inputs = [
    encoder.encode(typeof message.title === "string" ? message.title : ""),
    encoder.encode(typeof message.context === "string" ? message.context : ""),
    selectionBytes,
  ];
  const pointers = inputs.map((bytes) => core.allocate(bytes.length) >>> 0);
  const capacity = 80000;
  const outputPointer = core.allocate(capacity) >>> 0;
  let prompt;
  try {
    inputs.forEach((bytes, index) => new Uint8Array(core.memory.buffer).set(bytes, pointers[index]));
    const length = core.build_prompt(pointers[0], inputs[0].length, pointers[1], inputs[1].length, pointers[2], inputs[2].length, outputPointer, capacity);
    if (!length) return { error: "Select some text first." };
    prompt = new TextDecoder().decode(new Uint8Array(core.memory.buffer, outputPointer, length));
  } finally {
    pointers.forEach((pointer, index) => core.release(pointer, inputs[index].length));
    core.release(outputPointer, capacity);
  }
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 300 } }),
    });
    const body = await response.json();
    if (!response.ok) return { error: response.status === 401 || response.status === 403 ? "Google rejected this key. Check that it is a Gemini API key." : response.status === 429 ? "Google rate or usage limit reached. Try again later." : body.error?.message || `Google Gemini returned ${response.status}.` };
    const answer = body.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
    return typeof answer === "string" && answer.trim() ? { answer: answer.trim() } : { error: "Google Gemini returned no explanation." };
  } catch {
    return { error: "Could not reach Google Gemini. Check your connection and try again." };
  }
}

function loadCore() {
  corePromise ??= fetch(api.runtime.getURL("core.wasm"))
    .then((response) => response.arrayBuffer())
    .then((bytes) => WebAssembly.instantiate(bytes, {}))
    .then(({ instance }) => instance.exports);
  return corePromise;
}
