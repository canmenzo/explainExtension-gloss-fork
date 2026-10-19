# Explain

Explain a selected word or passage on the page you are reading. Select text to reveal a small floating action, then choose **Explain**. The extension sends the selected text, nearby paragraph, and page title directly to Google Gemini.

## Build

Requires Node.js 20 or later and Rust stable. Add the WebAssembly target, then build:

```sh
rustup target add wasm32-unknown-unknown
npm run build
```

The build compiles selection validation and prompt composition from Rust to WebAssembly, then creates `dist/chrome.zip` and `dist/firefox.zip`. The small JavaScript files connect that core to browser extension APIs and the page UI.

## Load in Chrome

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select `dist/chrome`.
3. Select the Explain icon on a page and choose **Use on this page**. This uses Chrome's temporary access for the active tab. Select text on that page to open Explain.
4. Choose a Gemini Flash model in the extension popup and enter your Google AI Studio API key. The key and model choice stay in session storage and clear when the browser closes.

## Load in Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on** and select `dist/firefox/manifest.json`.
3. Select the Explain icon on a page and choose **Use on this page**, then select text.
4. Choose a Gemini Flash model in the extension popup and enter your Google AI Studio API key. The key and model choice stay in session storage and clear when the browser closes.

Explain defaults to Gemini 3.8 Flash. The model menu also offers Gemini 3.5 Flash, 3.5 Flash-Lite, and 3.1 Flash-Lite. Explain calls the model directly; it does not perform Google Search. Google describes Gemini 2.5 API access as limited for new users and recommends current Flash models for new projects. Free access is limited to certain models and has account-specific rate limits. On Google's free tier, submitted content may be used to improve its products; its paid tier states that content is not used for this purpose. [Review Gemini API pricing and data terms](https://ai.google.dev/gemini-api/docs/pricing) and [create or manage a key in Google AI Studio](https://aistudio.google.com/apikey).

Your selected text, nearby paragraph, page title, and API key go directly to Google's Gemini API. The page's HTML is not sent. Answers are rendered as plain text. The key remains in browser session memory and is cleared when the browser closes; no key or explanation is bundled with the extension.

## Upstream

This repository began as a fork of [Nutlope/gloss](https://github.com/Nutlope/gloss), whose selection lens and Explain prompt informed this focused extension. The source checkout contained no `LICENSE`, `NOTICE`, or `COPYING` file; the upstream Git history is preserved in this repository and in the local backup branch `backup/pre-extension-20261019`.
