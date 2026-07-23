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
