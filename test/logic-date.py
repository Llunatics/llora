#!/usr/bin/env python3
"""Regression test: daily stats / Satu Hal follow the LOCAL calendar day,
not UTC (deep-6, 2026-10-20).

Bug: the app used new Date().toISOString().slice(0,10) (UTC) for the stats
day. For a WIB (UTC+7) user the "day" flipped at 07:00 local: an early-morning
focus session counted toward "yesterday" and Satu Hal set at 06:30 was wiped
at 07:00.

Method: freeze the clock at 2026-10-19T18:30:00Z (= 2026-10-20 01:30 WIB) via
an init-script Date mock, run the page in the Asia/Jakarta timezone, and
assert the app sees 2026-10-20 while toISOString() still says 2026-10-19.
"""
import http.server, threading, functools, sys
from playwright.sync_api import sync_playwright

ROOT = "/home/hatch/workspace/repos/llora"
PORT = 8904
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()

CHROME = "/home/hatch/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome"

# 2026-10-19T18:30:00Z == 2026-10-20 01:30 WIB. Note: the string must be an
# immediately-invoked script (a bare arrow function would never run).
DATE_MOCK = """(() => {
  const RealDate = Date;
  const FIXED = RealDate.UTC(2026, 9, 19, 18, 30, 0);
  window.Date = class extends RealDate {
    constructor(...a) { super(...(a.length ? a : [FIXED])); }
    static now() { return FIXED; }
  };
})();"""

passed, failed = 0, 0
def check(name, cond, extra=""):
    global passed, failed
    if cond: passed += 1; print(f"  PASS {name}")
    else: failed += 1; print(f"  FAIL {name} {extra}")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME)
    ctx = b.new_context(timezone_id="Asia/Jakarta", viewport={"width": 1280, "height": 800})
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:160]))
    pg.add_init_script(DATE_MOCK)
    pg.goto(f"http://127.0.0.1:{PORT}/index.html")
    pg.wait_for_timeout(1200)

    check("mock sanity: toISOString still UTC",
          pg.evaluate("new Date().toISOString().slice(0,10)") == "2026-10-19",
          pg.evaluate("new Date().toISOString().slice(0,10)"))
    check("mock sanity: local tz is WIB",
          pg.evaluate("new Date().getTimezoneOffset()") == -420,
          str(pg.evaluate("new Date().getTimezoneOffset()")))
    check("todayStr() follows local day",
          pg.evaluate("todayStr()") == "2026-10-20",
          pg.evaluate("typeof todayStr"))
    check("stats stamped with local day",
          pg.evaluate("S.stats.date") == "2026-10-20",
          pg.evaluate("S.stats.date"))
    check("oneThing stamped with local day",
          pg.evaluate("S.oneThing.date") == "2026-10-20",
          pg.evaluate("S.oneThing.date"))
    pg.evaluate("bankFocus(90)")
    check("bankFocus keeps local day",
          pg.evaluate("S.stats.date") == "2026-10-20" and pg.evaluate("S.stats.focusSec") == 90,
          pg.evaluate("JSON.stringify(S.stats)"))
    check("no page errors", len(errs) == 0, "; ".join(errs))
    b.close()

print(f"DATE: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
