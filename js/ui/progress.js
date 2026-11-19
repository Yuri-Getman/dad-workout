// Вкладка «Прогресс»: статистика, тело, история, настройки.
import { S } from '../store.js';
import { esc, segmented } from './common.js';
import { barChart, lineChart } from './charts.js';
import { todayISO, diffDays } from '../logic/dates.js';
import { formatDate, formatDateShort, formatDuration, formatKg, formatNumber, formatSet, pluralRu, WEEKDAYS_SHORT, WEEKDAYS_FULL } from '../logic/format.js';
import { summary, workoutsPerWeek, volumePerWeek, personalRecords, exerciseSeries, trackedExercises, bodySeries, bodyChange, workoutVolume } from '../logic/stats.js';
import { bmi } from '../logic/profile.js';
import { daysSinceBackup } from '../logic/backup.js';

const TABS = [
  { id: 'stats', label: 'Статистика' },
  { id: 'body', label: 'Тело' },
  { id: 'history', label: 'История' },
  { id: 'settings', label: 'Настройки' },
];

function statsView() {
  const today = todayISO();
  if (!S.workouts.length) {
    return `<div class="card center"><h2>Пока нет данных</h2><p class="muted">Здесь появятся графики и рекорды после первой завершённой тренировки.</p></div>`;
  }
  const sum = summary(S.workouts, today);
  const weeks = workoutsPerWeek(S.workouts, today, 8).map((w) => ({ label: formatDateShort(w.weekStart), value: w.count }));
  const vol = volumePerWeek(S.workouts, today, 8).map((w) => ({ label: formatDateShort(w.weekStart), value: Math.round(w.volume) }));
  const hasVolume = vol.some((v) => v.value > 0);
  const prs = personalRecords(S.workouts);
  const tracked = trackedExercises(S.workouts);
  const selected = tracked.find((t) => t.variantId === S.ui.exercise) ?? tracked[0];
  const series = exerciseSeries(S.workouts, selected.variantId);
  const unit = selected.kind === 'time' ? ' с' : '';
  return `<div class="grid2">
      <div class="card stat"><strong>${sum.total}</strong><span class="muted">${pluralRu(sum.total, 'тренировка', 'тренировки', 'тренировок')} всего</span></div>
      <div class="card stat"><strong>${sum.last30}</strong><span class="muted">за 30 дней</span></div>
      <div class="card stat"><strong>${sum.weekStreak}</strong><span class="muted">${pluralRu(sum.weekStreak, 'неделя', 'недели', 'недель')} подряд</span></div>
      <div class="card stat"><strong>${esc(formatDuration(sum.totalDurationSec))}</strong><span class="muted">общее время</span></div>
    </div>
    <section class="card"><h2>Тренировок по неделям</h2>${barChart(weeks, { ariaLabel: 'Тренировок по неделям' })}<p class="muted small">Подписи — понедельник недели.</p></section>
    ${hasVolume ? `<section class="card"><h2>Объём по неделям, кг</h2>${barChart(vol, { ariaLabel: 'Объём по неделям', format: (v) => (v >= 1000 ? `${formatNumber(v / 1000)}т` : String(v)) })}<p class="muted small">Объём = вес × повторы, для упражнений с гантелями.</p></section>` : ''}
    <section class="card"><h2>Динамика по упражнению</h2>
      <label class="field"><select class="input" data-input="exercise" aria-label="Упражнение">${tracked
        .map((t) => `<option value="${esc(t.variantId)}"${t.variantId === selected.variantId ? ' selected' : ''}>${esc(t.name)}</option>`)
        .join('')}</select></label>
      ${lineChart(series.map((p) => ({ date: p.date, value: p.value })), { unit, ariaLabel: `Динамика: ${selected.name}` })}
      <p class="muted small">Лучший подход каждой тренировки${selected.kind === 'time' ? ', секунды' : ', повторы'}.${series.some((p) => p.weight > 0) ? ` Вес сейчас: ${esc(formatKg(series[series.length - 1].weight ?? 0))}.` : ''}</p>
    </section>
    <section class="card"><h2>Личные рекорды</h2><ul class="plain">${prs
      .map((p) => `<li class="line"><span>${esc(p.name)}</span><span><strong>${esc(formatSet(p.best, p.kind))}</strong> <span class="muted small">${esc(formatDateShort(p.best.date))}</span></span></li>`)
      .join('')}</ul></section>`;
}

function bodyView() {
  const p = S.profile;
  const series = bodySeries(S.bodyLog);
  const last = series[series.length - 1];
  const change = bodyChange(S.bodyLog);
  const cur = last?.weightKg ?? p.weightKg;
  const delta = change ? `${change.deltaKg > 0 ? '+' : ''}${formatNumber(change.deltaKg)} кг с ${formatDateShort(change.from.date)}` : '';
  return `<div class="grid2">
      <div class="card stat"><strong>${esc(formatNumber(cur))} кг</strong><span class="muted">вес${delta ? `, ${esc(delta)}` : ''}</span></div>
      <div class="card stat"><strong>${esc(formatNumber(bmi(cur, p.heightCm)))}</strong><span class="muted">индекс массы тела</span></div>
    </div>
    <section class="card"><h2>Записать вес</h2>
      <div class="inline">
        <input class="input" type="number" inputmode="decimal" step="0.1" id="bw-value" placeholder="кг" aria-label="Вес, кг" value="${esc(formatNumber(cur).replace(',', '.'))}">
        <input class="input" type="date" id="bw-date" max="${todayISO()}" value="${todayISO()}" aria-label="Дата">
      </div>
      <button class="btn" data-action="add-body">Сохранить</button>
      <p class="muted small">Вес колеблется в течение дня, поэтому лучше взвешиваться в одно и то же время, например утром.</p>
    </section>
    ${series.length ? `<section class="card"><h2>Вес тела</h2>${lineChart(series.map((e) => ({ date: e.date, value: e.weightKg })), { unit: '', ariaLabel: 'Вес тела' })}
      <p class="muted small">При росте мышечной массы вес на весах может не снижаться, хотя жира становится меньше. Смотрите и на силу, и на самочувствие.</p></section>` : ''}
    <section class="card"><h2>Данные о вас</h2>
      <div class="grid2">
        <label class="field"><span class="field-label">Рост, см</span><input class="input" type="number" inputmode="numeric" data-profile="heightCm" value="${esc(p.heightCm)}"></label>
        <label class="field"><span class="field-label">Возраст</span><input class="input" type="number" inputmode="numeric" data-profile="age" value="${esc(p.age)}"></label>
      </div></section>
    ${series.length ? `<section class="card"><h2>Записи веса</h2><ul class="plain">${[...S.bodyLog]
      .map((e, i) => ({ e, i }))
      .sort((a, b) => b.e.date.localeCompare(a.e.date))
      .slice(0, 12)
      .map(({ e, i }) => `<li class="line"><span>${esc(formatDate(e.date))}</span><span>${esc(formatNumber(e.weightKg))} кг <button class="link" data-action="del-body" data-index="${i}" aria-label="Удалить запись">удалить</button></span></li>`)
      .join('')}</ul></section>` : ''}`;
}

function historyView() {
  if (!S.workouts.length) return `<div class="card center"><h2>История пуста</h2><p class="muted">Завершённые тренировки появятся здесь вместе с вашими заметками.</p></div>`;
  const list = [...S.workouts].sort((a, b) => b.doneDate.localeCompare(a.doneDate) || b.number - a.number);
  return list
    .map((w) => {
      const vol = workoutVolume(w);
      return `<details class="card hist"><summary><div><strong>№${w.number} · ${esc(w.title)}</strong><div class="muted small">${esc(formatDate(w.doneDate))} · ${esc(formatDuration(w.durationSec))}${w.eased ? ' · облегчённая' : ''}</div></div></summary>
        <ul class="plain">${w.items.map((i) => `<li><strong>${esc(i.name)}</strong><div class="muted">${esc(i.sets.map((s) => formatSet(s, i.kind)).join(' · '))}</div></li>`).join('')}</ul>
        ${vol ? `<p class="muted small">Объём: ${esc(formatNumber(vol))} кг</p>` : ''}
        ${w.note ? `<p class="note"><span class="muted small">Заметка</span><br>${esc(w.note)}</p>` : '<p class="muted small">Без заметки</p>'}
      </details>`;
    })
    .join('');
}

function toggle(key, label, hint, on) {
  return `<label class="switch-row"><span><strong>${esc(label)}</strong>${hint ? `<span class="muted small block">${esc(hint)}</span>` : ''}</span>
    <input type="checkbox" role="switch" data-setting="${key}" ${on ? 'checked' : ''}></label>`;
}

function settingsView() {
  const s = S.settings;
  const d = S.profile.dumbbells;
  const days = WEEKDAYS_SHORT.map((n, i) => {
    const on = S.profile.weekdays.includes(i + 1);
    return `<button type="button" class="day${on ? ' active' : ''}" aria-pressed="${on}" aria-label="${esc(WEEKDAYS_FULL[i])}" data-action="set-day" data-day="${i + 1}">${esc(n)}</button>`;
  }).join('');
  const since = daysSinceBackup(s.lastBackup, todayISO(), diffDays);
  const dumbbellForm =
    d.type === 'adjustable'
      ? `<div class="grid3">
          <label class="field"><span class="field-label small">Мин., кг</span><input class="input" type="number" inputmode="decimal" step="0.5" data-dumbbell="min" value="${esc(d.min)}"></label>
          <label class="field"><span class="field-label small">Макс., кг</span><input class="input" type="number" inputmode="decimal" step="0.5" data-dumbbell="max" value="${esc(d.max)}"></label>
          <label class="field"><span class="field-label small">Шаг, кг</span><input class="input" type="number" inputmode="decimal" step="0.5" data-dumbbell="step" value="${esc(d.step)}"></label>
        </div>`
      : `<label class="field"><span class="field-label small">Веса через запятую, кг</span><input class="input" type="text" inputmode="decimal" data-dumbbell="fixed" value="${esc(d.weights.join(', '))}"></label>`;
  return `<section class="card"><h2>Оформление и сигналы</h2>
      <div class="field"><div class="field-label">Тема</div>${segmented('theme', 'value', [{ id: 'auto', label: 'Как в телефоне' }, { id: 'light', label: 'Светлая' }, { id: 'dark', label: 'Тёмная' }], s.theme)}</div>
      ${toggle('sound', 'Звук таймера', 'Сигнал, когда закончился отдых или время упражнения', s.sound)}
      ${toggle('vibration', 'Вибрация таймера', '', s.vibration)}
      <button class="btn secondary" data-action="test-signal">Проверить звук и вибрацию</button>
      <div class="field"><div class="field-label">Время отдыха между подходами</div>${segmented('rest-scale', 'value', [{ id: '0.75', label: '−25%' }, { id: '1', label: 'Как в плане' }, { id: '1.25', label: '+25%' }, { id: '1.5', label: '+50%' }], String(s.restScale))}</div>
    </section>
    <section class="card"><h2>Дни тренировок</h2>
      <div class="days">${days}</div>
      <p class="muted small">При смене дней незавершённые тренировки будут заново расставлены, начиная с сегодняшнего дня.</p></section>
    <section class="card"><h2>Гантели</h2>
      <p class="muted small">${d.type === 'adjustable' ? 'Разборные' : 'Цельные'}, вес одной гантели. Если купите тяжелее, поменяйте здесь максимальный вес, и приложение сможет увеличивать нагрузку.</p>
      ${dumbbellForm}</section>
    <section class="card"><h2>Резервная копия</h2>
      <p class="muted">Все данные хранятся только на этом телефоне. ${since === null ? 'Копий ещё не было.' : `Последняя копия: ${esc(formatDate(s.lastBackup))}.`}</p>
      <button class="btn" data-action="export">Сохранить копию в файл</button>
      <button class="btn secondary" data-action="import">Загрузить копию из файла</button>
      <input type="file" id="import-file" accept="application/json,.json" hidden></section>
    <section class="card"><h2>О приложении</h2>
      <p class="muted">Версия ${esc(S.version)}. ${S.persistent ? 'Данные сохраняются на телефоне.' : 'Данные не сохраняются: приватный режим браузера.'}</p>
      <button class="btn danger-ghost" data-action="reset">Удалить все данные</button></section>`;
}

export function renderProgress() {
  const tab = S.ui.progressTab;
  const body = { stats: statsView, body: bodyView, history: historyView, settings: settingsView }[tab]();
  return `<main class="screen"><h1>Прогресс</h1>${segmented('ptab', 'ptab', TABS, tab)}<div class="stack">${body}</div></main>`;
}
