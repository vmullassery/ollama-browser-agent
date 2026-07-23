(function () {
  function formatElementListForPrompt(elements) {
    return elements
      .map((el) => `[${el.id}] ${el.tag}${el.role ? ` role="${el.role}"` : ''} "${el.text || ''}" bbox=(${el.bbox.x},${el.bbox.y},${el.bbox.width},${el.bbox.height})`)
      .join('\n');
  }

  function parseAction(modelText, elements) {
    let parsed;
    try {
      parsed = JSON.parse(modelText);
    } catch (error) {
      throw new Error(`Model response was not valid JSON: ${error.message}`);
    }

    if (!parsed || typeof parsed !== 'object' || !parsed.type) {
      throw new Error('Model response missing "type" field');
    }

    if (parsed.type !== 'done' && parsed.elementId !== undefined) {
      const exists = elements.some((el) => el.id === parsed.elementId);
      if (!exists) {
        throw new Error(`Model referenced unknown elementId "${parsed.elementId}"`);
      }
    }

    return parsed;
  }

  globalThis.OBA_DomStrategy = { formatElementListForPrompt, parseAction };
})();
