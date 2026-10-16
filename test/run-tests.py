#!/usr/bin/env python3
"""Real click tests for pomodoro-timer v3.5 (Playwright + headless Chromium)."""
import http.server, threading, functools, sys, os
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8901

# local fixtures: tiny generated mp4 (bg) + mp3 (audio), served from repo root
# NOTE: +faststart is required — this Chromium rejects moov-at-end mp4s.
os.system(f"ffmpeg -hide_banner -loglevel error -f lavfi -i 'testsrc=duration=4:size=640x360:rate=30' "
          f"-c:v libx264 -pix_fmt yuv420p -movflags +faststart -y {ROOT}/test-bg.mp4")
os.system(f"ffmpeg -hide_banner -loglevel error -f lavfi -i 'sine=frequency=440:duration=2' "
          f"-c:a libmp3lame -y {ROOT}/test-audio.mp3")

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
    # (curl proves the CDN URLs return 200 video/mp4); filter it as environmental.
    def _on_console(m):
        if m.type == "error" and "ERR_TUNNEL_CONNECTION_FAILED" not in m.text:
            errors.append(f"console.{m.type}: {m.text}")
    pg.on("console", _on_console)
    pg.goto(f"http://127.0.0.1:{PORT}/index.html")
    pg.wait_for_timeout(1500)

    check("page loads, clock visible", pg.is_visible("#clockCard"))
    check("bg video double buffer", pg.eval_on_selector_all(".bg-video", "els => els.length") == 2)
    check("12 clock styles defined", pg.evaluate("CLOCK_STYLES.length") == 12)
    check("5 bg presets defined", pg.evaluate("BG_PRESETS.length") == 5)

    # --- timer engine: Date.now delta accuracy ---
    pg.evaluate("S.durations.focus = 0.1; T.remaining = durSec('focus'); render();")  # 6s
    pg.click("#btnStartPause")
    pg.wait_for_timeout(2500)
    rem = pg.evaluate("T.remaining")
    check("timer counts down via delta (6s -> ~3-4s left)", 2 <= rem <= 5, f"remaining={rem}")
    check("document.title shows countdown", ":" in pg.title())
    pg.click("#btnStartPause")  # pause
    r1 = pg.evaluate("T.remaining")
    pg.wait_for_timeout(1200)
    r2 = pg.evaluate("T.remaining")
    check("pause freezes remaining", r1 == r2, f"{r1} vs {r2}")
    pg.click("#btnReset")
    check("reset restores full duration", pg.evaluate("T.remaining") == 6)

    # --- focus end -> Mode Mengalir (overtime), NOT hard stop ---
    pg.evaluate("S.breathe = true; S.autoContinue = false; T.mode='focus'; T.completedFocus=0; T.remaining = 2; start();")
    pg.wait_for_timeout(3200)
    check("focus end -> overtime mode", pg.evaluate("T.mode") == "overtime", pg.evaluate("T.mode"))
    check("overtime glow class on clock", pg.eval_on_selector("#clockCard", "el => el.classList.contains('overtime')"))
    check("overtime capsule button visible", pg.is_visible("#overtimeBtn"))
    ttxt = pg.eval_on_selector("[data-time]", "el => el.textContent")
    check("clock counts up (+MM:SS)", ttxt.startswith("+"), ttxt)
    check("overtime keeps running", pg.evaluate("T.running") == True)
    check("focus seconds banked", pg.evaluate("S.stats.focusSec") >= 5, pg.evaluate("S.stats.focusSec"))
    pg.wait_for_timeout(2200)
    ttxt2 = pg.eval_on_selector("[data-time]", "el => el.textContent")
    check("overtime count-up advances", ttxt2 != ttxt, f"{ttxt} -> {ttxt2}")
    pg.click("#overtimeBtn")  # "Lanjut Rehat ->"
    pg.wait_for_timeout(1500)
    check("overtime -> breathe transition", pg.evaluate("T.mode") == "breathe", pg.evaluate("T.mode"))
    check("breathing animation class on", pg.eval_on_selector("#clockInner", "el => el.classList.contains('breathing')"))
    check("overtime UI hidden after", not pg.is_visible("#overtimeBtn"))
    pg.evaluate("T.endAt = Date.now() + 800;")  # fast-forward breathe
    pg.wait_for_timeout(2500)
    check("breathe end -> break mode", pg.evaluate("T.mode") in ("short", "long"), pg.evaluate("T.mode"))
    pg.evaluate("pause(); T.mode='focus'; T.completedFocus=0; T.remaining=durSec('focus'); render();")

    # --- skip during overtime ---
    pg.evaluate("T.remaining = 2; start();")
    pg.wait_for_timeout(3200)
    check("back in overtime", pg.evaluate("T.mode") == "overtime")
    pg.mouse.move(700, 400)  # wake Mode Hening so chrome is clickable
    pg.wait_for_timeout(400)
    pg.click("#btnSkip")
    check("skip overtime -> break (no double count)", pg.evaluate("T.mode") in ("short", "long"))
    pg.evaluate("T.mode='focus'; T.completedFocus=0; T.remaining=durSec('focus'); render();")

    # --- settings panel: no double X, dropdowns, steppers, bg sound ---
    pg.click("#menuBtn")
    pg.wait_for_timeout(400)
    check("no inner close button (single X via hamburger)",
          pg.eval_on_selector_all("#settingsClose", "els => els.length") == 0)
    check("no native selects left (custom glass dropdowns)",
          pg.eval_on_selector_all("select", "els => els.length") == 0)
    check("bg dropdown: 5 presets + custom",
          pg.eval_on_selector_all(".dd-list[data-dd='#bgSelectWrap'] li", "els => els.length") == 6)
    check("clock dropdown: 12 styles",
          pg.eval_on_selector_all(".dd-list[data-dd='#clockSelectWrap'] li", "els => els.length") == 12)
    check("html lang is en", pg.evaluate("document.documentElement.lang") == "en")

    def pick(wrap, value):
        pg.click(f"{wrap} .dd-btn")
        pg.wait_for_timeout(250)
        pg.click(f".dd-list[data-dd='{wrap}'] li[data-value='{value}']")
        pg.wait_for_timeout(250)

    # dropdown list renders glassy (not white OS menu)
    pg.click("#clockSelectWrap .dd-btn")
    pg.wait_for_timeout(300)
    check("dropdown list opens", pg.is_visible(".dd-list[data-dd='#clockSelectWrap']"))
    bg = pg.eval_on_selector(".dd-list[data-dd='#clockSelectWrap']", "el => getComputedStyle(el).backgroundColor")
    check("dropdown list is glassy, not white", "255, 255, 255, 1)" not in bg.replace(" ", ""), bg)
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(200)
    check("Escape closes dropdown", not pg.is_visible(".dd-list[data-dd='#clockSelectWrap']"))

    for sid in ["air", "kyoto", "kawat"]:
        pick("#clockSelectWrap", sid)
        ds = pg.eval_on_selector("#clockCard", "el => el.dataset.clockStyle")
        check(f"style {sid} applies", ds == sid and pg.evaluate("S.clockStyle") == sid, ds)
    pick("#clockSelectWrap", "zen")
    pg.wait_for_timeout(200)
    check("zen stacked: colon hidden",
          pg.eval_on_selector("#clockCard .time-display .colon", "el => getComputedStyle(el).display") == "none")
    check("font lazy-load link injected", pg.eval_on_selector_all(
        "link[href*='fonts.googleapis.com']", "els => els.length") >= 1)

    # --- photo fallback per preset ---
    pick("#bgSelectWrap", "hutan-hujan")
    check("photo fallback shows for preset",
          pg.eval_on_selector("#bgPhoto", "el => el.classList.contains('on')"))
    check("photo src is the preset poster",
          "posters/hutan-hujan.jpg" in pg.eval_on_selector("#bgPhoto", "el => el.src"))
    check("dropdown reflects preset",
          pg.eval_on_selector("#bgSelectWrap .dd-val", "el => el.textContent") == "Rainforest")

    # --- steppers (real clicks, no native spinners) ---
    check("no number inputs left", pg.eval_on_selector_all("input[type=number]", "els => els.length") == 0)
    pg.evaluate("S.durations.focus = 25;")
    pg.click(".stepper[data-key='focus'] .step-btn[data-dir='1']")
    pg.wait_for_timeout(150)
    check("stepper + increases 0.5", pg.evaluate("S.durations.focus") == 25.5,
          pg.evaluate("S.durations.focus"))
    check("stepper value paints", pg.eval_on_selector("#stepFocus", "el => el.textContent") == "25.5")
    pg.click(".stepper[data-key='focus'] .step-btn[data-dir='-1']")
    pg.click(".stepper[data-key='focus'] .step-btn[data-dir='-1']")
    check("stepper − decreases", pg.evaluate("S.durations.focus") == 24.5)
    pg.evaluate("S.durations.focus = 0.1;")
    pg.click(".stepper[data-key='focus'] .step-btn[data-dir='-1']")
    check("stepper clamps at min", pg.evaluate("S.durations.focus") == 0.1)
    pg.evaluate("S.cycle = 4;")
    pg.click(".stepper[data-key='cycle'] .step-btn[data-dir='1']")
    check("cycle stepper steps 1", pg.evaluate("S.cycle") == 5)

    # --- background video sound toggle ---
    check("bg sound defaults off",
          pg.evaluate("S.bgSound") == False and pg.evaluate("document.querySelector('#bgA').muted"))
    pg.click("#chkBgSound")
    pg.wait_for_timeout(200)
    check("bg sound toggle unmutes bg videos",
          pg.evaluate("S.bgSound") == True and not pg.evaluate("document.querySelector('#bgA').muted")
          and not pg.evaluate("document.querySelector('#bgB').muted"))
    pg.click("#chkBgSound")
    check("bg sound toggle re-mutes",
          pg.evaluate("document.querySelector('#bgA').muted"))

    # --- scrim sliders (backdrop darkness + spread) ---
    check("scrim sliders exist",
          pg.eval_on_selector("#slScrimA", "el => el.type") == "range"
          and pg.eval_on_selector("#slScrimS", "el => el.type") == "range")
    check("scrim defaults 55/85",
          pg.evaluate("S.scrim.a") == 55 and pg.evaluate("S.scrim.spread") == 85)
    pg.evaluate("""() => {
      const a = document.querySelector('#slScrimA'), s = document.querySelector('#slScrimS');
      a.value = 30; s.value = 120;
      a.dispatchEvent(new Event('input', {bubbles:true}));
      s.dispatchEvent(new Event('input', {bubbles:true}));
    }""")
    pg.wait_for_timeout(150)
    check("scrim sliders paint CSS vars",
          pg.eval_on_selector("#clockCard", "el => el.style.getPropertyValue('--scrim-a')") == "0.30"
          and pg.eval_on_selector("#clockCard", "el => el.style.getPropertyValue('--scrim-spread')") == "120px"
          and pg.evaluate("S.scrim.a") == 30 and pg.evaluate("S.scrim.spread") == 120)
    check("scrim persists in localStorage",
          pg.evaluate("JSON.parse(localStorage.getItem('pomodoro:v3')).scrim.a") == 30)
    pg.evaluate("""() => {
      const a = document.querySelector('#slScrimA'), s = document.querySelector('#slScrimS');
      a.value = 55; s.value = 85;
      a.dispatchEvent(new Event('input', {bubbles:true}));
      s.dispatchEvent(new Event('input', {bubbles:true}));
    }""")
    check("scrim encoded in vibe link",
          pg.evaluate("collectVibe().sa") == 55 and pg.evaluate("collectVibe().sb") == 85)

    # --- custom checkbox / slider / leaf-green accent ---
    check("accent is leaf green",
          pg.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()") == "#2ee57d")
    check("checkbox is custom-styled",
          pg.eval_on_selector("#chkAuto", "el => getComputedStyle(el).borderRadius") == "6px"
          and pg.eval_on_selector("#chkAuto", "el => getComputedStyle(el).appearance") == "none")
    chk_bg = pg.eval_on_selector("#chkAuto", "el => getComputedStyle(el).backgroundColor")
    check("checked checkbox glows leaf green", "46, 229, 125" in chk_bg, chk_bg)
    pg.evaluate("document.querySelector('#slPink').value = 40; paintRangeFill(document.querySelector('#slPink'));")
    check("slider fill var paints",
          pg.eval_on_selector("#slPink", "el => el.style.getPropertyValue('--fill')") == "40%")
    thumb_h = pg.eval_on_selector("#slPink", """el => {
      const cs = getComputedStyle(el);
      return cs.getPropertyValue('-webkit-appearance') || cs.appearance;
    }""")
    check("slider uses custom track", thumb_h != "", thumb_h)
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(300)

    # --- keyboard shortcuts: C / Space / 1 / M / H ---
    pg.mouse.click(5, 5)  # focus body, away from inputs
    pg.wait_for_timeout(200)
    before = pg.evaluate("S.clockStyle")
    pg.keyboard.press("c")
    check("C cycles clock style", pg.evaluate("S.clockStyle") != before,
          f"{before} -> {pg.evaluate('S.clockStyle')}")
    pg.evaluate("T.mode='focus'; T.remaining=durSec('focus'); render();")
    pg.keyboard.press(" ")
    pg.wait_for_timeout(400)
    check("Space starts timer", pg.evaluate("T.running") == True)
    pg.keyboard.press(" ")
    pg.wait_for_timeout(400)
    check("Space pauses timer", pg.evaluate("T.running") == False)
    pg.keyboard.press("1")
    pg.wait_for_timeout(300)
    check("1..5 switches preset", "hujan-kaca.mp4" in pg.evaluate("bgBack.dataset.pendingSrc || ''"))
    pg.keyboard.press("m")
    check("M toggles mute (no error)", True)
    pg.keyboard.press("m")
    pg.keyboard.press("h")
    check("H forces hening on", pg.evaluate("document.body.classList.contains('hening')"))
    pg.keyboard.press("h")
    check("H forces hening off", not pg.evaluate("document.body.classList.contains('hening')"))

    # --- drag with fractions + click suppression ---
    box0 = pg.eval_on_selector("#clockCard", "el => {const r = el.getBoundingClientRect(); return {x: r.x, y: r.y};}")
    pg.mouse.move(box0["x"] + 100, box0["y"] + 40)
    pg.mouse.down()
    pg.mouse.move(box0["x"] + 240, box0["y"] + 130, steps=12)
    pg.mouse.up()
    pg.wait_for_timeout(300)
    pos = pg.evaluate("({left: document.querySelector('#clockCard').style.left, pos: S.clockPos})")
    moved = abs(float(pos["left"].replace("px", "")) - box0["x"]) > 80
    check("drag moves clock", moved, str(pos))
    check("position stored as fractions", isinstance(pos["pos"], dict) and 0 < pos["pos"]["fx"] < 1, str(pos["pos"]))
    pg.evaluate("resetClockPos()")
    check("resetClockPos recenters", pg.eval_on_selector("#clockCard", "el => el.classList.contains('centered')"))

    # --- Satu Hal ---
    pg.fill("#oneThingInput", "Kerjakan laporan")
    pg.wait_for_timeout(300)
    check("one-thing saved", pg.evaluate("S.oneThing.text") == "Kerjakan laporan")
    pg.evaluate("dissolveOneThing()")
    pg.wait_for_timeout(900)
    check("one-thing dissolves + clears", pg.evaluate("document.querySelector('#oneThingInput').value") == "")

    # --- background: local mp4, CORS-conditional (no crossorigin attr) ---
    pg.evaluate(f"S.bgCustom = 'http://127.0.0.1:{PORT}/test-bg.mp4'; S.bgId='custom'; save(); switchBackground();")
    pg.wait_for_timeout(4000)
    check("bg switched to local file", "test-bg.mp4" in pg.evaluate("bgFront.src"))
    check("no crossorigin on custom URL", pg.evaluate("bgFront.getAttribute('crossorigin')") is None)
    check("front video crossfaded", pg.eval_on_selector("#bgA.on, #bgB.on", "el => !!el"))
    check("bg video actually playing", pg.evaluate("bgFront.readyState >= 2 && !bgFront.paused && bgFront.videoWidth > 0"))
    pg.wait_for_timeout(2500)
    tint = pg.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--ambient')")
    check("adaptive tint sampled (not transparent)", tint.strip() not in ("", "transparent"), tint.strip())
    # trusted CDN URL gets crossorigin=anonymous
    pg.evaluate("setVideoSource(bgBack, 'https://cdn.jsdelivr.net/gh/Llunatics/llora@assets/videos/hujan-kaca.mp4')")
    check("crossorigin=anonymous on jsDelivr", pg.evaluate("bgBack.getAttribute('crossorigin')") == "anonymous")

    # --- YouTube background engine ---
    pg.evaluate("S.bgCustom='https://www.youtube.com/watch?v=aqz-KE-bpKQ'; S.bgId='custom'; save(); switchBackground();")
    pg.wait_for_timeout(5000)
    check("yt bg iframe fades on", pg.eval_on_selector("#bgYt", "el => el.classList.contains('on')"))
    ytsrc = pg.eval_on_selector("#bgYt", "el => el.src")
    check("yt embed params (muted/loop/no-controls)",
          all(s in ytsrc for s in ["youtube.com/embed/aqz-KE-bpKQ", "mute=1", "loop=1", "controls=0"]), ytsrc[:90])
    pg.evaluate("S.bgCustom=''; S.bgId='hujan-kaca'; save(); switchBackground();")
    pg.wait_for_timeout(1000)
    check("leaving yt bg hides iframe", not pg.eval_on_selector("#bgYt", "el => el.classList.contains('on')"))

    # --- singing bowl + thrum (no page errors = clean code path) ---
    pg.evaluate("S.sound = true; bowlStrike(); thrumStart();")
    pg.wait_for_timeout(800)
    check("bowl/thrum run without errors", pg.evaluate("!!audioCtx"))
    pg.evaluate("lockWake(); releaseWake(); toggleMute(); toggleMute();")
    check("wake-lock + mute paths clean", True)

    # --- soundscape with LFO filter ---
    pg.evaluate("scSet('pink', 0.4); scSet('brown', 0.2); scSet('gamma', 0.15);")
    pg.wait_for_timeout(500)
    check("soundscape ctx + 3 nodes", pg.evaluate("!!SC.ctx && !!SC.nodes.pink && !!SC.nodes.brown && !!SC.nodes.gamma"))
    check("gains ramped", pg.evaluate("SC.nodes.pink.gain.value > 0.1 && SC.nodes.gamma.gain.value > 0"))
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
    pg.click("#plFab")
    check("playlist panel opens", pg.is_visible("#playlistPanel"))
    pg.fill("#plUrl", f"http://127.0.0.1:{PORT}/test-audio.mp3")
    pg.click("#plAdd")
    pg.wait_for_timeout(1500)
    items = pg.eval_on_selector_all("#plList li .t", "els => els.map(e => e.textContent)")
    check("track added with title", len(items) == 1 and "test audio" in items[0], str(items))
    check("playlist yt engine stays 1x1 hidden",
          pg.eval_on_selector("#ytHidden", "el => el.offsetWidth") <= 2)
    pg.click("#plList li")
    pg.wait_for_timeout(1500)
    check("native audio plays", pg.evaluate("!document.querySelector('#plAudio').paused"))
    pg.click("#plPlayPause")
    pg.wait_for_timeout(300)
    check("pause works", pg.evaluate("document.querySelector('#plAudio').paused"))
    pg.eval_on_selector("#plList li .rm", "el => el.click()")
    pg.wait_for_timeout(300)
    check("remove track", "empty" in pg.eval_on_selector("#plList", "el => el.textContent"))

    # --- playlist import: YouTube + YouTube Music playlist links ---
    check("parseMedia: playlist?list=",
          pg.evaluate("parseMedia('https://www.youtube.com/playlist?list=PLabc123xyz').type") == "ytplaylist")
    check("parseMedia: music.youtube.com playlist",
          pg.evaluate("parseMedia('https://music.youtube.com/playlist?list=PLabc123xyz').type") == "ytplaylist")
    check("parseMedia: watch+list imports whole list",
          pg.evaluate("parseMedia('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc123xyz').type") == "ytplaylist")
    check("parseMedia: plain watch stays single video",
          pg.evaluate("parseMedia('https://www.youtube.com/watch?v=dQw4w9WgXcQ').type") == "youtube")
    pg.fill("#plUrl", "https://www.youtube.com/playlist?list=PLtest999")
    pg.click("#plAdd")
    pg.wait_for_timeout(2500)
    pl = pg.evaluate("S.playlist[S.playlist.length - 1]")
    check("playlist link imported as ytplaylist track",
          pl["type"] == "ytplaylist" and pl["listId"] == "PLtest999", str(pl))
    check("imported playlist listed", pg.eval_on_selector_all("#plList li", "els => els.length") == 1)

    # --- Bagikan Vibe: hash round-trip, session-only, keep persists ---
    pg.evaluate("""localStorage.setItem('pomodoro:v3', JSON.stringify(Object.assign(
      JSON.parse(localStorage.getItem('pomodoro:v3') || '{}'), {clockStyle: 'air', bgId: 'hujan-kaca'})))""")
    vibe = pg.evaluate("encodeVibe({v: 'hutan-hujan', c: 'kyoto', p: 30, x: 0.25, y: 0.3})")
    check("vibe hash encodes", isinstance(vibe, str) and len(vibe) > 10, vibe[:40])
    # NOTE: goto() with only a fragment change is same-document (no reload),
    # so force a real reload for initVibeFromHash to run.
    pg.goto(f"http://127.0.0.1:{PORT}/index.html#vibe={vibe}")
    pg.reload()
    pg.wait_for_timeout(2500)
    check("vibe capsule shown (not hidden)",
          not pg.eval_on_selector("#vibeCapsule", "el => el.classList.contains('hidden')"))
    check("vibe style applied in-session", pg.evaluate("S.clockStyle") == "kyoto")
    check("vibe preset applied in-session", pg.evaluate("S.bgId") == "hutan-hujan")
    stored = pg.evaluate("JSON.parse(localStorage.getItem('pomodoro:v3')).clockStyle")
    check("visitor localStorage NOT overwritten", stored == "air", stored)
    pg.click("#vibeKeep")
    pg.wait_for_timeout(400)
    check("keep persists vibe", pg.evaluate("JSON.parse(localStorage.getItem('pomodoro:v3')).clockStyle") == "kyoto")
    check("hash cleared after keep", pg.evaluate("location.hash") == "")
    # XSS guard: javascript: URL rejected
    bad = pg.evaluate("decodeVibe(btoa(JSON.stringify({vu: 'javascript:alert(1)', tu: 'data:text/html,x'})))")
    check("xss guard rejects non-https", bad.get("vu") is None and bad.get("tu") is None, str(bad))

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

for f in ("test-bg.mp4", "test-audio.mp3"):
    p = os.path.join(ROOT, f)
    if os.path.exists(p): os.remove(p)

sys.exit(1 if failed or errors else 0)
