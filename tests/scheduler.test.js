import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/background/scheduler.js');
const scheduler = globalThis.OBA_Scheduler;

test('computeNextRunTimestamp returns the timestamp for a future "once" schedule', () => {
  const now = Date.now();
  const at = now + 60_000;
  assert.equal(scheduler.computeNextRunTimestamp({ type: 'once', at }, now), at);
});

test('computeNextRunTimestamp returns null for a past "once" schedule', () => {
  const now = Date.now();
  assert.equal(scheduler.computeNextRunTimestamp({ type: 'once', at: now - 1000 }, now), null);
});

test('computeNextRunTimestamp returns later today for a recurring schedule whose time has not passed yet', () => {
  const now = new Date(2026, 6, 23, 10, 0, 0).getTime();
  const today = new Date(now).getDay();
  const next = scheduler.computeNextRunTimestamp({ type: 'recurring', hour: 11, minute: 0, daysOfWeek: [today] }, now);
  const nextDate = new Date(next);
  assert.equal(nextDate.getDate(), new Date(now).getDate());
  assert.equal(nextDate.getHours(), 11);
});

test('computeNextRunTimestamp rolls over to next week when today\'s time has already passed', () => {
  const now = new Date(2026, 6, 23, 10, 0, 0).getTime();
  const today = new Date(now).getDay();
  const next = scheduler.computeNextRunTimestamp({ type: 'recurring', hour: 9, minute: 0, daysOfWeek: [today] }, now);
  const nextDate = new Date(next);
  assert.equal(nextDate.getDay(), today);
  assert.ok(next > now + 6 * 24 * 60 * 60 * 1000);
});

test('alarmNameForTask is stable and namespaced', () => {
  assert.equal(scheduler.alarmNameForTask('abc'), 'oba-task-abc');
});

test('wireScheduler.scheduleTask creates an alarm for a future schedule', async () => {
  const created = [];
  const fakeAlarms = { create: (name, opts) => created.push({ name, opts }), onAlarm: { addListener: () => {} } };
  const now = Date.now();
  const controller = scheduler.wireScheduler({
    getTasks: async () => [],
    saveTask: async () => {},
    runTask: async () => {},
    alarms: fakeAlarms,
    now: () => now
  });

  await controller.scheduleTask({ id: 't1', schedule: { type: 'once', at: now + 60_000 } });
  assert.equal(created.length, 1);
  assert.equal(created[0].name, 'oba-task-t1');
  assert.equal(created[0].opts.when, now + 60_000);
});

test('wireScheduler.onAlarm runs the task, clears schedule for "once", and re-schedules "recurring"', async () => {
  const created = [];
  const savedTasks = [];
  const runCalls = [];
  const now = new Date(2026, 6, 23, 10, 0, 0).getTime();
  const today = new Date(now).getDay();

  const onceTask = { id: 'once-1', schedule: { type: 'once', at: now - 1000 } };
  const recurringTask = { id: 'rec-1', schedule: { type: 'recurring', hour: 11, minute: 0, daysOfWeek: [today] } };

  const fakeAlarms = { create: (name, opts) => created.push({ name, opts }), onAlarm: { addListener: () => {} } };
  const controller = scheduler.wireScheduler({
    getTasks: async () => [onceTask, recurringTask],
    saveTask: async (task) => savedTasks.push(task),
    runTask: async (task) => runCalls.push(task.id),
    alarms: fakeAlarms,
    now: () => now
  });

  await controller.onAlarm({ name: 'oba-task-once-1' });
  assert.deepEqual(runCalls, ['once-1']);
  assert.equal(savedTasks[0].schedule, null);

  await controller.onAlarm({ name: 'oba-task-rec-1' });
  assert.deepEqual(runCalls, ['once-1', 'rec-1']);
  assert.equal(created.length, 1);
  assert.equal(created[0].name, 'oba-task-rec-1');
});
