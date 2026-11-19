// Статистика по журналу тренировок (workouts) и записям веса тела (bodyLog).
//
// workout: { number, doneDate, durationSec, items: [{ exerciseId, variantId, name, kind, sets: [{reps|seconds, weight?}] }] }
// bodyLog: [{ date, weightKg }]

import { addDays, weekday, diffDays } from './dates.js';

/** Понедельник недели, в которую попадает дата. */
export function weekStart(iso) {
  return addDays(iso, -(weekday(iso) - 1));
}

/** Объём подхода: вес × повторы. Для упражнений с собственным весом без гантелей объём не считается. */
export function setVolume(set) {
  return typeof set.reps === 'number' && set.weight > 0 ? set.reps * set.weight : 0;
}

export function workoutVolume(workout) {
  let total = 0;
  for (const it of workout.items) for (const s of it.sets) total += setVolume(s);
  return total;
}

/** Всего повторов в тренировке (для упражнений на повторы). */
export function workoutReps(workout) {
  let total = 0;
  for (const it of workout.items) for (const s of it.sets) if (typeof s.reps === 'number') total += s.reps;
  return total;
}

/**
 * Тренировок по неделям за последние weeks недель, считая от недели today.
 * Возвращает [{ weekStart, count }] по порядку, самая новая последняя.
 */
export function workoutsPerWeek(workouts, today, weeks = 8) {
  const current = weekStart(today);
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) out.push({ weekStart: addDays(current, -7 * i), count: 0 });
  const index = new Map(out.map((w, i) => [w.weekStart, i]));
  for (const w of workouts) {
    const i = index.get(weekStart(w.doneDate));
    if (i !== undefined) out[i].count += 1;
  }
  return out;
}

/** Объём по неделям (как workoutsPerWeek, но сумма вес × повторы). */
export function volumePerWeek(workouts, today, weeks = 8) {
  const current = weekStart(today);
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) out.push({ weekStart: addDays(current, -7 * i), volume: 0 });
  const index = new Map(out.map((w, i) => [w.weekStart, i]));
  for (const w of workouts) {
    const i = index.get(weekStart(w.doneDate));
    if (i !== undefined) out[i].volume += workoutVolume(w);
  }
  return out;
}

/** Сколько недель подряд (считая от текущей или прошлой) было хотя бы minPerWeek тренировок. */
export function weekStreak(workouts, today, minPerWeek = 2) {
  const counts = new Map();
  for (const w of workouts) counts.set(weekStart(w.doneDate), (counts.get(weekStart(w.doneDate)) ?? 0) + 1);
  let cursor = weekStart(today);
  // Текущая неделя ещё идёт: если она пока не набрала норму, считаем с прошлой.
  if ((counts.get(cursor) ?? 0) < minPerWeek) cursor = addDays(cursor, -7);
  let streak = 0;
  while ((counts.get(cursor) ?? 0) >= minPerWeek) {
    streak += 1;
    cursor = addDays(cursor, -7);
  }
  return streak;
}

/** Лучший результат по упражнению: вес, затем повторы. */
function better(kind, a, b) {
  if (!a) return true;
  if (kind === 'time') return b.seconds > a.seconds;
  const wa = a.weight ?? 0;
  const wb = b.weight ?? 0;
  if (wb !== wa) return wb > wa;
  return b.reps > a.reps;
}

/**
 * Личные рекорды по упражнениям (по variantId, чтобы разные ступени лестницы не смешивались).
 * Возвращает массив { variantId, name, kind, best: { reps|seconds, weight?, date } }.
 * Для подходов с весом 0 при ненулевых весах в истории вес считается как есть: рекорд — максимум веса, затем повторы.
 */
export function personalRecords(workouts) {
  const map = new Map();
  for (const w of workouts) {
    for (const it of w.items) {
      for (const s of it.sets) {
        const rec = map.get(it.variantId);
        if (!rec) map.set(it.variantId, { variantId: it.variantId, name: it.name, kind: it.kind, best: { ...s, date: w.doneDate } });
        else if (better(it.kind, rec.best, s)) rec.best = { ...s, date: w.doneDate };
      }
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

/**
 * Динамика по упражнению: для каждой тренировки лучший подход.
 * Возвращает [{ date, number, value, weight? }]: value это повторы или секунды лучшего подхода.
 * Если в упражнении есть вес, лучшим считается подход с наибольшим весом, затем повторами.
 */
export function exerciseSeries(workouts, variantId) {
  const out = [];
  const sorted = [...workouts].sort((a, b) => a.doneDate.localeCompare(b.doneDate) || a.number - b.number);
  for (const w of sorted) {
    for (const it of w.items) {
      if (it.variantId !== variantId) continue;
      let best = null;
      for (const s of it.sets) if (better(it.kind, best, s)) best = s;
      if (best) out.push({ date: w.doneDate, number: w.number, value: it.kind === 'time' ? best.seconds : best.reps, weight: best.weight });
    }
  }
  return out;
}

/** Все упражнения, по которым есть история: [{ variantId, name, kind, sessions }]. */
export function trackedExercises(workouts) {
  const map = new Map();
  for (const w of workouts) {
    for (const it of w.items) {
      const e = map.get(it.variantId) ?? { variantId: it.variantId, name: it.name, kind: it.kind, sessions: 0 };
      e.sessions += 1;
      map.set(it.variantId, e);
    }
  }
  return [...map.values()].sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name, 'ru'));
}

/** Сводка: тренировок всего, за 30 дней, общее время, объём, серия недель. */
export function summary(workouts, today) {
  const last30 = workouts.filter((w) => diffDays(w.doneDate, today) >= 0 && diffDays(w.doneDate, today) < 30);
  return {
    total: workouts.length,
    last30: last30.length,
    totalDurationSec: workouts.reduce((n, w) => n + (w.durationSec || 0), 0),
    totalVolume: workouts.reduce((n, w) => n + workoutVolume(w), 0),
    weekStreak: weekStreak(workouts, today),
  };
}

/** Записи веса тела по порядку дат; при нескольких записях в один день остаётся последняя. */
export function bodySeries(bodyLog) {
  const byDate = new Map();
  for (const e of bodyLog) byDate.set(e.date, e);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Изменение веса тела: от первой записи к последней. */
export function bodyChange(bodyLog) {
  const s = bodySeries(bodyLog);
  if (s.length < 2) return null;
  return { from: s[0], to: s[s.length - 1], deltaKg: Math.round((s[s.length - 1].weightKg - s[0].weightKg) * 10) / 10 };
}
