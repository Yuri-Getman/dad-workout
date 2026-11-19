// Вкладка «Программа»: фазы, блоки, шаблоны тренировок и расписание.
import { S, blockOf } from '../store.js';
import { esc } from './common.js';
import { formatDate, formatDateShort, pluralRu } from '../logic/format.js';
import { todayISO } from '../logic/dates.js';
import { nextPlanned } from '../logic/schedule.js';

const SECTION_TITLES = { warmup: 'Разминка', main: 'Основная часть', cooldown: 'Растяжка' };

function templateBlock(id) {
  const t = S.program.templates[id];
  const line = (item, section) => {
    const ex = S.lib.exercises[item.ex];
    let detail;
    if (section === 'main') {
      detail = ex.kind === 'time' ? `${item.sets} × ${item.timeRange.start}+ с` : `${item.sets} × ${item.repRange[0]}–${item.repRange[1]}`;
    } else {
      detail = ex.kind === 'time' ? `${item.seconds} с` : `${item.reps} раз`;
    }
    return `<li><span>${esc(ex.name)}</span><span class="muted">${esc(detail)}</span></li>`;
  };
  const sections = ['warmup', 'main', 'cooldown']
    .map((s) => `<h4>${SECTION_TITLES[s]}</h4><ul class="exlist">${t[s].map((i) => line(i, s)).join('')}</ul>`)
    .join('');
  return `<details class="card tpl"><summary><strong>Тренировка ${esc(id)}: ${esc(t.title)}</strong></summary>${sections}</details>`;
}

function sessionRow(entry, nextNumber, today) {
  const ps = S.sessions.find((s) => s.number === entry.number);
  const title = S.program.templates[ps.templateId].title;
  const planned = entry.status === 'planned';
  const icon = { done: '✓', skipped: '–', planned: '' }[entry.status];
  const date = entry.status === 'done' ? entry.doneDate : entry.date;
  const late = planned && entry.date < today;
  const label = { done: 'выполнена', skipped: 'пропущена', planned: late ? 'просрочена' : '' }[entry.status];
  return `<li class="srow ${entry.status}${entry.number === nextNumber ? ' next' : ''}">
    <span class="sicon" aria-hidden="true">${icon}</span>
    <span class="sinfo"><strong>№${entry.number} · ${esc(title)}${ps.isDeload ? ' (облегчённая)' : ''}</strong>
      <span class="muted small">${esc(formatDate(date))}${label ? ` · ${label}` : ''}</span></span>
    ${planned ? `<button class="btn mini secondary" data-action="move" data-number="${entry.number}">Перенести</button>` : ''}
  </li>`;
}

export function renderProgram() {
  const today = todayISO();
  const next = nextPlanned(S.schedule);
  const nextNumber = next?.number ?? -1;
  const currentSession = next ? S.sessions.find((s) => s.number === next.number) : S.sessions[S.sessions.length - 1];
  const currentPhaseId = currentSession?.phaseId;
  const currentBlockId = currentSession?.blockId;

  const roadmap = S.program.roadmap
    .map((r) => {
      const detailed = S.program.phases.some((p) => p.id === r.id);
      const current = r.id === currentPhaseId;
      return `<li class="phase${current ? ' current' : ''}">
        <div class="phase-head"><strong>${esc(r.title)}</strong><span class="muted small">месяцы ${esc(r.months)}</span></div>
        <div class="muted">${esc(r.focus)}</div>
        ${detailed ? '' : '<div class="muted small">Подробности добавим ближе к этому этапу. Программа пересматривается раз в 6 месяцев.</div>'}
      </li>`;
    })
    .join('');

  const blocks = S.program.phases
    .flatMap((p) => p.blocks)
    .map((b) => {
      const sessions = S.sessions.filter((s) => s.blockId === b.id);
      const entries = S.schedule.sessions.filter((e) => sessions.some((s) => s.number === e.number));
      const done = entries.filter((e) => e.status === 'done').length;
      const first = entries[0];
      const last = entries[entries.length - 1];
      const open = b.id === currentBlockId;
      const range = first && last ? `${formatDateShort(first.status === 'done' ? first.doneDate : first.date)} – ${formatDateShort(last.status === 'done' ? last.doneDate : last.date)}` : '';
      return `<details class="card block"${open ? ' open' : ''}>
        <summary><div><strong>${esc(b.title)}</strong>
          <div class="muted small">${b.weeks} ${pluralRu(b.weeks, 'неделя', 'недели', 'недель')} · ${b.perWeek} в неделю · ${esc(range)}</div></div>
          <span class="badge">${done}/${entries.length}</span></summary>
        <p class="muted">${esc(b.focus)}</p>
        <ul class="plain schedule">${entries.map((e) => sessionRow(e, nextNumber, today)).join('')}</ul>
      </details>`;
    })
    .join('');

  const done = S.schedule.sessions.filter((s) => s.status === 'done').length;
  return `<main class="screen">
    <h1>Программа</h1>
    <p class="muted">Всего в плане ${S.sessions.length} ${pluralRu(S.sessions.length, 'тренировка', 'тренировки', 'тренировок')}, выполнено ${done}. Нагрузка растёт сама, когда у вас получаются все повторы.</p>
    <details class="card"><summary><strong>Важно про здоровье</strong></summary><p class="muted">${esc(S.program.disclaimer)}</p></details>
    <h2>План на 3 года</h2>
    <ol class="plain roadmap">${roadmap}</ol>
    <h2>Блоки и расписание</h2>
    ${blocks}
    <h2>Тренировки</h2>
    ${Object.keys(S.program.templates).map(templateBlock).join('')}
  </main>`;
}

export { blockOf };
