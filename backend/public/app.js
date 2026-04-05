// Scout Coach — unified chat + voice app

let Conversation; // ElevenLabs SDK, loaded on demand

// --- Settings (persisted in localStorage) ---
const settings = {
  showTools: localStorage.getItem('sq_showTools') !== 'false',
  emulateEmail: localStorage.getItem('sq_emulateEmail') || '',
};

function saveSetting(key, val) {
  settings[key] = val;
  localStorage.setItem('sq_' + key, val);
}

// --- State ---
let currentUser = null;
let currentMode = 'chat';
let isStreaming = false;
let voiceConversation = null;
let volumeRaf = null;
let currentAgentEl = null;
let agentStreamText = '';
let pendingFiles = []; // { name, type, dataUrl }
let toolPollInterval = null;
let toolPollCursor = 0;

// --- DOM ---
const $ = (id) => document.getElementById(id);
const authGate = $('authGate');
const app = $('app');
const userName = $('userName');
const messages = $('messages');
const welcomeMsg = $('welcomeMsg');
const chatInput = $('chatInput');
const voiceInput = $('voiceInput');
const textInput = $('textInput');
const sendBtn = $('sendBtn');
const modeToggle = $('modeToggle');
const blob = $('blob');
const blobBtn = $('blobBtn');
const voiceStatus = $('voiceStatus');
const attachBtn = $('attachBtn');
const fileInput = $('fileInput');
const attachments = $('attachments');
const settingsOverlay = $('settingsOverlay');
const settingShowTools = $('settingShowTools');
const settingEmulateEmail = $('settingEmulateEmail');

// --- Markdown ---
if (window.marked) marked.setOptions({ breaks: true, gfm: true });
function md(text) {
  if (!window.marked) return esc(text);
  try { return marked.parse(text); } catch { return esc(text); }
}
function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// --- Auth ---
async function checkAuth() {
  try {
    const r = await fetch('/auth/me', { credentials: 'same-origin' });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function init() {
  currentUser = await checkAuth();
  if (currentUser) {
    authGate.classList.add('hidden');
    app.classList.remove('hidden');
    userName.textContent = currentUser.name?.split(' ')[0] || '';
  }
  settingShowTools.checked = settings.showTools;
  settingEmulateEmail.value = settings.emulateEmail;
}

// --- Conversation history (for chat API) ---
const history = []; // {role, content}

// --- Scroll ---
function scrollEnd() { messages.scrollTop = messages.scrollHeight; }

// --- Add message bubble ---
function addMsg(role, content, opts = {}) {
  welcomeMsg?.remove();
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  if (opts.streaming) div.classList.add('streaming');

  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = role === 'agent' ? 'Scout Coach' : 'You';
  div.appendChild(label);

  const body = document.createElement('div');
  body.className = 'content';
  if (role === 'agent') body.innerHTML = md(content);
  else body.textContent = content;
  div.appendChild(body);

  // Copy button
  const cp = document.createElement('button');
  cp.className = 'copy-btn';
  cp.textContent = '\u2398';
  cp.title = 'Copy';
  cp.onclick = (e) => { e.stopPropagation(); copyText(body.textContent); cp.textContent = '\u2713'; setTimeout(() => cp.textContent = '\u2398', 1200); };
  div.appendChild(cp);

  // Image attachments
  if (opts.images) {
    for (const img of opts.images) {
      const el = document.createElement('img');
      el.src = img;
      el.style.maxWidth = '200px';
      el.style.borderRadius = '6px';
      el.style.marginTop = '4px';
      body.appendChild(el);
    }
  }

  messages.appendChild(div);
  scrollEnd();
  return div;
}

// --- Tool call block ---
function addToolBlock(name, args, result) {
  const div = document.createElement('div');
  div.className = 'tool-block';
  if (!settings.showTools) div.classList.add('hide-tools');
  div.dataset.tool = 'true';

  let html = `<span class="tool-name">${esc(name)}</span>`;
  if (args) {
    const argStr = typeof args === 'string' ? args : JSON.stringify(args, null, 1);
    html += `<span class="tool-args">${esc(argStr).substring(0, 120)}</span>`;
  }
  if (result) {
    const resStr = typeof result === 'string' ? result : JSON.stringify(result, null, 1);
    html += `<div class="tool-result">${esc(resStr).substring(0, 500)}</div>`;
  }
  div.innerHTML = html;
  messages.appendChild(div);
  scrollEnd();
}

// --- Mode divider ---
function addModeDivider(mode) {
  const div = document.createElement('div');
  div.className = 'mode-divider';
  div.textContent = mode === 'voice' ? 'Voice' : 'Chat';
  messages.appendChild(div);
  scrollEnd();
}

// --- Streaming agent message ---
function startStream() {
  finalizeStream();
  agentStreamText = '';
  currentAgentEl = addMsg('agent', '', { streaming: true });
  return currentAgentEl;
}

function appendStream(text) {
  if (!currentAgentEl) { startStream(); }
  agentStreamText += text;
  currentAgentEl.querySelector('.content').innerHTML = md(agentStreamText);
  scrollEnd();
}

function finalizeStream() {
  if (currentAgentEl) {
    currentAgentEl.classList.remove('streaming');
    const body = currentAgentEl.querySelector('.content');
    if (!body.textContent.trim()) currentAgentEl.remove();
    else history.push({ role: 'assistant', content: agentStreamText });
    currentAgentEl = null;
    agentStreamText = '';
  }
}

// --- Send chat message ---
async function sendMessage(text) {
  if ((!text.trim() && !pendingFiles.length) || isStreaming) return;
  isStreaming = true;
  sendBtn.disabled = true;
  textInput.value = '';
  autoResize();

  // Build content parts
  let content;
  const images = pendingFiles.filter(f => f.type.startsWith('image/'));
  if (images.length) {
    content = [];
    if (text.trim()) content.push({ type: 'text', text });
    for (const f of images) {
      content.push({ type: 'image_url', image_url: { url: f.dataUrl } });
    }
    addMsg('user', text || '(photo)', { images: images.map(f => f.dataUrl) });
  } else {
    content = text;
    addMsg('user', text);
  }
  clearAttachments();

  history.push({ role: 'user', content: typeof content === 'string' ? content : text });
  startStream();

  const apiMessages = history.map(m => ({
    role: m.role === 'agent' ? 'assistant' : m.role,
    content: m.content,
  }));
  // Replace last user message with full content (including images)
  apiMessages[apiMessages.length - 1].content = content;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (settings.emulateEmail) headers['X-Emulate-User'] = settings.emulateEmail;

    const resp = await fetch('/v1/chat/completions', {
      method: 'POST',
      credentials: 'same-origin',
      headers,
      body: JSON.stringify({ model: 'scout-coach', messages: apiMessages, stream: true }),
    });

    if (!resp.ok) {
      appendStream(`Error: ${resp.status}`);
      finalizeStream();
      isStreaming = false;
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        try {
          const chunk = JSON.parse(data);
          // Tool call events
          if (chunk.type === 'tool_call') {
            finalizeStream();
            addToolBlock(chunk.tool_call.name, chunk.tool_call.input);
            continue;
          }
          if (chunk.type === 'tool_result') {
            addToolBlock(chunk.tool_result.name + ' result', null, chunk.tool_result.result);
            startStream();
            continue;
          }
          // Normal content
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) appendStream(delta);
        } catch { /* skip */ }
      }
    }
  } catch (err) {
    appendStream(`Connection error: ${err.message}`);
  }

  finalizeStream();
  isStreaming = false;
  sendBtn.disabled = !textInput.value.trim();
}

// --- Text input ---
function autoResize() {
  textInput.style.height = 'auto';
  textInput.style.height = Math.min(textInput.scrollHeight, 120) + 'px';
}

textInput.addEventListener('input', () => {
  autoResize();
  sendBtn.disabled = (!textInput.value.trim() && !pendingFiles.length) || isStreaming;
});

textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(textInput.value); }
});

sendBtn.addEventListener('click', () => sendMessage(textInput.value));

// --- File attachments ---
attachBtn.addEventListener('click', () => fileInput.click());
$('voiceAttachBtn')?.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  for (const file of fileInput.files) {
    const reader = new FileReader();
    reader.onload = () => {
      pendingFiles.push({ name: file.name, type: file.type, dataUrl: reader.result });
      renderAttachments();
      sendBtn.disabled = false;
    };
    reader.readAsDataURL(file);
  }
  fileInput.value = '';
});

function renderAttachments() {
  attachments.innerHTML = '';
  for (let i = 0; i < pendingFiles.length; i++) {
    const f = pendingFiles[i];
    const thumb = document.createElement('div');
    thumb.className = 'attach-thumb';
    if (f.type.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = f.dataUrl;
      thumb.appendChild(img);
    } else {
      thumb.textContent = f.name.slice(0, 4);
      thumb.style.fontSize = '9px';
      thumb.style.display = 'flex';
      thumb.style.alignItems = 'center';
      thumb.style.justifyContent = 'center';
      thumb.style.background = 'var(--bg3)';
      thumb.style.color = 'var(--text-dim)';
    }
    const rm = document.createElement('button');
    rm.className = 'remove-attach';
    rm.textContent = '\u00d7';
    rm.onclick = () => { pendingFiles.splice(i, 1); renderAttachments(); };
    thumb.appendChild(rm);
    attachments.appendChild(thumb);
  }
}

function clearAttachments() {
  pendingFiles = [];
  attachments.innerHTML = '';
}

// --- Mode toggle ---
modeToggle.addEventListener('click', (e) => {
  const btn = e.target.closest('.mode-btn');
  if (!btn || btn.dataset.mode === currentMode) return;
  const prevMode = currentMode;
  currentMode = btn.dataset.mode;
  modeToggle.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b === btn));

  addModeDivider(currentMode);

  if (currentMode === 'chat') {
    chatInput.classList.remove('hidden');
    voiceInput.classList.add('hidden');
    stopVoice();
    textInput.focus();
  } else {
    chatInput.classList.add('hidden');
    voiceInput.classList.remove('hidden');
  }
});

// --- Voice mode ---
function setVS(text, active) {
  voiceStatus.textContent = text;
  voiceStatus.className = 'voice-status' + (active ? ' active' : '');
}

function setBlob(state) { blob.className = 'blob ' + state; }

function startVolLoop() {
  (function tick() {
    if (!voiceConversation) return;
    const v = Math.max(voiceConversation.getInputVolume?.() ?? 0, voiceConversation.getOutputVolume?.() ?? 0);
    blob.style.transform = `scale(${1 + v * 0.4})`;
    volumeRaf = requestAnimationFrame(tick);
  })();
}

function stopVolLoop() {
  if (volumeRaf) cancelAnimationFrame(volumeRaf);
  volumeRaf = null;
  blob.style.transform = '';
}

function startToolPoll() {
  toolPollCursor = Date.now();
  stopToolPoll();
  toolPollInterval = setInterval(async () => {
    try {
      const resp = await fetch(`/api/voice/tool-events?since=${toolPollCursor}`, { credentials: 'same-origin' });
      if (!resp.ok) return;
      const { events, cursor } = await resp.json();
      toolPollCursor = cursor;
      for (const e of events) {
        if (e.type === 'call') {
          addToolBlock(e.name, e.input);
        } else if (e.type === 'result') {
          addToolBlock(e.name + ' result', null, e.result);
        }
      }
    } catch { /* ignore poll errors */ }
  }, 1000);
}

function stopToolPoll() {
  if (toolPollInterval) { clearInterval(toolPollInterval); toolPollInterval = null; }
}

async function loadVoiceSDK() {
  if (Conversation) return;
  const mod = await import('https://cdn.jsdelivr.net/npm/@elevenlabs/client@latest/+esm');
  Conversation = mod.Conversation;
}

// Push chat history to backend before starting voice
async function pushChatContext() {
  if (!history.length) return;
  const msgs = history.slice(-20).map(m => ({
    role: m.role === 'agent' ? 'assistant' : m.role,
    content: typeof m.content === 'string' ? m.content : '(attachment)',
  }));
  try {
    await fetch('/api/voice/context', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: msgs,
        emulateEmail: settings.emulateEmail || undefined,
        userEmail: currentUser?.email || undefined,
      }),
    });
    console.log('[voice] Pushed', msgs.length, 'messages as context');
  } catch (e) { console.warn('[voice] Failed to push context:', e); }
}

async function startVoice() {
  setBlob('connecting');
  setVS('Connecting...', false);
  try {
    await loadVoiceSDK();
    await navigator.mediaDevices.getUserMedia({ audio: true });

    // Push chat history to backend for context injection
    dbg(`pushing ${history.length} msgs as context`);
    await pushChatContext();

    const resp = await fetch('/api/voice/signed-url', { credentials: 'same-origin' });
    if (!resp.ok) throw new Error('Signed URL failed');
    const { signedUrl } = await resp.json();

    const sessionOpts = {
      signedUrl,
      onConnect: () => { dbg('connected'); setBlob('listening'); setVS('Listening...', true); startVolLoop(); startToolPoll(); },
      onDisconnect: () => { dbg('disconnected'); stopVolLoop(); stopToolPoll(); finalizeStream(); voiceConversation = null; setBlob('idle'); setVS('Tap to talk', false); },
      onError: (err) => { dbg('error: ' + (err?.message || err)); setVS('Error', false); },
      onModeChange: (mode) => {
        dbg('mode: ' + mode.mode);
        if (mode.mode === 'speaking') { setBlob('speaking'); setVS('Speaking...', true); startStream(); }
        else { setBlob('listening'); setVS('Listening...', true); finalizeStream(); }
      },
      onMessage: (msg) => {
        // ElevenLabs sends: {source: "user"|"ai", role: "user"|"agent", message: "text", event_id: N}
        try {
          const d = typeof msg === 'string' ? JSON.parse(msg) : msg;
          if (!d.message) return;

          if (d.source === 'user' || d.role === 'user') {
            addMsg('user', d.message);
            history.push({ role: 'user', content: d.message });
          } else if (d.source === 'ai' || d.role === 'agent') {
            // Each message event is the full response, not a delta
            finalizeStream();
            addMsg('agent', d.message);
            history.push({ role: 'assistant', content: d.message });
          }
        } catch (e) { dbg('msg parse err: ' + e); }
      },
    };

    voiceConversation = await Conversation.startSession(sessionOpts);
  } catch (err) {
    console.error('Voice start failed:', err);
    setBlob('idle');
    setVS(err.name === 'NotAllowedError' ? 'Mic access needed' : 'Tap to talk', false);
  }
}

async function stopVoice() {
  if (voiceConversation) { await voiceConversation.endSession(); voiceConversation = null; }
  stopVolLoop(); stopToolPoll(); finalizeStream(); setBlob('idle'); setVS('Tap to talk', false);
}

function handleBlobTap(e) {
  e.preventDefault();
  if (voiceConversation) stopVoice(); else startVoice();
}
blobBtn.addEventListener('touchend', handleBlobTap, { passive: false });
blobBtn.addEventListener('click', handleBlobTap);

// --- Settings dialog ---
$('settingsBtn').addEventListener('click', () => settingsOverlay.classList.remove('hidden'));
$('settingsClose').addEventListener('click', () => settingsOverlay.classList.add('hidden'));
settingsOverlay.addEventListener('click', (e) => { if (e.target === settingsOverlay) settingsOverlay.classList.add('hidden'); });

settingShowTools.addEventListener('change', () => {
  saveSetting('showTools', settingShowTools.checked);
  document.querySelectorAll('.tool-block').forEach(el => {
    el.classList.toggle('hide-tools', !settings.showTools);
  });
});

settingEmulateEmail.addEventListener('change', () => {
  saveSetting('emulateEmail', settingEmulateEmail.value.trim());
});

$('clearChatBtn').addEventListener('click', () => {
  history.length = 0;
  messages.innerHTML = '';
  settingsOverlay.classList.add('hidden');
});

// --- Copy transcript ---
$('copyTranscriptBtn').addEventListener('click', () => {
  const lines = [];
  for (const el of messages.children) {
    if (el.classList.contains('mode-divider')) {
      lines.push(`--- ${el.textContent} ---`);
    } else if (el.classList.contains('msg')) {
      const label = el.querySelector('.label')?.textContent || '';
      const content = el.querySelector('.content')?.textContent || '';
      lines.push(`${label}: ${content}`);
    } else if (el.classList.contains('tool-block')) {
      lines.push(`[Tool] ${el.textContent}`);
    }
  }
  copyText(lines.join('\n'));
  $('copyTranscriptBtn').textContent = 'Copied!';
  setTimeout(() => $('copyTranscriptBtn').textContent = 'Copy full transcript', 1500);
});

// --- Clipboard helper ---
function copyText(text) {
  navigator.clipboard?.writeText(text).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  });
}

// --- Debug log (visible on screen, remove later) ---
const debugEl = document.createElement('div');
debugEl.id = 'debugLog';
debugEl.style.cssText = 'position:fixed;top:44px;right:4px;width:260px;max-height:150px;overflow-y:auto;background:rgba(0,0,0,0.9);color:#0f0;font-size:9px;font-family:monospace;padding:4px 6px;z-index:999;display:none;border-radius:6px;pointer-events:auto;';
const debugClose = document.createElement('button');
debugClose.textContent = '\u00d7';
debugClose.style.cssText = 'position:sticky;top:0;float:right;background:none;border:none;color:#f00;font-size:14px;cursor:pointer;';
debugClose.onclick = () => { debugEl.style.display = 'none'; };
debugEl.appendChild(debugClose);
document.body.appendChild(debugEl);

function dbg(msg) {
  console.log(msg);
  debugEl.style.display = 'block';
  const line = document.createElement('div');
  line.textContent = `${new Date().toLocaleTimeString()} ${msg}`;
  debugEl.appendChild(line);
  debugEl.scrollTop = debugEl.scrollHeight;
  // Keep last 20 lines
  while (debugEl.children.length > 20) debugEl.removeChild(debugEl.firstChild);
}

// --- Boot ---
init();
