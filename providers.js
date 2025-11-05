// providers.js - Enhanced AI Provider Integrations

/**
 * Call AI provider with prompt and return full text response
 * @param {Object} params - Request parameters
 * @param {string} params.provider - AI provider name
 * @param {string} params.model - Model name (optional)
 * @param {string} params.prompt - User prompt
 * @param {string} params.systemPrompt - System prompt (optional)
 * @param {Object} params.cfg - Configuration with API keys
 * @returns {Promise<string>} - AI response text
 */
export async function callAI({ provider, model, prompt, systemPrompt, cfg }) {
  const sysDefault = systemPrompt || 'You are a helpful assistant. Return concise results.';

  // Resolve API keys and Azure config
  const openaiKey = cfg.openai_key || '';
  const anthropicKey = cfg.anthropic_key || '';
  const googleKey = cfg.google_key || '';
  const deepseekKey = cfg.deepseek_key || '';
  const azureKey = cfg.azure_api_key || '';
  const azureEndpoint = (cfg.azure_endpoint || '').trim();
  const azureDeployment = (cfg.azure_deployment || '').trim();
  const azureApiVersion = (cfg.azure_api_version || '2024-02-01').trim();

  let url;
  let headers = { 'Content-Type': 'application/json' };
  let body;

  switch (provider) {
    case 'azure': {
      if (!azureEndpoint || !azureKey || !azureDeployment) {
        throw new Error('Azure configuration is incomplete. Set endpoint, deployment, and API key in Settings.');
      }

      // Validate Azure endpoint is HTTPS
      if (!azureEndpoint.startsWith('https://')) {
        throw new Error('Azure endpoint must use HTTPS. Please update your endpoint URL.');
      }

      const normalizedEndpoint = azureEndpoint.endsWith('/') ? azureEndpoint : azureEndpoint + '/';
      url = `${normalizedEndpoint}openai/deployments/${azureDeployment}/chat/completions?api-version=${encodeURIComponent(azureApiVersion)}`;
      headers = { 'Content-Type': 'application/json', 'api-key': azureKey };
      body = {
        messages: [
          { role: 'system', content: sysDefault },
          { role: 'user', content: prompt }
        ],
        model: model || undefined,
        temperature: 0.7
      };
      break;
    }

    case 'openai': {
      if (!openaiKey) throw new Error('OpenAI API key not set. Add it in Settings.');
      url = 'https://api.openai.com/v1/chat/completions';
      headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` };
      body = {
        model: model || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: sysDefault },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7
      };
      break;
    }

    case 'anthropic': {
      if (!anthropicKey) throw new Error('Anthropic API key not set. Add it in Settings.');
      url = 'https://api.anthropic.com/v1/messages';
      headers = {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      };
      body = {
        model: model || 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        system: sysDefault,
        messages: [{ role: 'user', content: prompt }]
      };
      break;
    }

    case 'google': {
      if (!googleKey) throw new Error('Google Gemini API key not set. Add it in Settings.');
      const mdl = model || 'gemini-1.5-flash';
      url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(mdl)}:generateContent?key=${encodeURIComponent(googleKey)}`;

      // Gemini expects contents with parts
      body = {
        contents: [
          {
            role: 'user',
            parts: [
              { text: sysDefault },
              { text: prompt }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.7
        }
      };
      headers = { 'Content-Type': 'application/json' };
      break;
    }

    case 'deepseek':
    default: {
      if (!deepseekKey) throw new Error('DeepSeek API key not set. Add it in Settings.');
      url = 'https://api.deepseek.com/chat/completions';
      headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${deepseekKey}` };
      body = {
        model: model || 'deepseek-chat',
        messages: [
          { role: 'system', content: sysDefault },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        stream: false
      };
      break;
    }
  }

  const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!resp.ok) {
    const errText = await safeText(resp);
    let errorMsg = `${provider} API error ${resp.status}`;

    // Try to parse error details
    try {
      const errData = JSON.parse(errText);
      if (errData.error?.message) {
        errorMsg += `: ${errData.error.message}`;
      } else if (errData.message) {
        errorMsg += `: ${errData.message}`;
      } else {
        errorMsg += `: ${truncate(errText, 200)}`;
      }
    } catch {
      errorMsg += `: ${truncate(errText, 200)}`;
    }

    throw new Error(errorMsg);
  }

  const data = await resp.json();

  // Normalize to text
  if (provider === 'openai' || provider === 'deepseek' || provider === 'azure') {
    return data?.choices?.[0]?.message?.content || '';
  }
  if (provider === 'anthropic') {
    const parts = data?.content || [];
    const text = parts.map((p) => p?.text).filter(Boolean).join('\n');
    return text;
  }
  if (provider === 'google') {
    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const text = parts.map((p) => p?.text).filter(Boolean).join('\n');
    return text;
  }
  return '';
}

/**
 * Stream AI response with incremental deltas
 * @param {Object} params - Request parameters
 * @param {string} params.provider - AI provider name
 * @param {string} params.model - Model name (optional)
 * @param {string} params.prompt - User prompt
 * @param {string} params.systemPrompt - System prompt (optional)
 * @param {Object} params.cfg - Configuration with API keys
 * @param {Function} params.onDelta - Callback for incremental text chunks
 * @returns {Promise<string>} - Full accumulated text
 */
export async function streamAI({ provider, model, prompt, systemPrompt, cfg, onDelta }) {
  const sysDefault = systemPrompt || 'You are a helpful assistant. Return concise results.';

  // Resolve API keys and config
  const openaiKey = cfg.openai_key || '';
  const anthropicKey = cfg.anthropic_key || '';
  const googleKey = cfg.google_key || '';
  const deepseekKey = cfg.deepseek_key || '';
  const azureKey = cfg.azure_api_key || '';
  const azureEndpoint = (cfg.azure_endpoint || '').trim();
  const azureDeployment = (cfg.azure_deployment || '').trim();
  const azureApiVersion = (cfg.azure_api_version || '2024-02-01').trim();

  let url;
  let headers = { 'Content-Type': 'application/json' };
  let body;
  let mode = provider;

  switch (provider) {
    case 'azure': {
      if (!azureEndpoint || !azureKey || !azureDeployment) {
        throw new Error('Azure configuration is incomplete.');
      }

      if (!azureEndpoint.startsWith('https://')) {
        throw new Error('Azure endpoint must use HTTPS.');
      }

      const base = azureEndpoint.endsWith('/') ? azureEndpoint : azureEndpoint + '/';
      url = `${base}openai/deployments/${azureDeployment}/chat/completions?api-version=${encodeURIComponent(azureApiVersion)}`;
      headers = { 'Content-Type': 'application/json', 'api-key': azureKey };
      body = {
        model: model || undefined,
        messages: [
          { role: 'system', content: sysDefault },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        stream: true
      };
      break;
    }

    case 'openai': {
      if (!openaiKey) throw new Error('OpenAI API key not set.');
      url = 'https://api.openai.com/v1/chat/completions';
      headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` };
      body = {
        model: model || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: sysDefault },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        stream: true
      };
      break;
    }

    case 'anthropic': {
      if (!anthropicKey) throw new Error('Anthropic API key not set.');
      url = 'https://api.anthropic.com/v1/messages';
      headers = {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      };
      body = {
        model: model || 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        system: sysDefault,
        messages: [{ role: 'user', content: prompt }],
        stream: true
      };
      break;
    }

    case 'google': {
      if (!googleKey) throw new Error('Google Gemini API key not set.');
      const mdl = model || 'gemini-1.5-flash';

      // Use streamGenerateContent endpoint for streaming
      url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(mdl)}:streamGenerateContent?key=${encodeURIComponent(googleKey)}&alt=sse`;

      body = {
        contents: [
          {
            role: 'user',
            parts: [
              { text: sysDefault },
              { text: prompt }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.7
        }
      };
      headers = { 'Content-Type': 'application/json' };
      mode = 'google';
      break;
    }

    case 'deepseek':
    default: {
      if (!deepseekKey) throw new Error('DeepSeek API key not set.');
      url = 'https://api.deepseek.com/chat/completions';
      headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${deepseekKey}` };
      body = {
        model: model || 'deepseek-chat',
        messages: [
          { role: 'system', content: sysDefault },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        stream: true
      };
      mode = 'openai-like';
      break;
    }
  }

  const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!resp.ok) {
    const err = await safeText(resp);
    let errorMsg = `${provider} API error ${resp.status}`;

    try {
      const errData = JSON.parse(err);
      if (errData.error?.message) {
        errorMsg += `: ${errData.error.message}`;
      } else if (errData.message) {
        errorMsg += `: ${errData.message}`;
      } else {
        errorMsg += `: ${truncate(err, 200)}`;
      }
    } catch {
      errorMsg += `: ${truncate(err, 200)}`;
    }

    throw new Error(errorMsg);
  }

  // Handle streaming response
  const reader = resp.body?.getReader();
  if (!reader) {
    const text = await safeText(resp);
    if (onDelta) onDelta(text);
    return text;
  }

  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Split on newlines for SSE
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() || '';

    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const dataStr = trimmed.slice(5).trim();
      if (dataStr === '[DONE]') continue;

      try {
        const evt = JSON.parse(dataStr);

        if (provider === 'anthropic') {
          // Anthropic format: { type: 'content_block_delta', delta: { text: '...' } }
          const t = evt?.delta?.text || evt?.content_block?.text || '';
          if (t) {
            full += t;
            if (onDelta) onDelta(t);
          }
        } else if (provider === 'google') {
          // Gemini streaming format: { candidates: [{ content: { parts: [{ text: '...' }] } }] }
          const candidate = evt?.candidates?.[0];
          const parts = candidate?.content?.parts || [];
          const text = parts.map(p => p?.text).filter(Boolean).join('');
          if (text) {
            full += text;
            if (onDelta) onDelta(text);
          }
        } else {
          // OpenAI-like stream: { choices: [{ delta: { content: '...' } }] }
          const t = evt?.choices?.[0]?.delta?.content || '';
          if (t) {
            full += t;
            if (onDelta) onDelta(t);
          }
        }
      } catch (parseErr) {
        // Ignore JSON parse errors from keepalive/comments
        console.debug('SSE parse error (non-critical):', parseErr.message);
      }
    }
  }

  return full;
}

/**
 * Safely get text from response, catching errors
 */
async function safeText(resp) {
  try {
    return await resp.text();
  } catch {
    return '';
  }
}

/**
 * Truncate string to max length
 */
function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}
