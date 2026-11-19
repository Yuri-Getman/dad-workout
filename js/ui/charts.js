// Простые графики на SVG. Цвета берутся из CSS, поэтому тёмная тема работает сама.
import { esc } from './common.js';
import { formatDateShort, formatNumber } from '../logic/format.js';

const W = 320;

/** Столбики. items: [{ label, value }] */
export function barChart(items, { height = 130, format = (v) => String(v), ariaLabel = 'График' } = {}) {
  if (!items.length) return '';
  const max = Math.max(1, ...items.map((i) => i.value));
  const padTop = 18;
  const padBottom = 22;
  const chartH = height - padTop - padBottom;
  const gap = 6;
  const bw = (W - gap * (items.length + 1)) / items.length;
  const bars = items
    .map((it, i) => {
      const h = Math.round((it.value / max) * chartH);
      const x = gap + i * (bw + gap);
      const y = padTop + chartH - h;
      return `<g>
        <rect class="bar" x="${x.toFixed(1)}" y="${y}" width="${bw.toFixed(1)}" height="${Math.max(h, it.value > 0 ? 2 : 0)}" rx="3"/>
        ${it.value > 0 ? `<text class="chart-val" x="${(x + bw / 2).toFixed(1)}" y="${y - 4}" text-anchor="middle">${esc(format(it.value))}</text>` : ''}
        <text class="chart-lbl" x="${(x + bw / 2).toFixed(1)}" y="${height - 6}" text-anchor="middle">${esc(it.label)}</text>
      </g>`;
    })
    .join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(ariaLabel)}"><line class="axis" x1="0" y1="${padTop + chartH}" x2="${W}" y2="${padTop + chartH}"/>${bars}</svg>`;
}

/** Линия. points: [{ date, value }]. Подписи: первое и последнее значение. */
export function lineChart(points, { height = 150, unit = '', ariaLabel = 'График' } = {}) {
  if (points.length === 0) return '';
  const padX = 28;
  const padTop = 22;
  const padBottom = 24;
  const chartH = height - padTop - padBottom;
  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  const x = (i) => (points.length === 1 ? W / 2 : padX + (i * (W - padX * 2)) / (points.length - 1));
  const y = (v) => padTop + chartH - ((v - min) / span) * chartH;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const dots = points.map((p, i) => `<circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="4"/>`).join('');
  const last = points.length - 1;
  const label = (i, anchor) =>
    `<text class="chart-val" x="${x(i).toFixed(1)}" y="${(y(points[i].value) - 8).toFixed(1)}" text-anchor="${anchor}">${esc(formatNumber(points[i].value))}${esc(unit)}</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(ariaLabel)}">
    <line class="axis" x1="0" y1="${padTop + chartH}" x2="${W}" y2="${padTop + chartH}"/>
    ${points.length > 1 ? `<path class="line" d="${path}"/>` : ''}${dots}
    ${label(0, points.length === 1 ? 'middle' : 'start')}${last > 0 ? label(last, 'end') : ''}
    <text class="chart-lbl" x="${padX}" y="${height - 6}" text-anchor="start">${esc(formatDateShort(points[0].date))}</text>
    ${last > 0 ? `<text class="chart-lbl" x="${W - padX}" y="${height - 6}" text-anchor="end">${esc(formatDateShort(points[last].date))}</text>` : ''}
  </svg>`;
}

/** Круговой таймер. Заполнение меняется из app.js через data-ring. */
export function ring({ fraction, text, label }) {
  const r = 88;
  const c = 2 * Math.PI * r;
  return `<div class="ring" role="timer" aria-live="off">
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <circle class="ring-bg" cx="100" cy="100" r="${r}"/>
      <circle class="ring-fg" data-ring cx="100" cy="100" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - fraction)).toFixed(2)}" transform="rotate(-90 100 100)"/>
    </svg>
    <div class="ring-center"><div class="ring-text" data-timer-text>${esc(text)}</div><div class="ring-label" data-timer-label>${esc(label)}</div></div>
  </div>`;
}

export const RING_CIRC = 2 * Math.PI * 88;
