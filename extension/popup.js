const api = globalThis.browser ?? globalThis.chrome;
const status = document.querySelector("#status");
const input = document.querySelector("#api-key");
const model = document.querySelector("#model");
const enable = document.querySelector("#enable");
const form = document.querySelector("#key-form");
const save = form.querySelector(".save");
const settings = document.querySelector("details");
const keyState = document.querySelector("#key-state");
const keyError = document.querySelector("#key-error");
const toggleKey = document.querySelector("#toggle-key");
let hasKey = false;

function showStatus(message, state = "") {
  status.textContent = message;
  status.dataset.state = state;
}

api.storage.session.get(["geminiKey", "geminiModel"]).then((value) => {
  if (value.geminiModel) model.value = value.geminiModel;
  hasKey = Boolean(value.geminiKey);
  keyState.textContent = hasKey ? "Key saved for this session" : "Setup needed";
  keyState.dataset.state = hasKey ? "ready" : "";
  settings.open = !hasKey;
  if (hasKey) input.placeholder = "Enter a replacement key";
  else showStatus("Add your key below to get started.");
}).catch(() => {
  keyState.textContent = "Session unavailable";
  keyState.dataset.state = "error";
  settings.open = true;
  showStatus("Could not read this session. Reopen Explain to try again.", "error");
});

enable.addEventListener("click", async () => {
  enable.disabled = true;
  enable.textContent = "Enabling this page…";
  enable.setAttribute("aria-busy", "true");
  showStatus("Connecting Explain to this tab…");
  try {
    const result = await api.runtime.sendMessage({ type: "enable-tab" });
    if (result?.ok) {
      showStatus(hasKey ? "Ready. Select text on the page." : "Page enabled. Add your key below to explain text.", "success");
    } else {
      showStatus(result?.error || "This page cannot run the extension.", "error");
    }
  } catch {
    showStatus("Could not enable this page. Reopen Explain and try again.", "error");
  } finally {
    enable.disabled = false;
    enable.textContent = "Use on this page";
    enable.removeAttribute("aria-busy");
  }
});

toggleKey.addEventListener("click", () => {
  const visible = input.type === "password";
  input.type = visible ? "text" : "password";
  toggleKey.textContent = visible ? "Hide" : "Show";
  toggleKey.setAttribute("aria-label", visible ? "Hide API key" : "Show API key");
  toggleKey.setAttribute("aria-pressed", String(visible));
});

input.addEventListener("input", () => {
  input.removeAttribute("aria-invalid");
  keyError.hidden = true;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const key = input.value.trim();
  if (!key) {
    keyError.textContent = "Enter your Gemini API key.";
    keyError.hidden = false;
    input.setAttribute("aria-invalid", "true");
    input.focus();
    return;
  }
  save.disabled = true;
  save.textContent = "Saving key…";
  form.setAttribute("aria-busy", "true");
  showStatus("Saving your key for this session…");
  try {
    const result = await api.runtime.sendMessage({ type: "save-key", key, model: model.value });
    if (result?.ok) {
      hasKey = true;
      keyState.textContent = "Key saved for this session";
      keyState.dataset.state = "ready";
      input.value = "";
      input.type = "password";
      input.placeholder = "Enter a replacement key";
      toggleKey.textContent = "Show";
      toggleKey.setAttribute("aria-label", "Show API key");
      toggleKey.setAttribute("aria-pressed", "false");
      showStatus("Key saved for this browser session.", "success");
    } else {
      showStatus("Could not save the key for this session. Try again.", "error");
    }
  } catch {
    showStatus("Could not save the key for this session. Reopen Explain and try again.", "error");
  } finally {
    save.disabled = false;
    save.textContent = "Save for this session";
    form.removeAttribute("aria-busy");
  }
});
