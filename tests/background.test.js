import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../extension/background.js", import.meta.url), "utf8");
const wasm = await readFile(new URL("../dist/chrome/core.wasm", import.meta.url));

function sse(...chunks) {
  return chunks.map((chunk) => `data: ${typeof chunk === "string" ? chunk : JSON.stringify(chunk)}\r\n\r\n`).join("");
}

const textChunk = (text, extra = {}) => ({ candidates: [{ content: { parts: [{ text }] }, ...extra }] });

function runtime({ model = "gemini-3.8-flash", key = "test-key", body = sse(textChunk("A clear "), textChunk("explanation.", { finishReason: "STOP" })), status = 200, failFrames = [] } = {}) {
  const listeners = {};
  const sent = [];
  const injected = [];
  const messages = [];
  const menus = [];
  const stored = {};
  let popupOpened = false;
  const event = (name) => ({ addListener(fn) { listeners[name] = fn; } });
  const api = {
    runtime: { onInstalled: event("installed"), onMessage: event("message"), onConnect: event("connect"), getURL(path) { return path; } },
    contextMenus: { onClicked: event("clicked"), async removeAll() { menus.length = 0; }, create(item) { menus.push(item); } },
    action: { async openPopup() { popupOpened = true; } },
    storage: { session: { async set(value) { Object.assign(stored, value); }, async get() { return key ? { geminiKey: key, geminiModel: model } : {}; } } },
    tabs: { async sendMessage(tabId, message, options) { messages.push({ tabId, message, options }); } },
    scripting: {
      async executeScript(value) {
        if (failFrames.includes(value.target.frameIds[0])) throw new Error("No access");
        injected.push(value);
      },
    },
  };
  const context = {
    globalThis: { chrome: api },
    WebAssembly,
    TextEncoder,
    TextDecoder,
    AbortController,
    fetch: async (...args) => {
      if (args[0] === "core.wasm") return { async arrayBuffer() { return wasm; } };
      sent.push(args);
      return new Response(body, { status });
    },
  };
  vm.runInNewContext(source, context);

  function explain(message) {
    return new Promise((resolve) => {
      const received = [];
      let onMessage;
      const port = {
        name: "explain",
        onDisconnect: { addListener() {} },
        onMessage: { addListener(fn) { onMessage = fn; } },
        postMessage(value) {
          received.push(value);
          if (value.done || value.error) resolve(JSON.parse(JSON.stringify(received)));
        },
      };
      listeners.connect(port);
      onMessage(message);
    });
  }

  return {
    listeners, sent, injected, messages, menus, stored, explain,
    get popupOpened() { return popupOpened; },
    handle: (message) => listeners.message(message, {}),
  };
}

test("install registers a selection-only Explain menu item", async () => {
  const app = runtime();
  await app.listeners.installed();
  assert.deepEqual(JSON.parse(JSON.stringify(app.menus)), [{ id: "explain-selection", title: "Explain", contexts: ["selection"] }]);
});

test("menu click injects the card into the clicked frame and sends the selection", async () => {
  const app = runtime();
  await app.listeners.clicked({ menuItemId: "explain-selection", selectionText: "obdurate", frameId: 3 }, { id: 7 });
  assert.equal(JSON.stringify(app.injected), JSON.stringify([{ target: { tabId: 7, frameIds: [3] }, files: ["content.js"] }]));
  assert.equal(JSON.stringify(app.messages), JSON.stringify([{ tabId: 7, message: { type: "explain", selection: "obdurate" }, options: { frameId: 3 } }]));
  assert.equal(app.popupOpened, false);
});

test("menu click falls back to the top frame and opens setup without a key", async () => {
  const app = runtime({ key: "", failFrames: [3] });
  await app.listeners.clicked({ menuItemId: "explain-selection", selectionText: "word", frameId: 3 }, { id: 7 });
  assert.equal(app.injected[0].target.frameIds[0], 0);
  assert.equal(app.messages[0].options.frameId, 0);
  assert.equal(app.popupOpened, true);
});

test("compiled Rust builds a streaming Gemini request and parses each chunk", async () => {
  const app = runtime();
  const received = await app.explain({ selection: "selected phrase", context: "nearby words", title: "Page" });
  assert.deepEqual(received, [{ text: "A clear " }, { text: "explanation." }, { done: true }]);
  assert.equal(app.sent[0][0], "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse");
  assert.equal(app.sent[0][1].headers["x-goog-api-key"], "test-key");
  const body = JSON.parse(app.sent[0][1].body);
  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "low");
  assert.match(body.contents[0].parts[0].text, /selected phrase/);
  assert.match(body.contents[0].parts[0].text, /nearby words/);
});

test("stream events split across network reads and thought parts are handled", async () => {
  const thought = { candidates: [{ content: { parts: [{ text: "planning", thought: true }, { text: "Visible" }] } }] };
  const app = runtime({ body: new ReadableStream({
    start(controller) {
      const text = sse(thought, textChunk(" answer."));
      controller.enqueue(new TextEncoder().encode(text.slice(0, 25)));
      controller.enqueue(new TextEncoder().encode(text.slice(25)));
      controller.close();
    },
  }) });
  assert.deepEqual(await app.explain({ selection: "word" }), [{ text: "Visible" }, { text: " answer." }, { done: true }]);
});

test("compiled Rust clips by Unicode characters and encodes hostile text as data", async () => {
  const hostile = "<img src=x onerror=alert(1)> \" 猫";
  const app = runtime({ model: "gemini-3.5-flash-lite" });
  await app.explain({ selection: hostile, context: "猫".repeat(6000) });
  const prompt = JSON.parse(app.sent[0][1].body).contents[0].parts[0].text;
  assert.ok(prompt.includes(hostile));
  assert.equal((prompt.split("\n\nSelected text:")[0].match(/猫/g) || []).length, 5000);
  assert.match(app.sent[0][0], /gemini-3\.5-flash-lite:streamGenerateContent/);
});

test("missing key and invalid selection return errors without a request", async () => {
  const app = runtime({ key: "" });
  assert.match((await app.explain({ selection: "word" }))[0].error, /Google Gemini API key/);
  assert.match((await runtime().explain({ selection: "  " }))[0].error, /Select some text/);
  assert.equal(app.sent.length, 0);
});

test("Rust parses provider, empty, blocked and malformed responses", async () => {
  assert.match((await runtime({ status: 403, body: "{}" }).explain({ selection: "word" }))[0].error, /rejected/);
  assert.match((await runtime({ status: 429, body: "{}" }).explain({ selection: "word" }))[0].error, /limit/);
  assert.match((await runtime({ body: sse("not JSON") }).explain({ selection: "word" }))[0].error, /unreadable/);
  assert.match((await runtime({ body: sse({ candidates: [{ finishReason: "MAX_TOKENS" }] }) }).explain({ selection: "word" }))[0].error, /no explanation/);
  assert.match((await runtime({ body: sse({ promptFeedback: { blockReason: "SAFETY" } }) }).explain({ selection: "word" }))[0].error, /declined/);
});

test("key storage is session-scoped", async () => {
  const app = runtime();
  assert.equal((await app.handle({ type: "save-key", key: "session-key", model: "gemini-3.6-flash" })).ok, true);
  assert.equal(app.stored.geminiKey, "session-key");
  assert.equal(app.stored.geminiModel, "gemini-3.6-flash");
});
