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
