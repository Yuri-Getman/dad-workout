// Возможности устройства: звук, вибрация, экран не гаснет, тема, файлы.

let audioCtx = null;

/** Звук разрешён браузером только после касания, поэтому вызывается из обработчиков нажатий. */
export function unlockAudio() {
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  } catch {
    // звук недоступен, остаётся вибрация и экран
  }
}

function beep({ times = 1, freq = 880, ms = 180, gap = 120 }) {
  if (!audioCtx) return;
  try {
    const t0 = audioCtx.currentTime;
    for (let i = 0; i < times; i++) {
      const start = t0 + (i * (ms + gap)) / 1000;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.5, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + ms / 1000);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + ms / 1000 + 0.02);
    }
  } catch {
    // ничего страшного
  }
}

function vibrate(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // не поддерживается
  }
}

const SIGNALS = {
  tick: { beep: { times: 1, freq: 660, ms: 90 }, vibrate: 40 },
  rest_end: { beep: { times: 2, freq: 880, ms: 180 }, vibrate: [200, 100, 200] },
  timer_end: { beep: { times: 3, freq: 988, ms: 200 }, vibrate: [300, 120, 300, 120, 300] },
};

/** Подать сигнал с учётом настроек звука и вибрации. kind: 'tick' | 'rest_end' | 'timer_end'. */
export function signal(settings, kind) {
  const s = SIGNALS[kind];
  if (!s) return;
  if (settings.sound) beep(s.beep);
  if (settings.vibration) vibrate(s.vibrate);
}

let wakeLock = null;

/** Не давать экрану гаснуть во время тренировки. */
export async function keepAwake(on) {
  try {
    if (on) {
      if (!wakeLock && navigator.wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => {
          wakeLock = null;
        });
      }
    } else if (wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    // экран может погаснуть, таймеры считают по времени окончания и это переживут
  }
}

function syncThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (bg) meta.setAttribute('content', bg);
}

/** theme: 'auto' | 'light' | 'dark' */
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  try {
    localStorage.setItem('theme', theme);
  } catch {
    // без хранилища тема применится после загрузки данных
  }
  syncThemeColor();
}

export function watchSystemTheme() {
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeColor);
  } catch {
    // не критично
  }
}

export function downloadText(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
