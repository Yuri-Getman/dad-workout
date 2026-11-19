// Экспорт и импорт всех данных одним файлом.

export const BACKUP_FORMAT = 'dad-workout-backup';
export const BACKUP_VERSION = 1;

const KEYS = ['profile', 'settings', 'schedule', 'states', 'workouts', 'bodyLog', 'active'];

/** data: { profile, settings, schedule, states, workouts, bodyLog, active }. */
export function buildBackup(data, now = new Date()) {
  const payload = { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString() };
  for (const k of KEYS) payload[k] = data[k] ?? null;
  return JSON.stringify(payload);
}

/**
 * Разбор файла резервной копии.
 * Возвращает { ok: true, data } или { ok: false, error }.
 */
export function parseBackup(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Файл повреждён или это не резервная копия приложения' };
  }
  if (!obj || obj.format !== BACKUP_FORMAT) return { ok: false, error: 'Это не резервная копия приложения' };
  if (!Number.isInteger(obj.version) || obj.version > BACKUP_VERSION) {
    return { ok: false, error: 'Копия создана в более новой версии приложения. Обновите приложение' };
  }
  if (!obj.profile || !obj.schedule || !Array.isArray(obj.schedule.sessions)) {
    return { ok: false, error: 'В копии нет профиля или расписания' };
  }
  if (obj.workouts != null && !Array.isArray(obj.workouts)) return { ok: false, error: 'Журнал тренировок в копии повреждён' };
  if (obj.bodyLog != null && !Array.isArray(obj.bodyLog)) return { ok: false, error: 'Записи веса в копии повреждены' };
  const data = {};
  for (const k of KEYS) data[k] = obj[k] ?? null;
  data.workouts = data.workouts ?? [];
  data.bodyLog = data.bodyLog ?? [];
  data.states = data.states ?? {};
  return { ok: true, data };
}

/** Дней с последней копии (null, если копий не делали). */
export function daysSinceBackup(lastBackupISO, todayISO, diffDays) {
  if (!lastBackupISO) return null;
  return diffDays(lastBackupISO, todayISO);
}
