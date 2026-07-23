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

test('parseAction strips a markdown code fence around the JSON', () => {
  const action = strategy.parseAction('```json\n{"type":"click","elementId":0}\n```', sampleElements);
  assert.deepEqual(action, { type: 'click', elementId: 0 });
});

test('parseAction strips a plain (unlabeled) code fence around the JSON', () => {
  const action = strategy.parseAction('```\n{"type":"done"}\n```', sampleElements);
  assert.deepEqual(action, { type: 'done' });
});

test('parseAction recovers a JSON object followed by stray trailing text', () => {
  const action = strategy.parseAction('{"type":"click","elementId":0}\nsome trailing commentary', sampleElements);
  assert.deepEqual(action, { type: 'click', elementId: 0 });
});

test('parseAction recovers a JSON object preceded by stray leading text', () => {
  const action = strategy.parseAction('Sure, here is the action:\n{"type":"click","elementId":0}', sampleElements);
  assert.deepEqual(action, { type: 'click', elementId: 0 });
});

test('parseAction recovers the first object when the model emits two JSON objects back to back', () => {
  const action = strategy.parseAction('{"type":"click","elementId":0}\n{"type":"done"}', sampleElements);
  assert.deepEqual(action, { type: 'click', elementId: 0 });
});

test('parseAction includes the raw response text in the error when JSON is unrecoverable', () => {
  assert.throws(
    () => strategy.parseAction('no json here at all', sampleElements),
    /Raw response: "no json here at all"/
  );
});
