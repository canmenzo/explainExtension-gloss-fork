"""Render the Chrome Web Store screenshots and promo tile from the real extension UI.

Run from the repo root: python store/make_screenshots.py
The page, popup, and content script are served from disk through a routed origin, and
chrome.* is stubbed with fixture responses, so no API key or network access is needed.
"""
import asyncio
import mimetypes
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
STORE = ROOT / "store"
ORIGIN = "https://explain.test"
HOST = "[aria-label='Explain selection']"

ANSWER = ("Syzygy is the straight-line alignment of three celestial bodies. Here it means the Sun, "
          "the Moon, and Earth lining up at new and full moon, so their pulls combine and produce "
          "the larger spring tides described in the next sentence.")
ERROR = "Google rate or usage limit reached. Try again later."

ARTICLE = """<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Why the Sea Rises Twice a Day</title>
<style>
body{margin:0;background:#f6f5f1;color:#24272b;font:19px/1.75 Georgia,'Times New Roman',serif}
.bar{position:fixed;top:0;left:0;right:0;height:52px;display:flex;align-items:center;gap:16px;padding:0 20px;
  background:#e9ebef;border-bottom:1px solid #d5d9e0;font:13px/1 'Segoe UI',system-ui,sans-serif;color:#59677a;z-index:1}
.dots{display:flex;gap:8px}.dots i{width:12px;height:12px;border-radius:50%;background:#c9ced6}
.url{flex:1;max-width:640px;height:32px;display:flex;align-items:center;padding:0 14px;border-radius:16px;background:#fff}
.ext{margin-left:auto;width:32px;height:32px;display:grid;place-items:center;border-radius:8px}
.ext img{width:20px;height:20px}
.ext.on{background:#d5dbe5}
main{max-width:720px;margin:0 auto;padding:104px 24px 80px}
.kicker{font:600 13px/1 'Segoe UI',system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#7a6f5c}
h1{font-size:40px;line-height:1.15;margin:14px 0 10px;font-weight:600}
.dek{color:#5d6168;font-style:italic;margin:0 0 32px}
p{margin:0 0 24px}
</style></head><body>
<div class="bar"><span class="dots"><i></i><i></i><i></i></span><span class="url">example.org/essays/tides</span><span class="ext"><img src="/extension/icons/icon-32.png" alt=""></span></div>
<main>
<div class="kicker">Notes on the natural world</div>
<h1>Why the Sea Rises Twice a Day</h1>
<p class="dek">A short essay on the Moon, the Sun, and the patient rhythm of the shore.</p>
<p>Anyone who has spent a week by the coast learns that the water keeps its own calendar. Twice each day it climbs the beach, and twice it withdraws, arriving a little later every morning than it did the morning before.</p>
<p id="copy">The Moon does most of the work, pulling the near side of the ocean toward it while the far side lags behind. Twice a month, at <b>syzygy</b>, the Sun adds its own pull to the Moon's. The result is the spring tide, when high water reaches farthest up the sand and low water uncovers rocks that are hidden for the rest of the month.</p>
<p>Between those dates the two bodies pull at right angles, and the neap tides that follow are modest. Sailors and fishers have planned around this cycle for centuries, long before anyone could explain why it happened.</p>
<p>Local geography shapes the rest. A narrow bay can funnel the incoming water into a surge many meters high, while an enclosed sea may barely notice the Moon at all.</p>
</main></body></html>"""

STUB = """(() => {
  const attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function(options) {
    const shadow = attach.call(this, options);
    if (this.getAttribute('aria-label') === 'Explain selection') window.testShadow = shadow;
    return shadow;
  };
  window.pending = [];
  window.chrome = {
    storage: {session: {get: async () => ({})}},
    runtime: {sendMessage: message => new Promise(resolve => window.pending.push({message, resolve}))},
  };
})()"""


async def serve(route):
    path = route.request.url.removeprefix(ORIGIN + "/")
    if path == "article.html":
        return await route.fulfill(body=ARTICLE, content_type="text/html")
    file = ROOT / path
    await route.fulfill(body=file.read_bytes(), content_type=mimetypes.guess_type(file.name)[0] or "text/plain")


async def article(context):
    page = await context.new_page()
    await page.goto(f"{ORIGIN}/article.html")
    await page.evaluate("document.fonts.ready")
    return page


async def select_word(page):
    await page.add_script_tag(url=f"{ORIGIN}/extension/content.js")
    await page.evaluate("""() => {
      const target = document.querySelector('#copy');
      target.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}));
      const range = document.createRange();
      range.selectNodeContents(target.querySelector('b'));
      getSelection().removeAllRanges(); getSelection().addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      target.dispatchEvent(new PointerEvent('pointerup', {bubbles: true}));
    }""")
    await page.wait_for_selector(f"{HOST}[data-state='actions']", state="attached")


async def shot(page, name):
    await page.wait_for_timeout(400)
    await page.screenshot(path=str(STORE / "screenshots" / name))


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context(viewport={"width": 1280, "height": 800}, device_scale_factor=1)
        await context.route(f"{ORIGIN}/**", serve)
        await context.add_init_script(STUB)

        page = await article(context)
        await page.evaluate("""origin => {
          document.querySelector('.ext').classList.add('on');
          const frame = document.createElement('iframe');
          frame.src = origin + '/extension/popup.html';
          frame.style.cssText = 'position:fixed;top:58px;right:14px;width:336px;height:200px;border:0;border-radius:10px;'
            + 'background:#f8fafc;box-shadow:0 0 0 1px #0000001a,0 12px 40px #0000002e;z-index:2';
          document.body.append(frame);
        }""", ORIGIN)
        frame = page.frame_locator("iframe")
        await frame.locator("#key-state", has_text="Setup needed").wait_for()
        height = await page.frames[1].evaluate("document.documentElement.scrollHeight")
        await page.evaluate("h => document.querySelector('iframe').style.height = h + 'px'", height)
        await shot(page, "1-popup-setup.png")
        await page.close()

        page = await article(context)
        await select_word(page)
        await shot(page, "2-explain-action.png")

        await page.keyboard.press("Enter")
        await page.wait_for_selector(f"{HOST}[data-phase='loading']", state="attached")
        await page.evaluate("a => window.pending.at(-1).resolve({answer: a})", ANSWER)
        await page.wait_for_selector(f"{HOST}[data-phase='answer']", state="attached")
        await shot(page, "3-explanation.png")

        await page.keyboard.press("Escape")
        await select_word(page)
        await page.keyboard.press("Enter")
        await page.wait_for_selector(f"{HOST}[data-phase='loading']", state="attached")
        await page.evaluate("e => window.pending.at(-1).resolve({error: e})", ERROR)
        await page.wait_for_selector(f"{HOST}[data-phase='error']", state="attached")
        await shot(page, "4-error-retry.png")
        await page.close()

        tile = await context.new_page()
        await tile.set_viewport_size({"width": 440, "height": 280})
        await tile.set_content(f"""<body style="margin:0;height:280px;display:grid;place-items:center;background:#f8fafc;
          font-family:'Segoe UI',system-ui,sans-serif"><div style="display:flex;align-items:center;gap:24px">
          <img src="{ORIGIN}/extension/icons/icon-128.png" alt="" style="width:104px;height:104px">
          <span style="color:#202b3a;font-size:56px;font-weight:600;letter-spacing:-1.4px">Explain</span></div></body>""")
        await tile.wait_for_load_state()
        await tile.screenshot(path=str(STORE / "promo-440x280.png"))
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
