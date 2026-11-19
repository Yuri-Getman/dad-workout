import { APP_VERSION } from './version.js';
import * as store from './store.js';
import { S } from './store.js';
import { esc, tabBar, showToast, openDialog, closeDialog, confirmDialog } from './ui/common.js';
import { RING_CIRC } from './ui/charts.js';
import { renderOnboarding, OB, parseNum, validateStep, onboardingResult, dumbbellsFromOB } from './ui/onboarding.js';
import { renderIdle } from './ui/idle.js';
import { renderActive, PREP_SEC } from './ui/active.js';
import { renderProgram } from './ui/program.js';
import { renderProgress } from './ui/progress.js';
import { unlockAudio, signal, keepAwake, applyTheme, watchSystemTheme, downloadText } from './platform.js';
import { todayISO } from './logic/dates.js';
import { formatDate, mmss } from './logic/format.js';
import { validateProfile } from './logic/profile.js';

S.version = APP_VERSION;
const root = document.getElementById('app');

let obError = '';
let lastKey = '';
let busy = false;

// ---------- Отрисовка ----------

function renderKey() {
  const a = S.active;
  return [S.ui.tab, S.ui.progressTab, S.profile ? 'main' : `ob${OB.step}`, a ? `${a.phase}:${a.pos.item}:${a.pos.set}` : ''].join('|');
}

function screen() {
  if (S.error) {
    return `<main class="screen"><h1>Не получилось запустить</h1><div class="alert error">${esc(S.error)}</div>
      <button class="btn" data-action="reload">Перезагрузить</button></main>`;
  }
  if (!S.loaded) return '<main class="screen"><p class="muted">Загрузка…</p></main>';
  if (!S.profile) return renderOnboarding(obError);
  const body = { workout: () => (S.active ? renderActive() : renderIdle()), program: renderProgram, progress: renderProgress }[S.ui.tab]();
  const banner = S.ui.update ? '<button class="update-banner" data-action="reload">Вышла новая версия приложения. Нажмите, чтобы обновить</button>' : '';
  return banner + body + tabBar(S.ui.tab);
}

function render() {
  const key = renderKey();
  const y = window.scrollY;
  root.innerHTML = screen();
  window.scrollTo(0, key === lastKey ? y : 0);
  lastKey = key;
  keepAwake(!!S.active);
  tick();
}

// ---------- Таймеры ----------

let ticking = false;

function setRing(fraction, text, label) {
  const ring = root.querySelector('[data-ring]');
  if (ring) ring.style.strokeDashoffset = String(RING_CIRC * (1 - Math.min(1, Math.max(0, fraction))));
  const t = root.querySelector('[data-timer-text]');
  if (t && t.textContent !== text) t.textContent = text;
  const l = root.querySelector('[data-timer-label]');
  if (l && l.textContent !== label) l.textContent = label;
}

async function tick() {
  const a = S.active;
  if (!a || ticking) return;
  const now = Date.now();
  if (!a.timed) S.ui.timedStarted = false;

  if (a.phase === 'rest' && a.rest) {
    const left = a.rest.endsAt - now;
    if (left <= 0) {
      ticking = true;
      // Если вернулись в приложение спустя долгое время, сигнал уже не нужен.
      if (-left < 5000) signal(S.settings, 'rest_end');
      await store.endRestNow();
      ticking = false;
      render();
      return;
    }
    setRing(left / 1000 / a.rest.total, mmss(Math.ceil(left / 1000)), 'осталось');
  } else if (a.timed) {
    const t = a.timed;
    if (now < t.startedAt) {
      setRing(0, String(Math.ceil((t.startedAt - now) / 1000)), 'приготовьтесь');
      return;
    }
    if (!S.ui.timedStarted) {
      S.ui.timedStarted = true;
      if (now - t.startedAt < 1500) signal(S.settings, 'tick');
    }
    const left = t.endsAt - now;
    if (left <= 0) {
      ticking = true;
      if (-left < 5000) signal(S.settings, 'timer_end');
      S.ui.timedStarted = false;
      await store.recordSet();
      ticking = false;
      render();
      return;
    }
    setRing(left / (t.endsAt - t.startedAt), mmss(Math.ceil(left / 1000)), 'идёт подход');
  }
}

setInterval(tick, 250);

// ---------- Диалог переноса ----------

function moveError(r) {
  switch (r.reason) {
    case 'in_past':
      return 'Нельзя выбрать прошедшую дату.';
    case 'before_previous':
      return `Нельзя раньше предыдущей тренировки (${formatDate(r.limit)}).`;
    case 'after_next':
      return `Нельзя позже следующей тренировки (${formatDate(r.limit)}). Чтобы сдвинуть и следующие тоже, нажмите «Сдвинуть эту и все следующие».`;
    case 'not_planned':
      return 'Эту тренировку уже нельзя перенести.';
    default:
      return 'Не получилось перенести тренировку.';
  }
}

function openMoveDialog(number) {
  const entry = S.schedule.sessions.find((s) => s.number === number);
  if (!entry) return;
  const today = todayISO();
  let pending = null;
  openDialog(
    `<h2>Перенести тренировку №${number}</h2>
     <p class="muted">Сейчас: ${esc(formatDate(entry.date))}</p>
     <label class="field"><span class="field-label">Новая дата</span>
       <input class="input" type="date" id="move-date" min="${today}" value="${entry.date < today ? today : entry.date}"></label>
     <div id="move-msg" class="alert" hidden></div>
     <div class="stack">
       <button class="btn" data-dialog-action="one">Перенести только эту</button>
       <button class="btn secondary" data-dialog-action="all">Сдвинуть эту и все следующие</button>
       <button class="btn ghost" data-dialog-action="cancel">Отмена</button>
     </div>`,
    async (action, _btn, d) => {
      if (action === 'cancel') return closeDialog();
      const msg = d.querySelector('#move-msg');
      const show = (text) => {
        msg.hidden = false;
        msg.textContent = text;
      };
      const date = d.querySelector('#move-date').value;
      if (!date) return show('Выберите дату.');
      const preview = store.previewMove(number, date, action);
      if (!preview.ok) return show(moveError(preview));
      if (preview.warnings.length && !(pending && pending.action === action && pending.date === date)) {
        pending = { action, date };
        return show(`В этот день уже стоит тренировка №${preview.warnings[0].with}. Нажмите кнопку ещё раз, если всё равно хотите перенести.`);
      }
      await store.moveSession(number, date, action);
      closeDialog();
      showToast(action === 'all' ? `План сдвинут: тренировка №${number} теперь ${formatDate(date)}` : `Тренировка №${number} перенесена на ${formatDate(date)}`);
      render();
    }
  );
}

// ---------- Действия ----------

async function exportData() {
  const text = await store.exportBackup();
  downloadText(`trenirovki-${todayISO()}.json`, text);
  showToast('Копия сохранена в файл. Он лежит в загрузках телефона.');
  render();
}

async function importFile(file) {
  const text = await file.text();
  const ok = await confirmDialog({
    title: 'Заменить данные из файла?',
    text: 'Текущие данные на этом телефоне будут заменены данными из копии.',
    confirmLabel: 'Заменить',
    danger: true,
  });
  if (!ok) return;
  const r = await store.importBackup(text);
  if (!r.ok) return showToast(r.error);
  applyTheme(S.settings.theme);
  showToast('Данные загружены');
  render();
}

function weekdayToggle(list, day) {
  return list.includes(day) ? list.filter((d) => d !== day) : [...list, day].sort((a, b) => a - b);
}

async function act(action, el) {
  switch (action) {
    case 'reload':
      return location.reload();
    case 'tab':
      S.ui.tab = el.dataset.tab;
      return render();
    case 'ptab':
      S.ui.progressTab = el.dataset.ptab;
      return render();
    case 'goto-settings':
      S.ui.tab = 'progress';
      S.ui.progressTab = 'settings';
      return render();

    // первый запуск
    case 'ob-dtype':
      OB.dtype = el.dataset.value;
      return render();
    case 'ob-day':
      OB.weekdays = weekdayToggle(OB.weekdays, Number(el.dataset.day));
      return render();
    case 'ob-back':
      obError = '';
      OB.step = Math.max(0, OB.step - 1);
      return render();
    case 'ob-next':
    case 'ob-finish': {
      const errors = validateStep();
      obError = errors.map(esc).join('<br>');
      if (errors.length) return render();
      if (action === 'ob-next') {
        OB.step += 1;
        return render();
      }
      await store.completeOnboarding(onboardingResult());
      showToast('Готово. Первая тренировка ждёт вас.');
      return render();
    }

    // расписание
    case 'start':
      unlockAudio();
      await store.startWorkout();
      return render();
    case 'move':
      return openMoveDialog(Number(el.dataset.number));
    case 'skip-session': {
      const n = Number(el.dataset.number);
      const ok = await confirmDialog({ title: `Пропустить тренировку №${n}?`, text: 'Остальной план не сдвинется. Пропуск можно отменить сразу после этого.', confirmLabel: 'Пропустить' });
      if (!ok) return;
      await store.skipSession(n);
      showToast(`Тренировка №${n} пропущена`);
      return render();
    }
    case 'undo-schedule':
      await store.undoSchedule();
      showToast('Последнее изменение отменено');
      return render();
    case 'shift-today': {
      const r = await store.moveSession(Number(el.dataset.number), todayISO(), 'all');
      showToast(r.ok ? 'План сдвинут: начинаем с сегодняшнего дня' : 'Не получилось сдвинуть план');
      return render();
    }

    // ход тренировки
    case 'inc':
    case 'dec':
      store.adjustDraft(el.dataset.field, action === 'inc' ? 1 : -1);
      return render();
    case 'reserve':
      store.setDraftValue('reserve', el.dataset.value);
      return render();
    case 'record': {
      const item = S.active.items[S.active.pos.item];
      if (item.section === 'main' && item.kind === 'reps' && !(S.active.draft.reps > 0)) return showToast('Укажите число повторов');
      if (item.kind === 'time' && !(S.active.draft.seconds > 0)) return showToast('Укажите время');
      unlockAudio();
      await store.recordSet();
      return render();
    }
    case 'skip-item': {
      const ok = await confirmDialog({ title: 'Пропустить упражнение?', text: 'Оно не попадёт в историю и не повлияет на нагрузку.', confirmLabel: 'Пропустить' });
      if (!ok) return;
      await store.skipExercise();
      return render();
    }
    case 'rest-skip':
      await store.endRestNow();
      return render();
    case 'rest-add':
      await store.addRestTime(Number(el.dataset.sec));
      return render();
    case 'timer-start':
      unlockAudio();
      await store.startTimer(PREP_SEC);
      return render();
    case 'timer-stop':
      await store.stopTimer();
      return render();
    case 'finish-early': {
      const ok = await confirmDialog({ title: 'Закончить тренировку?', text: 'Выполненные подходы сохранятся.', confirmLabel: 'Закончить' });
      if (!ok) return;
      await store.finishEarly();
      return render();
    }
    case 'discard': {
      const ok = await confirmDialog({ title: 'Не сохранять тренировку?', text: 'Все записанные подходы будут удалены, тренировка останется в плане.', confirmLabel: 'Не сохранять', danger: true });
      if (!ok) return;
      await store.discardWorkout();
      return render();
    }
    case 'discard-silent':
      await store.discardWorkout();
      return render();
    case 'toggle-video':
      S.ui.showVideo[el.dataset.id] = true;
      return render();
    case 'accept': {
      const sum = store.getSummary();
      if (el.checked) sum.accepted.add(el.dataset.ex);
      else sum.accepted.delete(el.dataset.ex);
      return;
    }
    case 'save-workout': {
      const ok = await store.saveWorkout({ note: S.ui.note, bodyWeight: parseNum(S.ui.bodyWeight ?? '') });
      S.ui.note = '';
      S.ui.bodyWeight = '';
      S.ui.tab = 'workout';
      showToast(ok ? 'Тренировка сохранена. Отличная работа!' : 'Тренировка сохранена не полностью, проверьте место на телефоне');
      return render();
    }

    // прогресс и настройки
    case 'theme':
      await store.updateSettings({ theme: el.dataset.value });
      applyTheme(el.dataset.value);
      return render();
    case 'rest-scale':
      await store.updateSettings({ restScale: Number(el.dataset.value) });
      return render();
    case 'test-signal':
      unlockAudio();
      signal(S.settings, 'rest_end');
      if (!S.settings.sound && !S.settings.vibration) showToast('Звук и вибрация выключены');
      return;
    case 'set-day': {
      const days = weekdayToggle(S.profile.weekdays, Number(el.dataset.day));
      if (!days.length) return showToast('Нужен хотя бы один день');
      await store.updateWeekdays(days);
      showToast('Расписание обновлено');
      return render();
    }
    case 'add-body': {
      const kg = parseNum(root.querySelector('#bw-value').value);
      const date = root.querySelector('#bw-date').value || todayISO();
      if (!(kg >= 30 && kg <= 250)) return showToast('Вес должен быть от 30 до 250 кг');
      await store.addBodyWeight(date, Math.round(kg * 10) / 10);
      showToast('Вес записан');
      return render();
    }
    case 'del-body': {
      const ok = await confirmDialog({ title: 'Удалить запись веса?', confirmLabel: 'Удалить', danger: true });
      if (!ok) return;
      await store.removeBodyEntry(Number(el.dataset.index));
      return render();
    }
    case 'export':
      return exportData();
    case 'import':
      return root.querySelector('#import-file').click();
    case 'reset': {
      const first = await confirmDialog({ title: 'Удалить все данные?', text: 'Профиль, расписание и вся история тренировок будут удалены с этого телефона.', confirmLabel: 'Продолжить', danger: true });
      if (!first) return;
      const second = await confirmDialog({ title: 'Точно удалить?', text: 'Это нельзя отменить. Если нет резервной копии, история пропадёт навсегда.', confirmLabel: 'Удалить навсегда', danger: true });
      if (!second) return;
      await store.resetAll();
      applyTheme('auto');
      Object.assign(OB, { step: 0, agree: false, startDate: todayISO() });
      return render();
    }
    default:
  }
}

root.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  if (el.type === 'checkbox' && el.dataset.action !== 'accept') return;
  unlockAudio();
  if (busy) return;
  busy = true;
  try {
    await act(el.dataset.action, el);
  } catch (err) {
    console.error(err);
    showToast('Что-то пошло не так. Попробуйте ещё раз.');
  } finally {
    busy = false;
  }
});

// Ввод текста и чисел: сохраняем без перерисовки, чтобы не терять фокус.
root.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.ob) {
    OB[t.dataset.ob] = t.type === 'checkbox' ? t.checked : t.value;
  } else if (t.dataset.input === 'note') {
    S.ui.note = t.value;
  } else if (t.dataset.input === 'bodyweight') {
    S.ui.bodyWeight = t.value;
  } else if (t.dataset.input && S.active) {
    const v = parseNum(t.value);
    if (Number.isFinite(v)) store.setDraftValue(t.dataset.input, v);
  }
});

root.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.ob === 'agree') OB.agree = t.checked;
  else if (t.dataset.input === 'exercise') {
    S.ui.exercise = t.value;
    render();
  } else if (t.dataset.setting) {
    await store.updateSettings({ [t.dataset.setting]: t.checked });
    if (t.checked) unlockAudio();
  } else if (t.dataset.profile) {
    const patch = { [t.dataset.profile]: parseNum(t.value) };
    const merged = { age: S.profile.age, heightCm: S.profile.heightCm, weightKg: S.profile.weightKg, ...patch };
    if (validateProfile(merged).length) showToast('Проверьте значение');
    else await store.updateProfile(patch);
    render();
  } else if (t.dataset.dumbbell) {
    const d = S.profile.dumbbells;
    const form = Object.fromEntries([...root.querySelectorAll('[data-dumbbell]')].map((i) => [i.dataset.dumbbell, i.value]));
    const saved = { dtype: OB.dtype, dMin: OB.dMin, dMax: OB.dMax, dStep: OB.dStep, dFixed: OB.dFixed };
    OB.dtype = d.type;
    if (d.type === 'adjustable') Object.assign(OB, { dMin: form.min, dMax: form.max, dStep: form.step });
    else OB.dFixed = form.fixed;
    const r = dumbbellsFromOB();
    Object.assign(OB, saved);
    if (r.errors) showToast(r.errors[0]);
    else {
      await store.updateDumbbells(r.dumbbells);
      showToast('Гантели обновлены');
    }
    render();
  } else if (t.id === 'import-file' && t.files[0]) {
    const file = t.files[0];
    t.value = '';
    await importFile(file);
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    keepAwake(!!S.active);
    tick();
  }
});

// ---------- Запуск ----------

try {
  const saved = localStorage.getItem('theme');
  if (saved) applyTheme(saved);
} catch {
  // тема применится после загрузки данных
}
watchSystemTheme();
render();

store.init().then(() => {
  if (S.loaded) applyTheme(S.settings.theme);
  render();
});

if ('serviceWorker' in navigator) {
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) {
      S.ui.update = true;
      render();
    }
    hadController = true;
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch((err) => console.error('Не удалось включить офлайн-режим', err));
  });
}
