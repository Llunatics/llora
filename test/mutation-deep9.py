#!/usr/bin/env python3
"""Regression tests from deep-9 mutation testing (2026-10-20).

run-tests.py (169 checks) is click/UI-heavy; these pin the exact timer /
parsing engine values its loose range checks let mutants survive:
parseMedia types, modeAfterFocus long-vs-short, durSec clamps, tick
rounding, start()/pause() guards, skip-focus banking, mmssPlain padding.
"""
import http.server, threading, functools, sys, os
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8906
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()

CHROME = "/home/hatch/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome"

passed, failed = 0, 0
def check(name, cond, extra=""):
    global passed, failed
    if cond: passed += 1; print(f"  PASS {name}")
    else: failed += 1; print(f"  FAIL {name} {extra}")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME)
    pg = b.new_page(viewport={"width": 1280, "height": 800})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:160]))
    pg.goto(f"http://127.0.0.1:{PORT}/index.html")
    pg.wait_for_timeout(1200)
    ev = pg.evaluate

    # LO01/LO02: parseMedia classification
    check("parseMedia .ogg is audio",
          ev("parseMedia('https://x.test/a.ogg').type") == "audio",
          ev("parseMedia('https://x.test/a.ogg').type"))
    check("parseMedia unknown stays unknown",
          ev("parseMedia('https://x.test/file.txt').type") == "unknown",
          ev("parseMedia('https://x.test/file.txt').type"))

    # LO03: modeAfterFocus — long break exactly at cycle multiples
    check("modeAfterFocus: 4th of 4 -> long",
          ev("S.cycle = 4; T.completedFocus = 4; modeAfterFocus()") == "long",
          ev("modeAfterFocus()"))
    check("modeAfterFocus: 5th of 4 -> short",
          ev("T.completedFocus = 5; modeAfterFocus()") == "short",
          ev("modeAfterFocus()"))
    check("modeAfterFocus: 8th of 4 -> long",
          ev("T.completedFocus = 8; modeAfterFocus()") == "long",
          ev("modeAfterFocus()"))

    # LO04: durSec minimum clamp is 6 seconds
    check("durSec clamps tiny duration to 6s",
          ev("S.durations.focus = 0.05; durSec('focus')") == 6,
          str(ev("durSec('focus')")))
    ev("S.durations.focus = 25;")

    # LO14: breathe duration is exactly BREATHE_SEC
    check("durSec('breathe') == BREATHE_SEC",
          ev("durSec('breathe')") == ev("BREATHE_SEC"),
          str(ev("durSec('breathe')")))

    # LO05: tick rounds remaining UP (ceil), not down
    ev("T.mode = 'focus'; T.running = false; T.endAt = Date.now() + 4900; tick();")
    check("tick ceil: 4.9s left -> remaining 5",
          ev("T.remaining") == 5, str(ev("T.remaining")))

    # LO06: start() while running must not re-anchor endAt
    ev("T.mode = 'focus'; T.remaining = durSec('focus'); start();")
    e1 = ev("T.endAt")
    ev("start();")
    check("double start() keeps endAt", ev("T.endAt") == e1,
          f"{e1} vs {ev('T.endAt')}")
    ev("pause();")

    # LO07: pausing overtime keeps the elapsed overtime seconds
    ev("T.mode = 'overtime'; T.running = true; T.endAt = Date.now() - 5000; pause();")
    check("pause in overtime keeps overtimeSec ~5",
          ev("T.overtimeSec") == 5, str(ev("T.overtimeSec")))
    ev("T.mode = 'focus'; T.overtimeSec = 0;")

    # LO09: skipping a focus session still banks its full duration
    ev("S.durations.focus = 0.1; S.stats.date = todayStr(); S.stats.focusSec = 0;"
       "T.mode = 'focus'; T.completedFocus = 0; skipSession();")
    check("skip focus banks durSec('focus')",
          ev("S.stats.focusSec") == 6, str(ev("S.stats.focusSec")))
    ev("S.durations.focus = 25;")

    # LO11: mmssPlain zero-pads minutes and seconds
    check("mmssPlain(65) == '01:05'", ev("mmssPlain(65)") == "01:05", ev("mmssPlain(65)"))
    check("mmssPlain(9) == '00:09'", ev("mmssPlain(9)") == "00:09", ev("mmssPlain(9)"))
    check("mmssPlain(600) == '10:00'", ev("mmssPlain(600)") == "10:00", ev("mmssPlain(600)"))

    check("no page errors", len(errs) == 0, "; ".join(errs))
    b.close()

print(f"MUT9: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
