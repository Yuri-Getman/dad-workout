// Хранилище на телефоне. IndexedDB, а если он недоступен (например, приватный режим),
// данные живут в памяти до закрытия страницы, и приложение показывает предупреждение.
//
// Ключи: profile, settings, schedule, states, workouts, bodyLog, active.

const DB_NAME = 'dad-workout';
const STORE = 'kv';

const memory = new Map();
let dbPromise = null;
let persistent = true;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        persistent = false;
        resolve(null);
      };
      req.onblocked = () => {
        persistent = false;
        resolve(null);
      };
    } catch {
      persistent = false;
      resolve(null);
    }
  });
  return dbPromise;
}

export async function isPersistent() {
  await open();
  return persistent;
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function get(key) {
  const db = await open();
  if (!db) return memory.has(key) ? structuredClone(memory.get(key)) : null;
  const value = await wrap(db.transaction(STORE, 'readonly').objectStore(STORE).get(key));
  return value === undefined ? null : value;
}

export async function set(key, value) {
  const db = await open();
  if (!db) {
    memory.set(key, structuredClone(value));
    return;
  }
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function remove(key) {
  const db = await open();
  if (!db) {
    memory.delete(key);
    return;
  }
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

/** Записать несколько ключей одной транзакцией: либо всё, либо ничего. */
export async function setMany(entries) {
  const db = await open();
  if (!db) {
    for (const [k, v] of Object.entries(entries)) memory.set(k, structuredClone(v));
    return;
  }
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const [k, v] of Object.entries(entries)) {
      if (v === null || v === undefined) store.delete(k);
      else store.put(v, k);
    }
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getAll(keys) {
  const out = {};
  for (const k of keys) out[k] = await get(k);
  return out;
}

/** Просим браузер не удалять данные при нехватке места. */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    // не критично
  }
  return false;
}
