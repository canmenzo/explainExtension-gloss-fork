import asyncio
from pathlib import Path
import tempfile

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
CONTENT = ROOT / "extension" / "content.js"
HOSTILE = '<img src=x onerror="window.pwned=true">'


async def exercise(browser_type):
    browser = await browser_type.launch(headless=True)
    context = await browser.new_context()
    page = await context.new_page()
    await page.set_content('<main><p id="copy">The <b>obdurate</b> witness held her ground.</p></main>')
    await page.evaluate("window.chrome={runtime:{sendMessage:async message=>({answer:'" + HOSTILE.replace("'", "\\'") + "'})}}")
    await page.add_script_tag(path=str(CONTENT))

    async def select_text():
        await page.evaluate("""() => {
          const target = document.querySelector('#copy');
          target.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}));
          const text = document.querySelector('#copy b').firstChild;
          const range = document.createRange();
          range.setStart(text, 0); range.setEnd(text, text.length);
          const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
          document.dispatchEvent(new Event('selectionchange'));
          target.dispatchEvent(new PointerEvent('pointerup', {bubbles:true}));
        }""")

    host = page.locator("[aria-label='Explain selection']")
    await select_text()
    await page.wait_for_function("document.querySelector('[aria-label=\\\"Explain selection\\\"]')?.dataset.state === 'actions'")
    assert await page.evaluate("document.activeElement.tagName") == "BODY"
    await page.keyboard.press("Tab")
    assert await page.evaluate("document.activeElement.tagName") != "BODY"
    await page.keyboard.press("Enter")
    await page.wait_for_function("document.querySelector('[aria-label=\\\"Explain selection\\\"]')?.dataset.state === 'result'")
    assert await page.evaluate("window.pwned") is None
    await page.wait_for_timeout(180)
    await page.screenshot(path=str(ROOT / "dist" / "test-evidence" / f"{browser_type.name}-answer.png"))

    await select_text()
    await page.wait_for_function("document.querySelector('[aria-label=\\\"Explain selection\\\"]')?.dataset.state === 'actions'")
    await page.keyboard.press("Escape")
    await page.wait_for_function("document.querySelector('[aria-label=\\\"Explain selection\\\"]')?.dataset.state === 'closed'")

    await select_text()
    await page.wait_for_function("document.querySelector('[aria-label=\\\"Explain selection\\\"]')?.dataset.state === 'actions'")
    await page.wait_for_timeout(180)
    await page.screenshot(path=str(ROOT / "dist" / "test-evidence" / f"{browser_type.name}-selection.png"))
    point = await page.evaluate("""() => {
      const range = getSelection().getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const left = Math.max(12, Math.min(innerWidth - 117, rect.left + rect.width / 2 - 52));
      const top = rect.top - 52 >= 8 ? rect.top - 52 : rect.bottom + 10;
      return { x: left + 87, y: top + 20 };
    }""")
    await page.mouse.click(point["x"], point["y"])
    await page.wait_for_function("document.querySelector('[aria-label=\\\"Explain selection\\\"]')?.dataset.state === 'closed'")
    assert await page.evaluate("getSelection().isCollapsed")

    await select_text()
    await page.wait_for_function("document.querySelector('[aria-label=\\\"Explain selection\\\"]')?.dataset.state === 'actions'")
    other = await context.new_page()
    await other.set_content("<p>Another tab.</p>")
    assert await other.locator("[aria-label='Explain selection']").count() == 0
    await context.close()
    await browser.close()


async def main():
    (ROOT / "dist" / "test-evidence").mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        await exercise(p.chromium)
        await exercise(p.firefox)
        await chromium_extension_smoke(p)


async def chromium_extension_smoke(playwright):
    with tempfile.TemporaryDirectory(prefix="explain-chrome-") as profile:
        context = await playwright.chromium.launch_persistent_context(
            profile,
            channel="chromium",
            headless=False,
            args=[
                f"--disable-extensions-except={ROOT / 'dist' / 'chrome'}",
                f"--load-extension={ROOT / 'dist' / 'chrome'}",
            ],
        )
        try:
            worker = await context.wait_for_event("serviceworker")
            extension_id = worker.url.split("/")[2]
            popup = await context.new_page()
            await popup.goto(f"chrome-extension://{extension_id}/popup.html")
            await popup.get_by_role("heading", name="Explain").wait_for()
            await popup.get_by_text("Gemini API key and model").click()
            await popup.locator("#api-key").fill("session-test-key")
            await popup.get_by_role("button", name="Save for this session").click()
            await popup.get_by_text("Key saved for this browser session.").wait_for()
            assert await popup.evaluate("chrome.storage.session.get(['geminiKey','geminiModel']).then(value => value)") == {"geminiKey": "session-test-key", "geminiModel": "gemini-3.8-flash"}
            message_result = await popup.evaluate("chrome.runtime.sendMessage({type:'explain',selection:'   '})")
            assert message_result["error"] == "Select some text first."
            await popup.screenshot(path=str(ROOT / "dist" / "test-evidence" / "chromium-extension-popup.png"))
        finally:
            await context.close()


if __name__ == "__main__":
    asyncio.run(main())
