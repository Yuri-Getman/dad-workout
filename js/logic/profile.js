// Данные о человеке, вводятся при первом запуске.

/** Индекс массы тела. */
export function bmi(weightKg, heightCm) {
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

/** Возвращает список ошибок ввода (пустой, если всё в порядке). */
export function validateProfile({ age, heightCm, weightKg }) {
  const errors = [];
  if (!Number.isFinite(age) || age < 14 || age > 100) errors.push('Возраст должен быть от 14 до 100 лет');
  if (!Number.isFinite(heightCm) || heightCm < 120 || heightCm > 230) errors.push('Рост должен быть от 120 до 230 см');
  if (!Number.isFinite(weightKg) || weightKg < 30 || weightKg > 250) errors.push('Вес должен быть от 30 до 250 кг');
  return errors;
}
