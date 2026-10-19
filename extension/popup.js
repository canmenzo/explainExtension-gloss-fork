const api = globalThis.browser ?? globalThis.chrome;
const status = document.querySelector("#status");
const input = document.querySelector("#api-key");
const model = document.querySelector("#model");

api.storage.session.get("geminiModel").then((value) => {
  if (value.geminiModel) model.value = value.geminiModel;
});

document.querySelector("#enable").addEventListener("click", async () => {
  status.textContent = "Enabling this tab…";
  const result = await api.runtime.sendMessage({ type: "enable-tab" });
  status.textContent = result?.ok ? "Ready. Select text on the page." : result?.error || "This page cannot run the extension.";
});

document.querySelector("#key-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const key = input.value.trim();
  if (!key) return;
  const result = await api.runtime.sendMessage({ type: "save-key", key, model: model.value });
  status.textContent = result?.ok ? "Key saved for this browser session." : "Could not save the key for this session.";
  input.value = "";
});
