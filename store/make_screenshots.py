"""Render the Chrome Web Store screenshots and promo tile from the real extension UI.

Run from the repo root: python store/make_screenshots.py
Each screenshot is a captioned browser window. The article, popup, and content script are
served from disk through a routed origin and chrome.* is stubbed, so no API key or network
access is needed. The context menu is a drawn mock, since native menus cannot be captured.
"""
import asyncio
import mimetypes
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
STORE = ROOT / "store"
ORIGIN = "https://explain.test"

ANSWER = ("Syzygy is the straight-line alignment of three celestial bodies. Here it means the Sun, "
          "the Moon, and Earth lining up at new and full moon, so their pulls combine and produce "
          "the larger spring tides described in the next sentence.")
ERROR = "Google rate or usage limit reached. Try again later."

SHOTS = {
    "1-context-menu.png": "Select text, right-click, choose Explain",
    "2-streaming.png": "The answer streams in beside your text",
    "3-explanation.png": "Understand it without leaving the page",
    "4-error-retry.png": "Clear errors, one click to retry",
    "5-popup.png": "Bring your own free Gemini key",
}

ARTICLE = """<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Why the Sea Rises Twice a Day</title>
<style>
body{margin:0;background:#fbfaf7;color:#24272b;font:19px/1.75 Charter,Georgia,'Times New Roman',serif}
::selection{background:#cddbf6}
main{max-width:680px;margin:0 auto;padding:56px 24px 80px}
.kicker{font:600 12.5px/1 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#8a7d64}
h1{font-size:38px;line-height:1.15;margin:14px 0 10px;font-weight:600;letter-spacing:-.01em}
.dek{color:#62666d;font-style:italic;margin:0 0 30px}
p{margin:0 0 22px}
.menu{position:fixed;width:244px;padding:5px;border-radius:9px;background:#fff;
  box-shadow:0 0 0 1px #0000001a,0 4px 10px #00000014,0 14px 36px #00000024;font:13px/1 system-ui,sans-serif;color:#1f2329}
.menu div{display:flex;align-items:center;gap:10px;height:30px;padding:0 10px 0 34px;border-radius:5px;white-space:nowrap}
.menu .sep{height:1px;margin:5px 4px;padding:0;background:#0000001a;border-radius:0}
.menu .on{padding-left:10px;background:#315dad;color:#fff}
.menu .on img{width:16px;height:16px;border-radius:4px;box-shadow:0 0 0 1px #ffffff55}
.cursor{position:fixed;width:20px;height:20px;filter:drop-shadow(0 1px 1px #0000004d)}
</style></head><body>
<main>
<div class="kicker">Notes on the natural world</div>
<h1>Why the Sea Rises Twice a Day</h1>
<p class="dek">A short essay on the Moon, the Sun, and the patient rhythm of the shore.</p>
<p>Anyone who has spent a week by the coast learns that the water keeps its own calendar. Twice each day it climbs the beach, and twice it withdraws, arriving a little later every morning than it did the morning before.</p>
<p id="copy">The Moon does most of the work, pulling the near side of the ocean toward it while the far side lags behind. Twice a month, at <b>syzygy</b>, the Sun adds its own pull to the Moon's. The result is the spring tide, when high water reaches farthest up the sand and low water uncovers rocks that are hidden for the rest of the month.</p>
<p>Between those dates the two bodies pull at right angles, and the neap tides that follow are modest. Sailors and fishers have planned around this cycle for centuries, long before anyone could explain why it happened.</p>
<p>Local geography shapes the rest. A narrow bay can funnel the incoming water into a surge many meters high, while an enclosed sea may barely notice the Moon at all.</p>
</main></body></html>"""

FRAME = """<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
body{margin:0;width:1280px;height:800px;overflow:hidden;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;
  background:radial-gradient(900px 420px at 50% -80px,#dfe8f8,transparent),linear-gradient(180deg,#eef2f9,#e7ecf5)}
.caption{position:absolute;top:60px;left:0;right:0;text-align:center}
h1{margin:0;color:#18202d;font-size:34px;line-height:42px;font-weight:600;letter-spacing:-.02em}
.window{position:absolute;left:96px;top:170px;width:1088px;height:690px;border-radius:12px;overflow:hidden;background:#fff;
  box-shadow:0 0 0 1px #0f172a1a,0 2px 6px #0f172a0f,0 24px 60px -12px #0f172a40}
.bar{height:46px;display:flex;align-items:center;gap:14px;padding:0 16px;background:#f1f3f6;border-bottom:1px solid #e1e5eb;font-size:13px;color:#5b6575}
.dots{display:flex;gap:8px}.dots i{width:12px;height:12px;border-radius:50%;background:#d3d8df}
.url{flex:1;max-width:560px;height:30px;display:flex;align-items:center;margin-left:12px;padding:0 14px;border-radius:15px;background:#fff;box-shadow:0 0 0 1px #0f172a12}
.ext{margin-left:auto;width:30px;height:30px;display:grid;place-items:center;border-radius:8px}
.ext img{width:18px;height:18px}
.ext.on{background:#dfe4ec}
iframe{display:block;width:100%;height:644px;border:0}
.popup{position:absolute;top:50px;right:10px;width:336px;border:0;border-radius:12px;background:#f6f7fa;
  box-shadow:0 0 0 1px #0f172a1f,0 8px 20px #0f172a1a,0 24px 48px -12px #0f172a40}
</style></head><body>
<div class="caption"><h1></h1></div>
<div class="window"><div class="bar"><span class="dots"><i></i><i></i><i></i></span><span class="url">example.org/essays/tides</span>
<span class="ext"><img src="/extension/icons/icon-32.png" alt=""></span></div><iframe src="/article.html"></iframe></div>
</body></html>"""

# Stands in for the extension runtime: the context menu message and the streaming port.
STUB = """(() => {
  window.ports = [];
  window.chrome = {
    storage: {session: {get: async () => ({})}},
    runtime: {
      onMessage: {addListener(fn) { window.menu = selection => fn({type: 'explain', selection}); }},
      sendMessage: () => new Promise(() => {}),
      connect() {
        const port = {listeners: [], postMessage() {}, disconnect() {},
          onMessage: {addListener(fn) { port.listeners.push(fn); }}, onDisconnect: {addListener() {}},
          emit(message) { port.listeners.forEach(fn => fn(message)); }};
        window.ports.push(port);
        return port;
      },
    },
  };
})()"""


async def serve(route):
    path = route.request.url.removeprefix(ORIGIN + "/")
    if path in ("frame.html", "article.html"):
        return await route.fulfill(body=FRAME if path == "frame.html" else ARTICLE, content_type="text/html")
    file = ROOT / path
    await route.fulfill(body=file.read_bytes(), content_type=mimetypes.guess_type(file.name)[0] or "text/plain")


async def window(context, name):
    page = await context.new_page()
    await page.goto(f"{ORIGIN}/frame.html")
    await page.evaluate("t => { document.querySelector('h1').textContent = t; }", SHOTS[name])
    article = page.frames[1]
    await article.wait_for_load_state()
    await article.evaluate("""() => {
      scrollTo(0, 184);
      const range = document.createRange();
      range.selectNodeContents(document.querySelector('#copy b'));
      getSelection().removeAllRanges(); getSelection().addRange(range);
    }""")
    await page.evaluate("document.fonts.ready")
    return page, article


async def explain(article):
    await article.add_script_tag(url=f"{ORIGIN}/extension/content.js")
    await article.evaluate("window.menu('syzygy')")


async def shot(page, name):
    await page.wait_for_timeout(400)
    await page.screenshot(path=str(STORE / "screenshots" / name), animations="disabled")
    await page.close()


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context(viewport={"width": 1280, "height": 800}, device_scale_factor=1)
        await context.route(f"{ORIGIN}/**", serve)
        await context.add_init_script(STUB)

        name = "1-context-menu.png"
        page, article = await window(context, name)
        await article.evaluate("""origin => {
          const word = document.querySelector('#copy b').getBoundingClientRect();
          const x = word.left + word.width / 2, y = word.bottom - 4;
          const menu = document.createElement('div');
          menu.className = 'menu';
          menu.style.cssText = `left:${x}px;top:${y}px`;
          menu.innerHTML = '<div>Copy</div><div>Search Google for “syzygy”</div><div>Print…</div>'
            + '<div class="sep"></div><div class="on"><img src="' + origin + '/extension/icons/icon-32.png" alt="">Explain</div>'
            + '<div class="sep"></div><div>Inspect</div>';
          document.body.append(menu);
          const item = menu.querySelector('.on').getBoundingClientRect();
          const cursor = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          cursor.setAttribute('viewBox', '0 0 20 20');
          cursor.classList.add('cursor');
          cursor.style.cssText = `left:${item.left + 92}px;top:${item.top + 12}px`;
          cursor.innerHTML = '<path d="M3 2v14l4-3.6 2.6 5.6 2.4-1.1-2.6-5.5H15z" fill="#111" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/>';
          document.body.append(cursor);
        }""", ORIGIN)
        await shot(page, name)

        name = "2-streaming.png"
        page, article = await window(context, name)
        await explain(article)
        words = ANSWER.split(" ")[:24]
        for index, word in enumerate(words):
            await article.evaluate("t => window.ports.at(-1).emit({text: t})", word if index == 0 else " " + word)
        await shot(page, name)

        name = "3-explanation.png"
        page, article = await window(context, name)
        await explain(article)
        await article.evaluate("a => { window.ports.at(-1).emit({text: a}); window.ports.at(-1).emit({done: true}); }", ANSWER)
        await page.wait_for_timeout(1600)  # let every character finish fading in
        await shot(page, name)

        name = "4-error-retry.png"
        page, article = await window(context, name)
        await explain(article)
        await article.evaluate("e => window.ports.at(-1).emit({error: e})", ERROR)
        await shot(page, name)

        name = "5-popup.png"
        page, article = await window(context, name)
        await page.evaluate("""origin => {
          document.querySelector('.ext').classList.add('on');
          const frame = document.createElement('iframe');
          frame.className = 'popup';
          frame.src = origin + '/extension/popup.html';
          document.querySelector('.window').append(frame);
        }""", ORIGIN)
        popup = page.frames[-1]
        await popup.wait_for_selector("#key-form:not([hidden])")
        await popup.focus("#api-key")
        height = await popup.evaluate("Math.ceil(document.querySelector('main').getBoundingClientRect().bottom)")
        await page.evaluate("h => document.querySelector('.popup').style.height = h + 'px'", height)
        await shot(page, name)

        tile = await context.new_page()
        await tile.set_viewport_size({"width": 440, "height": 280})
        await tile.set_content(f"""<body style="margin:0;height:280px;display:grid;place-items:center;-webkit-font-smoothing:antialiased;
          background:radial-gradient(360px 200px at 50% 0,#dfe8f8,transparent),linear-gradient(180deg,#eef2f9,#e7ecf5);
          font-family:system-ui,-apple-system,'Segoe UI',sans-serif"><div style="text-align:center">
          <div style="display:flex;align-items:center;justify-content:center;gap:16px">
          <img src="{ORIGIN}/extension/icons/icon-128.png" alt="" style="width:84px;height:84px;filter:drop-shadow(0 2px 3px #17326833) drop-shadow(0 10px 14px #315dad40)">
          <span style="color:#18202d;font-size:46px;font-weight:600;letter-spacing:-1.2px">Explain</span></div>
          <p style="margin:18px 0 0;color:#5d6778;font-size:16px;line-height:22px">Right-click any text for a clear, plain answer.</p>
          </div></body>""")
        await tile.wait_for_load_state()
        await tile.screenshot(path=str(STORE / "promo-440x280.png"))
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
