// sidepanel.js - Enhanced AI Email Assistant

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// DOM Elements
const providerEl = $('#provider');
const modelEl = $('#model');
const inputEl = $('#input');
const outputEl = $('#output');
const statusEl = $('#status');
const charCountEl = $('#charCount');
const costEstimateEl = $('#costEstimate');
const providerStatusEl = $('#providerStatus');
const emailContextEl = $('#emailContext');
const contextCharCountEl = $('#contextCharCount');

// Settings fields
const settingsFields = [
  'openai_key', 'anthropic_key', 'google_key', 'deepseek_key',
  'azure_api_key', 'azure_endpoint', 'azure_deployment', 'azure_api_version'
];

// State
let currentPort = null;
let isStreaming = false;
let responseHistory = [];
let historyIndex = -1;
let currentOriginalText = '';
let lastRequestTime = 0;
const RATE_LIMIT_MS = 1000; // 1 second between requests
let sidebarOpen = false;

// System Prompt Presets
const SYSTEM_PROMPTS = {
  default: 'You are a helpful assistant. Return concise results.',
  professional: 'You are a professional email writing expert. Focus on clarity, professionalism, and proper business etiquette. Maintain a polished and respectful tone.',
  concise: 'You are an expert at concise communication. Be direct, brief, and eliminate unnecessary words while maintaining clarity and professionalism.',
  friendly: 'You are a friendly communication assistant. Use a warm, approachable tone while maintaining professionalism. Be conversational but respectful.',
  formal: 'You are a formal business communication expert. Use proper formal language, avoid contractions, and maintain a highly professional tone suitable for corporate correspondence.',
  custom: ''
};

// Token cost estimation (approximate, per 1K tokens)
const TOKEN_COSTS = {
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4': { input: 0.03, output: 0.06 },
  'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
  'claude-3-opus-20240229': { input: 0.015, output: 0.075 },
  'gemini-1.5-flash': { input: 0.000075, output: 0.0003 },
  'gemini-1.5-pro': { input: 0.00125, output: 0.005 },
  'deepseek-chat': { input: 0.00014, output: 0.00028 }
};

// ============================================================================
// Initialization
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  await restoreSettings();
  await restoreTheme();
  await restoreUIState();
  updateKeyStatusIndicators();
  updateCharCount();
  updateContextCharCount();
  setupEventListeners();

  // Auto-focus input
  inputEl.focus();
});

// ============================================================================
// Event Listeners Setup
// ============================================================================

function setupEventListeners() {
  // Sidebar toggle
  $('#sidebarToggle').addEventListener('click', toggleSidebar);
  $('#sidebarClose').addEventListener('click', toggleSidebar);
  $('#sidebarBackdrop').addEventListener('click', toggleSidebar);

  // Theme toggle
  $('#themeToggle').addEventListener('click', toggleTheme);

  // Settings
  $('#saveSettings').addEventListener('click', saveSettings);
  $('#exportSettings').addEventListener('click', exportSettings);
  $('#importSettings').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', importSettings);

  // Password toggles
  $$('.toggle-password').forEach(btn => {
    btn.addEventListener('click', () => togglePassword(btn.dataset.target));
  });

  // Provider change
  providerEl.addEventListener('change', onProviderChange);

  // System prompt preset
  $('#promptPreset').addEventListener('change', onPromptPresetChange);

  // Input actions
  $('#grabSelection').addEventListener('click', grabSelection);
  $('#pasteFromClipboard').addEventListener('click', pasteFromClipboard);
  $('#clearInput').addEventListener('click', clearInput);
  inputEl.addEventListener('input', onInputChange);

  // Email context actions
  $('#clearContext').addEventListener('click', clearContext);
  emailContextEl.addEventListener('input', onContextChange);

  // Operation buttons
  $('#revise').addEventListener('click', () => send('revise'));
  $('#makeFormal').addEventListener('click', () => send('formal'));
  $('#makeCasual').addEventListener('click', () => send('casual'));
  $('#shorten').addEventListener('click', () => send('shorten'));
  $('#expand').addEventListener('click', () => send('expand'));
  $('#cancelStream').addEventListener('click', cancelStream);

  // Output actions
  $('#copyOutput').addEventListener('click', copyOutput);
  $('#clearOutput').addEventListener('click', clearOutput);
  $('#downloadOutput').addEventListener('click', downloadOutput);
  $('#toggleDiff').addEventListener('click', toggleDiff);

  // History navigation
  $('#historyPrev').addEventListener('click', () => navigateHistory(-1));
  $('#historyNext').addEventListener('click', () => navigateHistory(1));

  // Keyboard shortcuts
  document.addEventListener('keydown', handleKeyboardShortcuts);

  // Settings panel state persistence
  $('#settings').addEventListener('toggle', saveUIState);
  $('#promptSettings').addEventListener('toggle', saveUIState);
  $('#contextSettings').addEventListener('toggle', saveUIState);

  // API key input changes
  settingsFields.forEach(field => {
    const el = document.getElementById(field);
    if (el) {
      el.addEventListener('input', updateKeyStatusIndicators);
    }
  });
}

// ============================================================================
// Sidebar Management
// ============================================================================

function toggleSidebar() {
  const sidebar = $('#settingsSidebar');
  const backdrop = $('#sidebarBackdrop');
  sidebarOpen = !sidebarOpen;
  sidebar.classList.toggle('open', sidebarOpen);
  backdrop.classList.toggle('active', sidebarOpen);
  saveUIState();
}

// ============================================================================
// Theme Management
// ============================================================================

async function toggleTheme() {
  const current = document.body.dataset.theme || 'light';
  const newTheme = current === 'light' ? 'dark' : 'light';
  document.body.dataset.theme = newTheme;
  await chrome.storage.local.set({ theme: newTheme });
  showToast(`${newTheme === 'dark' ? '🌙' : '☀️'} ${newTheme.charAt(0).toUpperCase() + newTheme.slice(1)} mode`, 'info');
}

async function restoreTheme() {
  const { theme } = await chrome.storage.local.get(['theme']);
  if (theme) {
    document.body.dataset.theme = theme;
  }
}

// ============================================================================
// Settings Management
// ============================================================================

async function restoreSettings() {
  const data = await chrome.storage.local.get([...settingsFields, 'promptPreset', 'customPrompt', 'emailContext']);

  for (const k of settingsFields) {
    const el = document.getElementById(k);
    if (el && data[k] != null) el.value = data[k];
  }

  if (data.promptPreset) {
    $('#promptPreset').value = data.promptPreset;
    onPromptPresetChange();
  }

  if (data.customPrompt) {
    $('#customPrompt').value = data.customPrompt;
  }

  if (data.emailContext) {
    emailContextEl.value = data.emailContext;
    updateContextCharCount();
  }

  // Auto-select provider with configured key on load (silent - no toast)
  autoSelectProviderSilent(data);
}

async function saveSettings() {
  const put = {};
  for (const k of settingsFields) {
    const el = document.getElementById(k);
    if (el) put[k] = el.value.trim();
  }

  // Save prompt settings
  put.promptPreset = $('#promptPreset').value;
  put.customPrompt = $('#customPrompt').value;

  // Save email context
  put.emailContext = emailContextEl.value;

  await chrome.storage.local.set(put);
  updateKeyStatusIndicators();

  // Auto-select provider with configured API key
  autoSelectProvider(put);

  const s = $('#settingsStatus');
  s.textContent = '✓ Saved';
  s.className = 'status success';
  setTimeout(() => {
    s.textContent = '';
    s.className = 'status';
  }, 2000);

  showToast('Settings saved successfully', 'success');
}

async function exportSettings() {
  const data = await chrome.storage.local.get(settingsFields);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ai-email-assistant-settings-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Settings exported', 'success');
}

async function importSettings(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    await chrome.storage.local.set(data);
    await restoreSettings();
    updateKeyStatusIndicators();
    autoSelectProvider(data);
    showToast('Settings imported successfully', 'success');
  } catch (err) {
    showToast('Failed to import settings: ' + err.message, 'error');
  }

  e.target.value = ''; // Reset file input
}

function updateKeyStatusIndicators() {
  const providers = ['openai', 'anthropic', 'google', 'deepseek'];

  providers.forEach(provider => {
    const keyEl = document.getElementById(`${provider}_key`);
    const statusEl = document.getElementById(`status-${provider}`);
    const hasKey = keyEl && keyEl.value.trim().length > 0;

    if (statusEl) {
      statusEl.textContent = hasKey ? '✓ Configured' : '✗ No key';
      statusEl.className = `key-status ${hasKey ? 'configured' : 'missing'}`;
    }
  });

  // Azure requires all fields
  const azureKey = $('#azure_api_key')?.value.trim();
  const azureEndpoint = $('#azure_endpoint')?.value.trim();
  const azureDeployment = $('#azure_deployment')?.value.trim();
  const azureConfigured = azureKey && azureEndpoint && azureDeployment;
  const azureStatus = $('#status-azure');

  if (azureStatus) {
    azureStatus.textContent = azureConfigured ? '✓ Configured' : '✗ Not configured';
    azureStatus.className = `key-status ${azureConfigured ? 'configured' : 'missing'}`;
  }
}

function autoSelectProvider(cfg) {
  // Check if current provider is already configured
  const currentProvider = providerEl.value;

  // Check if current provider has valid configuration
  const isCurrentConfigured = isProviderConfigured(currentProvider, cfg);

  // If current provider is configured, keep it selected
  if (isCurrentConfigured) {
    onProviderChange();
    return;
  }

  // Otherwise, find first configured provider
  const providerPriority = ['openai', 'anthropic', 'google', 'deepseek', 'azure'];

  for (const provider of providerPriority) {
    if (isProviderConfigured(provider, cfg)) {
      providerEl.value = provider;
      onProviderChange();
      showToast(`Auto-selected ${getProviderName(provider)}`, 'info');
      return;
    }
  }
}

function autoSelectProviderSilent(cfg) {
  // Same as autoSelectProvider but without toast notification (for initial load)
  const currentProvider = providerEl.value;
  const isCurrentConfigured = isProviderConfigured(currentProvider, cfg);

  if (isCurrentConfigured) {
    onProviderChange();
    return;
  }

  const providerPriority = ['openai', 'anthropic', 'google', 'deepseek', 'azure'];

  for (const provider of providerPriority) {
    if (isProviderConfigured(provider, cfg)) {
      providerEl.value = provider;
      onProviderChange();
      return;
    }
  }
}

function isProviderConfigured(provider, cfg) {
  switch (provider) {
    case 'openai':
      return cfg.openai_key && cfg.openai_key.trim().length > 0;
    case 'anthropic':
      return cfg.anthropic_key && cfg.anthropic_key.trim().length > 0;
    case 'google':
      return cfg.google_key && cfg.google_key.trim().length > 0;
    case 'deepseek':
      return cfg.deepseek_key && cfg.deepseek_key.trim().length > 0;
    case 'azure':
      return cfg.azure_api_key && cfg.azure_api_key.trim().length > 0 &&
             cfg.azure_endpoint && cfg.azure_endpoint.trim().length > 0 &&
             cfg.azure_deployment && cfg.azure_deployment.trim().length > 0;
    default:
      return false;
  }
}

function getProviderName(provider) {
  const names = {
    openai: 'OpenAI',
    anthropic: 'Anthropic (Claude)',
    google: 'Google Gemini',
    deepseek: 'DeepSeek',
    azure: 'Azure OpenAI'
  };
  return names[provider] || provider;
}

// ============================================================================
// UI State Persistence
// ============================================================================

async function saveUIState() {
  const state = {
    settingsOpen: $('#settings').hasAttribute('open'),
    promptSettingsOpen: $('#promptSettings').hasAttribute('open'),
    contextSettingsOpen: $('#contextSettings').hasAttribute('open'),
    sidebarOpen: sidebarOpen,
    provider: providerEl.value,
    model: modelEl.value
  };
  await chrome.storage.local.set({ uiState: state });
}

async function restoreUIState() {
  const { uiState } = await chrome.storage.local.get(['uiState']);
  if (!uiState) return;

  if (uiState.settingsOpen) $('#settings').setAttribute('open', '');
  if (uiState.promptSettingsOpen) $('#promptSettings').setAttribute('open', '');
  if (uiState.contextSettingsOpen) $('#contextSettings').setAttribute('open', '');
  if (uiState.sidebarOpen) {
    sidebarOpen = true;
    $('#settingsSidebar').classList.add('open');
    $('#sidebarBackdrop').classList.add('active');
  }
  if (uiState.provider) providerEl.value = uiState.provider;
  if (uiState.model) modelEl.value = uiState.model;

  onProviderChange();
}

// ============================================================================
// Provider Management
// ============================================================================

function onProviderChange() {
  const provider = providerEl.value;
  updateProviderStatus(provider);
  saveUIState();
}

function updateProviderStatus(provider) {
  const statusMap = {
    openai: 'OpenAI selected - Default: gpt-4o-mini',
    anthropic: 'Anthropic (Claude) selected - Default: claude-3-5-sonnet',
    google: 'Google Gemini selected - Default: gemini-1.5-flash',
    deepseek: 'DeepSeek selected - Default: deepseek-chat',
    azure: 'Azure OpenAI selected - Requires all 4 configuration fields'
  };

  providerStatusEl.textContent = statusMap[provider] || '';
  providerStatusEl.className = 'status info';
}

function validateProvider(provider, cfg) {
  const validation = {
    openai: cfg.openai_key?.trim(),
    anthropic: cfg.anthropic_key?.trim(),
    google: cfg.google_key?.trim(),
    deepseek: cfg.deepseek_key?.trim(),
    azure: cfg.azure_api_key?.trim() && cfg.azure_endpoint?.trim() && cfg.azure_deployment?.trim()
  };

  return validation[provider];
}

function getValidationError(provider) {
  const errors = {
    openai: 'OpenAI API key not configured. Please add it in Settings.',
    anthropic: 'Anthropic API key not configured. Please add it in Settings.',
    google: 'Google Gemini API key not configured. Please add it in Settings.',
    deepseek: 'DeepSeek API key not configured. Please add it in Settings.',
    azure: 'Azure OpenAI not fully configured. Please set API key, endpoint, and deployment in Settings.'
  };

  return errors[provider] || 'Provider not configured';
}

// ============================================================================
// System Prompt Management
// ============================================================================

function onPromptPresetChange() {
  const preset = $('#promptPreset').value;
  const customBox = $('#customPromptBox');

  if (preset === 'custom') {
    customBox.classList.remove('hidden');
  } else {
    customBox.classList.add('hidden');
  }

  saveSettings();
}

function getSystemPrompt() {
  const preset = $('#promptPreset').value;
  if (preset === 'custom') {
    return $('#customPrompt').value.trim() || SYSTEM_PROMPTS.default;
  }
  return SYSTEM_PROMPTS[preset] || SYSTEM_PROMPTS.default;
}

// ============================================================================
// Input Management
// ============================================================================

async function grabSelection() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    showToast('No active tab found', 'error');
    return;
  }

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => getSelection()?.toString() || ''
    });

    if (result) {
      inputEl.value = result;
      updateCharCount();
      showToast('Selection grabbed successfully', 'success');
    } else {
      showToast('No text selected on page', 'warning');
    }
  } catch (e) {
    showToast('Failed to grab selection: ' + e.message, 'error');
  }
}

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      inputEl.value = text;
      updateCharCount();
      showToast('Pasted from clipboard', 'success');
    }
  } catch (e) {
    showToast('Failed to paste: ' + e.message, 'error');
  }
}

function clearInput() {
  inputEl.value = '';
  updateCharCount();
  $('#clearInput').classList.add('hidden');
}

function onInputChange() {
  updateCharCount();
  const hasText = inputEl.value.trim().length > 0;
  $('#clearInput').classList.toggle('hidden', !hasText);
}

function updateCharCount() {
  const count = inputEl.value.length;
  const limit = 4000;
  charCountEl.textContent = `${count} / ${limit}`;

  if (count > limit * 0.9) {
    charCountEl.className = 'char-count error';
  } else if (count > limit * 0.7) {
    charCountEl.className = 'char-count warning';
  } else {
    charCountEl.className = 'char-count';
  }
}

// ============================================================================
// Email Context Management
// ============================================================================

function clearContext() {
  emailContextEl.value = '';
  updateContextCharCount();
  $('#clearContext').classList.add('hidden');
  saveSettings();
}

function onContextChange() {
  updateContextCharCount();
  const hasText = emailContextEl.value.trim().length > 0;
  $('#clearContext').classList.toggle('hidden', !hasText);
  saveSettings();
}

function updateContextCharCount() {
  const count = emailContextEl.value.length;
  const limit = 8000;
  contextCharCountEl.textContent = `${count} / ${limit}`;

  if (count > limit * 0.9) {
    contextCharCountEl.className = 'char-count error';
  } else if (count > limit * 0.7) {
    contextCharCountEl.className = 'char-count warning';
  } else {
    contextCharCountEl.className = 'char-count';
  }
}

// ============================================================================
// Password Toggle
// ============================================================================

function togglePassword(targetId) {
  const input = document.getElementById(targetId);
  if (!input) return;

  input.type = input.type === 'password' ? 'text' : 'password';
}

// ============================================================================
// AI Request Management
// ============================================================================

function buildPrompt(kind, text) {
  const context = emailContextEl.value.trim();
  const contextPrefix = context
    ? `Background Context / Email Chain:\n${context}\n\n---\n\n`
    : '';

  const prompts = {
    revise: `${contextPrefix}Revise the following email for clarity, conciseness, and a friendly but professional tone. Keep the original meaning. Return only the improved email text.\n\nEmail:\n${text}`,
    formal: `${contextPrefix}Rewrite the following email in a formal, professional business tone. Use proper formal language and maintain high professionalism.\n\nEmail:\n${text}`,
    casual: `${contextPrefix}Rewrite the following email in a casual, friendly tone while remaining professional. Be conversational and approachable.\n\nEmail:\n${text}`,
    shorten: `${contextPrefix}Make the following email more concise. Remove unnecessary words while keeping the key message and maintaining professionalism.\n\nEmail:\n${text}`,
    expand: `${contextPrefix}Expand the following email with more detail and context. Make it more comprehensive while maintaining clarity and professionalism.\n\nEmail:\n${text}`
  };

  return prompts[kind] || text;
}

async function send(kind) {
  // Rate limiting
  const now = Date.now();
  if (now - lastRequestTime < RATE_LIMIT_MS) {
    showToast('Please wait a moment before sending another request', 'warning');
    return;
  }
  lastRequestTime = now;

  const provider = providerEl.value;
  const model = modelEl.value.trim();
  const text = inputEl.value.trim();

  if (!text) {
    showToast('Please enter some text first', 'warning');
    inputEl.focus();
    return;
  }

  // Validate provider configuration
  const cfg = await chrome.storage.local.get(settingsFields);
  if (!validateProvider(provider, cfg)) {
    showToast(getValidationError(provider), 'error');
    $('#settings').setAttribute('open', '');
    return;
  }

  // Store original text for diff
  currentOriginalText = text;

  // UI state
  isStreaming = true;
  statusEl.innerHTML = '<span class="spinner"></span> Preparing request...';
  statusEl.className = 'status info';
  outputEl.textContent = '';
  $('#cancelStream').classList.remove('hidden');
  disableActionButtons(true);

  const prompt = buildPrompt(kind, text);
  const systemPrompt = getSystemPrompt();

  // Estimate input tokens (rough approximation: 1 token ≈ 4 characters)
  const inputTokens = Math.ceil((systemPrompt.length + prompt.length) / 4);
  updateCostEstimate(inputTokens, 0);

  currentPort = chrome.runtime.connect({ name: 'ai-stream' });
  let raw = '';

  currentPort.onMessage.addListener((msg) => {
    if (msg?.type === 'delta') {
      raw += msg.text || '';
      outputEl.textContent = raw;
      statusEl.innerHTML = '<span class="spinner"></span> Streaming response...';

      // Update output token estimate
      const outputTokens = Math.ceil(raw.length / 4);
      updateCostEstimate(inputTokens, outputTokens);
    } else if (msg?.type === 'done') {
      raw = msg.text || raw;
      outputEl.textContent = raw;
      statusEl.textContent = '✓ Complete';
      statusEl.className = 'status success';
      isStreaming = false;
      $('#cancelStream').classList.add('hidden');
      disableActionButtons(false);

      // Add to history
      addToHistory(raw);

      // Final cost estimate
      const outputTokens = Math.ceil(raw.length / 4);
      updateCostEstimate(inputTokens, outputTokens);

      currentPort.disconnect();
      currentPort = null;

      setTimeout(() => {
        statusEl.textContent = '';
        statusEl.className = 'status';
      }, 3000);
    } else if (msg?.type === 'error') {
      statusEl.textContent = '✗ Error: ' + msg.error;
      statusEl.className = 'status error';
      isStreaming = false;
      $('#cancelStream').classList.add('hidden');
      disableActionButtons(false);
      showToast('Request failed: ' + msg.error, 'error');

      if (currentPort) {
        currentPort.disconnect();
        currentPort = null;
      }
    }
  });

  currentPort.postMessage({ type: 'start', provider, model, prompt, systemPrompt });
}

function cancelStream() {
  if (currentPort) {
    currentPort.disconnect();
    currentPort = null;
  }
  isStreaming = false;
  statusEl.textContent = 'Cancelled';
  statusEl.className = 'status';
  $('#cancelStream').classList.add('hidden');
  disableActionButtons(false);
  showToast('Request cancelled', 'info');
}

function disableActionButtons(disabled) {
  $('#revise').disabled = disabled;
  $('#makeFormal').disabled = disabled;
  $('#makeCasual').disabled = disabled;
  $('#shorten').disabled = disabled;
  $('#expand').disabled = disabled;
  $('#grabSelection').disabled = disabled;
  $('#pasteFromClipboard').disabled = disabled;
}

// ============================================================================
// Cost Estimation
// ============================================================================

function updateCostEstimate(inputTokens, outputTokens) {
  const provider = providerEl.value;
  let model = modelEl.value.trim();

  // Get default model if not specified
  if (!model) {
    const defaults = {
      openai: 'gpt-4o-mini',
      anthropic: 'claude-3-5-sonnet-20241022',
      google: 'gemini-1.5-flash',
      deepseek: 'deepseek-chat',
      azure: 'gpt-4o-mini'
    };
    model = defaults[provider];
  }

  const costs = TOKEN_COSTS[model];
  if (!costs) {
    costEstimateEl.classList.add('hidden');
    return;
  }

  const inputCost = (inputTokens / 1000) * costs.input;
  const outputCost = (outputTokens / 1000) * costs.output;
  const totalCost = inputCost + outputCost;

  $('#inputTokens').textContent = inputTokens.toLocaleString();
  $('#outputTokens').textContent = outputTokens.toLocaleString();
  $('#estimatedCost').textContent = totalCost > 0 ? `$${totalCost.toFixed(4)}` : '-';

  costEstimateEl.classList.remove('hidden');
}

// ============================================================================
// Output Management
// ============================================================================

async function copyOutput() {
  const text = outputEl.textContent;
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard', 'success');
  } catch (e) {
    showToast('Failed to copy: ' + e.message, 'error');
  }
}

function clearOutput() {
  outputEl.textContent = '';
  $('#copyOutput').disabled = true;
  $('#clearOutput').disabled = true;
  $('#downloadOutput').disabled = true;
  $('#toggleDiff').disabled = true;
  costEstimateEl.classList.add('hidden');
  $('#diffView').classList.add('hidden');
}

function downloadOutput() {
  const text = outputEl.textContent;
  if (!text) return;

  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `email-revision-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Downloaded', 'success');
}

function toggleDiff() {
  const diffView = $('#diffView');
  const isHidden = diffView.classList.contains('hidden');

  if (isHidden) {
    $('#diffOriginal').textContent = currentOriginalText;
    $('#diffRevised').textContent = outputEl.textContent;
    diffView.classList.remove('hidden');
    $('#toggleDiff').textContent = '✕ Hide Compare';
  } else {
    diffView.classList.add('hidden');
    $('#toggleDiff').textContent = '🔄 Compare';
  }
}

// Enable output buttons when there's content
const outputObserver = new MutationObserver(() => {
  const hasContent = outputEl.textContent.trim().length > 0;
  $('#copyOutput').disabled = !hasContent;
  $('#clearOutput').disabled = !hasContent;
  $('#downloadOutput').disabled = !hasContent;
  $('#toggleDiff').disabled = !hasContent || !currentOriginalText;
});
outputObserver.observe(outputEl, { childList: true, characterData: true, subtree: true });

// ============================================================================
// History Management
// ============================================================================

function addToHistory(text) {
  responseHistory.push(text);
  if (responseHistory.length > 10) {
    responseHistory.shift(); // Keep max 10 items
  }
  historyIndex = responseHistory.length - 1;
  updateHistoryUI();
}

function navigateHistory(direction) {
  if (responseHistory.length === 0) return;

  historyIndex = Math.max(0, Math.min(responseHistory.length - 1, historyIndex + direction));
  outputEl.textContent = responseHistory[historyIndex];
  updateHistoryUI();
}

function updateHistoryUI() {
  const hasPrev = historyIndex > 0;
  const hasNext = historyIndex < responseHistory.length - 1;

  $('#historyPrev').disabled = !hasPrev;
  $('#historyNext').disabled = !hasNext;

  if (responseHistory.length > 0) {
    $('#historyInfo').textContent = `${historyIndex + 1} / ${responseHistory.length}`;
  } else {
    $('#historyInfo').textContent = '-';
  }
}

// ============================================================================
// Keyboard Shortcuts
// ============================================================================

function handleKeyboardShortcuts(e) {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modifier = isMac ? e.metaKey : e.ctrlKey;

  // Ctrl/Cmd + Enter: Send revision
  if (modifier && e.key === 'Enter' && !isStreaming) {
    e.preventDefault();
    send('revise');
  }

  // Escape: Cancel streaming
  if (e.key === 'Escape' && isStreaming) {
    e.preventDefault();
    cancelStream();
  }

  // Ctrl/Cmd + K: Clear input
  if (modifier && e.key === 'k') {
    e.preventDefault();
    clearInput();
    inputEl.focus();
  }

  // Ctrl/Cmd + D: Toggle dark mode
  if (modifier && e.key === 'd') {
    e.preventDefault();
    toggleTheme();
  }

  // Ctrl/Cmd + S: Save settings (if settings open)
  if (modifier && e.key === 's' && $('#settings').hasAttribute('open')) {
    e.preventDefault();
    saveSettings();
  }
}

// ============================================================================
// Toast Notifications
// ============================================================================

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideInRight 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ============================================================================
// Logging (for debugging)
// ============================================================================

function log(...args) {
  if (localStorage.getItem('debug') === 'true') {
    console.log('[AI Email Assistant]', ...args);
  }
}

// Enable debug mode with: localStorage.setItem('debug', 'true')
