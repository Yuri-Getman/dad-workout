// Стартовые нагрузки по результатам первого теста.
import { floorToAvailable } from './equipment.js';

/** Оценка разового максимума (формула Эпли). */
export function estimateOneRepMax(weight, reps) {
  return weight * (1 + reps / 30);
}

/**
 * Рабочий вес по одному подходу.
 * set: { weight, reps, rir } rir = сколько повторов ещё мог бы сделать (0, если до отказа).
 * targetReps: сколько повторов хотим в рабочем подходе (обычно середина диапазона).
 * rirTarget: запас в рабочих подходах (по умолчанию 2 повтора).
 * list: доступные веса (см. equipment.js).
 */
export function workingWeight(set, targetReps, list, { rirTarget = 2 } = {}) {
  const { weight, reps, rir = 0 } = set;
  if (!(weight > 0) || !(reps > 0)) throw new Error('Для расчёта нужны вес и число повторов больше нуля');
  const e1rm = estimateOneRepMax(weight, reps + rir);
  const raw = e1rm / (1 + (targetReps + rirTarget) / 30);
  return floorToAvailable(raw, list);
}

/**
 * С какой ступени лестницы начинать по максимуму повторов в тесте.
 * thresholds[i] = минимальный максимум, с которого можно начинать со ступени i.
 * Например, для отжиманий [0, 12, 20]: до 11 повторов начинаем с обычных,
 * 12-19 с медленных, 20 и больше с ногами на возвышении.
 */
export function startIndexFromMax(maxReps, thresholds) {
  let index = 0;
  thresholds.forEach((t, i) => {
    if (maxReps >= t) index = i;
  });
  return index;
}
