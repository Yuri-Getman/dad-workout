import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expandProgram } from '../js/logic/program.js';
import {
  initialStates,
  buildWorkout,
  summarizeWorkout,
  finalizeStates,
  describeSuggestion,
  lastPerformance,
  estimateMinutes,
} from '../js/logic/workout.js';
import {
  startActive,
  completeSet,
  currentItem,
  setDraft,
  skipItem,
  endRest,
  addRest,
  progress,
  finishEarly,
  startTimed,
  stopTimed,
} from '../js/logic/flow.js';

const program = JSON.parse(readFileSync(new URL('../data/program.json', import.meta.url), 'utf8'));
const lib = JSON.parse(readFileSync(new URL('../data/exercises.json', import.meta.url), 'utf8'));
const sessions = expandProgram(program);
const dumbbells = { type: 'adjustable', min: 2, max: 24, step: 2 };
const T0 = 1_000_000;

const states0 = () => initialStates(program, lib, { pushups: 15, pullups: 10 });

function ctx(extra = {}) {
  return { now: T0, restScale: 1, workouts: [], dumbbells, ...extra };
}

test('стартовые состояния по тесту: 15 отжиманий и 10 подтягиваний', () => {
  const s = states0();
  assert.equal(s.pushup.variantIndex, 1); // 12-19 повторов: начинаем с медленного опускания
  assert.equal(s.pullup.variantIndex, 1); // 5 и больше: обычные подтягивания
  assert.equal(s.floor_press.weight, null); // вес гантелей подберём на первой тренировке
  assert.equal(s.plank.targetSeconds, 30);
  assert.equal(s.side_plank.targetSeconds, 20);
  const weak = initialStates(program, lib, { pushups: 4, pullups: 1 });
  assert.equal(weak.pushup.variantIndex, 0);
  assert.equal(weak.pullup.variantIndex, 0);
  assert.equal(initialStates(program, lib, {}).pushup.variantIndex, 0);
});

test('тренировка №1: подходов на один меньше, жим требует подбора веса', () => {
  const w = buildWorkout({ program, lib, session: sessions[0], states: states0(), dumbbells });
  assert.equal(w.templateId, 'A');
  const main = w.items.filter((i) => i.section === 'main');
  assert.deepEqual(main.map((i) => i.sets), [2, 2, 2, 2]);
  const press = main.find((i) => i.exerciseId === 'floor_press');
  assert.equal(press.needsCalibration, true);
  const pushup = main.find((i) => i.exerciseId === 'pushup');
  assert.equal(pushup.variantId, 'pushup_tempo');
  assert.equal(pushup.name, 'Отжимания с медленным опусканием');
  const pull = main.find((i) => i.exerciseId === 'pullup');
  assert.equal(pull.weight, 0);
  assert.equal(w.items.filter((i) => i.section === 'warmup').length, 4);
  assert.equal(w.items.filter((i) => i.section === 'cooldown').length, 2);
});

test('разгрузочная неделя: меньше подходов и вес', () => {
  const deload = sessions.find((s) => s.isDeload && s.templateId === 'C');
  const states = { ...states0(), floor_press: { ...states0().floor_press, weight: 12 } };
  const w = buildWorkout({ program, lib, session: deload, states, dumbbells });
  const press = w.items.find((i) => i.exerciseId === 'floor_press');
  assert.equal(press.eased, true);
  assert.equal(press.sets, 2);
  assert.ok(press.weight < 12);
  assert.equal(w.isDeload, true);
});

test('перерыв облегчает тренировку сильнее разгрузочной недели', () => {
  const normal = sessions.find((s) => !s.isDeload && s.templateId === 'A' && s.setsDelta === 0);
  const states = { ...states0(), floor_press: { ...states0().floor_press, weight: 20 } };
  const w = buildWorkout({ program, lib, session: normal, states, dumbbells, easeFactor: 0.8 });
  assert.equal(w.easeFactor, 0.8);
  assert.equal(w.items.find((i) => i.exerciseId === 'floor_press').weight, 16);
});

function playAll(active, { repsFor = (it) => it.repRange?.[1] ?? it.reps, weightFor, now = T0 } = {}) {
  let a = active;
  let guard = 0;
  while (a.phase !== 'summary' && guard++ < 500) {
    if (a.phase === 'rest') {
      a = endRest(a);
      continue;
    }
    const it = currentItem(a);
    const patch = it.kind === 'time' ? { seconds: it.seconds } : { reps: repsFor(it) };
    if (weightFor && it.load !== 'bodyweight') patch.weight = weightFor(it);
    a = setDraft(a, patch);
    a = completeSet(a, ctx({ now })).active;
  }
  return a;
}

test('ход тренировки: прохождение до итогов, подходы записываются', () => {
  const w = buildWorkout({ program, lib, session: sessions[0], states: states0(), dumbbells });
  let a = startActive(w, { date: '2026-11-23', now: T0, workouts: [], dumbbells });
  assert.equal(a.phase, 'work');
  assert.equal(currentItem(a).section, 'warmup');
  a = playAll(a, { weightFor: () => 8 });
  assert.equal(a.phase, 'summary');
  assert.deepEqual(progress(a), { done: 8, total: 8 });
  const press = a.items.find((i) => i.exerciseId === 'floor_press');
  assert.equal(press.logged.length, 2);
  assert.deepEqual(press.logged[0], { reps: 12, weight: 8 });
  assert.equal(press.logged[1].reps, 12);
});

test('отдых начинается после подхода основной части, но не после разминки', () => {
  const w = buildWorkout({ program, lib, session: sessions[0], states: states0(), dumbbells });
  let a = startActive(w, { date: '2026-11-23', now: T0, workouts: [], dumbbells });
  a = completeSet(setDraft(a, { reps: 10 }), ctx()).active;
  assert.equal(a.phase, 'work'); // разминка без отдыха
  while (currentItem(a).section === 'warmup') a = completeSet(a, ctx()).active;
  assert.equal(currentItem(a).exerciseId, 'floor_press');
  a = completeSet(setDraft(a, { reps: 10, weight: 8, reserve: 'medium' }), ctx({ now: T0 })).active;
  assert.equal(a.phase, 'rest');
  assert.equal(a.rest.total, 90);
  assert.equal(a.rest.endsAt, T0 + 90_000);
  assert.equal(addRest(a, 30).rest.endsAt, T0 + 120_000);
  assert.equal(endRest(a).phase, 'work');
  // темп отдыха можно изменить
  const scaled = completeSet(setDraft(endRest(a), { reps: 10, weight: 8 }), ctx({ now: T0, restScale: 1.5 })).active;
  assert.equal(scaled.rest.total, 135); // отдых после последнего подхода упражнения тоже масштабируется: 90 × 1,5
});

test('подбор веса: после первого подхода вес пересчитывается в рабочий', () => {
  const w = buildWorkout({ program, lib, session: sessions[0], states: states0(), dumbbells });
  let a = startActive(w, { date: '2026-11-23', now: T0, workouts: [], dumbbells });
  while (currentItem(a).section === 'warmup') a = completeSet(a, ctx()).active;
  const press = () => currentItem(a);
  assert.equal(press().needsCalibration, true);
  // 12 кг на 10 повторов «средне» (запас 2): рабочий вес для 10 повторов с запасом 2 тот же
  a = setDraft(a, { reps: 10, weight: 12, reserve: 'medium' });
  const r = completeSet(a, ctx());
  assert.deepEqual(r.stateUpdate, { exerciseId: 'floor_press', weight: 12 });
  a = r.active;
  const item = a.items.find((i) => i.exerciseId === 'floor_press');
  assert.equal(item.needsCalibration, false);
  assert.equal(item.weight, 12);
  assert.equal(currentItem(a).exerciseId, 'floor_press'); // второй подход того же упражнения
  assert.equal(a.draft.weight, 12);
});

test('упражнение на время: таймер и фактическое время', () => {
  const w = buildWorkout({ program, lib, session: sessions[1], states: states0(), dumbbells }); // шаблон B
  let a = startActive(w, { date: '2026-11-25', now: T0, workouts: [], dumbbells });
  while (currentItem(a).exerciseId !== 'plank') {
    a = a.phase === 'rest' ? endRest(a) : completeSet(setDraft(a, { reps: 10, weight: 8, reserve: 'medium' }), ctx()).active;
  }
  assert.equal(currentItem(a).kind, 'time');
  assert.equal(a.draft.seconds, 30);
  a = startTimed(a, T0);
  assert.equal(a.timed.endsAt, T0 + 30_000);
  const stopped = stopTimed(a, T0 + 22_400);
  assert.equal(stopped.draft.seconds, 22);
  assert.equal(stopped.timed, null);
  const finished = stopTimed(a, T0 + 99_000); // позже конца: записывается цель
  assert.equal(finished.draft.seconds, 30);
});

test('пропуск упражнения и досрочное завершение', () => {
  const w = buildWorkout({ program, lib, session: sessions[0], states: states0(), dumbbells });
  let a = startActive(w, { date: '2026-11-23', now: T0, workouts: [], dumbbells });
  while (currentItem(a).section === 'warmup') a = completeSet(a, ctx()).active;
  a = skipItem(a, ctx());
  assert.equal(currentItem(a).exerciseId, 'pushup');
  assert.equal(a.items.find((i) => i.exerciseId === 'floor_press').skipped, true);
  assert.equal(finishEarly(a).phase, 'summary');
});

test('итоги: предложение увеличить вес после верхней границы во всех подходах', () => {
  const states = { ...states0(), floor_press: { ...states0().floor_press, weight: 8 } };
  const w = buildWorkout({ program, lib, session: sessions[0], states, dumbbells });
  let a = startActive(w, { date: '2026-11-23', now: T0, workouts: [], dumbbells });
  a = playAll(a, { weightFor: (it) => it.weight });
  const { log, suggestions, failStreaks } = summarizeWorkout(a, { states, dumbbells, now: T0 + 2_400_000, today: '2026-11-23' });
  assert.equal(log.durationSec, 2400);
  assert.equal(log.items.length, 4);
  assert.equal(log.doneDate, '2026-11-23');
  const press = suggestions.find((s) => s.exerciseId === 'floor_press');
  assert.deepEqual(press.suggestion, { type: 'increase_weight', from: 8, to: 10 });
  assert.match(describeSuggestion(press, lib), /с 8 кг до 10 кг/);
  const pushup = suggestions.find((s) => s.exerciseId === 'pushup');
  assert.equal(pushup.suggestion.type, 'next_variant');
  assert.equal(failStreaks.floor_press, 0);

  // Принятое предложение меняет состояние, непринятое нет
  const accepted = finalizeStates(states, a, failStreaks, [press]);
  assert.equal(accepted.floor_press.weight, 10);
  assert.equal(accepted.pushup.variantIndex, states.pushup.variantIndex);
  assert.equal(states.floor_press.weight, 8); // исходные состояния не изменены
});

test('итоги: калибровочная тренировка не даёт лишних предложений по неподобранному весу', () => {
  const w = buildWorkout({ program, lib, session: sessions[0], states: states0(), dumbbells });
  let a = startActive(w, { date: '2026-11-23', now: T0, workouts: [], dumbbells });
  const stateUpdates = [];
  let guard = 0;
  while (a.phase !== 'summary' && guard++ < 200) {
    if (a.phase === 'rest') { a = endRest(a); continue; }
    const it = currentItem(a);
    a = setDraft(a, it.kind === 'time' ? { seconds: it.seconds } : { reps: 9, weight: 8, reserve: 'medium' });
    const r = completeSet(a, ctx());
    if (r.stateUpdate) stateUpdates.push(r.stateUpdate);
    a = r.active;
  }
  // вес подбирается у каждого упражнения с гантелями: в шаблоне A это жим и тяга
  assert.deepEqual(stateUpdates.map((u) => u.exerciseId), ['floor_press', 'one_arm_row']);
  const states = states0();
  for (const u of stateUpdates) states[u.exerciseId] = { ...states[u.exerciseId], weight: u.weight };
  const { suggestions } = summarizeWorkout(a, { states, dumbbells, now: T0 + 1000, today: '2026-11-23' });
  assert.ok(!suggestions.some((s) => s.suggestion.type === 'increase_weight'));
});

test('прошлый результат по упражнению', () => {
  const workouts = [
    { number: 1, doneDate: '2026-11-23', items: [{ variantId: 'pushup', sets: [{ reps: 10 }] }] },
    { number: 3, doneDate: '2026-11-30', items: [{ variantId: 'pushup', sets: [{ reps: 12 }] }] },
  ];
  assert.deepEqual(lastPerformance(workouts, 'pushup'), { date: '2026-11-30', number: 3, sets: [{ reps: 12 }] });
  assert.equal(lastPerformance(workouts, 'plank'), null);
});

test('оценка длительности тренировки около 35-40 минут', () => {
  const states = { ...states0(), floor_press: { ...states0().floor_press, weight: 8 }, one_arm_row: { ...states0().one_arm_row, weight: 8 } };
  const a = buildWorkout({ program, lib, session: sessions.find((s) => s.templateId === 'A' && s.setsDelta === 0), states, dumbbells });
  const b = buildWorkout({ program, lib, session: sessions.find((s) => s.templateId === 'B' && s.setsDelta === 0), states, dumbbells });
  for (const w of [a, b]) {
    const m = estimateMinutes(w);
    assert.ok(m >= 30 && m <= 45, `оценка ${m} мин вне диапазона 30-45`);
    assert.equal(m % 5, 0);
  }
});

test('таймер: во время «приготовьтесь» остановка не меняет время подхода', () => {
  const w = buildWorkout({ program, lib, session: sessions[1], states: states0(), dumbbells });
  let a = startActive(w, { date: '2026-11-25', now: T0, workouts: [], dumbbells });
  while (currentItem(a).exerciseId !== 'plank') {
    a = a.phase === 'rest' ? endRest(a) : completeSet(setDraft(a, { reps: 10, weight: 8, reserve: 'medium' }), ctx()).active;
  }
  a = startTimed(a, T0, 5);
  assert.equal(a.timed.startedAt, T0 + 5000);
  assert.equal(a.timed.endsAt, T0 + 35_000);
  assert.equal(stopTimed(a, T0 + 2000).draft.seconds, 30);
  assert.equal(stopTimed(a, T0 + 5000 + 12_000).draft.seconds, 12);
});
