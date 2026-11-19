// Ход тренировки: подходы, отдых, таймеры. Все функции чистые, active не изменяется.
//
// active = {
//   ...workout (number, templateId, title, items, easeFactor),
//   date, startedAt, note,
//   pos: { item, set },
//   phase: 'work' | 'rest' | 'summary',
//   rest: { endsAt, total } | null,
//   timed: { startedAt, endsAt } | null,       запущен таймер упражнения на время
//   draft: { reps?, seconds?, weight?, reserve? }   то, что сейчас введено для подхода
// }

import { availableWeights, weightLadder } from './equipment.js';
import { workingWeight } from './calibration.js';
import { RESERVE_TO_RIR, lastPerformance } from './workout.js';

const clone = (x) => structuredClone(x);

function suggestStartWeight(list) {
  return list.length ? list[Math.floor((list.length - 1) / 3)] : 0;
}

/** Значения по умолчанию для ввода подхода. */
export function makeDraft(item, setIndex, { lastPerf, dumbbells }) {
  const draft = {};
  if (item.kind === 'time') {
    draft.seconds = item.seconds;
  } else {
    const prev = item.logged[setIndex - 1];
    const hist = lastPerf?.sets?.[setIndex] ?? lastPerf?.sets?.[lastPerf.sets.length - 1];
    draft.reps = prev?.reps ?? hist?.reps ?? item.repRange?.[0] ?? item.reps;
  }
  if (item.load !== 'bodyweight') {
    const list = weightLadder(item.load, dumbbells);
    draft.weight = item.weight ?? suggestStartWeight(list);
  }
  if (item.needsCalibration) draft.reserve = 'medium';
  return draft;
}

export function startActive(workout, { date, now, workouts, dumbbells }) {
  const first = workout.items[0];
  return {
    ...clone(workout),
    date,
    startedAt: now,
    note: '',
    pos: { item: 0, set: 0 },
    phase: 'work',
    rest: null,
    timed: null,
    draft: makeDraft(first, 0, { lastPerf: lastPerformance(workouts, first.variantId), dumbbells }),
  };
}

export const currentItem = (a) => a.items[a.pos.item];

export function setDraft(a, patch) {
  return { ...a, draft: { ...a.draft, ...patch } };
}

/** Сколько подходов выполнено и сколько всего (основная часть). */
export function progress(a) {
  const main = a.items.filter((i) => i.section === 'main');
  const total = main.reduce((n, i) => n + (i.skipped ? i.logged.length : i.sets), 0);
  const done = main.reduce((n, i) => n + i.logged.length, 0);
  return { done, total };
}

function nextIndex(a, from) {
  let i = from + 1;
  while (i < a.items.length && a.items[i].skipped) i++;
  return i;
}

/** Переход к следующему подходу или упражнению после текущего. */
function advance(a, { now, restScale = 1, workouts, dumbbells }, { withRest }) {
  const item = a.items[a.pos.item];
  const finishedItem = a.pos.set + 1 >= item.sets;
  if (finishedItem) {
    a.pos = { item: nextIndex(a, a.pos.item), set: 0 };
  } else {
    a.pos = { item: a.pos.item, set: a.pos.set + 1 };
  }
  a.timed = null;
  if (a.pos.item >= a.items.length) {
    a.phase = 'summary';
    a.rest = null;
    a.draft = {};
    return a;
  }
  const next = a.items[a.pos.item];
  a.draft = makeDraft(next, a.pos.set, { lastPerf: lastPerformance(workouts, next.variantId), dumbbells });
  const restSec = Math.round(item.restSec * restScale);
  if (withRest && item.section === 'main' && restSec > 0) {
    a.phase = 'rest';
    a.rest = { endsAt: now + restSec * 1000, total: restSec };
  } else {
    a.phase = 'work';
    a.rest = null;
  }
  return a;
}

/**
 * Записать текущий подход из draft.
 * ctx: { now, restScale, workouts, dumbbells }
 * Возвращает { active, stateUpdate }; stateUpdate = { exerciseId, weight } после подбора веса.
 */
export function completeSet(active, ctx) {
  const a = clone(active);
  const item = a.items[a.pos.item];
  const set = {};
  if (item.kind === 'time') set.seconds = a.draft.seconds;
  else set.reps = a.draft.reps;
  if (item.load !== 'bodyweight') set.weight = a.draft.weight;
  item.logged.push(set);

  let stateUpdate = null;
  if (item.needsCalibration && a.pos.set === 0) {
    const list = availableWeights(ctx.dumbbells);
    const mid = Math.round((item.repRange[0] + item.repRange[1]) / 2);
    let weight = set.weight;
    try {
      weight = workingWeight({ weight: set.weight, reps: set.reps, rir: RESERVE_TO_RIR[a.draft.reserve] ?? 2 }, mid, list);
    } catch {
      // не удалось рассчитать (например, 0 повторов): оставляем вес, с которым делали подход
    }
    item.weight = weight;
    item.needsCalibration = false;
    stateUpdate = { exerciseId: item.exerciseId, weight };
  }
  return { active: advance(a, ctx, { withRest: true }), stateUpdate };
}

export function endRest(active) {
  return { ...clone(active), phase: 'work', rest: null };
}

export function addRest(active, seconds) {
  const a = clone(active);
  if (a.rest) {
    a.rest.endsAt += seconds * 1000;
    a.rest.total += seconds;
  }
  return a;
}

/** Пропустить текущее упражнение целиком. */
export function skipItem(active, ctx) {
  const a = clone(active);
  a.items[a.pos.item].skipped = true;
  a.pos = { item: a.pos.item, set: a.items[a.pos.item].sets - 1 };
  return advance(a, ctx, { withRest: false });
}

/** Закончить тренировку досрочно: переход к итогам. */
export function finishEarly(active) {
  return { ...clone(active), phase: 'summary', rest: null, timed: null };
}

/** Запуск таймера упражнения. prepSec секунд на «приготовьтесь», затем отсчёт draft.seconds. */
export function startTimed(active, now, prepSec = 0) {
  const a = clone(active);
  const startedAt = now + prepSec * 1000;
  a.timed = { startedAt, endsAt: startedAt + a.draft.seconds * 1000 };
  return a;
}

/** Остановить таймер раньше времени: в подход записывается фактическое время. */
export function stopTimed(active, now) {
  const a = clone(active);
  // Пока идёт отсчёт «приготовьтесь» (now < startedAt), время подхода не меняется.
  if (a.timed && now >= a.timed.startedAt) {
    a.draft.seconds = Math.max(1, Math.round((Math.min(now, a.timed.endsAt) - a.timed.startedAt) / 1000));
  }
  a.timed = null;
  return a;
}
