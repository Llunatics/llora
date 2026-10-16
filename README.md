# Pomodoro

Pomodoro focus timer with an iOS-style **liquid glass** UI, full-screen video backgrounds, a draggable clock, and a built-in video playlist. Static site — no build step, no frameworks, just open `index.html`.

![Desktop](assets/screenshot-desktop.png)
![Mobile](assets/screenshot-mobile.png)

## Features

- **Liquid glass UI** — genuinely thin and airy: `rgba(255,255,255,0.08)` surfaces, `blur(10px) saturate(140%)`, 1px `rgba(255,255,255,0.13)` borders, subtle shadows. No heavy frosted panels.
- **Video background** — full-screen looping `<video>` with a vignette overlay for readability.
  - 4 built-in presets (verified hotlinkable MP4s on the Pexels CDN): Hujan di Kaca, Hujan Hutan, Jalan Hujan, Kota Malam.
  - Paste any direct `.mp4` / `.webm` URL as a custom background.
  - Robust playback: retries `play()` on `canplay`, and if a video never loads you get a small toast ("Background gagal dimuat, coba preset lain") instead of a dead screen — the animated gradient fallback keeps showing underneath.
- **Pomodoro timer**
  - Custom focus / short break / long break durations (minutes, decimals allowed) + sessions-before-long-break.
  - Start / pause / reset / skip, progress bar, session dots, auto-continue toggle.
  - Tab title shows remaining time; WebAudio chime + optional browser Notification on session end.
- **Draggable clock** — floating digits, no box or card. Drag it anywhere (mouse + touch via Pointer Events); position persists in `localStorage`.
  - 3 switchable faces: floating digital, minimal thin, analog progress dial.
  - 3 small circular controls (start/pause, reset, skip), thin progress bar, 6px session dots, tiny uppercase mode label.
  - A one-time toast hints the drag on first visit — no permanent labels.
  - One-click reset back to center from settings.
- **Playlist (bottom-left)** — a small 44px circular glass button; tap to expand a compact panel (250px):
  - Add videos one by one: YouTube links (watch / youtu.be / embed / shorts) or direct `.mp4` / `.webm`.
  - Play / pause / next / prev / remove, click-to-play, auto-advance on track end.
  - Persisted in `localStorage`.
- **Settings (top-right hamburger, 40px)** — background picker, custom video URL, clock style, position reset, durations, sound toggle, notification toggle, clear-all-data. Compact 13px type.
- **Persistence** — everything (durations, clock style/position, playlist, background, toggles) lives in `localStorage` under `pomodoro:v1`.
- **Responsive** — compact on mobile; nothing dominates the screen except the background.

## Usage

```bash
# just open it — no build, no dependencies
open index.html
# or serve locally
python3 -m http.server 8000
```

Then:

1. Press play on the clock to start a 25-minute focus session.
2. Drag the clock anywhere you like.
3. Open the hamburger (top-right) to change background, clock style, or durations.
4. Tap the ♪ button (bottom-left) and paste YouTube / MP4 links for background tunes.

## Customization

- **Background presets** — edit `BG_PRESETS` in `app.js` (each entry: `id`, `name`, `url`). URLs must be direct video files (check `Content-Type: video/mp4` with `curl -sI` before adding).
- **Glass look** — tweak `--glass-*` variables and `.glass` in `styles.css`.
- **Storage key** — `pomodoro:v1` in `localStorage`; the settings panel has a clear-all-data button.

## Tech

- Vanilla HTML + CSS + JS. Zero dependencies, zero build.
- Pointer Events for drag (mouse + touch), WebAudio API for the chime, Notification API for session alerts, `localStorage` for persistence.
- Tested with real click automation (Playwright + headless Chromium): 27 assertions covering timer start/pause/reset/skip, clock style switching, drag + position persistence, background preset switching, playlist add/open/close, and settings — plus screenshot review at 390×844 and 1440×900.

## Known limitations

- YouTube embeds can't auto-detect track end (no YT IFrame API), so auto-advance works for direct video files only.
- Background videos are streamed from third-party CDNs; if one goes down, the gradient fallback shows and you can paste a replacement URL.

## License

MIT — see [LICENSE](LICENSE).
