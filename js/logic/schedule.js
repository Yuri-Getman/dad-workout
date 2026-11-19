// Расписание: даты тренировок поверх порядка программы.
//
// Состояние: { sessions: [{ number, date, status, doneDate? }], lastChange }
//   status: 'planned' | 'done' | 'skipped'
// Все функции чистые: возвращают новое состояние, старое не меняют.
// Прогрессия привязана к номеру тренировки, поэтому переносы её не ломают.

import { addDays, diffDays, weekday } from './dates.js';

function normalizeWeekdays(weekdays) {
  const list = [...new Set(weekdays)].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7).sort((a, b) => a - b);
  if (!list.length) throw new Error('Выберите хотя бы один день недели');
  return list;
}

/**
 * Первое расписание.
 * programSessions: результат expandProgram().
 * weekdays: выбранные дни недели (1 = понедельник ... 7 = воскресенье).
 * В неделях, где тренировок меньше, чем выбрано дней, используются первые по порядку дни.
 */
export function createSchedule(programSessions, { startDate, weekdays }) {
  return { sessions: assignDates(programSessions, startDate, normalizeWeekdays(weekdays)), lastChange: null };
}

// Каждая тренировка ставится на ближайший разрешённый день начиная с cursor.
function assignDates(programSessions, startDate, days) {
  const sessions = [];
  let cursor = startDate;
  for (const s of programSessions) {
    const allowed = days.slice(0, Math.min(s.perWeek, days.length));
    while (!allowed.includes(weekday(cursor))) cursor = addDays(cursor, 1);
    sessions.push({ number: s.number, date: cursor, status: 'planned' });
    cursor = addDays(cursor, 1);
  }
  return sessions;
}

/**
 * Достраивает расписание, если в программу добавили тренировки (например, новые фазы).
 * Новые тренировки встают после последней существующей, но не раньше fromDate.
 */
export function extendSchedule(state, programSessions, { weekdays, fromDate }) {
  const days = normalizeWeekdays(weekdays);
  const lastNumber = state.sessions.reduce((m, s) => Math.max(m, s.number), 0);
  const fresh = programSessions.filter((s) => s.number > lastNumber);
  if (!fresh.length) return state;
  const lastDate = state.sessions.reduce((m, s) => (effectiveDate(s) > m ? effectiveDate(s) : m), '');
  const afterLast = lastDate ? addDays(lastDate, 1) : fromDate;
  const start = afterLast > fromDate ? afterLast : fromDate;
  return { sessions: [...state.sessions, ...assignDates(fresh, start, days)], lastChange: null };
}

/**
 * Пересчитывает даты всех невыполненных тренировок, например, при смене дней недели.
 * Выполненные и пропущенные остаются как есть.
 */
export function replan(state, programSessions, { weekdays, fromDate }) {
  const days = normalizeWeekdays(weekdays);
  const perWeek = new Map(programSessions.map((s) => [s.number, s]));
  const planned = state.sessions.filter((s) => s.status === 'planned' && perWeek.has(s.number));
  const fresh = new Map(assignDates(planned.map((s) => perWeek.get(s.number)), fromDate, days).map((s) => [s.number, s.date]));
  return {
    sessions: state.sessions.map((s) => (fresh.has(s.number) ? { ...s, date: fresh.get(s.number) } : s)),
    lastChange: null,
  };
}

const effectiveDate = (s) => s.doneDate ?? s.date;
const isCounted = (s) => s.status !== 'skipped';

function find(state, number) {
  return state.sessions.find((s) => s.number === number);
}

/** Ближайшая тренировка, которую ещё предстоит сделать. */
export function nextPlanned(state) {
  return state.sessions.find((s) => s.status === 'planned') ?? null;
}

/** Запланированные тренировки, дата которых уже прошла. */
export function overdueSessions(state, today) {
  return state.sessions.filter((s) => s.status === 'planned' && s.date < today);
}

function change(sessions, lastChange) {
  return { sessions, lastChange };
}

/**
 * Перенести только одну тренировку.
 * Нельзя перепрыгнуть через соседние тренировки (порядок программы сохраняется).
 * Результат: { ok: true, state, warnings } или { ok: false, reason, limit? }.
 * reason: 'not_found' | 'not_planned' | 'in_past' | 'before_previous' | 'after_next'
 */
export function moveOne(state, number, newDate, { today } = {}) {
  const target = find(state, number);
  if (!target) return { ok: false, reason: 'not_found' };
  if (target.status !== 'planned') return { ok: false, reason: 'not_planned' };
  if (today && newDate < today) return { ok: false, reason: 'in_past', limit: today };

  const prev = [...state.sessions].reverse().find((s) => s.number < number && isCounted(s));
  const next = state.sessions.find((s) => s.number > number && isCounted(s));
  if (prev && newDate < effectiveDate(prev)) return { ok: false, reason: 'before_previous', limit: effectiveDate(prev) };
  if (next && newDate > effectiveDate(next)) return { ok: false, reason: 'after_next', limit: effectiveDate(next) };

  const warnings = state.sessions
    .filter((s) => s.number !== number && isCounted(s) && effectiveDate(s) === newDate)
    .map((s) => ({ type: 'same_day', with: s.number }));

  const sessions = state.sessions.map((s) => (s.number === number ? { ...s, date: newDate } : s));
  return {
    ok: true,
    warnings,
    state: change(sessions, { type: 'move_one', number, from: target.date, to: newDate, before: state.sessions }),
  };
}

/**
 * Перенести эту тренировку и все следующие невыполненные на одно и то же число дней.
 * Результат такой же, как у moveOne, без предупреждений о совпадении дат.
 */
export function shiftFrom(state, number, newDate, { today } = {}) {
  const target = find(state, number);
  if (!target) return { ok: false, reason: 'not_found' };
  if (target.status !== 'planned') return { ok: false, reason: 'not_planned' };
  if (today && newDate < today) return { ok: false, reason: 'in_past', limit: today };

  const delta = diffDays(target.date, newDate);
  if (delta === 0) return { ok: true, warnings: [], state };

  const prev = [...state.sessions].reverse().find((s) => s.number < number && isCounted(s));
  if (prev && newDate < effectiveDate(prev)) return { ok: false, reason: 'before_previous', limit: effectiveDate(prev) };

  const sessions = state.sessions.map((s) =>
    s.number >= number && s.status === 'planned' ? { ...s, date: addDays(s.date, delta) } : s
  );
  return {
    ok: true,
    warnings: [],
    state: change(sessions, { type: 'shift_from', number, from: target.date, to: newDate, days: delta, before: state.sessions }),
  };
}

/** Пропустить тренировку. Остальной план не сдвигается. */
export function skip(state, number) {
  const target = find(state, number);
  if (!target) return { ok: false, reason: 'not_found' };
  if (target.status !== 'planned') return { ok: false, reason: 'not_planned' };
  const sessions = state.sessions.map((s) => (s.number === number ? { ...s, status: 'skipped' } : s));
  return { ok: true, warnings: [], state: change(sessions, { type: 'skip', number, before: state.sessions }) };
}

/** Отметить тренировку выполненной. После этого отмена последнего переноса недоступна. */
export function markDone(state, number, doneDate) {
  const target = find(state, number);
  if (!target) return { ok: false, reason: 'not_found' };
  if (target.status !== 'planned') return { ok: false, reason: 'not_planned' };
  const sessions = state.sessions.map((s) => (s.number === number ? { ...s, status: 'done', doneDate } : s));
  return { ok: true, warnings: [], state: { sessions, lastChange: null } };
}

/**
 * Тренировка выполнена. Если следующая запланированная тренировка оказалась на эту дату или раньше
 * (выполнили с опозданием), она и все следующие сдвигаются так, чтобы следующая была на следующий день.
 */
export function completeSession(state, number, doneDate) {
  const done = markDone(state, number, doneDate);
  if (!done.ok) return done;
  const next = done.state.sessions.find((s) => s.status === 'planned' && s.number > number);
  if (next && next.date <= doneDate) {
    const shifted = shiftFrom(done.state, next.number, addDays(doneDate, 1));
    if (shifted.ok) return { ok: true, warnings: [], state: { sessions: shifted.state.sessions, lastChange: null } };
  }
  return done;
}

/** Отменить последний перенос или пропуск. */
export function undoLast(state) {
  if (!state.lastChange) return { ok: false, reason: 'nothing_to_undo' };
  return { ok: true, warnings: [], state: { sessions: state.lastChange.before, lastChange: null } };
}
