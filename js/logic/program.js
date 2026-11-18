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
    }
  }
  return errors;
}

/**
 * Разворачивает программу в список тренировок по порядку.
 * Каждая тренировка: { number, phaseId, blockId, weekIndex, weekInBlock, perWeek, isDeload, templateId }.
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
