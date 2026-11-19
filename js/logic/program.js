// Формат программы и разворачивание её в упорядоченный список тренировок.
//
// {
//   "version": 1,
//   "templates": { "A": { "title": "...", ... }, "B": {...} },
//   "phases": [
//     {
//       "id": "phase1", "title": "Адаптация и основа",
//       "blocks": [
//         {
//           "id": "p1b1", "title": "Адаптация",
//           "weeks": 4,                    недель в блоке
//           "perWeek": 2,                  тренировок в неделю
//           "rotation": ["A", "B"],        шаблоны по кругу, счёт идёт сквозь весь блок
//           "deloadWeeks": [4]             номера облегчённых недель внутри блока (с 1), необязательно
//         }
//       ]
//     }
//   ]
// }

/** Проверка программы. Возвращает список ошибок (пустой, если всё в порядке). */
export function validateProgram(program) {
  const errors = [];
  if (!program || typeof program !== 'object') return ['Программа пуста'];
  const templates = program.templates || {};
  if (!Array.isArray(program.phases) || program.phases.length === 0) {
    errors.push('В программе нет фаз');
    return errors;
  }
  const ids = new Set();
  const unique = (id, where) => {
    if (!id || typeof id !== 'string') errors.push(`${where}: не задан id`);
    else if (ids.has(id)) errors.push(`${where}: повторяющийся id «${id}»`);
    else ids.add(id);
  };

  for (const phase of program.phases) {
    unique(phase.id, 'Фаза');
    if (!Array.isArray(phase.blocks) || phase.blocks.length === 0) {
      errors.push(`Фаза «${phase.id}»: нет блоков`);
      continue;
    }
    for (const block of phase.blocks) {
      const where = `Блок «${block.id}»`;
      unique(block.id, 'Блок');
      if (!Number.isInteger(block.weeks) || block.weeks < 1) errors.push(`${where}: weeks должно быть целым числом от 1`);
      if (!Number.isInteger(block.perWeek) || block.perWeek < 1 || block.perWeek > 7) errors.push(`${where}: perWeek должно быть от 1 до 7`);
      if (!Array.isArray(block.rotation) || block.rotation.length === 0) {
        errors.push(`${where}: не задана rotation`);
      } else {
        for (const id of block.rotation) if (!templates[id]) errors.push(`${where}: нет шаблона «${id}»`);
      }
      for (const w of block.deloadWeeks || []) {
        if (!Number.isInteger(w) || w < 1 || w > block.weeks) errors.push(`${where}: облегчённая неделя ${w} вне блока`);
      }
      if (block.setsDelta !== undefined && (!Number.isInteger(block.setsDelta) || block.setsDelta > 0 || block.setsDelta < -2)) {
        errors.push(`${where}: setsDelta должно быть целым числом от -2 до 0`);
      }
    }
  }
  return errors;
}

/**
 * Разворачивает программу в список тренировок по порядку.
 * Каждая тренировка: { number, phaseId, blockId, weekIndex, weekInBlock, perWeek, isDeload, setsDelta, templateId }.
 * number начинается с 1. weekIndex: сквозной номер недели программы с 0.
 */
export function expandProgram(program) {
  const errors = validateProgram(program);
  if (errors.length) throw new Error(`Программа некорректна: ${errors.join('; ')}`);

  const sessions = [];
  let number = 0;
  let weekIndex = 0;
  for (const phase of program.phases) {
    for (const block of phase.blocks) {
      let counter = 0;
      for (let w = 1; w <= block.weeks; w++) {
        const isDeload = (block.deloadWeeks || []).includes(w);
        for (let slot = 0; slot < block.perWeek; slot++) {
          number += 1;
          sessions.push({
            number,
            phaseId: phase.id,
            blockId: block.id,
            weekIndex,
            weekInBlock: w,
            perWeek: block.perWeek,
            isDeload,
            setsDelta: block.setsDelta ?? 0,
            templateId: block.rotation[counter % block.rotation.length],
          });
          counter += 1;
        }
        weekIndex += 1;
      }
    }
  }
  return sessions;
}

const LOADS = ['bodyweight', 'dumbbell', 'weighted_bodyweight'];
const isPosInt = (x) => Number.isInteger(x) && x > 0;

/**
 * Проверка шаблонов тренировок против библиотеки упражнений (data/exercises.json).
 * Возвращает список ошибок (пустой, если всё в порядке).
 */
export function validateContent(program, lib) {
  const errors = [];
  const ex = lib?.exercises;
  if (!ex || typeof ex !== 'object') return ['Нет библиотеки упражнений'];

  for (const [id, e] of Object.entries(ex)) {
    if (!e.name) errors.push(`Упражнение «${id}»: нет названия`);
    if (e.variantOf) {
      if (!ex[e.variantOf]) errors.push(`Упражнение «${id}»: variantOf «${e.variantOf}» не найдено`);
      continue;
    }
    if (!['reps', 'time'].includes(e.kind)) errors.push(`Упражнение «${id}»: kind должен быть reps или time`);
    if (!LOADS.includes(e.load)) errors.push(`Упражнение «${id}»: неизвестный load «${e.load}»`);
    if (e.ladder) {
      for (const v of e.ladder) if (!ex[v]) errors.push(`Упражнение «${id}»: в лестнице нет «${v}»`);
      if (e.ladder[0] !== id && ex[e.ladder[0]]?.variantOf !== id) errors.push(`Упражнение «${id}»: лестница должна начинаться с него самого или его варианта`);
      if (e.ladderStart && e.ladderStart.length > e.ladder.length) errors.push(`Упражнение «${id}»: ladderStart длиннее лестницы`);
      if (e.ladderStart && e.ladderStart.some((x, i) => i > 0 && x <= e.ladderStart[i - 1])) errors.push(`Упражнение «${id}»: ladderStart должен возрастать`);
    }
  }

  const prescriptions = new Map();
  for (const [tid, t] of Object.entries(program.templates || {})) {
    for (const section of ['warmup', 'main', 'cooldown']) {
      if (!Array.isArray(t[section])) {
        errors.push(`Шаблон «${tid}»: нет раздела ${section}`);
        continue;
      }
      t[section].forEach((item, i) => {
        const where = `Шаблон «${tid}», ${section}[${i}]`;
        const e = ex[item.ex];
        if (!e) return errors.push(`${where}: нет упражнения «${item.ex}»`);
        if (e.variantOf) return errors.push(`${where}: «${item.ex}» вариант, укажите базовое упражнение «${e.variantOf}»`);
        if (section === 'main') {
          if (!isPosInt(item.sets)) errors.push(`${where}: sets должно быть целым числом от 1`);
          if (!Number.isInteger(item.restSec) || item.restSec < 0) errors.push(`${where}: restSec должно быть целым числом от 0`);
          if (e.kind === 'reps') {
            const r = item.repRange;
            if (!Array.isArray(r) || r.length !== 2 || !isPosInt(r[0]) || !isPosInt(r[1]) || r[0] >= r[1]) errors.push(`${where}: repRange должен быть [мин, макс]`);
          } else {
            const t2 = item.timeRange;
            if (!t2 || !isPosInt(t2.start) || !isPosInt(t2.step)) errors.push(`${where}: timeRange должен содержать start и step`);
          }
          // Прогрессия общая для упражнения, поэтому диапазон везде должен совпадать.
          const key = JSON.stringify([item.repRange, item.timeRange]);
          if (prescriptions.has(item.ex) && prescriptions.get(item.ex) !== key) errors.push(`${where}: диапазон «${item.ex}» отличается от другого шаблона`);
          prescriptions.set(item.ex, key);
        } else if (e.kind === 'reps' ? !isPosInt(item.reps) : !isPosInt(item.seconds)) {
          errors.push(`${where}: нужно ${e.kind === 'reps' ? 'reps' : 'seconds'} больше нуля`);
        }
      });
    }
  }
  return errors;
}
