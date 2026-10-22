import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../extension/background.js", import.meta.url), "utf8");
const wasm = await readFile(new URL("../dist/chrome/core.wasm", import.meta.url));

function runtime(model = "gemini-3.8-flash", key = "test-key", response = { candidates: [{ content: { parts: [{ text: "A clear explanation." }] } }] }, status = 200) {
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
      return { ok: status >= 200 && status < 300, status, async text() { return typeof response === "string" ? response : JSON.stringify(response); } };
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

test("compiled Rust builds Gemini request and parses Gemini response", async () => {
  const app = runtime("gemini-3.8-flash", "test-key", { candidates: [{ content: { parts: [{ text: "A clear " }, { text: "explanation." }] } }] });
  const result = await app.handle({ type: "explain", selection: "selected phrase", context: "nearby words", title: "Page" });
  assert.equal(result.answer, "A clear explanation.");
  assert.equal(app.sent[0][0], "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
  assert.equal(app.sent[0][1].headers["x-goog-api-key"], "test-key");
  const body = JSON.parse(app.sent[0][1].body);
  assert.equal(body.generationConfig.maxOutputTokens, 300);
  assert.match(body.contents[0].parts[0].text, /selected phrase/);
  assert.match(body.contents[0].parts[0].text, /nearby words/);
});

test("compiled Rust clips by Unicode characters and encodes hostile text as data", async () => {
  const hostile = "<img src=x onerror=alert(1)> \" \u732b";
  const app = runtime("gemini-3.5-flash-lite");
  assert.equal((await app.handle({ type: "explain", selection: hostile, context: "猫".repeat(6000) })).answer, "A clear explanation.");
  const body = JSON.parse(app.sent[0][1].body);
  const prompt = body.contents[0].parts[0].text;
  assert.ok(prompt.includes(hostile));
  assert.equal((prompt.split("\n\nSelected text:")[0].match(/猫/g) || []).length, 5000);
  assert.equal(app.sent[0][0], "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
});

test("missing key and invalid selection return errors without a request", async () => {
  const app = runtime("gemini-3.8-flash", "");
  assert.match((await app.handle({ type: "explain", selection: "word" })).error, /Google Gemini API key/);
  assert.match((await runtime().handle({ type: "explain", selection: "  " })).error, /Select some text/);
  assert.equal(app.sent.some((item) => Array.isArray(item)), false);
});

test("Rust parses provider authentication, quota and malformed response errors", async () => {
  assert.match((await runtime("gemini-3.8-flash", "test-key", {}, 403).handle({ type: "explain", selection: "word" })).error, /rejected/);
  assert.match((await runtime("gemini-3.8-flash", "test-key", {}, 429).handle({ type: "explain", selection: "word" })).error, /limit/);
  assert.match((await runtime("gemini-3.8-flash", "test-key", "not JSON").handle({ type: "explain", selection: "word" })).error, /unreadable/);
});

test("key storage is session-scoped", async () => {
  const app = runtime();
  assert.equal((await app.handle({ type: "save-key", key: "session-key", model: "gemini-3.6-flash" })).ok, true);
  assert.equal(app.stored.geminiKey, "session-key");
  assert.equal(app.stored.geminiModel, "gemini-3.6-flash");
});
