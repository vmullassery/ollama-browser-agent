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

function buildDecidePrompt(task, observation) {
  const system = {
    role: 'system',
    content: 'You control a web browser to accomplish the user\'s goal. Respond ONLY with JSON: '
      + '{"type":"click"|"type"|"scroll"|"extract"|"click-coordinates"|"done","elementId":<id>,"text":<string>,"x":<number>,"y":<number>,"deltaY":<number>}. '
      + 'Use "done" once the goal is complete.'
  };
  const viewportNote = (observation.screenshot && observation.viewportWidth && observation.viewportHeight)
    ? ` The screenshot is ${observation.viewportWidth}x${observation.viewportHeight} CSS pixels; respond with click-coordinates x/y in that same coordinate space.`
    : '';
  const textPart = `Goal: ${task.prompt}\n\n${observation.elementsPrompt ? `Current page elements:\n${observation.elementsPrompt}` : `A screenshot of the current page is attached.${viewportNote}`}`;

  if (observation.screenshot) {
    return [system, { role: 'user', content: [{ type: 'text', text: textPart }, { type: 'image_url', image_url: { url: observation.screenshot } }] }];
  }
  return [system, { role: 'user', content: textPart }];
}

function makeDeps(task, profile, tabId, windowId, onStep) {
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
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
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
      const response = await sendToContentScript(tabId, { type: 'oba:executeAction', action });
      if (!response.ok) throw new Error(response.error || 'content script action failed');
      return response.result;
    },
    async recordStep(stepResult) {
      onStep(stepResult);
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
