# Pomodoro

Pomodoro focus timer with an iOS-style **liquid glass** UI, full-screen video backgrounds, a draggable clock, and a built-in video playlist. Static site — no build step, no frameworks, just open `index.html`.

![Desktop](assets/screenshot-desktop.png)
![Mobile](assets/screenshot-mobile.png)

## Features

- **Liquid glass UI** — frosted panels (`backdrop-filter: blur + saturate`), semi-transparent surfaces, soft shadows, top highlight. Clean, modern, minimal.
- **Video background** — full-screen looping `<video>` with dark overlay for readability.
  - 4 built-in presets (verified hotlinkable MP4s): Lofi Study, Forest Rain, Rainy Room, City Night.
  - Paste any direct `.mp4` / `.webm` URL as a custom background.
  - Graceful fallback to an animated gradient if a video fails to load.
- **Pomodoro timer**
  - Custom focus / short break / long break durations (minutes, decimals allowed) + sessions-before-long-break.
  - Start / pause / reset / skip, progress bar, session dots, auto-continue toggle.
  - Tab title shows remaining time; WebAudio chime + optional browser Notification on session end.
- **Draggable clock** — drag the timer card anywhere (mouse + touch via Pointer Events); position persists in `localStorage`.
  - 3 switchable faces: big glass digital, minimal thin digital, analog progress dial.
  - One-click reset back to center.
- **Playlist (bottom-left)** — collapsible glass panel:
  - Add videos one by one: YouTube links (watch / youtu.be / embed / shorts) or direct `.mp4` / `.webm`.
  - Play / pause / next / prev / remove, click-to-play, auto-advance on track end.
  - Persisted in `localStorage`.
- **Settings (top-right hamburger)** — background picker, custom video URL, clock style, position reset, durations, sound toggle, notification toggle, clear-all-data.
- **Persistence** — everything (durations, clock style/position, playlist, background, toggles) lives in `localStorage` under `pomodoro:v1`.
- **Responsive** — usable on mobile; playlist starts collapsed on small screens so the timer stays reachable.

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
4. Paste YouTube / MP4 links into the playlist panel (bottom-left) for background tunes.

## Customization

- **Background presets** — edit `BG_PRESETS` in `app.js` (each entry: `id`, `name`, `url`). URLs must be direct video files (check `Content-Type: video/mp4` with `curl -sI` before adding).
- **Glass look** — tweak `--glass-*` variables and `.glass` in `styles.css`.
- **Storage key** — `pomodoro:v1` in `localStorage`; the settings panel has a clear-all-data button.

## Tech

- Vanilla HTML + CSS + JS. Zero dependencies, zero build.
- Pointer Events for drag (mouse + touch), WebAudio API for the chime, Notification API for session alerts, `localStorage` for persistence.
- Tested with real click automation (Playwright + headless Chromium): 40+ assertions covering timer start/pause/reset/skip, auto session cycling, clock style switching, drag + position persistence, background preset/custom switching, playlist add/play/pause/remove/auto-advance/collapse, and reload persistence.

## Known limitations

- YouTube embeds can't auto-detect track end (no YT IFrame API), so auto-advance works for direct video files only.
- Background videos are streamed from third-party CDNs; if one goes down, the gradient fallback shows and you can paste a replacement URL.

## License

MIT — see [LICENSE](LICENSE).
