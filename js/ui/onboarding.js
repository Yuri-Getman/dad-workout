// Первый запуск: четыре шага.
import { esc } from './common.js';
import { todayISO } from '../logic/dates.js';
import { validateProfile, bmi } from '../logic/profile.js';
import { availableWeights } from '../logic/equipment.js';
import { WEEKDAYS_SHORT, WEEKDAYS_FULL } from '../logic/format.js';

export const OB = {
  step: 0,
  age: 50,
  heightCm: 192,
  weightKg: 84,
  pushups: 15,
  pullups: 10,
  dtype: 'adjustable',
  dMin: 2,
  dMax: 20,
  dStep: 2,
  dFixed: '4, 6, 8, 10',
  weekdays: [1, 3, 5],
  startDate: todayISO(),
  agree: false,
};

const STEPS = 4;

export const parseNum = (v) => {
  const n = Number(String(v).replace(',', '.').trim());
  return String(v).trim() === '' ? NaN : n;
};

function numField(key, label, { hint = '', step = 1, min = 0 } = {}) {
  return `<label class="field">
    <span class="field-label">${esc(label)}</span>
    ${hint ? `<span class="muted small">${esc(hint)}</span>` : ''}
    <input class="input" type="number" inputmode="decimal" step="${step}" min="${min}" data-ob="${key}" value="${esc(OB[key])}">
  </label>`;
}

function stepAbout() {
  const b = validateProfile({ age: OB.age, heightCm: OB.heightCm, weightKg: OB.weightKg }).length === 0 ? bmi(OB.weightKg, OB.heightCm) : null;
  return `<h1>Давайте познакомимся</h1>
    <p class="muted">Эти данные нужны, чтобы подобрать нагрузку. Проверьте их и поправьте, если что-то не так.</p>
    ${numField('age', 'Возраст, лет')}
    ${numField('heightCm', 'Рост, см')}
    ${numField('weightKg', 'Вес, кг', { step: 0.1 })}
    ${b ? `<p class="muted small">Индекс массы тела: ${String(b).replace('.', ',')}</p>` : ''}`;
}

function stepTest() {
  return `<h1>Сколько вы можете сейчас</h1>
    <p class="muted">Это нужно, чтобы выбрать вариант упражнений. Проверьте на деле: сделайте подряд столько раз, сколько получается с хорошей техникой, без раскачки. Если не уверены, лучше указать поменьше.</p>
    ${numField('pushups', 'Отжимания от пола, раз подряд', { hint: 'Обычные, грудью почти до пола' })}
    ${numField('pullups', 'Подтягивания на турнике, раз подряд', { hint: 'Хват чуть шире плеч, без раскачки' })}`;
}

function stepDumbbells() {
  const adj = OB.dtype === 'adjustable';
  return `<h1>Ваши гантели</h1>
    <p class="muted">Вес обычно написан на самой гантели. Если не знаете точно, укажите примерно: потом это можно поправить в разделе «Прогресс» → «Настройки».</p>
    <div class="seg" role="radiogroup" aria-label="Тип гантелей">
      <button class="${adj ? 'active' : ''}" role="radio" aria-checked="${adj}" data-action="ob-dtype" data-value="adjustable">Разборные</button>
      <button class="${adj ? '' : 'active'}" role="radio" aria-checked="${!adj}" data-action="ob-dtype" data-value="fixed">Цельные</button>
    </div>
    ${
      adj
        ? `<p class="muted small">Разборные: вес меняется дисками. Укажите вес одной гантели.</p>
           ${numField('dMin', 'Самая лёгкая, кг', { step: 0.5 })}
           ${numField('dMax', 'Самая тяжёлая, кг', { step: 0.5 })}
           ${numField('dStep', 'Шаг между весами, кг', { hint: 'На сколько меняется вес одной гантели, если добавить диски', step: 0.5 })}`
        : `<p class="muted small">Цельные: каждая гантель имеет свой вес.</p>
           <label class="field"><span class="field-label">Веса через запятую, кг</span>
           <input class="input" type="text" inputmode="decimal" data-ob="dFixed" value="${esc(OB.dFixed)}"></label>`
    }`;
}

function stepSchedule() {
  const days = WEEKDAYS_SHORT.map((d, i) => {
    const n = i + 1;
    const on = OB.weekdays.includes(n);
    return `<button type="button" class="day${on ? ' active' : ''}" aria-pressed="${on}" aria-label="${esc(WEEKDAYS_FULL[i])}" data-action="ob-day" data-day="${n}">${esc(d)}</button>`;
  }).join('');
  return `<h1>Расписание</h1>
    <p class="muted">Выберите дни недели для тренировок. Лучше три дня с отдыхом между ними, например понедельник, среда, пятница. Первые две недели будет по две тренировки в неделю, потом по три.</p>
    <div class="days">${days}</div>
    <label class="field"><span class="field-label">Начать с даты</span>
      <input class="input" type="date" min="${todayISO()}" data-ob="startDate" value="${esc(OB.startDate)}"></label>
    <label class="check"><input type="checkbox" data-ob="agree" ${OB.agree ? 'checked' : ''}>
      <span>Я понимаю, что из-за протрузий в спине программу нужно показать врачу или специалисту по ЛФК. При боли в спине, онемении или слабости в ногах тренировку нужно прекратить.</span></label>`;
}

export function renderOnboarding(error = '') {
  const body = [stepAbout, stepTest, stepDumbbells, stepSchedule][OB.step]();
  const last = OB.step === STEPS - 1;
  return `<main class="screen onboarding">
    <p class="muted small">Шаг ${OB.step + 1} из ${STEPS}</p>
    <div class="progress" aria-hidden="true"><span style="width:${((OB.step + 1) / STEPS) * 100}%"></span></div>
    ${body}
    ${error ? `<div class="alert error" role="alert">${error}</div>` : ''}
    <div class="actions">
      ${OB.step > 0 ? '<button class="btn secondary" data-action="ob-back">Назад</button>' : ''}
      <button class="btn" data-action="${last ? 'ob-finish' : 'ob-next'}">${last ? 'Готово' : 'Далее'}</button>
    </div>
  </main>`;
}

/** Описание гантелей из введённых данных или список ошибок. */
export function dumbbellsFromOB() {
  if (OB.dtype === 'adjustable') {
    const d = { type: 'adjustable', min: parseNum(OB.dMin), max: parseNum(OB.dMax), step: parseNum(OB.dStep) };
    if (!(d.min > 0) || !(d.step > 0) || !(d.max >= d.min)) return { errors: ['Проверьте веса: самая лёгкая и шаг больше нуля, самая тяжёлая не меньше самой лёгкой'] };
    if (d.max > 100) return { errors: ['Максимальный вес не больше 100 кг'] };
    if (availableWeights(d).length > 60) return { errors: ['Слишком мелкий шаг: получается больше 60 весов'] };
    return { dumbbells: d };
  }
  const weights = String(OB.dFixed)
    .split(/[;,\s]+/)
    .map(parseNum)
    .filter((n) => n > 0);
  if (!weights.length) return { errors: ['Укажите хотя бы один вес, например: 4, 6, 8'] };
  return { dumbbells: { type: 'fixed', weights } };
}

/** Проверка текущего шага. Возвращает список ошибок. */
export function validateStep() {
  if (OB.step === 0) return validateProfile({ age: parseNum(OB.age), heightCm: parseNum(OB.heightCm), weightKg: parseNum(OB.weightKg) });
  if (OB.step === 1) {
    const errors = [];
    for (const [k, name] of [['pushups', 'отжиманий'], ['pullups', 'подтягиваний']]) {
      const n = parseNum(OB[k]);
      if (!Number.isInteger(n) || n < 0 || n > 200) errors.push(`Укажите число ${name} целым числом от 0 до 200`);
    }
    return errors;
  }
  if (OB.step === 2) return dumbbellsFromOB().errors ?? [];
  const errors = [];
  if (!OB.weekdays.length) errors.push('Выберите хотя бы один день недели');
  if (!OB.startDate || OB.startDate < todayISO()) errors.push('Дата начала не может быть в прошлом');
  if (!OB.agree) errors.push('Подтвердите, что прочитали замечание про врача');
  return errors;
}

export function onboardingResult() {
  return {
    age: parseNum(OB.age),
    heightCm: parseNum(OB.heightCm),
    weightKg: parseNum(OB.weightKg),
    pushups: parseNum(OB.pushups),
    pullups: parseNum(OB.pullups),
    dumbbells: dumbbellsFromOB().dumbbells,
    weekdays: [...OB.weekdays].sort((a, b) => a - b),
    startDate: OB.startDate,
  };
}
