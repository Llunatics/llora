#!/usr/bin/env python3
"""Real click tests for pomodoro-timer v3.5 (Playwright + headless Chromium)."""
import http.server, threading, functools, sys, os, re
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
    b = p.chromium.launch(executable_path="/home/hatch/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome",
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
    # accordion groups start collapsed; expand them so controls are clickable
    check("accordion groups collapsed by default",
          pg.evaluate("[...document.querySelectorAll('.set-group.acc')].every(s => s.dataset.open !== 'true')"))
    for acc in ["bg", "clock", "timer", "nature", "sound", "data"]:
        pg.evaluate(f"document.querySelector('.set-group.acc[data-acc=\"{acc}\"] .acc-head').click()")
    pg.wait_for_timeout(400)
    check("accordion expands on head click",
          pg.evaluate("document.querySelector('.set-group.acc[data-acc=\"timer\"]').dataset.open") == "true"
          and pg.evaluate("document.querySelector('.set-group.acc[data-acc=\"timer\"] .acc-head').getAttribute('aria-expanded')") == "true")
    check("accordion state persists",
          pg.evaluate("JSON.parse(localStorage.getItem('pomodoro:v3')).acc.timer") == True)
    check("no inner close button (single X via hamburger)",
          pg.eval_on_selector_all("#settingsClose", "els => els.length") == 0)
    check("share+data merged into one Data accordion",
          pg.evaluate("document.querySelector('.set-group.acc[data-acc=\"data\"]') !== null")
          and pg.eval_on_selector_all(".set-group > h3", "els => els.length") == 0
          and pg.evaluate("document.querySelector('.set-group.acc[data-acc=\"data\"] #vibeBtn') !== null")
          and pg.evaluate("document.querySelector('.set-group.acc[data-acc=\"data\"] #clearData') !== null"))
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

    # --- slider fill is min/max aware (spread max=160) ---
    pg.evaluate("""() => {
      const s = document.querySelector('#slScrimS');
      s.value = 80; s.dispatchEvent(new Event('input', {bubbles:true}));
    }""")
    check("spread slider fill at half = 50%",
          pg.eval_on_selector("#slScrimS", "el => el.style.getPropertyValue('--fill')") == "50.0%",
          pg.eval_on_selector("#slScrimS", "el => el.style.getPropertyValue('--fill')"))
    pg.evaluate("""() => {
      const s = document.querySelector('#slScrimS');
      s.value = 85; s.dispatchEvent(new Event('input', {bubbles:true}));
    }""")

    # --- dim background + clock size sliders ---
    check("dim/clock-size sliders exist",
          pg.eval_on_selector("#slDimBg", "el => el.type") == "range"
          and pg.eval_on_selector("#slClockSize", "el => el.type") == "range")
    pg.evaluate("""() => {
      const d = document.querySelector('#slDimBg'), c = document.querySelector('#slClockSize');
      d.value = 35; c.value = 120;
      d.dispatchEvent(new Event('input', {bubbles:true}));
      c.dispatchEvent(new Event('input', {bubbles:true}));
    }""")
    pg.wait_for_timeout(150)
    check("dim bg paints overlay",
          pg.eval_on_selector("#bgDim", "el => el.style.opacity") == "0.35")
    check("clock size scales card",
          pg.eval_on_selector("#clockCard", "el => el.style.scale") == "1.2")
    check("dim/size persist + in vibe",
          pg.evaluate("JSON.parse(localStorage.getItem('pomodoro:v3')).dimBg") == 35
          and pg.evaluate("collectVibe().db") == 35 and pg.evaluate("collectVibe().cs") == 120)
    pg.evaluate("""() => {
      const d = document.querySelector('#slDimBg'), c = document.querySelector('#slClockSize');
      d.value = 0; c.value = 100;
      d.dispatchEvent(new Event('input', {bubbles:true}));
      c.dispatchEvent(new Event('input', {bubbles:true}));
    }""")

    # --- white noise slider ---
    check("white noise slider exists",
          pg.eval_on_selector("#slWhite", "el => el.type") == "range")
    pg.evaluate("scSet('white', 0.5)")
    pg.wait_for_timeout(600)
    check("white noise node ramps",
          pg.evaluate("SC.nodes.white && SC.nodes.white.gain.value") > 0.05,
          pg.evaluate("SC.nodes.white && SC.nodes.white.gain.value"))
    check("white in vibe", pg.evaluate("collectVibe().w") == 50)
    pg.evaluate("scSet('white', 0)")

    # --- dropdown: scrolling the option list itself must not close it ---
    pg.click("#clockSelectWrap .dd-btn")
    pg.wait_for_timeout(300)
    pg.evaluate("""() => {
      const l = document.querySelector(".dd-list[data-dd='#clockSelectWrap']");
      l.scrollTop = 60;
      l.dispatchEvent(new Event('scroll', {bubbles:true}));
    }""")
    pg.wait_for_timeout(200)
    check("scrolling option list keeps dropdown open",
          pg.is_visible(".dd-list[data-dd='#clockSelectWrap']"))
    pg.click(".dd-list[data-dd='#clockSelectWrap'] li[data-value='air']")
    pg.wait_for_timeout(200)
    check("option still clickable after list scroll",
          not pg.is_visible(".dd-list[data-dd='#clockSelectWrap']")
          and pg.evaluate("S.clockStyle") == "air")

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
          pg.eval_on_selector("#slPink", "el => el.style.getPropertyValue('--fill')") == "40.0%")
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

    # --- YouTube background engine: poster shield, reveal ONLY on PLAYING ---
    pg.evaluate("S.bgCustom='https://www.youtube.com/watch?v=aqz-KE-bpKQ'; S.bgId='custom'; save(); switchBackground();")
    pg.wait_for_timeout(800)
    ytsrc = pg.eval_on_selector("#bgYt", "el => el.src")
    check("yt embed params (muted/loop/no-controls)",
          all(s in ytsrc for s in ["youtube.com/embed/aqz-KE-bpKQ", "mute=1", "loop=1", "controls=0"]), ytsrc[:90])
    check("yt poster shield shows while loading",
          pg.eval_on_selector("#bgPhoto", "el => el.classList.contains('on')")
          and "i.ytimg.com/vi/aqz-KE-bpKQ/" in pg.eval_on_selector("#bgPhoto", "el => el.src"))
    check("yt iframe stays hidden before PLAYING (no YT play button)",
          not pg.eval_on_selector("#bgYt", "el => el.classList.contains('on')")
          and pg.eval_on_selector("#bgYt", "el => getComputedStyle(el).visibility") == "hidden")
    pg.evaluate("handleBgYtState(3)")  # buffering
    check("buffering keeps the shield up (no YT spinner)",
          not pg.eval_on_selector("#bgYt", "el => el.classList.contains('on')"))
    pg.evaluate("handleBgYtState(1)")  # playing
    check("PLAYING reveals the iframe",
          pg.eval_on_selector("#bgYt", "el => el.classList.contains('on')"))
    pg.evaluate("handleBgYtState(3)")  # buffering again mid-playback
    check("mid-playback buffering re-shields",
          not pg.eval_on_selector("#bgYt", "el => el.classList.contains('on')"))
    pg.evaluate("handleBgYtState(2)")  # paused (autoplay refused)
    check("paused keeps the shield up",
          not pg.eval_on_selector("#bgYt", "el => el.classList.contains('on')"))
    # the real wire path: a postMessage state event from the embed itself
    pg.evaluate("""() => {
      bgYtAcceptState = true;
      const frame = document.querySelector('#bgYt');
      window.dispatchEvent(new MessageEvent('message', {
        data: JSON.stringify({ event: 'onStateChange', info: 1 }),
        origin: 'https://www.youtube.com', source: frame.contentWindow }));
    }""")
    check("postMessage PLAYING reveals the iframe",
          pg.eval_on_selector("#bgYt", "el => el.classList.contains('on')"))
    pg.evaluate("S.bgCustom=''; S.bgId='hujan-kaca'; save(); switchBackground();")
    pg.wait_for_timeout(1000)
    check("leaving yt bg hides iframe", not pg.eval_on_selector("#bgYt", "el => el.classList.contains('on')"))

    # --- random @kazephoto background (ytImportIds stubbed, like playlist import) ---
    pg.click("#menuBtn")  # reopen: the Escape test closed the settings panel
    pg.wait_for_timeout(400)
    pg.evaluate("""() => {
      window.__realImport2 = ytImportIds;
      ytImportIds = async () => ['kzAAA111111', 'kzBBB222222'];
    }""")
    pg.evaluate("""() => {
      const h = document.querySelector('.set-group.acc[data-acc="bg"] .acc-head');
      if (h.getAttribute('aria-expanded') !== 'true') h.click();
    }""")
    pg.wait_for_timeout(300)
    check("random bg button exists", pg.evaluate("document.querySelector('#randomBgBtn') !== null"))
    pg.evaluate("document.querySelector('#randomBgBtn').scrollIntoView({block: 'center'})")
    pg.wait_for_timeout(300)
    pg.click("#randomBgBtn")
    pg.wait_for_timeout(5000)
    picked = pg.evaluate("S.bgCustom")
    check("random bg picks a video from the stubbed uploads",
          picked in ("https://www.youtube.com/watch?v=kzAAA111111",
                     "https://www.youtube.com/watch?v=kzBBB222222"), picked)
    check("random bg syncs the custom-url input",
          pg.evaluate("document.querySelector('#customBgUrl').value") == picked, picked)
    check("random bg loads the youtube engine",
          any(s in pg.eval_on_selector("#bgYt", "el => el.src")
              for s in ["youtube.com/embed/kzAAA111111", "youtube.com/embed/kzBBB222222"]))
    pg.evaluate("() => { ytImportIds = window.__realImport2; }")
    pg.click("#menuBtn")  # leave the panel as found (closed)
    pg.wait_for_timeout(300)

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
    pg.wait_for_timeout(350)
    check("playlist panel animates (opacity+transform transition)",
          "opacity" in pg.eval_on_selector("#playlistPanel", "el => getComputedStyle(el).transition"))
    check("fab morphs to X when open",
          pg.eval_on_selector("#plFab .fab-x", "el => getComputedStyle(el).opacity") == "1"
          and pg.eval_on_selector("#plFab .fab-note", "el => getComputedStyle(el).opacity") == "0")
    pg.click("#plFab")  # close again
    pg.wait_for_timeout(350)
    check("fab morphs back to note when closed",
          pg.eval_on_selector("#plFab .fab-x", "el => getComputedStyle(el).opacity") == "0")
    pg.click("#plFab")  # reopen for the tests below
    pg.wait_for_timeout(300)
    # --- now-playing card ---
    check("paste hint removed (clean panel)",
          pg.eval_on_selector_all(".pl-add .hint", "els => els.length") == 0)
    check("no double close button in playlist head",
          pg.evaluate("document.querySelector('#plClose') === null"))
    check("playlist heading removed (cleaner top space)",
          pg.evaluate("document.querySelector('#playlistPanel .panel-head') === null"))
    check("add button is a crisp SVG, not a text glyph",
          pg.eval_on_selector("#plAdd", "el => el.querySelector('svg.icon') !== null")
          and pg.eval_on_selector("#plAdd", "el => el.textContent.trim()") == "")
    check("now-playing card structure",
          pg.eval_on_selector("#npCover", "el => el.tagName") == "IMG"
          and pg.eval_on_selector("#npTitle", "el => el.textContent") == "Nothing playing"
          and pg.evaluate("document.querySelector('#npBigPlay') === null")
          and pg.eval_on_selector("#plPlayPause",
            "el => !el.querySelector('[data-icon-play]').classList.contains('hidden')")
          and pg.eval_on_selector("#npSeek", "el => el.type") == "range")
    pg.fill("#plUrl", f"http://127.0.0.1:{PORT}/test-audio.mp3")
    pg.click("#plAdd")
    pg.wait_for_timeout(1500)
    items = pg.eval_on_selector_all("#plList li .t", "els => els.map(e => e.textContent)")
    check("track added with title", len(items) == 1 and "test audio" in items[0], str(items))
    check("track titles are centered",
          pg.eval_on_selector("#plList li .t", "el => getComputedStyle(el).textAlign") == "center")
    check("only the track list scrolls, not the panel",
          pg.eval_on_selector("#playlistPanel", "el => getComputedStyle(el).overflowY") == "hidden"
          and pg.eval_on_selector("#plList", "el => getComputedStyle(el).overflowY") == "auto")
    check("cover is 60px",
          pg.eval_on_selector("#npCover", "el => true") and
          pg.evaluate("document.querySelector('.np-cover').getBoundingClientRect().width") == 60)
    check("playlist yt engine stays 1x1 hidden",
          pg.eval_on_selector("#ytHidden", "el => el.offsetWidth") <= 2)
    pg.click("#plList li")
    pg.wait_for_timeout(1500)
    check("native audio plays", pg.evaluate("!document.querySelector('#plAudio').paused"))
    check("now-playing shows track title",
          "test audio" in pg.eval_on_selector("#npTitle", "el => el.textContent"))
    _ct = pg.evaluate("document.querySelector('#plAudio').currentTime")
    _np = pg.eval_on_selector("#npCur", "el => el.textContent")
    _fmt = lambda s: f"{int(s // 60)}:{int(s % 60):02d}"
    check("now-playing time advances while timer idle",
          _ct > 0.5 and _np in (_fmt(_ct), _fmt(max(0, _ct - 1)), _fmt(_ct + 1))
          and pg.evaluate("T.running") == False,
          f"audio={_ct:.2f} shown={_np}")
    check("transport play button syncs state",
          pg.eval_on_selector("#plPlayPause",
            "el => !el.querySelector('[data-icon-pause]').classList.contains('hidden')"))
    pg.click("#plPlayPause")
    pg.wait_for_timeout(300)
    check("transport play button pauses",
          pg.evaluate("document.querySelector('#plAudio').paused")
          and pg.eval_on_selector("#plPlayPause",
            "el => !el.querySelector('[data-icon-play]').classList.contains('hidden')"))
    pg.click("#plPlayPause")
    pg.wait_for_timeout(300)
    check("transport play button resumes",
          not pg.evaluate("document.querySelector('#plAudio').paused")
          and pg.eval_on_selector("#plPlayPause",
            "el => !el.querySelector('[data-icon-pause]').classList.contains('hidden')"))
    # seek: in-memory 6s WAV via blob URL (seekable; the test HTTP server
    # has no Range support, so fixture files can't seek in this env)
    pg.evaluate("""() => {
      const sr = 44100, dur = 6, n = sr * dur;
      const dv = new DataView(new ArrayBuffer(44 + n * 2));
      const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
      ws(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
      dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
      dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
      ws(36, 'data'); dv.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 440 * i / sr) * 10000, true);
      const url = URL.createObjectURL(new Blob([dv.buffer], {type: 'audio/wav'}));
      S.playlist.push({id: 'seekwav', title: 'Seek WAV', artist: '', url, type: 'audio', ytId: null, listId: null});
      save(); renderPlaylist(); playTrack(S.playlist.length - 1);
    }""")
    pg.wait_for_timeout(1200)
    check("wav track plays", pg.evaluate("!document.querySelector('#plAudio').paused"))
    pg.evaluate("""() => {
      const s = document.querySelector('#npSeek');
      s.value = 500; s.dispatchEvent(new Event('input', {bubbles:true}));
    }""")
    pg.wait_for_timeout(400)
    check("seek bar seeks audio",
          abs(pg.evaluate("document.querySelector('#plAudio').currentTime") - 3.0) < 0.7,
          pg.evaluate("document.querySelector('#plAudio').currentTime"))
    pg.evaluate("removeTrack('seekwav')")
    pg.wait_for_timeout(200)
    pg.eval_on_selector("#plList li .rm", "el => el.click()")
    pg.wait_for_timeout(300)
    check("remove track", "empty" in pg.eval_on_selector("#plList", "el => el.textContent"))

    # --- clock mode toggle (wall-clock display) ---
    check("mode toggle pill exists",
          pg.eval_on_selector_all(".mt-opt", "els => els.length") == 2)
    check("starts in timer mode",
          pg.evaluate("S.clockMode") == False
          and not pg.eval_on_selector("#clockCard", "el => el.classList.contains('clock-mode')"))
    pg.click('.mt-opt[data-mt="clock"]')
    pg.wait_for_timeout(400)
    import datetime as _dt
    _now = _dt.datetime.now().strftime("%H:%M")
    _shown = pg.eval_on_selector("[data-time]", "el => el.textContent")
    check("clock mode shows wall time", _shown == _now, _shown)
    check("clock mode hides timer chrome",
          pg.eval_on_selector(".clock-controls", "el => getComputedStyle(el).display") == "none"
          and pg.eval_on_selector("[data-date]", "el => getComputedStyle(el).display") != "none")
    check("clock mode date line",
          len(pg.eval_on_selector("[data-date]", "el => el.textContent")) > 8,
          pg.eval_on_selector("[data-date]", "el => el.textContent"))
    check("clock mode persists",
          pg.evaluate("JSON.parse(localStorage.getItem('pomodoro:v3')).clockMode") == True)
    check("clock mode tab title", pg.evaluate("document.title").startswith(_now),
          pg.evaluate("document.title"))
    pg.click("#menuBtn")  # the Escape test earlier closed the panel
    pg.wait_for_timeout(400)
    pg.click("#chkClockSec")
    pg.wait_for_timeout(300)
    _sec = pg.eval_on_selector("[data-time]", "el => el.textContent")
    check("seconds shown when enabled",
          len(_sec) == 8 and _sec[2] == ":" and _sec[5] == ":", _sec)
    _t1 = pg.eval_on_selector("[data-time]", "el => el.textContent")
    pg.wait_for_timeout(1300)
    _t2 = pg.eval_on_selector("[data-time]", "el => el.textContent")
    check("seconds tick live while timer idle",
          _t1 != _t2 and pg.evaluate("T.running") == False, f"{_t1} -> {_t2}")
    check("seconds persist",
          pg.evaluate("JSON.parse(localStorage.getItem('pomodoro:v3')).clockSeconds") == True)
    pg.click("#chkClockSec")
    pg.wait_for_timeout(200)
    check("seconds hidden when disabled",
          len(pg.eval_on_selector("[data-time]", "el => el.textContent")) == 5)
    pg.evaluate("S.durations.focus = 25; resetSession();")  # undo the 0.1-min stepper test
    pg.mouse.click(5, 5)  # blur the checkbox: shortcuts ignore keypresses inside inputs
    pg.wait_for_timeout(200)
    pg.keyboard.press("t")
    pg.wait_for_timeout(300)
    check("T key toggles back to timer",
          pg.evaluate("S.clockMode") == False
          and pg.eval_on_selector("[data-time]", "el => el.textContent") == "25:00")

    # --- playlist import: YouTube + YouTube Music playlist links ---
    check("parseMedia: playlist?list=",
          pg.evaluate("parseMedia('https://www.youtube.com/playlist?list=PLabc123xyz').type") == "ytplaylist")
    check("parseMedia: music.youtube.com playlist",
          pg.evaluate("parseMedia('https://music.youtube.com/playlist?list=PLabc123xyz').type") == "ytplaylist")
    check("parseMedia: watch+list adds just the video",
          pg.evaluate("parseMedia('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc123xyz').type") == "youtube")
    check("parseMedia: plain watch stays single video",
          pg.evaluate("parseMedia('https://www.youtube.com/watch?v=dQw4w9WgXcQ').type") == "youtube")
    # stub the YouTube read + title fetch (no real YouTube in headless CI)
    pg.evaluate("""() => {
      window.__realImport = ytImportIds;
      window.__realPlTitle = fetchYtPlaylistTitle;
      window.__realTitle = fetchYtMeta;
      ytImportIds = async () => ['vidAAA11111', 'vidBBB22222', 'vidCCC33333'];
      fetchYtPlaylistTitle = async () => 'Stubbed Mix';
      fetchYtMeta = async (id) => ({title: 'Song ' + id.slice(3, 6), artist: 'Singer ' + id.slice(3, 6)});
    }""")
    n0 = pg.evaluate("S.playlist.length")
    pg.fill("#plUrl", "https://www.youtube.com/playlist?list=PLtest999")
    pg.click("#plAdd")
    pg.wait_for_timeout(4000)
    added = pg.evaluate(f"S.playlist.slice({n0})")
    check("playlist expands into individual tracks",
          len(added) == 3 and all(t["type"] == "youtube" for t in added)
          and [t["ytId"] for t in added] == ["vidAAA11111", "vidBBB22222", "vidCCC33333"], str(added))
    check("imported titles fill in",
          [t["title"] for t in added] == ["Song AAA", "Song BBB", "Song CCC"],
          str([t["title"] for t in added]))
    check("imported artists fill in",
          [t["artist"] for t in added] == ["Singer AAA", "Singer BBB", "Singer CCC"],
          str([t["artist"] for t in added]))
    check("imported tracks listed",
          pg.eval_on_selector_all("#plList li", "els => els.length") >= 3)
    pg.evaluate("""() => {
      ytImportIds = window.__realImport;
      fetchYtPlaylistTitle = window.__realPlTitle;
      fetchYtMeta = window.__realTitle;
    }""")

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

    # --- audit 2026-10-20: antrean callback YT API ---
    # dua loadYtApi() saat script masih dimuat: callback pertama tidak boleh hilang
    ncb = pg.evaluate("""() => {
      ytApiReady = false; ytApiLoading = false;
      const hits = [];
      loadYtApi(() => hits.push('a'));
      loadYtApi(() => hits.push('b'));
      window.onYouTubeIframeAPIReady(); // simulasi script selesai dimuat
      return hits;
    }""")
    check("queued yt api callbacks both fire", ncb == ["a", "b"], str(ncb))
    pg.evaluate("() => { ytApiReady = false; ytApiLoading = false; }")  # kembalikan

    # --- audit 2026-10-20: tombol N sadar ytListMode ---
    pg.evaluate("""() => {
      window.__nv = [];
      ytListMode = true;
      ytPlayer = { nextVideo: () => window.__nv.push('next'),
                   previousVideo: () => window.__nv.push('prev') };
      S.playlist = [{id:'t1', title:'T1', artist:'', url:'x',
                     type:'ytplaylist', ytId:null, listId:'PLx'}];
      S.currentTrack = 0;
      plStep(1); plStep(-1);
    }""")
    check("plStep delegates to yt player inside a yt playlist",
          pg.evaluate("window.__nv") == ["next", "prev"], str(pg.evaluate("window.__nv")))
    pg.evaluate(f"""() => {{
      ytListMode = false; ytPlayer = null; window.__nv = [];
      const mk = (id) => ({{id, title:id, artist:'', url:'http://127.0.0.1:{PORT}/test-audio.mp3',
                           type:'audio', ytId:null, listId:null}});
      S.playlist = [mk('ka'), mk('kb')];
      S.currentTrack = 0; save(); renderPlaylist();
    }}""")
    pg.mouse.click(5, 5)
    pg.wait_for_timeout(200)
    pg.keyboard.press("n")
    pg.wait_for_timeout(800)
    check("N key advances to next track", pg.evaluate("S.currentTrack") == 1,
          pg.evaluate("S.currentTrack"))
    pg.evaluate("() => { S.playlist = []; S.currentTrack = -1; save(); renderPlaylist(); }")

    # --- audit 2026-10-20: playlist korup di localStorage tidak crash ---
    pg.evaluate("""() => {
      const s = JSON.parse(localStorage.getItem('pomodoro:v3'));
      s.playlist = [null, 'junk', {id:'ok1', title:'OK', artist:'',
                    url:'http://x/y.mp3', type:'audio', ytId:null, listId:null}, 42];
      s.currentTrack = 99;
      localStorage.setItem('pomodoro:v3', JSON.stringify(s));
    }""")
    pg.reload()
    pg.wait_for_timeout(2000)
    check("corrupt playlist sanitized on load",
          pg.evaluate("S.playlist.length") == 1 and pg.evaluate("S.currentTrack") == -1,
          f"{pg.evaluate('S.playlist.length')}/{pg.evaluate('S.currentTrack')}")
    check("no page errors from corrupt state", len(errors) == 0, str(errors[:2]))

    # --- audit v6.3 regressions ---
    # settings sliders must be full-width tracks, not 17px dots (CSS comma-selector bug)
    pg2 = b.new_page(viewport={"width": 1280, "height": 900})
    pg2.goto(f"http://127.0.0.1:{PORT}/index.html")
    pg2.wait_for_timeout(1000)
    w = pg2.evaluate("() => document.querySelector('#slDimBg').getBoundingClientRect().width")
    check("settings slider is a full track", w > 100, f"width={w}")
    # status line: fresh first focus -> next is short break, not long
    nxt = pg2.evaluate("document.querySelector('[data-next]').textContent")
    check("next label correct on fresh focus", nxt == "next: short break", nxt)
    # seek fill repaints while dragging
    pg2.evaluate("""() => {
      S.playlist.push({id:'a1', title:'T', artist:'', url:'x', type:'audio', ytId:null, listId:null});
      S.currentTrack = 0; save(); renderPlaylist(); updateNp();
    }""")
    pg2.evaluate("() => { const s = document.querySelector('#npSeek'); s.value = 500; s.dispatchEvent(new Event('input', {bubbles:true})); }")
    fill = pg2.evaluate("document.querySelector('#npSeek').style.getPropertyValue('--fill')")
    check("seek fill repaints on drag", fill == "50.0%", fill)
    # playing track highlight uses the green accent, not blue
    pg2.evaluate("() => document.querySelector('#plFab').click()")
    pg2.wait_for_timeout(400)
    bg = pg2.evaluate("() => getComputedStyle(document.querySelector('.pl-list li.playing')).backgroundColor")
    check("playing track is green-tinted",
          "46, 229, 125" in bg or "0.180392 0.898039 0.490196" in bg, bg)
    pg2.close()

    # --- dynamic accent follows the background ---
    pg3 = b.new_page(viewport={"width": 1280, "height": 900})
    pg3.goto(f"http://127.0.0.1:{PORT}/index.html")
    pg3.wait_for_timeout(1000)
    # pure color math: vivid in -> vivid out, muddy in -> default leaf green
    cases = [
        ((40, 80, 220), "#2b56ee"),    # blue video -> blue accent
        ((230, 120, 50), "#ee772b"),   # sunset -> vivid orange
        ((128, 128, 128), "#2ee57d"),  # gray -> default green
        ((5, 5, 8), "#2ee57d"),        # near-black -> default green
        ((250, 250, 250), "#2ee57d"),  # near-white -> default green
        ((20, 80, 45), "#2bee7c"),     # forest -> vivid green
    ]
    for (r, g, b_), want in cases:
        got = pg3.evaluate(f"accentHex(accentFromRgb({r}, {g}, {b_}))")
        check(f"accent math rgb({r},{g},{b_})", got == want, got)
    # live: blue mp4 background pushes a blue accent through the sampler
    pg3.evaluate(f"() => {{ S.bgCustom = 'http://127.0.0.1:{PORT}/test-bg.mp4'; S.bgId = 'custom'; save(); switchBackground(); }}")
    pg3.wait_for_timeout(6000)
    acc = pg3.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()")
    check("sampler sets --accent to a hex color", bool(re.match(r'^#[0-9a-f]{6}$', acc)), acc)
    pg3.close()

    # --- screenshots (review only: never into assets/, the README hero is hand-picked) ---
    shot_dir = os.path.join(ROOT, "test", "shots")
    os.makedirs(shot_dir, exist_ok=True)
    pg.set_viewport_size({"width": 390, "height": 844})
    pg.wait_for_timeout(800)
    pg.screenshot(path=os.path.join(shot_dir, "screenshot-mobile.png"))
    pg.set_viewport_size({"width": 1440, "height": 900})
    pg.wait_for_timeout(800)
    pg.screenshot(path=os.path.join(shot_dir, "screenshot-desktop.png"))
    check("screenshots saved", os.path.exists(os.path.join(shot_dir, "screenshot-mobile.png")))
    b.close()

print(f"\n{passed} passed, {failed} failed, {len(errors)} page errors")
for e in errors[:10]: print(" PAGE-ERR:", e[:160])
srv.shutdown()

for f in ("test-bg.mp4", "test-audio.mp3"):
    p = os.path.join(ROOT, f)
    if os.path.exists(p): os.remove(p)

sys.exit(1 if failed or errors else 0)
