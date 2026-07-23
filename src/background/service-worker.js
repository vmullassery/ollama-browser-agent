import '../shared/id.js';
import '../shared/task-model.js';
import '../shared/storage.js';
import '../content/dom-strategy.js';
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

const TAB_LOAD_TIMEOUT_MS = 15000;

// Waits for a tab to finish loading before we touch it, so the first observe() doesn't race the
// content script (which only attaches at document_idle). Resolves early if the tab already
// reports status 'complete', and gives up after a timeout rather than hanging the run forever.
function waitForTabComplete(tabId, timeoutMs = TAB_LOAD_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        finish();
      }
    }

    const timer = setTimeout(finish, timeoutMs);

    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        finish();
        return;
      }
      if (settled) return;
      if (tab && tab.status === 'complete') {
        finish();
        return;
      }
      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}

// chrome.tabs.captureVisibleTab intermittently fails with "image readback failed" when called
// immediately after the tab/window becomes active, before the compositor has painted a frame.
// Retry with a short delay rather than surfacing a transient error as a task failure.
async function captureVisibleTabWithRetry(windowId, attempts = 3, delayMs = 250) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    } catch (error) {
      if (attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

// Scheduled/background runs must not hijack whatever tab the user is currently looking at, so
// those always open a fresh background tab. Manual "Run now" runs for a task with no startUrl
// preserve the older "automate the page I'm looking at" workflow by reusing the active tab,
// since there's no URL to open a fresh tab against and the user is watching the run anyway.
async function getOrCreateTaskTab(task, isScheduled) {
  if (!isScheduled && !task.startUrl) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab) {
      return { tabId: activeTab.id, windowId: activeTab.windowId };
    }
  }

  const tab = await chrome.tabs.create({ url: task.startUrl || 'about:blank', active: false });
  await waitForTabComplete(tab.id);
  return { tabId: tab.id, windowId: tab.windowId };
}

// The user message content is either a plain string (DOM strategy) or an array of parts
// (visual strategy, e.g. [{type:'text',...}, {type:'image_url',...}]) — append the correction
// to the string, or to the first text part, in either shape.
function appendToPromptContent(content, extra) {
  if (!extra) return content;
  if (typeof content === 'string') return content + extra;
  const textPart = content.find((part) => part.type === 'text');
  if (textPart) textPart.text += extra;
  return content;
}

function buildDecidePrompt(task, observation) {
  // The action schema is strategy-specific: DOM strategy has no coordinates, only an element
  // list to pick from; visual strategy has no element list, only pixel coordinates. Describing
  // both schemas together (as a single prompt used to) let the model blend them — e.g. emitting
  // "click" with both an invented elementId AND x/y. Only offer the fields that are actually
  // usable for the active strategy.
  let schema;
  let rules;
  if (observation.elementsPrompt) {
    schema = '{"type":"click"|"type"|"scroll"|"extract"|"done","elementId":<integer>,"text":<string>,"deltaY":<number>}';
    rules = ' The "elementId" field is REQUIRED for "click"/"type"/"extract" and MUST be exactly one of the '
      + 'integers shown in [brackets] at the start of a line in the element list below — copy it '
      + 'verbatim, never invent, guess, or construct an id. Example: to click the element listed as '
      + '"[3] button ...", respond {"type":"click","elementId":3}. Do NOT use "click-coordinates" or '
      + 'include "x"/"y" — there is no screenshot, only the element list below.';
  } else {
    schema = '{"type":"click-coordinates"|"scroll"|"done","x":<number>,"y":<number>,"deltaY":<number>}';
    rules = ' There is no element list — you must use "click-coordinates" with pixel "x"/"y" from the '
      + 'screenshot, never "click" and never "elementId" (there is nothing for an elementId to refer to).';
  }
  const system = {
    role: 'system',
    content: 'You control a web browser to accomplish the user\'s goal. Respond with ONLY a single JSON '
      + `object and nothing else (no markdown, no code fences, no explanation): ${schema}.`
      + rules
      + ' Use "done" once the goal is complete.'
  };
  const viewportNote = (observation.screenshot && observation.viewportWidth && observation.viewportHeight)
    ? ` The screenshot is ${observation.viewportWidth}x${observation.viewportHeight} CSS pixels; respond with click-coordinates x/y in that same coordinate space.`
    : '';
  const textPart = `Goal: ${task.prompt}\n\n${observation.elementsPrompt ? `Current page elements (choose elementId only from these):\n${observation.elementsPrompt}` : `A screenshot of the current page is attached.${viewportNote}`}`;

  if (observation.screenshot) {
    return [system, { role: 'user', content: [{ type: 'text', text: textPart }, { type: 'image_url', image_url: { url: observation.screenshot } }] }];
  }
  return [system, { role: 'user', content: textPart }];
}

function makeDeps(task, profile, tabId, windowId, onStep) {
  // Captured so recordStep can attach it to the step sent to the UI — lets the side panel show
  // exactly what the model said for every step (success or failure) without opening devtools.
  let lastRawModelResponse = null;

  return {
    async observe() {
      if (task.strategy === 'dom') {
        const response = await sendToContentScript(tabId, { type: 'oba:scanDom' });
        if (!response.ok) throw new Error(response.error || 'content script action failed');
        return { elementsPrompt: globalThis.OBA_DomStrategy.formatElementListForPrompt(response.elements), elements: response.elements };
      }
      // captureVisibleTab can only capture the active tab of a given window, so the task's
      // (possibly background) tab must be made active within its own window first. Since the
      // task tab is not necessarily in the user's focused window, this does not steal window
      // focus from whatever the user is looking at — unless the task tab happens to share a
      // window with the user's foreground tab, in which case this will visually switch what's
      // shown in that window. There is no Chrome extension API to screenshot a non-active tab.
      await new Promise((resolve) => chrome.tabs.update(tabId, { active: true }, () => resolve()));
      const dataUrl = await captureVisibleTabWithRetry(windowId);
      let viewportWidth;
      let viewportHeight;
      try {
        const viewport = await sendToContentScript(tabId, { type: 'oba:captureViewportSize' });
        if (viewport?.ok) {
          viewportWidth = viewport.width;
          viewportHeight = viewport.height;
        }
      } catch (error) {
        // Non-fatal: fall back to sending the screenshot without a coordinate-space hint.
      }
      return { screenshot: dataUrl, viewportWidth, viewportHeight };
    },
    async decide(currentTask, observation, history) {
      lastRawModelResponse = null;
      const lastStep = history && history.length > 0 ? history[history.length - 1] : null;
      const correction = lastStep && lastStep.status === 'failed'
        ? `\n\nYour previous response was invalid: ${lastStep.error}. Re-read the element list carefully and respond with a corrected JSON action.`
        : '';
      const messages = buildDecidePrompt(currentTask, observation);
      messages[messages.length - 1].content = appendToPromptContent(messages[messages.length - 1].content, correction);
      const content = await globalThis.OBA_ProviderClient.callProvider(profile, messages);
      lastRawModelResponse = content;
      return globalThis.OBA_DomStrategy.parseAction(content, observation.elements || []);
    },
    async requestApproval(action) {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'oba:approvalRequest', action }, (response) => resolve(Boolean(response?.approved)));
      });
    },
    async execute(action) {
      if (action.type === 'done') return { done: true };
      const response = await sendToContentScript(tabId, { type: 'oba:executeAction', action });
      if (!response.ok) throw new Error(response.error || 'content script action failed');
      return response.result;
    },
    async recordStep(stepResult) {
      onStep({ ...stepResult, rawModelResponse: lastRawModelResponse });
    }
  };
}

async function runTask(task, isScheduled = false) {
  const profiles = await globalThis.OBA_Storage.getProfiles();
  const profile = profiles.find((p) => p.id === task.providerProfileId);
  if (!profile) throw new Error(`Provider profile ${task.providerProfileId} not found`);

  const { tabId, windowId } = await getOrCreateTaskTab(task, isScheduled);

  const deps = makeDeps(task, profile, tabId, windowId, (step) => {
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
  runTask: (task) => runTask(task, true),
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
