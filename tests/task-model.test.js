import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/shared/id.js');
await import('../src/shared/task-model.js');

const { createTask, validateTask } = globalThis.OBA_TaskModel;

test('createTask fills in defaults and generates an id', () => {
  const task = createTask({ name: 'Test', prompt: 'Do the thing', providerProfileId: 'p1' });
  assert.ok(task.id);
  assert.equal(task.strategy, 'dom');
  assert.equal(task.autonomyMode, 'autonomous');
  assert.equal(task.schedule, null);
});

test('validateTask accepts a fully-formed task', () => {
  const task = createTask({ name: 'Test', prompt: 'Do the thing', providerProfileId: 'p1' });
  assert.deepEqual(validateTask(task), []);
});

test('validateTask rejects missing name and prompt', () => {
  const errors = validateTask({ providerProfileId: 'p1', strategy: 'dom', autonomyMode: 'autonomous' });
  assert.ok(errors.includes('name is required'));
  assert.ok(errors.includes('prompt is required'));
});

test('validateTask rejects invalid strategy and autonomyMode', () => {
  const task = createTask({ name: 'T', prompt: 'P', providerProfileId: 'p1' });
  task.strategy = 'telepathy';
  task.autonomyMode = 'yolo';
  const errors = validateTask(task);
  assert.ok(errors.some((e) => e.includes('strategy')));
  assert.ok(errors.some((e) => e.includes('autonomyMode')));
});

test('validateTask requires "at" for a once schedule', () => {
  const task = createTask({ name: 'T', prompt: 'P', providerProfileId: 'p1', schedule: { type: 'once' } });
  const errors = validateTask(task);
  assert.ok(errors.some((e) => e.includes('schedule.at')));
});

test('validateTask requires hour/minute/daysOfWeek for a recurring schedule', () => {
  const task = createTask({ name: 'T', prompt: 'P', providerProfileId: 'p1', schedule: { type: 'recurring' } });
  const errors = validateTask(task);
  assert.ok(errors.some((e) => e.includes('schedule.hour')));
  assert.ok(errors.some((e) => e.includes('schedule.minute')));
  assert.ok(errors.some((e) => e.includes('schedule.daysOfWeek')));
});
