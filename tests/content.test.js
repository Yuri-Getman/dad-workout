import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateProgram, validateContent, expandProgram } from '../js/logic/program.js';
import { createSchedule } from '../js/logic/schedule.js';

const program = JSON.parse(readFileSync(new URL('../data/program.json', import.meta.url), 'utf8'));
const lib = JSON.parse(readFileSync(new URL('../data/exercises.json', import.meta.url), 'utf8'));

test('программа из репозитория корректна', () => {
  assert.deepEqual(validateProgram(program), []);
});

test('шаблоны согласованы с библиотекой упражнений', () => {
  assert.deepEqual(validateContent(program, lib), []);
});

test('у каждого упражнения есть техника выполнения', () => {
  for (const [id, e] of Object.entries(lib.exercises)) {
    assert.ok(Array.isArray(e.tips) && e.tips.length >= 2, `у «${id}» мало подсказок по технике`);
  }
});

test('фаза 1: 2 + 4 + 4 × 5 недель, первые 2 недели по 2 тренировки', () => {
  const sessions = expandProgram(program);
  const weeks = new Set(sessions.map((s) => s.weekIndex)).size;
  assert.equal(weeks, 2 + 4 + 5 * 4);
  assert.equal(sessions.length, 2 * 2 + (4 + 5 * 4) * 3);
  assert.deepEqual(sessions.slice(0, 4).map((s) => s.templateId), ['A', 'B', 'A', 'B']);
  assert.ok(sessions.slice(0, 4).every((s) => s.setsDelta === -1 && s.perWeek === 2));
  assert.equal(sessions.filter((s) => s.isDeload).length, 5 * 3);
});

test('расписание на фазу 1 укладывается примерно в 6 месяцев', () => {
  const sessions = expandProgram(program);
  const state = createSchedule(sessions, { startDate: '2026-11-23', weekdays: [1, 3, 5] });
  const last = state.sessions[state.sessions.length - 1].date;
  assert.ok(last > '2027-04-30' && last < '2027-06-15', `последняя тренировка ${last}`);
});

test('проверка находит ошибки в содержимом', () => {
  const bad = structuredClone(program);
  bad.templates.A.main[0].ex = 'нет_такого';
  bad.templates.B.main[0].repRange = [12, 8];
  bad.templates.C.main[2].repRange = [6, 10]; // те же отжимания, что в шаблоне A, но другой диапазон
  const errors = validateContent(bad, lib).join('\n');
  assert.match(errors, /нет упражнения «нет_такого»/);
  assert.match(errors, /repRange/);
  assert.match(errors, /отличается от другого шаблона/);
});
