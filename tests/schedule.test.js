import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, diffDays, weekday, parseISO } from '../js/logic/dates.js';
import { expandProgram } from '../js/logic/program.js';
import {
  createSchedule,
  moveOne,
  shiftFrom,
  skip,
  markDone,
  completeSession,
  undoLast,
  nextPlanned,
  overdueSessions,
} from '../js/logic/schedule.js';

const program = {
  version: 1,
  templates: { A: {}, B: {}, C: {} },
  phases: [
    {
      id: 'p1',
      blocks: [
        { id: 'b1', weeks: 2, perWeek: 2, rotation: ['A', 'B'] },
        { id: 'b2', weeks: 2, perWeek: 3, rotation: ['A', 'B', 'C'] },
      ],
    },
  ],
};

// 23 ноября 2026 понедельник
const START = '2026-11-23';
const make = () => createSchedule(expandProgram(program), { startDate: START, weekdays: [1, 3, 5] });
const dates = (state) => state.sessions.map((s) => s.date);

test('даты: сложение, разность, день недели', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(diffDays('2026-11-23', '2026-12-04'), 11);
  assert.equal(weekday('2026-11-23'), 1);
  assert.equal(weekday('2026-11-22'), 7);
  assert.throws(() => parseISO('2026-02-30'));
  assert.throws(() => parseISO('вчера'));
});

test('расписание: первые недели по 2 тренировки, затем по 3', () => {
  const state = make();
  assert.deepEqual(dates(state), [
    '2026-11-23', '2026-11-25', // неделя 1: пн, ср
    '2026-11-30', '2026-12-02', // неделя 2: пн, ср
    '2026-12-04', '2026-12-07', '2026-12-09', // 3 раза в неделю
    '2026-12-11', '2026-12-14', '2026-12-16',
  ]);
  assert.ok(state.sessions.every((s) => s.status === 'planned'));
});

test('расписание: старт в середине недели ждёт ближайшего подходящего дня', () => {
  const state = createSchedule(expandProgram(program), { startDate: '2026-11-26', weekdays: [1, 3, 5] });
  assert.equal(state.sessions[0].date, '2026-11-30');
});

test('расписание: нужен хотя бы один день недели', () => {
  assert.throws(() => createSchedule(expandProgram(program), { startDate: START, weekdays: [] }));
});

test('перенос одной тренировки не трогает остальные', () => {
  const state = make();
  const r = moveOne(state, 2, '2026-11-26');
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.state.sessions[1].date, '2026-11-26');
  assert.deepEqual(dates(r.state).filter((_, i) => i !== 1), dates(state).filter((_, i) => i !== 1));
  // исходное состояние не изменилось
  assert.equal(state.sessions[1].date, '2026-11-25');
});

test('перенос одной тренировки: нельзя перепрыгнуть соседние', () => {
  const state = make();
  const before = moveOne(state, 2, '2026-11-22');
  assert.deepEqual([before.ok, before.reason, before.limit], [false, 'before_previous', '2026-11-23']);
  const after = moveOne(state, 2, '2026-12-01');
  assert.deepEqual([after.ok, after.reason, after.limit], [false, 'after_next', '2026-11-30']);
});

test('перенос одной тренировки: совпадение дат даёт предупреждение', () => {
  const r = moveOne(make(), 2, '2026-11-30');
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings, [{ type: 'same_day', with: 3 }]);
});

test('перенос в прошлое запрещён', () => {
  const r = moveOne(make(), 2, '2026-11-26', { today: '2026-11-27' });
  assert.deepEqual([r.ok, r.reason], [false, 'in_past']);
});

test('сдвиг всего плана: эта и все следующие', () => {
  const state = make();
  const r = shiftFrom(state, 3, '2026-12-01');
  assert.equal(r.ok, true);
  const expected = dates(state).map((d, i) => (i >= 2 ? addDays(d, 1) : d));
  assert.deepEqual(dates(r.state), expected);
});

test('сдвиг назад не может зайти за предыдущую тренировку', () => {
  const state = make();
  const bad = shiftFrom(state, 3, '2026-11-24');
  assert.deepEqual([bad.ok, bad.reason], [false, 'before_previous']);
  const good = shiftFrom(state, 3, '2026-11-26');
  assert.equal(good.ok, true);
  assert.equal(good.state.sessions[2].date, '2026-11-26');
});

test('сдвиг на ту же дату ничего не меняет', () => {
  const state = make();
  const r = shiftFrom(state, 3, '2026-11-30');
  assert.equal(r.ok, true);
  assert.equal(r.state, state);
});

test('пропуск не сдвигает план и виден в статусе', () => {
  const state = make();
  const r = skip(state, 2);
  assert.equal(r.ok, true);
  assert.equal(r.state.sessions[1].status, 'skipped');
  assert.deepEqual(dates(r.state), dates(state));
  assert.equal(nextPlanned(r.state).number, 1);
});

test('после пропуска соседние тренировки считаются относительно непропущенных', () => {
  const skipped = skip(make(), 2).state;
  // тренировка 3 может встать раньше даты пропущенной тренировки 2
  const r = moveOne(skipped, 3, '2026-11-24');
  assert.equal(r.ok, true);
});

test('отмена последнего переноса и пропуска', () => {
  const state = make();
  const moved = moveOne(state, 2, '2026-11-26').state;
  const undone = undoLast(moved);
  assert.equal(undone.ok, true);
  assert.deepEqual(dates(undone.state), dates(state));
  assert.equal(undone.state.lastChange, null);

  const skipped = skip(state, 4).state;
  assert.equal(undoLast(skipped).state.sessions[3].status, 'planned');

  assert.equal(undoLast(state).ok, false);
});

test('выполненная тренировка: нельзя переносить, отмена сбрасывается', () => {
  const moved = moveOne(make(), 2, '2026-11-26').state;
  const done = markDone(moved, 1, '2026-11-23');
  assert.equal(done.ok, true);
  assert.equal(done.state.lastChange, null);
  assert.equal(done.state.sessions[0].status, 'done');
  assert.equal(moveOne(done.state, 1, '2026-11-24').reason, 'not_planned');
  assert.equal(skip(done.state, 1).reason, 'not_planned');
  assert.equal(nextPlanned(done.state).number, 2);
});

test('просроченные тренировки', () => {
  const state = make();
  assert.deepEqual(overdueSessions(state, '2026-11-26').map((s) => s.number), [1, 2]);
  assert.deepEqual(overdueSessions(state, '2026-11-23'), []);
});

test('несуществующая тренировка', () => {
  const state = make();
  assert.equal(moveOne(state, 99, '2026-12-01').reason, 'not_found');
  assert.equal(shiftFrom(state, 99, '2026-12-01').reason, 'not_found');
  assert.equal(skip(state, 99).reason, 'not_found');
});

test('выполнение с опозданием: следующая тренировка и все следующие сдвигаются вперёд', () => {
  const state = make();
  // тренировку №1 (пн 23.11) сделали только в пятницу 27.11, а №2 стояла на ср 25.11
  const r = completeSession(state, 1, '2026-11-27');
  assert.equal(r.ok, true);
  assert.equal(r.state.sessions[0].status, 'done');
  assert.equal(r.state.sessions[1].date, '2026-11-28'); // следующий день
  const delta = diffDays(state.sessions[1].date, r.state.sessions[1].date);
  assert.equal(r.state.sessions[2].date, addDays(state.sessions[2].date, delta)); // интервалы сохранены
  assert.equal(r.state.lastChange, null);
});

test('выполнение вовремя или раньше срока план не сдвигает', () => {
  const state = make();
  const r = completeSession(state, 1, '2026-11-23');
  assert.deepEqual(dates(r.state), dates(state));
  const early = completeSession(state, 1, '2026-11-20');
  assert.deepEqual(dates(early.state), dates(state));
});

test('после долгого перерыва план перекатывается вперёд от дня выполнения', () => {
  const state = make();
  const r = completeSession(state, 1, '2026-12-20');
  assert.equal(r.state.sessions[1].date, '2026-12-21');
  assert.ok(r.state.sessions.slice(1).every((s, i, arr) => i === 0 || s.date > arr[i - 1].date));
});
