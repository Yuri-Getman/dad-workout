// Какие веса доступны при данных гантелях.
//
// dumbbells:
//   { type: 'fixed', weights: [4, 6, 8, 10] }                 цельные гантели (вес одной)
//   { type: 'adjustable', min: 2, max: 24, step: 2 }          разборные

const EPS = 1e-9;
const round2 = (x) => Math.round(x * 100) / 100;

export function availableWeights(dumbbells) {
  if (!dumbbells) return [];
  if (dumbbells.type === 'fixed') {
    return [...new Set((dumbbells.weights || []).filter((w) => w > 0))].sort((a, b) => a - b);
  }
  if (dumbbells.type === 'adjustable') {
    const { min, max, step } = dumbbells;
    if (!(step > 0) || !(min > 0) || max < min) return [];
    const out = [];
    for (let i = 0; min + i * step <= max + EPS; i++) out.push(round2(min + i * step));
    return out;
  }
  return [];
}

/**
 * Список весов, из которых выбирает прогрессия.
 * load: 'bodyweight' | 'dumbbell' | 'weighted_bodyweight' (свой вес плюс гантель, например подтягивания).
 */
export function weightLadder(load, dumbbells) {
  if (load === 'bodyweight') return [0];
  const weights = availableWeights(dumbbells);
  return load === 'weighted_bodyweight' ? [0, ...weights] : weights;
}

export function nextWeight(current, list) {
  const found = list.find((w) => w > current + EPS);
  return found === undefined ? null : found;
}

export function prevWeight(current, list) {
  for (let i = list.length - 1; i >= 0; i--) if (list[i] < current - EPS) return list[i];
  return null;
}

/** Ближайший доступный вес не больше value. Если такого нет, самый лёгкий. */
export function floorToAvailable(value, list) {
  if (!list.length) return value;
  let best = list[0];
  for (const w of list) if (w <= value + EPS) best = w;
  return best;
}
