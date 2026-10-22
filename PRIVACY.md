# Privacy Policy

Effective October 22, 2026. This policy covers the Explain browser extension.

Explain has no servers of its own. It does not collect analytics, telemetry, or usage data, and it does not sell or share your data with anyone.

## What Explain sends, and where

Explain sends data only when you choose **Explain** (or press **Enter**) on a selection, on a page where you chose **Use on this page**. Each request goes directly from your browser to Google's Gemini API at `generativelanguage.googleapis.com`, and nowhere else. A request contains:

- the text you selected (up to 12,000 characters);
- the nearby text from the paragraph, list item, heading, or table cell that contains the selection (up to 5,000 characters);
- the page title (up to 300 characters);
- the Gemini model you chose;
- your Gemini API key, which authenticates the request.

Explain does not send the page address, the page's HTML, or anything from pages where you have not enabled it.

## What Explain stores

Your API key and model choice are kept in the browser's extension session storage (`chrome.storage.session`). They stay in memory, are never written to disk by Explain, and are cleared when the browser closes. Explain stores nothing else: selections and explanations are shown on the page and discarded.

## Permissions

- `activeTab` and `scripting`: run Explain on the current tab only after you choose **Use on this page**.
- `storage`: keep your API key and model choice for the browser session.
- Access to `generativelanguage.googleapis.com`: send Explain requests to Google Gemini.

## Google's terms

Google processes each request under its own terms, using your API key and account. On Google's free tier, submitted content may be used to improve Google's products; Google states that paid tier content is not used for this purpose. See the [Gemini API Additional Terms of Service](https://ai.google.dev/gemini-api/terms) and [Google's Privacy Policy](https://policies.google.com/privacy).

## Contact

Questions or concerns: open an issue at https://github.com/canmenzo/explainExtension/issues.
