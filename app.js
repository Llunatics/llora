/* ============================================================
   Llora — focus timer, liquid glass edition v4
   Vanilla JS, no frameworks. State persisted in localStorage.
   - Date.now()-delta timer (no drift), 250ms tick
   - Double-buffered video backgrounds + adaptive glass tint
   - Mode Hening, Satu Hal, breathing transition
   - Procedural WebAudio soundscape mixer
   - Photo fallbacks per video preset, background video sound toggle
   - Playlist: titles only, hidden YT / native engines, YouTube playlist import
   ============================================================ */
'use strict';

const STORE_KEY = 'pomodoro:v3'; // keep the legacy key: renaming wipes users' saved settings
const LEGACY_KEYS = ['pomodoro:v2', 'pomodoro:v1'];
const BREATHE_SEC = 15;
const CDN_BASE = 'https://cdn.jsdelivr.net/gh/Llunatics/llora@assets/videos/';
const POSTER_BASE = 'https://cdn.jsdelivr.net/gh/Llunatics/llora@assets/posters/';

const BG_PRESETS = [
  { id: 'hujan-kaca',   name: 'Rain on Glass', url: CDN_BASE + 'hujan-kaca.mp4',   poster: POSTER_BASE + 'hujan-kaca.jpg' },
  { id: 'hutan-hujan',  name: 'Rainforest',    url: CDN_BASE + 'hutan-hujan.mp4',  poster: POSTER_BASE + 'hutan-hujan.jpg' },
  { id: 'kota-malam',   name: 'Night City',    url: CDN_BASE + 'kota-malam.mp4',    poster: POSTER_BASE + 'kota-malam.jpg' },
  { id: 'ruang-hangat', name: 'Cozy Room',     url: CDN_BASE + 'ruang-hangat.mp4', poster: POSTER_BASE + 'ruang-hangat.jpg' },
  { id: 'senja-laut',   name: 'Sea Sunset',    url: CDN_BASE + 'senja-laut.mp4',   poster: POSTER_BASE + 'senja-laut.jpg' },
];
const BG_IDS = BG_PRESETS.map(p => p.id);

/* 12 clock styles — Google Fonts, lazy-loaded with digit subsetting (~2KB each) */
const GF = (fam, spec) => `https://fonts.googleapis.com/css2?family=${fam}:${spec}&text=0123456789%3A&display=swap`;
const CLOCK_STYLES = [
  { id: 'air',     name: 'Air Thin',    font: GF('Plus+Jakarta+Sans', 'wght@200') },
  { id: 'vogue',   name: 'Classic Editorial', font: GF('Cormorant+Garamond', 'ital,wght@1,300') },
  { id: 'kyoto',   name: 'Japanese Cinema',  font: GF('Shippori+Mincho', 'wght@400') },
  { id: 'bauhaus', name: 'Swiss Architect',  font: GF('Space+Grotesk', 'wght@300') },
  { id: 'kapsul',  name: 'Tall Capsule',  font: GF('Antonio', 'wght@200') },
  { id: 'ketik',   name: 'Dusk Typewriter', font: GF('JetBrains+Mono', 'wght@100') },
  { id: 'organik', name: 'Organic Glass',   font: GF('Quicksand', 'wght@300') },
  { id: 'galeri',  name: 'Art Gallery',    font: GF('Bodoni+Moda', 'opsz,wght@72,400') },
  { id: 'kawat',   name: 'Double Line',    font: GF('Bungee+Hairline', 'wght@400') },
  { id: 'nordik',  name: 'Nordic Minimal', font: GF('Outfit', 'wght@100') },
  { id: 'puisi',   name: 'Romantic Prose', font: GF('Instrument+Serif', 'ital,wght@1,400') },
  { id: 'zen',     name: 'Vertical Zen',   font: GF('DM+Sans', 'wght@200') },
];
const CLOCK_IDS = CLOCK_STYLES.map(s => s.id);

const MODE_LABEL = { focus: 'Focus', short: 'Short break', long: 'Long break', breathe: 'Breathe', overtime: 'Flowing' };
const STYLE_MIGRATE = { big: 'air', min: 'ketik', analog: 'air', lock: 'air', serif: 'vogue', mono: 'ketik' };
const DEFAULT_STATE = {
  durations: { focus: 25, short: 5, long: 15 },
  cycle: 4,
  autoContinue: true,
  breathe: true,
  hening: true,
  sound: true,
  notif: false,
  clockStyle: 'air',
  clockPos: null,          // {fx, fy} viewport fractions of clock center
  clockMode: false,        // true = wall-clock display instead of the timer
  bgId: 'hujan-kaca',
  bgCustom: '',
  bgSound: false,         // background video sound on/off
  dimBg: 0,               // background dimmer 0-70 (%)
  clockSize: 100,         // clock size 70-140 (%)
  scrim: { a: 55, spread: 85 }, // clock backdrop: darkness 0-80 (%), spread 0-160 (px)
  playlist: [],            // [{id, title, url, type, ytId}]
  currentTrack: -1,
  soundscape: { pink: 0, brown: 0, white: 0, gamma: 0 },
  oneThing: { text: '', date: '' },
  stats: { date: '', focusSec: 0 },  // today's banked focus seconds
  acc: {},                // accordion open state per settings group
};

/* ---------------- state ---------------- */
function loadState() {
  const fresh = () => structuredClone(DEFAULT_STATE);
  let merged = fresh();
  try {
    for (const key of LEGACY_KEYS) {
      const raw = localStorage.getItem(key);
      if (raw) {
        try {
          const p = JSON.parse(raw);
          merged = Object.assign(merged, p, {
            durations: Object.assign({}, DEFAULT_STATE.durations, p.durations || {}),
            soundscape: Object.assign({}, DEFAULT_STATE.soundscape, p.soundscape || {}),
            scrim: Object.assign({}, DEFAULT_STATE.scrim, p.scrim || {}),
            acc: Object.assign({}, p.acc || {}),
            oneThing: Object.assign({}, DEFAULT_STATE.oneThing, p.oneThing || {}),
          });
        } catch { /* skip bad legacy */ }
        localStorage.removeItem(key);
      }
    }
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      merged = Object.assign(merged, p, {
        durations: Object.assign({}, DEFAULT_STATE.durations, p.durations || {}),
        soundscape: Object.assign({}, DEFAULT_STATE.soundscape, p.soundscape || {}),
        scrim: Object.assign({}, DEFAULT_STATE.scrim, p.scrim || {}),
        oneThing: Object.assign({}, DEFAULT_STATE.oneThing, p.oneThing || {}),
        acc: Object.assign({}, p.acc || {}),
      });
    }
  } catch { return fresh(); }
  // migrate old clock styles / positions / backgrounds
  if (STYLE_MIGRATE[merged.clockStyle]) merged.clockStyle = STYLE_MIGRATE[merged.clockStyle];
  if (merged.clockPos && merged.clockPos.fx === undefined) merged.clockPos = null; // px -> recenter
  if (!CLOCK_IDS.includes(merged.clockStyle)) merged.clockStyle = 'air';
  if (!BG_IDS.includes(merged.bgId) && merged.bgId !== 'custom') merged.bgId = 'hujan-kaca';
  // daily stats reset
  const today = new Date().toISOString().slice(0, 10);
  if (!merged.stats || merged.stats.date !== today) merged.stats = { date: today, focusSec: 0 };
  // one-thing is per-day
  if (merged.oneThing.date !== today) merged.oneThing = { text: '', date: today };
  return merged;
}
const S = loadState();
// Vibe preview: while set, save() is a no-op so a shared link never
// overwrites the visitor's own localStorage.
let vibePreview = null, vibeSaving = false;
function save() {
  if (vibePreview && !vibeSaving) return;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch {}
}
function bankFocus(sec) {
  const today = new Date().toISOString().slice(0, 10);
  if (S.stats.date !== today) S.stats = { date: today, focusSec: 0 };
  S.stats.focusSec += Math.max(0, Math.round(sec));
  save();
}

/* ---------------- helpers ---------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const mmss = (sec) => {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `<span class="mm">${m}</span><span class="colon">:</span><span class="ss">${s}</span>`;
};
const mmssPlain = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

let toastTimer = null;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

/* ---------------- timer engine (Date.now delta, no drift) ---------------- */
const T = {
  mode: 'focus',
  remaining: S.durations.focus * 60,
  overtimeSec: 0,
  completedFocus: 0,
  running: false,
  endAt: 0,
  timerId: null,
};

const durSec = (mode) => mode === 'breathe' ? BREATHE_SEC
  : Math.max(6, Math.round(S.durations[mode] * 60));

// call AFTER completedFocus was incremented on focus end
const modeAfterFocus = () => (T.completedFocus % S.cycle === 0) ? 'long' : 'short';

function start() {
  if (T.running) return;
  if (T.mode === 'overtime') {
    // resume count-up: re-anchor endAt so elapsed overtime stays continuous
    T.endAt = Date.now() - (T.overtimeSec || 0) * 1000;
  } else {
    if (T.remaining <= 0) T.remaining = durSec(T.mode);
    T.endAt = Date.now() + T.remaining * 1000;
  }
  const freshFocus = T.mode === 'focus' && T.remaining >= durSec('focus') - 1;
  T.running = true;
  clearInterval(T.timerId);
  T.timerId = setInterval(tick, 250);
  lockWake();
  if (freshFocus) thrumStart();
  render();
}

function pause() {
  if (!T.running) return;
  if (T.mode === 'overtime') {
    T.overtimeSec = Math.max(0, Math.floor((Date.now() - T.endAt) / 1000));
  } else {
    T.remaining = Math.max(0, Math.ceil((T.endAt - Date.now()) / 1000));
  }
  T.running = false;
  clearInterval(T.timerId);
  releaseWake();
  render();
}

function resetSession() {
  pause();
  $('#clockInner').classList.remove('breathing');
  if (T.mode === 'overtime') exitOvertimeUI();
  T.mode = 'focus';
  T.remaining = durSec('focus');
  render();
}

function tick() {
  if (T.mode === 'overtime') {
    T.overtimeSec = Math.max(0, Math.floor((Date.now() - T.endAt) / 1000));
    render();
    return;
  }
  T.remaining = Math.max(0, Math.ceil((T.endAt - Date.now()) / 1000));
  if (T.remaining <= 0) completeSession();
  else render();
}

/* --- Flow mode: at 00:00 keep flowing, count up --- */
function enterOvertime() {
  clearInterval(T.timerId);
  T.completedFocus++;
  dissolveOneThing();
  bankFocus(durSec('focus'));
  bowlStrike();
  notifyUser('focus');
  T.mode = 'overtime';
  T.overtimeSec = 0;
  // keep T.endAt as the anchor; timer keeps "running" so tick() counts up
  T.running = true;
  clearInterval(T.timerId);
  T.timerId = setInterval(tick, 250);
  $('#clockCard').classList.add('overtime');
  $('#overtimeBtn').classList.remove('hidden');
  lockWake();
  toast('Time is up — but if you are in the flow, keep going.');
  render();
}

function exitOvertimeUI() {
  $('#clockCard').classList.remove('overtime');
  $('#overtimeBtn').classList.add('hidden');
}

function endOvertime() {
  // "Lanjut Rehat →": bank overtime, then breathe-or-break like a normal focus end
  const extra = T.overtimeSec || 0;
  if (extra > 0) bankFocus(extra);
  exitOvertimeUI();
  T.running = false;
  clearInterval(T.timerId);
  releaseWake();
  if (S.breathe) {
    T.mode = 'breathe';
    T.remaining = BREATHE_SEC;
    $('#clockInner').classList.remove('breathing');
    void $('#clockInner').offsetWidth;
    $('#clockInner').classList.add('breathing');
    toast(extra > 0 ? `+${Math.floor(extra / 60)} min of flow logged. Take a breath…` : 'Take a breath…');
    render();
    start();
    return;
  }
  T.mode = modeAfterFocus();
  T.remaining = durSec(T.mode);
  toast('Time for a break.');
  render();
  if (S.autoContinue) start();
}

function completeSession() {
  clearInterval(T.timerId);
  T.running = false;
  releaseWake();
  const finished = T.mode;

  if (finished === 'focus') {
    // never hard-stop at 00:00 — flow into Flow mode instead
    enterOvertime();
    return;
  } else if (finished === 'breathe') {
    $('#clockInner').classList.remove('breathing');
    T.mode = modeAfterFocus();
    T.remaining = durSec(T.mode);
    toast(`Time for ${MODE_LABEL[T.mode].toLowerCase()}.`);
  } else {
    bowlStrike();
    notifyUser('break');
    T.mode = 'focus';
    T.remaining = durSec('focus');
    toast('Break over. Back to focus.');
  }

  render();
  if (S.autoContinue) start();
}

function skipSession() {
  const skipped = T.mode;
  if (T.running) { clearInterval(T.timerId); T.running = false; }
  releaseWake();
  $('#clockInner').classList.remove('breathing');
  if (skipped === 'overtime') {
    exitOvertimeUI(); // completedFocus already counted at overtime entry
    T.mode = modeAfterFocus();
  } else {
    if (skipped === 'focus') { T.completedFocus++; dissolveOneThing(); bankFocus(durSec('focus')); }
    T.mode = (skipped === 'focus' || skipped === 'breathe') ? modeAfterFocus() : 'focus';
  }
  T.remaining = durSec(T.mode);
  render();
  toast(`Skipped ${MODE_LABEL[skipped].toLowerCase()} session.`);
}

/* ---------------- rendering ---------------- */
function progress() {
  if (T.mode === 'overtime') return 1;
  const total = durSec(T.mode);
  return total > 0 ? 1 - T.remaining / total : 0;
}

const mmssPlus = (sec) => {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `<span class="mm">+${m}</span><span class="colon">:</span><span class="ss">${s}</span>`;
};

/* wall-clock display mode: the card becomes a desk clock (timer keeps
   running underneath if it was started) */
function applyClockMode() {
  const on = !!S.clockMode;
  const card = $('#clockCard');
  if (card) card.classList.toggle('clock-mode', on);
  $$('[data-date]').forEach(el => el.classList.toggle('hidden', !on));
  document.querySelectorAll('.mt-opt').forEach(b =>
    b.setAttribute('aria-selected', String((b.dataset.mt === 'clock') === on)));
}
function setClockMode(on) {
  S.clockMode = !!on;
  save();
  applyClockMode();
  render();
}

function render() {
  const p = progress();
  const label = MODE_LABEL[T.mode];
  const cycleNum = (T.completedFocus % S.cycle) + 1;
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const wallHTML = `<span class="mm">${hh}</span><span class="colon">:</span><span class="ss">${mi}</span>`;
  const timeHTML = S.clockMode ? wallHTML
    : T.mode === 'overtime' ? mmssPlus(T.overtimeSec || 0) : mmss(T.remaining);

  $$('[data-time]').forEach(el => { el.innerHTML = timeHTML; });
  if (S.clockMode) {
    const dstr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    $$('[data-date]').forEach(el => { el.textContent = dstr; });
  }
  $$('[data-mode-label]').forEach(el => { el.textContent = label; });
  $$('[data-cycle]').forEach(el => { el.textContent = `Session ${cycleNum}/${S.cycle}`; });
  $$('[data-next]').forEach(el => {
    el.textContent = 'next: ' + (T.mode === 'focus' || T.mode === 'breathe' || T.mode === 'overtime'
      ? MODE_LABEL[modeAfterFocus()].toLowerCase() : 'focus');
  });
  $$('[data-progress]').forEach(el => { el.style.width = `${(p * 100).toFixed(1)}%`; });

  $$('[data-dots]').forEach(box => {
    box.innerHTML = '';
    for (let i = 0; i < S.cycle; i++) {
      const d = document.createElement('i');
      if (i < T.completedFocus % S.cycle) d.className = 'done';
      box.appendChild(d);
    }
  });

  const playing = T.running;
  const iconPlay = $('[data-icon-play]'), iconPause = $('[data-icon-pause]');
  if (iconPlay) iconPlay.classList.toggle('hidden', playing);
  if (iconPause) iconPause.classList.toggle('hidden', !playing);
  $('#clockCard').classList.toggle('running', playing);

  const titleTime = S.clockMode ? `${hh}:${mi}`
    : T.mode === 'overtime' ? `+${mmssPlain(T.overtimeSec || 0)}`
    : mmssPlain(T.remaining);
  document.title = S.clockMode ? `${titleTime} · Llora`
    : (playing || T.remaining < durSec(T.mode) || T.mode === 'overtime')
    ? `${titleTime} · Llora`
    : 'Llora — Focus Timer';
}

/* ---------------- sound + notification ---------------- */
let audioCtx = null;
function ac() {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}
/* --- singing bowl ritual audio (zero files) ---
   thrumStart: tactile low sweep when a focus session begins (90 -> 45 Hz, 250ms)
   bowlStrike: Tibetan singing bowl at 00:00 — 3 inharmonic partials
   (1 : 2.756 : 5.404), differential decay, 4Hz vibrato on the fundamental */
function thrumStart() {
  if (!S.sound) return;
  try {
    const ctx = ac();
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, t0);
    osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.25);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0); osc.stop(t0 + 0.35);
  } catch { /* audio unavailable */ }
}

function bowlStrike() {
  if (!S.sound) return;
  try {
    const ctx = ac();
    const t0 = ctx.currentTime + 0.02;
    const partials = [
      { ratio: 1,     dur: 4.5, vol: 0.30 },  // fundamental 220Hz, rings longest
      { ratio: 2.756, dur: 2.2, vol: 0.12 },
      { ratio: 5.404, dur: 1.5, vol: 0.07 },  // high partials die first
    ];
    partials.forEach((p, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 220 * p.ratio;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(p.vol, t0 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + p.dur);
      // 4Hz vibrato on the fundamental, like a real swinging bowl
      if (i === 0) {
        const vib = ctx.createOscillator();
        const vibGain = ctx.createGain();
        vib.frequency.value = 4;
        vibGain.gain.value = 2.5;
        vib.connect(vibGain).connect(osc.frequency);
        vib.start(t0); vib.stop(t0 + p.dur + 0.1);
      }
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0); osc.stop(t0 + p.dur + 0.1);
    });
  } catch { /* audio unavailable */ }
}

function notifyUser(kind) {
  if (!S.notif || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    new Notification('Llora', {
      body: kind === 'focus' ? 'Focus session done. Time for a break.' : 'Break over. Back to focus.',
    });
  } catch {}
}

/* --- Screen Wake Lock: keep mobile screens alive while the timer runs --- */
let wakeLock = null;
async function lockWake() {
  if (!('wakeLock' in navigator)) return;
  try {
    if (wakeLock) return;
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { wakeLock = null; }
}
function releaseWake() {
  if (!wakeLock) return;
  try { wakeLock.release(); } catch {}
  wakeLock = null;
}

/* ---------------- draggable clock (viewport fractions) ---------------- */
function initDrag() {
  const card = $('#clockCard');
  let dragging = false, suppressClick = false, startX = 0, startY = 0, baseX = 0, baseY = 0;

  const toAbsolute = () => {
    if (card.classList.contains('centered')) {
      const r = card.getBoundingClientRect();
      card.classList.remove('centered');
      card.style.left = `${r.left}px`;
      card.style.top = `${r.top}px`;
      card.style.transform = 'none';
    }
  };

  const clampPos = (x, y) => ({
    x: Math.min(Math.max(8, x), window.innerWidth - card.offsetWidth - 8),
    y: Math.min(Math.max(8, y), window.innerHeight - card.offsetHeight - 8),
  });

  card.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.no-drag, button, input, select, textarea, a')) return;
    if (e.button !== undefined && e.button !== 0) return;
    toAbsolute();
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    baseX = parseFloat(card.style.left) || 0;
    baseY = parseFloat(card.style.top) || 0;
    card.classList.add('dragging');
    try { card.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  });

  card.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const { x, y } = clampPos(baseX + e.clientX - startX, baseY + e.clientY - startY);
    card.style.left = `${x}px`;
    card.style.top = `${y}px`;
  });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    card.classList.remove('dragging');
    // drag-vs-click disambiguation: a real drag must not trigger click actions
    if (e && Math.hypot(e.clientX - startX, e.clientY - startY) > 5) suppressClick = true;
    const r = card.getBoundingClientRect();
    S.clockPos = {
      fx: (r.left + r.width / 2) / window.innerWidth,
      fy: (r.top + r.height / 2) / window.innerHeight,
    };
    save();
    if (hintShown) { hintShown = false; }
  };
  card.addEventListener('pointerup', endDrag);
  card.addEventListener('pointercancel', endDrag);
  // swallow the synthetic click that fires right after a drag
  card.addEventListener('click', (e) => {
    if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; }
  }, true);

  window.addEventListener('resize', () => { if (S.clockPos) applyClockPos(); });
  if (S.clockPos) applyClockPos();
}

function applyClockPos() {
  const card = $('#clockCard');
  if (!S.clockPos) return;
  card.classList.remove('centered');
  const x = Math.min(Math.max(8, S.clockPos.fx * window.innerWidth - card.offsetWidth / 2),
    window.innerWidth - card.offsetWidth - 8);
  const y = Math.min(Math.max(8, S.clockPos.fy * window.innerHeight - card.offsetHeight / 2),
    window.innerHeight - card.offsetHeight - 8);
  card.style.left = `${x}px`;
  card.style.top = `${y}px`;
  card.style.transform = 'none';
}

function resetClockPos() {
  const card = $('#clockCard');
  S.clockPos = null; save();
  card.style.left = ''; card.style.top = ''; card.style.transform = '';
  card.classList.add('centered');
  toast('Clock reset to center.');
}

/* ---------------- 12 clock styles (lazy Google Fonts) ---------------- */
const loadedFonts = new Set();
function ensureFont(styleId) {
  const st = CLOCK_STYLES.find(s => s.id === styleId);
  if (!st || loadedFonts.has(styleId)) return;
  loadedFonts.add(styleId);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = st.font;
  document.head.appendChild(link);
}
/* clock style dropdown */
function renderClockSelect() {
  const items = CLOCK_STYLES.map(s => ({ value: s.id, label: s.name }));
  if (!clockDD) clockDD = buildDropdown('#clockSelectWrap', items, () => S.clockStyle, (v) => setClockStyle(v));
  else clockDD.paint();
}
function syncClockSelect() { if (clockDD) clockDD.paint(); }
function setClockStyle(style) {
  if (!CLOCK_IDS.includes(style)) style = 'air';
  S.clockStyle = style; save();
  ensureFont(style);
  $('#clockCard').dataset.clockStyle = style;
  syncClockSelect();
}
function cycleClockStyle(dir = 1) {
  const i = CLOCK_IDS.indexOf(S.clockStyle);
  const next = CLOCK_IDS[(i + dir + CLOCK_IDS.length) % CLOCK_IDS.length];
  setClockStyle(next);
  toast(`Clock style: ${CLOCK_STYLES.find(s => s.id === next).name}`);
}

/* ---------------- background: double-buffered crossfade + YouTube engine ---------------- */
let bgFront = null, bgBack = null, bgYtEl = null, bgFailTimer = null, bgErrorToasted = false;
let tintTimer = null, tintOK = true, bgYtActive = false;

const NEUTRAL_TINT = 'rgba(255,255,255,0.12)';
const isTrustedVideo = (url) => typeof url === 'string' && url.startsWith(CDN_BASE);

function bgUrl() {
  return S.bgCustom || (BG_PRESETS.find(p => p.id === S.bgId) || BG_PRESETS[0]).url;
}
function bgCustomYtId() {
  const m = (S.bgCustom || '').match(YT_RE);
  return m ? m[1] : null;
}

/* instant photo fallback: shown behind a preset's video while it loads
   (or if it fails). Custom backgrounds have no photo -> gradient stays. */
function setBgPhoto(url) {
  const img = $('#bgPhoto');
  if (!img) return;
  if (!url) { img.classList.remove('on'); img.removeAttribute('src'); return; }
  if (img.getAttribute('src') !== url) img.src = url;
  img.classList.add('on');
}
function presetPoster() {
  const p = BG_PRESETS.find(p => p.id === S.bgId);
  return (p && !S.bgCustom) ? p.poster : '';
}

/* clock backdrop scrim: tunable darkness + spread, painted as CSS vars
   on the clock card (the ::before radial gradient reads them) */
function applyScrim() {
  const card = $('#clockCard');
  if (!card) return;
  const a = Math.min(80, Math.max(0, S.scrim.a || 0)) / 100;
  card.style.setProperty('--scrim-a', a.toFixed(2));
  card.style.setProperty('--scrim-a2', (a * 0.45).toFixed(2));
  card.style.setProperty('--scrim-spread', Math.min(160, Math.max(0, S.scrim.spread || 0)) + 'px');
}

/* background dimmer: black overlay opacity over the video */
function applyDimBg() {
  const el = $('#bgDim');
  if (!el) return;
  el.style.opacity = (Math.min(70, Math.max(0, S.dimBg || 0)) / 100).toFixed(2);
}

/* clock size: independent `scale` property so it never fights the
   centering transform or the breathing animation */
function applyClockSize() {
  const card = $('#clockCard');
  if (!card) return;
  card.style.scale = String(Math.min(140, Math.max(70, S.clockSize || 100)) / 100);
}

/* collapsible settings groups; open state persists in S.acc */
function initAccordion() {
  document.querySelectorAll('.set-group.acc').forEach(sec => {
    const key = sec.dataset.acc;
    const head = sec.querySelector('.acc-head');
    if (!head) return;
    const set = (open) => {
      sec.dataset.open = String(open);
      head.setAttribute('aria-expanded', String(open));
      S.acc = S.acc || {};
      S.acc[key] = open;
      save();
    };
    head.addEventListener('click', () => set(sec.dataset.open !== 'true'));
    const open = !!(S.acc && S.acc[key]);
    sec.dataset.open = String(open);
    head.setAttribute('aria-expanded', String(open));
  });
}

/* background video sound toggle: muted <video> elements + the YouTube
   background iframe (via enablejsapi postMessage) */
function applyBgSound() {
  const muted = !S.bgSound;
  [bgFront, bgBack].forEach(v => { if (v) v.muted = muted; });
  if (bgYtActive && bgYtEl && bgYtEl.contentWindow) {
    try {
      bgYtEl.contentWindow.postMessage(
        JSON.stringify({ event: 'command', func: muted ? 'mute' : 'unMute', args: '' }), '*');
    } catch { /* iframe not ready yet */ }
  }
}

/* CORS: crossorigin="anonymous" ONLY for our trusted jsDelivr URLs.
   Custom URLs load without it; the tint sampler's try/catch handles taint. */
function setVideoSource(v, url) {
  v.dataset.pendingSrc = url;
  v.dataset.corsRetried = '';
  v.pause();
  v.removeAttribute('src');
  if (isTrustedVideo(url)) v.setAttribute('crossorigin', 'anonymous');
  else v.removeAttribute('crossorigin');
  v.src = url;
  v.load();
}

function wireVideoCommon(v) {
  v.addEventListener('error', () => {
    // CORS retry: if crossOrigin broke a custom URL, retry once without it
    if (v.crossOrigin && !v.dataset.corsRetried) {
      v.dataset.corsRetried = '1';
      v.removeAttribute('crossorigin');
      const src = v.dataset.pendingSrc;
      if (src) { v.src = src; v.load(); v.play().catch(() => {}); }
      return;
    }
    v.classList.remove('on');
    if (!bgErrorToasted) {
      bgErrorToasted = true;
      clearTimeout(bgFailTimer);
      toast('Background failed to load — try another preset.');
    }
  });
}

/* YouTube as fullscreen background: zoomed iframe (chrome cropped), muted+loop.
   Ambient sampler can't read cross-origin iframes -> neutral tint instead. */
function showYouTubeBg(ytId) {
  bgYtActive = true;
  stopTintSampler();
  document.documentElement.style.setProperty('--ambient', NEUTRAL_TINT);
  [bgFront, bgBack].forEach(v => { if (v) { v.classList.remove('on'); v.pause(); } });
  setBgPhoto(''); // custom bg: gradient behind the iframe
  bgYtEl.classList.remove('on');
  bgYtEl.src = `https://www.youtube.com/embed/${ytId}?autoplay=1&mute=1&loop=1&playlist=${ytId}`
    + `&controls=0&modestbranding=1&rel=0&playsinline=1&disablekb=1&iv_load_policy=3&enablejsapi=1`;
  bgYtEl.addEventListener('load', () => { bgYtEl.classList.add('on'); applyBgSound(); }, { once: true });
  clearTimeout(bgFailTimer);
  bgFailTimer = setTimeout(() => bgYtEl.classList.add('on'), 4000); // don't hang on slow load
  renderBgSelect();
}

function hideYouTubeBg() {
  bgYtActive = false;
  bgYtEl.classList.remove('on');
  bgYtEl.removeAttribute('src');
}

let bgPendingReady = null; // active canplaythrough listener, so rapid switches don't double-swap
function switchBackground() {
  clearTimeout(bgFailTimer);
  bgErrorToasted = false;
  const ytId = bgCustomYtId();
  if (ytId) { showYouTubeBg(ytId); return; }
  hideYouTubeBg();

  const url = bgUrl();
  setBgPhoto(presetPoster()); // instant photo while the video loads
  // drop any stale canplaythrough listener from a previous in-flight switch
  if (bgPendingReady) { bgBack.removeEventListener('canplaythrough', bgPendingReady); bgPendingReady = null; }
  bgBack.classList.remove('on');
  setVideoSource(bgBack, url);

  const onReady = () => {
    // ignore if a newer switch superseded this one
    if (bgPendingReady !== onReady) return;
    bgPendingReady = null;
    bgBack.removeEventListener('canplaythrough', onReady);
    clearTimeout(bgFailTimer);
    bgBack.play().then(() => {
      bgBack.classList.add('on');
      bgFront.classList.remove('on');
      const tmp = bgFront; bgFront = bgBack; bgBack = tmp;
      tintOK = true; // trusted switch: allow the sampler again
      startTintSampler();
    }).catch(() => {
      // will retry on next canplay; watchdog covers total failure
    });
  };
  bgPendingReady = onReady;
  bgBack.addEventListener('canplaythrough', onReady);

  bgFailTimer = setTimeout(() => {
    if (!bgFront.classList.contains('on') && !bgBack.classList.contains('on') && !bgErrorToasted) {
      bgErrorToasted = true;
      toast('Background failed to load — try another preset.');
    }
  }, 12000);
  renderBgSelect();
}

function applyBackground() { switchBackground(); }

/* adaptive glass tint: sample video frame -> --ambient */
function stopTintSampler() {
  if (tintTimer) { clearInterval(tintTimer); tintTimer = null; }
}
function startTintSampler() {
  if (tintTimer || !tintOK || bgYtActive) return;
  const canvas = $('#tintCanvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  tintTimer = setInterval(() => {
    try {
      const v = bgFront;
      if (!v || v.readyState < 2 || !v.videoWidth) return;
      ctx.drawImage(v, 0, 0, 16, 16);
      const d = ctx.getImageData(0, 0, 16, 16).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      const n = d.length / 4;
      r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
      document.documentElement.style.setProperty('--ambient', `rgba(${r},${g},${b},0.10)`);
    } catch {
      // tainted canvas (custom URL without CORS) — neutral tint, sampler off
      document.documentElement.style.setProperty('--ambient', NEUTRAL_TINT);
      tintOK = false;
      stopTintSampler();
    }
  }, 2000);
}

/* hidden-tab battery saver: pause video + sampler; timer & audio keep running */
function initVisibilitySaver() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (bgFront) bgFront.pause();
      stopTintSampler();
      releaseWake(); // browsers release it anyway when hidden
    } else {
      if (!bgYtActive && bgFront && bgFront.src) bgFront.play().catch(() => {});
      startTintSampler();
      if (T.running) lockWake();
    }
  });
}

/* ---------- custom glass dropdowns (no white OS menu) ----------
   Button + option list portaled to <body> as position:fixed, so the settings
   panel's own scroll never clips it and the OS never paints a white menu. */
const CHEV_SVG = '<svg class="dd-chev" width="10" height="6" viewBox="0 0 10 6" fill="none">'
  + '<path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

function closeAllDropdowns() {
  let any = false;
  document.querySelectorAll('.dd-list:not(.hidden)').forEach(l => { l.classList.add('hidden'); any = true; });
  document.querySelectorAll('.dd-btn[aria-expanded="true"]')
    .forEach(b => b.setAttribute('aria-expanded', 'false'));
  return any;
}

function buildDropdown(wrapSel, items, current, onPick) {
  const wrap = $(wrapSel);
  wrap.innerHTML = '';
  wrap.className = 'dd';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dd-btn glass-select';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  const val = document.createElement('span');
  val.className = 'dd-val';
  btn.append(val);
  btn.insertAdjacentHTML('beforeend', CHEV_SVG);
  const list = document.createElement('ul');
  list.className = 'dd-list glass hidden';
  list.setAttribute('role', 'listbox');
  list.dataset.dd = wrapSel;
  const paint = () => {
    const cur = current();
    val.textContent = (items.find(i => i.value === cur) || { label: '' }).label;
    [...list.children].forEach(li => {
      const sel = li.dataset.value === cur;
      li.setAttribute('aria-selected', String(sel));
      li.classList.toggle('sel', sel);
    });
  };
  items.forEach(it => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.dataset.value = it.value;
    li.textContent = it.label;
    li.addEventListener('click', () => { closeAllDropdowns(); onPick(it.value); });
    list.appendChild(li);
  });
  document.body.appendChild(list); // portal out of the scrolling panel
  const open = () => {
    closeAllDropdowns();
    const r = btn.getBoundingClientRect();
    list.style.minWidth = r.width + 'px';
    list.style.left = Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8)) + 'px';
    list.classList.remove('hidden');
    const h = list.offsetHeight;
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    list.style.top = top + 'px';
    btn.setAttribute('aria-expanded', 'true');
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (btn.getAttribute('aria-expanded') === 'true') closeAllDropdowns();
    else open();
  });
  document.addEventListener('click', (e) => { if (!list.contains(e.target)) closeAllDropdowns(); });
  window.addEventListener('resize', closeAllDropdowns);
  window.addEventListener('scroll', (e) => {
    // scrolling the option list itself must NOT close it (capture phase sees it too)
    if (e.target && e.target.closest && e.target.closest('.dd-list')) return;
    closeAllDropdowns();
  }, true);
  wrap.appendChild(btn);
  paint();
  return { paint };
}

let bgDD = null, clockDD = null;
function renderBgSelect() {
  const items = BG_PRESETS.map(p => ({ value: p.id, label: p.name }));
  items.push({ value: 'custom', label: 'Custom URL…' });
  if (!bgDD) bgDD = buildDropdown('#bgSelectWrap', items, () => S.bgCustom ? 'custom' : S.bgId, onBgSelectPick);
  else bgDD.paint();
}
function onBgSelectPick(id) {
  if (id === 'custom') {
    if (!S.bgCustom) {
      toast('Paste a custom video URL below first.');
      renderBgSelect();
      $('#customBgUrl').focus();
      return;
    }
    applyBackground();
    return;
  }
  S.bgId = id; S.bgCustom = ''; $('#customBgUrl').value = ''; save();
  applyBackground();
  renderBgSelect();
  toast(`Background: ${BG_PRESETS.find(p => p.id === id).name}`);
}

/* ---------------- Mode Hening ---------------- */
let lastPointerMove = Date.now();
function panelOpen() {
  return !$('#settingsPanel').classList.contains('hidden') || !$('#playlistPanel').classList.contains('hidden');
}
function initHening() {
  const wake = () => {
    lastPointerMove = Date.now();
    document.body.classList.remove('hening');
  };
  ['pointermove', 'pointerdown', 'touchstart'].forEach(ev =>
    window.addEventListener(ev, wake, { passive: true }));
  setInterval(() => {
    if (S.hening && T.running && Date.now() - lastPointerMove > 6000 && !panelOpen()) {
      document.body.classList.add('hening');
    }
  }, 1000);
}

/* ---------------- global keyboard shortcuts (single listener) ---------------- */
function toggleHeningForce() {
  if (document.body.classList.contains('hening')) {
    document.body.classList.remove('hening');
    lastPointerMove = Date.now();
    toast('Zen mode off.');
  } else {
    document.body.classList.add('hening');
    toast('Zen mode on.');
  }
}
function initShortcuts() {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (closeAllDropdowns()) return; if (settingsToggle) settingsToggle(false); return; }
    const tag = (e.target && e.target.tagName) || '';
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === ' ') {
      if (tag === 'BUTTON') return; // native button activation already toggles
      e.preventDefault();
      T.running ? pause() : start();
    }
    else if (k === 'm') toggleMute();
    else if (k === 'n') stepTrack(1);
    else if (k === 'c') cycleClockStyle(1);
    else if (k === 'h') toggleHeningForce();
    else if (k === 't') setClockMode(!S.clockMode);
    else if (k >= '1' && k <= String(BG_PRESETS.length)) {
      const p = BG_PRESETS[Number(k) - 1];
      S.bgId = p.id; S.bgCustom = ''; $('#customBgUrl').value = ''; save();
      applyBackground();
      toast(`Background: ${p.name}`);
    }
  });
}

/* ---------------- Satu Hal ---------------- */
function initOneThing() {
  const input = $('#oneThingInput'), wrap = $('#oneThingWrap'), done = $('#oneThingDone');
  input.value = S.oneThing.text || '';
  const sync = () => {
    done.classList.toggle('hidden', !input.value.trim());
    S.oneThing.text = input.value.trim();
    S.oneThing.date = new Date().toISOString().slice(0, 10);
    save();
  };
  input.addEventListener('input', () => {
    wrap.classList.remove('dissolve');
    sync();
  });
  input.addEventListener('change', sync);
  done.addEventListener('click', () => dissolveOneThing());
}
function dissolveOneThing() {
  const wrap = $('#oneThingWrap'), input = $('#oneThingInput');
  if (!input.value.trim()) return;
  wrap.classList.add('dissolve');
  setTimeout(() => {
    input.value = '';
    $('#oneThingDone').classList.add('hidden');
    S.oneThing.text = ''; save();
    wrap.classList.remove('dissolve');
  }, 650);
  toast('One thing done. Nice work.');
}

/* ---------------- procedural soundscape mixer ---------------- */
const SC = { ctx: null, master: null, nodes: {} };
function noiseBuffer(ctx, kind) {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  if (kind === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else if (kind === 'brown') {
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  } else { // white
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
  }
  return buf;
}
function scEnsure() {
  if (SC.ctx) return SC.ctx;
  const ctx = ac();
  SC.ctx = ctx;
  SC.master = ctx.createGain();
  SC.master.gain.value = 0.9;
  SC.master.connect(ctx.destination);
  // "breathing" lowpass: pink/brown noise pass through a gentle lowpass whose
  // cutoff is slowly modulated by a 0.08Hz LFO (700-1600Hz) — like wind/surf
  const airFilter = ctx.createBiquadFilter();
  airFilter.type = 'lowpass';
  airFilter.frequency.value = 1150;
  airFilter.Q.value = 0.4;
  const lfo = ctx.createOscillator();
  lfo.type = 'sine'; lfo.frequency.value = 0.08;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 450; // swings cutoff ~700Hz <-> ~1600Hz
  lfo.connect(lfoDepth).connect(airFilter.frequency);
  lfo.start();
  airFilter.connect(SC.master);
  // pink noise
  const pinkSrc = ctx.createBufferSource();
  pinkSrc.buffer = noiseBuffer(ctx, 'pink'); pinkSrc.loop = true;
  const pinkGain = ctx.createGain(); pinkGain.gain.value = 0;
  pinkSrc.connect(pinkGain).connect(airFilter); pinkSrc.start();
  // brown noise
  const brownSrc = ctx.createBufferSource();
  brownSrc.buffer = noiseBuffer(ctx, 'brown'); brownSrc.loop = true;
  const brownGain = ctx.createGain(); brownGain.gain.value = 0;
  brownSrc.connect(brownGain).connect(airFilter); brownSrc.start();
  // white noise (airy, through the same breathing lowpass)
  const whiteSrc = ctx.createBufferSource();
  whiteSrc.buffer = noiseBuffer(ctx, 'white'); whiteSrc.loop = true;
  const whiteGain = ctx.createGain(); whiteGain.gain.value = 0;
  whiteSrc.connect(whiteGain).connect(airFilter); whiteSrc.start();
  // binaural gamma 40Hz: 220Hz L / 260Hz R
  const oL = ctx.createOscillator(); oL.frequency.value = 220;
  const oR = ctx.createOscillator(); oR.frequency.value = 260;
  const merger = ctx.createChannelMerger(2);
  const gL = ctx.createGain(); const gR = ctx.createGain();
  oL.connect(gL).connect(merger, 0, 0);
  oR.connect(gR).connect(merger, 0, 1);
  const gammaGain = ctx.createGain(); gammaGain.gain.value = 0;
  merger.connect(gammaGain).connect(SC.master);
  oL.start(); oR.start();
  SC.nodes = { pink: pinkGain, brown: brownGain, white: whiteGain, gamma: gammaGain };
  return ctx;
}
function scSet(kind, level) { // level 0..1
  S.soundscape[kind] = Math.round(level * 100); save();
  if (level > 0) { try { scEnsure(); } catch { return; } }
  if (SC.nodes[kind]) {
    SC.nodes[kind].gain.setTargetAtTime(level * 0.5, SC.ctx.currentTime, 0.4);
  }
}

/* global mute (M): smooth ~400ms fade on the soundscape master,
   stepped fade on playlist media elements, mute/unmute on YouTube */
let scMuted = false;
function fadeMediaEl(el, toZero) {
  const steps = 8;
  let i = 0;
  const id = setInterval(() => {
    i++;
    try { el.volume = toZero ? Math.max(0, 1 - i / steps) : Math.min(1, i / steps); } catch {}
    if (i >= steps) clearInterval(id);
  }, 50);
}
function toggleMute() {
  scMuted = !scMuted;
  try {
    const ctx = scEnsure();
    SC.master.gain.cancelScheduledValues(ctx.currentTime);
    SC.master.gain.setTargetAtTime(scMuted ? 0 : 0.9, ctx.currentTime, 0.1);
  } catch {}
  ['#plAudio', '#plVideo'].forEach(sel => {
    const el = $(sel);
    if (el && !el.paused) fadeMediaEl(el, scMuted);
  });
  try { if (ytPlayer) { scMuted ? ytPlayer.mute() : ytPlayer.unMute(); } } catch {}
  toast(scMuted ? 'Sound muted.' : 'Sound on.');
}
/* webkit track fill: paint the filled portion via --fill (min/max aware) */
function paintRangeFill(el) {
  const min = parseFloat(el.min) || 0;
  const max = parseFloat(el.max);
  const v = parseFloat(el.value) || 0;
  const pct = (isFinite(max) && max > min) ? Math.min(100, Math.max(0, (v - min) / (max - min) * 100)) : 0;
  el.style.setProperty('--fill', pct.toFixed(1) + '%');
}
function applySoundscapeLevels() {
  const binds = [['#slPink', 'pink'], ['#slBrown', 'brown'], ['#slWhite', 'white'], ['#slGamma', 'gamma']];
  binds.forEach(([sel, kind]) => {
    $(sel).value = S.soundscape[kind] || 0;
    paintRangeFill($(sel));
    const level = (S.soundscape[kind] || 0) / 100;
    try {
      if (level > 0) scEnsure();
      if (SC.nodes[kind]) SC.nodes[kind].gain.setTargetAtTime(level * 0.5, SC.ctx.currentTime, 0.4);
    } catch {}
  });
}
function initSoundscape() {
  applySoundscapeLevels();
  const binds = [['#slPink', 'pink'], ['#slBrown', 'brown'], ['#slWhite', 'white'], ['#slGamma', 'gamma']];
  binds.forEach(([sel, kind]) => {
    $(sel).addEventListener('input', (e) => { paintRangeFill(e.target); scSet(kind, e.target.value / 100); });
  });
}

/* ---------------- playlist: titles only, hidden engines ---------------- */
const YT_RE = /(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/;
/* playlist links: youtube.com/playlist?list=…, watch?v=…&list=…, music.youtube.com/… */
const YT_LIST_RE = /[?&]list=([\w-]{2,})/;

function parseMedia(url) {
  // a bare playlist link (no v=) means "import the whole list";
  // a watch link that merely carries list= is just the single video
  const m = url.match(YT_RE);
  if (m) return { type: 'youtube', id: m[1] };
  const lm = url.match(YT_LIST_RE);
  if (lm) return { type: 'ytplaylist', id: lm[1] };
  if (/\.(mp3|wav|ogg|opus|m4a)(\?|#|$)/i.test(url)) return { type: 'audio' };
  if (/\.(mp4|webm)(\?|#|$)/i.test(url)) return { type: 'video' };
  return { type: 'unknown' };
}

async function fetchYtTitle(ytId) {
  try {
    const r = await fetch(`https://noembed.com/embed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + ytId)}`);
    const j = await r.json();
    if (j && j.title) return j.title;
  } catch { /* offline or blocked */ }
  return 'YouTube video';
}

async function fetchYtPlaylistTitle(listId) {
  try {
    const r = await fetch(`https://noembed.com/embed?url=${encodeURIComponent('https://www.youtube.com/playlist?list=' + listId)}`);
    const j = await r.json();
    if (j && j.title) return j.title;
  } catch { /* offline or blocked */ }
  return 'YouTube Playlist';
}

/* Read a playlist's video IDs through a throwaway hidden IFrame player:
   cuePlaylist() loads the list natively, then getPlaylist() reveals the
   IDs — no API key, no extra service. Resolves [] on any failure. */
let ytImportPlayer = null;
function ytImportIds(listId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ids) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { if (ytImportPlayer) ytImportPlayer.destroy(); } catch {}
      ytImportPlayer = null;
      resolve(Array.isArray(ids) ? ids : []);
    };
    const timer = setTimeout(() => finish([]), timeoutMs);
    try {
      loadYtApi(() => {
        if (done) return;
        try {
          ytImportPlayer = new YT.Player('ytImportPlayer', {
            width: '1', height: '1',
            playerVars: { autoplay: 0, rel: 0, playsinline: 1 },
            events: {
              onReady: (e) => {
                try { e.target.cuePlaylist({ listType: 'playlist', list: listId }); }
                catch { finish([]); }
              },
              onStateChange: (e) => {
                if (e.data === YT.PlayerState.CUED) {
                  let ids = [];
                  try { ids = e.target.getPlaylist() || []; } catch {}
                  finish(ids);
                }
              },
              onError: () => finish([]),
            },
          });
        } catch { finish([]); }
      });
    } catch { finish([]); }
  });
}

/* Expand a pasted YouTube / YouTube Music playlist into individual tracks.
   IDs come from the hidden player; titles fill in behind via noembed. */
async function importYtPlaylist(listId) {
  toast('Importing playlist…');
  const [plTitle, ids] = await Promise.all([fetchYtPlaylistTitle(listId), ytImportIds(listId)]);
  if (!ids.length) {
    toast('Could not read that playlist. Is it public?');
    return false;
  }
  const base = S.playlist.length;
  const fresh = ids.map((vid, i) => ({
    id: Date.now().toString(36) + '-' + i,
    title: `Track ${base + i + 1}`,
    url: `https://www.youtube.com/watch?v=${vid}`,
    type: 'youtube', ytId: vid, listId: null,
  }));
  S.playlist.push(...fresh);
  save(); renderPlaylist();
  toast(`Imported ${fresh.length} tracks from “${plTitle.slice(0, 32)}”.`);
  // fill real titles in the background, a few at a time
  for (let i = 0; i < fresh.length; i += 6) {
    await Promise.all(fresh.slice(i, i + 6).map(async (t) => {
      const name = await fetchYtTitle(t.ytId);
      if (name && name !== 'YouTube video') t.title = name;
    }));
    save(); renderPlaylist();
  }
  return true;
}

async function addTrack(url) {
  url = (url || '').trim();
  const media = parseMedia(url);
  if (media.type === 'unknown') {
    toast('Link not recognized. Use a YouTube link or a direct audio/video file.');
    return false;
  }
  // a pasted playlist expands into its individual videos
  if (media.type === 'ytplaylist') return importYtPlaylist(media.id);
  let title = `Track ${S.playlist.length + 1}`;
  if (media.type === 'youtube') {
    toast('Fetching title…');
    title = await fetchYtTitle(media.id);
  } else {
    try {
      const u = new URL(url);
      const base = u.pathname.split('/').pop().split('.')[0];
      if (base) title = decodeURIComponent(base).replace(/[-_]+/g, ' ').slice(0, 60) || title;
    } catch { /* keep default */ }
  }
  S.playlist.push({
    id: Date.now().toString(36), title, url, type: media.type,
    ytId: media.type === 'youtube' ? media.id : null,
    listId: media.type === 'ytplaylist' ? media.id : null,
  });
  save(); renderPlaylist();
  toast(`Added: ${title.slice(0, 40)}`);
  return true;
}

function removeTrack(id) {
  const idx = S.playlist.findIndex(t => t.id === id);
  if (idx < 0) return;
  const wasCurrent = idx === S.currentTrack;
  S.playlist.splice(idx, 1);
  if (wasCurrent) { stopPlayback(); S.currentTrack = -1; }
  else if (idx < S.currentTrack) S.currentTrack--;
  save(); renderPlaylist();
}

/* --- hidden engines --- */
let ytApiReady = false, ytPlayer = null, ytReadyTrack = null, ytPlaying = false, ytApiLoading = false;
function loadYtApi(cb) {
  if (ytApiReady) { cb(); return; }
  window.__ytApiCb = () => { ytApiReady = true; cb(); };
  if (ytApiLoading) return;
  ytApiLoading = true;
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  tag.onerror = () => { toast('Failed to load the YouTube API.'); };
  document.head.appendChild(tag);
}
window.onYouTubeIframeAPIReady = () => { if (window.__ytApiCb) window.__ytApiCb(); };

/* a 'ytplaylist' track loads the whole YouTube / YouTube Music playlist into
   the hidden player natively (auto-advance inside the playlist is YouTube's).
   ytListMode marks that the current track is a playlist, so prev/next step
   between its videos instead of jumping to another track entry. */
let ytListMode = false;
function ytEnsurePlayer(track) {
  ytReadyTrack = track;
  if (track.type === 'ytplaylist') {
    if (ytPlayer) { ytListMode = true; ytPlayer.loadPlaylist({ listType: 'playlist', list: track.listId }); return; }
    ytPlayer = createYtPlayer();
    return;
  }
  if (ytPlayer) { ytListMode = false; ytPlayer.loadVideoById(track.ytId); return; }
  ytPlayer = createYtPlayer();
}
function createYtPlayer() {
  return new YT.Player('ytPlayer', {
    width: '1', height: '1',
    playerVars: { autoplay: 1, rel: 0, playsinline: 1 },
    events: {
      onReady: (e) => {
        const t = ytReadyTrack;
        if (!t) return;
        if (t.type === 'ytplaylist') { ytListMode = true; e.target.loadPlaylist({ listType: 'playlist', list: t.listId }); }
        else { ytListMode = false; e.target.loadVideoById(t.ytId); }
      },
      onStateChange: (e) => {
        if (e.data === YT.PlayerState.PLAYING) { ytPlaying = true; $('#plPlayPause').textContent = '⏸'; }
        else if (e.data === YT.PlayerState.PAUSED) { ytPlaying = false; $('#plPlayPause').textContent = '▶'; }
        else if (e.data === YT.PlayerState.ENDED) { stepTrack(1); }
      },
      onError: () => {
        toast('Video cannot be played (embedding disabled by its owner).');
        stepTrack(1);
      },
    },
  });
}

function stopPlayback() {
  const v = $('#plVideo'), a = $('#plAudio');
  v.pause(); v.removeAttribute('src'); v.load();
  a.pause(); a.removeAttribute('src'); a.load();
  if (ytPlayer && ytPlaying) { try { ytPlayer.pauseVideo(); } catch {} }
  ytPlaying = false;
  $('#plPlayPause').textContent = '▶';
  $('#plNow').textContent = '—';
  if ('mediaSession' in navigator) { try { navigator.mediaSession.metadata = null; } catch {} }
}

function playTrack(i) {
  if (i < 0 || i >= S.playlist.length) return;
  const t = S.playlist[i];
  S.currentTrack = i; save();
  const v = $('#plVideo'), a = $('#plAudio');
  v.pause(); v.removeAttribute('src');
  a.pause(); a.removeAttribute('src');

  if (t.type === 'youtube' || t.type === 'ytplaylist') {
    loadYtApi(() => ytEnsurePlayer(t));
  } else if (t.type === 'audio') {
    a.src = t.url;
    a.play().then(() => setMediaSession(t, a)).catch(() => toast('Audio failed to play.'));
  } else {
    v.src = t.url;
    v.play().then(() => setMediaSession(t, v)).catch(() => toast('Video failed to play.'));
  }
  $('#plNow').textContent = t.title;
  $('#plPlayPause').textContent = '⏸';
  renderPlaylist();
}

function setMediaSession(t, el) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: 'Llora' });
    navigator.mediaSession.setActionHandler('play', () => el.play().catch(() => {}));
    navigator.mediaSession.setActionHandler('pause', () => el.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => stepTrack(-1));
    navigator.mediaSession.setActionHandler('nexttrack', () => stepTrack(1));
  } catch {}
}

function togglePlayPause() {
  if (S.currentTrack < 0) { if (S.playlist.length) playTrack(0); return; }
  const t = S.playlist[S.currentTrack];
  if (t.type === 'youtube' || t.type === 'ytplaylist') {
    if (!ytPlayer) { playTrack(S.currentTrack); return; }
    try { ytPlaying ? ytPlayer.pauseVideo() : ytPlayer.playVideo(); } catch {}
    return;
  }
  const el = t.type === 'audio' ? $('#plAudio') : $('#plVideo');
  if (el.paused) { el.play().catch(() => {}); $('#plPlayPause').textContent = '⏸'; }
  else { el.pause(); $('#plPlayPause').textContent = '▶'; }
}

function stepTrack(dir) {
  if (!S.playlist.length) return;
  playTrack((S.currentTrack + dir + S.playlist.length) % S.playlist.length);
}
/* prev/next: inside an imported YouTube playlist, step between its videos;
   otherwise step between track entries */
function plStep(dir) {
  const t = S.playlist[S.currentTrack];
  if (t && t.type === 'ytplaylist' && ytPlayer && ytListMode) {
    try { dir > 0 ? ytPlayer.nextVideo() : ytPlayer.previousVideo(); } catch {}
    return;
  }
  stepTrack(dir);
}

function renderPlaylist() {
  const ul = $('#plList');
  ul.innerHTML = '';
  if (!S.playlist.length) ul.innerHTML = '<li class="pl-empty-list">Playlist is empty.</li>';
  S.playlist.forEach((t, i) => {
    const li = document.createElement('li');
    if (i === S.currentTrack) li.className = 'playing';
    const span = document.createElement('span');
    span.className = 't'; span.textContent = t.title; span.title = t.title;
    const rm = document.createElement('button');
    rm.className = 'rm'; rm.textContent = '✕'; rm.setAttribute('aria-label', `Remove ${t.title}`);
    rm.addEventListener('click', (e) => { e.stopPropagation(); removeTrack(t.id); });
    li.append(span, rm);
    li.addEventListener('click', () => playTrack(i));
    ul.appendChild(li);
  });
  const hasTrack = S.currentTrack >= 0 && S.playlist[S.currentTrack];
  $('#plNow').textContent = hasTrack ? S.playlist[S.currentTrack].title : '—';
}

function initPlaylist() {
  $('#plAdd').addEventListener('click', async () => {
    const url = $('#plUrl').value.trim();
    if (!url) { toast('Paste a link first.'); return; }
    $('#plAdd').disabled = true;
    try { if (await addTrack(url)) $('#plUrl').value = ''; }
    finally { $('#plAdd').disabled = false; }
  });
  $('#plUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#plAdd').click(); });
  $('#plPlayPause').addEventListener('click', togglePlayPause);
  $('#plNext').addEventListener('click', () => plStep(1));
  $('#plPrev').addEventListener('click', () => plStep(-1));
  $('#plVideo').addEventListener('ended', () => stepTrack(1));
  $('#plAudio').addEventListener('ended', () => stepTrack(1));
  const togglePl = (open) => {
    const panel = $('#playlistPanel');
    const willOpen = open !== undefined ? open : panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !willOpen);
    $('#plFab').setAttribute('aria-expanded', String(willOpen));
  };
  $('#plFab').addEventListener('click', () => togglePl());
  $('#plClose').addEventListener('click', () => togglePl(false));
  renderPlaylist();
}

/* ---------------- settings ---------------- */
let settingsToggle = null; // set by initSettings; used by the global shortcut handler
const stepperPaints = [];  // repaint fns, so vibe previews refresh the steppers too
function initSettings() {
  const panel = $('#settingsPanel'), btn = $('#menuBtn');
  const toggle = (open) => {
    const willOpen = open !== undefined ? open : panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !willOpen);
    btn.setAttribute('aria-expanded', String(willOpen));
  };
  settingsToggle = toggle;
  btn.addEventListener('click', () => toggle());
  // no inner close button: the hamburger outside morphs into ✕

  renderBgSelect();
  applyDimBg();
  const slDim = $('#slDimBg');
  if (slDim) {
    slDim.value = S.dimBg || 0; paintRangeFill(slDim);
    slDim.addEventListener('input', () => { S.dimBg = +slDim.value; paintRangeFill(slDim); applyDimBg(); save(); });
  }
  applyClockSize();
  const slSize = $('#slClockSize');
  if (slSize) {
    slSize.value = S.clockSize || 100; paintRangeFill(slSize);
    slSize.addEventListener('input', () => { S.clockSize = +slSize.value; paintRangeFill(slSize); applyClockSize(); save(); });
  }
  initAccordion();
  if (S.bgCustom) $('#customBgUrl').value = S.bgCustom;
  $('#applyBgUrl').addEventListener('click', () => {
    const url = $('#customBgUrl').value.trim();
    if (!url) { toast('Paste the video URL first.'); return; }
    S.bgCustom = url; S.bgId = 'custom'; save();
    applyBackground();
    renderBgSelect();
    toast('Custom background applied.');
  });
  const bgSnd = $('#chkBgSound');
  bgSnd.checked = !!S.bgSound;
  bgSnd.addEventListener('change', () => {
    S.bgSound = bgSnd.checked; save();
    applyBgSound();
    // enabling sound inside the click gesture lets the browser unmute playback
    if (S.bgSound && bgFront && !bgFront.paused) bgFront.play().catch(() => {});
    toast(S.bgSound ? 'Background sound on.' : 'Background sound off.');
  });

  renderClockSelect();
  const scA = $('#slScrimA'), scS = $('#slScrimS');
  scA.value = S.scrim.a; scS.value = S.scrim.spread;
  paintRangeFill(scA); paintRangeFill(scS);
  scA.addEventListener('input', () => { S.scrim.a = +scA.value; paintRangeFill(scA); applyScrim(); save(); });
  scS.addEventListener('input', () => { S.scrim.spread = +scS.value; paintRangeFill(scS); applyScrim(); save(); });
  $('#resetClockPos').addEventListener('click', resetClockPos);
  $('#vibeBtn').addEventListener('click', shareVibe);

  // duration steppers: round − / + buttons, no native spinners
  $$('.stepper').forEach(wrap => {
    const key = wrap.dataset.key;               // focus | short | long | cycle
    const step = parseFloat(wrap.dataset.step);
    const min = parseFloat(wrap.dataset.min);
    const max = parseFloat(wrap.dataset.max);
    const valEl = wrap.querySelector('.step-val');
    const get = () => key === 'cycle' ? S.cycle : S.durations[key];
    const paint = () => { valEl.textContent = String(Math.round(get() * 10) / 10); };
    const set = (v) => {
      v = Math.round(v / step) * step;
      v = Math.round(v * 10) / 10;
      v = Math.min(max, Math.max(min, v)); // clamp AFTER rounding, so min survives
      if (key === 'cycle') S.cycle = Math.round(v); else S.durations[key] = v;
      save();
      if (!T.running) T.remaining = durSec(T.mode);
      paint(); render();
    };
    wrap.querySelectorAll('.step-btn').forEach(b =>
      b.addEventListener('click', () => set(get() + parseFloat(b.dataset.dir) * step)));
    stepperPaints.push(paint);
    paint();
  });

  const bindCheck = (sel, key) => {
    const el = $(sel);
    el.checked = !!S[key];
    el.addEventListener('change', () => { S[key] = el.checked; save(); });
  };
  bindCheck('#chkAuto', 'autoContinue');
  bindCheck('#chkBreathe', 'breathe');
  bindCheck('#chkHening', 'hening');
  const snd = $('#chkSound'); snd.checked = S.sound;
  snd.addEventListener('change', () => { S.sound = snd.checked; save(); });
  const nt = $('#chkNotif'); nt.checked = S.notif && 'Notification' in window && Notification.permission === 'granted';
  nt.addEventListener('change', async () => {
    if (!('Notification' in window)) { toast('This browser does not support notifications.'); nt.checked = false; return; }
    if (nt.checked) {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast('Notification permission denied.'); nt.checked = false; S.notif = false; }
      else { S.notif = true; toast('Notifications enabled.'); }
    } else S.notif = false;
    save();
  });

  $('#clearData').addEventListener('click', () => {
    if (confirm('Erase all saved Llora data?')) {
      localStorage.removeItem(STORE_KEY);
      LEGACY_KEYS.forEach(k => localStorage.removeItem(k));
      location.reload();
    }
  });
}

/* ---------------- Bagikan Vibe: URL hash workspace recipes ---------------- */
function safeHttpsUrl(u) {
  try {
    const x = new URL(String(u).trim());
    return x.protocol === 'https:' ? x.href : '';
  } catch { return ''; }
}

function collectVibe() {
  const t = S.playlist[S.currentTrack];
  return {
    v: S.bgCustom ? 'custom' : S.bgId,
    vu: S.bgCustom || undefined,
    c: S.clockStyle,
    x: S.clockPos ? +S.clockPos.fx.toFixed(4) : undefined,
    y: S.clockPos ? +S.clockPos.fy.toFixed(4) : undefined,
    p: S.soundscape.pink, b: S.soundscape.brown, w: S.soundscape.white, g: S.soundscape.gamma,
    sa: S.scrim.a, sb: S.scrim.spread,
    db: S.dimBg, cs: S.clockSize,
    f: S.durations.focus, s: S.durations.short, l: S.durations.long, cy: S.cycle,
    tu: (t && safeHttpsUrl(t.url)) || undefined,
  };
}

function encodeVibe(v) {
  const clean = {};
  for (const [k, val] of Object.entries(v)) if (val !== undefined) clean[k] = val;
  return btoa(unescape(encodeURIComponent(JSON.stringify(clean))));
}

function decodeVibe(hash) {
  try {
    const v = JSON.parse(decodeURIComponent(escape(atob(hash))));
    if (!v || typeof v !== 'object') return null;
    const out = {};
    if (v.v === 'custom' || BG_IDS.includes(v.v)) out.v = v.v;
    if (v.vu) { const u = safeHttpsUrl(v.vu); if (u) out.vu = u; }
    if (CLOCK_IDS.includes(v.c)) out.c = v.c;
    for (const k of ['x', 'y']) if (isFinite(+v[k]) && +v[k] >= 0 && +v[k] <= 1) out[k] = +v[k];
    for (const k of ['p', 'b', 'w', 'g']) if (isFinite(+v[k])) out[k] = Math.min(100, Math.max(0, Math.round(+v[k])));
    if (isFinite(+v.sa)) out.sa = Math.min(80, Math.max(0, Math.round(+v.sa)));
    if (isFinite(+v.sb)) out.sb = Math.min(160, Math.max(0, Math.round(+v.sb)));
    if (isFinite(+v.db)) out.db = Math.min(70, Math.max(0, Math.round(+v.db)));
    if (isFinite(+v.cs)) out.cs = Math.min(140, Math.max(70, Math.round(+v.cs)));
    for (const [k, lo, hi] of [['f', 0.1, 999], ['s', 0.1, 999], ['l', 0.1, 999]])
      if (isFinite(+v[k])) out[k] = Math.min(hi, Math.max(lo, +v[k]));
    if (isFinite(+v.cy)) out.cy = Math.min(12, Math.max(1, Math.round(+v.cy)));
    if (v.tu) { const u = safeHttpsUrl(v.tu); if (u) out.tu = u; }
    return out;
  } catch { return null; }
}

function shareVibe() {
  const link = `${location.origin}${location.pathname}#vibe=${encodeVibe(collectVibe())}`;
  const done = () => toast('Vibe link copied — ready to share.');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link).then(done).catch(() => fallbackCopy(link, done));
  } else fallbackCopy(link, done);
}
function fallbackCopy(text, done) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove(); done();
  } catch { toast('Failed to copy.'); }
}

/* apply a vibe as a session-only override: S changes in memory, but save()
   is blocked while vibePreview is set, so a shared link never overwrites
   the visitor's own localStorage */
function applyVibeSession(v) {
  vibePreview = v;
  if (v.v === 'custom' && v.vu) { S.bgCustom = v.vu; S.bgId = 'custom'; $('#customBgUrl').value = v.vu; }
  else if (v.v) { S.bgId = v.v; S.bgCustom = ''; $('#customBgUrl').value = ''; }
  if (v.c) setClockStyle(v.c);
  if (v.x !== undefined && v.y !== undefined) { S.clockPos = { fx: v.x, fy: v.y }; applyClockPos(); }
  if (v.p !== undefined || v.b !== undefined || v.w !== undefined || v.g !== undefined) {
    if (v.p !== undefined) S.soundscape.pink = v.p;
    if (v.b !== undefined) S.soundscape.brown = v.b;
    if (v.w !== undefined) S.soundscape.white = v.w;
    if (v.g !== undefined) S.soundscape.gamma = v.g;
    applySoundscapeLevels();
  }
  if (v.db !== undefined) {
    S.dimBg = v.db; applyDimBg();
    const el = $('#slDimBg'); if (el) { el.value = S.dimBg; paintRangeFill(el); }
  }
  if (v.cs !== undefined) {
    S.clockSize = v.cs; applyClockSize();
    const el = $('#slClockSize'); if (el) { el.value = S.clockSize; paintRangeFill(el); }
  }
  if (v.f !== undefined) S.durations.focus = v.f;
  if (v.s !== undefined) S.durations.short = v.s;
  if (v.l !== undefined) S.durations.long = v.l;
  if (v.cy !== undefined) S.cycle = v.cy;
  if (!T.running) T.remaining = durSec(T.mode);
  applyBackground();
  renderBgSelect();
  stepperPaints.forEach(fn => fn());
  if (v.sa !== undefined || v.sb !== undefined) {
    if (v.sa !== undefined) S.scrim.a = v.sa;
    if (v.sb !== undefined) S.scrim.spread = v.sb;
    applyScrim();
    const scA = $('#slScrimA'), scS = $('#slScrimS');
    if (scA) { scA.value = S.scrim.a; paintRangeFill(scA); }
    if (scS) { scS.value = S.scrim.spread; paintRangeFill(scS); }
  }
  render();
  if (v.tu) addTrack(v.tu); // additive; save() is blocked so it stays session-only
  $('#vibeCapsule').classList.remove('hidden');
}

function keepVibe() {
  vibeSaving = true;
  save();
  vibeSaving = false;
  vibePreview = null;
  $('#vibeCapsule').classList.add('hidden');
  history.replaceState(null, '', location.pathname + location.search);
  toast('Vibe saved as yours.');
}
function dropVibe() {
  history.replaceState(null, '', location.pathname + location.search);
  location.reload();
}
function initVibeFromHash() {
  if (!location.hash.startsWith('#vibe=')) return;
  const v = decodeVibe(location.hash.slice(6));
  if (!v) { toast('Invalid Vibe link.'); return; }
  applyVibeSession(v);
}

/* ---------------- boot ---------------- */
let hintShown = true;
function init() {
  setClockStyle(S.clockStyle);

  bgFront = $('#bgA'); bgBack = $('#bgB'); bgYtEl = $('#bgYt');
  wireVideoCommon(bgFront); wireVideoCommon(bgBack);
  // first paint: video preset/custom mp4, or YouTube background engine
  const firstYt = bgCustomYtId();
  if (firstYt) {
    showYouTubeBg(firstYt);
  } else {
    setBgPhoto(presetPoster()); // instant photo while the video loads
    setVideoSource(bgFront, bgUrl());
    const onFirst = () => {
      bgFront.removeEventListener('canplaythrough', onFirst);
      clearTimeout(bgFailTimer);
      bgFront.play().then(() => { bgFront.classList.add('on'); startTintSampler(); }).catch(() => {});
    };
    bgFront.addEventListener('canplaythrough', onFirst);
    bgFailTimer = setTimeout(() => {
      if (!bgFront.classList.contains('on') && !bgErrorToasted) {
        bgErrorToasted = true;
        toast('Background failed to load — try another preset.');
      }
    }, 12000);
  }
  applyBgSound();
  applyScrim();
  renderBgSelect();
  renderClockSelect();

  $('#btnStartPause').addEventListener('click', () => (T.running ? pause() : start()));
  $('#btnReset').addEventListener('click', resetSession);
  $('#btnSkip').addEventListener('click', skipSession);
  $('#overtimeBtn').addEventListener('click', endOvertime);
  $('#vibeKeep').addEventListener('click', keepVibe);
  $('#vibeDrop').addEventListener('click', dropVibe);
  document.querySelectorAll('.mt-opt').forEach(b =>
    b.addEventListener('click', () => setClockMode(b.dataset.mt === 'clock')));
  applyClockMode();

  initDrag();
  initSettings();
  initPlaylist();
  initSoundscape();
  initOneThing();
  initHening();
  initVisibilitySaver();
  initShortcuts();
  initVibeFromHash();

  if (!S.clockPos) setTimeout(() => toast('Hold & drag the clock anywhere', 4000), 1200);
  else hintShown = false;

  T.remaining = durSec(T.mode);
  render();
}

document.addEventListener('DOMContentLoaded', init);
