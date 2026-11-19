import { escapeHtml } from '../logic/format.js';

export const esc = escapeHtml;

const TABS = [
  { id: 'workout', label: 'Тренировка', icon: '<path d="M3 9v6M6.5 6.5v11M17.5 6.5v11M21 9v6M6.5 12h11"/>' },
  { id: 'program', label: 'Программа', icon: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>' },
  { id: 'progress', label: 'Прогресс', icon: '<path d="M4 20V11M10 20V4M16 20v-6M22 20H2"/>' },
];

export function tabBar(active) {
  return `<nav class="tabbar" aria-label="Разделы">${TABS.map(
    (t) =>
      `<button class="tab${t.id === active ? ' active' : ''}" data-action="tab" data-tab="${t.id}"${t.id === active ? ' aria-current="page"' : ''}>
        <svg viewBox="0 0 24 24" aria-hidden="true">${t.icon}</svg><span>${t.label}</span></button>`
  ).join('')}</nav>`;
}

/** Переключатель-сегменты. items: [{ id, label }] */
export function segmented(action, dataKey, items, active) {
  return `<div class="seg" role="tablist">${items
    .map((i) => `<button role="tab" class="${i.id === active ? 'active' : ''}" aria-selected="${i.id === active}" data-action="${action}" data-${dataKey}="${i.id}">${esc(i.label)}</button>`)
    .join('')}</div>`;
}

/** Поле со счётчиком − / +. */
export function stepper({ field, label, value, hint = '', suffix = '' }) {
  return `<div class="field">
    <div class="field-label">${esc(label)}${hint ? ` <span class="muted small">${esc(hint)}</span>` : ''}</div>
    <div class="stepper">
      <button type="button" class="step" data-action="dec" data-field="${field}" aria-label="Меньше: ${esc(label)}">−</button>
      <label class="step-value"><input type="number" inputmode="decimal" data-input="${field}" value="${esc(value ?? '')}" aria-label="${esc(label)}">${suffix ? `<span>${esc(suffix)}</span>` : ''}</label>
      <button type="button" class="step" data-action="inc" data-field="${field}" aria-label="Больше: ${esc(label)}">+</button>
    </div>
  </div>`;
}

export function showToast(text, ms = 3500) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------- Диалоги ----------

let dialog = null;

export function closeDialog() {
  if (dialog) {
    const d = dialog;
    dialog = null;
    if (d.open) d.close();
    d.remove();
  }
}

/** Открывает окно с произвольным содержимым. Кнопки с data-dialog-action обрабатываются onAction. */
export function openDialog(html, onAction) {
  closeDialog();
  const d = document.createElement('dialog');
  d.className = 'sheet';
  d.innerHTML = html;
  d.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-dialog-action]');
    if (btn) onAction(btn.dataset.dialogAction, btn, d);
    else if (e.target === d) closeDialog();
  });
  d.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeDialog();
  });
  document.body.appendChild(d);
  dialog = d;
  if (typeof d.showModal === 'function') d.showModal();
  else d.setAttribute('open', '');
  return d;
}

/** Окно подтверждения. Возвращает Promise<boolean>. */
export function confirmDialog({ title, text = '', confirmLabel = 'Да', cancelLabel = 'Отмена', danger = false }) {
  return new Promise((resolve) => {
    openDialog(
      `<h2>${esc(title)}</h2>${text ? `<p class="muted">${esc(text)}</p>` : ''}
       <div class="stack">
         <button class="btn ${danger ? 'danger' : ''}" data-dialog-action="yes">${esc(confirmLabel)}</button>
         <button class="btn secondary" data-dialog-action="no">${esc(cancelLabel)}</button>
       </div>`,
      (action) => {
        closeDialog();
        resolve(action === 'yes');
      }
    );
  });
}
