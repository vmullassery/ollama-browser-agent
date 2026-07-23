import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/background/agent-loop.js');
const { runStep, runTask, isSensitiveAction } = globalThis.OBA_AgentLoop;

function makeTask(overrides = {}) {
  return { id: 't1', prompt: 'do it', autonomyMode: 'autonomous', ...overrides };
}

test('isSensitiveAction flags submit/purchase/download/navigate-new-domain', () => {
  assert.equal(isSensitiveAction({ type: 'submit' }), true);
  assert.equal(isSensitiveAction({ type: 'click' }), false);
});

test('runStep executes the decided action on the happy path', async () => {
  const deps = {
    observe: async () => ({ elements: [] }),
    decide: async () => ({ type: 'click', elementId: 0 }),
    requestApproval: async () => { throw new Error('should not be called'); },
    execute: async (action) => ({ clicked: action.elementId }),
    recordStep: async () => {}
  };
  const result = await runStep({ task: makeTask(), deps, history: [] });
  assert.equal(result.status, 'done');
  assert.deepEqual(result.result, { clicked: 0 });
});

test('runStep asks for approval on a sensitive action in approve-sensitive mode, and stops if denied', async () => {
  let executeCalled = false;
  const deps = {
    observe: async () => ({}),
    decide: async () => ({ type: 'submit' }),
    requestApproval: async () => false,
    execute: async () => { executeCalled = true; },
    recordStep: async () => {}
  };
  const result = await runStep({ task: makeTask({ autonomyMode: 'approve-sensitive' }), deps, history: [] });
  assert.equal(result.status, 'rejected');
  assert.equal(executeCalled, false);
});

test('runStep does not ask for approval on a non-sensitive action in approve-sensitive mode', async () => {
  let approvalCalled = false;
  const deps = {
    observe: async () => ({}),
    decide: async () => ({ type: 'click', elementId: 0 }),
    requestApproval: async () => { approvalCalled = true; return true; },
    execute: async () => ({}),
    recordStep: async () => {}
  };
  const result = await runStep({ task: makeTask({ autonomyMode: 'approve-sensitive' }), deps, history: [] });
  assert.equal(result.status, 'done');
  assert.equal(approvalCalled, false);
});

test('runStep marks the step failed when execute throws', async () => {
  const deps = {
    observe: async () => ({}),
    decide: async () => ({ type: 'click', elementId: 0 }),
    requestApproval: async () => true,
    execute: async () => { throw new Error('boom'); },
    recordStep: async () => {}
  };
  const result = await runStep({ task: makeTask(), deps, history: [] });
  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'boom');
});

test('runTask returns success as soon as the model returns a "done" action', async () => {
  const deps = {
    observe: async () => ({}),
    decide: async () => ({ type: 'done' }),
    requestApproval: async () => true,
    execute: async () => ({ done: true }),
    recordStep: async () => {}
  };
  const result = await runTask(makeTask(), deps);
  assert.equal(result.status, 'success');
  assert.equal(result.steps.length, 1);
});

test('runTask retries a failing step exactly once before aborting the run', async () => {
  let executeCalls = 0;
  const deps = {
    observe: async () => ({}),
    decide: async () => ({ type: 'click', elementId: 0 }),
    requestApproval: async () => true,
    execute: async () => { executeCalls += 1; throw new Error('boom'); },
    recordStep: async () => {}
  };
  const result = await runTask(makeTask(), deps);
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'too many consecutive failures');
  assert.equal(executeCalls, 2);
});

test('runTask stops immediately when a step is rejected', async () => {
  const deps = {
    observe: async () => ({}),
    decide: async () => ({ type: 'submit' }),
    requestApproval: async () => false,
    execute: async () => { throw new Error('should not be called'); },
    recordStep: async () => {}
  };
  const result = await runTask(makeTask({ autonomyMode: 'approve-all' }), deps);
  assert.equal(result.status, 'stopped');
  assert.equal(result.reason, 'rejected');
  assert.equal(result.steps.length, 1);
});
