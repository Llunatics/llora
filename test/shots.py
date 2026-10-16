#!/usr/bin/env python3
"""Clean screenshots for README: local bg video playing, timer running."""
import http.server, threading, functools, shutil, os, sys
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8902
shutil.copy("/home/hatch/workspace/.tmp-vids/rain-glass.mp4", os.path.join(ROOT, "test-bg.mp4"))
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/home/hatch/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
                          args=["--autoplay-policy=no-user-gesture-required"])
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.goto(f"http://127.0.0.1:{PORT}/index.html")
    pg.wait_for_timeout(1200)
    # local bg (VM proxy blocks remote), start a session, type one-thing
    pg.evaluate(f"S.bgCustom = 'http://127.0.0.1:{PORT}/test-bg.mp4'; S.bgId='custom'; S.hening=false; save(); switchBackground();")
    pg.wait_for_timeout(3500)
    pg.evaluate("S.durations.focus = 25; T.remaining = 24*60+59; start();")
    pg.fill("#oneThingInput", "Selesaikan desain")
    pg.wait_for_timeout(1200)
    pg.set_viewport_size({"width": 390, "height": 844})
    pg.wait_for_timeout(600)
    pg.screenshot(path=os.path.join(ROOT, "assets", "screenshot-mobile.png"))
    pg.set_viewport_size({"width": 1440, "height": 900})
    pg.wait_for_timeout(600)
    pg.screenshot(path=os.path.join(ROOT, "assets", "screenshot-desktop.png"))
    b.close()
srv.shutdown()
os.remove(os.path.join(ROOT, "test-bg.mp4"))
print("screenshots refreshed")
