(function () {
  function generateId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  globalThis.OBA_Id = { generateId };
})();
