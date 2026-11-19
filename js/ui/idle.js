// Вкладка «Тренировка», когда занятие ещё не начато.
import { S, nextSessionInfo, previewWorkout, blockOf, phaseOf, daysSinceLastWorkout, currentEase, sessionByNumber } from '../store.js';
import { esc } from './common.js';
import { todayISO, diffDays } from '../logic/dates.js';
import { relativeDay, formatDate, formatKg, pluralRu } from '../logic/format.js';
import { estimateMinutes } from '../logic/workout.js';
import { daysSinceBackup } from '../logic/backup.js';

export const BACKUP_REMINDER_DAYS = 30;

function backupCard() {
  if (S.workouts.length < 3) return '';
  const days = daysSinceBackup(S.settings.lastBackup, todayISO(), diffDays);
  if (days !== null && days < BACKUP_REMINDER_DAYS) return '';
  const text = days === null ? 'Вы ещё не сохраняли резервную копию.' : `Резервной копии ${days} ${pluralRu(days, 'день', 'дня', 'дней')}.`;
  return `<div class="card notice"><strong>Сохраните резервную копию</strong>
    <p class="muted">${text} Если очистить данные браузера или потерять телефон, история тренировок пропадёт.</p>
    <button class="btn secondary" data-action="goto-settings">Сохранить копию</button></div>`;
}

function exerciseLine(it) {
  if (it.kind === 'time') {
    const sec = it.seconds;
    return `${it.sets} × ${sec} с${it.perSide ? ' на сторону' : ''}`;
  }
  const reps = `${it.repRange[0]}–${it.repRange[1]}`;
  const w = it.needsCalibration ? 'вес подберём' : it.weight > 0 ? formatKg(it.weight) : '';
  return `${it.sets} × ${reps}${w ? ` · ${w}` : ''}`;
}

export function renderIdle() {
  const info = nextSessionInfo();
  const today = todayISO();
  const parts = [`<main class="screen"><h1>Тренировка</h1>`];

  if (!S.persistent) {
    parts.push(`<div class="alert error" role="alert">Браузер не сохраняет данные (возможно, включён приватный режим). История пропадёт после закрытия приложения.</div>`);
  }
  if (S.saveError) {
    parts.push(`<div class="alert error" role="alert">Не удалось сохранить последние изменения. Освободите место на телефоне и повторите.</div>`);
  }

  if (!info) {
    parts.push(`<div class="card"><h2>Программа выполнена</h2>
      <p class="muted">Вы прошли все тренировки текущей программы. Следующие фазы будут добавлены при обновлении программы.</p></div>`);
    parts.push(backupCard(), '</main>');
    return parts.join('');
  }

  const { entry, session } = info;
  const workout = previewWorkout();
  const block = blockOf(session);
  const phase = phaseOf(session);
  const overdue = entry.date < today;
  const ease = currentEase(today);
  const minutes = estimateMinutes(workout);
  const when = relativeDay(entry.date, today);
  const doneCount = S.schedule.sessions.filter((s) => s.status === 'done').length;

  parts.push(backupCard());

  if (ease < 1) {
    const days = daysSinceLastWorkout(today);
    parts.push(`<div class="card notice"><strong>Вы возвращаетесь после перерыва (${days} ${pluralRu(days, 'день', 'дня', 'дней')})</strong>
      <p class="muted">Сегодня нагрузка снижена примерно на ${Math.round((1 - ease) * 100)}%, а подходов на один меньше. Это нормально: так тело спокойно втянется.</p></div>`);
  }

  parts.push(`<section class="card hero">
    <div class="chip${overdue ? ' warn' : ''}">${esc(when)}${overdue ? ' · пропущена' : ''}</div>
    <h2>Тренировка №${session.number}: ${esc(workout.title)}</h2>
    <p class="muted">${esc(phase.title)} · ${esc(block.title)}, неделя ${session.weekInBlock} из ${block.weeks}${session.isDeload ? ' · облегчённая неделя' : ''}</p>
    <p class="muted">Около ${minutes} мин · выполнено ${doneCount} из ${S.sessions.length}</p>
    <ul class="exlist">
      ${workout.items
        .filter((i) => i.section === 'main')
        .map((i) => `<li><span>${esc(i.name)}</span><span class="muted">${esc(exerciseLine(i))}</span></li>`)
        .join('')}
    </ul>
    <p class="muted small">Разминка и растяжка добавятся автоматически.</p>
    <button class="btn big" data-action="start">${overdue || entry.date === today ? 'Начать тренировку' : 'Начать сегодня'}</button>
    <div class="row-btns">
      <button class="btn secondary" data-action="move" data-number="${session.number}">Перенести</button>
      <button class="btn secondary" data-action="skip-session" data-number="${session.number}">Пропустить</button>
    </div>
    ${overdue ? `<button class="btn ghost" data-action="shift-today" data-number="${session.number}">Сдвинуть весь план: начать с сегодняшнего дня</button>` : ''}
    ${S.schedule.lastChange ? `<button class="btn ghost" data-action="undo-schedule">Отменить последнее изменение расписания</button>` : ''}
  </section>`);

  const upcoming = S.schedule.sessions.filter((s) => s.status === 'planned' && s.number > session.number).slice(0, 4);
  if (upcoming.length) {
    parts.push(`<section class="card"><h2>Дальше</h2><ul class="plain">${upcoming
      .map((s) => {
        const ps = sessionByNumber(s.number);
        const title = S.program.templates[ps.templateId].title;
        return `<li class="line"><span>№${s.number} · ${esc(title)}</span><span class="muted">${esc(formatDate(s.date))}</span></li>`;
      })
      .join('')}</ul></section>`);
  }
  parts.push('</main>');
  return parts.join('');
}
