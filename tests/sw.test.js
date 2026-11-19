import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const listed = new Set([...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean));

function walk(dir) {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    return statSync(join(root, rel)).isDirectory() ? walk(rel) : [rel];
  });
}

test('офлайн-кэш содержит все файлы приложения', () => {
  const files = ['js', 'css', 'icons', 'data'].flatMap(walk);
  const missing = files.filter((f) => !listed.has(f));
  assert.deepEqual(missing, [], `Добавьте в PRECACHE в sw.js: ${missing.join(', ')}`);
});

test('в офлайн-кэше нет несуществующих файлов', () => {
  const absent = [...listed].filter((f) => !existsSync(join(root, f)));
  assert.deepEqual(absent, []);
});

test('все иконки манифеста существуют, подмена версии кэша возможна', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
  for (const icon of manifest.icons) assert.ok(existsSync(join(root, icon.src)), icon.src);
  assert.match(sw, /const CACHE_VERSION = '.*';/);
  assert.ok(listed.has('index.html') && listed.has('manifest.webmanifest'));
});
