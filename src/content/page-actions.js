(function () {
  function clickElement(id) {
    const el = globalThis.OBA_DomScan.getElementById(id);
    if (!el) throw new Error(`No element with id ${id}`);
    globalThis.OBA_VisualOverlay.highlightElement(el);
    el.click();
  }

  function typeIntoElement(id, text) {
    const el = globalThis.OBA_DomScan.getElementById(id);
    if (!el) throw new Error(`No element with id ${id}`);
    globalThis.OBA_VisualOverlay.highlightElement(el);
    el.focus();
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function scrollBy(deltaY) {
    window.scrollBy({ top: deltaY, behavior: 'smooth' });
  }

  function extractText(id) {
    const el = globalThis.OBA_DomScan.getElementById(id);
    if (!el) throw new Error(`No element with id ${id}`);
    return el.innerText || el.value || '';
  }

  function clickAtCoordinates(x, y) {
    globalThis.OBA_VisualOverlay.showCursorMoveTo(x, y);
    const el = document.elementFromPoint(x, y);
    if (!el) throw new Error(`No element at (${x}, ${y})`);
    globalThis.OBA_VisualOverlay.highlightElement(el, 400);
    el.click();
  }

  globalThis.OBA_PageActions = { clickElement, typeIntoElement, scrollBy, extractText, clickAtCoordinates };
})();
