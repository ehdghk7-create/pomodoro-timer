'use strict';

let pipWin = null; // always-on-top window; the clock may live in its document
const $ = (s) => document.querySelector(s) || (pipWin && pipWin.document.querySelector(s));
const CX = 200, CY = 200, R_SECTOR = 140, DIAL_MAX = 60 * 60;
const MODE_NAME = { focus: '집중', short: '짧은 휴식', long: '긴 휴식' };

/* ---------- storage ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('pomo.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('pomo.' + k, JSON.stringify(v)); } catch {} },
};
const settings = Object.assign(
  { focus: 25, short: 5, long: 15, longEvery: 4, autoStart: false, sound: true, volume: 0.6 },
  store.get('settings', {})
);
const todayKey = () => new Date().toLocaleDateString('sv');
let today = store.get('today', { date: todayKey(), count: 0 });
if (today.date !== todayKey()) today = { date: todayKey(), count: 0 };

const state = Object.assign(
  { mode: 'focus', remaining: settings.focus * 60, running: false, endAt: 0, cycle: 0 },
  store.get('state', {})
);
// restore a timer that kept running while the app was closed
if (state.running) {
  state.remaining = Math.max(0, (state.endAt - Date.now()) / 1000);
  if (state.remaining <= 0) { state.running = false; state.remaining = 0; }
}
const saveState = () => store.set('state', state);

/* ---------- dial drawing ---------- */
const svgNS = 'http://www.w3.org/2000/svg';
const polar = (deg, r) => {
  const a = (deg * Math.PI) / 180;
  return [CX + r * Math.sin(a), CY - r * Math.cos(a)];
};
(function buildDial() {
  const ticks = $('#ticks'), labels = $('#labels');
  for (let i = 0; i < 60; i++) {
    const major = i % 5 === 0;
    const [x1, y1] = polar(i * 6, major ? 166 : 172);
    const [x2, y2] = polar(i * 6, 180);
    const l = document.createElementNS(svgNS, 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1);
    l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    if (major) l.classList.add('major');
    ticks.appendChild(l);
    if (major) {
      const [tx, ty] = polar(i * 6, 153);
      const t = document.createElementNS(svgNS, 'text');
      t.setAttribute('x', tx); t.setAttribute('y', ty);
      t.textContent = i;
      labels.appendChild(t);
    }
  }
})();

function sectorPath(frac) {
  if (frac <= 0) return '';
  const R = R_SECTOR;
  if (frac >= 0.99999)
    return `M${CX},${CY - R}A${R},${R} 0 1 1 ${CX},${CY + R}A${R},${R} 0 1 1 ${CX},${CY - R}Z`;
  const [x, y] = polar(frac * 360, R);
  return `M${CX},${CY}L${CX},${CY - R}A${R},${R} 0 ${frac > 0.5 ? 1 : 0} 1 ${x},${y}Z`;
}
const fmt = (sec) => {
  const s = Math.ceil(sec);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function render() {
  const frac = Math.min(1, state.remaining / DIAL_MAX);
  const d = sectorPath(frac);
  $('#sector').setAttribute('d', d);
  $('#sectorClipPath').setAttribute('d', d);
  $('#knobLine').setAttribute('transform', `rotate(${frac * 360} ${CX} ${CY})`);
  const t = fmt(state.remaining);
  $('#digital').textContent = t;
  $('#digital2').textContent = t;
  $('#dial').setAttribute('aria-valuenow', Math.ceil(state.remaining / 60));
  $('#dial').setAttribute('aria-valuetext', t);
  document.title = state.running ? `${t} · ${MODE_NAME[state.mode]}` : 'Pomodoro Timer';
  document.body.classList.toggle('running', state.running);
  document.body.dataset.mode = state.mode;
  $('#clockWrap').dataset.mode = state.mode;
  $('#startLabel').textContent = state.running ? '일시정지' : '시작';
  document.querySelectorAll('.mode').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode));
  $('#todayCount').textContent = today.count;
  const dots = $('#cycleDots');
  dots.innerHTML = '';
  const done = state.cycle % settings.longEvery;
  for (let i = 0; i < settings.longEvery; i++) {
    const d = document.createElement('i');
    if (i < done) d.className = 'done';
    dots.appendChild(d);
  }
}

/* ---------- timer ---------- */
let loop = null;
function start() {
  if (state.remaining <= 0) state.remaining = settings[state.mode] * 60;
  unlockAudio();
  askNotify();
  state.endAt = Date.now() + state.remaining * 1000;
  state.running = true;
  clearInterval(loop);
  loop = setInterval(tick, 200);
  wakeLock(true);
  saveState(); render();
}
function pause() {
  if (!state.running) return;
  state.remaining = Math.max(0, (state.endAt - Date.now()) / 1000);
  state.running = false;
  clearInterval(loop);
  wakeLock(false);
  saveState(); render();
}
const toggle = () => (state.running ? pause() : start());
function reset() {
  pause();
  state.remaining = settings[state.mode] * 60;
  saveState(); render();
}
function setMode(mode, autoStart = false) {
  pause();
  state.mode = mode;
  state.remaining = settings[mode] * 60;
  saveState(); render();
  if (autoStart) start();
}
function tick() {
  state.remaining = Math.max(0, (state.endAt - Date.now()) / 1000);
  if (state.remaining <= 0) finish();
  else render();
}
function finish() {
  clearInterval(loop);
  state.running = false;
  state.remaining = 0;
  wakeLock(false);
  render();
  playAlarm();
  if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 600]);
  const ended = state.mode;
  let next = 'focus';
  if (ended === 'focus') {
    today.count++; store.set('today', today);
    state.cycle++;
    next = state.cycle % settings.longEvery === 0 ? 'long' : 'short';
  }
  notify(ended === 'focus' ? '집중 시간 끝! 🍅' : '휴식 끝!', `다음: ${MODE_NAME[next]} ${settings[next]}분`);
  toast(ended === 'focus' ? `집중 완료! 이제 ${MODE_NAME[next]} ${settings[next]}분` : `휴식 끝! 다시 집중해볼까요?`);
  setTimeout(() => setMode(next, settings.autoStart), 1200);
}

/* ---------- drag to set (Google Timer style) ---------- */
const dial = $('#dial');
let dragging = false, lastMin = 0, downOnKnob = false;
function setFromPointer(e) {
  const r = dial.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * 400 - CX;
  const y = ((e.clientY - r.top) / r.height) * 400 - CY;
  let ang = Math.atan2(x, -y);
  if (ang < 0) ang += Math.PI * 2;
  let min = (ang / (Math.PI * 2)) * 60;
  // don't wrap around past 12 o'clock
  if (lastMin > 45 && min < 15) min = 60;
  else if (lastMin < 15 && min > 45) min = 0;
  min = Math.round(min);
  lastMin = min;
  setMinutes(min);
}
function setMinutes(min) {
  min = Math.max(0, Math.min(60, min));
  state.remaining = min * 60;
  if (state.running) {
    if (min === 0) { pause(); }
    else state.endAt = Date.now() + state.remaining * 1000;
  }
  render();
}
dial.addEventListener('pointerdown', (e) => {
  unlockAudio();
  downOnKnob = !!e.target.closest('#knob');
  if (downOnKnob) return;
  dragging = true;
  dial.setPointerCapture(e.pointerId);
  lastMin = state.remaining / 60;
  setFromPointer(e);
});
dial.addEventListener('pointermove', (e) => { if (dragging) setFromPointer(e); });
const endDrag = () => { if (dragging) { dragging = false; saveState(); } };
dial.addEventListener('pointerup', endDrag);
dial.addEventListener('pointercancel', endDrag);
$('#knob').addEventListener('click', () => { if (downOnKnob) toggle(); });

/* ---------- keyboard ---------- */
function onKey(e) {
  if (e.target.matches && e.target.matches('input')) return;
  if (e.code === 'Space') { e.preventDefault(); toggle(); }
  else if (e.key === 'r' || e.key === 'R') reset();
  else if (e.key === 'p' || e.key === 'P') togglePin();
  else if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); setMinutes(Math.floor(state.remaining / 60) + 1); saveState(); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); setMinutes(Math.ceil(state.remaining / 60) - 1); saveState(); }
}
document.addEventListener('keydown', onKey);

/* ---------- sound ---------- */
let actx = null;
function unlockAudio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} }
  if (actx && actx.state === 'suspended') actx.resume();
}
function tone(t, freq, dur, vol) {
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(actx.destination);
  o.start(t); o.stop(t + dur + 0.05);
}
function playAlarm(repeats = 4) {
  if (!settings.sound || !actx || settings.volume <= 0) return;
  const v = settings.volume * 0.5, t0 = actx.currentTime + 0.05;
  for (let r = 0; r < repeats; r++)
    for (let i = 0; i < 3; i++) {
      const t = t0 + r * 1.1 + i * 0.2;
      tone(t, 1318, 0.5, v);
      tone(t, 2637, 0.25, v * 0.25);
    }
}

/* ---------- notifications & wake lock ---------- */
function askNotify() {
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
}
async function notify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const opts = { body, icon: 'icons/icon-192.png', tag: 'pomo', renotify: true };
  try {
    const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
    if (reg) reg.showNotification(title, opts); else new Notification(title, opts);
  } catch {}
}
let lock = null;
async function wakeLock(on) {
  try {
    if (on && 'wakeLock' in navigator && !lock) {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    } else if (!on && lock) { await lock.release(); lock = null; }
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (state.running) { tick(); wakeLock(true); }
  }
});

/* ---------- always on top ---------- */
const setPinUI = (on) => $('#btnPin').classList.toggle('on', on);
async function togglePin() {
  // 1) desktop app (Electron)
  if (window.electronAPI) {
    const on = await window.electronAPI.toggleAlwaysOnTop();
    document.body.classList.toggle('compact', on);
    setPinUI(on);
    return;
  }
  // 2) Chrome / Edge: Document Picture-in-Picture floats above every window
  if (!('documentPictureInPicture' in window)) {
    toast('이 브라우저는 ‘항상 위’를 지원하지 않아요. PC에서는 Chrome/Edge 또는 설치형 앱을 사용하세요.');
    return;
  }
  if (pipWin) { pipWin.close(); return; }
  try {
    pipWin = await documentPictureInPicture.requestWindow({ width: 300, height: 300 });
  } catch (err) { toast('항상 위 창을 열 수 없어요.'); return; }
  const css = [...document.styleSheets].map((s) => {
    try { return [...s.cssRules].map((r) => r.cssText).join('\n'); } catch { return ''; }
  }).join('\n');
  const style = pipWin.document.createElement('style');
  style.textContent = css;
  pipWin.document.head.appendChild(style);
  pipWin.document.title = 'Pomodoro';
  pipWin.document.body.classList.add('pip');
  pipWin.document.body.appendChild($('#clockWrap'));
  pipWin.document.addEventListener('keydown', onKey);
  $('#pipNotice').hidden = false;
  setPinUI(true);
  pipWin.addEventListener('pagehide', () => {
    const wrap = pipWin.document.getElementById('clockWrap');
    $('#clockSlot').prepend(wrap);
    $('#pipNotice').hidden = true;
    pipWin = null;
    setPinUI(false);
  });
}
/* ---------- UI wiring ---------- */
$('#btnStart').addEventListener('click', toggle);
$('#btnReset').addEventListener('click', reset);
$('#btnPin').addEventListener('click', togglePin);
document.querySelectorAll('.mode').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

const bindNum = (id, key, min, max) => {
  const el = $(id);
  el.value = settings[key];
  el.addEventListener('change', () => {
    const v = Math.max(min, Math.min(max, Math.round(+el.value || settings[key])));
    el.value = v;
    const wasFull = !state.running && key === state.mode && Math.round(state.remaining) === settings[key] * 60;
    settings[key] = v;
    store.set('settings', settings);
    if (wasFull) state.remaining = v * 60;
    render();
  });
};
bindNum('#setFocus', 'focus', 1, 60);
bindNum('#setShort', 'short', 1, 60);
bindNum('#setLong', 'long', 1, 60);
bindNum('#setEvery', 'longEvery', 2, 10);
const bindCheck = (id, key) => {
  const el = $(id);
  el.checked = settings[key];
  el.addEventListener('change', () => { settings[key] = el.checked; store.set('settings', settings); });
};
bindCheck('#setAuto', 'autoStart');
bindCheck('#setSound', 'sound');
$('#setVolume').value = settings.volume;
$('#setVolume').addEventListener('input', (e) => { settings.volume = +e.target.value; store.set('settings', settings); });
$('#btnTest').addEventListener('click', () => { unlockAudio(); const s = settings.sound; settings.sound = true; playAlarm(1); settings.sound = s; });

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

/* ---------- install (PWA) ---------- */
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); installEvt = e; $('#btnInstall').hidden = false;
});
$('#btnInstall').addEventListener('click', async () => {
  if (!installEvt) return;
  installEvt.prompt();
  await installEvt.userChoice;
  installEvt = null; $('#btnInstall').hidden = true;
});
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// hide the pin button where always-on-top isn't possible (phones, Safari, Firefox)
if (!window.electronAPI && !('documentPictureInPicture' in window)) $('#btnPin').hidden = true;

render();
if (state.running) { loop = setInterval(tick, 200); wakeLock(true); }
