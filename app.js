/* ============================================================
   Podomoro — pomodoro timer, liquid glass edition
   Vanilla JS, no frameworks. State persisted in localStorage.
   ============================================================ */
'use strict';

const STORE_KEY = 'podomoro:v1';
const RING_C = 2 * Math.PI * 88; // ≈ 552.92

const BG_PRESETS = [
  { id: 'lofi-study',  name: 'Lofi Study',  url: 'https://cdn.pixabay.com/video/2025/04/13/271841_large.mp4' },
  { id: 'forest-rain', name: 'Forest Rain', url: 'https://cdn.pixabay.com/video/2023/06/23/168447-839220680_small.mp4' },
  { id: 'rainy-room',  name: 'Rainy Room',  url: 'https://cdn.pixabay.com/video/2026/07/11/363351_large.mp4' },
  { id: 'city-night',  name: 'City Night',   url: 'https://cdn.pixabay.com/video/2024/12/12/246433_large.mp4' },
];

const MODE_LABEL = { focus: 'Fokus', short: 'Istirahat', long: 'Istirahat Panjang' };
const DEFAULT_STATE = {
  durations: { focus: 25, short: 5, long: 15 },
  cycle: 4,
  autoContinue: true,
  sound: true,
  notif: false,
  clockStyle: 'big',
  clockPos: null,          // {x, y} px from viewport top-left
  bgId: 'lofi-study',
  bgCustom: '',
  playlist: [],            // [{id, title, url, type}]
  currentTrack: -1,
};

/* ---------------- state ---------------- */
function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    return Object.assign(structuredClone(DEFAULT_STATE), parsed, {
      durations: Object.assign({}, DEFAULT_STATE.durations, parsed.durations || {}),
    });
  } catch { return structuredClone(DEFAULT_STATE); }
}
const S = loadState();
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch {} }

/* ---------------- helpers ---------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const mmss = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

let toastTimer = null;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

/* ---------------- timer engine ---------------- */
const T = {
  mode: 'focus',
  remaining: S.durations.focus * 60,
  completedFocus: 0,
  running: false,
  endAt: 0,
  timerId: null,
};

const durSec = (mode) => Math.max(6, Math.round(S.durations[mode] * 60));

function nextModeAfter(mode) {
  if (mode === 'focus') return (T.completedFocus % S.cycle === 0 && T.completedFocus > 0) ? 'long' : 'short';
  return 'focus';
}
// NOTE: completedFocus is incremented BEFORE calling nextModeAfter on focus end.

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
  T.remaining = Math.max(0, Math.round((T.endAt - Date.now()) / 1000));
  T.running = false;
  clearInterval(T.timerId);
  render();
}

function resetSession() {
  pause();
  T.remaining = durSec(T.mode);
  render();
}

function tick() {
  T.remaining = Math.max(0, Math.round((T.endAt - Date.now()) / 1000));
  if (T.remaining <= 0) completeSession();
  else render();
}

function completeSession() {
  clearInterval(T.timerId);
  T.running = false;
  const finished = T.mode;
  if (finished === 'focus') T.completedFocus++;

  chime();
  notifyUser(finished);

  T.mode = nextModeAfter(finished);
  T.remaining = durSec(T.mode);

  toast(finished === 'focus'
    ? `Fokus selesai. Saatnya ${MODE_LABEL[T.mode].toLowerCase()}.`
    : 'Istirahat selesai. Balik fokus lagi.');

  render();
  if (S.autoContinue) start();
}

function skipSession() {
  const skipped = T.mode;
  if (T.running) { clearInterval(T.timerId); T.running = false; }
  if (skipped === 'focus') T.completedFocus++;
  T.mode = nextModeAfter(skipped);
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

  $$('[data-time]').forEach(el => { el.textContent = mmss(T.remaining); });
  $$('[data-mode-label]').forEach(el => { el.textContent = label; });
  $$('[data-cycle]').forEach(el => { el.textContent = `Sesi ${cycleNum}/${S.cycle}`; });
  $$('[data-next]').forEach(el => {
    el.textContent = 'berikutnya: ' + MODE_LABEL[nextModeAfter(T.mode)].toLowerCase();
  });
  $$('[data-progress]').forEach(el => { el.style.width = `${(p * 100).toFixed(1)}%`; });

  // session dots
  $$('[data-dots]').forEach(box => {
    box.innerHTML = '';
    for (let i = 0; i < S.cycle; i++) {
      const d = document.createElement('i');
      if (i < T.completedFocus % S.cycle) d.className = 'done';
      box.appendChild(d);
    }
  });

  // analog ring + hand
  $$('[data-ring]').forEach(ring => {
    ring.style.strokeDasharray = RING_C.toFixed(1);
    ring.style.strokeDashoffset = (RING_C * (1 - p)).toFixed(1);
  });
  $$('[data-hand]').forEach(hand => {
    hand.setAttribute('transform', `rotate(${(p * 360).toFixed(1)} 100 100)`);
  });

  // start/pause icon
  const playing = T.running;
  $('[data-icon-play]').classList.toggle('hidden', playing);
  $('[data-icon-pause]').classList.toggle('hidden', !playing);

  // tab title
  document.title = (T.running || T.remaining < durSec(T.mode))
    ? `${mmss(T.remaining)} · Podomoro`
    : 'Podomoro — Focus Timer';
}

/* ---------------- sound + notification ---------------- */
let audioCtx = null;
function chime() {
  if (!S.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = [880, 659.25, 880];
    notes.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t0 = audioCtx.currentTime + i * 0.22;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0); osc.stop(t0 + 0.25);
    });
  } catch { /* audio unavailable */ }
}

function notifyUser(finishedMode) {
  if (!S.notif || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    new Notification('Podomoro', {
      body: finishedMode === 'focus'
        ? 'Sesi fokus selesai. Waktunya istirahat.'
        : 'Istirahat selesai. Balik fokus lagi.',
    });
  } catch {}
}

/* ---------------- draggable clock ---------------- */
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
    const nx = Math.min(Math.max(8, baseX + e.clientX - startX), window.innerWidth - card.offsetWidth - 8);
    const ny = Math.min(Math.max(8, baseY + e.clientY - startY), window.innerHeight - card.offsetHeight - 8);
    card.style.left = `${nx}px`;
    card.style.top = `${ny}px`;
  });

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    card.classList.remove('dragging');
    S.clockPos = { x: parseFloat(card.style.left), y: parseFloat(card.style.top) };
    save();
  };
  card.addEventListener('pointerup', endDrag);
  card.addEventListener('pointercancel', endDrag);

  // restore position
  if (S.clockPos) {
    card.classList.remove('centered');
    card.style.left = `${Math.min(S.clockPos.x, window.innerWidth - 100)}px`;
    card.style.top = `${Math.min(S.clockPos.y, window.innerHeight - 100)}px`;
    card.style.transform = 'none';
  }
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

/* ---------------- background ---------------- */
function applyBackground() {
  const video = $('#bgVideo');
  const url = S.bgCustom || (BG_PRESETS.find(p => p.id === S.bgId) || BG_PRESETS[0]).url;
  video.classList.remove('ready');
  video.src = url;
  video.load();
  const pr = video.play();
  if (pr && pr.catch) pr.catch(() => {});
  renderPresetGrid();
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

/* ---------------- playlist ---------------- */
const YT_RE = /(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/;

function parseMedia(url) {
  const m = url.match(YT_RE);
  if (m) return { type: 'youtube', id: m[1] };
  if (/\.(mp4|webm|ogg)(\?|#|$)/i.test(url)) return { type: 'mp4' };
  return { type: 'unknown' };
}

function addTrack(title, url) {
  const media = parseMedia(url.trim());
  if (media.type === 'unknown') { toast('Link tidak dikenali. Pakai link YouTube atau .mp4/.webm langsung.'); return false; }
  const cleanTitle = (title || '').trim() || `Track ${S.playlist.length + 1}`;
  S.playlist.push({ id: Date.now().toString(36), title: cleanTitle, url: url.trim(), type: media.type, ytId: media.id || null });
  save(); renderPlaylist();
  toast(`Ditambahkan: ${cleanTitle}`);
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

function stopPlayback() {
  const v = $('#plVideo');
  v.pause(); v.removeAttribute('src'); v.load(); v.classList.add('hidden');
  const yt = $('#plYT');
  yt.src = 'about:blank'; yt.classList.add('hidden');
  $('#plEmpty').classList.remove('hidden');
  $('#plPlayPause').textContent = '▶';
  $('#plNow').textContent = '—';
}

function playTrack(i) {
  if (i < 0 || i >= S.playlist.length) return;
  const t = S.playlist[i];
  S.currentTrack = i; save();
  const v = $('#plVideo'), yt = $('#plYT'), empty = $('#plEmpty');
  if (t.type === 'youtube') {
    v.pause(); v.classList.add('hidden');
    yt.src = `https://www.youtube.com/embed/${t.ytId}?autoplay=1&rel=0`;
    yt.classList.remove('hidden');
  } else {
    yt.src = 'about:blank'; yt.classList.add('hidden');
    v.src = t.url; v.classList.remove('hidden');
    v.play().catch(() => {});
  }
  empty.classList.add('hidden');
  $('#plNow').textContent = t.title;
  $('#plPlayPause').textContent = '⏸';
  renderPlaylist();
}

function togglePlayPause() {
  if (S.currentTrack < 0) { if (S.playlist.length) playTrack(0); return; }
  const t = S.playlist[S.currentTrack];
  if (t.type === 'youtube') { toast('Kontrol play/pause YouTube pakai playernya langsung.'); return; }
  const v = $('#plVideo');
  if (v.paused) { v.play().catch(() => {}); $('#plPlayPause').textContent = '⏸'; }
  else { v.pause(); $('#plPlayPause').textContent = '▶'; }
}

function stepTrack(dir) {
  if (!S.playlist.length) return;
  const next = (S.currentTrack + dir + S.playlist.length) % S.playlist.length;
  playTrack(next);
}

function renderPlaylist() {
  const ul = $('#plList');
  ul.innerHTML = '';
  if (!S.playlist.length) {
    ul.innerHTML = '<li class="pl-empty-list">Playlist kosong.</li>';
  }
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
  $('#plAdd').addEventListener('click', () => {
    const url = $('#plUrl').value.trim();
    if (!url) { toast('Tempel link videonya dulu.'); return; }
    if (addTrack($('#plTitle').value, url)) { $('#plTitle').value = ''; $('#plUrl').value = ''; }
  });
  $('#plUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#plAdd').click(); });
  $('#plPlayPause').addEventListener('click', togglePlayPause);
  $('#plNext').addEventListener('click', () => stepTrack(1));
  $('#plPrev').addEventListener('click', () => stepTrack(-1));
  $('#plVideo').addEventListener('ended', () => stepTrack(1)); // auto-advance
  $('#plToggle').addEventListener('click', () => {
    const p = $('#playlistPanel');
    const collapsed = p.classList.toggle('collapsed');
    $('#plToggle').setAttribute('aria-expanded', String(!collapsed));
  });
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

  // background
  renderPresetGrid();
  if (S.bgCustom) $('#customBgUrl').value = S.bgCustom;
  $('#applyBgUrl').addEventListener('click', () => {
    const url = $('#customBgUrl').value.trim();
    if (!url) { toast('Tempel URL videonya dulu.'); return; }
    S.bgCustom = url; S.bgId = 'custom'; save();
    applyBackground();
    toast('Background custom diterapkan.');
  });

  // clock style
  $$('#stylePicker button').forEach(b =>
    b.addEventListener('click', () => setClockStyle(b.dataset.style)));
  $('#resetClockPos').addEventListener('click', resetClockPos);

  // durations
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

  // toggles
  const auto = $('#chkAuto'); auto.checked = S.autoContinue;
  auto.addEventListener('change', () => { S.autoContinue = auto.checked; save(); });
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

  // clear data
  $('#clearData').addEventListener('click', () => {
    if (confirm('Hapus semua data Podomoro yang tersimpan?')) {
      localStorage.removeItem(STORE_KEY);
      location.reload();
    }
  });
}

/* ---------------- boot ---------------- */
function init() {
  $('#clockCard').dataset.clockStyle = S.clockStyle;
  $$('#stylePicker button').forEach(b => b.classList.toggle('active', b.dataset.style === S.clockStyle));

  const bgv = $('#bgVideo');
  bgv.addEventListener('canplay', () => bgv.classList.add('ready'));
  bgv.addEventListener('error', () => bgv.classList.remove('ready'));

  $('#btnStartPause').addEventListener('click', () => (T.running ? pause() : start()));
  $('#btnReset').addEventListener('click', resetSession);
  $('#btnSkip').addEventListener('click', skipSession);

  // drag hint fades after first visit
  if (S.clockPos) $('#dragHint').style.display = 'none';
  setTimeout(() => { const h = $('#dragHint'); if (h) h.style.display = 'none'; }, 9000);

  initDrag();
  initSettings();
  initPlaylist();

  // small screens: start with the playlist collapsed so the timer stays reachable
  if (window.innerWidth <= 640) {
    $('#playlistPanel').classList.add('collapsed');
    $('#plToggle').setAttribute('aria-expanded', 'false');
  }
  applyBackground();
  T.remaining = durSec(T.mode);
  render();
}

document.addEventListener('DOMContentLoaded', init);
