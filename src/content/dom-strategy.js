(function () {
  function formatElementListForPrompt(elements) {
    return elements
      .map((el) => `[${el.id}] ${el.tag}${el.role ? ` role="${el.role}"` : ''} "${el.text || ''}" bbox=(${el.bbox.x},${el.bbox.y},${el.bbox.width},${el.bbox.height})`)
      .join('\n');
  }

  function extractJsonCandidate(modelText) {
    let text = String(modelText || '').trim();

    // Strip a markdown code fence if the model wrapped its answer in one, e.g. ```json ... ```
    const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenceMatch) {
      text = fenceMatch[1].trim();
    }

    return text;
  }

  function truncateForError(text) {
    const snippet = text.length > 300 ? `${text.slice(0, 300)}…` : text;
    return snippet.replace(/\n/g, '\\n');
  }

  function parseAction(modelText, elements) {
    const text = extractJsonCandidate(modelText);

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (firstError) {
      // Some models emit stray commentary before/after the JSON object, or emit more than one
      // JSON object (e.g. one per line), despite instructions not to. Fall back to just the
      // FIRST {...} object — a non-greedy match, since a greedy one would span multiple
      // concatenated objects and fail to parse for the same reason as the original text.
      const braceMatch = text.match(/\{[\s\S]*?\}/);
      if (!braceMatch) {
        throw new Error(`Model response was not valid JSON: ${firstError.message}. Raw response: "${truncateForError(text)}"`);
      }
      try {
        parsed = JSON.parse(braceMatch[0]);
      } catch (secondError) {
        throw new Error(`Model response was not valid JSON: ${secondError.message}. Raw response: "${truncateForError(text)}"`);
      }
    }

    if (!parsed || typeof parsed !== 'object' || !parsed.type) {
      throw new Error(`Model response missing "type" field. Raw response: "${truncateForError(text)}"`);
    }

    // Models sometimes emit elementId as a numeric string (e.g. "3") instead of a number.
    // Coerce it before comparing against the (numeric) element ids.
    if (typeof parsed.elementId === 'string' && /^\d+$/.test(parsed.elementId)) {
      parsed.elementId = Number(parsed.elementId);
    }

    const ELEMENT_ID_REQUIRED_TYPES = new Set(['click', 'type', 'extract']);
    if (ELEMENT_ID_REQUIRED_TYPES.has(parsed.type)) {
      if (parsed.elementId === undefined) {
        throw new Error(
          `Model response has type "${parsed.type}" but no "elementId". If there is no element list `
          + `(visual strategy), use "click-coordinates" with x/y instead. Raw response: "${truncateForError(text)}"`
        );
      }
      const exists = elements.some((el) => el.id === parsed.elementId);
      if (!exists) {
        const validIds = elements.length > 0
          ? `Valid ids are 0-${elements.length - 1}.`
          : 'The element list was empty — use "click-coordinates" with x/y instead of "elementId" when there is no element list.';
        throw new Error(`Model referenced unknown elementId "${parsed.elementId}". ${validIds} Raw response: "${truncateForError(text)}"`);
      }
    }

    if (parsed.type === 'click-coordinates' && (typeof parsed.x !== 'number' || typeof parsed.y !== 'number')) {
      throw new Error(`Model response has type "click-coordinates" but x/y are missing or not numbers. Raw response: "${truncateForError(text)}"`);
    }

    return parsed;
  }

  globalThis.OBA_DomStrategy = { formatElementListForPrompt, parseAction };
})();
