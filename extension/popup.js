const api = globalThis.browser ?? globalThis.chrome;
const main = document.querySelector("main");
const ready = document.querySelector("#ready");
const form = document.querySelector("#key-form");
const input = document.querySelector("#api-key");
const save = form.querySelector(".save");
const saveLabel = save.querySelector(".save-label");
const replace = document.querySelector("#replace");
const cancel = document.querySelector("#cancel");
const status = document.querySelector("#status");
const keyError = document.querySelector("#key-error");
const toggleKey = document.querySelector("#toggle-key");

function showStatus(message, state = "") {
  status.textContent = message;
  status.dataset.state = state;
}

// setup: no key yet. ready: key saved. replacing: key saved and the form is open to swap it.
function render(state) {
  main.dataset.state = state;
  ready.hidden = state === "setup";
  form.hidden = state === "ready";
  replace.hidden = state !== "ready";
  replace.setAttribute("aria-expanded", String(state === "replacing"));
  cancel.hidden = state !== "replacing";
  input.placeholder = state === "replacing" ? "Paste a new key" : "Paste your key";
  if (state !== "ready") input.focus();
}

function resetInput() {
  input.value = "";
  input.removeAttribute("aria-invalid");
  keyError.hidden = true;
  setVisible(false);
}

function setVisible(visible) {
  input.type = visible ? "text" : "password";
  toggleKey.setAttribute("aria-label", visible ? "Hide API key" : "Show API key");
  toggleKey.setAttribute("aria-pressed", String(visible));
}

api.storage.session.get("geminiKey").then((value) => {
  render(value.geminiKey ? "ready" : "setup");
}).catch(() => {
  render("setup");
  showStatus("Could not read this session. Reopen Explain to try again.", "error");
});

toggleKey.addEventListener("click", () => setVisible(input.type === "password"));

replace.addEventListener("click", () => {
  showStatus("");
  render("replacing");
});

cancel.addEventListener("click", () => {
  resetInput();
  showStatus("");
  render("ready");
  replace.focus();
});

input.addEventListener("input", () => {
  input.removeAttribute("aria-invalid");
  keyError.hidden = true;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const key = input.value.trim();
  if (!key) {
    keyError.textContent = "Paste your Gemini API key to continue.";
    keyError.hidden = false;
    input.setAttribute("aria-invalid", "true");
    input.focus();
    return;
  }
  save.disabled = true;
  saveLabel.textContent = "Saving…";
  form.setAttribute("aria-busy", "true");
  showStatus("");
  try {
    const result = await api.runtime.sendMessage({ type: "save-key", key });
    if (result?.ok) {
      resetInput();
      render("ready");
      replace.focus();
      showStatus("Key saved.", "success");
    } else {
      showStatus("Could not save the key. Try again.", "error");
    }
  } catch {
    showStatus("Could not save the key. Reopen Explain and try again.", "error");
  } finally {
    save.disabled = false;
    saveLabel.textContent = "Save key";
    form.removeAttribute("aria-busy");
  }
});
