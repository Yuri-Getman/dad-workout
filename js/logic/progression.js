// Автоматическая прогрессия нагрузок.
//
// Описание упражнения в программе (spec):
//   {
//     id: 'pushup',
//     kind: 'reps' | 'time',
//     sets: 3,
//     repRange: [8, 12],                 для kind 'reps'
//     timeRange: { start: 30, step: 5, max: 90 },   для kind 'time' (max необязателен)
//     load: 'bodyweight' | 'dumbbell' | 'weighted_bodyweight',
//     ladder: ['pushup', 'pushup_tempo', ...],      необязательно: лестница усложнений
//     restSec: 90,
//   }
//
// Состояние упражнения (state), хранится в базе на телефоне:
//   { variantIndex, weight, targetSeconds?, failStreak }
//
// Приложение только ПРЕДЛАГАЕТ изменение (suggestion). Состояние меняется,
// когда отец соглашается: applySuggestion().

import { weightLadder, nextWeight, prevWeight, floorToAvailable } from './equipment.js';

/** Сколько тренировок подряд не добираем нижнюю границу, прежде чем предложить облегчение. */
export const FAIL_LIMIT = 2;
/** Для упражнений на время: подход короче этой доли цели считается неудачным. */
export const TIME_FAIL_RATIO = 0.8;
/** Во сколько раз облегчается разгрузочная неделя. */
export const DELOAD_FACTOR = 0.85;

const DEFAULT_TIME_STEP = 5;

export function initialState(spec, { variantIndex = 0, weight = 0, targetSeconds } = {}) {
  const state = { variantIndex, weight, failStreak: 0 };
  if (spec.kind === 'time') state.targetSeconds = targetSeconds ?? spec.timeRange.start;
  return state;
}

/** Что делать на тренировке: подходы, повторы или секунды, вес. */
export function prescribe(spec, state, dumbbells, { easeFactor = 1 } = {}) {
  const list = weightLadder(spec.load, dumbbells);
  const eased = easeFactor < 1;
  const sets = eased ? Math.max(1, spec.sets - 1) : spec.sets;
  let weight = state.weight;
  if (eased && weight > 0) weight = floorToAvailable(weight * easeFactor, list);

  const out = {
    exerciseId: spec.id,
    variantId: spec.ladder ? spec.ladder[state.variantIndex] : spec.id,
    kind: spec.kind,
    sets,
    weight,
    restSec: spec.restSec,
    eased,
  };
  if (spec.kind === 'time') {
    const step = spec.timeRange.step ?? DEFAULT_TIME_STEP;
    out.seconds = eased ? Math.max(step, Math.round((state.targetSeconds * easeFactor) / step) * step) : state.targetSeconds;
  } else {
    out.repRange = spec.repRange;
  }
  return out;
}

/**
 * Разбор выполненной тренировки.
 * performed: [{ reps?, seconds?, weight? }] по порядку подходов.
 * Возвращает { suggestion, failStreak }. failStreak нужно сохранить в состояние.
 * Для облегчённой тренировки (разгрузка, возвращение после перерыва) передайте eased: true,
 * тогда ничего не предлагается и счётчик неудач не меняется.
 */
export function evaluateSession(spec, state, performed, dumbbells, { eased = false } = {}) {
  if (eased) return { suggestion: { type: 'hold', reason: 'eased_session' }, failStreak: state.failStreak };

  const list = weightLadder(spec.load, dumbbells);
  const sets = performed.slice(0, spec.sets);
  const complete = sets.length >= spec.sets;

  let allTop;
  let failed;
  if (spec.kind === 'time') {
    const target = state.targetSeconds;
    allTop = complete && sets.every((s) => s.seconds >= target);
    failed = !complete || sets.some((s) => s.seconds < target * TIME_FAIL_RATIO);
  } else {
    const [lo, hi] = spec.repRange;
    allTop = complete && sets.every((s) => s.reps >= hi);
    failed = !complete || sets.some((s) => s.reps < lo);
  }

  // Какой вес реально использовался (самый лёгкий из подходов).
  const used = sets.map((s) => s.weight).filter((w) => typeof w === 'number');
  const refWeight = used.length ? Math.min(...used) : state.weight;

  if (allTop) return { suggestion: suggestUp(spec, state, refWeight, list), failStreak: 0 };
  if (failed) {
    const streak = state.failStreak + 1;
    const suggestion = streak >= FAIL_LIMIT ? suggestDown(spec, state, refWeight, list) : { type: 'hold', reason: 'missed_reps' };
    return { suggestion, failStreak: streak };
  }
  return { suggestion: { type: 'hold', reason: 'keep_building' }, failStreak: 0 };
}

function suggestUp(spec, state, refWeight, list) {
  if (spec.kind === 'time') {
    const step = spec.timeRange.step ?? DEFAULT_TIME_STEP;
    const to = state.targetSeconds + step;
    if (spec.timeRange.max && to > spec.timeRange.max) return { type: 'hold', reason: 'top_reached' };
    return { type: 'add_time', from: state.targetSeconds, to };
  }
  if (spec.ladder && state.variantIndex < spec.ladder.length - 1) {
    const toIndex = state.variantIndex + 1;
    return { type: 'next_variant', fromId: spec.ladder[state.variantIndex], toId: spec.ladder[toIndex], toIndex };
  }
  if (spec.load !== 'bodyweight') {
    const to = nextWeight(refWeight, list);
    if (to === null) return { type: 'hold', reason: 'no_heavier_weight' };
    return { type: 'increase_weight', from: refWeight, to };
  }
  return { type: 'hold', reason: 'top_reached' };
}

function suggestDown(spec, state, refWeight, list) {
  if (spec.kind === 'time') {
    const step = spec.timeRange.step ?? DEFAULT_TIME_STEP;
    const to = Math.max(spec.timeRange.start, state.targetSeconds - step);
    if (to < state.targetSeconds) return { type: 'decrease_time', from: state.targetSeconds, to };
    return { type: 'hold', reason: 'nothing_to_decrease' };
  }
  if (spec.load !== 'bodyweight') {
    const to = prevWeight(refWeight, list);
    if (to !== null) return { type: 'decrease_weight', from: refWeight, to };
  }
  if (spec.ladder && state.variantIndex > 0) {
    const toIndex = state.variantIndex - 1;
    return { type: 'previous_variant', fromId: spec.ladder[state.variantIndex], toId: spec.ladder[toIndex], toIndex };
  }
  return { type: 'hold', reason: 'nothing_to_decrease' };
}

/** Применить принятое предложение. Для 'hold' состояние не меняется. */
export function applySuggestion(state, suggestion) {
  switch (suggestion.type) {
    case 'increase_weight':
    case 'decrease_weight':
      return { ...state, weight: suggestion.to, failStreak: 0 };
    case 'next_variant':
    case 'previous_variant':
      return { ...state, variantIndex: suggestion.toIndex, failStreak: 0 };
    case 'add_time':
    case 'decrease_time':
      return { ...state, targetSeconds: suggestion.to, failStreak: 0 };
    default:
      return state;
  }
}

/**
 * Облегчение после перерыва.
 * До 14 дней без тренировок: без изменений. 14-27 дней: на 10% легче. 28 и больше: на 20% легче.
 * Возвращает коэффициент для prescribe({ easeFactor }).
 */
export function easeFactorAfterBreak(daysSinceLastWorkout) {
  if (daysSinceLastWorkout >= 28) return 0.8;
  if (daysSinceLastWorkout >= 14) return 0.9;
  return 1;
}
