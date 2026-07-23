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
