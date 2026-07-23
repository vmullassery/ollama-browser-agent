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

    if (parsed.type !== 'done' && parsed.elementId !== undefined) {
      const exists = elements.some((el) => el.id === parsed.elementId);
      if (!exists) {
        const validIds = elements.length > 0
          ? `Valid ids are 0-${elements.length - 1}.`
          : 'The element list was empty.';
        throw new Error(`Model referenced unknown elementId "${parsed.elementId}". ${validIds} Raw response: "${truncateForError(text)}"`);
      }
    }

    return parsed;
  }

  globalThis.OBA_DomStrategy = { formatElementListForPrompt, parseAction };
})();
