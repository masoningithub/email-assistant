// background.js (service worker, MV3, type: module)
import { callAI, streamAI } from './providers.js';

// Service worker lifecycle
chrome.runtime.onInstalled.addListener(() => {
  console.log('AI Email Assistant installed/updated');

  // Set up action button to open side panel
  chrome.action.onClicked.addListener(async (tab) => {
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
    } catch (e) {
      console.warn('sidePanel.open failed:', e);
      // Fallback: try opening without tabId
      try {
        await chrome.sidePanel.open({});
      } catch (fallbackErr) {
        console.error('Failed to open side panel:', fallbackErr);
      }
    }
  });
});

// Handle non-streaming requests from the side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === 'callAI') {
      const { provider, model, prompt, systemPrompt } = message;

      // Load keys from storage
      const cfg = await chrome.storage.local.get([
        'openai_key',
        'anthropic_key',
        'google_key',
        'deepseek_key',
        'azure_api_key',
        'azure_endpoint',
        'azure_deployment',
        'azure_api_version'
      ]);

      try {
        const text = await callAI({ provider, model, prompt, systemPrompt, cfg });
        sendResponse({ ok: true, text });
      } catch (err) {
        const errorMsg = (err && err.message) || String(err);
        console.error('AI call failed:', errorMsg);
        sendResponse({ ok: false, error: errorMsg });
      }
      return;
    }
  })();

  // Indicate async response
  return true;
});

// Handle streaming requests via long-lived port
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ai-stream') return;

  port.onMessage.addListener(async (msg) => {
    if (msg?.type !== 'start') return;

    const { provider, model, prompt, systemPrompt } = msg;

    // Load configuration from storage
    const cfg = await chrome.storage.local.get([
      'openai_key',
      'anthropic_key',
      'google_key',
      'deepseek_key',
      'azure_api_key',
      'azure_endpoint',
      'azure_deployment',
      'azure_api_version'
    ]);

    try {
      const fullText = await streamAI({
        provider,
        model,
        prompt,
        systemPrompt,
        cfg,
        onDelta: (delta) => {
          // Send incremental delta to frontend
          if (delta) {
            try {
              port.postMessage({ type: 'delta', text: delta });
            } catch (portErr) {
              // Port may have been disconnected
              console.debug('Port disconnected during delta send:', portErr.message);
            }
          }
        }
      });

      // Send final completion message
      try {
        port.postMessage({ type: 'done', text: fullText });
      } catch (portErr) {
        console.debug('Port disconnected during done send:', portErr.message);
      }
    } catch (err) {
      const errorMsg = (err && err.message) || String(err);
      console.error('Stream AI failed:', errorMsg);

      // Send error to frontend
      try {
        port.postMessage({ type: 'error', error: errorMsg });
      } catch (portErr) {
        console.debug('Port disconnected during error send:', portErr.message);
      }
    }
  });

  // Handle port disconnect
  port.onDisconnect.addListener(() => {
    console.debug('AI stream port disconnected');
  });
});

// Handle service worker errors
self.addEventListener('error', (event) => {
  console.error('Service worker error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
});
