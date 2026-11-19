import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  weekStart,
  setVolume,
  workoutVolume,
  workoutsPerWeek,
  volumePerWeek,
  weekStreak,
  personalRecords,
  exerciseSeries,
  trackedExercises,
  summary,
  bodySeries,
  bodyChange,
} from '../js/logic/stats.js';
import { buildBackup, parseBackup, BACKUP_VERSION } from '../js/logic/backup.js';
import { formatDate, pluralRu, mmss, formatKg, formatDuration, formatSet } from '../js/logic/format.js';

const press = (reps, weight) => ({ exerciseId: 'floor_press', variantId: 'floor_press', name: 'Жим', kind: 'reps', sets: reps.map((r) => ({ reps: r, weight })) });
const plank = (secs) => ({ exerciseId: 'plank', variantId: 'plank', name: 'Планка', kind: 'time', sets: secs.map((s) => ({ seconds: s })) });
const pushup = (reps) => ({ exerciseId: 'pushup', variantId: 'pushup', name: 'Отжимания', kind: 'reps', sets: reps.map((r) => ({ reps: r })) });

const workouts = [
  { number: 1, doneDate: '2026-11-23', durationSec: 2400, items: [press([10, 10], 8), pushup([12, 10])] },
  { number: 2, doneDate: '2026-11-25', durationSec: 2500, items: [plank([30, 30])] },
  { number: 3, doneDate: '2026-11-30', durationSec: 2600, items: [press([12, 12], 8), pushup([13, 12])] },
  { number: 4, doneDate: '2026-12-02', durationSec: 2300, items: [press([9, 8], 10), plank([35])] },
];

test('начало недели: понедельник', () => {
  assert.equal(weekStart('2026-11-23'), '2026-11-23');
  assert.equal(weekStart('2026-11-29'), '2026-11-23');
  assert.equal(weekStart('2026-11-30'), '2026-11-30');
});

test('объём считается как вес × повторы, без веса объёма нет', () => {
  assert.equal(setVolume({ reps: 10, weight: 8 }), 80);
  assert.equal(setVolume({ reps: 10 }), 0);
  assert.equal(setVolume({ seconds: 30 }), 0);
  assert.equal(workoutVolume(workouts[0]), 160);
});

test('тренировки и объём по неделям', () => {
  const weeks = workoutsPerWeek(workouts, '2026-12-03', 3);
  assert.deepEqual(weeks.map((w) => [w.weekStart, w.count]), [['2026-11-16', 0], ['2026-11-23', 2], ['2026-11-30', 2]]);
  const vol = volumePerWeek(workouts, '2026-12-03', 2);
  assert.deepEqual(vol.map((w) => w.volume), [160, 192 + 170]);
});

test('серия недель', () => {
  assert.equal(weekStreak(workouts, '2026-12-03', 2), 2);
  // текущая неделя ещё не набрала норму: считаем от прошлой
  assert.equal(weekStreak(workouts, '2026-12-07', 2), 2);
  assert.equal(weekStreak(workouts, '2026-12-21', 2), 0);
  assert.equal(weekStreak([], '2026-12-03', 2), 0);
});

test('личные рекорды: сначала вес, затем повторы; время для упражнений на время', () => {
  const prs = personalRecords(workouts);
  const byId = Object.fromEntries(prs.map((p) => [p.variantId, p.best]));
  assert.deepEqual([byId.floor_press.weight, byId.floor_press.reps, byId.floor_press.date], [10, 9, '2026-12-02']);
  assert.deepEqual([byId.pushup.reps, byId.pushup.date], [13, '2026-11-30']);
  assert.deepEqual([byId.plank.seconds, byId.plank.date], [35, '2026-12-02']);
});

test('динамика по упражнению', () => {
  const s = exerciseSeries(workouts, 'pushup');
  assert.deepEqual(s.map((p) => [p.date, p.value]), [['2026-11-23', 12], ['2026-11-30', 13]]);
  assert.deepEqual(exerciseSeries(workouts, 'floor_press').map((p) => [p.value, p.weight]), [[10, 8], [12, 8], [9, 10]]);
  assert.deepEqual(exerciseSeries(workouts, 'нет'), []);
});

test('список упражнений с историей', () => {
  const list = trackedExercises(workouts);
  assert.equal(list[0].variantId, 'floor_press');
  assert.equal(list[0].sessions, 3);
});

test('сводка', () => {
  const s = summary(workouts, '2026-12-03');
  assert.equal(s.total, 4);
  assert.equal(s.last30, 4);
  assert.equal(s.totalDurationSec, 9800);
  assert.equal(s.weekStreak, 2);
  assert.equal(summary(workouts, '2027-03-01').last30, 0);
});

test('вес тела: последняя запись дня и изменение', () => {
  const log = [
    { date: '2026-11-23', weightKg: 84 },
    { date: '2026-12-07', weightKg: 83.1 },
    { date: '2026-12-07', weightKg: 83 },
  ];
  assert.deepEqual(bodySeries(log).map((e) => e.weightKg), [84, 83]);
  assert.equal(bodyChange(log).deltaKg, -1);
  assert.equal(bodyChange([log[0]]), null);
});

test('резервная копия: туда и обратно', () => {
  const data = { profile: { age: 50 }, settings: { theme: 'dark' }, schedule: { sessions: [], lastChange: null }, states: { a: 1 }, workouts, bodyLog: [], active: null };
  const text = buildBackup(data, new Date('2026-12-03T10:00:00Z'));
  const r = parseBackup(text);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.workouts, workouts);
  assert.deepEqual(r.data.profile, { age: 50 });
  assert.equal(JSON.parse(text).exportedAt, '2026-12-03T10:00:00.000Z');
});

test('резервная копия: плохие файлы отклоняются', () => {
  assert.equal(parseBackup('не json').ok, false);
  assert.equal(parseBackup('{"format":"другое"}').ok, false);
  assert.match(parseBackup(JSON.stringify({ format: 'dad-workout-backup', version: BACKUP_VERSION + 1 })).error, /новой версии/);
  assert.match(parseBackup(JSON.stringify({ format: 'dad-workout-backup', version: 1 })).error, /профиля или расписания/);
  assert.equal(parseBackup(JSON.stringify({ format: 'dad-workout-backup', version: 1, profile: {}, schedule: { sessions: [] }, workouts: 5 })).ok, false);
});

test('форматирование', () => {
  assert.equal(formatDate('2026-11-23'), 'пн, 23 ноября');
  assert.equal(pluralRu(1, 'тренировка', 'тренировки', 'тренировок'), 'тренировка');
  assert.equal(pluralRu(3, 'тренировка', 'тренировки', 'тренировок'), 'тренировки');
  assert.equal(pluralRu(11, 'тренировка', 'тренировки', 'тренировок'), 'тренировок');
  assert.equal(pluralRu(21, 'тренировка', 'тренировки', 'тренировок'), 'тренировка');
  assert.equal(mmss(90), '01:30');
  assert.equal(mmss(-5), '00:00');
  assert.equal(formatKg(8.5), '8,5 кг');
  assert.equal(formatDuration(2520), '42 мин');
  assert.equal(formatDuration(3900), '1 ч 05 мин');
  assert.equal(formatSet({ reps: 10, weight: 8 }, 'reps'), '10 × 8 кг');
  assert.equal(formatSet({ reps: 12 }, 'reps'), '12');
  assert.equal(formatSet({ seconds: 40 }, 'time'), '40 с');
});
