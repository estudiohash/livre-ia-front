/**
 * app.js — HASH AI
 * Fuente de verdad: HASH Cloud → Google Sheets del usuario.
 */

const HASH_CLOUD_URL = 'https://hash-cloud-production.up.railway.app';

// ── Sesión ─────────────────────────────────────────────────────────────────

const TOKEN_KEY = 'hash_token';
const TOKEN_EXPIRY_KEY = 'hash_token_expiry';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

function getToken() {
  const token = localStorage.getItem(TOKEN_KEY);
  const expiry = parseInt(localStorage.getItem(TOKEN_EXPIRY_KEY) || '0', 10);
  if (!token || Date.now() > expiry) {
    clearToken();
    return null;
  }
  return token;
}

function setToken(t) {
  localStorage.setItem(TOKEN_KEY, t);
  localStorage.setItem(TOKEN_EXPIRY_KEY, String(Date.now() + TOKEN_TTL_MS));
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_EXPIRY_KEY);
}

// Verificación periódica: si el token expiró, forzar logout
setInterval(() => {
  if (!getToken()) {
    clearToken();
    renderLoginScreen();
  }
}, 5 * 60 * 1000);

async function handleAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (!code) return;

  // Limpiar la URL inmediatamente, el código no debe quedar en historial
  window.history.replaceState({}, '', window.location.pathname);

  try {
    const res = await fetch(HASH_CLOUD_URL + '/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) throw new Error('Código inválido o expirado');
    const data = await res.json();
    if (data.token) setToken(data.token);
  } catch (err) {
    console.error('Error en callback de auth:', err);
  }
}

async function fetchIdentity() {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch(HASH_CLOUD_URL + '/auth/me', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

function loginWithGoogle() {
  window.location.href = HASH_CLOUD_URL + '/auth/login?next=livre';
}

function logout() {
  clearToken();
  renderLoginScreen();
}

// ── Red: Chats ────────────────────────────────────────────────────────────

async function apiListChats() {
  const token = getToken();
  const res = await fetch(HASH_CLOUD_URL + '/chat/list', {
    headers: { 'Authorization': 'Bearer ' + token },
  });
  if (!res.ok) throw new Error('Error ' + res.status);
  return await res.json(); // [{chat_id, title, updated_at}, ...]
}

async function apiNewChat() {
  const token = getToken();
  const res = await fetch(HASH_CLOUD_URL + '/chat/new', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token },
  });
  if (!res.ok) throw new Error('Error ' + res.status);
  return await res.json(); // {chat_id, title}
}

async function apiGetMessages(chatId) {
  const token = getToken();
  const res = await fetch(HASH_CLOUD_URL + '/chat/' + chatId + '/messages', {
    headers: { 'Authorization': 'Bearer ' + token },
  });
  if (!res.ok) throw new Error('Error ' + res.status);
  return await res.json(); // {chat_id, title, messages: [{role, content}]}
}

async function apiRenameChat(chatId, title) {
  const token = getToken();
  await fetch(HASH_CLOUD_URL + '/chat/' + chatId + '/title', {
    method: 'PATCH',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
}

async function apiDeleteChat(chatId) {
  const token = getToken();
  await fetch(HASH_CLOUD_URL + '/chat/' + chatId, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + token },
  });
}

async function askHash(messages, onChunk) {
  const token = getToken();
  const res = await fetch(HASH_CLOUD_URL + '/chat/stream', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages, provider: activeProvider, chat_id: activeChatId || null, mode: activeMode }),
  });
  if (res.status === 403) { showUpgradeModal(); return ''; }
  if (!res.ok) throw new Error('Error ' + res.status);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullReply = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const chunk = line.slice(6);
      if (chunk === '[DONE]') return fullReply;
      if (chunk.startsWith('[CHAT_ID] ')) {
        activeChatId = chunk.slice(10).trim();
        localStorage.setItem('hash_active_chat', activeChatId);
        continue;
      }
      if (chunk.startsWith('[ERROR]')) throw new Error(chunk.slice(8));
      fullReply += chunk.replace(/\\n/g, '\n');
      onChunk(fullReply);
    }
  }
  return fullReply;
}

// ── Estado ─────────────────────────────────────────────────────────────────

let FRONTS = [];         // [{chat_id, title, updated_at}]
function getSavedChatId() {
  const raw = localStorage.getItem('hash_active_chat');
  if (!raw || !/^[a-zA-Z0-9_-]{4,128}$/.test(raw)) {
    localStorage.removeItem('hash_active_chat');
    return null;
  }
  return raw;
}

let activeChatId = getSavedChatId();
let activeFrontId = activeChatId; // alias para compatibilidad con render
let messages = [];       // [{id, role, content/message, created_at}]
const chatCache = {};    // {chat_id: [messages]} — caché en memoria
let activeProvider = localStorage.getItem('hash_provider') || 'gemini';
let activeMode = localStorage.getItem('hash_mode') || 'conspiranoico';
let activeVoiceId = localStorage.getItem('hash_voice_id') || '9d3c497f84c54a05866931b56e66a6c4';

const PROVIDERS = [
  { id: 'gemini', label: 'Gemini' },
  { id: 'groq',   label: 'Groq'   },
];

const VOICES = [
  { id: '9d3c497f84c54a05866931b56e66a6c4', label: 'Leo Messi' },
  { id: 'dfcda842af714d7ab87960f87a2b8deb', label: 'Javier Milei' },
  { id: '7294b76a7e4f4f3090f1c91cdcefe359', label: 'Cristina Kirchner' },
];

// ── Lógica ─────────────────────────────────────────────────────────────────

async function loadFronts() {
  try {
    const chats = await apiListChats();
    FRONTS = chats.map(c => ({ id: c.chat_id, name: c.title, chat_id: c.chat_id }));
  } catch {
    FRONTS = [];
  }

  if (!activeChatId || !FRONTS.find(f => f.chat_id === activeChatId)) {
    activeChatId = FRONTS[0]?.chat_id || null;
    activeFrontId = activeChatId;
  }

  renderFrontList();
  renderHeader();
  if (activeChatId) await syncFront(activeChatId);
}

async function syncFront(chatId) {
  // Si ya tenemos los mensajes en caché, los mostramos de inmediato
  if (chatCache[chatId]) {
    messages = chatCache[chatId];
    renderMessages();
    return;
  }
  setSyncStatus('loading', 'Cargando...');
  try {
    const data = await apiGetMessages(chatId);
    messages = data.messages.map((m, i) => ({
      id: String(i),
      role: m.role === 'assistant' ? 'hash' : m.role,
      message: m.content,
      created_at: new Date().toISOString(),
    }));
    chatCache[chatId] = messages;
    renderMessages();
    setSyncStatus('success', '');
  } catch {
    setSyncStatus('error', 'No se pudo cargar.');
  }
}



function openNewChat() {
  activeChatId = null;
  activeFrontId = null;
  localStorage.removeItem('hash_active_chat');
  messages = [];
  // Quitar selección activa del sidebar sin agregar item temporal
  renderFrontList();
  renderHeader();
  renderMessages();
  document.getElementById('message-input').focus();
}

async function createFront(name, _description) {
  // En el nuevo sistema el chat se crea en el back al mandar el primer mensaje.
  // Esta función solo actualiza el título una vez que ya tenemos activeChatId.
  if (activeChatId) {
    await apiRenameChat(activeChatId, name);
    FRONTS = FRONTS.map(f => f.chat_id === activeChatId ? { ...f, name } : f);
    renderFrontList();
    renderHeader();
  }
}

let isSending = false;



async function apiListMemoryDocs() {
  const token = getToken();
  const res = await fetch(HASH_CLOUD_URL + '/memory', {
    headers: { 'Authorization': 'Bearer ' + token },
  });
  if (!res.ok) throw new Error('Error ' + res.status);
  const data = await res.json();
  // Filtrar solo los TXTs subidos manualmente (no chat logs)
  return (data.documents || []).filter(d => !d.key.startsWith('chat_log'));
}

async function apiDeleteMemoryDoc(key) {
  const token = getToken();
  const res = await fetch(HASH_CLOUD_URL + '/memory/' + encodeURIComponent(key), {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + token },
  });
  if (!res.ok) throw new Error('Error ' + res.status);
  return await res.json();
}

async function uploadMemoryTxt(file) {
  const token = getToken();
  if (!token) return;
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(HASH_CLOUD_URL + '/memory/upload', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token },
    body: formData,
  });
  if (!res.ok) throw new Error('Error al subir el archivo');
  return await res.json();
}



async function uploadTextAsMemory(text) {
  const token = getToken();
  if (!token) return;
  const blob = new Blob([text], { type: 'text/plain' });
  const file = new File([blob], 'paste_' + Date.now() + '.txt', { type: 'text/plain' });
  const formData = new FormData();
  formData.append('file', file);
  const uploadUrl = new URL(HASH_CLOUD_URL + '/memory/upload');
  if (activeChatId) uploadUrl.searchParams.set('chat_id', activeChatId);
  const res = await fetch(uploadUrl.toString(), {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token },
    body: formData,
  });
  if (res.status === 403) { showUpgradeModal(); return null; }
  if (!res.ok) throw new Error('Error al guardar en memoria');
  return await res.json();
}

async function saveMessage(texto, attachedFile) {
  if (isSending) return;
  // Mostrar mensaje del usuario de inmediato
  const userMsg = {
    id: crypto.randomUUID(),
    role: 'user',
    message: texto,
    attachedFile: attachedFile || null,
    created_at: new Date().toISOString(),
  };
  messages = [...messages, userMsg];
  renderMessages();

  // Burbuja de espera
  const tempMsg = {
    id: crypto.randomUUID(),
    role: 'hash',
    message: '',
    created_at: new Date().toISOString(),
    loading: true,
  };
  messages = [...messages, tempMsg];
  renderMessages();
  setSyncStatus('loading', 'HASH está pensando...');

  isSending = true;
  try {
    // Construir historial para el back (sin el tempMsg)
    const contextMessages = messages
      .filter(m => !m.loading && m.message && m.message.trim())
      .map(m => ({
        role: m.role === 'hash' ? 'assistant' : 'user',
        content: m.message,
      }));

    const reply = await askHash(contextMessages, (partial) => {
      messages[messages.length - 1].message = partial;
      messages[messages.length - 1].loading = false;
      renderMessages();
    });

    messages[messages.length - 1].message = reply;
    messages[messages.length - 1].loading = false;
    // Si la respuesta es vacía (ej: límite alcanzado), quitamos la burbuja
    if (!reply) {
      messages = messages.filter(m => m.id !== tempMsg.id);
      renderMessages();
      return;
    }
    if (activeChatId) chatCache[activeChatId] = messages;
    renderMessages();

    // Si es el primer mensaje, agregar el chat al sidebar
    if (!FRONTS.find(f => f.chat_id === activeChatId)) {
      const autoTitle = texto.slice(0, 50).trim();
      FRONTS = [{ id: activeChatId, chat_id: activeChatId, name: autoTitle }, ...FRONTS];
      activeFrontId = activeChatId;
      renderFrontList();
      renderHeader();
    }

    setSyncStatus('success', '');
  } catch (err) {
    messages = messages.filter(m => !m.loading);
    renderMessages();
    setSyncStatus('error', 'No se pudo enviar el mensaje. Intentá de nuevo.');
    console.error('saveMessage error:', err);
  } finally {
    isSending = false;
  }
}

async function deleteFront(frontId) {
  await apiDeleteChat(frontId);
  FRONTS = FRONTS.filter(f => f.chat_id !== frontId);
  if (activeChatId === frontId) {
    activeChatId = FRONTS[0]?.chat_id || null;
    activeFrontId = activeChatId;
    if (activeChatId) localStorage.setItem('hash_active_chat', activeChatId);
    else localStorage.removeItem('hash_active_chat');
    messages = [];
  }
  renderFrontList();
  renderHeader();
  renderMessages();
}

async function renameFront(frontId, newName) {
  await apiRenameChat(frontId, newName);
  FRONTS = FRONTS.map(f => f.chat_id === frontId ? { ...f, name: newName } : f);
  renderFrontList();
  renderHeader();
}

function confirmDeleteFront(front) {
  const modal = document.getElementById('confirm-delete-modal');
  document.getElementById('confirm-delete-name').textContent = front.name;
  modal.removeAttribute('hidden');
  document.getElementById('confirm-delete-ok').onclick = async () => {
    modal.setAttribute('hidden', '');
    try {
      await deleteFront(front.chat_id);
    } catch (err) {
      setSyncStatus('error', 'No se pudo eliminar el chat. Intentá de nuevo.');
    }
  };
  document.getElementById('confirm-delete-cancel').onclick = () => modal.setAttribute('hidden', '');
}

function openRenameModal(front) {
  const modal = document.getElementById('rename-modal');
  const input = document.getElementById('rename-input');
  const status = document.getElementById('rename-status');
  input.value = front.name;
  status.textContent = '';
  modal.removeAttribute('hidden');
  input.focus();
  input.select();
  document.getElementById('rename-cancel').onclick = () => modal.setAttribute('hidden', '');
  document.getElementById('rename-submit').onclick = async () => {
    const newName = input.value.trim();
    if (!newName || newName === front.name) { modal.setAttribute('hidden', ''); return; }
    document.getElementById('rename-submit').disabled = true;
    status.textContent = 'Guardando...';
    try {
      await renameFront(front.id, newName);
      modal.setAttribute('hidden', '');
    } catch (err) {
      status.textContent = 'No se pudo renombrar. Intentá de nuevo.';
      console.error('renameFront error:', err);
      document.getElementById('rename-submit').disabled = false;
    }
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') document.getElementById('rename-submit').click();
    if (e.key === 'Escape') modal.setAttribute('hidden', '');
  };
}

const draftCache = {};

function saveDraft() {
  const input = document.getElementById('message-input');
  if (activeChatId && input) {
    draftCache[activeChatId] = input.value;
  }
}

function restoreDraft(chatId) {
  const input = document.getElementById('message-input');
  if (input) {
    input.value = draftCache[chatId] || '';
    input.style.height = 'auto';
    if (input.value) input.style.height = input.scrollHeight + 'px';
  }
}

function selectFront(chatId) {
  saveDraft();
  activeChatId = chatId;
  activeFrontId = chatId;
  localStorage.setItem('hash_active_chat', chatId);
  renderFrontList();
  renderHeader();
  syncFront(chatId);
  restoreDraft(chatId);
}

// ── Render ─────────────────────────────────────────────────────────────────

function renderLoginScreen() {
  document.getElementById('app').setAttribute('hidden', '');
  const screen = document.getElementById('lock-screen');
  screen.removeAttribute('hidden');
  const box = document.getElementById('lock-box');
  box.innerHTML =
    '<img src="images/logo_hash.png" alt="HASH" class="lock-logo">' +
    '<div class="lock-submit-wrapper"><button id="login-button" class="lock-submit" type="button">Entrar con Google</button></div>';
  document.getElementById('login-button').addEventListener('click', loginWithGoogle);
}

function closeSidebar() {
  const s = document.getElementById('sidebar');
  const o = document.getElementById('sidebar-overlay');
  if (s) s.classList.remove('sidebar--open');
  if (o) o.classList.remove('sidebar-overlay--visible');
}

function renderFrontList() {
  const nav = document.getElementById('front-list');
  nav.innerHTML = '';
  const newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.id = 'new-front-button';
  newBtn.className = 'front-item front-item--new';
  newBtn.textContent = '+ Nuevo chat';
  newBtn.onclick = () => { openNewChat(); closeSidebar(); };
  nav.appendChild(newBtn);

  FRONTS.forEach(f => {
    const wrapper = document.createElement('div');
    wrapper.className = 'front-item-wrapper';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'front-item' + (f.chat_id === activeChatId ? ' front-item--active' : '');
    btn.textContent = f.name;
    btn.onclick = () => { selectFront(f.chat_id); closeSidebar(); };

    if (!f._isTemp) {
    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'front-menu-trigger';
    menuBtn.setAttribute('aria-label', 'Opciones de ' + f.name);
    menuBtn.textContent = '···';
    menuBtn.onclick = (e) => {
      e.stopPropagation();
      document.querySelectorAll('.front-context-menu').forEach(m => m.remove());
      const menu = document.createElement('div');
      menu.className = 'front-context-menu';

      const renameOpt = document.createElement('button');
      renameOpt.type = 'button';
      renameOpt.textContent = 'Renombrar';
      renameOpt.onclick = () => { menu.remove(); openRenameModal(f); };

      const deleteOpt = document.createElement('button');
      deleteOpt.type = 'button';
      deleteOpt.className = 'front-context-menu-delete';
      deleteOpt.textContent = 'Eliminar';
      deleteOpt.onclick = () => { menu.remove(); confirmDeleteFront(f); };

      menu.appendChild(renameOpt);
      menu.appendChild(deleteOpt);
      wrapper.appendChild(menu);

      setTimeout(() => {
        document.addEventListener('click', () => menu.remove(), { once: true });
      }, 0);
    };

    wrapper.appendChild(btn);
    wrapper.appendChild(menuBtn);
    } // end if !_isTemp
    nav.appendChild(wrapper);
  });

  const spacer = document.createElement('div');
  spacer.className = 'front-list-spacer';
  nav.appendChild(spacer);

  const settingsBtn = document.createElement('button');
  settingsBtn.type = 'button';
  settingsBtn.id = 'settings-button';
  settingsBtn.className = 'sidebar-settings-button';
  settingsBtn.textContent = '⚙ Ajustes';
  settingsBtn.onclick = () => {
    document.getElementById('settings-modal').removeAttribute('hidden');
  };
  nav.appendChild(settingsBtn);

  const logoutBtn = document.createElement('button');
  logoutBtn.type = 'button';
  logoutBtn.className = 'logout-button';
  logoutBtn.textContent = 'Cerrar sesión';
  logoutBtn.onclick = logout;
  nav.appendChild(logoutBtn);
}

function renderHeader() {
  const front = FRONTS.find(f => f.chat_id === activeChatId);
  document.getElementById('active-front-name').textContent = front ? front.name : '—';
  const desc = document.getElementById('active-front-description');
  if (desc) desc.textContent = '';
}

function renderMessages(lastReply) {
  const list = document.getElementById('message-list');
  list.innerHTML = '';

  if (!messages.length) {
    const p = document.createElement('p');
    p.className = 'message-list-empty message-list-empty--centered';
    p.textContent = 'Tus chats están cifrados de extremo a extremo.';
    list.appendChild(p);
    return;
  }

  [...messages]
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .forEach((msg, i) => {
      const isHash = msg.role === 'hash';
      const text = msg.message;
      const isLast = i === messages.length - 1;

      const item = document.createElement('div');
      item.className = 'message-item' + (isHash ? ' message-item--hash' : '');
      item.dataset.messageId = msg.id;

      if (isHash && msg.loading) {
        const safeDate = formatDate(msg.created_at);
        const dateSpan = document.createElement('span');
        dateSpan.className = 'message-item-date';
        dateSpan.textContent = safeDate;
        const thinking = document.createElement('div');
        thinking.className = 'hash-thinking';
        thinking.innerHTML = '<span></span><span></span><span></span>';
        item.appendChild(dateSpan);
        item.appendChild(thinking);
      } else {
        const safeDate = formatDate(msg.created_at);
        const dateSpan = document.createElement('span');
        dateSpan.className = 'message-item-date';
        dateSpan.textContent = safeDate;

        const textP = document.createElement('p');
        textP.className = 'message-item-text';
        textP.innerHTML = renderMarkdown(escapeHtml(text));

        item.appendChild(dateSpan);

        // Chip de archivo adjunto
        if (msg.attachedFile) {
          const fileChip = document.createElement('div');
          fileChip.className = 'message-file-chip';
          fileChip.innerHTML = '<span class="memory-chip-icon">📄</span><span class="memory-chip-label">' + escapeHtml(msg.attachedFile) + '</span>';
          item.appendChild(fileChip);
        }

        if (textP.innerHTML) item.appendChild(textP);

        if (isHash) {
          const actions = document.createElement('div');
          actions.innerHTML = messageActionsHtml();
          item.appendChild(actions.firstChild);
        }
      }



      list.appendChild(item);
    });

  list.scrollTop = list.scrollHeight;
}

// ── Acciones de mensaje (parlante + copy) ─────────────────────────────────

const ICON_SPEAKER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>';

const ICON_STOP =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="1"></rect></svg>';

const ICON_COPY =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

const ICON_CHECK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

function messageActionsHtml() {
  return (
    '<div class="message-actions">' +
      '<button type="button" class="message-action-btn message-action-btn--speak" aria-label="Escuchar mensaje">' + ICON_SPEAKER + '</button>' +
      '<button type="button" class="message-action-btn message-action-btn--copy" aria-label="Copiar mensaje">' + ICON_COPY + '</button>' +
    '</div>'
  );
}

let speakingMessageId = null;
let activeAudioCtx = null;
let activeAudioSource = null;

function stopSpeaking(btn) {
  if (activeAudioCtx) {
    try { activeAudioCtx.close(); } catch {}
    activeAudioCtx = null;
    activeAudioSource = null;
  }
  speakingMessageId = null;
  if (btn) {
    btn.classList.remove('message-action-btn--active');
    btn.innerHTML = ICON_SPEAKER;
  }
  document.querySelectorAll('.message-action-btn--speak.message-action-btn--active').forEach(b => {
    b.classList.remove('message-action-btn--active');
    b.innerHTML = ICON_SPEAKER;
  });
}

async function speakMessage(btn, text) {
  const item = btn.closest('.message-item');
  const id = item ? item.dataset.messageId : null;

  // Toggle: si ya está sonando este mensaje, lo paramos
  if (speakingMessageId === id) {
    stopSpeaking(btn);
    return;
  }

  stopSpeaking(null);

  btn.classList.add('message-action-btn--active');
  btn.innerHTML = ICON_STOP;
  speakingMessageId = id;

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'es-AR';
  utterance.onend = () => stopSpeaking(btn);
  utterance.onerror = () => stopSpeaking(btn);
  activeAudioCtx = { close: () => speechSynthesis.cancel() };
  speechSynthesis.speak(utterance);
}

async function playChunks(chunks, btn) {
  try {
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { merged.set(c, offset); offset += c.length; }

    const blob = new Blob([merged], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    activeAudioCtx = { close: () => { audio.pause(); URL.revokeObjectURL(url); } };

    audio.onended = () => { URL.revokeObjectURL(url); stopSpeaking(btn); };
    audio.onerror = () => { URL.revokeObjectURL(url); stopSpeaking(btn); };
    await audio.play();
  } catch {
    stopSpeaking(btn);
  }
}

async function copyMessage(btn, text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
  btn.classList.add('message-action-btn--active');
  btn.innerHTML = ICON_CHECK;
  setTimeout(() => {
    btn.classList.remove('message-action-btn--active');
    btn.innerHTML = ICON_COPY;
  }, 1200);
}

function initMessageActions() {
  const list = document.getElementById('message-list');
  if (!list) return;
  list.addEventListener('click', (e) => {
    const speakBtn = e.target.closest('.message-action-btn--speak');
    const copyBtn = e.target.closest('.message-action-btn--copy');
    if (!speakBtn && !copyBtn) return;

    const item = e.target.closest('.message-item');
    if (!item) return;
    const id = item.dataset.messageId;
    const msg = messages.find(m => m.id === id);
    if (!msg) return;

    if (speakBtn) speakMessage(speakBtn, msg.message);
    if (copyBtn) copyMessage(copyBtn, msg.message);
  });
}

function setSyncStatus(state, text) {
  const el = document.getElementById('sync-status');
  if (el) { el.dataset.state = state; el.textContent = text; }
  const busy = state === 'loading';
  const syncBtn = document.getElementById('sync-button');
  if (syncBtn) syncBtn.disabled = busy;
  const submitBtn = document.getElementById('message-submit');
  if (submitBtn) submitBtn.disabled = busy;
}

// ── Utilidades ─────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function renderMarkdown(str) {
  // Aplicar después de escapeHtml, así los tags HTML ya están escapados
  return str
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Init ───────────────────────────────────────────────────────────────────

// ── Modal upgrade ─────────────────────────────────────────────────────────

function showUpgradeModal() {
  let modal = document.getElementById('upgrade-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'upgrade-modal';
    modal.innerHTML = `
      <div id="upgrade-modal-box">
        <button type="button" id="upgrade-modal-close">✕</button>
        <div id="upgrade-modal-icon"><img src="images/favicon.png" alt="HASH" style="width:48px;height:48px;"></div>
        <h3 style="text-transform:uppercase;">Alcanzaste el límite del plan free</h3>
        <p style="font-size:0.78rem;color:#aaa;margin:0 0 10px;">Tus mensajes se restablecen en 24 hs. O pasate a Pro y chateá sin límites.</p>
        <ul>
          <li>✓ Mensajes ilimitados</li>
          <li>✓ Hasta 20 documentos en memoria</li>
          <li>✓ Búsqueda semántica avanzada</li>
        </ul>
        <p class="upgrade-price">$5 USD / mes</p>
        <div class="upgrade-pay-btns">
          <a class="upgrade-pay-btn" href="https://www.paypal.com/ncp/payment/VPXEFLL833YWN" target="_blank" rel="noopener">
            <img class="pay-logo" src="images/paypal-icon.svg" alt="PayPal">
          </a>
          <button type="button" class="upgrade-pay-btn" id="upgrade-btn-mp">
            <img class="pay-logo" src="images/mercado_pago.svg" alt="Mercado Pago">
          </button>
          <button type="button" class="upgrade-pay-btn" id="upgrade-btn-usdt">
            <img class="pay-logo" src="images/btc-usdt.svg" alt="Crypto">
          </button>
        </div>
        <div id="upgrade-usdt-panel" hidden>
          <p class="usdt-wallet-label">Enviá exactamente <strong>10 USDT</strong> por red Tron (TRC20):</p>
          <div class="usdt-wallet-row">
            <span class="usdt-wallet-addr">TDPfrfpipHtENAANT2zkgLZNFmZE6MaJRw</span>
            <button type="button" id="upgrade-usdt-copy">Copiar</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.setAttribute('hidden', ''); });
    document.getElementById('upgrade-modal-close').addEventListener('click', () => modal.setAttribute('hidden', ''));

    // Mercado Pago
    document.getElementById('upgrade-btn-mp').addEventListener('click', async () => {
      const btn = document.getElementById('upgrade-btn-mp');
      btn.disabled = true;
      btn.querySelector('span:last-child').textContent = '...';
      const token = getToken();
      try {
        const res = await fetch(HASH_CLOUD_URL + '/payments/mercadopago/create', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: 5, description: "HASH Pro" }),
        });
        const data = await res.json();
        if (data.init_point) window.open(data.init_point, '_blank');
      } catch { }
      btn.disabled = false;
      btn.querySelector('span:last-child').textContent = 'Mercado Pago';
    });

    // USDT — despliega wallet inline
    document.getElementById('upgrade-btn-usdt').addEventListener('click', () => {
      const panel = document.getElementById('upgrade-usdt-panel');
      panel.hasAttribute('hidden') ? panel.removeAttribute('hidden') : panel.setAttribute('hidden', '');
    });
    document.getElementById('upgrade-usdt-copy').addEventListener('click', () => {
      const btn = document.getElementById('upgrade-usdt-copy');
      fallbackCopy('TDPfrfpipHtENAANT2zkgLZNFmZE6MaJRw', null);
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = 'Copiar'; }, 2000);
    });
  }
  modal.removeAttribute('hidden');
}


function fallbackCopy(text, statusEl) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand('copy');
    if (statusEl) { statusEl.textContent = "✓ Dirección copiada"; setTimeout(() => { statusEl.textContent = ""; }, 2500); }
  } catch(e) {}
  document.body.removeChild(ta);
}

let _paypalRendered = false;

function showCryptoModal() {
  const modal = document.getElementById("crypto-modal");
  if (!modal) return;
  modal.removeAttribute("hidden");
  document.getElementById("crypto-modal-close").onclick = () => modal.setAttribute("hidden", "");
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.setAttribute("hidden", ""); });

  // Registrar email pendiente de pago
  const token = getToken();
  if (token) {
    fetch(HASH_CLOUD_URL + '/auth/payment/pending', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token }
    }).catch(() => {});
  }

  // Copiar wallet USDT
  const copyBtn = document.getElementById("crypto-copy-btn");
  const WALLET = "TDPfrfpipHtENAANT2zkgLZNFmZE6MaJRw";
  if (copyBtn) copyBtn.onclick = () => fallbackCopy(WALLET, null);

  // Selector de método de pago
  const methodBtns = document.querySelectorAll(".pay-method-btn");
  const panels = document.querySelectorAll(".pay-panel");

  methodBtns.forEach(btn => {
    btn.onclick = () => {
      methodBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const method = btn.dataset.method;
      panels.forEach(p => p.setAttribute("hidden", ""));
      const panel = document.getElementById("pay-panel-" + method);
      if (panel) panel.removeAttribute("hidden");

      // Renderizar PayPal solo una vez
      if (method === "paypal" && !_paypalRendered && window.paypal) {
        _paypalRendered = true;
        paypal.HostedButtons({ hostedButtonId: "VPXEFLL833YWN" }).render("#paypal-container-VPXEFLL833YWN");
      }
    };
  });

  // Mercado Pago
  const mpBtn = document.getElementById("mp-pay-btn");
  if (mpBtn) {
    mpBtn.onclick = async () => {
      mpBtn.disabled = true;
      mpBtn.textContent = "Generando link...";
      try {
        const res = await fetch(HASH_CLOUD_URL + '/payments/mercadopago/create', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: 5, description: "HASH Pro" }),
        });
        const data = await res.json();
        if (data.init_point) {
          window.open(data.init_point, '_blank');
        } else {
          mpBtn.textContent = "Error, intentá de nuevo";
        }
      } catch {
        mpBtn.textContent = "Error, intentá de nuevo";
      } finally {
        mpBtn.disabled = false;
        setTimeout(() => { mpBtn.textContent = "Pagar con Mercado Pago"; }, 3000);
      }
    };
  }
}
function initApp() {
  loadFronts();
  initMessageActions();
  initVoiceChat();

  // Selector de modo
  document.querySelectorAll('.mode-btn').forEach(btn => {
    if (btn.dataset.mode === activeMode) btn.classList.add('mode-btn--active');
    btn.addEventListener('click', () => {
      activeMode = btn.dataset.mode;
      localStorage.setItem('hash_mode', activeMode);
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('mode-btn--active'));
      btn.classList.add('mode-btn--active');
    });
  });


  const syncBtn = document.getElementById('sync-button');
  if (syncBtn) syncBtn.addEventListener('click', () => syncFront(activeFrontId));



  document.getElementById('message-submit').addEventListener('click', async () => {
    const input = document.getElementById('message-input');
    const texto = input.value.trim();
    if (!texto) return;
    input.value = '';
    input.style.height = 'auto';
    await saveMessage(texto);
  });

  document.getElementById('message-input').addEventListener('keydown', async (e) => {
    const isMobile = window.matchMedia('(pointer: coarse)').matches;
    if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
      if (isSending) return;
      const input = document.getElementById('message-input');
      const texto = input.value.trim();
      if (!texto) return;
      input.value = '';
      input.style.height = 'auto';
      await saveMessage(texto);
    }
  });

  const msgInput = document.getElementById('message-input');
  msgInput.addEventListener('input', () => {
    msgInput.style.height = 'auto';
    msgInput.style.height = Math.min(msgInput.scrollHeight, 200) + 'px';
  });

  const modal       = document.getElementById('new-front-modal');
  const cancelBtn   = document.getElementById('new-front-cancel');
  const submitBtn   = document.getElementById('new-front-submit');
  const nameInput   = document.getElementById('new-front-name');
  const descInput   = document.getElementById('new-front-description');
  const modalStatus = document.getElementById('new-front-status');

  function closeModal() { modal.setAttribute('hidden', ''); }
  cancelBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  submitBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    submitBtn.disabled = true;
    cancelBtn.disabled = true;
    modalStatus.textContent = 'Guardando...';
    try {
      await createFront(name, descInput.value);
      closeModal();
    } catch (err) {
      modalStatus.textContent = 'No se pudo guardar. Intentá de nuevo.';
      console.error('createFront error:', err);
      submitBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  });

  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitBtn.click(); });

  // Settings
  const settingsModal = document.getElementById('settings-modal');
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) settingsModal.setAttribute('hidden', '');
  });
  settingsModal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') settingsModal.setAttribute('hidden', '');
  });

  // Cargar memoria desde ajustes
  const settingsMemoryInput = document.createElement('input');
  settingsMemoryInput.type = 'file';
  settingsMemoryInput.accept = '.txt';
  settingsMemoryInput.style.display = 'none';
  settingsMemoryInput.id = 'settings-memory-input';
  settingsMemoryInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const token = getToken();
    const formData = new FormData();
    formData.append('file', file);
    const btn = document.getElementById('settings-load-memory');
    if (btn) { btn.textContent = ''; btn.innerHTML = '<span class="btn-spinner"></span>'; btn.disabled = true; }
    try {
      const res = await fetch(HASH_CLOUD_URL + '/memory/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: formData,
      });
      if (!res.ok) throw new Error('Error ' + res.status);
      if (btn) { btn.innerHTML = '<span class="btn-check">✓</span> Cargada'; btn.classList.add('btn-success'); }
      setTimeout(() => {
        if (btn) { btn.innerHTML = 'Cargar memoria'; btn.disabled = false; btn.classList.remove('btn-success'); }
      }, 3000);
    } catch (err) {
      if (btn) { btn.innerHTML = 'Error ✕'; btn.disabled = false; }
      setTimeout(() => {
        if (btn) { btn.innerHTML = 'Cargar memoria'; }
      }, 3000);
    }
    settingsMemoryInput.value = '';
  };
  document.body.appendChild(settingsMemoryInput);

  const loadMemoryBtn = document.getElementById('settings-load-memory');
  if (loadMemoryBtn) loadMemoryBtn.addEventListener('click', () => settingsMemoryInput.click());

  // Lista de TXTs cargados
  async function renderMemoryDocList() {
    const container = document.getElementById('memory-doc-list');
    if (!container) return;
    container.innerHTML = '<span class="memory-doc-loading">Cargando...</span>';
    try {
      const docs = await apiListMemoryDocs();
      if (!docs.length) {
        container.innerHTML = '<span class="memory-doc-empty">Sin archivos cargados.</span>';
        return;
      }
      container.innerHTML = '';
      docs.forEach(doc => {
        const row = document.createElement('div');
        row.className = 'memory-doc-row';
        const name = document.createElement('span');
        name.className = 'memory-doc-name';
        name.textContent = doc.name;
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'memory-doc-delete';
        delBtn.textContent = 'Eliminar';
        delBtn.onclick = async () => {
          delBtn.disabled = true;
          delBtn.textContent = '...';
          try {
            await apiDeleteMemoryDoc(doc.key);
            row.remove();
            if (!container.children.length) {
              container.innerHTML = '<span class="memory-doc-empty">Sin archivos cargados.</span>';
            }
          } catch {
            delBtn.textContent = 'Error';
            setTimeout(() => { delBtn.textContent = 'Eliminar'; delBtn.disabled = false; }, 2000);
          }
        };
        row.appendChild(name);
        row.appendChild(delBtn);
        container.appendChild(row);
      });
    } catch {
      container.innerHTML = '<span class="memory-doc-empty">No se pudo cargar la lista.</span>';
    }
  }

  // Cargar lista cuando se abre el modal de ajustes
  const settingsModalEl = document.getElementById('settings-modal');
  const settingsObserver = new MutationObserver(() => {
    if (!settingsModalEl.hasAttribute('hidden')) renderMemoryDocList();
  });
  settingsObserver.observe(settingsModalEl, { attributes: true, attributeFilter: ['hidden'] });

  // Cerrar sesión desde ajustes
  const settingsLogoutBtn = document.getElementById('settings-logout');
  if (settingsLogoutBtn) settingsLogoutBtn.addEventListener('click', logout);

  const exportMemoryBtn = document.getElementById('settings-export-memory');
  if (exportMemoryBtn) {
    exportMemoryBtn.addEventListener('click', async () => {
      const token = getToken();
      if (!token) return;
      exportMemoryBtn.textContent = 'Descargando...';
      exportMemoryBtn.disabled = true;
      try {
        const res = await fetch(HASH_CLOUD_URL + '/memory/export', {
          headers: { 'Authorization': 'Bearer ' + token },
        });
        if (!res.ok) throw new Error('Error al exportar');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'memoria_hash.txt';
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        alert('No se pudo descargar la memoria.');
      } finally {
        exportMemoryBtn.textContent = 'Descargar memoria';
        exportMemoryBtn.disabled = false;
      }
    });
  }

  const fontRange = document.getElementById('settings-font-size');
  const fontLabel = document.getElementById('settings-font-label');
  const savedFont = localStorage.getItem('hash_font_size') || '18';
  fontRange.value = savedFont;
  fontLabel.textContent = savedFont + 'px';
  document.documentElement.style.setProperty('--font-size-base', savedFont + 'px');
  fontRange.addEventListener('input', () => {
    const val = fontRange.value;
    fontLabel.textContent = val + 'px';
    document.documentElement.style.setProperty('--font-size-base', val + 'px');
    localStorage.setItem('hash_font_size', val);
  });
  const hamburger = document.getElementById('hamburger');
  const overlay = document.getElementById('sidebar-overlay');
  if (hamburger) {
    hamburger.addEventListener('click', () => {
      if (window.innerWidth > 640) {
        document.getElementById('sidebar').classList.toggle('sidebar--hidden');
        return;
      }
      document.getElementById('sidebar').classList.toggle('sidebar--open');
      if (overlay) overlay.classList.toggle('sidebar-overlay--visible');
    });
  }
  if (overlay) overlay.addEventListener('click', closeSidebar);

  // Abrir sidebar al entrar a la app (mobile y desktop)
  const sidebar = document.getElementById('sidebar');
  if (window.innerWidth <= 640) {
    sidebar.classList.add('sidebar--open');
    if (overlay) overlay.classList.add('sidebar-overlay--visible');
  }

  // Swipe: izquierda a derecha abre, derecha a izquierda cierra
  // Sin passive:true para poder bloquear el gesto de Safari/PWA
  let touchStartX = null;
  let touchStartY = null;
  let swipeFromEdge = false;

  document.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    swipeFromEdge = touchStartX < 40;
  }, { passive: false });

  document.addEventListener('touchmove', (e) => {
    if (!swipeFromEdge) return;
    e.preventDefault(); // bloquea navegación de Safari cuando viene del borde
  }, { passive: false });

  document.addEventListener('touchend', (e) => {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    const reset = () => { touchStartX = null; touchStartY = null; swipeFromEdge = false; };
    if (Math.abs(dx) < Math.abs(dy) || Math.abs(dx) < 40) { reset(); return; }
    if (dx > 0) {
      sidebar.classList.add('sidebar--open');
      if (overlay) overlay.classList.add('sidebar-overlay--visible');
    } else {
      closeSidebar();
    }
    reset();
  }, { passive: true });
}

// ── Auth ───────────────────────────────────────────────────────────────────

async function checkAuth() {
  await handleAuthCallback();
  const identity = await fetchIdentity();
  if (!identity) {
    clearToken();
    renderLoginScreen();
    return;
  }
  document.getElementById('lock-screen').setAttribute('hidden', '');
  document.getElementById('app').removeAttribute('hidden');
  initApp();
}

document.addEventListener('DOMContentLoaded', () => {
  const savedFont = localStorage.getItem('hash_font_size') || '18';
  document.documentElement.style.setProperty('--font-size-base', savedFont + 'px');
  checkAuth();
});

// ── Red Neural ────────────────────────────────────────────────────────────────
(function () {
  const LIME = "#b4ff00";

  // Datos por defecto — se reemplazarán con datos del back
  const DEFAULT_NODES = [
    { id: "cerebro",          label: "Cerebro",          main: true },
    { id: "salud",            label: "Salud" },
    { id: "proyectos",        label: "Proyectos" },
    { id: "disciplina",       label: "Disciplina" },
    { id: "vulnerabilidades", label: "Vulnerabilidades" },
    { id: "vinculos",         label: "Vínculos" },
    { id: "mente",            label: "Mente" },
  ];
  const DEFAULT_EDGES = [
    ["cerebro","salud"],["cerebro","proyectos"],["cerebro","disciplina"],
    ["cerebro","vulnerabilidades"],["cerebro","vinculos"],["cerebro","mente"],
    ["salud","mente"],["salud","disciplina"],
    ["mente","vulnerabilidades"],["mente","disciplina"],
    ["proyectos","disciplina"],["proyectos","salud"],
    ["vinculos","vulnerabilidades"],
  ];

  let nodes = [], edges = [], raf = null;

  function initPhysics(nodeData, edgeData, W, H) {
    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) * 0.28;
    const outerNodes = nodeData.filter(n => !n.main && !n.sub);
    const subNodes = nodeData.filter(n => n.sub);

    nodes = nodeData.map((n) => {
      if (n.main) return { ...n, x: cx, y: cy, vx: 0, vy: 0, r: 36, pinned: true };
      if (n.sub) {
        const subIdx = subNodes.indexOf(n);
        const subTotal = subNodes.length;
        const subAngle = (subIdx / subTotal) * Math.PI * 2 - Math.PI / 2;
        const subR = R * 2.1;
        const words2 = n.label.split(" ");
        const longest2 = Math.max(...words2.map(w => w.length));
        const dynR = words2.length > 1 ? Math.max(14, longest2 * 2.8) : Math.max(12, n.label.length * 2.4);
        return {
          ...n,
          x: cx + subR * Math.cos(subAngle) + (Math.random() - 0.5) * 15,
          y: cy + subR * Math.sin(subAngle) + (Math.random() - 0.5) * 15,
          vx: 0, vy: 0, r: dynR, pinned: false
        };
      }
      const idx = outerNodes.indexOf(n);
      const angle = (idx / outerNodes.length) * Math.PI * 2 - Math.PI / 2;
      return {
        ...n,
        x: cx + R * Math.cos(angle) + (Math.random() - 0.5) * 10,
        y: cy + R * Math.sin(angle) + (Math.random() - 0.5) * 10,
        vx: 0, vy: 0, r: 26, pinned: false
      };
    });
    edges = edgeData;
  }

  let mouse = { x: -1000, y: -1000 };

  function stepPhysics(W, H) {
    const cx = W / 2, cy = H / 2;
    const SPRING = 0.012, DAMP = 0.82;

    // Repulsión entre nodos
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        if (a.pinned && b.pinned) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx*dx + dy*dy) || 1;
        const isSubPair = a.sub || b.sub;
        const force = (isSubPair ? 1800 : 4500) / (dist * dist);
        const fx = (dx / dist) * force, fy = (dy / dist) * force;
        if (!a.pinned) { a.vx -= fx; a.vy -= fy; }
        if (!b.pinned) { b.vx += fx; b.vy += fy; }
      }
    }

    // Atracción por aristas
    edges.forEach(([aid, bid]) => {
      const a = nodes.find(n => n.id === aid);
      const b = nodes.find(n => n.id === bid);
      if (!a || !b) return;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx*dx + dy*dy) || 1;
      const isSub = (a.sub || b.sub);
      const target = a.main || b.main ? (b.sub || a.sub ? 120 : 85) : isSub ? 55 : 65;
      const force = (dist - target) * SPRING;
      const fx = (dx / dist) * force, fy = (dy / dist) * force;
      if (!a.pinned) { a.vx += fx; a.vy += fy; }
      if (!b.pinned) { b.vx -= fx; b.vy -= fy; }
    });

    nodes.forEach(n => {
      if (n.pinned) return;

      // Mouse repel — igual que METHOD
      const mdx = n.x - mouse.x, mdy = n.y - mouse.y;
      const md = Math.sqrt(mdx*mdx + mdy*mdy);
      if (md < 220 && md > 30) {
        const force = (220 - md) / 220 * 5.0;
        n.vx += (mdx / md) * force;
        n.vy += (mdy / md) * force;
      } else if (md <= 30 && md > 0) {
        n.vx += (mdx / md) * 2.0;
        n.vy += (mdy / md) * 2.0;
      }

      const gravityStrength = n.sub ? 0.004 : 0.006;
      n.vx += (cx - n.x) * gravityStrength;
      n.vy += (cy - n.y) * gravityStrength;

      n.vx *= DAMP; n.vy *= DAMP;
      n.x += n.vx; n.y += n.vy;

      // Rebote suave en bordes
      if (n.x < n.r + 4)     { n.x = n.r + 4;     n.vx *= -0.4; }
      if (n.x > W - n.r - 4) { n.x = W - n.r - 4; n.vx *= -0.4; }
      if (n.y < n.r + 4)     { n.y = n.r + 4;     n.vy *= -0.4; }
      if (n.y > H - n.r - 4) { n.y = H - n.r - 4; n.vy *= -0.4; }
    });
  }

  function drawFrame(ctx, W, H) {
    ctx.clearRect(0, 0, W, H);

    // Aristas
    edges.forEach(([aid, bid]) => {
      const a = nodes.find(n => n.id === aid);
      const b = nodes.find(n => n.id === bid);
      if (!a || !b) return;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      const isCentral = a.main || b.main;
      ctx.strokeStyle = isCentral ? "rgba(180,255,0,0.3)" : "rgba(180,255,0,0.1)";
      ctx.lineWidth = isCentral ? 1.5 : 1;
      ctx.stroke();
    });

    // Nodos
    nodes.forEach(n => {
      // Glow
      const grd = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 2.2);
      grd.addColorStop(0, n.main ? "rgba(180,255,0,0.2)" : "rgba(180,255,0,0.08)");
      grd.addColorStop(1, "transparent");
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r * 2.2, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();

      // Círculo
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = n.main ? "rgba(180,255,0,0.13)" : "#0e0e0e";
      ctx.strokeStyle = LIME;
      ctx.lineWidth = n.main ? 2 : 1;
      ctx.fill();
      ctx.stroke();

      // Label
      ctx.fillStyle = LIME;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const words = n.label.split(" ");
      if (words.length > 1 && !n.main) {
        const longest = Math.max(...words.map(w => w.length));
        const fs = longest > 6 ? 7 : 8;
        ctx.font = `500 ${fs}px Inter, sans-serif`;
        ctx.fillText(words[0], n.x, n.y - 5);
        ctx.fillText(words.slice(1).join(" "), n.x, n.y + 6);
      } else {
        const fs = n.main ? 11 : n.label.length > 7 ? 8 : 9.5;
        ctx.font = `${n.main ? 600 : 500} ${fs}px Inter, sans-serif`;
        ctx.fillText(n.label, n.x, n.y);
      }
    });
  }

  function stopLoop() {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
  }

  async function openGraph(canvas) {
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    // Mostrar nodos default mientras carga
    initPhysics(DEFAULT_NODES, DEFAULT_EDGES, canvas.width, canvas.height);
    startLoop(canvas);

    // Pedir grafo al back
    try {
      const token = getToken();
      const res = await fetch(HASH_CLOUD_URL + "/memory/graph", {
        headers: { "Authorization": "Bearer " + token }
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.nodes || data.nodes.length === 0) return;

      // Convertir formato del back al formato interno
      const newNodes = data.nodes.map(n => ({
        id: n.id,
        label: n.label,
        main: !!n.main,
        sub: !!n.sub,
      }));
      const newEdges = data.edges.map(e => [e.from, e.to]);

      stopLoop();
      initPhysics(newNodes, newEdges, canvas.width, canvas.height);
      startLoop(canvas);
    } catch (e) {
      // Si falla el back, dejamos los nodos default
      console.warn("No se pudo cargar el grafo:", e);
    }
  }

  let hoveredNode = null;

  function getNodeAt(canvas, mx, my) {
    const rect = canvas.getBoundingClientRect();
    const x = mx - rect.left, y = my - rect.top;
    return nodes.find(n => Math.hypot(n.x - x, n.y - y) < n.r + 8) || null;
  }

  function drawFrameWithHover(ctx, W, H) {
    ctx.clearRect(0, 0, W, H);

    edges.forEach(([aid, bid]) => {
      const a = nodes.find(n => n.id === aid);
      const b = nodes.find(n => n.id === bid);
      if (!a || !b) return;
      const isHovered = hoveredNode && (hoveredNode.id === aid || hoveredNode.id === bid);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      const isCentral = a.main || b.main;
      ctx.strokeStyle = isHovered
        ? "rgba(180,255,0,0.7)"
        : isCentral ? "rgba(180,255,0,0.3)" : "rgba(180,255,0,0.1)";
      ctx.lineWidth = isHovered ? 2 : isCentral ? 1.5 : 1;
      ctx.stroke();
    });

    nodes.forEach(n => {
      const isHov = hoveredNode && hoveredNode.id === n.id;
      const scale = isHov ? 1.25 : 1;
      const r = n.r * scale;

      const grd = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 2.4);
      grd.addColorStop(0, isHov ? "rgba(180,255,0,0.4)" : n.main ? "rgba(180,255,0,0.2)" : "rgba(180,255,0,0.08)");
      grd.addColorStop(1, "transparent");
      ctx.beginPath();
      ctx.arc(n.x, n.y, r * 2.4, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = isHov ? "rgba(180,255,0,0.2)" : n.main ? "rgba(180,255,0,0.13)" : "#0e0e0e";
      ctx.strokeStyle = "#b4ff00";
      ctx.lineWidth = isHov ? 2.5 : n.main ? 2 : 1;
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#b4ff00";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const words = n.label.split(" ");
      if (words.length > 1 && !n.main) {
        const longest = Math.max(...words.map(w => w.length));
        const fs = isHov ? (longest > 6 ? 8 : 9) : (longest > 6 ? 7 : 8);
        ctx.font = `500 ${fs}px Inter, sans-serif`;
        ctx.fillText(words[0], n.x, n.y - 5);
        ctx.fillText(words.slice(1).join(" "), n.x, n.y + 6);
      } else {
        const fs = n.main ? (isHov ? 13 : 11) : isHov ? 10 : n.label.length > 7 ? 8 : 9.5;
        ctx.font = `${n.main ? 600 : 500} ${fs}px Inter, sans-serif`;
        ctx.fillText(n.label, n.x, n.y);
      }
    });
  }

  function startLoop(canvas) {
    const ctx = canvas.getContext("2d");
    function loop() {
      const W = canvas.width, H = canvas.height;
      stepPhysics(W, H);
      drawFrameWithHover(ctx, W, H);
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const btn    = document.getElementById("neural-btn");
    const modal  = document.getElementById("neural-modal");
    const close  = document.getElementById("neural-close");
    const canvas = document.getElementById("neural-canvas");
    if (!btn) return;

    btn.addEventListener("click", () => {
      modal.hidden = false;
      requestAnimationFrame(() => openGraph(canvas));
    });
    close.addEventListener("click", () => { modal.hidden = true; stopLoop(); });
    modal.addEventListener("click", e => { if (e.target === modal) { modal.hidden = true; stopLoop(); } });

    canvas.addEventListener("mousemove", e => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      hoveredNode = getNodeAt(canvas, e.clientX, e.clientY);
      canvas.style.cursor = hoveredNode ? "pointer" : "default";
    });
    canvas.addEventListener("mouseleave", () => {
      mouse.x = -1000; mouse.y = -1000;
      hoveredNode = null;
      canvas.style.cursor = "default";
    });
    canvas.addEventListener("touchmove", e => {
      e.preventDefault();
      e.stopPropagation();
      const rect = canvas.getBoundingClientRect();
      const t = e.touches[0];
      mouse.x = t.clientX - rect.left;
      mouse.y = t.clientY - rect.top;
      hoveredNode = getNodeAt(canvas, t.clientX, t.clientY);
    }, { passive: false });
    canvas.addEventListener("touchstart", e => {
      e.stopPropagation();
    }, { passive: false });
    canvas.addEventListener("touchend", e => {
      e.stopPropagation();
      mouse.x = -1000; mouse.y = -1000;
      hoveredNode = null;
    });

    window.addEventListener("resize", () => {
      if (!modal.hidden) {
        canvas.width  = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        const c = nodes.find(n => n.main);
        if (c) { c.x = canvas.width/2; c.y = canvas.height/2; }
      }
    });
  });
})();

// ── Chat de voz ────────────────────────────────────────────────────────────

let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

function initVoiceChat() {
  const btn = document.getElementById('voice-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (isRecording) stopRecording();
    else startRecording();
  });
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = () => { stream.getTracks().forEach(t => t.stop()); sendVoiceMessage(); };
    mediaRecorder.start();
    isRecording = true;
    const btn = document.getElementById('voice-btn');
    btn.textContent = '⏹';
    btn.style.color = '#b4ff00';
  } catch {
    setSyncStatus('error', 'No se pudo acceder al micrófono.');
  }
}

function stopRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
    isRecording = false;
    const btn = document.getElementById('voice-btn');
    btn.textContent = '🎤';
    btn.style.color = '';
  }
}

async function sendVoiceMessage() {
  if (!audioChunks.length) return;
  const blob = new Blob(audioChunks, { type: 'audio/webm' });
  const formData = new FormData();
  formData.append('audio', blob, 'audio.webm');
  if (activeChatId) formData.append('chat_id', activeChatId);

  const tempUser = { id: crypto.randomUUID(), role: 'user', message: '🎤 Procesando...', created_at: new Date().toISOString() };
  const tempHash = { id: crypto.randomUUID(), role: 'hash', message: '', created_at: new Date().toISOString(), loading: true };
  messages = [...messages, tempUser, tempHash];
  renderMessages();
  setSyncStatus('loading', 'Hash está escuchando...');

  try {
    const token = getToken();
    const res = await fetch(HASH_CLOUD_URL + '/chat/voice', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: formData,
    });
    if (res.status === 403) { showUpgradeModal(); return; }
    if (!res.ok) throw new Error('Error ' + res.status);

    const data = await res.json();
    const transcript = data.transcript || '🎤 Mensaje de voz';
    const reply = data.reply || '';
    const chatId = data.chat_id;

    if (chatId && !activeChatId) {
      activeChatId = chatId;
      activeFrontId = chatId;
      localStorage.setItem('hash_active_chat', chatId);
    }

    tempUser.message = transcript;
    tempHash.message = reply;
    tempHash.loading = false;
    if (activeChatId) chatCache[activeChatId] = messages;
    renderMessages();

    if (chatId && !FRONTS.find(f => f.chat_id === chatId)) {
      FRONTS = [{ id: chatId, chat_id: chatId, name: transcript.slice(0, 50) }, ...FRONTS];
      activeFrontId = chatId;
      renderFrontList();
      renderHeader();
    }

    // Reproducir respuesta con voz del navegador
    const utterance = new SpeechSynthesisUtterance(reply);
    utterance.lang = 'es-AR';
    speechSynthesis.speak(utterance);
    setSyncStatus('success', '');
  } catch (err) {
    messages = messages.filter(m => !m.loading);
    renderMessages();
    setSyncStatus('error', 'No se pudo enviar el audio.');
  }
}
