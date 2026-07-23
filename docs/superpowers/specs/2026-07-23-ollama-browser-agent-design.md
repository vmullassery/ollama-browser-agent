# Ollama Browser Agent — Design

Date: 2026-07-23

## Summary

A standalone Chrome extension (Manifest V3) that lets a local or self-hosted LLM/VLM
(Ollama, LM Studio, vLLM, OpenRouter, or any OpenAI-compatible `/chat/completions`
endpoint) observe and control a browser tab to complete tasks. Supports two
interchangeable grounding strategies (DOM element labels or screenshot+pixel
coordinates), a visible cursor/highlight overlay so the user can watch actions
happen, multiple saved provider profiles, and saved/schedulable tasks with
adjustable autonomy (fully autonomous vs. pause-for-approval).

This is a clean, independent project — no relation to, branding from, or code
shared with Anthropic's Claude in Chrome extension or any other product.

## Goals

- Automate browser tasks (click/type/scroll/navigate/extract/screenshot) driven
  by any OpenAI-compatible model endpoint, with first-class support for local
  Ollama.
- Support vision-language models for screenshot-based (pixel coordinate) action
  grounding, as an alternative to DOM-based grounding.
- Let the user watch what the agent is doing via an on-page cursor/highlight
  overlay, regardless of grounding strategy.
- Let the user save reusable tasks (prompt + starting URL + provider profile +
  strategy + autonomy mode) and run them on demand or on a schedule (one-off or
  recurring).
- Support multiple saved provider profiles (different endpoints/keys/models),
  selected per task.

## Non-Goals

- No cloud backend, telemetry, or account system. Everything lives in
  `chrome.storage.local` on the user's machine.
- No automated CI test suite for the MVP (manual verification via unpacked
  extension load — see Testing).
- No guarantee of scheduled runs firing while Chrome is fully quit (see
  Scheduling caveat).
- Not a multi-browser (Firefox/Safari) extension at this stage — Chrome/MV3 only.

## Architecture

```
service-worker.js  (background, MV3)
  ├─ agent-loop.js      — observe → ask model → act loop, drives a single run
  ├─ scheduler.js       — chrome.alarms-based dispatch for one-off/recurring tasks
  └─ provider-client.js — OpenAI-compatible chat/completions client

content-script.js
  ├─ dom-strategy.js    — tags interactive elements with numeric labels + bounding boxes
  ├─ visual-overlay.js  — animated cursor + highlight box shown during action execution
  └─ page-actions.js    — click/type/scroll/extract executors

sidepanel/   — live view of the active run: step log, current screenshot/DOM
               preview, pause/approve controls
dashboard/   — full-page UI (its own dashboard.html): manage provider profiles,
               saved tasks, schedules, and run history

storage: chrome.storage.local only — provider profiles, tasks, schedules, run history
```

The agent loop runs inside the MV3 service worker (not an offscreen document).
Each `fetch` to the model endpoint and each message to the content script resets
Chrome's 30-second SW idle timer, so the loop survives for the duration of an
active task. `chrome.alarms` (minimum 1-minute granularity) wakes the service
worker for scheduled task start times even after Chrome has suspended it. If
long-running tasks later prove unreliable under this model, moving the loop to
an offscreen document is the fallback (not built for MVP).

### Grounding strategies

Both strategies are selectable per task and both drive the same
`visual-overlay.js`, so the user always sees a moving cursor/highlight
regardless of which one is active.

- **DOM strategy**: `dom-strategy.js` walks the page, assigns a numeric label to
  each interactive element, and sends the model a text list of
  `{id, tag, role, text, bbox}`. The model responds with an element id and an
  action. Works with non-vision text-only LLMs.
- **Visual strategy**: `chrome.tabs.captureVisibleTab` captures a screenshot,
  sent to a vision-capable model. The model responds with pixel coordinates and
  an action. Requires a profile with `supportsVision: true`.

## Provider Profiles

Stored as a list in `chrome.storage.local`:

```js
{
  id, name,              // e.g. "Home Ollama", "Work vLLM"
  baseUrl,               // e.g. http://localhost:11434/v1
  apiKey,                // optional; blank for local Ollama
  model,                 // e.g. qwen3-vl:2b-instruct
  supportsVision: bool   // gates whether Visual strategy is selectable
}
```

All requests use the OpenAI-compatible `/chat/completions` request/response
shape, so it works unmodified against Ollama, LM Studio, vLLM, OpenRouter, etc.
The dashboard's "Test connection" action hits the endpoint's `/models` (or
equivalent) and reports success/model list, or a clear distinguishing error
(network failure vs. 403/CORS-style rejection vs. auth failure).

No default provider is baked in beyond an empty "Local Ollama" template
pre-filled with `http://localhost:11434/v1`.

## Task Model

```js
{
  id, name,
  prompt,                  // natural-language instructions
  startUrl,                 // optional starting page
  providerProfileId,
  strategy: 'dom' | 'visual',
  autonomyMode: 'autonomous' | 'approve-sensitive' | 'approve-all',
  schedule: null
    | { type: 'once', at: <timestamp> }
    | { type: 'recurring', hour, minute, daysOfWeek: [0-6] }
}
```

`autonomyMode` is per-task, not global:

- `autonomous` — never pauses.
- `approve-sensitive` — pauses only on a heuristic, extensible list of
  sensitive actions (form submit, purchase/checkout-looking actions, file
  download, navigation to a new top-level domain).
- `approve-all` — pauses before every action for user confirmation.

## Scheduling

`chrome.alarms` fires the scheduler at the granularity Chrome allows (minimum
1 minute). The scheduler reads due tasks from storage and starts a run through
the same agent loop used for manual runs. One-off tasks disable themselves
after running; recurring tasks compute and set their next alarm after each run
completes (success or failure — one bad run does not cancel the recurring
schedule).

**Caveat (documented prominently in the README):** Chrome must be running
(it does not need to be focused or foregrounded) for alarms to fire. Fully
quitting Chrome pauses all schedules until it's reopened.

## Run History & Output

Each run records a timeline of steps — action taken, target (element label or
coordinates), a screenshot thumbnail or the DOM label snapshot used for that
step, and the model's stated reasoning if provided — plus a final status
(success / failed / stopped) and duration. The dashboard shows this per task;
the side panel shows the live equivalent during an active run. Nothing leaves
the machine except the model API calls themselves, sent to whatever endpoint
the active provider profile points at.

## Error Handling

- Provider unreachable or non-2xx response: surface the actual HTTP
  status/body in the run log — no silent retries that mask a misconfigured
  endpoint. One automatic retry with backoff is allowed only for transient
  network errors (e.g. connection reset), not for 4xx/5xx responses.
- Model targets a stale/nonexistent DOM label or an off-page coordinate: the
  step is marked failed, the loop re-observes (fresh DOM label pass or new
  screenshot) and retries once before aborting the run and marking it failed.
- A scheduled run fails: recorded in history; the next occurrence of a
  recurring schedule is still set normally.

## Testing

No automated test suite for the MVP. Manual verification via `chrome://extensions`
unpacked load, covering:

1. Adding a provider profile against local Ollama and using "Test connection."
2. Running a DOM-strategy task end to end.
3. Running a Visual-strategy task against a vision-capable model
   (e.g. qwen3-vl:2b-instruct).
4. Saving and triggering both a one-off and a recurring schedule.
5. Confirming the approval-gate pause/resume flow for `approve-sensitive` and
   `approve-all` modes.

Flag if an automated (e.g. Playwright-driven) extension test suite is wanted
later — not built for MVP.
