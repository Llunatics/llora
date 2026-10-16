# Pomodoro

Pomodoro focus timer with a true iOS-style **liquid glass** UI: self-hosted 1080p video backgrounds, a boxless floating clock, titles-only playlist, Mode Hening, and a procedural soundscape mixer. Static site — no build step, no frameworks, just open `index.html`.

![Desktop](assets/screenshot-desktop.png)
![Mobile](assets/screenshot-mobile.png)

## Features

- **Thin liquid glass** — `linear-gradient(135deg, rgba(255,255,255,.08), rgba(255,255,255,.02))`, `blur(12px) saturate(180%) contrast(105%)`, 1px `rgba(255,255,255,.14)` border, specular top-rim highlight. **Adaptive tint**: the dominant color of the current video frame is sampled every 2s (offscreen 16×16 canvas) and fed into `--ambient` for a subtle glow inside every glass surface.
- **Video backgrounds, 1080p self-hosted** — four ~15s seamless H.264 loops (Hujan di Kaca, Hutan Hijau, Kota Senja, Senja Hujan) live on a dedicated `assets` branch and served via jsDelivr with CORS enabled. Double-buffered switching: the new clip preloads in a hidden `<video>` and crossfades 800ms on `canplaythrough` — the visible video's `src` is never yanked mid-play. If a clip fails, a toast says so and the animated gradient fallback stays.
- **Pomodoro timer** — `Date.now()`-delta engine (no drift), 250ms tick, `Math.ceil` display, custom focus/short/long durations (decimals allowed), sessions-before-long-break, start/pause/reset/skip, progress bar, session dots, auto-continue. **Transisi napas**: a 15s breathing phase (4-7-8 cadence, clock scales 1.0→1.06) between focus end and break instead of a jarring alarm — soft chime included. Tab title counts down; optional browser Notification.
- **Boxless floating clock** — digits only, no card. Drag anywhere (Pointer Events + `setPointerCapture`, `touch-action: none`); position stored as viewport fractions so it survives resize. Three typefaces, system fonts only: iOS lockscreen (SF, weight 200), editorial serif italic, Swiss mono — all with `tabular-nums`, −0.04em tracking, dual-layer text shadow. The colon breathes (opacity .95↔.3) while running. Pickup spring: `scale(1.03)` + brightness with a springy bezier.
- **Mode Hening** — the signature moment: after 6s without pointer movement while the timer runs, every chrome element (buttons, FAB, hamburger) fades to invisible; only the floating clock and the video remain. Any movement wakes it.
- **Satu Hal** — one 40-character intention line under the clock (per-day). It dissolves with a blur-out animation when the focus session ends or you tap ✓.
- **Soundscape mixer** — fully procedural WebAudio, zero files, works offline: pink noise (Paul Kellet filter), brown noise, and a 40Hz binaural gamma beat (220Hz L / 260Hz R). Three mini sliders in settings.
- **Playlist, titles only** — a 44px ♪ FAB expands to a compact panel listing **only clean track titles** — no YouTube box, ever. Native `<audio>`/`<video>` engines stay hidden; YouTube plays through a 1×1px hidden IFrame player (auto-advance on end, graceful toast for embed-disabled videos). YouTube titles auto-fetched via noembed; Media Session API gives lock-screen controls for native audio.
- **Settings (hamburger, top-right)** — background presets + custom URL, clock style, position reset, durations, Mode Hening, breathing transition, soundscape sliders, sound/notification toggles, clear-all-data.
- **PWA-ready** — `manifest.json` (`display: standalone`) + hand-drawn SVG/PNG icons; install it to the home screen for fullscreen.
- **Persistence** — one versioned key, `pomodoro:v3` (migrates v1/v2 gracefully).

## Usage

```bash
# just open it — no build, no dependencies
open index.html
# or serve locally
python3 -m http.server 8000
```

## Customization

- **Background presets** — edit `BG_PRESETS` in `app.js`. The bundled clips live on the `assets` branch (`videos/*.mp4`, ~15s 1080p H.264, no audio); serve your own via any CORS-enabled static host.
- **Glass look** — `--glass-*` and `--ambient` in `styles.css`.
- **Storage key** — `pomodoro:v3`; clear-all-data is in the settings panel.

## Tech

- Vanilla HTML + CSS + JS. Zero dependencies, zero build.
- Pointer Events drag, WebAudio (chime + procedural noise), Notification API, Media Session API, YouTube IFrame API (lazy), `localStorage`.
- Tested with real click automation (Playwright + headless Chromium): timer accuracy, mode cycling incl. breathing phase, drag + fraction persistence, all 3 clock styles, playlist add/play/remove (titles-only, no visible iframe), soundscape toggles, Mode Hening, all 4 background presets via double-buffer — plus screenshot review at 390×844 and 1440×900.

## Credits

Background clips are trimmed from freely licensed Wikimedia Commons videos: raindrops on glass (Radevormwald), misty forest (From the mountain high), Singapore Chinatown at night, and a rainy day campsite in Slovenia. Re-encoded to 1080p H.264 loops; see the file pages on Wikimedia Commons for authors and exact licenses.

## Known limitations

- Headless test environments without video decode fall back to the gradient; playback is verified via `curl` + local-file code paths.
- YouTube embeds need the IFrame API (loaded lazily on first YouTube track).

## License

MIT — see [LICENSE](LICENSE).
