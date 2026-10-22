# Explain

Explain a selected word or passage on the page you are reading. Select text, right-click it, and choose **Explain**. The extension sends the selected text, nearby paragraph, and page title directly to Google Gemini.

## Interface

The toolbar popup does one thing: it takes your Gemini API key. Once a key is saved it shows a ready state with a reminder of how to use Explain, and lets you replace the key. If you choose **Explain** before adding a key, the popup opens so you can add one.

Choosing **Explain** from the right-click menu opens a small card beside the selection. It shows the selected text, a loading state, and then the answer as it streams in from Gemini. If the request fails, the card says why and offers **Try again**. Long answers scroll inside the card. Dismiss it with its close button, **Escape**, or a click outside. The interface follows your system's reduced motion preference.

Website: [explain.menzo.dev](https://explain.menzo.dev).

## Build

Requires Node.js 20 or later and Rust stable. Add the WebAssembly target, then build:

```sh
rustup target add wasm32-unknown-unknown
npm run build
```

The build compiles the Rust application core to WebAssembly, then creates `dist/chrome.zip` and `dist/firefox.zip`. Rust owns selection validation and limits, the Explain workflow state transitions, Gemini request payload construction, and Gemini response and provider error parsing. JavaScript is the browser adapter: it reads the page selection, renders the accessible UI, routes extension messages, performs the authenticated fetch, and passes data to and from the Rust WebAssembly module. No explanation is generated locally; each request goes to Google Gemini using the user's session-only key.

Run the Rust unit tests and extension message tests, including calls through the compiled WebAssembly module, with:

```sh
npm test
```

## Load in Chrome

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select `dist/chrome`.
3. Click the Explain icon in the toolbar and paste your Google AI Studio API key. The key stays in session storage and clears when the browser closes.
4. Select text on any page, right-click, and choose **Explain**. This uses Chrome's temporary access for that tab only.

## Load in Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on** and select `dist/firefox/manifest.json`.
3. Click the Explain icon in the toolbar and paste your Google AI Studio API key. The key stays in session storage and clears when the browser closes.
4. Select text on any page, right-click, and choose **Explain**.

Explain uses Gemini 3.8 Flash and calls the model directly; it does not perform Google Search. Google describes Gemini 2.5 API access as limited for new users and recommends current Flash models for new projects. Free access is limited to certain models and has account-specific rate limits. On Google's free tier, submitted content may be used to improve its products; its paid tier states that content is not used for this purpose. [Review Gemini API pricing and data terms](https://ai.google.dev/gemini-api/docs/pricing) and [create or manage a key in Google AI Studio](https://aistudio.google.com/apikey).

Your selected text, nearby paragraph, page title, and API key go directly to Google's Gemini API. The page's HTML is not sent. Answers are rendered as plain text. The key is the only value Explain stores; it remains in browser session memory and is cleared when the browser closes. No key or explanation is bundled with the extension. See the [privacy policy](PRIVACY.md).

## Upstream

This repository began as a fork of [Nutlope/gloss](https://github.com/Nutlope/gloss), a Next.js reader app whose selection lens inspired this extension. Gloss has no license, so none of its code or prompt text ships here: the extension, Rust core, and Explain prompt were written for this project. Gloss's Git history is kept in this repository's history only.

## License

[MIT](LICENSE). This covers the code in this repository's current tree, not the upstream Gloss commits in its history.
