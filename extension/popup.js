const api = globalThis.browser ?? globalThis.chrome;
const status = document.querySelector("#status");
const input = document.querySelector("#api-key");
const model = document.querySelector("#model");
const form = document.querySelector("#key-form");
const save = form.querySelector(".save");
const keyState = document.querySelector("#key-state");
const keyError = document.querySelector("#key-error");
const toggleKey = document.querySelector("#toggle-key");

function showStatus(message, state = "") {
  status.textContent = message;
  status.dataset.state = state;
}

function showKeySaved() {
  keyState.textContent = "Ready";
  keyState.dataset.state = "ready";
  input.placeholder = "Saved. Enter a new key to replace it";
}

api.storage.session.get(["geminiKey", "geminiModel"]).then((value) => {
  if (value.geminiModel) model.value = value.geminiModel;
  if (value.geminiKey) showKeySaved();
  else {
    keyState.textContent = "Add your key";
    keyState.dataset.state = "";
    input.focus();
  }
}).catch(() => {
  keyState.textContent = "Session unavailable";
  keyState.dataset.state = "error";
  showStatus("Could not read this session. Reopen Explain to try again.", "error");
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

model.addEventListener("change", () => {
  api.storage.session.set({ geminiModel: model.value }).catch(() => {});
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
  showStatus("");
  try {
    const result = await api.runtime.sendMessage({ type: "save-key", key, model: model.value });
    if (result?.ok) {
      showKeySaved();
      input.value = "";
      input.type = "password";
      toggleKey.textContent = "Show";
      toggleKey.setAttribute("aria-label", "Show API key");
      toggleKey.setAttribute("aria-pressed", "false");
      showStatus("Saved. Select text, right-click, and choose Explain.", "success");
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
