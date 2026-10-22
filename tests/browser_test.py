import asyncio
from pathlib import Path
import tempfile

from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "dist" / "test-evidence"
HOSTILE = '<img src=x onerror="window.pwned=true">'
HOST = "[aria-label='Explain selection']"

# Stands in for the extension runtime: the context menu's message and the streaming port.
RUNTIME_STUB = """() => {
  const attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function(options) {
    const shadow = attach.call(this, options);
    if (this.getAttribute('aria-label') === 'Explain selection') window.testShadow = shadow;
    return shadow;
  };
  window.ports = [];
  window.chrome = {runtime:{
    onMessage:{addListener(fn){window.menu = (selection = '') => fn({type:'explain', selection});}},
    connect({name}) {
      const port = {name, posted:[], listeners:[], drops:[], disconnected:false,
        postMessage(message){port.posted.push(message);}, disconnect(){port.disconnected = true;},
        onMessage:{addListener(fn){port.listeners.push(fn);}}, onDisconnect:{addListener(fn){port.drops.push(fn);}},
        emit(message){port.listeners.forEach(fn => fn(message));}, drop(){port.drops.forEach(fn => fn());}};
      window.ports.push(port);
      return port;
    }}};
}"""


async def evidence(page, name, full_page=False):
    await page.wait_for_timeout(300)
    await page.screenshot(path=str(EVIDENCE / name), full_page=full_page)


async def state(page, value, phase=None):
    await expect(page.locator(HOST)).to_have_attribute("data-state", value)
    if phase:
        await expect(page.locator(HOST)).to_have_attribute("data-phase", phase)


async def select(page, target="copy"):
    await page.evaluate("""id => {
      const range = document.createRange();
      range.selectNodeContents(document.getElementById(id).querySelector('b'));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    }""", target)


async def explain(page, target="copy", fallback=""):
    if target:
        await select(page, target)
    await page.evaluate("text => window.menu(text)", fallback)
    await state(page, "open", "loading")


async def emit(page, message, index=-1):
    await page.evaluate("({message,index}) => window.ports.at(index).emit(message)", {"message": message, "index": index})


async def shadow_click(page, label):
    point = await page.evaluate("""label => {
      const button = [...window.testShadow.querySelectorAll('button')].find(
        item => !item.closest('[inert]') && (item.getAttribute('aria-label') === label || item.textContent.trim() === label));
      if (!button) throw new Error(`Missing button: ${label}`);
      const rect = button.getBoundingClientRect();
      return {x:rect.x + rect.width / 2,y:rect.y + rect.height / 2};
    }""", label)
    await page.mouse.click(**point)


async def in_viewport(page):
    await page.wait_for_timeout(280)
    bounds = await page.evaluate("""() => {
      const rect = window.testShadow.querySelector('.card').getBoundingClientRect();
      return {left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,
        viewportWidth:innerWidth,viewportHeight:innerHeight};
    }""")
    assert bounds["left"] >= 0 and bounds["top"] >= 0, bounds
    assert bounds["right"] <= bounds["viewportWidth"] + 1, bounds
    assert bounds["bottom"] <= bounds["viewportHeight"] + 1, bounds
    return bounds


async def answer_text(page):
    return await page.evaluate("window.testShadow.querySelector('.answer')?.textContent")


async def running_animations(page):
    return await page.evaluate("""() => [...window.testShadow.querySelectorAll('*')].flatMap(
      item => item.getAnimations()).filter(animation => animation.playState === 'running').length""")


async def exercise(browser_type):
    browser = await browser_type.launch(headless=True)
    context = await browser.new_context(viewport={"width": 900, "height": 700})
    page = await context.new_page()
    try:
        await page.set_content('''<style>body{margin:0;font:18px/1.7 system-ui;background:#f7f7f4;color:#252823}main{max-width:760px;margin:64px auto;padding:0 24px}p{margin:0 0 24px}
          #lower{position:fixed;bottom:2px;margin:0 14px}</style><title>Notes on language</title>
          <main><h1 style="font-size:28px;line-height:1.2">Notes on language</h1><p id="copy">The <b>obdurate</b> witness held her ground. Even after hours of questioning, she refused to change her account of what had happened that evening.</p><p id="other-copy">An <b>obdurate</b> committee rejected the proposal. Context helps reveal whether a word describes a person, a group, or an attitude.</p>
          <p id="lower">A <b>second selection</b> at the lower edge.</p><input id="field" value="A field with tacit approval in it"></main>''')
        await page.evaluate(RUNTIME_STUB)
        await page.add_script_tag(path=str(ROOT / "extension" / "content.js"))
        assert await page.locator(HOST).evaluate("host => host.shadowRoot") is None

        # Streaming answer beside the selection.
        await explain(page)
        assert await page.evaluate("document.activeElement.tagName") == "BODY"
        payload = await page.evaluate("window.ports[0].posted[0]")
        assert payload["selection"] == "obdurate" and "witness" in payload["context"] and payload["title"] == "Notes on language", payload
        assert "obdurate" in await page.evaluate("window.testShadow.querySelector('.title').textContent")
        await evidence(page, f"{browser_type.name}-loading.png")
        await emit(page, {"text": "Obdurate means "})
        await state(page, "open", "streaming")
        # Each character fades in on its own, starting transparent and tinted.
        fading = await page.evaluate("""() => {
          const spans = [...window.testShadow.querySelectorAll('.answer span')];
          return {count: spans.length, animated: spans.every(span => span.getAnimations().length === 1),
                  first: getComputedStyle(spans.at(-1)).opacity};
        }""")
        assert fading["count"] == len("Obdurate means") and fading["animated"] and float(fading["first"]) < 1, fading
        await emit(page, {"text": "stubbornly refusing to change your mind."})
        await evidence(page, f"{browser_type.name}-streaming.png")
        await emit(page, {"done": True})
        await state(page, "open", "done")
        assert await answer_text(page) == "Obdurate means stubbornly refusing to change your mind."
        assert await page.evaluate("window.ports[0].disconnected")
        # Settled characters fold back into plain text.
        await page.wait_for_function("!window.testShadow.querySelector('.answer span')", timeout=3000)
        assert await answer_text(page) == "Obdurate means stubbornly refusing to change your mind."
        bounds = await in_viewport(page)
        word = await page.evaluate("document.querySelector('#copy b').getBoundingClientRect().toJSON()")
        assert bounds["top"] >= word["bottom"] or bounds["bottom"] <= word["top"], (bounds, word)
        assert abs((bounds["left"] + bounds["right"]) / 2 - (word["left"] + word["right"]) / 2) < 60, (bounds, word)
        font = await page.evaluate("getComputedStyle(window.testShadow.querySelector('.answer')).fontFamily")
        assert "sans-serif" in font and await page.evaluate("getComputedStyle(window.testShadow.querySelector('.close')).fontFamily") == font
        await evidence(page, f"{browser_type.name}-answer.png")

        # Dismissal: close button, Escape, outside click. Clicks inside the card keep it open.
        await shadow_click(page, "Dismiss explanation")
        await state(page, "closed")
        await explain(page)
        await page.evaluate("window.testShadow.querySelector('.body').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, composed:true}))")
        await state(page, "open")
        await page.keyboard.press("Escape")
        await state(page, "closed")
        assert await page.evaluate("window.ports.at(-1).disconnected")
        await explain(page)
        await page.mouse.click(850, 40)
        await state(page, "closed")
        await emit(page, {"text": "Stale dismissed answer"})
        await page.wait_for_timeout(180)
        await state(page, "closed")
        assert not await page.evaluate("window.testShadow.querySelector('.card').textContent.includes('Stale')")

        # A newer Explain replaces an older stream.
        await explain(page)
        old = await page.evaluate("window.ports.length - 1")
        await explain(page, "other-copy")
        assert await page.evaluate(f"window.ports[{old}].disconnected")
        assert "proposal" in await page.evaluate("window.ports.at(-1).posted[0].context")
        await emit(page, {"text": "Stale previous selection"}, old)
        await page.wait_for_timeout(180)
        await state(page, "open", "loading")
        await emit(page, {"text": "A committee that will not reconsider."})
        await emit(page, {"done": True})
        await state(page, "open", "done")
        assert await answer_text(page) == "A committee that will not reconsider."

        # Errors offer Try again with the same selection; a dropped port is an error too.
        await explain(page)
        await emit(page, {"error": "Google rate or usage limit reached. Try again later."})
        await state(page, "open", "error")
        await evidence(page, f"{browser_type.name}-error.png")
        await shadow_click(page, "Try again")
        await state(page, "open", "loading")
        assert await page.evaluate("window.ports.at(-1).posted[0].selection") == "obdurate"
        await emit(page, {"text": HOSTILE})
        await emit(page, {"done": True})
        await state(page, "open", "done")
        assert await answer_text(page) == HOSTILE
        assert await page.evaluate("window.pwned") is None
        await explain(page)
        await page.evaluate("window.ports.at(-1).drop()")
        await state(page, "open", "error")
        await page.keyboard.press("Escape")

        # Menu text is used when the page selection is not readable, such as inside a text field.
        await page.evaluate("getSelection().removeAllRanges(); document.getElementById('field').focus(); document.getElementById('field').setSelectionRange(13, 27)")
        await explain(page, None, "tacit approval")
        sent = await page.evaluate("window.ports.at(-1).posted[0]")
        assert sent["selection"] == "tacit approval" and "field with tacit" in sent["context"], sent
        await in_viewport(page)
        await page.keyboard.press("Escape")
        await page.evaluate("document.activeElement.blur()")

        # Long answers scroll inside a card that stays on screen, even in small viewports.
        await page.set_viewport_size({"width": 320, "height": 480})
        await explain(page, "lower")
        await in_viewport(page)
        await emit(page, {"text": "A lengthy explanation. " * 200})
        await state(page, "open", "streaming")
        await in_viewport(page)
        assert await page.evaluate("""() => {
          const body = window.testShadow.querySelector('.body');
          return body.scrollHeight > body.clientHeight + 20 && body.scrollTop > 0;
        }"""), "Long answers must scroll and follow the stream"
        await emit(page, {"done": True})
        await page.set_viewport_size({"width": 320, "height": 300})
        await in_viewport(page)
        await evidence(page, f"{browser_type.name}-long-answer-short-viewport.png")
        await page.set_viewport_size({"width": 900, "height": 700})
        await page.keyboard.press("Escape")
        await state(page, "closed")

        # Reduced motion: no running animations while loading or streaming.
        await page.emulate_media(reduced_motion="reduce")
        await explain(page)
        assert await running_animations(page) == 0
        await emit(page, {"text": "Calm text."})
        await state(page, "open", "streaming")
        assert await running_animations(page) == 0
        await page.keyboard.press("Escape")
        await page.emulate_media(reduced_motion="no-preference")

        # Injecting again is a no-op; a reloaded extension replaces the old card.
        await page.add_script_tag(path=str(ROOT / "extension" / "content.js"))
        assert await page.locator(HOST).count() == 1
        await page.evaluate("window.explainListening = false")
        await page.add_script_tag(path=str(ROOT / "extension" / "content.js"))
        assert await page.locator(HOST).count() == 1
        await explain(page)
        await emit(page, {"text": "Still works."})
        await state(page, "open", "streaming")

        other = await context.new_page()
        await other.set_content("<p>Another tab.</p>")
        assert await other.locator(HOST).count() == 0
        print(f"PASS {browser_type.name}: streaming card, placement, dismissal, stale streams, retry, fallback text, scrolling, reduced motion")
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
        await page.add_init_script("""window.pending=[];window.chrome={storage:{session:{get:async()=>({}),set:async()=>{}}},
          runtime:{sendMessage:message=>new Promise((resolve,reject)=>window.pending.push({message,resolve,reject}))}};""")
        await page.goto("http://popup.test/popup.html")
        form = page.locator("#key-form")
        ready = page.locator("#ready")
        await expect(page.locator("#api-key")).to_be_focused()
        await expect(form).to_be_visible()
        await expect(ready).to_be_hidden()
        await expect(page.get_by_role("link", name="Get a free key")).to_have_attribute("href", "https://aistudio.google.com/apikey")
        assert await page.locator("select, #model, .how, ol").count() == 0
        # Chrome caps popups at 600px; leave room for the validation message.
        height = await page.locator("main").evaluate("element => element.getBoundingClientRect().height")
        assert height <= 576, height
        await evidence(page, f"{browser_type.name}-popup-setup.png", full_page=True)
        # Chrome measures popups from a tiny initial viewport; the layout must not shrink with it.
        await page.set_viewport_size({"width": 160, "height": 600})
        assert await page.locator("body").evaluate("element => element.getBoundingClientRect().width") == 336
        await page.set_viewport_size({"width": 336, "height": 600})
        save = form.locator(".save")
        await save.click()
        await expect(page.locator("#key-error")).to_be_visible()
        await expect(page.locator("#api-key")).to_be_focused()
        await expect(page.locator("#api-key")).to_have_attribute("aria-invalid", "true")
        assert await page.evaluate("window.pending.length") == 0
        await page.locator("#api-key").fill("fixture-test-key")
        await expect(page.locator("#key-error")).to_be_hidden()
        await page.get_by_role("button", name="Show API key").click()
        await expect(page.locator("#api-key")).to_have_attribute("type", "text")
        await page.get_by_role("button", name="Hide API key").click()
        await save.click()
        await expect(save).to_be_disabled()
        await expect(form).to_have_attribute("aria-busy", "true")
        await expect(save).to_contain_text("Saving")
        assert await page.evaluate("window.pending.at(-1).message") == {"type": "save-key", "key": "fixture-test-key"}
        await page.evaluate("window.pending.at(-1).resolve({ok:true})")
        await expect(ready).to_be_visible()
        await expect(ready).to_contain_text("right-click")
        await expect(form).to_be_hidden()
        await expect(page.locator("#status")).to_have_text("Key saved.")
        await expect(page.locator("#api-key")).to_have_value("")
        await expect(page.locator("#api-key")).to_have_attribute("type", "password")
        await evidence(page, f"{browser_type.name}-popup-saved.png", full_page=True)

        # A saved key can be replaced; failures keep the form open with the reason.
        await page.get_by_role("button", name="Replace key").click()
        await expect(form).to_be_visible()
        await expect(page.locator("#api-key")).to_be_focused()
        await expect(page.locator("#status")).to_be_empty()
        height = await page.locator("main").evaluate("element => element.getBoundingClientRect().height")
        assert height <= 576, height
        await page.locator("#api-key").fill("fixture-test-key")
        await save.click()
        await page.evaluate("window.pending.at(-1).resolve({error:'Storage unavailable'})")
        await expect(page.locator("#status")).to_contain_text("Could not save the key")
        await expect(form).to_be_visible()
        await evidence(page, f"{browser_type.name}-popup-replace-error.png", full_page=True)
        await page.locator("#api-key").fill("fixture-test-key")
        await save.click()
        await page.evaluate("window.pending.at(-1).reject(new Error('Disconnected'))")
        await expect(save).to_be_enabled()
        await expect(page.locator("#status")).to_contain_text("Reopen Explain")
        await page.get_by_role("button", name="Cancel").click()
        await expect(form).to_be_hidden()
        await expect(page.get_by_role("button", name="Replace key")).to_be_focused()
        await expect(page.locator("#api-key")).to_have_value("")
        await page.emulate_media(reduced_motion="reduce")
        await page.get_by_role("button", name="Replace key").click()
        await page.get_by_role("button", name="Show API key").click()
        assert await page.evaluate("document.getAnimations().filter(animation => animation.playState === 'running').length") == 0
        print(f"PASS {browser_type.name}: popup setup ({height:.0f}px), width, validation, save, ready state, replace, errors, reduced motion")
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
            await popup.locator("#api-key").fill("session-test-key")
            await popup.get_by_role("button", name="Save key").click()
            await expect(popup.locator("#ready")).to_be_visible()
            assert await popup.evaluate("chrome.storage.session.get(null)") == {"geminiKey": "session-test-key"}
            stream = """selection => new Promise(resolve => {
              const port = chrome.runtime.connect({name: 'explain'});
              const received = [];
              port.onMessage.addListener(message => {
                received.push(message);
                if (message.done || message.error) resolve(received);
              });
              port.postMessage({selection, context: 'A sentence with a word in it.', title: 'Smoke'});
            })"""
            # The real worker loads the Rust core under the extension CSP and rejects a blank selection.
            assert await popup.evaluate(stream, "   ") == [{"error": "Select some text first."}]
            await popup.reload()
            await expect(popup.locator("#ready")).to_contain_text("Ready to explain")
            await expect(popup.locator("#key-form")).to_be_hidden()
            await evidence(popup, "chromium-extension-popup.png")
            print("PASS Chromium unpacked extension: popup session save and reload, Rust core in the service worker")
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
