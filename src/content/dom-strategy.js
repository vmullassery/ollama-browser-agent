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

  function parseAction(modelText, elements) {
    const text = extractJsonCandidate(modelText);

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (firstError) {
      // Some models emit stray commentary before/after the JSON object despite instructions
      // not to. Fall back to the first balanced-looking {...} substring before giving up.
      const braceMatch = text.match(/\{[\s\S]*\}/);
      if (!braceMatch) {
        throw new Error(`Model response was not valid JSON: ${firstError.message}`);
      }
      try {
        parsed = JSON.parse(braceMatch[0]);
      } catch (secondError) {
        throw new Error(`Model response was not valid JSON: ${secondError.message}`);
      }
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
