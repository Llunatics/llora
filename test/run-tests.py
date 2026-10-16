#!/usr/bin/env python3
"""Real click tests for pomodoro-timer v3 (Playwright + headless Chromium)."""
import http.server, threading, functools, sys, time, shutil, os
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8901

# temp fixtures served from repo root (deleted after)
shutil.copy("/home/hatch/workspace/.tmp-vids/rain-glass.mp4", os.path.join(ROOT, "test-bg.mp4"))

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()

passed, failed = 0, 0
def check(name, cond, extra=""):
    global passed, failed
    if cond: passed += 1; print(f"  PASS {name}")
    else: failed += 1; print(f"  FAIL {name} {extra}")

errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/home/hatch/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
                          args=["--autoplay-policy=no-user-gesture-required"])
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    # NOTE: ERR_TUNNEL_CONNECTION_FAILED is a VM egress-proxy limitation
    # (curl proves the URLs return 200 video/mp4); filter it as environmental.
    def _on_console(m):
        if m.type == "error" and "ERR_TUNNEL_CONNECTION_FAILED" not in m.text:
            errors.append(f"console.{m.type}: {m.text}")
    pg.on("console", _on_console)
    pg.goto(f"http://127.0.0.1:{PORT}/index.html")
    pg.wait_for_timeout(1500)

    check("page loads, clock visible", pg.is_visible("#clockCard"))
    check("bg video element present (double buffer)", pg.eval_on_selector_all(".bg-video", "els => els.length") == 2)

    # --- timer engine: Date.now delta accuracy ---
    pg.evaluate("S.durations.focus = 0.1; T.remaining = durSec('focus'); render();")  # 6s
    pg.click("#btnStartPause")
    pg.wait_for_timeout(2500)
    rem = pg.evaluate("T.remaining")
    check("timer counts down via delta (6s -> ~3-4s left)", 2 <= rem <= 5, f"remaining={rem}")
    check("document.title shows countdown", ":" in pg.title())
    check("colon span rendered", pg.eval_on_selector("[data-time] .colon", "el => el.textContent") == ":")
    pg.click("#btnStartPause")  # pause
    r1 = pg.evaluate("T.remaining")
    pg.wait_for_timeout(1200)
    r2 = pg.evaluate("T.remaining")
    check("pause freezes remaining", r1 == r2, f"{r1} vs {r2}")
    pg.click("#btnReset")
    check("reset restores full duration", pg.evaluate("T.remaining") == 6)

    # --- focus -> breathe -> break cycle ---
    pg.evaluate("S.breathe = true; S.autoContinue = true; T.remaining = 2; start();")
    pg.wait_for_timeout(3000)
    check("focus end -> breathe mode", pg.evaluate("T.mode") == "breathe")
    check("breathing animation class on", pg.eval_on_selector("#clockInner", "el => el.classList.contains('breathing')"))
    check("breathe label", "Tarik Napas" in pg.eval_on_selector(".face-lock [data-mode-label]", "el => el.textContent"))
    pg.evaluate("T.endAt = Date.now() + 800;")  # fast-forward breathe (delta engine!)
    pg.wait_for_timeout(2500)
    check("breathe end -> break mode", pg.evaluate("T.mode") in ("short", "long"), pg.evaluate("T.mode"))
    check("session dots marked", pg.eval_on_selector_all("[data-dots] i.done", "els => els.length") >= 1)
    pg.evaluate("pause(); T.mode='focus'; T.completedFocus=0; T.remaining=durSec('focus'); render();")

    # --- skip ---
    pg.click("#btnSkip")
    check("skip -> break", pg.evaluate("T.mode") in ("short", "long"))
    pg.evaluate("T.mode='focus'; T.completedFocus=0; T.remaining=durSec('focus'); render();")

    # --- clock styles (open settings first) ---
    pg.click("#menuBtn")
    pg.wait_for_timeout(400)
    for style, face in [("lock", "face-lock"), ("serif", "face-serif"), ("mono", "face-mono")]:
        pg.click(f"#stylePicker button[data-style='{style}']")
        vis = pg.eval_on_selector(f".{face}", "el => getComputedStyle(el).display")
        check(f"style {style} shows {face}", vis == "block" and pg.evaluate("S.clockStyle") == style, vis)
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(300)

    # --- drag with fractions ---
    box0 = pg.eval_on_selector("#clockCard", "el => {const r = el.getBoundingClientRect(); return {x: r.x, y: r.y};}")
    pg.mouse.move(box0["x"] + 100, box0["y"] + 40)
    pg.mouse.down()
    pg.mouse.move(box0["x"] + 240, box0["y"] + 130, steps=12)
    pg.mouse.up()
    pg.wait_for_timeout(300)
    pos = pg.evaluate("({left: document.querySelector('#clockCard').style.left, pos: S.clockPos})")
    moved = abs(float(pos["left"].replace("px", "")) - box0["x"]) > 80
    check("drag moves clock", moved, str(pos))
    check("position stored as fractions", isinstance(pos["pos"], dict) and 0 < pos["pos"]["fx"] < 1 and 0 < pos["pos"]["fy"] < 1, str(pos["pos"]))
    pg.evaluate("resetClockPos()")
    check("resetClockPos recenters", pg.eval_on_selector("#clockCard", "el => el.classList.contains('centered')"))

    # --- Satu Hal ---
    pg.fill("#oneThingInput", "Kerjakan laporan")
    pg.wait_for_timeout(300)
    check("one-thing saved", pg.evaluate("S.oneThing.text") == "Kerjakan laporan")
    check("done button appears", pg.is_visible("#oneThingDone"))
    pg.evaluate("dissolveOneThing()")
    pg.wait_for_timeout(900)
    check("one-thing dissolves + clears", pg.evaluate("document.querySelector('#oneThingInput').value") == "")

    # --- background double-buffer with local file ---
    pg.evaluate(f"S.bgCustom = 'http://127.0.0.1:{PORT}/test-bg.mp4'; S.bgId='custom'; save(); switchBackground();")
    pg.wait_for_timeout(4000)
    front_src = pg.evaluate("bgFront.src")
    check("bg switched to local file", "test-bg.mp4" in front_src, front_src[:80])
    check("front video has .on (crossfaded)", pg.eval_on_selector("#bgA.on, #bgB.on", "el => !!el"))
    playing = pg.evaluate("bgFront.readyState >= 2 && !bgFront.paused && bgFront.videoWidth > 0")
    check("bg video actually playing", playing)
    pg.wait_for_timeout(2500)
    tint = pg.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--ambient')")
    check("adaptive tint sampled (not transparent)", tint.strip() not in ("", "transparent"), tint.strip())

    # --- soundscape ---
    pg.evaluate("scSet('pink', 0.4); scSet('brown', 0.2); scSet('gamma', 0.15);")
    pg.wait_for_timeout(500)
    check("soundscape ctx running, 3 nodes", pg.evaluate("!!SC.ctx && !!SC.nodes.pink && !!SC.nodes.brown && !!SC.nodes.gamma"))
    check("gains set", pg.evaluate("SC.nodes.pink.gain.value > 0.1 && SC.nodes.gamma.gain.value > 0"))
    pg.evaluate("scSet('pink', 0); scSet('brown', 0); scSet('gamma', 0);")

    # --- Mode Hening ---
    pg.evaluate("S.hening = true; save(); S.durations.focus = 0.2; T.mode='focus'; T.remaining=durSec('focus'); start();")
    pg.evaluate("lastPointerMove = Date.now() - 7000;")
    pg.wait_for_timeout(1500)
    check("hening fades chrome after 6s idle", pg.evaluate("document.body.classList.contains('hening')"))
    pg.mouse.move(700, 400)
    pg.wait_for_timeout(300)
    check("pointermove wakes chrome", not pg.evaluate("document.body.classList.contains('hening')"))
    pg.evaluate("pause();")

    # --- playlist: titles only, native audio ---
    # make a tiny mp3 fixture
    os.system("ffmpeg -hide_banner -loglevel error -f lavfi -i 'sine=frequency=440:duration=2' -c:a libmp3lame -y " + os.path.join(ROOT, "test-audio.mp3"))
    pg.click("#plFab")
    check("playlist panel opens", pg.is_visible("#playlistPanel"))
    pg.fill("#plUrl", f"http://127.0.0.1:{PORT}/test-audio.mp3")
    pg.click("#plAdd")
    pg.wait_for_timeout(1500)
    items = pg.eval_on_selector_all("#plList li .t", "els => els.map(e => e.textContent)")
    check("track added with title", len(items) == 1 and "test audio" in items[0], str(items))
    check("no visible iframe anywhere", pg.eval_on_selector_all("iframe", "els => els.filter(e => e.offsetWidth > 2 && e.offsetHeight > 2).length") == 0)
    pg.click("#plList li")
    pg.wait_for_timeout(1500)
    check("native audio plays", pg.evaluate("!document.querySelector('#plAudio').paused"))
    check("media session metadata set", pg.evaluate("'mediaSession' in navigator && !!navigator.mediaSession.metadata"))
    pg.click("#plPlayPause")
    pg.wait_for_timeout(300)
    check("pause works", pg.evaluate("document.querySelector('#plAudio').paused"))
    pg.click("#plNext")  # single track wraps
    pg.wait_for_timeout(800)
    check("next wraps single track", pg.evaluate("!document.querySelector('#plAudio').paused"))
    pg.eval_on_selector("#plList li .rm", "el => el.click()")
    pg.wait_for_timeout(300)
    check("remove track", pg.eval_on_selector_all("#plList li", "els => els.length") == 0 or "kosong" in pg.eval_on_selector("#plList", "el => el.textContent"))

    # --- YouTube: title fetch (network may vary) ---
    pg.fill("#plUrl", "https://www.youtube.com/watch?v=aqz-KE-bpKQ")
    pg.click("#plAdd")
    pg.wait_for_timeout(6000)
    items = pg.eval_on_selector_all("#plList li .t", "els => els.map(e => e.textContent)")
    check("youtube track added (noembed or fallback title)", len(items) == 1 and len(items[0]) > 3, str(items))
    check("still no visible player box", pg.eval_on_selector("#ytHidden", "el => el.offsetWidth") <= 2)

    # --- settings toggles ---
    pg.click("#menuBtn")
    check("settings opens", pg.is_visible("#settingsPanel"))
    pg.click("#chkHening")
    check("hening toggle persists", pg.evaluate("S.hening") == False)
    pg.click("#chkHening")
    pg.click("#presetGrid button")
    pg.wait_for_timeout(300)
    check("preset click sets pending src", "cdn.jsdelivr.net" in pg.evaluate("bgBack.dataset.pendingSrc || bgFront.dataset.pendingSrc || ''"))
    pg.keyboard.press("Escape")

    # --- screenshots ---
    pg.set_viewport_size({"width": 390, "height": 844})
    pg.wait_for_timeout(800)
    pg.screenshot(path=os.path.join(ROOT, "assets", "screenshot-mobile.png"))
    pg.set_viewport_size({"width": 1440, "height": 900})
    pg.wait_for_timeout(800)
    pg.screenshot(path=os.path.join(ROOT, "assets", "screenshot-desktop.png"))
    check("screenshots saved", os.path.exists(os.path.join(ROOT, "assets", "screenshot-mobile.png")))
    b.close()

print(f"\n{passed} passed, {failed} failed, {len(errors)} page errors")
for e in errors[:10]: print(" PAGE-ERR:", e[:160])
srv.shutdown()

# cleanup fixtures
for f in ("test-bg.mp4", "test-audio.mp3"):
    p = os.path.join(ROOT, f)
    if os.path.exists(p): os.remove(p)

sys.exit(1 if failed or errors else 0)
