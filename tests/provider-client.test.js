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
