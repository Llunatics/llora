/* ============================================================
   Pomodoro — focus timer, liquid glass edition v3
   Vanilla JS, no frameworks. State persisted in localStorage.
   - Date.now()-delta timer (no drift), 250ms tick
   - Double-buffered video backgrounds + adaptive glass tint
   - Mode Hening, Satu Hal, breathing transition
   - Procedural WebAudio soundscape mixer
   - Playlist: titles only, hidden YT / native engines
   ============================================================ */
'use strict';

const STORE_KEY = 'pomodoro:v3';
const LEGACY_KEYS = ['pomodoro:v2', 'pomodoro:v1'];
const BREATHE_SEC = 15;

const BG_PRESETS = [
  { id: 'rain-glass',  name: 'Hujan di Kaca',  url: 'https://cdn.jsdelivr.net/gh/Llunatics/pomodoro-timer@assets/videos/rain-glass.mp4' },
  { id: 'forest-mist', name: 'Hutan Hijau',    url: 'https://cdn.jsdelivr.net/gh/Llunatics/pomodoro-timer@assets/videos/forest-mist.mp4' },
  { id: 'city-night',  name: 'Kota Senja',     url: 'https://cdn.jsdelivr.net/gh/Llunatics/pomodoro-timer@assets/videos/city-night.mp4' },
  { id: 'cozy-rain',   name: 'Senja Hujan',    url: 'https://cdn.jsdelivr.net/gh/Llunatics/pomodoro-timer@assets/videos/cozy-rain.mp4' },
];

const MODE_LABEL = { focus: 'Fokus', short: 'Istirahat', long: 'Istirahat Panjang', breathe: 'Tarik Napas' };
const STYLE_MIGRATE = { big: 'lock', min: 'mono', analog: 'lock' };
const DEFAULT_STATE = {
  durations: { focus: 25, short: 5, long: 15 },
  cycle: 4,
  autoContinue: true,
  breathe: true,
  hening: true,
  sound: true,
  notif: false,
  clockStyle: 'lock',
  clockPos: null,          // {fx, fy} viewport fractions of clock center
  bgId: 'rain-glass',
  bgCustom: '',
  playlist: [],            // [{id, title, url, type, ytId}]
  currentTrack: -1,
  soundscape: { pink: 0, brown: 0, gamma: 0 },
  oneThing: { text: '', date: '' },
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
        oneThing: Object.assign({}, DEFAULT_STATE.oneThing, p.oneThing || {}),
      });
    }
  } catch { return fresh(); }
  // migrate old clock styles / positions
  if (STYLE_MIGRATE[merged.clockStyle]) merged.clockStyle = STYLE_MIGRATE[merged.clockStyle];
  if (merged.clockPos && merged.clockPos.fx === undefined) merged.clockPos = null; // px -> recenter
  if (!['lock', 'serif', 'mono'].includes(merged.clockStyle)) merged.clockStyle = 'lock';
  // one-thing is per-day
  const today = new Date().toISOString().slice(0, 10);
  if (merged.oneThing.date !== today) merged.oneThing = { text: '', date: today };
  return merged;
}
const S = loadState();
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch {} }

/* ---------------- helpers ---------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const mmss = (sec) => {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}<span class="colon">:</span>${s}`;
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
  if (T.remaining <= 0) T.remaining = durSec(T.mode);
  T.endAt = Date.now() + T.remaining * 1000;
  T.running = true;
  clearInterval(T.timerId);
  T.timerId = setInterval(tick, 250);
  render();
}

function pause() {
  if (!T.running) return;
  T.remaining = Math.max(0, Math.ceil((T.endAt - Date.now()) / 1000));
  T.running = false;
  clearInterval(T.timerId);
  render();
}

function resetSession() {
  pause();
  $('#clockInner').classList.remove('breathing');
  T.remaining = durSec(T.mode);
  render();
}

function tick() {
  T.remaining = Math.max(0, Math.ceil((T.endAt - Date.now()) / 1000));
  if (T.remaining <= 0) completeSession();
  else render();
}

function completeSession() {
  clearInterval(T.timerId);
  T.running = false;
  const finished = T.mode;

  if (finished === 'focus') {
    T.completedFocus++;
    dissolveOneThing();
    chime(false);
    notifyUser('focus');
    if (S.breathe) {
      T.mode = 'breathe';
      T.remaining = BREATHE_SEC;
      $('#clockInner').classList.remove('breathing');
      void $('#clockInner').offsetWidth; // restart animation
      $('#clockInner').classList.add('breathing');
      toast('Tarik napas dulu…');
      render();
      start();
      return;
    }
    T.mode = modeAfterFocus();
    T.remaining = durSec(T.mode);
    toast(`Fokus selesai. Saatnya ${MODE_LABEL[T.mode].toLowerCase()}.`);
  } else if (finished === 'breathe') {
    $('#clockInner').classList.remove('breathing');
    T.mode = modeAfterFocus();
    T.remaining = durSec(T.mode);
    toast(`Saatnya ${MODE_LABEL[T.mode].toLowerCase()}.`);
  } else {
    chime(false);
    notifyUser('break');
    T.mode = 'focus';
    T.remaining = durSec('focus');
    toast('Istirahat selesai. Balik fokus lagi.');
  }

  render();
  if (S.autoContinue) start();
}

function skipSession() {
  const skipped = T.mode;
  if (T.running) { clearInterval(T.timerId); T.running = false; }
  $('#clockInner').classList.remove('breathing');
  if (skipped === 'focus') { T.completedFocus++; dissolveOneThing(); }
  T.mode = (skipped === 'focus' || skipped === 'breathe') ? modeAfterFocus() : 'focus';
  T.remaining = durSec(T.mode);
  render();
  toast(`Sesi ${MODE_LABEL[skipped].toLowerCase()} dilewati.`);
}

/* ---------------- rendering ---------------- */
function progress() {
  const total = durSec(T.mode);
  return total > 0 ? 1 - T.remaining / total : 0;
}

function render() {
  const p = progress();
  const label = MODE_LABEL[T.mode];
  const cycleNum = (T.completedFocus % S.cycle) + 1;

  $$('[data-time]').forEach(el => { el.innerHTML = mmss(T.remaining); });
  $$('[data-mode-label]').forEach(el => { el.textContent = label; });
  $$('[data-cycle]').forEach(el => { el.textContent = `Sesi ${cycleNum}/${S.cycle}`; });
  $$('[data-next]').forEach(el => {
    el.textContent = 'berikutnya: ' + (T.mode === 'focus' || T.mode === 'breathe'
      ? MODE_LABEL[modeAfterFocus()].toLowerCase() : 'fokus');
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

  document.title = (playing || T.remaining < durSec(T.mode))
    ? `${mmssPlain(T.remaining)} · Pomodoro`
    : 'Pomodoro — Focus Timer';
}

/* ---------------- sound + notification ---------------- */
let audioCtx = null;
function ac() {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}
function chime(soft = false) {
  if (!S.sound) return;
  try {
    const ctx = ac();
    const notes = soft ? [660, 880] : [880, 659.25, 880];
    const vol = soft ? 0.12 : 0.25;
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + i * 0.22;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0); osc.stop(t0 + 0.25);
    });
  } catch { /* audio unavailable */ }
}

function notifyUser(kind) {
  if (!S.notif || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    new Notification('Pomodoro', {
      body: kind === 'focus' ? 'Sesi fokus selesai. Waktunya istirahat.' : 'Istirahat selesai. Balik fokus lagi.',
    });
  } catch {}
}

/* ---------------- draggable clock (viewport fractions) ---------------- */
function initDrag() {
  const card = $('#clockCard');
  let dragging = false, startX = 0, startY = 0, baseX = 0, baseY = 0;

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

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    card.classList.remove('dragging');
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
  toast('Posisi jam dikembalikan ke tengah.');
}

function setClockStyle(style) {
  S.clockStyle = style; save();
  $('#clockCard').dataset.clockStyle = style;
  $$('#stylePicker button').forEach(b => b.classList.toggle('active', b.dataset.style === style));
}

/* ---------------- background: double-buffered crossfade ---------------- */
let bgFront = null, bgBack = null, bgFailTimer = null, bgErrorToasted = false, tintTimer = null, tintOK = true;

function bgUrl() {
  return S.bgCustom || (BG_PRESETS.find(p => p.id === S.bgId) || BG_PRESETS[0]).url;
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
      toast('Background gagal dimuat, coba preset lain.');
    }
  });
}

function switchBackground() {
  const url = bgUrl();
  clearTimeout(bgFailTimer);
  bgErrorToasted = false;
  bgBack.dataset.pendingSrc = url;
  bgBack.dataset.corsRetried = '';
  bgBack.setAttribute('crossorigin', 'anonymous');
  bgBack.classList.remove('on');
  bgBack.pause();
  bgBack.removeAttribute('src');
  bgBack.src = url;
  bgBack.load();

  const onReady = () => {
    bgBack.removeEventListener('canplaythrough', onReady);
    clearTimeout(bgFailTimer);
    bgBack.play().then(() => {
      bgBack.classList.add('on');
      bgFront.classList.remove('on');
      const tmp = bgFront; bgFront = bgBack; bgBack = tmp;
      startTintSampler();
    }).catch(() => {
      // will retry on next canplay; watchdog covers total failure
    });
  };
  bgBack.addEventListener('canplaythrough', onReady);

  bgFailTimer = setTimeout(() => {
    if (!bgFront.classList.contains('on') && !bgBack.classList.contains('on') && !bgErrorToasted) {
      bgErrorToasted = true;
      toast('Background gagal dimuat, coba preset lain.');
    }
  }, 12000);
  renderPresetGrid();
}

function applyBackground() { switchBackground(); }

/* adaptive glass tint: sample video frame -> --ambient */
function startTintSampler() {
  if (tintTimer || !tintOK) return;
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
      tintOK = false; // tainted canvas (no CORS) — disable sampler silently
      clearInterval(tintTimer); tintTimer = null;
    }
  }, 2000);
}

function renderPresetGrid() {
  const grid = $('#presetGrid');
  grid.innerHTML = '';
  BG_PRESETS.forEach(p => {
    const b = document.createElement('button');
    b.className = 'glass-btn small' + (S.bgId === p.id && !S.bgCustom ? ' active' : '');
    b.textContent = p.name;
    b.addEventListener('click', () => {
      S.bgId = p.id; S.bgCustom = ''; $('#customBgUrl').value = ''; save();
      applyBackground();
      toast(`Background: ${p.name}`);
    });
    grid.appendChild(b);
  });
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
  toast('Satu hal selesai. Kerja bagus.');
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
  } else { // brown
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
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
  // pink noise
  const pinkSrc = ctx.createBufferSource();
  pinkSrc.buffer = noiseBuffer(ctx, 'pink'); pinkSrc.loop = true;
  const pinkGain = ctx.createGain(); pinkGain.gain.value = 0;
  pinkSrc.connect(pinkGain).connect(SC.master); pinkSrc.start();
  // brown noise
  const brownSrc = ctx.createBufferSource();
  brownSrc.buffer = noiseBuffer(ctx, 'brown'); brownSrc.loop = true;
  const brownGain = ctx.createGain(); brownGain.gain.value = 0;
  brownSrc.connect(brownGain).connect(SC.master); brownSrc.start();
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
  SC.nodes = { pink: pinkGain, brown: brownGain, gamma: gammaGain };
  return ctx;
}
function scSet(kind, level) { // level 0..1
  S.soundscape[kind] = Math.round(level * 100); save();
  if (level > 0) { try { scEnsure(); } catch { return; } }
  if (SC.nodes[kind]) {
    SC.nodes[kind].gain.setTargetAtTime(level * 0.5, SC.ctx.currentTime, 0.4);
  }
}
function initSoundscape() {
  const binds = [['#slPink', 'pink'], ['#slBrown', 'brown'], ['#slGamma', 'gamma']];
  binds.forEach(([sel, kind]) => {
    const el = $(sel);
    el.value = S.soundscape[kind] || 0;
    el.addEventListener('input', () => scSet(kind, el.value / 100));
  });
}

/* ---------------- playlist: titles only, hidden engines ---------------- */
const YT_RE = /(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/;

function parseMedia(url) {
  const m = url.match(YT_RE);
  if (m) return { type: 'youtube', id: m[1] };
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
  return 'Video YouTube';
}

async function addTrack(url) {
  url = (url || '').trim();
  const media = parseMedia(url);
  if (media.type === 'unknown') {
    toast('Link tidak dikenali. Pakai link YouTube atau file audio/video langsung.');
    return false;
  }
  let title = `Track ${S.playlist.length + 1}`;
  if (media.type === 'youtube') {
    toast('Mengambil judul…');
    title = await fetchYtTitle(media.id);
  } else {
    try {
      const u = new URL(url);
      const base = u.pathname.split('/').pop().split('.')[0];
      if (base) title = decodeURIComponent(base).replace(/[-_]+/g, ' ').slice(0, 60) || title;
    } catch { /* keep default */ }
  }
  S.playlist.push({ id: Date.now().toString(36), title, url, type: media.type, ytId: media.id || null });
  save(); renderPlaylist();
  toast(`Ditambahkan: ${title.slice(0, 40)}`);
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
  tag.onerror = () => { toast('Gagal memuat YouTube API.'); };
  document.head.appendChild(tag);
}
window.onYouTubeIframeAPIReady = () => { if (window.__ytApiCb) window.__ytApiCb(); };

function ytEnsurePlayer(track) {
  if (ytPlayer) { ytReadyTrack = track; ytPlayer.loadVideoById(track.ytId); return; }
  ytReadyTrack = track;
  ytPlayer = new YT.Player('ytPlayer', {
    width: '1', height: '1',
    playerVars: { autoplay: 1, rel: 0, playsinline: 1 },
    events: {
      onReady: (e) => { if (ytReadyTrack) e.target.loadVideoById(ytReadyTrack.ytId); },
      onStateChange: (e) => {
        if (e.data === YT.PlayerState.PLAYING) { ytPlaying = true; $('#plPlayPause').textContent = '⏸'; }
        else if (e.data === YT.PlayerState.PAUSED) { ytPlaying = false; $('#plPlayPause').textContent = '▶'; }
        else if (e.data === YT.PlayerState.ENDED) { stepTrack(1); }
      },
      onError: () => {
        toast('Video tidak bisa diputar (embed dibatasi pemiliknya).');
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

  if (t.type === 'youtube') {
    loadYtApi(() => ytEnsurePlayer(t));
  } else if (t.type === 'audio') {
    a.src = t.url;
    a.play().then(() => setMediaSession(t, a)).catch(() => toast('Audio gagal diputar.'));
  } else {
    v.src = t.url;
    v.play().then(() => setMediaSession(t, v)).catch(() => toast('Video gagal diputar.'));
  }
  $('#plNow').textContent = t.title;
  $('#plPlayPause').textContent = '⏸';
  renderPlaylist();
}

function setMediaSession(t, el) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: 'Pomodoro' });
    navigator.mediaSession.setActionHandler('play', () => el.play().catch(() => {}));
    navigator.mediaSession.setActionHandler('pause', () => el.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => stepTrack(-1));
    navigator.mediaSession.setActionHandler('nexttrack', () => stepTrack(1));
  } catch {}
}

function togglePlayPause() {
  if (S.currentTrack < 0) { if (S.playlist.length) playTrack(0); return; }
  const t = S.playlist[S.currentTrack];
  if (t.type === 'youtube') {
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

function renderPlaylist() {
  const ul = $('#plList');
  ul.innerHTML = '';
  if (!S.playlist.length) ul.innerHTML = '<li class="pl-empty-list">Playlist kosong.</li>';
  S.playlist.forEach((t, i) => {
    const li = document.createElement('li');
    if (i === S.currentTrack) li.className = 'playing';
    const span = document.createElement('span');
    span.className = 't'; span.textContent = t.title; span.title = t.title;
    const rm = document.createElement('button');
    rm.className = 'rm'; rm.textContent = '✕'; rm.setAttribute('aria-label', `Hapus ${t.title}`);
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
    if (!url) { toast('Tempel linknya dulu.'); return; }
    $('#plAdd').disabled = true;
    try { if (await addTrack(url)) $('#plUrl').value = ''; }
    finally { $('#plAdd').disabled = false; }
  });
  $('#plUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#plAdd').click(); });
  $('#plPlayPause').addEventListener('click', togglePlayPause);
  $('#plNext').addEventListener('click', () => stepTrack(1));
  $('#plPrev').addEventListener('click', () => stepTrack(-1));
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
function initSettings() {
  const panel = $('#settingsPanel'), btn = $('#menuBtn');
  const toggle = (open) => {
    const willOpen = open !== undefined ? open : panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !willOpen);
    btn.setAttribute('aria-expanded', String(willOpen));
  };
  btn.addEventListener('click', () => toggle());
  $('#settingsClose').addEventListener('click', () => toggle(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggle(false); });

  renderPresetGrid();
  if (S.bgCustom) $('#customBgUrl').value = S.bgCustom;
  $('#applyBgUrl').addEventListener('click', () => {
    const url = $('#customBgUrl').value.trim();
    if (!url) { toast('Tempel URL videonya dulu.'); return; }
    S.bgCustom = url; S.bgId = 'custom'; save();
    applyBackground();
    toast('Background custom diterapkan.');
  });

  $$('#stylePicker button').forEach(b =>
    b.addEventListener('click', () => setClockStyle(b.dataset.style)));
  $('#resetClockPos').addEventListener('click', resetClockPos);

  const bindDur = (id, key) => {
    const el = $(id);
    el.value = S.durations[key];
    el.addEventListener('change', () => {
      const v = parseFloat(el.value);
      if (!isFinite(v) || v < 0.1) { el.value = S.durations[key]; toast('Durasi minimal 0,1 menit.'); return; }
      S.durations[key] = Math.min(999, v); save();
      if (!T.running) T.remaining = durSec(T.mode);
      render();
    });
  };
  bindDur('#inFocus', 'focus'); bindDur('#inShort', 'short'); bindDur('#inLong', 'long');
  const cyc = $('#inCycle');
  cyc.value = S.cycle;
  cyc.addEventListener('change', () => {
    const v = parseInt(cyc.value, 10);
    if (!isFinite(v) || v < 1 || v > 12) { cyc.value = S.cycle; toast('Isi 1–12.'); return; }
    S.cycle = v; save(); render();
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
    if (!('Notification' in window)) { toast('Browser tidak mendukung notifikasi.'); nt.checked = false; return; }
    if (nt.checked) {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast('Izin notifikasi ditolak.'); nt.checked = false; S.notif = false; }
      else { S.notif = true; toast('Notifikasi diaktifkan.'); }
    } else S.notif = false;
    save();
  });

  $('#clearData').addEventListener('click', () => {
    if (confirm('Hapus semua data Pomodoro yang tersimpan?')) {
      localStorage.removeItem(STORE_KEY);
      LEGACY_KEYS.forEach(k => localStorage.removeItem(k));
      location.reload();
    }
  });
}

/* ---------------- boot ---------------- */
let hintShown = true;
function init() {
  $('#clockCard').dataset.clockStyle = S.clockStyle;
  $$('#stylePicker button').forEach(b => b.classList.toggle('active', b.dataset.style === S.clockStyle));

  bgFront = $('#bgA'); bgBack = $('#bgB');
  wireVideoCommon(bgFront); wireVideoCommon(bgBack);
  // first paint: load directly into front, fade in on canplay
  const first = bgUrl();
  bgFront.dataset.pendingSrc = first;
  bgFront.setAttribute('crossorigin', 'anonymous');
  bgFront.src = first;
  bgFront.load();
  const onFirst = () => {
    bgFront.removeEventListener('canplaythrough', onFirst);
    clearTimeout(bgFailTimer);
    bgFront.play().then(() => { bgFront.classList.add('on'); startTintSampler(); }).catch(() => {});
  };
  bgFront.addEventListener('canplaythrough', onFirst);
  bgFailTimer = setTimeout(() => {
    if (!bgFront.classList.contains('on') && !bgErrorToasted) {
      bgErrorToasted = true;
      toast('Background gagal dimuat, coba preset lain.');
    }
  }, 12000);
  renderPresetGrid();

  $('#btnStartPause').addEventListener('click', () => (T.running ? pause() : start()));
  $('#btnReset').addEventListener('click', resetSession);
  $('#btnSkip').addEventListener('click', skipSession);

  initDrag();
  initSettings();
  initPlaylist();
  initSoundscape();
  initOneThing();
  initHening();

  if (!S.clockPos) setTimeout(() => toast('Tahan & seret jam ke mana aja', 4000), 1200);
  else hintShown = false;

  T.remaining = durSec(T.mode);
  render();
}

document.addEventListener('DOMContentLoaded', init);
