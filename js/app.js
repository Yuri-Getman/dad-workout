import { APP_VERSION } from './version.js';

const app = document.getElementById('app');

function render() {
  const online = navigator.onLine;
  app.innerHTML = `
    <main class="screen">
      <h1>Тренировки</h1>
      <section class="card">
        <p><strong>Каркас приложения установлен.</strong></p>
        <p class="muted">Программа тренировок, таймеры и статистика появятся в следующих версиях.</p>
        <p class="muted">Версия ${APP_VERSION}</p>
        <p id="net" class="${online ? 'status-ok' : 'status-warn'}">${online ? 'Есть интернет' : 'Без интернета (приложение работает офлайн)'}</p>
      </section>
    </main>
  `;
}

window.addEventListener('online', render);
window.addEventListener('offline', render);
render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.error('Не удалось включить офлайн-режим', err);
    });
  });
}
