// Scout Quest — unified chat + voice app

let Conversation; // ElevenLabs SDK, loaded on demand

// --- Domain-aware config ---
const isAdmin = location.hostname.includes('ai-chat') || location.hostname.includes('admin');
const defaultPersona = isAdmin ? 'scoutmaster' : 'scout-coach';
const appLabel = isAdmin ? 'Scoutmaster' : 'Scout Coach';

// --- Settings (persisted in localStorage) ---
const settings = {
  showTools: localStorage.getItem('sq_showTools') !== 'false',
  emulateEmail: localStorage.getItem('sq_emulateEmail') || '',
  model: localStorage.getItem('sq_model') || '',
};

/** Get the effective model to send to the API. */
function getModel() {
  if (settings.model) return `${defaultPersona}:${settings.model}`;
  return defaultPersona;
}

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
let currentConversationId = null;
let conversationList = [];

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
const convOverlay = $('convOverlay');
const convSidebar = $('convSidebar');
const convList = $('convList');
const convListBtn = $('convListBtn');
const convCloseBtn = $('convCloseBtn');
const convNewBtn = $('convNewBtn');

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
    paintRoleBadge(currentUser);
    paintViews(currentUser);
    // Pre-load conversation list (non-blocking)
    loadConversationList();
  }
  settingShowTools.checked = settings.showTools;
  settingEmulateEmail.value = settings.emulateEmail;
  const settingModel = $('settingModel');
  if (settingModel) settingModel.value = settings.model;
}

// --- Role-aware UI (Stream E) ---

/** Label + styling for the small role chip next to the user's name.
 *  Colored dot (via ::before) + role word + optional troop suffix. */
function paintRoleBadge(user) {
  const badge = $('roleBadge');
  if (!badge) return;
  const role = user.role || 'unknown';
  badge.className = 'role-badge r-' + role;
  badge.innerHTML = `${esc(role)}${user.troop ? ` <span class="role-troop">T${esc(String(user.troop))}</span>` : ''}`;
  badge.classList.remove('hidden');
}

/** Populate the conversation sidebar's "Views" section with role-aware links.
 *  Secondary navigation — lives under the conversation list so it's one tap
 *  away on any screen (the sidebar is always reachable via the header menu). */
function paintViews(user) {
  const box = $('convViews');
  if (!box) return;

  const links = [
    { label: 'My history', sub: 'your chats', href: '/history.html' },
    { label: 'Pending emails', sub: 'review drafts', href: '/email.html' },
  ];
  if (Array.isArray(user.scoutEmails)) {
    for (const se of user.scoutEmails) {
      const first = se.split('@')[0];
      links.push({
        label: `${first}'s history`,
        sub: 'your scout',
        href: `/history.html#scout:${encodeURIComponent(se)}`,
      });
    }
  }
  const roles = user.roles || [];
  const isLeader = roles.includes('leader') || roles.includes('admin') || roles.includes('superuser');
  if (user.troop && isLeader) {
    links.push({
      label: `Troop ${user.troop}`,
      sub: 'leader view',
      href: `/history.html#troop:${encodeURIComponent(user.troop)}`,
    });
  }
  if (user.isAdmin) {
    links.push({ label: 'All conversations', sub: 'admin', href: '/history.html#all' });
    links.push({ label: 'Eval viewer', sub: 'admin', href: '/eval-viewer.html' });
    links.push({ label: 'Progress', sub: 'admin', href: '/progress.html' });
  }

  // Always show the Views section — even a one-item list is worth a tap.
  // (Earlier revision hid it for non-admin/non-parent users which made
  // /history.html unreachable from the UI for anyone not on the allowlist.)
  box.classList.remove('hidden');
  box.innerHTML = `<div class="conv-views-label">Views</div>`;
  for (const l of links) {
    const a = document.createElement('a');
    a.href = l.href;
    a.target = '_self';
    a.innerHTML = `${esc(l.label)}${l.sub ? `<span class="view-sub">${esc(l.sub)}</span>` : ''}`;
    box.appendChild(a);
  }
}

// --- Toasts (Stream E: surface SSE / auth / tool errors) ---
function toast(message, kind = 'info', ms = 4000) {
  const root = $('toastRoot');
  if (!root) { console.log(`[toast:${kind}] ${message}`); return; }
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  root.appendChild(el);
  // Force layout so the transition triggers
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, ms);
}
// Expose for console debugging + ad-hoc calls.
window.sqToast = toast;

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
  label.textContent = role === 'agent' ? appLabel : 'You';
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

  const userText = typeof content === 'string' ? content : text;
  history.push({ role: 'user', content: userText });
  startStream();

  // Track tool events for persistence
  const turnToolCalls = [];

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
      body: JSON.stringify({
        model: getModel(),
        messages: apiMessages,
        stream: true,
        // Stream G: conversationId enables backend usage-log attribution and
        // summary-sweeper match. Set after the first /api/conversations POST.
        conversationId: currentConversationId || undefined,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      appendStream(`Error: ${resp.status}`);
      finalizeStream();
      isStreaming = false;
      toast(`Chat error ${resp.status}${body ? ': ' + body.slice(0, 120) : ''}`, 'error');
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
            if (settings.showTools) {
              turnToolCalls.push({ type: 'call', name: chunk.tool_call.name, input: chunk.tool_call.input });
            }
            continue;
          }
          if (chunk.type === 'tool_result') {
            addToolBlock(chunk.tool_result.name + ' result', null, chunk.tool_result.result);
            if (settings.showTools) {
              turnToolCalls.push({ type: 'result', name: chunk.tool_result.name, result: chunk.tool_result.result });
            }
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
    toast(`Connection dropped: ${err.message || err}`, 'error');
  }

  // Capture assistant text before finalizing (finalizeStream resets agentStreamText)
  const assistantText = agentStreamText;
  finalizeStream();
  isStreaming = false;
  sendBtn.disabled = !textInput.value.trim();

  // Persist messages (non-blocking). We persist whenever a user message was
  // actually sent — even if the assistant response was empty or tool-only.
  // Previously the `if (assistantText.trim())` guard dropped entire turns
  // whose final content was cleared by a tool_call/tool_result sequence,
  // which is why the conversations collection was empty.
  if (userText && userText.trim()) {
    const toSave = [{ role: 'user', content: userText }];
    if (turnToolCalls.length) {
      toSave.push({ role: 'tool_call', content: '', toolCalls: turnToolCalls });
    }
    if (assistantText.trim()) {
      toSave.push({ role: 'assistant', content: assistantText });
    } else {
      console.warn('[conv] assistantText was empty for this turn — persisting anyway');
      toSave.push({ role: 'assistant', content: '(no text content — see tool calls)' });
    }
    persistMessages(toSave);
  }
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

// Push chat history + identity + active conversation id to the backend before
// starting voice. Runs unconditionally so:
//   (a) voiceCtx.userEmail is always set (ElevenLabs requests can't send a
//       cookie, so this is the only identity carrier)
//   (b) voiceCtx.conversationId inherits the current text conversation, so
//       voice turns append to the same row instead of creating a new one
//       — that's what stitches chat+voice into one conversation.
async function pushChatContext() {
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
        conversationId: currentConversationId || undefined,
      }),
    });
    console.log('[voice] Pushed', msgs.length, 'messages as context (user=' +
      (currentUser?.email || 'none') + ', conv=' + (currentConversationId || 'none') + ')');
  } catch (e) { console.warn('[voice] Failed to push context:', e); }
}

// After a voice session ends, sync the client-side currentConversationId to
// whatever id the voice session landed on. This matters when voice CREATED a
// new conversation (no text convo preceded it) and the user then wants to
// switch to text — their typed messages should append to the same convo.
async function adoptVoiceConversationId() {
  try {
    const r = await fetch('/api/voice/active-conversation', { credentials: 'same-origin' });
    if (!r.ok) return;
    const { conversationId } = await r.json();
    if (conversationId && conversationId !== currentConversationId) {
      console.log('[voice] adopting conversationId', conversationId, '(was', currentConversationId, ')');
      currentConversationId = conversationId;
    }
  } catch (e) { console.warn('[voice] Failed to sync conversationId:', e); }
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
      onDisconnect: () => {
        dbg('disconnected');
        stopVolLoop();
        stopToolPoll();
        finalizeStream();
        voiceConversation = null;
        setBlob('idle');
        setVS('Tap to talk', false);
        // Adopt the conversationId the voice session landed on so if the
        // user now types something, it appends to the same row instead of
        // creating a second conversation.
        adoptVoiceConversationId();
      },
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
    const msg = err?.name === 'NotAllowedError' ? 'Microphone access needed' : `Voice start failed: ${err?.message || err}`;
    setVS(err?.name === 'NotAllowedError' ? 'Mic access needed' : 'Tap to talk', false);
    toast(msg, 'error', 6000);
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

$('settingModel')?.addEventListener('change', () => {
  saveSetting('model', $('settingModel').value);
});

$('clearChatBtn').addEventListener('click', () => {
  currentConversationId = null;
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

// --- Conversation sidebar ---
function openConvSidebar() {
  convOverlay.classList.remove('hidden');
  convSidebar.classList.remove('hidden');
  loadConversationList();
}

function closeConvSidebar() {
  convOverlay.classList.add('hidden');
  convSidebar.classList.add('hidden');
}

convListBtn.addEventListener('click', openConvSidebar);
convCloseBtn.addEventListener('click', closeConvSidebar);
convOverlay.addEventListener('click', closeConvSidebar);

convNewBtn.addEventListener('click', () => {
  currentConversationId = null;
  history.length = 0;
  messages.innerHTML = '';
  // Restore welcome message
  const w = document.createElement('div');
  w.className = 'welcome-msg';
  w.id = 'welcomeMsg';
  w.innerHTML = '<strong>Hey!</strong> Ask me about rank requirements, merit badges, or your advancement progress.';
  messages.appendChild(w);
  closeConvSidebar();
});

function relativeTime(dateStr) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 7) return days + 'd ago';
  return new Date(dateStr).toLocaleDateString();
}

async function loadConversationList() {
  try {
    const resp = await fetch('/api/conversations', { credentials: 'same-origin' });
    if (!resp.ok) return;
    conversationList = await resp.json();
    renderConversationList();
  } catch (e) {
    console.warn('[conv] Failed to load list:', e);
  }
}

function renderConversationList() {
  convList.innerHTML = '';
  if (!conversationList.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'text-align:center;color:var(--text-faint);font-size:12px;padding:24px 8px;';
    empty.textContent = 'No saved conversations yet';
    convList.appendChild(empty);
    return;
  }

  for (const conv of conversationList) {
    const item = document.createElement('div');
    item.className = 'conv-item' + (conv._id === currentConversationId ? ' active' : '');

    const body = document.createElement('div');
    body.className = 'conv-item-body';

    const title = document.createElement('div');
    title.className = 'conv-item-title';
    title.textContent = conv.title || 'Untitled';
    body.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'conv-item-meta';
    meta.textContent = relativeTime(conv.updatedAt) + (conv.messageCount ? ' \u00b7 ' + conv.messageCount + ' msgs' : '');
    body.appendChild(meta);

    item.appendChild(body);

    const del = document.createElement('button');
    del.className = 'conv-item-del';
    del.textContent = '\u00d7';
    del.title = 'Delete';
    del.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this conversation?')) return;
      try {
        await fetch('/api/conversations/' + conv._id, {
          method: 'DELETE',
          credentials: 'same-origin',
        });
        if (currentConversationId === conv._id) {
          currentConversationId = null;
          history.length = 0;
          messages.innerHTML = '';
        }
        loadConversationList();
      } catch (err) {
        console.warn('[conv] Delete failed:', err);
      }
    };
    item.appendChild(del);

    item.addEventListener('click', () => loadConversation(conv._id));
    convList.appendChild(item);
  }
}

async function loadConversation(id) {
  try {
    const resp = await fetch('/api/conversations/' + id, { credentials: 'same-origin' });
    if (!resp.ok) return;
    const conv = await resp.json();

    // Clear current state
    currentConversationId = conv._id;
    history.length = 0;
    messages.innerHTML = '';

    // Render messages
    for (const msg of conv.messages) {
      if (msg.role === 'user') {
        addMsg('user', msg.content);
        history.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        addMsg('agent', msg.content);
        history.push({ role: 'assistant', content: msg.content });
      } else if (msg.role === 'tool_call' && msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          addToolBlock(tc.name, tc.input);
        }
      } else if (msg.role === 'tool_result' && msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          addToolBlock((tc.name || 'tool') + ' result', null, tc.result);
        }
      }
    }

    closeConvSidebar();
    scrollEnd();
  } catch (e) {
    console.warn('[conv] Failed to load conversation:', e);
  }
}

/** Save new messages to the current conversation (or create one). */
async function persistMessages(newMessages) {
  if (!currentUser) { console.warn('[conv] persist skipped — no currentUser'); return; }

  try {
    if (!currentConversationId) {
      // Create a new conversation with these messages
      const resp = await fetch('/api/conversations', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: getModel(),
          channel: 'chat',
          messages: newMessages,
        }),
      });
      if (resp.ok) {
        const conv = await resp.json();
        currentConversationId = conv._id;
        console.log('[conv] created conversation', currentConversationId);
      } else {
        const body = await resp.text().catch(() => '');
        console.warn('[conv] POST /api/conversations failed:', resp.status, body.slice(0, 200));
        if (typeof toast === 'function') toast(`Conversation save failed (${resp.status})`, 'warn');
      }
    } else {
      // Append to existing conversation. Tag each message with channel:"chat"
      // so the viewer can render mode transitions in mixed conversations.
      const tagged = newMessages.map((m) => ({ channel: 'chat', ...m }));
      const resp = await fetch('/api/conversations/' + currentConversationId + '/messages', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: tagged }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        console.warn('[conv] PUT /api/conversations failed:', resp.status, body.slice(0, 200));
      }
    }
  } catch (e) {
    console.warn('[conv] Failed to persist messages:', e);
    if (typeof toast === 'function') toast(`Conversation save failed: ${e.message || e}`, 'warn');
  }
}

// --- Boot ---
init();
