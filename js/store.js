// Состояние приложения и все действия, которые его меняют.
// Экраны только читают S и вызывают действия отсюда.

import * as db from './db.js';
import { validateProgram, validateContent, expandProgram } from './logic/program.js';
import { todayISO, diffDays } from './logic/dates.js';
import { createSchedule, moveOne, shiftFrom, skip, undoLast, completeSession, nextPlanned, replan, extendSchedule } from './logic/schedule.js';
import { initialStates, buildWorkout, summarizeWorkout, finalizeStates } from './logic/workout.js';
import { easeFactorAfterBreak } from './logic/progression.js';
import { availableWeights, floorToAvailable, weightLadder, nextWeight, prevWeight } from './logic/equipment.js';
import { buildBackup, parseBackup } from './logic/backup.js';
import * as flow from './logic/flow.js';

const KEYS = ['profile', 'settings', 'schedule', 'states', 'workouts', 'bodyLog', 'active'];

export const DEFAULT_SETTINGS = { theme: 'auto', sound: true, vibration: true, restScale: 1, lastBackup: null };

export const S = {
  loaded: false,
  error: null,
  persistent: true,
  saveError: false,
  lib: null,
  program: null,
  sessions: [],
  profile: null,
  settings: { ...DEFAULT_SETTINGS },
  schedule: null,
  states: {},
  workouts: [],
  bodyLog: [],
  active: null,
  ui: { tab: 'workout', progressTab: 'stats', summary: null, showVideo: {}, exercise: null },
};

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Не удалось загрузить ${path} (${res.status})`);
  return res.json();
}

/** После обновления программы: достроить расписание и добавить состояния новых упражнений. */
function reconcile() {
  if (!S.profile) return;
  const fresh = initialStates(S.program, S.lib, S.profile.test);
  for (const [id, st] of Object.entries(fresh)) if (!(id in S.states)) S.states[id] = st;
  if (S.schedule) {
    S.schedule = extendSchedule(S.schedule, S.sessions, { weekdays: S.profile.weekdays, fromDate: todayISO() });
  }
}

export async function init() {
  try {
    const [program, lib] = await Promise.all([loadJson('./data/program.json'), loadJson('./data/exercises.json')]);
    const errors = [...validateProgram(program), ...validateContent(program, lib)];
    if (errors.length) throw new Error(`Ошибка в программе: ${errors.slice(0, 3).join('; ')}`);
    S.program = program;
    S.lib = lib;
    S.sessions = expandProgram(program);

    const data = await db.getAll(KEYS);
    S.persistent = await db.isPersistent();
    S.profile = data.profile;
    S.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
    S.schedule = data.schedule;
    S.states = data.states || {};
    S.workouts = data.workouts || [];
    S.bodyLog = data.bodyLog || [];
    S.active = data.active;
    reconcile();
    S.loaded = true;
  } catch (e) {
    console.error(e);
    S.error = e.message || String(e);
  }
}

async function persist(...keys) {
  const entries = {};
  for (const k of keys) entries[k] = S[k];
  try {
    await db.setMany(entries);
    S.saveError = false;
    return true;
  } catch (e) {
    console.error('Не удалось сохранить', e);
    S.saveError = true;
    return false;
  }
}

// ---------- Вспомогательное ----------

export const blockOf = (session) => S.program.phases.flatMap((p) => p.blocks).find((b) => b.id === session.blockId);
export const phaseOf = (session) => S.program.phases.find((p) => p.id === session.phaseId);
export const sessionByNumber = (n) => S.sessions.find((s) => s.number === n);

export function nextSessionInfo() {
  const entry = S.schedule && nextPlanned(S.schedule);
  if (!entry) return null;
  return { entry, session: sessionByNumber(entry.number) };
}

export function lastWorkoutDate() {
  return S.workouts.reduce((m, w) => (w.doneDate > m ? w.doneDate : m), '') || null;
}

export function daysSinceLastWorkout(today = todayISO()) {
  const last = lastWorkoutDate();
  return last ? diffDays(last, today) : 0;
}

export const currentEase = (today = todayISO()) => easeFactorAfterBreak(daysSinceLastWorkout(today));

export function previewWorkout() {
  const info = nextSessionInfo();
  if (!info) return null;
  return buildWorkout({
    program: S.program,
    lib: S.lib,
    session: info.session,
    states: S.states,
    dumbbells: S.profile.dumbbells,
    easeFactor: currentEase(),
  });
}

const flowCtx = () => ({ now: Date.now(), restScale: S.settings.restScale || 1, workouts: S.workouts, dumbbells: S.profile.dumbbells });

async function commit(extraKeys = []) {
  if (S.active?.phase === 'summary' && !S.active.finishedAt) S.active.finishedAt = Date.now();
  return persist('active', ...extraKeys);
}

// ---------- Первый запуск ----------

export async function completeOnboarding(f) {
  const today = todayISO();
  S.profile = {
    age: f.age,
    heightCm: f.heightCm,
    weightKg: f.weightKg,
    test: { pushups: f.pushups, pullups: f.pullups },
    dumbbells: f.dumbbells,
    weekdays: f.weekdays,
    createdAt: today,
  };
  S.schedule = createSchedule(S.sessions, { startDate: f.startDate || today, weekdays: f.weekdays });
  S.states = initialStates(S.program, S.lib, S.profile.test);
  S.workouts = [];
  S.bodyLog = [{ date: today, weightKg: f.weightKg }];
  S.active = null;
  S.ui.tab = 'workout';
  const ok = await persist(...KEYS);
  db.requestPersistence();
  return ok;
}

// ---------- Тренировка ----------

export async function startWorkout() {
  const info = nextSessionInfo();
  if (!info) return false;
  const workout = previewWorkout();
  S.active = flow.startActive(workout, { date: info.entry.date, now: Date.now(), workouts: S.workouts, dumbbells: S.profile.dumbbells });
  S.ui.summary = null;
  return commit();
}

export async function recordSet() {
  const r = flow.completeSet(S.active, flowCtx());
  S.active = r.active;
  const extra = [];
  if (r.stateUpdate) {
    const { exerciseId, weight } = r.stateUpdate;
    S.states = { ...S.states, [exerciseId]: { ...S.states[exerciseId], weight } };
    extra.push('states');
  }
  return commit(extra);
}

export async function skipExercise() {
  S.active = flow.skipItem(S.active, flowCtx());
  return commit();
}

export async function finishEarly() {
  S.active = flow.finishEarly(S.active);
  return commit();
}

export async function endRestNow() {
  S.active = flow.endRest(S.active);
  return commit();
}

export async function addRestTime(seconds) {
  S.active = flow.addRest(S.active, seconds);
  return commit();
}

export async function startTimer(prepSec) {
  S.active = flow.startTimed(S.active, Date.now(), prepSec);
  return commit();
}

export async function stopTimer() {
  S.active = flow.stopTimed(S.active, Date.now());
  return commit();
}

export async function discardWorkout() {
  S.active = null;
  S.ui.summary = null;
  return persist('active');
}

/** Изменение вводимого значения подхода кнопками − и +. */
export function adjustDraft(field, dir) {
  const item = flow.currentItem(S.active);
  const d = S.active.draft;
  if (field === 'reps') d.reps = Math.min(200, Math.max(0, (d.reps ?? 0) + dir));
  else if (field === 'seconds') d.seconds = Math.min(3600, Math.max(5, (d.seconds ?? 30) + dir * 5));
  else if (field === 'weight') {
    const list = weightLadder(item.load, S.profile.dumbbells);
    const next = dir > 0 ? nextWeight(d.weight ?? 0, list) : prevWeight(d.weight ?? 0, list);
    if (next !== null) d.weight = next;
  }
}

export function setDraftValue(field, value) {
  const d = S.active.draft;
  if (field === 'reserve') d.reserve = value;
  else if (Number.isFinite(value)) d[field] = value;
}

export function getSummary() {
  if (!S.active || S.active.phase !== 'summary') return null;
  if (!S.ui.summary || S.ui.summary.startedAt !== S.active.startedAt) {
    const r = summarizeWorkout(S.active, {
      states: S.states,
      dumbbells: S.profile.dumbbells,
      now: S.active.finishedAt ?? Date.now(),
      today: todayISO(),
    });
    S.ui.summary = {
      startedAt: S.active.startedAt,
      ...r,
      accepted: new Set(r.suggestions.filter((s) => s.suggestion.type !== 'hold').map((s) => s.exerciseId)),
    };
  }
  return S.ui.summary;
}

export async function saveWorkout({ note, bodyWeight }) {
  const sum = getSummary();
  const today = todayISO();
  if (!sum || sum.log.items.length === 0) return discardWorkout();

  const accepted = sum.suggestions.filter((s) => s.suggestion.type !== 'hold' && sum.accepted.has(s.exerciseId));
  S.states = finalizeStates(S.states, S.active, sum.failStreaks, accepted);
  S.workouts = [...S.workouts, { ...sum.log, note: (note || '').trim() }];
  const r = completeSession(S.schedule, S.active.number, today);
  if (r.ok) S.schedule = r.state;
  if (Number.isFinite(bodyWeight) && bodyWeight > 0) S.bodyLog = [...S.bodyLog, { date: today, weightKg: bodyWeight }];
  S.active = null;
  S.ui.summary = null;
  return persist('states', 'workouts', 'schedule', 'bodyLog', 'active');
}

// ---------- Расписание ----------

export async function moveSession(number, date, mode) {
  const fn = mode === 'all' ? shiftFrom : moveOne;
  const r = fn(S.schedule, number, date, { today: todayISO() });
  if (r.ok) {
    S.schedule = r.state;
    await persist('schedule');
  }
  return r;
}

export async function skipSession(number) {
  const r = skip(S.schedule, number);
  if (r.ok) {
    S.schedule = r.state;
    await persist('schedule');
  }
  return r;
}

export async function undoSchedule() {
  const r = undoLast(S.schedule);
  if (r.ok) {
    S.schedule = r.state;
    await persist('schedule');
  }
  return r;
}

/** Проверка переноса без применения (чтобы показать предупреждения). */
export function previewMove(number, date, mode) {
  const fn = mode === 'all' ? shiftFrom : moveOne;
  return fn(S.schedule, number, date, { today: todayISO() });
}

// ---------- Тело и настройки ----------

export async function addBodyWeight(date, weightKg) {
  S.bodyLog = [...S.bodyLog, { date, weightKg }];
  if (date === todayISO()) S.profile = { ...S.profile, weightKg };
  return persist('bodyLog', 'profile');
}

export async function removeBodyEntry(index) {
  S.bodyLog = S.bodyLog.filter((_, i) => i !== index);
  return persist('bodyLog');
}

export async function updateProfile(patch) {
  S.profile = { ...S.profile, ...patch };
  return persist('profile');
}

export async function updateSettings(patch) {
  S.settings = { ...S.settings, ...patch };
  return persist('settings');
}

export async function updateDumbbells(dumbbells) {
  const list = availableWeights(dumbbells);
  const states = { ...S.states };
  for (const [id, st] of Object.entries(states)) {
    const ex = S.lib.exercises[id];
    if (ex && ex.load !== 'bodyweight' && typeof st.weight === 'number' && st.weight > 0 && list.length) {
      states[id] = { ...st, weight: floorToAvailable(st.weight, list) };
    }
  }
  S.states = states;
  S.profile = { ...S.profile, dumbbells };
  return persist('profile', 'states');
}

export async function updateWeekdays(weekdays) {
  S.profile = { ...S.profile, weekdays };
  S.schedule = replan(S.schedule, S.sessions, { weekdays, fromDate: todayISO() });
  return persist('profile', 'schedule');
}

// ---------- Резервные копии ----------

export async function exportBackup() {
  const text = buildBackup(Object.fromEntries(KEYS.map((k) => [k, S[k]])));
  await updateSettings({ lastBackup: todayISO() });
  return text;
}

export async function importBackup(text) {
  const r = parseBackup(text);
  if (!r.ok) return r;
  const d = r.data;
  S.profile = d.profile;
  S.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
  S.schedule = d.schedule;
  S.states = d.states;
  S.workouts = d.workouts;
  S.bodyLog = d.bodyLog;
  S.active = d.active;
  S.ui.summary = null;
  reconcile();
  const ok = await persist(...KEYS);
  return { ok, data: d, error: ok ? undefined : 'Не удалось сохранить данные' };
}

export async function resetAll() {
  const empty = Object.fromEntries(KEYS.map((k) => [k, null]));
  try {
    await db.setMany(empty);
  } catch (e) {
    console.error(e);
  }
  S.profile = null;
  S.settings = { ...DEFAULT_SETTINGS };
  S.schedule = null;
  S.states = {};
  S.workouts = [];
  S.bodyLog = [];
  S.active = null;
  S.ui = { tab: 'workout', progressTab: 'stats', summary: null, showVideo: {}, exercise: null };
}
