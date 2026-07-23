const profileForm = document.getElementById('profile-form');
const profileList = document.getElementById('profile-list');
const taskForm = document.getElementById('task-form');
const taskList = document.getElementById('task-list');
const historyList = document.getElementById('history-list');
const taskProfileSelect = document.getElementById('task-profile');
const scheduleType = document.getElementById('schedule-type');

function readProfileForm() {
  return {
    id: document.getElementById('profile-id').value || undefined,
    name: document.getElementById('profile-name').value,
    baseUrl: document.getElementById('profile-baseUrl').value,
    apiKey: document.getElementById('profile-apiKey').value,
    model: document.getElementById('profile-model').value,
    supportsVision: document.getElementById('profile-vision').checked
  };
}

function resetProfileForm() {
  profileForm.reset();
  document.getElementById('profile-baseUrl').value = 'http://localhost:11434/v1';
}

async function renderProfiles() {
  const profiles = await globalThis.OBA_Storage.getProfiles();
  profileList.innerHTML = '';
  taskProfileSelect.innerHTML = '';

  profiles.forEach((profile) => {
    const li = document.createElement('li');
    li.textContent = `${profile.name} (${profile.baseUrl}, ${profile.model})`;

    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => {
      document.getElementById('profile-id').value = profile.id;
      document.getElementById('profile-name').value = profile.name;
      document.getElementById('profile-baseUrl').value = profile.baseUrl;
      document.getElementById('profile-apiKey').value = profile.apiKey || '';
      document.getElementById('profile-model').value = profile.model;
      document.getElementById('profile-vision').checked = Boolean(profile.supportsVision);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      await globalThis.OBA_Storage.deleteProfile(profile.id);
      await renderProfiles();
    });

    li.append(editBtn, deleteBtn);
    profileList.appendChild(li);

    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name;
    taskProfileSelect.appendChild(option);
  });
}

profileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const profile = readProfileForm();
  profile.id = profile.id || globalThis.OBA_Id.generateId();
  await globalThis.OBA_Storage.saveProfile(profile);
  resetProfileForm();
  await renderProfiles();
});

document.getElementById('profile-test').addEventListener('click', async () => {
  const profile = readProfileForm();
  const resultEl = document.getElementById('profile-test-result');
  resultEl.textContent = 'Testing...';
  try {
    const result = await globalThis.OBA_ProviderClient.testConnection(profile);
    resultEl.textContent = result.ok ? `OK. Models: ${result.models.join(', ')}` : `Failed: ${result.message}`;
  } catch (error) {
    resultEl.textContent = `Failed: ${error.message}`;
  }
});

function readTaskForm() {
  const type = scheduleType.value;
  let schedule = null;

  if (type === 'once') {
    const value = document.getElementById('schedule-once-at').value;
    schedule = { type: 'once', at: new Date(value).getTime() };
  } else if (type === 'recurring') {
    const days = Array.from(document.querySelectorAll('#schedule-days input:checked')).map((el) => Number(el.value));
    schedule = {
      type: 'recurring',
      hour: Number(document.getElementById('schedule-hour').value),
      minute: Number(document.getElementById('schedule-minute').value),
      daysOfWeek: days
    };
  }

  return globalThis.OBA_TaskModel.createTask({
    id: document.getElementById('task-id').value || undefined,
    name: document.getElementById('task-name').value,
    prompt: document.getElementById('task-prompt').value,
    startUrl: document.getElementById('task-startUrl').value || null,
    providerProfileId: taskProfileSelect.value,
    strategy: document.getElementById('task-strategy').value,
    autonomyMode: document.getElementById('task-autonomy').value,
    schedule
  });
}

async function renderTasks() {
  const tasks = await globalThis.OBA_Storage.getTasks();
  taskList.innerHTML = '';

  tasks.forEach((task) => {
    const li = document.createElement('li');
    li.textContent = `${task.name} [${task.strategy}/${task.autonomyMode}]`;

    const runBtn = document.createElement('button');
    runBtn.textContent = 'Run now';
    runBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'oba:runTaskNow', task });
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      await globalThis.OBA_Storage.deleteTask(task.id);
      await renderTasks();
    });

    li.append(runBtn, deleteBtn);
    taskList.appendChild(li);
  });
}

taskForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const task = readTaskForm();
  const errors = globalThis.OBA_TaskModel.validateTask(task);
  if (errors.length > 0) {
    alert(errors.join('\n'));
    return;
  }
  await globalThis.OBA_Storage.saveTask(task);
  if (task.schedule) {
    chrome.runtime.sendMessage({ type: 'oba:scheduleTask', task });
  }
  taskForm.reset();
  await renderTasks();
});

async function renderHistory() {
  const history = await globalThis.OBA_Storage.getHistory();
  historyList.innerHTML = '';
  history.slice().reverse().forEach((entry) => {
    const li = document.createElement('li');
    li.textContent = `${new Date(entry.startedAt).toLocaleString()} — ${entry.status} (${entry.stepCount} steps)`;
    historyList.appendChild(li);
  });
}

renderProfiles();
renderTasks();
renderHistory();
