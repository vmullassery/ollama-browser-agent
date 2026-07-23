# Ollama Browser Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Manifest V3 Chrome extension that drives browser automation tasks via any OpenAI-compatible model endpoint (Ollama, LM Studio, vLLM, etc.), with DOM- and vision-based grounding, a visible action overlay, saved/scheduled tasks, and multiple provider profiles.

**Architecture:** Vanilla JS, zero build step. Every source file attaches its API to a `globalThis.OBA_<Name>` namespace instead of using `import`/`export`, so the same file loads unmodified as a classic content-script `<script>`, an ES-module-context background script (`import './file.js'` for side effects), an extension-page `<script src>`, and a Node ESM test target (`await import(...)`). The MV3 service worker hosts the agent loop directly (fetch/message activity resets its 30s idle timer during an active run); `chrome.alarms` wakes it for scheduled tasks.

**Tech Stack:** Vanilla JavaScript (ES2022), Chrome Manifest V3 APIs (`storage`, `alarms`, `tabs`, `scripting`, `sidePanel`), Node's built-in `node:test` + `node:assert` for unit tests (zero test dependencies).

## Global Constraints

- No build step, no bundler, no npm runtime dependencies — matches the "no build step" pattern locked in during design.
- No cloud backend or telemetry. All state in `chrome.storage.local`.
- No branding, code, or naming shared with Anthropic's Claude in Chrome extension or any other product — this is an independent project (per design's stated goal).
- No automated test suite for browser-integration code (DOM scanning, page actions, overlays, UI) — manual verification via unpacked extension load only, per the design's explicit Non-Goal. Pure-logic modules (task validation, storage wrapper, provider client, scheduler math, DOM-strategy formatting/parsing, agent loop control flow) DO get real unit tests — this isn't covered by that Non-Goal since it needs no browser.
- `autonomyMode` is per-task, not global (design §3).
- Retry policy for a failed step: re-observe and retry exactly once before aborting the run (design §6).

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `manifest.json`
- Create: `.gitignore`

**Interfaces:**
- Produces: `package.json` with `"type": "module"` and a `test` script, so every later task's `node --test` command works unmodified.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "ollama-browser-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Chrome extension for browser automation driven by Ollama or any OpenAI-compatible LLM/VLM endpoint.",
  "scripts": {
    "test": "node --test tests/"
  }
}
```

- [ ] **Step 2: Create `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Ollama Browser Agent",
  "version": "0.1.0",
  "description": "Browser automation agent driven by Ollama or any OpenAI-compatible LLM/VLM endpoint.",
  "permissions": ["storage", "alarms", "activeTab", "scripting", "sidePanel", "tabs"],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "src/background/service-worker.js",
    "type": "module"
  },
  "side_panel": {
    "default_path": "src/sidepanel/sidepanel.html"
  },
  "action": {
    "default_title": "Ollama Browser Agent"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "run_at": "document_idle",
      "js": [
        "src/content/dom-scan.js",
        "src/content/dom-strategy.js",
        "src/content/visual-overlay.js",
        "src/content/page-actions.js",
        "src/content/content-script.js"
      ]
    }
  ]
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
*.log
```

- [ ] **Step 4: Verify Node test runner works with an empty tests directory**

Run: `mkdir -p tests && npm test`
Expected: exits 0 with `# pass 0` (no test files yet — this just confirms the script/runner wiring is correct before any test files exist).

- [ ] **Step 5: Commit**

```bash
git add package.json manifest.json .gitignore tests
git commit -m "chore: scaffold project (package.json, manifest.json)"
```

---

## Task 2: Task Model (`id.js` + `task-model.js`)

**Files:**
- Create: `src/shared/id.js`
- Create: `src/shared/task-model.js`
- Test: `tests/task-model.test.js`

**Interfaces:**
- Produces: `globalThis.OBA_Id.generateId(): string`
- Produces: `globalThis.OBA_TaskModel.createTask(input): Task`, `globalThis.OBA_TaskModel.validateTask(task): string[]` (empty array = valid), `VALID_STRATEGIES`, `VALID_AUTONOMY_MODES`
- Task shape: `{ id, name, prompt, startUrl, providerProfileId, strategy: 'dom'|'visual', autonomyMode: 'autonomous'|'approve-sensitive'|'approve-all', schedule: null | {type:'once', at} | {type:'recurring', hour, minute, daysOfWeek} }`

- [ ] **Step 1: Write the failing test**

Create `tests/task-model.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `globalThis.OBA_TaskModel is undefined` (files don't exist yet).

- [ ] **Step 3: Write `src/shared/id.js`**

```js
(function () {
  function generateId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  globalThis.OBA_Id = { generateId };
})();
```

- [ ] **Step 4: Write `src/shared/task-model.js`**

```js
(function () {
  const VALID_STRATEGIES = ['dom', 'visual'];
  const VALID_AUTONOMY_MODES = ['autonomous', 'approve-sensitive', 'approve-all'];

  function createTask(input) {
    return {
      id: input.id || globalThis.OBA_Id.generateId(),
      name: input.name,
      prompt: input.prompt,
      startUrl: input.startUrl || null,
      providerProfileId: input.providerProfileId,
      strategy: input.strategy || 'dom',
      autonomyMode: input.autonomyMode || 'autonomous',
      schedule: input.schedule || null
    };
  }

  function validateTask(task) {
    const errors = [];
    if (!task || typeof task !== 'object') {
      return ['task must be an object'];
    }
    if (!task.name || typeof task.name !== 'string') errors.push('name is required');
    if (!task.prompt || typeof task.prompt !== 'string') errors.push('prompt is required');
    if (!task.providerProfileId) errors.push('providerProfileId is required');
    if (!VALID_STRATEGIES.includes(task.strategy)) {
      errors.push(`strategy must be one of ${VALID_STRATEGIES.join(', ')}`);
    }
    if (!VALID_AUTONOMY_MODES.includes(task.autonomyMode)) {
      errors.push(`autonomyMode must be one of ${VALID_AUTONOMY_MODES.join(', ')}`);
    }

    if (task.schedule) {
      if (task.schedule.type === 'once') {
        if (typeof task.schedule.at !== 'number') errors.push('schedule.at must be a timestamp for type "once"');
      } else if (task.schedule.type === 'recurring') {
        if (typeof task.schedule.hour !== 'number' || task.schedule.hour < 0 || task.schedule.hour > 23) {
          errors.push('schedule.hour must be 0-23');
        }
        if (typeof task.schedule.minute !== 'number' || task.schedule.minute < 0 || task.schedule.minute > 59) {
          errors.push('schedule.minute must be 0-59');
        }
        if (!Array.isArray(task.schedule.daysOfWeek) || task.schedule.daysOfWeek.length === 0) {
          errors.push('schedule.daysOfWeek must be a non-empty array');
        }
      } else {
        errors.push('schedule.type must be "once" or "recurring"');
      }
    }

    return errors;
  }

  globalThis.OBA_TaskModel = { createTask, validateTask, VALID_STRATEGIES, VALID_AUTONOMY_MODES };
})();
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all 6 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/shared/id.js src/shared/task-model.js tests/task-model.test.js
git commit -m "feat: add task model with validation"
```

---

## Task 3: Storage Wrapper

**Files:**
- Create: `src/shared/storage.js`
- Test: `tests/storage.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks (only `chrome.storage.local`, mocked in tests).
- Produces: `globalThis.OBA_Storage.{getProfiles, saveProfile, deleteProfile, getTasks, saveTask, deleteTask, getHistory, appendHistoryEntry}` — all async, all operating on plain arrays of objects with a stable `id` field.

- [ ] **Step 1: Write the failing test**

Create `tests/storage.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

function installFakeChromeStorage() {
  const backing = {};
  globalThis.chrome = {
    storage: {
      local: {
        get(keys, callback) {
          const result = {};
          keys.forEach((key) => { result[key] = backing[key]; });
          callback(result);
        },
        set(values, callback) {
          Object.assign(backing, values);
          callback();
        }
      }
    }
  };
  return backing;
}

const backing = installFakeChromeStorage();
await import('../src/shared/storage.js');
const storage = globalThis.OBA_Storage;

test('getProfiles returns an empty array when nothing is stored', async () => {
  assert.deepEqual(await storage.getProfiles(), []);
});

test('saveProfile adds a new profile, then updates it by id', async () => {
  await storage.saveProfile({ id: 'p1', name: 'Home Ollama' });
  assert.deepEqual(await storage.getProfiles(), [{ id: 'p1', name: 'Home Ollama' }]);

  await storage.saveProfile({ id: 'p1', name: 'Renamed' });
  assert.deepEqual(await storage.getProfiles(), [{ id: 'p1', name: 'Renamed' }]);
});

test('deleteProfile removes it by id', async () => {
  await storage.saveProfile({ id: 'p2', name: 'Other' });
  await storage.deleteProfile('p1');
  const profiles = await storage.getProfiles();
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].id, 'p2');
});

test('saveTask and deleteTask behave the same way as profiles', async () => {
  await storage.saveTask({ id: 't1', name: 'Task One' });
  assert.deepEqual(await storage.getTasks(), [{ id: 't1', name: 'Task One' }]);
  await storage.deleteTask('t1');
  assert.deepEqual(await storage.getTasks(), []);
});

test('appendHistoryEntry appends and caps history at 200 entries', async () => {
  backing.runHistory = Array.from({ length: 200 }, (_, i) => ({ id: `old-${i}` }));
  await storage.appendHistoryEntry({ id: 'new-1' });
  const history = await storage.getHistory();
  assert.equal(history.length, 200);
  assert.equal(history[history.length - 1].id, 'new-1');
  assert.equal(history[0].id, 'old-1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `globalThis.OBA_Storage is undefined`.

- [ ] **Step 3: Write `src/shared/storage.js`**

```js
(function () {
  function getAll(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => resolve(result[key] || []));
    });
  }

  function setAll(key, items) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: items }, () => resolve());
    });
  }

  async function upsertById(key, item) {
    const items = await getAll(key);
    const index = items.findIndex((existing) => existing.id === item.id);
    if (index >= 0) items[index] = item; else items.push(item);
    await setAll(key, items);
    return item;
  }

  async function removeById(key, id) {
    const items = await getAll(key);
    await setAll(key, items.filter((item) => item.id !== id));
  }

  async function getProfiles() { return getAll('providerProfiles'); }
  async function saveProfile(profile) { return upsertById('providerProfiles', profile); }
  async function deleteProfile(id) { return removeById('providerProfiles', id); }

  async function getTasks() { return getAll('tasks'); }
  async function saveTask(task) { return upsertById('tasks', task); }
  async function deleteTask(id) { return removeById('tasks', id); }

  async function getHistory() { return getAll('runHistory'); }
  async function appendHistoryEntry(entry) {
    const history = await getAll('runHistory');
    history.push(entry);
    while (history.length > 200) history.shift();
    await setAll('runHistory', history);
    return entry;
  }

  globalThis.OBA_Storage = {
    getProfiles, saveProfile, deleteProfile,
    getTasks, saveTask, deleteTask,
    getHistory, appendHistoryEntry
  };
})();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all storage tests green (plus the earlier task-model tests still passing).

- [ ] **Step 5: Commit**

```bash
git add src/shared/storage.js tests/storage.test.js
git commit -m "feat: add chrome.storage.local wrapper for profiles/tasks/history"
```

---

## Task 4: Provider Client

**Files:**
- Create: `src/background/provider-client.js`
- Test: `tests/provider-client.test.js`

**Interfaces:**
- Consumes: nothing (profile objects are plain data: `{baseUrl, apiKey, model}`).
- Produces: `globalThis.OBA_ProviderClient.{buildChatRequestBody(profile, messages), parseChatResponse(json), buildHeaders(profile), normalizeBaseUrl(baseUrl), callProvider(profile, messages, fetchImpl?), testConnection(profile, fetchImpl?)}`. `callProvider` resolves to the assistant message content string, or throws an `Error` whose message includes the HTTP status. `fetchImpl` is an injectable override of `fetch`, used by tests and by nothing else in production (production omits it and gets the real global `fetch`).

- [ ] **Step 1: Write the failing test**

Create `tests/provider-client.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/background/provider-client.js');
const client = globalThis.OBA_ProviderClient;

test('buildChatRequestBody uses the profile model and passes messages through', () => {
  const body = client.buildChatRequestBody({ model: 'qwen3-vl:2b-instruct' }, [{ role: 'user', content: 'hi' }]);
  assert.equal(body.model, 'qwen3-vl:2b-instruct');
  assert.deepEqual(body.messages, [{ role: 'user', content: 'hi' }]);
  assert.equal(body.stream, false);
});

test('parseChatResponse extracts choices[0].message.content', () => {
  const content = client.parseChatResponse({ choices: [{ message: { content: 'the answer' } }] });
  assert.equal(content, 'the answer');
});

test('parseChatResponse throws a clear error when content is missing', () => {
  assert.throws(() => client.parseChatResponse({ choices: [] }), /missing choices\[0\]\.message\.content/);
});

test('buildHeaders adds Authorization only when an apiKey is set', () => {
  assert.deepEqual(client.buildHeaders({ apiKey: '' }), { 'Content-Type': 'application/json' });
  assert.deepEqual(
    client.buildHeaders({ apiKey: 'sk-123' }),
    { 'Content-Type': 'application/json', Authorization: 'Bearer sk-123' }
  );
});

test('normalizeBaseUrl strips trailing slashes', () => {
  assert.equal(client.normalizeBaseUrl('http://localhost:11434/v1///'), 'http://localhost:11434/v1');
});

test('callProvider resolves with the message content on a 2xx response', async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: 'done' } }] })
  });
  const content = await client.callProvider({ baseUrl: 'http://x/v1', model: 'm' }, [], fakeFetch);
  assert.equal(content, 'done');
});

test('callProvider throws with the HTTP status on a non-2xx response (e.g. Ollama origin-check 403)', async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 403,
    statusText: 'Forbidden',
    text: async () => 'origin not allowed'
  });
  await assert.rejects(
    () => client.callProvider({ baseUrl: 'http://x/v1', model: 'm' }, [], fakeFetch),
    /403/
  );
});

test('testConnection reports models on success', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ data: [{ id: 'llava' }, { id: 'llama3.2' }] }) });
  const result = await client.testConnection({ baseUrl: 'http://x/v1' }, fakeFetch);
  assert.deepEqual(result, { ok: true, models: ['llava', 'llama3.2'] });
});

test('testConnection reports failure details on a non-2xx response', async () => {
  const fakeFetch = async () => ({ ok: false, status: 401, statusText: 'Unauthorized', text: async () => 'bad key' });
  const result = await client.testConnection({ baseUrl: 'http://x/v1' }, fakeFetch);
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `globalThis.OBA_ProviderClient is undefined`.

- [ ] **Step 3: Write `src/background/provider-client.js`**

```js
(function () {
  function buildChatRequestBody(profile, messages) {
    return {
      model: profile.model,
      messages,
      temperature: 0.2,
      stream: false
    };
  }

  function parseChatResponse(json) {
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('Provider response missing choices[0].message.content');
    }
    return content;
  }

  function buildHeaders(profile) {
    const headers = { 'Content-Type': 'application/json' };
    if (profile.apiKey) headers.Authorization = `Bearer ${profile.apiKey}`;
    return headers;
  }

  function normalizeBaseUrl(baseUrl) {
    return String(baseUrl || '').replace(/\/+$/, '');
  }

  async function callProvider(profile, messages, fetchImpl) {
    const doFetch = fetchImpl || fetch;
    const url = `${normalizeBaseUrl(profile.baseUrl)}/chat/completions`;
    const response = await doFetch(url, {
      method: 'POST',
      headers: buildHeaders(profile),
      body: JSON.stringify(buildChatRequestBody(profile, messages))
    });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new Error(`Provider request failed: ${response.status} ${response.statusText} ${bodyText}`.trim());
    }
    const json = await response.json();
    return parseChatResponse(json);
  }

  async function testConnection(profile, fetchImpl) {
    const doFetch = fetchImpl || fetch;
    const url = `${normalizeBaseUrl(profile.baseUrl)}/models`;
    const response = await doFetch(url, { headers: buildHeaders(profile) });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      return { ok: false, status: response.status, message: `${response.status} ${response.statusText} ${bodyText}`.trim() };
    }
    const json = await response.json();
    const models = Array.isArray(json.data)
      ? json.data.map((m) => m.id)
      : Array.isArray(json.models)
        ? json.models.map((m) => m.name)
        : [];
    return { ok: true, models };
  }

  globalThis.OBA_ProviderClient = {
    buildChatRequestBody, parseChatResponse, buildHeaders, normalizeBaseUrl, callProvider, testConnection
  };
})();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all provider-client tests green.

- [ ] **Step 5: Commit**

```bash
git add src/background/provider-client.js tests/provider-client.test.js
git commit -m "feat: add OpenAI-compatible provider client"
```

---

## Task 5: Scheduler

**Files:**
- Create: `src/background/scheduler.js`
- Test: `tests/scheduler.test.js`

**Interfaces:**
- Consumes: a `Task.schedule` object as defined in Task 2.
- Produces: `globalThis.OBA_Scheduler.{computeNextRunTimestamp(schedule, nowMs): number|null, alarmNameForTask(taskId): string, wireScheduler({getTasks, saveTask, runTask, alarms, now}): {scheduleTask(task), onAlarm(alarm)}}`. `wireScheduler`'s `alarms` param matches the shape of `chrome.alarms` (`.create(name, {when})`, `.onAlarm.addListener(fn)`) — injected so it's testable without a real `chrome` global.

- [ ] **Step 1: Write the failing test**

Create `tests/scheduler.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `globalThis.OBA_Scheduler is undefined`.

- [ ] **Step 3: Write `src/background/scheduler.js`**

```js
(function () {
  function computeNextRunTimestamp(schedule, nowMs) {
    if (!schedule) return null;

    if (schedule.type === 'once') {
      return schedule.at > nowMs ? schedule.at : null;
    }

    if (schedule.type === 'recurring') {
      const nowDate = new Date(nowMs);
      for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
        const candidate = new Date(nowDate);
        candidate.setDate(nowDate.getDate() + dayOffset);
        candidate.setHours(schedule.hour, schedule.minute, 0, 0);
        if (schedule.daysOfWeek.includes(candidate.getDay()) && candidate.getTime() > nowMs) {
          return candidate.getTime();
        }
      }
      return null;
    }

    return null;
  }

  function alarmNameForTask(taskId) {
    return `oba-task-${taskId}`;
  }

  function wireScheduler(deps) {
    const { getTasks, saveTask, runTask, alarms, now } = deps;

    async function scheduleTask(task) {
      if (!task.schedule) return;
      const nextRun = computeNextRunTimestamp(task.schedule, now());
      if (nextRun) {
        alarms.create(alarmNameForTask(task.id), { when: nextRun });
      }
    }

    async function onAlarm(alarm) {
      const match = alarm.name.match(/^oba-task-(.+)$/);
      if (!match) return;

      const taskId = match[1];
      const tasks = await getTasks();
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      await runTask(task);

      if (task.schedule.type === 'once') {
        task.schedule = null;
        await saveTask(task);
      } else {
        await scheduleTask(task);
      }
    }

    alarms.onAlarm.addListener(onAlarm);
    return { scheduleTask, onAlarm };
  }

  globalThis.OBA_Scheduler = { computeNextRunTimestamp, alarmNameForTask, wireScheduler };
})();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all scheduler tests green.

- [ ] **Step 5: Commit**

```bash
git add src/background/scheduler.js tests/scheduler.test.js
git commit -m "feat: add one-off/recurring task scheduler"
```

---

## Task 6: DOM Strategy (Prompt Formatting + Action Parsing)

**Files:**
- Create: `src/content/dom-strategy.js`
- Test: `tests/dom-strategy.test.js`

**Interfaces:**
- Consumes: an element list shaped like `[{id, tag, role, text, bbox: {x,y,width,height}}]` (produced by `dom-scan.js` in Task 8 — this task only consumes the shape, not the real scanner, so it's testable without a browser).
- Produces: `globalThis.OBA_DomStrategy.{formatElementListForPrompt(elements): string, parseAction(modelText, elements): object}`. `parseAction` throws a descriptive `Error` on invalid JSON, a missing `type`, or an `elementId` that isn't in `elements`.

- [ ] **Step 1: Write the failing test**

Create `tests/dom-strategy.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/content/dom-strategy.js');
const strategy = globalThis.OBA_DomStrategy;

const sampleElements = [
  { id: 0, tag: 'button', role: '', text: 'Submit', bbox: { x: 10, y: 20, width: 80, height: 30 } },
  { id: 1, tag: 'input', role: '', text: '', bbox: { x: 10, y: 60, width: 200, height: 24 } }
];

test('formatElementListForPrompt includes id, tag, and text for each element', () => {
  const prompt = strategy.formatElementListForPrompt(sampleElements);
  assert.match(prompt, /\[0\] button.*"Submit"/);
  assert.match(prompt, /\[1\] input/);
});

test('parseAction accepts valid JSON referencing a known elementId', () => {
  const action = strategy.parseAction('{"type":"click","elementId":0}', sampleElements);
  assert.deepEqual(action, { type: 'click', elementId: 0 });
});

test('parseAction accepts "done" without requiring an elementId', () => {
  const action = strategy.parseAction('{"type":"done"}', sampleElements);
  assert.deepEqual(action, { type: 'done' });
});

test('parseAction throws on invalid JSON', () => {
  assert.throws(() => strategy.parseAction('not json', sampleElements), /not valid JSON/);
});

test('parseAction throws when "type" is missing', () => {
  assert.throws(() => strategy.parseAction('{"elementId":0}', sampleElements), /missing "type"/);
});

test('parseAction throws when elementId is not in the element list', () => {
  assert.throws(() => strategy.parseAction('{"type":"click","elementId":99}', sampleElements), /unknown elementId/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `globalThis.OBA_DomStrategy is undefined`.

- [ ] **Step 3: Write `src/content/dom-strategy.js`**

```js
(function () {
  function formatElementListForPrompt(elements) {
    return elements
      .map((el) => `[${el.id}] ${el.tag}${el.role ? ` role="${el.role}"` : ''} "${el.text || ''}" bbox=(${el.bbox.x},${el.bbox.y},${el.bbox.width},${el.bbox.height})`)
      .join('\n');
  }

  function parseAction(modelText, elements) {
    let parsed;
    try {
      parsed = JSON.parse(modelText);
    } catch (error) {
      throw new Error(`Model response was not valid JSON: ${error.message}`);
    }

    if (!parsed || typeof parsed !== 'object' || !parsed.type) {
      throw new Error('Model response missing "type" field');
    }

    if (parsed.type !== 'done' && parsed.elementId !== undefined) {
      const exists = elements.some((el) => el.id === parsed.elementId);
      if (!exists) {
        throw new Error(`Model referenced unknown elementId "${parsed.elementId}"`);
      }
    }

    return parsed;
  }

  globalThis.OBA_DomStrategy = { formatElementListForPrompt, parseAction };
})();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all dom-strategy tests green.

- [ ] **Step 5: Commit**

```bash
git add src/content/dom-strategy.js tests/dom-strategy.test.js
git commit -m "feat: add DOM-strategy prompt formatting and action parsing"
```

---

## Task 7: Agent Loop

**Files:**
- Create: `src/background/agent-loop.js`
- Test: `tests/agent-loop.test.js`

**Interfaces:**
- Consumes: a `Task` (Task 2 shape) and an injected `deps` object: `{observe(task), decide(task, observation, history), requestApproval(action), execute(action), recordStep(stepResult)}` — all async. Production wiring for these deps happens in Task 9's `service-worker.js`; this task only defines and tests the control flow against fakes.
- Produces: `globalThis.OBA_AgentLoop.{runStep({task, deps, history}): Promise<StepResult>, runTask(task, deps): Promise<RunResult>, isSensitiveAction(action): boolean}`. `RunResult` is `{status: 'success'|'stopped'|'failed', reason?, steps: StepResult[]}`. `StepResult` is `{action, observation, status: 'done'|'rejected'|'failed', result?, error?}`.

- [ ] **Step 1: Write the failing test**

Create `tests/agent-loop.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `globalThis.OBA_AgentLoop is undefined`.

- [ ] **Step 3: Write `src/background/agent-loop.js`**

```js
(function () {
  const SENSITIVE_ACTION_TYPES = new Set(['submit', 'purchase', 'download', 'navigate-new-domain']);
  const MAX_STEPS = 25;
  const MAX_CONSECUTIVE_FAILURES = 1;

  function isSensitiveAction(action) {
    return SENSITIVE_ACTION_TYPES.has(action?.type);
  }

  async function runStep({ task, deps, history }) {
    const observation = await deps.observe(task);
    const action = await deps.decide(task, observation, history);

    const needsApproval = task.autonomyMode === 'approve-all'
      || (task.autonomyMode === 'approve-sensitive' && isSensitiveAction(action));

    if (needsApproval) {
      const approved = await deps.requestApproval(action);
      if (!approved) {
        return { action, observation, status: 'rejected' };
      }
    }

    try {
      const result = await deps.execute(action);
      return { action, observation, status: 'done', result };
    } catch (error) {
      return { action, observation, status: 'failed', error: error.message };
    }
  }

  async function runTask(task, deps) {
    const history = [];
    let consecutiveFailures = 0;

    for (let step = 0; step < MAX_STEPS; step++) {
      const stepResult = await runStep({ task, deps, history });
      history.push(stepResult);
      await deps.recordStep(stepResult);

      if (stepResult.status === 'rejected') {
        return { status: 'stopped', reason: 'rejected', steps: history };
      }

      if (stepResult.status === 'failed') {
        consecutiveFailures += 1;
        if (consecutiveFailures > MAX_CONSECUTIVE_FAILURES) {
          return { status: 'failed', reason: 'too many consecutive failures', steps: history };
        }
        continue;
      }

      consecutiveFailures = 0;

      if (stepResult.action?.type === 'done') {
        return { status: 'success', steps: history };
      }
    }

    return { status: 'failed', reason: 'max steps exceeded', steps: history };
  }

  globalThis.OBA_AgentLoop = { runStep, runTask, isSensitiveAction, SENSITIVE_ACTION_TYPES, MAX_STEPS, MAX_CONSECUTIVE_FAILURES };
})();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all agent-loop tests green (and every earlier test file still passing — this is now the full unit-test surface).

- [ ] **Step 5: Commit**

```bash
git add src/background/agent-loop.js tests/agent-loop.test.js
git commit -m "feat: add agent loop with autonomy gating and single-retry failure handling"
```

---

## Task 8: Content Script — DOM Scanning, Overlay, and Page Actions

**Files:**
- Create: `src/content/dom-scan.js`
- Create: `src/content/visual-overlay.js`
- Create: `src/content/page-actions.js`
- Create: `src/content/content-script.js`

**Interfaces:**
- Consumes: `globalThis.OBA_DomStrategy` (Task 6, loaded first by `manifest.json`'s `content_scripts` order).
- Produces: `globalThis.OBA_DomScan.{scanInteractiveElements(): Element[], getElementById(id): HTMLElement|null}`; `globalThis.OBA_VisualOverlay.{showCursorMoveTo(x,y), highlightElement(el, durationMs?)}`; `globalThis.OBA_PageActions.{clickElement(id), typeIntoElement(id, text), scrollBy(deltaY), extractText(id), clickAtCoordinates(x, y)}`. `content-script.js` listens for `chrome.runtime.onMessage` with types `oba:scanDom`, `oba:captureViewportSize`, `oba:executeAction` and responds `{ok: true, ...}` or `{ok: false, error}`.

This task is browser-only (DOM APIs, `chrome.runtime`) — per the Global Constraints, it's verified manually via an unpacked extension load, not `node --test`.

- [ ] **Step 1: Write `src/content/dom-scan.js`**

```js
(function () {
  const INTERACTIVE_SELECTOR = 'a, button, input, textarea, select, [role="button"], [role="link"], [onclick]';

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

  function scanInteractiveElements() {
    const nodes = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR)).filter(isVisible);
    return nodes.map((el, index) => {
      const rect = el.getBoundingClientRect();
      el.dataset.obaId = String(index);
      return {
        id: index,
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || '',
        text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 80),
        bbox: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      };
    });
  }

  function getElementById(id) {
    return document.querySelector(`[data-oba-id="${id}"]`);
  }

  globalThis.OBA_DomScan = { scanInteractiveElements, getElementById };
})();
```

- [ ] **Step 2: Write `src/content/visual-overlay.js`**

```js
(function () {
  let cursorEl = null;

  function ensureCursor() {
    if (cursorEl) return cursorEl;
    cursorEl = document.createElement('div');
    cursorEl.style.position = 'fixed';
    cursorEl.style.width = '18px';
    cursorEl.style.height = '18px';
    cursorEl.style.borderRadius = '50%';
    cursorEl.style.background = 'rgba(255,80,80,0.85)';
    cursorEl.style.border = '2px solid white';
    cursorEl.style.zIndex = '2147483647';
    cursorEl.style.pointerEvents = 'none';
    cursorEl.style.transition = 'left 0.3s ease, top 0.3s ease';
    document.documentElement.appendChild(cursorEl);
    return cursorEl;
  }

  function showCursorMoveTo(x, y) {
    const el = ensureCursor();
    el.style.left = `${x - 9}px`;
    el.style.top = `${y - 9}px`;
  }

  function highlightElement(targetEl, durationMs) {
    const rect = targetEl.getBoundingClientRect();
    const box = document.createElement('div');
    box.style.position = 'fixed';
    box.style.left = `${rect.x}px`;
    box.style.top = `${rect.y}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    box.style.border = '2px solid #ff5050';
    box.style.zIndex = '2147483646';
    box.style.pointerEvents = 'none';
    document.documentElement.appendChild(box);
    showCursorMoveTo(rect.x + rect.width / 2, rect.y + rect.height / 2);
    setTimeout(() => box.remove(), durationMs || 600);
  }

  globalThis.OBA_VisualOverlay = { showCursorMoveTo, highlightElement };
})();
```

- [ ] **Step 3: Write `src/content/page-actions.js`**

```js
(function () {
  function clickElement(id) {
    const el = globalThis.OBA_DomScan.getElementById(id);
    if (!el) throw new Error(`No element with id ${id}`);
    globalThis.OBA_VisualOverlay.highlightElement(el);
    el.click();
  }

  function typeIntoElement(id, text) {
    const el = globalThis.OBA_DomScan.getElementById(id);
    if (!el) throw new Error(`No element with id ${id}`);
    globalThis.OBA_VisualOverlay.highlightElement(el);
    el.focus();
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function scrollBy(deltaY) {
    window.scrollBy({ top: deltaY, behavior: 'smooth' });
  }

  function extractText(id) {
    const el = globalThis.OBA_DomScan.getElementById(id);
    if (!el) throw new Error(`No element with id ${id}`);
    return el.innerText || el.value || '';
  }

  function clickAtCoordinates(x, y) {
    globalThis.OBA_VisualOverlay.showCursorMoveTo(x, y);
    const el = document.elementFromPoint(x, y);
    if (!el) throw new Error(`No element at (${x}, ${y})`);
    globalThis.OBA_VisualOverlay.highlightElement(el, 400);
    el.click();
  }

  globalThis.OBA_PageActions = { clickElement, typeIntoElement, scrollBy, extractText, clickAtCoordinates };
})();
```

- [ ] **Step 4: Write `src/content/content-script.js`**

```js
(function () {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      try {
        switch (message.type) {
          case 'oba:scanDom': {
            sendResponse({ ok: true, elements: globalThis.OBA_DomScan.scanInteractiveElements() });
            break;
          }
          case 'oba:captureViewportSize': {
            sendResponse({ ok: true, width: window.innerWidth, height: window.innerHeight });
            break;
          }
          case 'oba:executeAction': {
            const { action } = message;
            let result;
            if (action.type === 'click') result = globalThis.OBA_PageActions.clickElement(action.elementId);
            else if (action.type === 'type') result = globalThis.OBA_PageActions.typeIntoElement(action.elementId, action.text);
            else if (action.type === 'scroll') result = globalThis.OBA_PageActions.scrollBy(action.deltaY || 400);
            else if (action.type === 'extract') result = globalThis.OBA_PageActions.extractText(action.elementId);
            else if (action.type === 'click-coordinates') result = globalThis.OBA_PageActions.clickAtCoordinates(action.x, action.y);
            else throw new Error(`Unknown action type: ${action.type}`);
            sendResponse({ ok: true, result });
            break;
          }
          default:
            sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
        }
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  });
})();
```

- [ ] **Step 5: Manually verify in a real browser**

Run: `chrome://extensions` → enable Developer Mode → "Load unpacked" → select the `ollama-browser-agent` folder.

Open any page's DevTools console and run:
```js
chrome.runtime.sendMessage; // just confirm no "chrome is not defined" content-script load errors appear in the page console
```
Expected: no red errors logged by `content-script.js` in the console for a normal page (e.g. a Wikipedia article). This confirms the five content-script files loaded and attached their namespaces without syntax/runtime errors — full message-driven verification happens once Task 9's service worker can send it messages.

- [ ] **Step 6: Commit**

```bash
git add src/content/dom-scan.js src/content/visual-overlay.js src/content/page-actions.js src/content/content-script.js
git commit -m "feat: add content script (DOM scan, cursor/highlight overlay, page actions)"
```

---

## Task 9: Service Worker (Wiring)

**Files:**
- Create: `src/background/service-worker.js`

**Interfaces:**
- Consumes: `globalThis.OBA_Storage` (Task 3), `globalThis.OBA_ProviderClient` (Task 4), `globalThis.OBA_Scheduler` (Task 5), `globalThis.OBA_AgentLoop` (Task 7), `globalThis.OBA_DomStrategy` (Task 6), `globalThis.OBA_Id` (Task 2), and messages `oba:scanDom`/`oba:executeAction` handled by Task 8's content script.
- Produces: runtime message handlers for `oba:runTaskNow` and `oba:scheduleTask` (consumed by the dashboard/side panel in Tasks 10-11), and forwards `oba:runStep` / `oba:approvalRequest` messages to any listening UI.

This task is browser-only (Chrome extension APIs) — verified manually.

- [ ] **Step 1: Write `src/background/service-worker.js`**

```js
import '../shared/id.js';
import '../shared/task-model.js';
import '../shared/storage.js';
import './provider-client.js';
import './scheduler.js';
import './agent-loop.js';

function sendToContentScript(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab found');
  return tab.id;
}

function buildDecidePrompt(task, observation) {
  const system = {
    role: 'system',
    content: 'You control a web browser to accomplish the user\'s goal. Respond ONLY with JSON: '
      + '{"type":"click"|"type"|"scroll"|"extract"|"click-coordinates"|"done","elementId":<id>,"text":<string>,"x":<number>,"y":<number>,"deltaY":<number>}. '
      + 'Use "done" once the goal is complete.'
  };
  const textPart = `Goal: ${task.prompt}\n\n${observation.elementsPrompt ? `Current page elements:\n${observation.elementsPrompt}` : 'A screenshot of the current page is attached.'}`;

  if (observation.screenshot) {
    return [system, { role: 'user', content: [{ type: 'text', text: textPart }, { type: 'image_url', image_url: { url: observation.screenshot } }] }];
  }
  return [system, { role: 'user', content: textPart }];
}

function makeDeps(task, profile, tabId, onStep) {
  return {
    async observe() {
      if (task.strategy === 'dom') {
        const response = await sendToContentScript(tabId, { type: 'oba:scanDom' });
        return { elementsPrompt: globalThis.OBA_DomStrategy.formatElementListForPrompt(response.elements), elements: response.elements };
      }
      const dataUrl = await chrome.tabs.captureVisibleTab(undefined, { format: 'png' });
      return { screenshot: dataUrl };
    },
    async decide(currentTask, observation) {
      const messages = buildDecidePrompt(currentTask, observation);
      const content = await globalThis.OBA_ProviderClient.callProvider(profile, messages);
      return globalThis.OBA_DomStrategy.parseAction(content, observation.elements || []);
    },
    async requestApproval(action) {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'oba:approvalRequest', action }, (response) => resolve(Boolean(response?.approved)));
      });
    },
    async execute(action) {
      if (action.type === 'done') return { done: true };
      return sendToContentScript(tabId, { type: 'oba:executeAction', action });
    },
    async recordStep(stepResult) {
      onStep(stepResult);
    }
  };
}

async function runTask(task) {
  const profiles = await globalThis.OBA_Storage.getProfiles();
  const profile = profiles.find((p) => p.id === task.providerProfileId);
  if (!profile) throw new Error(`Provider profile ${task.providerProfileId} not found`);

  const tabId = await getActiveTabId();
  if (task.startUrl) {
    await chrome.tabs.update(tabId, { url: task.startUrl });
  }

  const deps = makeDeps(task, profile, tabId, (step) => {
    chrome.runtime.sendMessage({ type: 'oba:runStep', taskId: task.id, step }).catch(() => {});
  });

  const result = await globalThis.OBA_AgentLoop.runTask(task, deps);

  await globalThis.OBA_Storage.appendHistoryEntry({
    id: globalThis.OBA_Id.generateId(),
    taskId: task.id,
    startedAt: Date.now(),
    status: result.status,
    reason: result.reason || null,
    stepCount: result.steps.length
  });

  return result;
}

const scheduler = globalThis.OBA_Scheduler.wireScheduler({
  getTasks: () => globalThis.OBA_Storage.getTasks(),
  saveTask: (task) => globalThis.OBA_Storage.saveTask(task),
  runTask,
  alarms: chrome.alarms,
  now: () => Date.now()
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'oba:runTaskNow') {
    runTask(message.task).then((result) => sendResponse({ ok: true, result })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'oba:scheduleTask') {
    scheduler.scheduleTask(message.task).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  return false;
});

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});
```

- [ ] **Step 2: Manually verify**

Run: reload the unpacked extension at `chrome://extensions`, then open its "service worker" inspector link.
Expected: no errors in the service worker console on load (confirms the `import` chain resolves and every `globalThis.OBA_*` namespace attaches without throwing).

- [ ] **Step 3: Commit**

```bash
git add src/background/service-worker.js
git commit -m "feat: wire service worker (agent loop, scheduler, message handlers)"
```

---

## Task 10: Side Panel UI

**Files:**
- Create: `src/sidepanel/sidepanel.html`
- Create: `src/sidepanel/sidepanel.css`
- Create: `src/sidepanel/sidepanel.js`

**Interfaces:**
- Consumes: `globalThis.OBA_Storage.getTasks()` (Task 3); sends `oba:runTaskNow` and listens for `oba:runStep` / `oba:approvalRequest` messages (Task 9).

This task is browser-only UI — verified manually.

- [ ] **Step 1: Write `src/sidepanel/sidepanel.html`**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Ollama Browser Agent</title>
  <link rel="stylesheet" href="sidepanel.css">
</head>
<body>
  <h1>Ollama Browser Agent</h1>
  <select id="task-select"></select>
  <button id="run-btn">Run</button>

  <div id="approval" class="hidden">
    <p id="approval-text"></p>
    <button id="approve-btn">Approve</button>
    <button id="deny-btn">Deny</button>
  </div>

  <ol id="step-log"></ol>

  <script src="../shared/id.js"></script>
  <script src="../shared/task-model.js"></script>
  <script src="../shared/storage.js"></script>
  <script src="sidepanel.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `src/sidepanel/sidepanel.css`**

```css
body { font-family: system-ui, sans-serif; padding: 12px; }
.hidden { display: none; }
#step-log { padding-left: 18px; }
#step-log li { margin-bottom: 6px; font-size: 13px; }
#approval { border: 2px solid #ff5050; padding: 8px; margin: 8px 0; }
```

- [ ] **Step 3: Write `src/sidepanel/sidepanel.js`**

```js
const taskSelect = document.getElementById('task-select');
const runBtn = document.getElementById('run-btn');
const stepLog = document.getElementById('step-log');
const approvalBox = document.getElementById('approval');
const approvalText = document.getElementById('approval-text');
const approveBtn = document.getElementById('approve-btn');
const denyBtn = document.getElementById('deny-btn');

let pendingApprovalResponder = null;

async function loadTasks() {
  const tasks = await globalThis.OBA_Storage.getTasks();
  taskSelect.innerHTML = '';
  tasks.forEach((task) => {
    const option = document.createElement('option');
    option.value = task.id;
    option.textContent = task.name;
    taskSelect.appendChild(option);
  });
  return tasks;
}

runBtn.addEventListener('click', async () => {
  const tasks = await loadTasks();
  const task = tasks.find((t) => t.id === taskSelect.value);
  if (!task) return;
  stepLog.innerHTML = '';
  chrome.runtime.sendMessage({ type: 'oba:runTaskNow', task });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'oba:runStep') {
    const li = document.createElement('li');
    li.textContent = `${message.step.status}: ${JSON.stringify(message.step.action)}`;
    stepLog.appendChild(li);
    return false;
  }
  if (message.type === 'oba:approvalRequest') {
    pendingApprovalResponder = sendResponse;
    approvalText.textContent = JSON.stringify(message.action);
    approvalBox.classList.remove('hidden');
    return true;
  }
  return false;
});

approveBtn.addEventListener('click', () => {
  if (pendingApprovalResponder) pendingApprovalResponder({ approved: true });
  approvalBox.classList.add('hidden');
  pendingApprovalResponder = null;
});

denyBtn.addEventListener('click', () => {
  if (pendingApprovalResponder) pendingApprovalResponder({ approved: false });
  approvalBox.classList.add('hidden');
  pendingApprovalResponder = null;
});

loadTasks();
```

- [ ] **Step 4: Manually verify**

Reload the unpacked extension, click its toolbar icon to open the side panel.
Expected: side panel opens showing "Ollama Browser Agent" heading and an empty task dropdown (no tasks exist yet — Task 11 adds the UI to create them). No console errors in the side panel's own DevTools (right-click inside panel → Inspect).

- [ ] **Step 5: Commit**

```bash
git add src/sidepanel/
git commit -m "feat: add side panel UI (task picker, run button, live step log, approval gate)"
```

---

## Task 11: Dashboard UI

**Files:**
- Create: `src/dashboard/dashboard.html`
- Create: `src/dashboard/dashboard.css`
- Create: `src/dashboard/dashboard.js`
- Modify: `manifest.json` — add an `options_page` (or a way to open the dashboard) pointing at the new page.

**Interfaces:**
- Consumes: `globalThis.OBA_Storage` (Task 3), `globalThis.OBA_TaskModel` (Task 2), `globalThis.OBA_ProviderClient.testConnection` (Task 4); sends `oba:runTaskNow` / `oba:scheduleTask` messages (Task 9).

This task is browser-only UI — verified manually.

- [ ] **Step 1: Write `src/dashboard/dashboard.html`**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Ollama Browser Agent — Dashboard</title>
  <link rel="stylesheet" href="dashboard.css">
</head>
<body>
  <h1>Ollama Browser Agent</h1>

  <section>
    <h2>Provider Profiles</h2>
    <form id="profile-form">
      <input type="hidden" id="profile-id">
      <input type="text" id="profile-name" placeholder="Name" required>
      <input type="text" id="profile-baseUrl" placeholder="Base URL" value="http://localhost:11434/v1" required>
      <input type="text" id="profile-apiKey" placeholder="API Key (optional)">
      <input type="text" id="profile-model" placeholder="Model" required>
      <label><input type="checkbox" id="profile-vision"> Supports vision</label>
      <button type="submit">Save Profile</button>
      <button type="button" id="profile-test">Test Connection</button>
    </form>
    <div id="profile-test-result"></div>
    <ul id="profile-list"></ul>
  </section>

  <section>
    <h2>Tasks</h2>
    <form id="task-form">
      <input type="hidden" id="task-id">
      <input type="text" id="task-name" placeholder="Task name" required>
      <textarea id="task-prompt" placeholder="Instructions" required></textarea>
      <input type="text" id="task-startUrl" placeholder="Start URL (optional)">
      <select id="task-profile"></select>
      <select id="task-strategy">
        <option value="dom">DOM</option>
        <option value="visual">Visual</option>
      </select>
      <select id="task-autonomy">
        <option value="autonomous">Autonomous</option>
        <option value="approve-sensitive">Approve sensitive actions</option>
        <option value="approve-all">Approve every action</option>
      </select>
      <fieldset>
        <legend>Schedule</legend>
        <select id="schedule-type">
          <option value="none">None</option>
          <option value="once">Once</option>
          <option value="recurring">Recurring</option>
        </select>
        <input type="datetime-local" id="schedule-once-at">
        <input type="number" id="schedule-hour" placeholder="Hour (0-23)" min="0" max="23">
        <input type="number" id="schedule-minute" placeholder="Minute (0-59)" min="0" max="59">
        <div id="schedule-days">
          <label><input type="checkbox" value="0">Sun</label>
          <label><input type="checkbox" value="1">Mon</label>
          <label><input type="checkbox" value="2">Tue</label>
          <label><input type="checkbox" value="3">Wed</label>
          <label><input type="checkbox" value="4">Thu</label>
          <label><input type="checkbox" value="5">Fri</label>
          <label><input type="checkbox" value="6">Sat</label>
        </div>
      </fieldset>
      <button type="submit">Save Task</button>
    </form>
    <ul id="task-list"></ul>
  </section>

  <section>
    <h2>Run History</h2>
    <ul id="history-list"></ul>
  </section>

  <script src="../shared/id.js"></script>
  <script src="../shared/task-model.js"></script>
  <script src="../shared/storage.js"></script>
  <script src="../background/provider-client.js"></script>
  <script src="dashboard.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `src/dashboard/dashboard.css`**

```css
body { font-family: system-ui, sans-serif; max-width: 720px; margin: 24px auto; padding: 0 16px; }
section { margin-bottom: 32px; }
form { display: flex; flex-direction: column; gap: 6px; max-width: 480px; }
textarea { min-height: 60px; }
#schedule-days label { margin-right: 8px; }
li { margin-bottom: 6px; }
li button { margin-left: 6px; }
```

- [ ] **Step 3: Write `src/dashboard/dashboard.js`**

```js
const profileForm = document.getElementById('profile-form');
const profileList = document.getElementById('profile-list');
const taskForm = document.getElementById('task-form');
const taskList = document.getElementById('task-list');
const historyList = document.getElementById('history-list');
const taskProfileSelect = document.getElementById('task-profile');
const scheduleType = document.getElementById('schedule-type');

function readProfileForm() {
  return {
    id: document.getElementById('profile-id').value || undefined,
    name: document.getElementById('profile-name').value,
    baseUrl: document.getElementById('profile-baseUrl').value,
    apiKey: document.getElementById('profile-apiKey').value,
    model: document.getElementById('profile-model').value,
    supportsVision: document.getElementById('profile-vision').checked
  };
}

function resetProfileForm() {
  profileForm.reset();
  document.getElementById('profile-baseUrl').value = 'http://localhost:11434/v1';
}

async function renderProfiles() {
  const profiles = await globalThis.OBA_Storage.getProfiles();
  profileList.innerHTML = '';
  taskProfileSelect.innerHTML = '';

  profiles.forEach((profile) => {
    const li = document.createElement('li');
    li.textContent = `${profile.name} (${profile.baseUrl}, ${profile.model})`;

    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => {
      document.getElementById('profile-id').value = profile.id;
      document.getElementById('profile-name').value = profile.name;
      document.getElementById('profile-baseUrl').value = profile.baseUrl;
      document.getElementById('profile-apiKey').value = profile.apiKey || '';
      document.getElementById('profile-model').value = profile.model;
      document.getElementById('profile-vision').checked = Boolean(profile.supportsVision);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      await globalThis.OBA_Storage.deleteProfile(profile.id);
      await renderProfiles();
    });

    li.append(editBtn, deleteBtn);
    profileList.appendChild(li);

    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name;
    taskProfileSelect.appendChild(option);
  });
}

profileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const profile = readProfileForm();
  profile.id = profile.id || globalThis.OBA_Id.generateId();
  await globalThis.OBA_Storage.saveProfile(profile);
  resetProfileForm();
  await renderProfiles();
});

document.getElementById('profile-test').addEventListener('click', async () => {
  const profile = readProfileForm();
  const resultEl = document.getElementById('profile-test-result');
  resultEl.textContent = 'Testing...';
  try {
    const result = await globalThis.OBA_ProviderClient.testConnection(profile);
    resultEl.textContent = result.ok ? `OK. Models: ${result.models.join(', ')}` : `Failed: ${result.message}`;
  } catch (error) {
    resultEl.textContent = `Failed: ${error.message}`;
  }
});

function readTaskForm() {
  const type = scheduleType.value;
  let schedule = null;

  if (type === 'once') {
    const value = document.getElementById('schedule-once-at').value;
    schedule = { type: 'once', at: new Date(value).getTime() };
  } else if (type === 'recurring') {
    const days = Array.from(document.querySelectorAll('#schedule-days input:checked')).map((el) => Number(el.value));
    schedule = {
      type: 'recurring',
      hour: Number(document.getElementById('schedule-hour').value),
      minute: Number(document.getElementById('schedule-minute').value),
      daysOfWeek: days
    };
  }

  return globalThis.OBA_TaskModel.createTask({
    id: document.getElementById('task-id').value || undefined,
    name: document.getElementById('task-name').value,
    prompt: document.getElementById('task-prompt').value,
    startUrl: document.getElementById('task-startUrl').value || null,
    providerProfileId: taskProfileSelect.value,
    strategy: document.getElementById('task-strategy').value,
    autonomyMode: document.getElementById('task-autonomy').value,
    schedule
  });
}

async function renderTasks() {
  const tasks = await globalThis.OBA_Storage.getTasks();
  taskList.innerHTML = '';

  tasks.forEach((task) => {
    const li = document.createElement('li');
    li.textContent = `${task.name} [${task.strategy}/${task.autonomyMode}]`;

    const runBtn = document.createElement('button');
    runBtn.textContent = 'Run now';
    runBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'oba:runTaskNow', task });
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      await globalThis.OBA_Storage.deleteTask(task.id);
      await renderTasks();
    });

    li.append(runBtn, deleteBtn);
    taskList.appendChild(li);
  });
}

taskForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const task = readTaskForm();
  const errors = globalThis.OBA_TaskModel.validateTask(task);
  if (errors.length > 0) {
    alert(errors.join('\n'));
    return;
  }
  await globalThis.OBA_Storage.saveTask(task);
  if (task.schedule) {
    chrome.runtime.sendMessage({ type: 'oba:scheduleTask', task });
  }
  taskForm.reset();
  await renderTasks();
});

async function renderHistory() {
  const history = await globalThis.OBA_Storage.getHistory();
  historyList.innerHTML = '';
  history.slice().reverse().forEach((entry) => {
    const li = document.createElement('li');
    li.textContent = `${new Date(entry.startedAt).toLocaleString()} — ${entry.status} (${entry.stepCount} steps)`;
    historyList.appendChild(li);
  });
}

renderProfiles();
renderTasks();
renderHistory();
```

- [ ] **Step 4: Modify `manifest.json` to add an options page entry**

Add this key (any position at the top level):

```json
  "options_page": "src/dashboard/dashboard.html",
```

- [ ] **Step 5: Manually verify end to end**

Reload the unpacked extension. Right-click the extension icon → "Options" → dashboard opens.
1. Add a provider profile: name "Local Ollama", base URL `http://localhost:11434/v1`, model `qwen3-vl:2b-instruct`, check "Supports vision". Click "Test Connection" — expect either a model list (Ollama running) or a clear error message (Ollama not running/misconfigured), not a silent failure.
2. Save a task using that profile, strategy "DOM", autonomy "Autonomous", no schedule.
3. Open the side panel, select the task, click "Run" — expect a step log to start appearing (requires a real running Ollama endpoint with the configured model to complete successfully; without one, expect a clear failed-step error in the log rather than a hang).
4. Save a second task with a "Once" schedule 2 minutes in the future; confirm no console errors when saving.

Expected: all four steps complete without uncaught exceptions in the dashboard/side panel/service-worker consoles.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/ manifest.json
git commit -m "feat: add dashboard UI (profiles, tasks, schedules, run history)"
```

---

## Task 12: README

**Files:**
- Create: `README.md`

**Interfaces:**
- None — documentation only.

- [ ] **Step 1: Write `README.md`**

```markdown
# Ollama Browser Agent

A Chrome extension that lets a local or self-hosted LLM/VLM control your browser to
complete tasks — click, type, scroll, extract text, and navigate — using any
OpenAI-compatible `/chat/completions` endpoint (Ollama, LM Studio, vLLM, OpenRouter,
and similar). Runs entirely on your machine: no account, no cloud backend, no
telemetry.

## Features

- **Any OpenAI-compatible endpoint** — point it at Ollama, LM Studio, vLLM, or a
  hosted API. Save multiple named provider profiles and pick one per task.
- **Two grounding strategies, switchable per task:**
  - **DOM strategy** — labels every clickable/typable element on the page and
    sends the model a text list. Works with plain text models (no vision needed).
  - **Visual strategy** — sends a screenshot to a vision-language model, which
    responds with pixel coordinates to click. Requires a vision-capable model
    (e.g. `qwen3-vl:2b-instruct`, `llava`).
- **Visible cursor + highlight overlay** — watch the agent work; a red dot and
  highlight box show exactly what it's about to click or type into, regardless
  of which grounding strategy is active.
- **Saved, schedulable tasks** — save a prompt + starting URL + provider +
  strategy as a reusable task. Run it on demand, once at a specific time, or on
  a recurring schedule (e.g. every weekday at 9am).
- **Adjustable autonomy, per task** — fully autonomous, pause only for sensitive
  actions (form submit, purchase, download, cross-domain navigation), or pause
  before every single action.

## Install

This extension is not on the Chrome Web Store. Load it as an unpacked extension:

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the repository folder.
5. Pin the extension from the toolbar puzzle-piece icon for easy access.

## Quick Start

### 1. Get a model endpoint running

The simplest option is [Ollama](https://ollama.com) running locally:

```bash
ollama pull qwen3-vl:2b-instruct   # a small vision-capable model
ollama serve                       # usually already running as a background service
```

By default Ollama listens on `http://localhost:11434` and exposes an
OpenAI-compatible API at `http://localhost:11434/v1`.

> **Chrome-extension-specific gotcha:** Ollama checks the request's `Origin`
> header and rejects unrecognized origins with a `403 Forbidden` — even though
> the same endpoint works fine from `curl` (which sends no `Origin` header).
> A Chrome extension's requests come from an origin like
> `chrome-extension://<extension-id>`, which Ollama will reject by default.
> Fix it by allow-listing extension origins before starting Ollama:
>
> ```bash
> # macOS, if Ollama runs as the desktop app:
> launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"
> # then quit and reopen the Ollama app
>
> # if you run `ollama serve` manually instead, export it in that shell first:
> export OLLAMA_ORIGINS="chrome-extension://*"
> ollama serve
> ```
>
> If you're on an older Ollama version and the wildcard doesn't work, use your
> extension's exact ID (visible on `chrome://extensions` once loaded) instead
> of `*`.

### 2. Add a provider profile

1. Right-click the extension icon → **Options** to open the dashboard.
2. Under **Provider Profiles**, fill in:
   - **Name**: anything memorable, e.g. "Local Ollama"
   - **Base URL**: `http://localhost:11434/v1`
   - **API Key**: leave blank for local Ollama
   - **Model**: e.g. `qwen3-vl:2b-instruct`
   - Check **Supports vision** if the model can process images (required for
     the Visual strategy)
3. Click **Test Connection**. You should see a list of available models. If you
   see a `403`, see the gotcha above; if you see a network error, confirm
   Ollama is actually running (`curl http://localhost:11434/v1/models`).
4. Click **Save Profile**.

Repeat to add profiles for other endpoints (a remote vLLM server, LM Studio,
etc.) — you can switch between them per task.

### 3. Create a task

Still in the dashboard, under **Tasks**:

1. **Task name**: e.g. "Check today's weather"
2. **Instructions**: plain-language goal, e.g. "Go to a weather site and tell me
   today's forecast for Boston."
3. **Start URL** (optional): a page to open before starting, e.g.
   `https://www.google.com`
4. **Provider**: pick the profile you just created
5. **Strategy**: `DOM` for text-only models, `Visual` for a vision model
6. **Autonomy**:
   - `Autonomous` — runs start to finish with no interruptions
   - `Approve sensitive actions` — pauses only before form submits, purchases,
     downloads, or navigating to a new domain
   - `Approve every action` — pauses before every single step
7. Leave **Schedule** as `None` for now, and click **Save Task**.

### 4. Run it

1. Click the extension's toolbar icon to open the **side panel**.
2. Select your task from the dropdown and click **Run**.
3. Watch the step log update live, and watch the page itself — you'll see a
   red cursor dot and highlight box move to whatever the agent is about to
   interact with.
4. If you chose an approval mode, an approval box appears in the side panel
   before sensitive/every action — click **Approve** or **Deny**.

### 5. Schedule it (optional)

Back in the dashboard, edit (or create) a task and set **Schedule** to:

- **Once** — pick a specific date/time. The task runs once, then the schedule
  clears itself.
- **Recurring** — pick an hour, minute, and one or more days of the week. The
  task runs every matching day at that time, indefinitely.

**Important:** scheduled tasks only fire while Chrome is running (it doesn't
need to be in the foreground, just not fully quit). If Chrome is closed when a
scheduled time arrives, that run is skipped; the next occurrence still fires
normally.

Check **Run History** in the dashboard at any time to see past runs, their
status (success/failed/stopped), and step counts.

## How it works

- A **service worker** (background) runs the observe → ask-model → act loop
  for the active task, and uses `chrome.alarms` to wake up and start scheduled
  tasks even after Chrome has suspended the extension.
- A **content script** injected into the page does the actual observing
  (scanning the DOM or nothing, for a screenshot-based Visual run) and acting
  (clicking, typing, scrolling), and draws the on-page cursor/highlight
  overlay.
- The **side panel** shows a live view of the current run and handles the
  approval prompts. The **dashboard** (extension Options page) manages
  provider profiles, tasks, schedules, and history.
- Everything is stored in `chrome.storage.local` — nothing leaves your machine
  except the requests to whichever model endpoint you configured.

## Supported action types

The model must respond with one JSON object per step:

| `type`             | Fields                  | Meaning                                    |
|---------------------|--------------------------|---------------------------------------------|
| `click`             | `elementId`              | Click the labeled element (DOM strategy)    |
| `type`              | `elementId`, `text`      | Type text into the labeled element          |
| `scroll`            | `deltaY`                 | Scroll the page vertically                  |
| `extract`           | `elementId`               | Read text from the labeled element          |
| `click-coordinates` | `x`, `y`                 | Click at pixel coordinates (Visual strategy)|
| `done`              | —                        | Signal the task is complete                  |

## Limitations

- Chrome/Manifest V3 only — no Firefox/Safari support.
- Scheduled tasks require Chrome to be running (see above).
- No automated test suite covers the browser-integration parts (DOM scanning,
  page actions, the overlay, the UI) — those are verified manually. Core logic
  (task validation, storage, the provider client, the scheduler's date math,
  DOM-strategy prompt formatting/parsing, and the agent loop's control flow) has
  a real unit-test suite — see **Development** below.
- The agent retries a failed step once before giving up on the run; it doesn't
  do open-ended replanning.

## Development

Unit tests cover every pure-logic module (no browser required):

```bash
npm test
```

To iterate on the extension itself, edit files under `src/` and click the
reload icon for this extension on `chrome://extensions` — no build step.

## Project structure

```
manifest.json
src/
  shared/            task model, id generation, storage wrapper
  background/        service worker, agent loop, scheduler, provider client
  content/           DOM scanning, cursor/highlight overlay, page actions
  sidepanel/          live run view + approval UI
  dashboard/          provider profiles, tasks, schedules, run history
tests/               unit tests for every pure-logic module (node --test)
docs/superpowers/    design spec and implementation plan for this project
```
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add comprehensive README"
```

---

## Self-Review Notes

- **Spec coverage:** Architecture (§1) → Task 1, 9; Provider Profiles (§2) → Task 4, 11; Task Model (§3) → Task 2; Scheduling (§4) → Task 5, 11 (README caveat included); Run History (§5) → Task 3 (`appendHistoryEntry`), 9, 11; Error Handling (§6) → Task 4 (status-in-error-message test), Task 7 (single-retry-then-abort test); Testing (§7) → covered by the split between unit-tested pure modules and manually-verified browser integration, called out explicitly in the README.
- **Placeholder scan:** no TBD/TODO markers; every step has complete, runnable code.
- **Type consistency:** `Task` shape from Task 2 (`id, name, prompt, startUrl, providerProfileId, strategy, autonomyMode, schedule`) is used identically in Tasks 5, 7, 9, 10, 11. `StepResult`/`RunResult` shapes from Task 7 are consumed as-is by Task 9's `runTask` wiring and Task 10's side panel rendering (`step.status`, `step.action`).
- **Scope:** single cohesive extension, matches the approved design 1:1 — no further decomposition needed.
