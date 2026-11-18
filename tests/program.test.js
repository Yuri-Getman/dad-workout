import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateProgram, expandProgram } from '../js/logic/program.js';

const good = () => ({
  version: 1,
  templates: { A: {}, B: {}, C: {} },
  phases: [
    {
      id: 'p1',
      blocks: [
        { id: 'b1', weeks: 3, perWeek: 2, rotation: ['A', 'B'], deloadWeeks: [3] },
        { id: 'b2', weeks: 2, perWeek: 3, rotation: ['A', 'B', 'C'] },
      ],
    },
  ],
});

test('корректная программа проходит проверку', () => {
  assert.deepEqual(validateProgram(good()), []);
});

test('проверка находит ошибки', () => {
  const p = good();
  p.phases[0].blocks[0].rotation = ['A', 'X'];
  p.phases[0].blocks[1].weeks = 0;
  p.phases[0].blocks[1].id = 'b1';
  const errors = validateProgram(p).join('\n');
  assert.match(errors, /нет шаблона «X»/);
  assert.match(errors, /weeks/);
  assert.match(errors, /повторяющийся id «b1»/);
  assert.ok(validateProgram({}).length > 0);
  assert.ok(validateProgram(null).length > 0);
});

test('облегчённая неделя вне блока', () => {
  const p = good();
  p.phases[0].blocks[0].deloadWeeks = [4];
  assert.match(validateProgram(p).join('\n'), /вне блока/);
});

test('разворачивание: нумерация, шаблоны по кругу, разгрузка', () => {
  const sessions = expandProgram(good());
  assert.equal(sessions.length, 3 * 2 + 2 * 3);
  assert.deepEqual(sessions.map((s) => s.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  // шаблоны идут по кругу сквозь весь блок
  assert.deepEqual(sessions.slice(0, 6).map((s) => s.templateId), ['A', 'B', 'A', 'B', 'A', 'B']);
  assert.deepEqual(sessions.slice(6).map((s) => s.templateId), ['A', 'B', 'C', 'A', 'B', 'C']);
  // разгрузочная неделя блока
  assert.deepEqual(sessions.slice(0, 6).map((s) => s.isDeload), [false, false, false, false, true, true]);
  assert.equal(sessions[6].isDeload, false);
  // сквозные недели
  assert.deepEqual(sessions.map((s) => s.weekIndex), [0, 0, 1, 1, 2, 2, 3, 3, 3, 4, 4, 4]);
  assert.equal(sessions[11].perWeek, 3);
});

test('некорректная программа не разворачивается', () => {
  assert.throws(() => expandProgram({ phases: [] }), /некорректна/);
});
