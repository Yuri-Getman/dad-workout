// Сквозная проверка приложения в Chromium (нужен пакет playwright: npm i -g playwright).
// Запуск: NODE_PATH=$(npm root -g) node tools/e2e.cjs . /tmp/shots
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repo = process.argv[2];
const out = process.argv[3];
fs.mkdirSync(out, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(repo, p);
  if (!file.startsWith(repo) || !fs.existsSync(file)) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const problems = [];
const log = (...a) => console.log(...a);
const check = (cond, msg) => {
  if (cond) log('  ok  ', msg);
  else {
    log('  FAIL', msg);
    problems.push(msg);
  }
};

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: 'ru-RU', timezoneId: 'Asia/Yekaterinburg' });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('dialog', (d) => d.accept());

  const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) });
  const text = () => page.evaluate(() => document.body.innerText);
  const click = async (sel) => {
    await page.click(sel);
    await page.waitForTimeout(60);
  };

  await page.clock.install({ time: new Date('2026-11-23T08:00:00+05:00') });
  await page.goto(base);
  await page.waitForSelector('.onboarding');

  log('Первый запуск');
  let t = await text();
  check(t.includes('Шаг 1 из 4'), 'показан шаг 1');
  check((await page.inputValue('[data-ob="age"]')) === '50' && (await page.inputValue('[data-ob="heightCm"]')) === '192', 'предзаполнены возраст и рост');
  await shot('01-onboarding-about');
  // неверный ввод
  await page.fill('[data-ob="age"]', '5');
  await click('[data-action="ob-next"]');
  check((await text()).includes('Возраст должен быть'), 'ошибка при неверном возрасте');
  await page.fill('[data-ob="age"]', '50');
  await click('[data-action="ob-next"]');
  check((await text()).includes('Шаг 2 из 4'), 'переход на шаг 2');
  await shot('02-onboarding-test');
  await click('[data-action="ob-next"]');
  check((await text()).includes('Ваши гантели'), 'шаг 3: гантели');
  await shot('03-onboarding-dumbbells');
  await click('[data-action="ob-next"]');
  t = await text();
  check(t.includes('Расписание'), 'шаг 4: расписание');
  await click('[data-action="ob-finish"]');
  check((await text()).includes('Подтвердите'), 'без галочки про врача нельзя завершить');
  await shot('04-onboarding-schedule');
  await page.check('[data-ob="agree"]');
  await click('[data-action="ob-finish"]');
  await page.waitForSelector('.hero');

  log('Вкладка «Тренировка»');
  t = await text();
  check(t.includes('Тренировка №1: Грудь и спина'), 'ближайшая тренировка №1');
  check(t.includes('Понедельник') || t.includes('Сегодня'), 'тренировка на сегодня (пн 23 ноября)');
  check(t.includes('вес подберём'), 'жим требует подбора веса');
  check(t.includes('Отжимания с медленным опусканием'), 'по тесту 15 отжиманий стартует со 2-й ступени');
  await shot('05-workout-idle');

  log('Перенос');
  await click('[data-action="move"]');
  await page.waitForSelector('dialog[open]');
  await shot('06-move-dialog');
  await page.fill('#move-date', '2026-11-24');
  await click('[data-dialog-action="one"]');
  await page.waitForTimeout(100);
  check((await text()).includes('вт, 24 ноября'), 'тренировка перенесена на вторник');
  check((await page.$('[data-action="undo-schedule"]')) !== null, 'доступна отмена переноса');
  await click('[data-action="undo-schedule"]');
  await page.waitForTimeout(100);
  check(!(await text()).includes('вт, 24 ноября'), 'отмена вернула дату');

  log('Тренировка: разминка');
  await click('[data-action="start"]');
  await page.waitForSelector('.workout');
  t = await text();
  check(t.includes('Разминка') && t.includes('Кошка-корова'), 'начинается с разминки');
  check(t.includes('Как выполнять'), 'есть описание техники');
  await shot('07-workout-warmup');
  for (let i = 0; i < 4; i++) await click('[data-action="record"]');
  t = await text();
  check(t.includes('Основная часть') && t.includes('Жим гантелей лёжа на полу'), 'после разминки жим гантелей');
  check(t.includes('Подберите вес'), 'просьба подобрать вес');
  await shot('08-workout-calibration');

  log('Подбор веса и подходы');
  const w0 = await page.inputValue('[data-input="weight"]');
  check(w0 === '8', `стартовое предложение 8 кг (получилось ${w0})`);
  for (let i = 0; i < 3; i++) await click('[data-action="inc"][data-field="weight"]');
  const w = await page.inputValue('[data-input="weight"]');
  check(w === '14', `вес гантели растёт по шагу 2 кг (получилось ${w})`);
  await click('[data-action="dec"][data-field="weight"]');
  await click('[data-action="dec"][data-field="weight"]');
  await click('[data-action="dec"][data-field="weight"]');
  await click('[data-action="inc"][data-field="reps"]');
  await click('[data-action="record"]');
  t = await text();
  check(t.includes('Отдых'), 'после подхода идёт отдых');
  await shot('09-rest');
  // таймер отдыха идёт по часам
  await page.clock.runFor(5000);
  const rt = await page.textContent('[data-timer-text]');
  check(/^01:2\d$/.test(rt) || /^01:30$/.test(rt) || /^01:25$/.test(rt), `таймер отдыха идёт (показывает ${rt})`);
  await click('[data-action="rest-add"]');
  await click('[data-action="rest-skip"]');
  t = await text();
  check(t.includes('Подход 2 из 2'), 'второй подход (в первой неделе подходов на один меньше)');
  const w2 = await page.inputValue('[data-input="weight"]');
  check(w2 !== '' && Number(w2) > 0, `вес подобран и подставлен (${w2} кг)`);

  // дальше быстро: все подходы с верхней границей, отдых пропускаем
  let guard = 0;
  let sawTimed = false;
  while (guard++ < 80) {
    t = await text();
    if (t.includes('Тренировка завершена')) break;
    if (await page.$('[data-action="rest-skip"]')) {
      await click('[data-action="rest-skip"]');
      continue;
    }
    if (await page.$('[data-action="timer-start"]')) {
      if (!sawTimed) {
        sawTimed = true;
        await click('[data-action="timer-start"]');
        t = await text();
        check(t.includes('приготовьтесь'), 'у упражнения на время сначала «приготовьтесь»');
        await page.clock.runFor(6000);
        check((await page.textContent('[data-timer-label]')) === 'идёт подход', 'затем идёт отсчёт подхода');
        await shot('10-timed-running');
        await page.clock.runFor(31000);
        await page.waitForTimeout(100);
        check((await text()).includes('Отдых') || (await text()).includes('Подход'), 'после окончания таймера подход записывается сам');
        continue;
      }
      await click('[data-action="record"]');
      continue;
    }
    await click('[data-action="record"]');
  }
  check(sawTimed, 'в тренировке встретилось упражнение на время (шаблон B?)');
  await shot('11-summary');
  t = await text();
  check(t.includes('Тренировка завершена') || t.includes('Выйти'), 'тренировка дошла до итогов');
  if (t.includes('Тренировка завершена')) {
    await page.fill('[data-input="note"]', 'Было нормально, спина не беспокоила');
    await page.fill('[data-input="bodyweight"]', '83.6');
    await click('[data-action="save-workout"]');
    await page.waitForSelector('.hero');
    t = await text();
    check(t.includes('Тренировка №2'), 'после сохранения ближайшая тренировка №2');
  }

  log('Вкладка «Программа»');
  await click('[data-tab="program"]');
  t = await text();
  check(t.includes('План на 3 года') && t.includes('Адаптация и основа') && t.includes('Закрепление'), 'виден план на 3 года');
  check(t.includes('Тренировка A: Грудь и спина'), 'видны шаблоны тренировок');
  await shot('12-program');
  await page.evaluate(() => window.scrollTo(0, 1200));
  await shot('13-program-schedule');

  log('Вкладка «Прогресс»');
  await click('[data-tab="progress"]');
  t = await text();
  check(t.includes('Личные рекорды') && t.includes('Динамика по упражнению'), 'статистика после первой тренировки');
  await shot('14-progress-stats');
  await click('[data-ptab="body"]');
  t = await text();
  check(t.includes('83,6 кг'), 'записанный вес тела виден');
  await shot('15-progress-body');
  await click('[data-ptab="history"]');
  check((await text()).includes('спина не беспокоила') === false, 'заметка скрыта до раскрытия записи');
  await page.click('.hist summary');
  check((await text()).includes('спина не беспокоила'), 'заметка видна в истории');
  await shot('16-progress-history');
  await click('[data-ptab="settings"]');
  await shot('17-settings');
  await click('[data-action="theme"][data-value="dark"]');
  check(await page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'dark'), 'тёмная тема включается');
  await shot('18-settings-dark');
  await click('[data-tab="workout"]');
  await shot('19-workout-dark');

  log('Настройки: дни, гантели, вес, пропуск');
  await click('[data-tab="progress"]');
  await click('[data-ptab="settings"]');
  await click('[data-action="set-day"][data-day="5"]'); // убираем пятницу
  await page.waitForTimeout(100);
  check(await page.evaluate(() => !document.querySelector('[data-action="set-day"][data-day="5"]').classList.contains('active')), 'день недели снимается');
  await click('[data-action="set-day"][data-day="5"]'); // возвращаем
  await page.fill('[data-dumbbell="max"]', '30');
  await page.dispatchEvent('[data-dumbbell="max"]', 'change');
  await page.waitForTimeout(100);
  check((await page.inputValue('[data-dumbbell="max"]')) === '30', 'максимальный вес гантелей изменён');
  await page.fill('[data-dumbbell="step"]', '0');
  await page.dispatchEvent('[data-dumbbell="step"]', 'change');
  await page.waitForTimeout(100);
  check((await page.inputValue('[data-dumbbell="step"]')) === '2', 'неверный шаг гантелей отклонён');
  await click('[data-ptab="body"]');
  await page.fill('#bw-value', '82.9');
  await click('[data-action="add-body"]');
  check((await text()).includes('82,9 кг'), 'новая запись веса отображается');
  await click('[data-tab="workout"]');
  await click('[data-action="skip-session"]');
  await click('[data-dialog-action="yes"]');
  await page.waitForTimeout(100);
  check((await text()).includes('Тренировка №3'), 'после пропуска №2 ближайшая №3');
  await click('[data-action="undo-schedule"]');
  check((await text()).includes('Тренировка №2'), 'пропуск отменяется');

  log('Резервная копия');
  await click('[data-tab="progress"]');
  await click('[data-ptab="settings"]');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export"]')]);
  const backupPath = path.join(out, 'backup.json');
  await download.saveAs(backupPath);
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  check(backup.format === 'dad-workout-backup' && backup.workouts.length === 1 && backup.bodyLog.length === 3, `копия содержит тренировку и записи веса (${backup.workouts.length}, ${backup.bodyLog.length})`);
  await click('[data-action="reset"]');
  await click('[data-dialog-action="yes"]');
  await page.waitForSelector('dialog[open]');
  await click('[data-dialog-action="yes"]');
  await page.waitForSelector('.onboarding');
  check((await text()).includes('Шаг 1 из 4'), 'после удаления данных снова первый запуск');
  // чтобы импортировать, нужна вкладка настроек: проходим первый запуск заново и загружаем копию
  await click('[data-action="ob-next"]');
  await click('[data-action="ob-next"]');
  await click('[data-action="ob-next"]');
  await page.check('[data-ob="agree"]');
  await click('[data-action="ob-finish"]');
  await page.waitForSelector('.hero');
  check((await text()).includes('Тренировка №1'), 'после нового первого запуска снова тренировка №1');
  await click('[data-tab="progress"]');
  await click('[data-ptab="settings"]');
  await page.setInputFiles('#import-file', backupPath);
  await page.waitForSelector('dialog[open]');
  await click('[data-dialog-action="yes"]');
  await page.waitForTimeout(200);
  await click('[data-tab="workout"]');
  check((await text()).includes('Тренировка №2'), 'копия восстановила прогресс (ближайшая тренировка №2)');
  await click('[data-tab="progress"]');
  await click('[data-ptab="history"]');
  check((await text()).includes('№1 · Грудь и спина'), 'история восстановлена из копии');
  // повреждённый файл
  fs.writeFileSync(path.join(out, 'bad.json'), '{"это не копия"');
  await click('[data-ptab="settings"]');
  await page.setInputFiles('#import-file', path.join(out, 'bad.json'));
  await page.waitForSelector('dialog[open]');
  await click('[data-dialog-action="yes"]');
  await page.waitForTimeout(150);
  check((await text()).includes('повреждён'), 'повреждённый файл отклоняется с понятным сообщением');
  check(!(await page.$('.onboarding')), 'данные не пострадали после неудачного импорта');

  log('Сохранение данных между запусками');
  await page.reload();
  await page.waitForSelector('.hero');
  check((await text()).includes('Тренировка №2'), 'после перезагрузки данные на месте');
  check(await page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'dark'), 'тема сохранилась');

  log('Офлайн');
  await page.waitForTimeout(500);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('.hero', { timeout: 8000 }).catch(() => {});
  check((await text()).includes('Тренировка №2'), 'без интернета приложение открывается');
  await ctx.setOffline(false);

  await browser.close();
  server.close();
  const unexpected = problems.filter((p) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(p));
  log(unexpected.length ? `\nПроблемы (${unexpected.length}):\n- ${unexpected.join('\n- ')}` : '\nВсе проверки пройдены');
  process.exit(unexpected.length ? 1 : 0);
})().catch((e) => {
  console.error('Сбой скрипта:', e);
  process.exit(2);
});
