import asyncio
from pathlib import Path
import tempfile

from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "dist" / "test-evidence"
HOSTILE = '<img src=x onerror="window.pwned=true">'
HOST = "[aria-label='Explain selection']"


async def evidence(page, name, full_page=False):
    await page.wait_for_timeout(300)
    await page.screenshot(path=str(EVIDENCE / name), full_page=full_page)


async def visible_quote(page):
    bounds = await page.evaluate("""() => {
      const text = window.testShadow.querySelector('.quote-text').getBoundingClientRect();
      const quote = window.testShadow.querySelector('.quote').getBoundingClientRect();
      const body = window.testShadow.querySelector('.body').getBoundingClientRect();
      return {height:text.height,top:text.top,bottom:text.bottom,
        quoteTop:quote.top,quoteBottom:quote.bottom,bodyHeight:body.height};
    }""")
    assert bounds["height"] >= 16, bounds
    assert bounds["top"] >= bounds["quoteTop"] and bounds["bottom"] <= bounds["quoteBottom"], bounds
    assert bounds["bodyHeight"] >= 20, bounds


async def state(page, value, phase=None):
    await expect(page.locator(HOST)).to_have_attribute("data-state", value)
    if phase:
        await expect(page.locator(HOST)).to_have_attribute("data-phase", phase)


async def select_text(page, target="copy", pointer=True):
    await page.evaluate("""({id,pointer}) => {
      const target = document.getElementById(id);
      if (pointer) target.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}));
      const range = document.createRange();
      range.selectNodeContents(target.querySelector('b'));
      const selection = getSelection();
      selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      if (pointer) target.dispatchEvent(new PointerEvent('pointerup', {bubbles:true}));
    }""", {"id": target, "pointer": pointer})
    await state(page, "actions")


async def shadow_click(page, label):
    point = await page.evaluate("""label => {
      const button = [...window.testShadow.querySelectorAll('button')].find(
        item => !item.closest('[inert]') && (item.getAttribute('aria-label') === label || item.textContent.trim() === label));
      if (!button) throw new Error(`Missing button: ${label}`);
      const rect = button.getBoundingClientRect();
      return {x:rect.x + rect.width / 2,y:rect.y + rect.height / 2};
    }""", label)
    await page.mouse.click(**point)


async def resolve_request(page, response, index=-1):
    await page.evaluate("({response,index}) => window.pending.at(index).resolve(response)", {"response": response, "index": index})


async def in_viewport(page, selector):
    await page.wait_for_timeout(280)
    bounds = await page.evaluate("""selector => {
      const rect = window.testShadow.querySelector(selector).getBoundingClientRect();
      return {left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,
        viewportWidth:innerWidth,viewportHeight:innerHeight};
    }""", selector)
    assert bounds["left"] >= 0 and bounds["top"] >= 0, bounds
    assert bounds["right"] <= bounds["viewportWidth"] + 1, bounds
    assert bounds["bottom"] <= bounds["viewportHeight"] + 1, bounds


async def exercise(browser_type):
    browser = await browser_type.launch(headless=True)
    context = await browser.new_context(viewport={"width": 900, "height": 700})
    page = await context.new_page()
    try:
        await page.set_content('''<style>body{margin:0;font:18px/1.7 system-ui;background:#f7f7f4;color:#252823}main{max-width:760px;margin:64px auto;padding:0 24px}p{margin:0 0 24px}
          #lower{position:fixed;bottom:2px;margin:0 14px}</style>
          <main><h1 style="font-size:28px;line-height:1.2">Notes on language</h1><p id="copy">The <b>obdurate</b> witness held her ground. Even after hours of questioning, she refused to change her account of what had happened that evening.</p><p id="other-copy">An <b>obdurate</b> committee rejected the proposal. Context helps reveal whether a word describes a person, a group, or an attitude.</p>
          <p id="lower">A <b>second selection</b> at the lower edge.</p></main>''')
        await page.evaluate("""() => {
          const attach = Element.prototype.attachShadow;
          Element.prototype.attachShadow = function(options) {
            const shadow = attach.call(this, options);
            if (this.getAttribute('aria-label') === 'Explain selection') window.testShadow = shadow;
            return shadow;
          };
          window.pending = [];
          window.chrome = {runtime:{sendMessage: message => new Promise((resolve,reject) => {
            window.pending.push({message,resolve,reject});
          })}};
        }""")
        await page.add_script_tag(path=str(ROOT / "extension" / "content.js"))
        assert await page.locator(HOST).evaluate("host => host.shadowRoot") is None
        await select_text(page)
        assert await page.evaluate("document.activeElement.tagName") == "BODY"
        await page.keyboard.press("Tab")
        assert await page.evaluate("window.testShadow.activeElement?.getAttribute('aria-label')") == "Explain selected text"
        await page.keyboard.press("Enter")
        await state(page, "result", "loading")
        assert await page.evaluate("window.testShadow.querySelector('.body').getAttribute('aria-busy')") == "true"
        assert await page.evaluate("window.pending.length") == 1
        assert await page.evaluate("window.pending[0].message.selection") == "obdurate"
        await evidence(page, f"{browser_type.name}-loading.png")
        await resolve_request(page, {"answer": "Obdurate means stubbornly refusing to change an opinion or decision. Here, it describes a witness who remains firm despite pressure to give a different account."})
        await state(page, "result", "answer")
        font = await page.evaluate("getComputedStyle(window.testShadow.querySelector('.answer')).fontFamily")
        assert "sans-serif" in font, font
        await in_viewport(page, ".result")
        await evidence(page, f"{browser_type.name}-answer.png")
        await shadow_click(page, "Dismiss explanation")
        await state(page, "closed")

        await select_text(page)
        await shadow_click(page, "Dismiss explanation")
        await state(page, "closed")
        assert await page.evaluate("getSelection().isCollapsed")
        await select_text(page)
        await page.keyboard.press("Escape")
        await state(page, "closed")
        await select_text(page)
        await page.mouse.click(850, 40)
        await state(page, "closed")

        await page.evaluate("""() => {
          const controls = document.createElement('div');
          controls.id = 'page-controls';
          controls.innerHTML = '<button id="page-button">Page action</button><a id="page-link" href="#page">Page link</a><input id="page-input"><div id="page-editor" contenteditable="true">Editable text</div>';
          document.querySelector('main').append(controls);
          document.querySelector('#page-button').addEventListener('click', () => window.pageClicked = true);
        }""")
        for selector in ("#page-button", "#page-link", "#page-input", "#page-editor"):
            await select_text(page)
            count = await page.evaluate("window.pending.length")
            await page.locator(selector).focus()
            await page.keyboard.press("Enter")
            await state(page, "actions")
            assert await page.evaluate("window.pending.length") == count, selector
        assert await page.evaluate("window.pageClicked")
        await page.evaluate("document.activeElement.blur();document.getElementById('page-controls').hidden=true")
        await page.keyboard.press("Escape")

        await page.set_viewport_size({"width": 320, "height": 480})
        await select_text(page, "lower")
        await in_viewport(page, ".box")
        await evidence(page, f"{browser_type.name}-selection-narrow.png")
        await page.keyboard.press("Enter")
        await state(page, "result", "loading")
        await in_viewport(page, ".result")
        await resolve_request(page, {"answer": "A lengthy explanation. " * 400})
        await state(page, "result", "answer")
        await in_viewport(page, ".result")
        scrolling = await page.evaluate("""() => {
          const body = [...window.testShadow.querySelectorAll('.result *')].find(
            item => item.scrollHeight > item.clientHeight + 20 && ['auto','scroll'].includes(getComputedStyle(item).overflowY));
          if (!body) return false;
          body.scrollTop = body.scrollHeight;
          return body.scrollTop > 0;
        }""")
        assert scrolling, "Long answers must scroll inside the viewport"
        await visible_quote(page)
        await evidence(page, f"{browser_type.name}-long-answer-narrow.png")
        await page.set_viewport_size({"width": 320, "height": 300})
        await in_viewport(page, ".result")
        await visible_quote(page)
        await evidence(page, f"{browser_type.name}-long-answer-short-viewport.png")
        await page.set_viewport_size({"width": 320, "height": 480})
        await page.keyboard.press("Escape")
        await state(page, "closed")

        await select_text(page)
        await page.keyboard.press("Enter")
        await state(page, "result", "loading")
        await resolve_request(page, {"error": "Request limit reached. Try again."})
        await state(page, "result", "error")
        await evidence(page, f"{browser_type.name}-error.png")
        await shadow_click(page, "Try again")
        await state(page, "result", "loading")
        await resolve_request(page, {"answer": HOSTILE})
        await state(page, "result", "answer")
        assert await page.evaluate("window.testShadow.querySelector('.answer').textContent") == HOSTILE
        assert await page.evaluate("window.pwned") is None

        await select_text(page)
        await page.keyboard.press("Enter")
        await state(page, "result", "loading")
        old_request = await page.evaluate("window.pending.length - 1")
        await page.mouse.click(300, 20)
        await state(page, "closed")
        await resolve_request(page, {"answer": "Stale outside-dismissed answer"}, old_request)
        await page.wait_for_timeout(180)
        await state(page, "closed")

        await select_text(page)
        await page.keyboard.press("Enter")
        await state(page, "result", "loading")
        old_request = await page.evaluate("window.pending.length - 1")
        await page.keyboard.press("Escape")
        await state(page, "closed")
        await resolve_request(page, {"answer": "Stale dismissed answer"}, old_request)
        await page.wait_for_timeout(180)
        await state(page, "closed")
        assert not await page.evaluate("window.testShadow.querySelector('.result').textContent.includes('Stale dismissed answer')")

        await select_text(page)
        await page.keyboard.press("Enter")
        await state(page, "result", "loading")
        old_request = await page.evaluate("window.pending.length - 1")
        await select_text(page, "lower")
        await page.keyboard.press("Enter")
        await state(page, "result", "loading")
        await resolve_request(page, {"answer": "Stale previous selection"}, old_request)
        await page.wait_for_timeout(180)
        await state(page, "result", "loading")
        await resolve_request(page, {"answer": "The new selection wins."})
        await state(page, "result", "answer")
        assert await page.evaluate("window.testShadow.querySelector('.answer').textContent") == "The new selection wins."

        await select_text(page)
        await page.keyboard.press("Enter")
        await state(page, "result", "loading")
        old_request = await page.evaluate("window.pending.length - 1")
        await select_text(page, "other-copy", pointer=False)
        await page.keyboard.press("Enter")
        await state(page, "result", "loading")
        assert await page.evaluate("window.pending.at(-1).message.selection") == "obdurate"
        assert "proposal" in await page.evaluate("window.pending.at(-1).message.context")
        await resolve_request(page, {"answer": "Stale same-word context"}, old_request)
        await page.wait_for_timeout(180)
        await state(page, "result", "loading")
        await resolve_request(page, {"answer": "A committee that refuses to reconsider."})
        await state(page, "result", "answer")
        await select_text(page)
        await page.keyboard.press("Enter")
        await state(page, "result", "loading")
        await page.evaluate("window.pending.at(-1).reject(new Error('Disconnected'))")
        await state(page, "result", "error")
        await shadow_click(page, "Dismiss explanation")
        await state(page, "closed")

        await page.emulate_media(reduced_motion="reduce")
        await select_text(page)
        animations = await page.evaluate("""() => [...window.testShadow.querySelectorAll('*')].flatMap(
          item => item.getAnimations()).filter(animation => animation.playState === 'running').length""")
        assert animations == 0, "Reduced motion must suppress selection reveal animations"
        await evidence(page, f"{browser_type.name}-reduced-motion.png")
        await page.keyboard.press("Enter")
        await state(page, "result", "loading")
        assert await page.evaluate("""() => [...window.testShadow.querySelectorAll('*')].every(
          item => item.getAnimations().every(animation => animation.playState !== 'running'))""")
        await evidence(page, f"{browser_type.name}-reduced-motion-loading.png")
        await page.keyboard.press("Escape")
        await state(page, "closed")
        other = await context.new_page()
        await other.set_content("<p>Another tab.</p>")
        assert await other.locator(HOST).count() == 0
        print(f"PASS {browser_type.name}: selection keyboard, viewport, scrolling, retry, stale requests, reduced motion")
    finally:
        await context.close()
        await browser.close()


async def popup_fixture(browser_type):
    browser = await browser_type.launch(headless=True)
    page = await browser.new_page(viewport={"width": 336, "height": 600})
    try:
        async def serve(route):
            await route.fulfill(path=str(ROOT / "extension" / route.request.url.rsplit("/", 1)[-1]))
        await page.route("http://popup.test/*", serve)
        await page.add_init_script("""window.pending=[];window.chrome={storage:{session:{get:async()=>({})}},
          runtime:{sendMessage:message=>new Promise((resolve,reject)=>window.pending.push({message,resolve,reject}))}};""")
        await page.goto("http://popup.test/popup.html")
        await expect(page.locator("details")).to_have_attribute("open", "")
        await expect(page.locator("#key-state")).to_contain_text("Setup needed")
        height = await page.locator("main").evaluate("element => element.getBoundingClientRect().height")
        assert await page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        await evidence(page, f"{browser_type.name}-popup-setup.png", full_page=True)
        await page.set_viewport_size({"width": 320, "height": 600})
        assert await page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        for selector in ("#api-key", "#toggle-key", "#model", "#enable", "#key-form .save"):
            bounds = await page.locator(selector).bounding_box()
            assert bounds and bounds["x"] >= 0 and bounds["x"] + bounds["width"] <= 321, (selector, bounds)
        await evidence(page, f"{browser_type.name}-popup-setup-narrow.png", full_page=True)
        save = page.locator("#key-form .save")
        await save.click()
        await expect(page.locator("#key-error")).to_be_visible()
        await expect(page.locator("#api-key")).to_be_focused()
        await expect(page.locator("#api-key")).to_have_attribute("aria-invalid", "true")
        assert await page.evaluate("window.pending.length") == 0
        await page.locator("#api-key").fill("fixture-test-key")
        await page.get_by_role("button", name="Show API key").click()
        await expect(page.locator("#api-key")).to_have_attribute("type", "text")
        await page.get_by_role("button", name="Hide API key").click()
        await expect(page.locator("#api-key")).to_have_attribute("type", "password")
        await save.click()
        await expect(save).to_be_disabled()
        await expect(page.locator("#key-form")).to_have_attribute("aria-busy", "true")
        await resolve_request(page, {"ok": True})
        await expect(page.locator("#status")).to_contain_text("Key saved for this browser session.")
        await expect(save).to_be_enabled()
        await expect(page.locator("#api-key")).to_have_value("")
        await expect(page.locator("#key-state")).to_contain_text("Key saved for this session")
        await page.locator("#api-key").fill("fixture-test-key")
        await save.click()
        await resolve_request(page, {"error": "Storage unavailable"})
        await expect(page.locator("#status")).to_contain_text("Could not save the key")
        await expect(save).to_be_enabled()
        await evidence(page, f"{browser_type.name}-popup-error.png")
        enable = page.locator("#enable")
        await enable.click()
        await expect(enable).to_be_disabled()
        await resolve_request(page, {"ok": True})
        await expect(page.locator("#status")).to_contain_text("Ready.")
        await expect(enable).to_be_enabled()
        await enable.click()
        await page.evaluate("window.pending.at(-1).reject(new Error('Disconnected'))")
        await expect(enable).to_be_enabled()
        await expect(page.locator("#status")).not_to_contain_text("Connecting Explain")
        await page.emulate_media(reduced_motion="reduce")
        await page.locator("summary").click()
        await page.locator("summary").click()
        await page.get_by_role("button", name="Show API key").click()
        assert await page.evaluate("document.getAnimations().filter(animation => animation.playState === 'running').length") == 0
        print(f"PASS {browser_type.name}: popup setup ({height:.0f}px), validation, visibility, busy, errors, reduced motion")
    finally:
        await browser.close()


async def chromium_extension_smoke(playwright):
    with tempfile.TemporaryDirectory(prefix="explain-chrome-") as profile:
        context = await playwright.chromium.launch_persistent_context(
            profile, channel="chromium", headless=True,
            args=[f"--disable-extensions-except={ROOT / 'dist' / 'chrome'}",
                  f"--load-extension={ROOT / 'dist' / 'chrome'}"],
        )
        try:
            worker = context.service_workers[0] if context.service_workers else await context.wait_for_event("serviceworker")
            extension_id = worker.url.split("/")[2]
            popup = await context.new_page()
            await popup.goto(f"chrome-extension://{extension_id}/popup.html")
            await popup.get_by_role("heading", name="Explain", exact=True).wait_for()
            await expect(popup.locator("details")).to_have_attribute("open", "")
            await popup.locator("#api-key").fill("session-test-key")
            await popup.get_by_role("button", name="Save for this session").click()
            await popup.get_by_text("Key saved for this browser session.", exact=True).wait_for()
            assert await popup.evaluate("chrome.storage.session.get(['geminiKey','geminiModel'])") == {
                "geminiKey": "session-test-key", "geminiModel": "gemini-3.8-flash"}
            message_result = await popup.evaluate("chrome.runtime.sendMessage({type:'explain',selection:'   '})")
            assert message_result["error"] == "Select some text first."
            await popup.reload()
            await expect(popup.locator("#key-state")).to_contain_text("Key saved for this session")
            assert not await popup.locator("details").evaluate("element => element.open")
            await expect(popup.locator("#api-key")).to_have_value("")
            await evidence(popup, "chromium-extension-popup.png")
            print("PASS Chromium unpacked extension popup: session save and reload")
        finally:
            await context.close()


async def main():
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        for browser_type in (p.chromium, p.firefox):
            await exercise(browser_type)
            await popup_fixture(browser_type)
        await chromium_extension_smoke(p)


if __name__ == "__main__":
    asyncio.run(main())
