// Работа с датами в формате 'YYYY-MM-DD' без часовых поясов (всё считается в UTC).
const MS_DAY = 86400000;

export function parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) throw new Error(`Некорректная дата: ${s}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (toISO(d) !== s) throw new Error(`Несуществующая дата: ${s}`);
  return d;
}

export function toISO(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(s, n) {
  return toISO(new Date(parseISO(s).getTime() + n * MS_DAY));
}

/** Сколько дней от a до b (b - a). */
export function diffDays(a, b) {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / MS_DAY);
}

/** День недели: 1 = понедельник ... 7 = воскресенье. */
export function weekday(s) {
  const d = parseISO(s).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Сегодняшняя дата по местному времени устройства. */
export function todayISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
