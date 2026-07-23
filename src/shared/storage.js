(function () {
  function getAll(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => resolve(result[key] || []));
    });
  }

  function setAll(key, items) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: items }, () => resolve());
    });
  }

  async function upsertById(key, item) {
    const items = await getAll(key);
    const index = items.findIndex((existing) => existing.id === item.id);
    if (index >= 0) items[index] = item; else items.push(item);
    await setAll(key, items);
    return item;
  }

  async function removeById(key, id) {
    const items = await getAll(key);
    await setAll(key, items.filter((item) => item.id !== id));
  }

  async function getProfiles() { return getAll('providerProfiles'); }
  async function saveProfile(profile) { return upsertById('providerProfiles', profile); }
  async function deleteProfile(id) { return removeById('providerProfiles', id); }

  async function getTasks() { return getAll('tasks'); }
  async function saveTask(task) { return upsertById('tasks', task); }
  async function deleteTask(id) { return removeById('tasks', id); }

  async function getHistory() { return getAll('runHistory'); }
  async function appendHistoryEntry(entry) {
    const history = await getAll('runHistory');
    history.push(entry);
    while (history.length > 200) history.shift();
    await setAll('runHistory', history);
    return entry;
  }

  globalThis.OBA_Storage = {
    getProfiles, saveProfile, deleteProfile,
    getTasks, saveTask, deleteTask,
    getHistory, appendHistoryEntry
  };
})();
