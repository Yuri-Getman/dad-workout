// Форматирование для интерфейса (русский язык).
import { parseISO, diffDays } from './dates.js';

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const WEEKDAYS_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
export const WEEKDAYS_FULL = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];

function weekdayIndex(iso) {
  const d = parseISO(iso).getUTCDay();
  return d === 0 ? 6 : d - 1;
}

/** «пн, 23 ноября» */
export function formatDate(iso) {
  const d = parseISO(iso);
  return `${WEEKDAYS_SHORT[weekdayIndex(iso)]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** «23.11» */
export function formatDateShort(iso) {
  const d = parseISO(iso);
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** «Сегодня», «Завтра», «Вчера» или «пн, 23 ноября». */
export function relativeDay(iso, today) {
  const diff = diffDays(today, iso);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Завтра';
  if (diff === -1) return 'Вчера';
  return formatDate(iso);
}

export function pluralRu(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/** 90 -> «01:30» */
export function mmss(totalSec) {
  const s = Math.max(0, Math.round(totalSec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** 2520 -> «42 мин», 3900 -> «1 ч 05 мин» */
export function formatDuration(sec) {
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} мин`;
  return `${Math.floor(min / 60)} ч ${String(min % 60).padStart(2, '0')} мин`;
}

/** 8 -> «8 кг», 8.5 -> «8,5 кг» */
export function formatKg(w) {
  return `${String(Math.round(w * 100) / 100).replace('.', ',')} кг`;
}

export function formatNumber(n) {
  return String(Math.round(n * 10) / 10).replace('.', ',');
}

/** Один подход: «10 × 8 кг», «12», «40 с». */
export function formatSet(set, kind) {
  if (kind === 'time') return `${set.seconds} с`;
  return set.weight > 0 ? `${set.reps} × ${formatKg(set.weight)}` : `${set.reps}`;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
