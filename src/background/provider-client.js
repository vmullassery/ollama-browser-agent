(function () {
  function buildChatRequestBody(profile, messages) {
    return {
      model: profile.model,
      messages,
      temperature: 0.2,
      stream: false
    };
  }

  function parseChatResponse(json) {
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('Provider response missing choices[0].message.content');
    }
    return content;
  }

  function buildHeaders(profile) {
    const headers = { 'Content-Type': 'application/json' };
    if (profile.apiKey) headers.Authorization = `Bearer ${profile.apiKey}`;
    return headers;
  }

  function normalizeBaseUrl(baseUrl) {
    return String(baseUrl || '').replace(/\/+$/, '');
  }

  async function callProvider(profile, messages, fetchImpl) {
    const doFetch = fetchImpl || fetch;
    const url = `${normalizeBaseUrl(profile.baseUrl)}/chat/completions`;
    const response = await doFetch(url, {
      method: 'POST',
      headers: buildHeaders(profile),
      body: JSON.stringify(buildChatRequestBody(profile, messages))
    });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new Error(`Provider request failed: ${response.status} ${response.statusText} ${bodyText}`.trim());
    }
    const json = await response.json();
    return parseChatResponse(json);
  }

  async function testConnection(profile, fetchImpl) {
    const doFetch = fetchImpl || fetch;
    const url = `${normalizeBaseUrl(profile.baseUrl)}/models`;
    const response = await doFetch(url, { headers: buildHeaders(profile) });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      return { ok: false, status: response.status, message: `${response.status} ${response.statusText} ${bodyText}`.trim() };
    }
    const json = await response.json();
    const models = Array.isArray(json.data)
      ? json.data.map((m) => m.id)
      : Array.isArray(json.models)
        ? json.models.map((m) => m.name)
        : [];
    return { ok: true, models };
  }

  globalThis.OBA_ProviderClient = {
    buildChatRequestBody, parseChatResponse, buildHeaders, normalizeBaseUrl, callProvider, testConnection
  };
})();
