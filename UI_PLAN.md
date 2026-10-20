# Explain UI and motion plan

Make Explain feel like a focused reading companion: easy to configure, quiet beside the page, and clear about what it is doing.

## Visual direction

- Use cool white surfaces, dark ink, and one blue action color. Share the compact `e` mark, control sizing, corner treatment, and focus treatment across both surfaces.
- Keep the interface self contained with a native system font. Use a small type scale and consistent spacing; give the answer the strongest reading hierarchy.
- Spend the visual emphasis on the selected passage and its explanation. Keep utility controls and privacy information quieter but readable.

## Implementation

1. **Setup popup — GPT-6.1 Sol, high.** Improve grouping and spacing, expose setup when no key exists, show session configuration status, validate empty keys inline, and provide accessible pending, success, and error feedback. Preserve session storage and the existing model choices.
2. **Selection and explanation — GPT-6.1 Sol, high.** Anchor both surfaces to the selected text and constrain them to the viewport. Add a selected passage preview, a labelled loading skeleton, readable scrollable answers, error recovery, and explicit dismiss controls. Guard asynchronous responses when a selection is replaced or dismissed.
3. **Interaction verification — GPT-6.1 Sol, medium.** Extend browser coverage for setup, keyboard use, boundaries, long content, loading/error recovery, stale requests, and reduced motion. Exercise the content UI in Chromium and Firefox and load the actual Chromium extension.
4. **Integration — coordinating agent.** Review the combined design, inspect rendered screenshots, run the Rust/JavaScript/build/browser checks, fix findings, and commit and push directly to `main`.

## Motion

- Use short, interruptible opacity and transform transitions: approximately 250 ms for an anchored surface opening and 150 ms for dismissal and routine feedback.
- Use `cubic-bezier(.22, 1, .36, 1)` for surface movement. Keep travel small and avoid replaying entrance motion on routine selection updates.
- Give animated states a readable label or other static cue. Disable animation and movement when reduced motion is requested.
- Keep hidden surfaces out of interaction and accessibility navigation; dismissal must take effect immediately even when the visual exit continues.

## Acceptance

- The setup popup and page UI share a coherent visual system and have visible hover, press, focus, busy, success, and error states where applicable.
- A missing key has an obvious setup path, and saving a key never displays or persists it beyond browser session storage.
- The selection action does not steal focus. Keyboard activation, Escape, outside dismissal, and explicit close controls work.
- Loading, answer, and error states stay beside the selection and within narrow and short viewports. Long answers remain readable without overflowing the page.
- An old request cannot replace a newer explanation or reopen a dismissed card. Provider output is rendered as plain text.
- Reduced motion works in both surfaces. Build, Rust/JavaScript tests, and Chromium/Firefox browser checks pass.
- The reviewed changes are committed on `main`, pushed to `origin/main`, and the originating workspace is synchronized.

## Verification

- `npm test`: production packages built; all 4 Rust and 6 JavaScript tests passed.
- `npm run test:browser`: Chromium and Firefox content and popup checks passed, along with the unpacked Chromium extension smoke test. Provider responses and keys are test fixtures.
- Browser regressions cover stale and out of order responses, the same word selected in different paragraphs, plain text output, retries, keyboard controls, dismissal, and reduced motion.
- Rendered checks confirm the selected passage and scrollable answer remain readable at 320 by 480 and 320 by 300. The setup popup measures 572px high, or 596px with validation feedback.
- Reviewed final screenshots in `dist/test-evidence` and replayed surface motion at 10% speed. Independent Chromium and Firefox probes verified selecting and copying answer text, keyboard scrolling, and hidden surface focus cleanup.
- JavaScript syntax and `git diff --check` passed. Both browser packages contain the current extension sources.
