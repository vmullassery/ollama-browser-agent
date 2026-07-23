const taskSelect = document.getElementById('task-select');
const runBtn = document.getElementById('run-btn');
const stepLog = document.getElementById('step-log');
const approvalBox = document.getElementById('approval');
const approvalText = document.getElementById('approval-text');
const approveBtn = document.getElementById('approve-btn');
const denyBtn = document.getElementById('deny-btn');
const statusBox = document.getElementById('status');
const statusSpinner = document.getElementById('status-spinner');
const statusText = document.getElementById('status-text');

let pendingApprovalResponder = null;
let runningTaskId = null;

function setStatus(state, text) {
  statusBox.className = `status status-${state}`;
  statusSpinner.classList.toggle('hidden', state !== 'running');
  statusText.textContent = text;
}

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
  const selectedTaskId = taskSelect.value;
  const tasks = await globalThis.OBA_Storage.getTasks();
  const task = tasks.find((t) => t.id === selectedTaskId);
  if (!task) return;
  stepLog.innerHTML = '';
  runningTaskId = task.id;
  runBtn.disabled = true;
  setStatus('running', 'Running…');

  chrome.runtime.sendMessage({ type: 'oba:runTaskNow', task }, (response) => {
    runBtn.disabled = false;
    if (response && response.ok === false) {
      const li = document.createElement('li');
      li.textContent = `error: ${response.error}`;
      stepLog.appendChild(li);
      setStatus('failed', `Failed: ${response.error}`);
      return;
    }
    const result = response?.result;
    if (!result) return;
    if (result.status === 'success') {
      setStatus('success', `Done — ${result.steps.length} step(s)`);
    } else if (result.status === 'failed') {
      setStatus('failed', `Failed: ${result.reason || 'unknown error'}`);
    } else {
      setStatus('stopped', `Stopped: ${result.reason || 'stopped'}`);
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'oba:runStep') {
    if (message.taskId !== runningTaskId) return false;
    const li = document.createElement('li');
    const detail = message.step.status === 'failed' && message.step.error
      ? message.step.error
      : JSON.stringify(message.step.action);
    li.textContent = `${message.step.status}: ${detail}`;

    if (message.step.rawModelResponse) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'Model output';
      const pre = document.createElement('pre');
      pre.textContent = message.step.rawModelResponse;
      details.append(summary, pre);
      li.appendChild(details);
    }

    stepLog.appendChild(li);
    setStatus('running', `Running… (step ${stepLog.children.length})`);
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
