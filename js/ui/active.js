// Вкладка «Тренировка» во время занятия: упражнение, отдых, итоги.
import { S, getSummary } from '../store.js';
import { esc, stepper } from './common.js';
import { ring } from './charts.js';
import { currentItem, progress } from '../logic/flow.js';
import { lastPerformance, describeSuggestion } from '../logic/workout.js';
import { formatSet, formatDuration, formatKg, mmss, formatNumber } from '../logic/format.js';
import { workoutVolume } from '../logic/stats.js';

export const PREP_SEC = 5;

const SECTION = { warmup: 'Разминка', main: 'Основная часть', cooldown: 'Растяжка' };

function header(a) {
  const p = progress(a);
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return `<header class="wk-head">
    <div class="wk-title"><strong>№${a.number} · ${esc(a.title)}</strong>
      <span class="muted small">Основная часть: ${p.done} из ${p.total} подходов</span></div>
    <details class="menu"><summary aria-label="Меню тренировки">⋯</summary>
      <div class="menu-body">
        <button class="btn secondary" data-action="finish-early">Закончить досрочно</button>
        <button class="btn danger-ghost" data-action="discard">Отменить тренировку</button>
      </div></details>
    <div class="progress" aria-hidden="true"><span style="width:${pct}%"></span></div>
  </header>`;
}

function media(item) {
  const ex = S.lib.exercises[item.variantId];
  const base = S.lib.exercises[item.exerciseId];
  const video = ex.video ?? base.video;
  const image = ex.image ?? base.image;
  if (video && S.ui.showVideo[item.variantId]) {
    return `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${esc(video)}?rel=0&modestbranding=1&playsinline=1" title="Видео: ${esc(item.name)}" loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`;
  }
  const img = image ? `<img class="ex-img" src="${esc(image)}" alt="${esc(item.name)}" loading="lazy">` : '';
  const btn = video ? `<button class="btn secondary" data-action="toggle-video" data-id="${esc(item.variantId)}">▶ Смотреть видео (нужен интернет)</button>` : '';
  return `${img}${btn}`;
}

function tips(item, open) {
  const ex = S.lib.exercises[item.variantId];
  const base = S.lib.exercises[item.exerciseId];
  const list = ex.tips ?? base.tips ?? [];
  return `<details class="card tips"${open ? ' open' : ''}><summary>Как выполнять</summary><ul>${list.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></details>`;
}

function target(item) {
  if (item.kind === 'time') return `Цель: ${item.seconds} с${item.perSide ? ' на каждую сторону' : ''}`;
  if (item.section !== 'main') return `Сделайте ${item.reps} ${item.perSide ? 'раз на каждую сторону' : 'раз'}`;
  const w = item.weight > 0 ? ` · ${formatKg(item.weight)} (вес одной гантели)` : '';
  return `Цель: ${item.repRange[0]}–${item.repRange[1]} повторов${item.perSide ? ' на каждую сторону' : ''}${item.load === 'dumbbell' ? w : ''}`;
}

function reserveBlock(a) {
  const opts = [
    ['hard', 'Очень тяжело', 'почти до отказа'],
    ['medium', 'Нормально', 'ещё 2–3 раза'],
    ['easy', 'Легко', 'ещё 4+ раза'],
  ];
  return `<div class="field"><div class="field-label">Насколько тяжёлым был подход?</div>
    <div class="seg3">${opts
      .map(([id, label, sub]) => `<button class="${a.draft.reserve === id ? 'active' : ''}" data-action="reserve" data-value="${id}"><strong>${label}</strong><span class="small">${sub}</span></button>`)
      .join('')}</div></div>`;
}

function timedControls(a, item) {
  if (a.timed) {
    return `${ring({ fraction: 1, text: '', label: '' })}
      <div class="row-btns"><button class="btn secondary" data-action="timer-stop">Остановить</button></div>`;
  }
  return `${stepper({ field: 'seconds', label: 'Секунд', value: a.draft.seconds, hint: '±5 с' })}
    <button class="btn big" data-action="timer-start">▶ Запустить таймер</button>
    <p class="muted small">После запуска будет ${PREP_SEC} секунд на подготовку. Подход запишется сам, когда время закончится. Если остановите раньше, запишется фактическое время.</p>
    <button class="btn secondary" data-action="record">Записать без таймера</button>`;
}

function repsControls(a, item) {
  const main = item.section === 'main';
  if (!main) {
    return `<button class="btn big" data-action="record">Готово</button>`;
  }
  const weightField =
    item.load !== 'bodyweight'
      ? stepper({ field: 'weight', label: item.load === 'weighted_bodyweight' ? 'Доп. вес, кг' : 'Вес гантели, кг', value: a.draft.weight, hint: item.load === 'weighted_bodyweight' ? '0 — без веса' : '' })
      : '';
  return `${stepper({ field: 'reps', label: item.perSide ? 'Повторов на сторону' : 'Повторов', value: a.draft.reps })}
    ${weightField}
    ${item.needsCalibration ? reserveBlock(a) : ''}
    <button class="btn big" data-action="record">Записать подход</button>`;
}

function workView(a) {
  const item = currentItem(a);
  const last = lastPerformance(S.workouts, item.variantId);
  const main = item.section === 'main';
  const calib = item.needsCalibration
    ? `<div class="alert info">Подберите вес. Возьмите гантели, с которыми получится около ${Math.round((item.repRange[0] + item.repRange[1]) / 2)} повторов, и сделайте подход. Приложение запомнит рабочий вес.</div>`
    : '';
  const lastLine =
    last && main
      ? `<p class="muted small">В прошлый раз: ${esc(last.sets.map((s) => formatSet(s, item.kind)).join(', '))}</p>`
      : '';
  return `${header(a)}
    <section class="card">
      <div class="chip">${SECTION[item.section]}</div>
      <h2>${esc(item.name)}</h2>
      ${main ? `<p class="setno">Подход ${a.pos.set + 1} из ${item.sets}</p>` : ''}
      <p class="target">${esc(target(item))}</p>
      ${item.eased ? '<p class="muted small">Облегчённый вариант: нагрузка снижена.</p>' : ''}
      ${lastLine}
      ${calib}
      ${media(item)}
    </section>
    <section class="card">
      ${item.kind === 'time' ? timedControls(a, item) : repsControls(a, item)}
      <button class="btn ghost" data-action="skip-item">Пропустить это упражнение</button>
    </section>
    ${tips(item, !main || a.pos.set === 0)}`;
}

function nextHint(a) {
  const item = a.items[a.pos.item];
  if (!item) return '';
  const label = item.section === 'main' ? `Подход ${a.pos.set + 1} из ${item.sets}` : SECTION[item.section];
  return `<p class="muted center">Дальше: ${esc(item.name)} · ${esc(label)}</p>`;
}

function restView(a) {
  const left = Math.max(0, Math.ceil((a.rest.endsAt - Date.now()) / 1000));
  return `${header(a)}
    <section class="card center">
      <h2>Отдых</h2>
      ${ring({ fraction: a.rest.total ? left / a.rest.total : 0, text: mmss(left), label: 'осталось' })}
      <div class="row-btns">
        <button class="btn secondary" data-action="rest-add" data-sec="30">+30 с</button>
        <button class="btn" data-action="rest-skip">Продолжить</button>
      </div>
      ${nextHint(a)}
      <button class="btn ghost" data-action="finish-early">Закончить тренировку</button>
    </section>`;
}

function summaryView(a) {
  const sum = getSummary();
  const log = sum.log;
  const empty = log.items.length === 0;
  const sets = log.items.reduce((n, i) => n + i.sets.length, 0);
  const volume = workoutVolume(log);
  const lastBody = [...S.bodyLog].sort((x, y) => x.date.localeCompare(y.date)).pop();
  if (empty) {
    return `<section class="card center"><h2>Нет выполненных подходов</h2>
      <p class="muted">Вы не записали ни одного подхода основной части, поэтому тренировка не сохранится и останется в плане.</p>
      <button class="btn" data-action="discard-silent">Выйти</button></section>`;
  }
  const suggestions = sum.suggestions
    .map((s) => {
      const text = describeSuggestion(s, S.lib);
      if (!text) return '';
      if (s.suggestion.type === 'hold') return `<li class="sug"><div><strong>${esc(s.name)}</strong><div class="muted">${esc(text)}</div></div></li>`;
      return `<li class="sug"><label class="check"><input type="checkbox" data-action="accept" data-ex="${esc(s.exerciseId)}" ${sum.accepted.has(s.exerciseId) ? 'checked' : ''}>
        <span><strong>${esc(s.name)}</strong><br>${esc(text)}</span></label></li>`;
    })
    .join('');
  return `<section class="card center"><h1>Тренировка завершена</h1>
      <div class="stats3">
        <div><strong>${esc(formatDuration(log.durationSec))}</strong><span class="muted small">время</span></div>
        <div><strong>${sets}</strong><span class="muted small">подходов</span></div>
        <div><strong>${volume ? esc(formatNumber(volume)) : '—'}</strong><span class="muted small">объём, кг</span></div>
      </div></section>
    ${suggestions ? `<section class="card"><h2>Что изменить в следующий раз</h2><ul class="plain">${suggestions}</ul><p class="muted small">Снимите галочку, если хотите оставить как есть.</p></section>` : ''}
    <section class="card">
      <label class="field"><span class="field-label">Заметка к тренировке</span>
        <textarea class="input" rows="3" data-input="note" placeholder="Как прошло: тяжело или легко, самочувствие, спина">${esc(S.ui.note || '')}</textarea></label>
      <label class="field"><span class="field-label">Вес тела сегодня, кг <span class="muted small">необязательно</span></span>
        <input class="input" type="number" inputmode="decimal" step="0.1" data-input="bodyweight" placeholder="${lastBody ? esc(formatNumber(lastBody.weightKg)) : ''}" value="${esc(S.ui.bodyWeight ?? '')}"></label>
      <button class="btn big" data-action="save-workout">Сохранить тренировку</button>
      <button class="btn ghost" data-action="discard">Не сохранять</button>
    </section>`;
}

export function renderActive() {
  const a = S.active;
  let body;
  if (a.phase === 'summary') body = summaryView(a);
  else if (a.phase === 'rest' && a.rest) body = restView(a);
  else body = workView(a);
  return `<main class="screen workout">${body}</main>`;
}
