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
        if (!response.ok) throw new Error(response.error || 'content script action failed');
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
      const response = await sendToContentScript(tabId, { type: 'oba:executeAction', action });
      if (!response.ok) throw new Error(response.error || 'content script action failed');
      return response.result;
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
