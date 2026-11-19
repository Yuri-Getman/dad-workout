// Сборка тренировки из программы и разбор результатов.
//
// Тренировка (workout) строится из шаблона программы с учётом текущего состояния
// упражнений (вес, ступень лестницы), облегчения (разгрузочная неделя, перерыв)
// и количества подходов в блоке. Результат хранится в active (см. flow.js).

import { prescribe, evaluateSession, initialState, applySuggestion, DELOAD_FACTOR } from './progression.js';
import { availableWeights } from './equipment.js';
import { startIndexFromMax } from './calibration.js';

/** Как отец оценил первый подход: сколько повторов ещё мог бы сделать. */
export const RESERVE_TO_RIR = { hard: 0, medium: 2, easy: 4 };

/** Описание упражнения для прогрессии из библиотеки и шаблона. */
export function specFor(lib, item, setsDelta = 0) {
  const ex = lib.exercises[item.ex];
  const spec = { id: item.ex, kind: ex.kind, sets: Math.max(1, item.sets + setsDelta), load: ex.load, restSec: item.restSec };
  if (ex.kind === 'time') spec.timeRange = item.timeRange;
  else spec.repRange = item.repRange;
  if (ex.ladder) spec.ladder = ex.ladder;
  return spec;
}

/** Новое состояние упражнения. Вес гантелей неизвестен (null), пока его не подобрали. */
export function freshState(spec) {
  return initialState(spec, { weight: spec.load === 'dumbbell' ? null : 0 });
}

/** Состояния всех упражнений программы по результатам стартового теста: { pushups, pullups }. */
export function initialStates(program, lib, test) {
  const states = {};
  for (const template of Object.values(program.templates)) {
    for (const item of template.main) {
      if (states[item.ex]) continue;
      const ex = lib.exercises[item.ex];
      let variantIndex = 0;
      if (ex.ladder && ex.ladderStart && ex.testKey && Number.isFinite(test?.[ex.testKey])) {
        variantIndex = startIndexFromMax(test[ex.testKey], ex.ladderStart);
      }
      states[item.ex] = { ...freshState(specFor(lib, item)), variantIndex };
    }
  }
  return states;
}

function simpleItem(lib, section, item, index) {
  const ex = lib.exercises[item.ex];
  return {
    key: `${section}:${index}`,
    section,
    exerciseId: item.ex,
    variantId: item.ex,
    name: ex.name,
    kind: ex.kind,
    load: 'bodyweight',
    perSide: !!ex.perSide,
    sets: 1,
    reps: item.reps,
    seconds: item.seconds,
    weight: 0,
    restSec: 0,
    eased: false,
    needsCalibration: false,
    logged: [],
  };
}

/**
 * Собирает тренировку.
 * session: элемент expandProgram(); easeFactor: облегчение после перерыва (1 = без облегчения).
 */
export function buildWorkout({ program, lib, session, states, dumbbells, easeFactor = 1 }) {
  const template = program.templates[session.templateId];
  const factor = Math.min(session.isDeload ? DELOAD_FACTOR : 1, easeFactor);
  const items = [];
  template.warmup.forEach((item, i) => items.push(simpleItem(lib, 'warmup', item, i)));
  template.main.forEach((item, i) => {
    const spec = specFor(lib, item, session.setsDelta ?? 0);
    const state = states[item.ex] ?? freshState(spec);
    const p = prescribe(spec, state, dumbbells, { easeFactor: factor });
    const variant = lib.exercises[p.variantId];
    items.push({
      key: `main:${i}`,
      section: 'main',
      exerciseId: item.ex,
      variantId: p.variantId,
      name: variant.name,
      kind: spec.kind,
      load: spec.load,
      perSide: !!(variant.perSide ?? lib.exercises[item.ex].perSide),
      sets: p.sets,
      repRange: p.repRange,
      seconds: p.seconds,
      weight: p.weight,
      restSec: p.restSec,
      eased: p.eased,
      needsCalibration: spec.load === 'dumbbell' && (state.weight === null || state.weight === undefined),
      spec,
      logged: [],
    });
  });
  template.cooldown.forEach((item, i) => items.push(simpleItem(lib, 'cooldown', item, i)));
  return {
    number: session.number,
    templateId: session.templateId,
    title: template.title,
    isDeload: !!session.isDeload,
    easeFactor: factor,
    items,
  };
}

/** Примерная длительность тренировки в минутах, с округлением до 5. */
export function estimateMinutes(workout) {
  let sec = 0;
  for (const it of workout.items) {
    const sides = it.perSide ? 2 : 1;
    if (it.section === 'main') {
      const work = it.kind === 'time' ? (it.seconds ?? 30) * sides : 40 * sides;
      sec += it.sets * (work + (it.restSec || 0));
    } else if (it.kind === 'time') {
      sec += (it.seconds ?? 30) * sides + 10;
    } else {
      sec += 45;
    }
  }
  return Math.max(5, Math.round(sec / 60 / 5) * 5);
}

/** Что отец делал в этом упражнении в прошлый раз: { date, number, sets } или null. */
export function lastPerformance(workouts, variantId) {
  let best = null;
  for (const w of workouts) {
    for (const it of w.items) {
      if (it.variantId !== variantId) continue;
      if (!best || w.doneDate > best.date || (w.doneDate === best.date && w.number > best.number)) {
        best = { date: w.doneDate, number: w.number, sets: it.sets };
      }
    }
  }
  return best;
}

/**
 * Итоги: журнал тренировки для истории, предложения прогрессии и новые счётчики неудач.
 * Возвращает { log, suggestions, failStreaks }.
 */
export function summarizeWorkout(active, { states, dumbbells, now, today }) {
  const suggestions = [];
  const failStreaks = {};
  const mainDone = active.items.filter((i) => i.section === 'main' && !i.skipped && i.logged.length > 0);

  for (const item of mainDone) {
    const state = states[item.exerciseId] ?? freshState(item.spec);
    const weights = item.logged.map((s) => s.weight).filter((w) => typeof w === 'number');
    const base = state.weight === null || state.weight === undefined ? { ...state, weight: weights.length ? Math.min(...weights) : 0 } : state;
    const r = evaluateSession(item.spec, base, item.logged, dumbbells, { eased: item.eased });
    failStreaks[item.exerciseId] = r.failStreak;
    if (r.suggestion.type !== 'hold' || r.suggestion.reason === 'no_heavier_weight') {
      suggestions.push({ exerciseId: item.exerciseId, name: item.name, suggestion: r.suggestion });
    }
  }

  const log = {
    number: active.number,
    templateId: active.templateId,
    title: active.title,
    date: active.date,
    doneDate: today,
    startedAt: active.startedAt,
    finishedAt: now,
    durationSec: Math.max(0, Math.round((now - active.startedAt) / 1000)),
    eased: active.easeFactor < 1,
    note: active.note || '',
    items: mainDone.map((i) => ({
      exerciseId: i.exerciseId,
      variantId: i.variantId,
      name: i.name,
      kind: i.kind,
      perSide: i.perSide,
      sets: i.logged.map((s) => ({ ...s })),
      plannedSets: i.sets,
    })),
  };
  return { log, suggestions, failStreaks };
}

/** Применяет счётчики неудач и принятые предложения. Возвращает новый объект состояний. */
export function finalizeStates(states, active, failStreaks, acceptedSuggestions) {
  const next = { ...states };
  for (const item of active.items) {
    if (item.section !== 'main' || !(item.exerciseId in failStreaks)) continue;
    const current = next[item.exerciseId] ?? freshState(item.spec);
    next[item.exerciseId] = { ...current, failStreak: failStreaks[item.exerciseId] };
  }
  for (const s of acceptedSuggestions) {
    const current = next[s.exerciseId];
    if (current) next[s.exerciseId] = applySuggestion(current, s.suggestion);
  }
  return next;
}

/** Человекочитаемое описание предложения прогрессии. */
export function describeSuggestion(s, lib) {
  const sug = s.suggestion;
  const kg = (w) => `${String(w).replace('.', ',')} кг`;
  switch (sug.type) {
    case 'increase_weight':
      return `Увеличить вес с ${kg(sug.from)} до ${kg(sug.to)}`;
    case 'decrease_weight':
      return `Снизить вес с ${kg(sug.from)} до ${kg(sug.to)}`;
    case 'next_variant':
      return `Перейти на более сложный вариант: ${lib.exercises[sug.toId].name}`;
    case 'previous_variant':
      return `Вернуться к более лёгкому варианту: ${lib.exercises[sug.toId].name}`;
    case 'add_time':
      return `Добавить время: с ${sug.from} до ${sug.to} с`;
    case 'decrease_time':
      return `Сократить время: с ${sug.from} до ${sug.to} с`;
    case 'hold':
      if (sug.reason === 'no_heavier_weight') return 'Все повторы на максимуме, но тяжелее гантелей нет. Нужны гантели потяжелее';
      return '';
    default:
      return '';
  }
}

export { availableWeights };
