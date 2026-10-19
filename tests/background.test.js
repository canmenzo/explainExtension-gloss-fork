import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../extension/background.js", import.meta.url), "utf8");
const wasm = await readFile(new URL("../dist/chrome/core.wasm", import.meta.url));

function runtime(model = "gemini-3.8-flash", key = "test-key", response = { candidates: [{ content: { parts: [{ text: "A clear explanation." }] } }] }) {
  let listener;
  const sent = [];
  const stored = {};
  const api = {
    runtime: { onMessage: { addListener(fn) { listener = fn; } }, getURL(path) { return path; } },
    storage: { session: { async set(value) { Object.assign(stored, value); }, async get() { return key ? { geminiKey: key, geminiModel: model } : {}; } } },
    tabs: { async query() { return [{ id: 4 }]; } },
    scripting: { async executeScript(value) { sent.push(value); } },
  };
  const context = {
    globalThis: { chrome: api },
    WebAssembly,
    TextEncoder,
    TextDecoder,
    fetch: async (...args) => {
      if (args[0] === "core.wasm") return { async arrayBuffer() { return wasm; } };
      sent.push(args);
      return { ok: true, async json() { return response; } };
    },
  };
  vm.runInNewContext(source, context);
  return { handle: (message) => listener(message, {}), sent, stored };
}

test("enable-tab injects the content script into only the active tab", async () => {
  const app = runtime();
  assert.equal((await app.handle({ type: "enable-tab" })).ok, true);
  assert.equal(JSON.stringify(app.sent[0]), JSON.stringify({ target: { tabId: 4 }, files: ["content.js"] }));
});

test("Explain uses Rust WASM to prepare selected text and context for Gemini", async () => {
  const app = runtime();
  const result = await app.handle({ type: "explain", selection: "selected phrase", context: "nearby words", title: "Page" });
  assert.equal(result.answer, "A clear explanation.");
  assert.equal(app.sent[0][0], "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
  assert.equal(app.sent[0][1].headers["x-goog-api-key"], "test-key");
  assert.match(app.sent[0][1].body, /"maxOutputTokens":300/);
  assert.match(app.sent[0][1].body, /selected phrase/);
  assert.match(app.sent[0][1].body, /nearby words/);
});

test("missing key and invalid selection return clear errors without a request", async () => {
  const app = runtime("gemini-3.8-flash", "");
  assert.match((await app.handle({ type: "explain", selection: "word" })).error, /Google Gemini API key/);
  assert.match((await runtime().handle({ type: "explain", selection: "  " })).error, /Select some text/);
});

test("the selected Gemini Flash model is used", async () => {
  const app = runtime("gemini-3.5-flash-lite");
  assert.equal((await app.handle({ type: "explain", selection: "selected phrase" })).answer, "A clear explanation.");
  assert.equal(app.sent[0][0], "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
});

test("key storage is session-scoped", async () => {
  const app = runtime();
  assert.equal((await app.handle({ type: "save-key", key: "session-key", model: "gemini-3.5-flash" })).ok, true);
  assert.equal(app.stored.geminiKey, "session-key");
  assert.equal(app.stored.geminiModel, "gemini-3.5-flash");
});
