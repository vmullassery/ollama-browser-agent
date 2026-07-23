(function () {
  const INTERACTIVE_SELECTOR = 'a, button, input, textarea, select, [role="button"], [role="link"], [onclick]';

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

  function scanInteractiveElements() {
    const nodes = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR)).filter(isVisible);
    return nodes.map((el, index) => {
      const rect = el.getBoundingClientRect();
      el.dataset.obaId = String(index);
      return {
        id: index,
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || '',
        text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 80),
        bbox: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      };
    });
  }

  function getElementById(id) {
    return document.querySelector(`[data-oba-id="${id}"]`);
  }

  globalThis.OBA_DomScan = { scanInteractiveElements, getElementById };
})();
