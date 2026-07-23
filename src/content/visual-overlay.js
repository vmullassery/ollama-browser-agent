(function () {
  let cursorEl = null;

  function ensureCursor() {
    if (cursorEl) return cursorEl;
    cursorEl = document.createElement('div');
    cursorEl.style.position = 'fixed';
    cursorEl.style.width = '18px';
    cursorEl.style.height = '18px';
    cursorEl.style.borderRadius = '50%';
    cursorEl.style.background = 'rgba(255,80,80,0.85)';
    cursorEl.style.border = '2px solid white';
    cursorEl.style.zIndex = '2147483647';
    cursorEl.style.pointerEvents = 'none';
    cursorEl.style.transition = 'left 0.3s ease, top 0.3s ease';
    document.documentElement.appendChild(cursorEl);
    return cursorEl;
  }

  function showCursorMoveTo(x, y) {
    const el = ensureCursor();
    el.style.left = `${x - 9}px`;
    el.style.top = `${y - 9}px`;
  }

  function highlightElement(targetEl, durationMs) {
    const rect = targetEl.getBoundingClientRect();
    const box = document.createElement('div');
    box.style.position = 'fixed';
    box.style.left = `${rect.x}px`;
    box.style.top = `${rect.y}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    box.style.border = '2px solid #ff5050';
    box.style.zIndex = '2147483646';
    box.style.pointerEvents = 'none';
    document.documentElement.appendChild(box);
    showCursorMoveTo(rect.x + rect.width / 2, rect.y + rect.height / 2);
    setTimeout(() => box.remove(), durationMs || 600);
  }

  globalThis.OBA_VisualOverlay = { showCursorMoveTo, highlightElement };
})();
