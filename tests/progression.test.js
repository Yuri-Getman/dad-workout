import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  availableWeights,
  weightLadder,
  nextWeight,
  prevWeight,
  floorToAvailable,
} from '../js/logic/equipment.js';
import {
  initialState,
  prescribe,
  evaluateSession,
  applySuggestion,
  easeFactorAfterBreak,
  DELOAD_FACTOR,
} from '../js/logic/progression.js';
import { workingWeight, estimateOneRepMax, startIndexFromMax } from '../js/logic/calibration.js';
import { bmi, validateProfile } from '../js/logic/profile.js';

const fixed = { type: 'fixed', weights: [6, 10, 4, 8, 8] };
const adjustable = { type: 'adjustable', min: 2, max: 10, step: 2 };

const pushups = {
  id: 'pushup',
  kind: 'reps',
  sets: 3,
  repRange: [8, 12],
  load: 'bodyweight',
  ladder: ['pushup', 'pushup_tempo', 'pushup_feet_up'],
  restSec: 90,
};
const press = { id: 'floor_press', kind: 'reps', sets: 3, repRange: [8, 12], load: 'dumbbell', restSec: 90 };
const pullups = { id: 'pullup', kind: 'reps', sets: 3, repRange: [6, 10], load: 'weighted_bodyweight', restSec: 120 };
const plank = { id: 'plank', kind: 'time', sets: 3, timeRange: { start: 30, step: 5, max: 45 }, load: 'bodyweight', restSec: 60 };

const reps = (...r) => r.map((n) => ({ reps: n }));
const secs = (...s) => s.map((n) => ({ seconds: n }));

test('доступные веса: цельные и разборные гантели', () => {
  assert.deepEqual(availableWeights(fixed), [4, 6, 8, 10]);
  assert.deepEqual(availableWeights(adjustable), [2, 4, 6, 8, 10]);
  assert.deepEqual(availableWeights({ type: 'adjustable', min: 1.25, max: 5, step: 1.25 }), [1.25, 2.5, 3.75, 5]);
  assert.deepEqual(availableWeights(null), []);
  assert.deepEqual(availableWeights({ type: 'adjustable', min: 2, max: 10, step: 0 }), []);
});

test('лестница весов по типу нагрузки', () => {
  assert.deepEqual(weightLadder('bodyweight', fixed), [0]);
  assert.deepEqual(weightLadder('dumbbell', fixed), [4, 6, 8, 10]);
  assert.deepEqual(weightLadder('weighted_bodyweight', fixed), [0, 4, 6, 8, 10]);
});

test('следующий, предыдущий и округляемый вес', () => {
  const list = [4, 6, 8, 10];
  assert.equal(nextWeight(6, list), 8);
  assert.equal(nextWeight(10, list), null);
  assert.equal(prevWeight(6, list), 4);
  assert.equal(prevWeight(4, list), null);
  assert.equal(floorToAvailable(7.9, list), 6);
  assert.equal(floorToAvailable(2, list), 4); // меньше минимума: берём самый лёгкий
});

test('все подходы на верхней границе: вес растёт', () => {
  const state = initialState(press, { weight: 8 });
  const r = evaluateSession(press, state, [{ reps: 12, weight: 8 }, { reps: 12, weight: 8 }, { reps: 12, weight: 8 }], fixed);
  assert.deepEqual(r.suggestion, { type: 'increase_weight', from: 8, to: 10 });
  assert.equal(r.failStreak, 0);
  assert.equal(applySuggestion(state, r.suggestion).weight, 10);
});

test('верх достигнут, а тяжелее гантелей нет', () => {
  const state = initialState(press, { weight: 10 });
  const r = evaluateSession(press, state, reps(12, 12, 12), fixed);
  assert.deepEqual(r.suggestion, { type: 'hold', reason: 'no_heavier_weight' });
});

test('вес берётся по самому лёгкому подходу', () => {
  const state = initialState(press, { weight: 8 });
  const r = evaluateSession(press, state, [{ reps: 12, weight: 6 }, { reps: 12, weight: 8 }, { reps: 12, weight: 8 }], fixed);
  assert.deepEqual(r.suggestion, { type: 'increase_weight', from: 6, to: 8 });
});

test('отжимания: лестница усложнений', () => {
  let state = initialState(pushups, { variantIndex: 0 });
  const r = evaluateSession(pushups, state, reps(12, 12, 13), null);
  assert.deepEqual(r.suggestion, { type: 'next_variant', fromId: 'pushup', toId: 'pushup_tempo', toIndex: 1 });
  state = applySuggestion(state, r.suggestion);
  assert.equal(prescribe(pushups, state, null).variantId, 'pushup_tempo');

  state = { ...state, variantIndex: 2 };
  const top = evaluateSession(pushups, state, reps(12, 12, 12), null);
  assert.deepEqual(top.suggestion, { type: 'hold', reason: 'top_reached' });
});

test('внутри диапазона: продолжаем набирать повторы', () => {
  const state = initialState(press, { weight: 8 });
  const r = evaluateSession(press, state, reps(10, 9, 8), fixed);
  assert.deepEqual(r.suggestion, { type: 'hold', reason: 'keep_building' });
  assert.equal(r.failStreak, 0);
});

test('не добрали нижнюю границу: сначала держим вес, со второго раза предлагаем облегчить', () => {
  let state = initialState(press, { weight: 8 });
  const first = evaluateSession(press, state, reps(8, 7, 6), fixed);
  assert.deepEqual(first.suggestion, { type: 'hold', reason: 'missed_reps' });
  assert.equal(first.failStreak, 1);

  state = { ...state, failStreak: first.failStreak };
  const second = evaluateSession(press, state, reps(8, 7, 6), fixed);
  assert.deepEqual(second.suggestion, { type: 'decrease_weight', from: 8, to: 6 });
  assert.equal(applySuggestion(state, second.suggestion).failStreak, 0);
});

test('неполная тренировка считается неудачной', () => {
  const state = initialState(press, { weight: 8 });
  const r = evaluateSession(press, state, reps(12, 12), fixed);
  assert.equal(r.failStreak, 1);
});

test('облегчение отжиманий: возврат на ступень ниже', () => {
  const state = { ...initialState(pushups, { variantIndex: 1 }), failStreak: 1 };
  const r = evaluateSession(pushups, state, reps(7, 6, 5), null);
  assert.deepEqual(r.suggestion, { type: 'previous_variant', fromId: 'pushup_tempo', toId: 'pushup', toIndex: 0 });
});

test('на первой ступени облегчать нечего', () => {
  const state = { ...initialState(pushups), failStreak: 5 };
  const r = evaluateSession(pushups, state, reps(3, 3, 3), null);
  assert.deepEqual(r.suggestion, { type: 'hold', reason: 'nothing_to_decrease' });
});

test('подтягивания: сначала свой вес, затем гантель', () => {
  const state = initialState(pullups);
  const r = evaluateSession(pullups, state, [{ reps: 10, weight: 0 }, { reps: 10, weight: 0 }, { reps: 10, weight: 0 }], fixed);
  assert.deepEqual(r.suggestion, { type: 'increase_weight', from: 0, to: 4 });
});

test('упражнения на время: +5 секунд до максимума', () => {
  let state = initialState(plank);
  assert.equal(state.targetSeconds, 30);
  const r = evaluateSession(plank, state, secs(30, 32, 30), null);
  assert.deepEqual(r.suggestion, { type: 'add_time', from: 30, to: 35 });
  state = applySuggestion(state, r.suggestion);
  assert.equal(state.targetSeconds, 35);

  state = { ...state, targetSeconds: 45 };
  assert.deepEqual(evaluateSession(plank, state, secs(45, 45, 45), null).suggestion, { type: 'hold', reason: 'top_reached' });
});

test('упражнения на время: недобор и облегчение', () => {
  let state = { ...initialState(plank), targetSeconds: 40 };
  const first = evaluateSession(plank, state, secs(40, 25, 20), null);
  assert.equal(first.failStreak, 1);
  state = { ...state, failStreak: 1 };
  const second = evaluateSession(plank, state, secs(40, 25, 20), null);
  assert.deepEqual(second.suggestion, { type: 'decrease_time', from: 40, to: 35 });
  // ниже стартового значения не опускаемся
  const atStart = { ...initialState(plank), failStreak: 3 };
  assert.deepEqual(evaluateSession(plank, atStart, secs(10, 10, 10), null).suggestion, { type: 'hold', reason: 'nothing_to_decrease' });
});

test('облегчённая тренировка не влияет на прогрессию', () => {
  const state = { ...initialState(press, { weight: 8 }), failStreak: 1 };
  const r = evaluateSession(press, state, reps(12, 12, 12), fixed, { eased: true });
  assert.deepEqual(r.suggestion, { type: 'hold', reason: 'eased_session' });
  assert.equal(r.failStreak, 1);
});

test('назначение тренировки: обычная и облегчённая', () => {
  const state = initialState(press, { weight: 10 });
  const normal = prescribe(press, state, fixed);
  assert.deepEqual(
    [normal.sets, normal.weight, normal.repRange, normal.eased, normal.variantId],
    [3, 10, [8, 12], false, 'floor_press']
  );
  const deload = prescribe(press, state, fixed, { easeFactor: DELOAD_FACTOR });
  assert.deepEqual([deload.sets, deload.weight, deload.eased], [2, 8, true]); // 8.5 кг -> ближайший доступный не больше

  const time = prescribe(plank, { ...initialState(plank), targetSeconds: 40 }, null, { easeFactor: 0.8 });
  assert.equal(time.seconds, 30);
  assert.equal(time.kind, 'time');
});

test('назначение для подтягиваний: вес 0 и ступени отжиманий', () => {
  assert.equal(prescribe(pullups, initialState(pullups), fixed).weight, 0);
  assert.equal(prescribe(pushups, initialState(pushups, { variantIndex: 2 }), null).variantId, 'pushup_feet_up');
});

test('облегчение после перерыва', () => {
  assert.equal(easeFactorAfterBreak(0), 1);
  assert.equal(easeFactorAfterBreak(13), 1);
  assert.equal(easeFactorAfterBreak(14), 0.9);
  assert.equal(easeFactorAfterBreak(27), 0.9);
  assert.equal(easeFactorAfterBreak(28), 0.8);
  assert.equal(easeFactorAfterBreak(90), 0.8);
});

test('калибровка: тот же подход возвращает тот же вес', () => {
  const list = availableWeights({ type: 'adjustable', min: 2, max: 30, step: 2 });
  // 20 кг на 10 повторов с запасом 2: цель 10 повторов с запасом 2 = тот же вес
  assert.equal(workingWeight({ weight: 20, reps: 10, rir: 2 }, 10, list), 20);
});

test('калибровка: подбирает вес по доступным гантелям и не уходит ниже минимума', () => {
  const list = [4, 6, 8, 10];
  const w = workingWeight({ weight: 10, reps: 15, rir: 0 }, 10, list);
  assert.equal(w, 10); // оценка выше доступного максимума, берём максимум не выше расчёта
  assert.equal(workingWeight({ weight: 4, reps: 3, rir: 0 }, 10, list), 4);
  assert.throws(() => workingWeight({ weight: 0, reps: 10 }, 10, list));
  assert.ok(estimateOneRepMax(20, 10) > 20);
});

test('калибровка: стартовая ступень по максимуму повторов', () => {
  const thresholds = [0, 12, 20];
  assert.equal(startIndexFromMax(5, thresholds), 0);
  assert.equal(startIndexFromMax(11, thresholds), 0);
  assert.equal(startIndexFromMax(15, thresholds), 1);
  assert.equal(startIndexFromMax(25, thresholds), 2);
});

test('профиль: ИМТ и проверка ввода', () => {
  assert.equal(bmi(84, 192), 22.8);
  assert.deepEqual(validateProfile({ age: 50, heightCm: 192, weightKg: 84 }), []);
  assert.equal(validateProfile({ age: 5, heightCm: 10, weightKg: 1 }).length, 3);
  assert.equal(validateProfile({ age: NaN, heightCm: 192, weightKg: 84 }).length, 1);
});
