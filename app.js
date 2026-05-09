(() => {
  const CONFIG = {
    APP_NAME: 'QuickShare Pro',
    ROOMS_KEY: 'qs_rooms_v1',
    NAME_KEY: 'qs_user_name_v1',
    LAST_ROOM_KEY: 'qs_last_room_v1',
    MSG_PREFIX: 'qs_messages_v1_',
    PRES_PREFIX: 'qs_presence_v1_',
    CHANNEL_PREFIX: 'qs_channel_v1_',
    TAB_ID_KEY: 'qs_tab_id_v1',
    HEARTBEAT_MS: 7000,
    PRESENCE_TTL_MS: 20000,
    MAX_MESSAGE_HISTORY: 300,
    MAX_FILE_BYTES: 8 * 1024 * 1024
  };

  const params = new URLSearchParams(window.location.search);
  const isChatPage = !!document.querySelector('#messages');
  const tabId = getTabId();

  const els = {
    homeTitle: q('#homeTitle'),
    nameInput: q('#nameInput'),
    roomInput: q('#roomInput'),
    createRoomBtn: q('#createRoomBtn'),
    joinRoomBtn: q('#joinRoomBtn'),

    roomTitle: q('#roomTitle'),
    onlineCount: q('#onlineCount'),
    messages: q('#messages'),
    activityStatus: q('#activityStatus'),
    messageInput: q('#messageInput'),
    sendBtn: q('#sendBtn'),
    emojiBtn: q('#emojiBtn'),
    emojiPanel: q('#emojiPanel'),
    fileBtn: q('#fileBtn'),
    fileInput: q('#fileInput'),
    micBtn: q('#micBtn'),
    leaveBtn: q('#leaveBtn'),
    clearChatBtn: q('#clearChatBtn'),
    copyRoomBtn: q('#copyRoomBtn'),
    qrBox: q('#roomQrBox'),
    qrText: q('#roomQrText'),
    replyPreview: q('#replyPreview'),
    replyPreviewName: q('#replyPreviewName'),
    replyPreviewText: q('#replyPreviewText'),
    cancelReplyBtn: q('#cancelReplyBtn'),
    floatingReplyBtn: q('#floatingReplyBtn'),

    voiceComposer: q('#voiceComposer'),
    voiceDeleteBtn: q('#voiceDeleteBtn'),
    voicePauseBtn: q('#voicePauseBtn'),
    voiceSendBtn: q('#voiceSendBtn'),
    voiceTimer: q('#voiceTimer'),
    voiceWave: q('#voiceWave')
  };

  let roomChannel = null;
  let presenceTimer = null;
  let typingTimer = null;
  let currentReply = null;
  let selectedMessageForReply = null;

  let mediaRecorder = null;
  let recordingStream = null;
  let recordingChunks = [];
  let isRecording = false;
  let recordingPaused = false;
  let recordingStartTs = 0;
  let pausedMsTotal = 0;
  let pausedAt = 0;
  let recordingWaveTimer = null;
  let recordingDurationTimer = null;

  const currentRoom = normalizeRoom(params.get('room') || safeGet(CONFIG.LAST_ROOM_KEY) || '');
  const currentName = cleanName(params.get('name') || safeGet(CONFIG.NAME_KEY) || '') || 'Guest';

  boot();
  window.addEventListener('beforeunload', cleanupPresence);
  window.addEventListener('storage', onStorageUpdate);

  function boot() {
    if (!isChatPage) return initLanding();
    initChat();
  }

  function initLanding() {
    if (els.homeTitle) els.homeTitle.textContent = CONFIG.APP_NAME;
    const scannedRoom = normalizeRoom(params.get('room') || '');
    const scanJoin = !!scannedRoom;

    if (els.nameInput) {
      els.nameInput.value = safeGet(CONFIG.NAME_KEY) || '';
      bindEnter(els.nameInput, scanJoin ? handleJoinRoom : handleCreateRoom);
    }

    if (els.roomInput) {
      if (scannedRoom) {
        els.roomInput.value = scannedRoom;
        els.roomInput.readOnly = true;
      }
      bindEnter(els.roomInput, handleJoinRoom);
    }

    if (scanJoin && els.createRoomBtn) els.createRoomBtn.classList.add('hidden');
    if (els.createRoomBtn) els.createRoomBtn.addEventListener('click', handleCreateRoom);
    if (els.joinRoomBtn) els.joinRoomBtn.addEventListener('click', handleJoinRoom);
  }

  function initChat() {
    if (!currentRoom) {
      toast('Room code missing. Redirecting back...', 'error');
      return setTimeout(() => (window.location.href = 'index.html'), 900);
    }

    ensureRoom(currentRoom, currentName);
    safeSet(CONFIG.NAME_KEY, currentName);
    safeSet(CONFIG.LAST_ROOM_KEY, currentRoom);

    if (els.roomTitle) els.roomTitle.textContent = `Room code: ${currentRoom}`;
    renderRoomQR();

    setupChannel();
    setupChatUI();
    setupEmojiPanel();
    setupReplyUI();
    setupMic();
    startPresence();
    renderChat();
    updateOnlineCount();
  }

  function setupChatUI() {
    if (els.messageInput) {
      els.messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendTextMessage();
        }
      });
      els.messageInput.addEventListener('input', onTyping);
    }

    if (els.sendBtn) els.sendBtn.addEventListener('click', sendTextMessage);
    if (els.fileBtn && els.fileInput) els.fileBtn.addEventListener('click', () => els.fileInput.click());
    if (els.fileInput) els.fileInput.addEventListener('change', handleFileSelect);
    if (els.leaveBtn) els.leaveBtn.addEventListener('click', () => { cleanupPresence(); window.location.href = 'index.html'; });
    if (els.clearChatBtn) els.clearChatBtn.addEventListener('click', clearChat);
    if (els.copyRoomBtn) els.copyRoomBtn.addEventListener('click', copyRoomCode);
  }

  function setupChannel() {
    if (!('BroadcastChannel' in window)) return;
    roomChannel = new BroadcastChannel(`${CONFIG.CHANNEL_PREFIX}${currentRoom}`);
    roomChannel.onmessage = () => renderChat();
  }

  function setupEmojiPanel() {
    if (!els.emojiBtn || !els.emojiPanel || !els.messageInput) return;
    const emojis = ['😀','😁','😂','🤣','🙂','😉','😍','😘','😎','🤝','🙏','👍','🔥','🎉','💯','✅','💡','📎','❤️','🤍','🚀','👏','🌟','😢','😴','💭'];

    els.emojiPanel.innerHTML = '';
    els.emojiPanel.classList.add('hidden');

    emojis.forEach((emoji) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = emoji;
      btn.addEventListener('click', () => {
        insertAtCaret(els.messageInput, emoji);
        els.messageInput.focus();
      });
      els.emojiPanel.appendChild(btn);
    });

    els.emojiBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      els.emojiPanel.classList.toggle('hidden');
      if (!els.emojiPanel.classList.contains('hidden')) {
        els.emojiPanel.classList.toggle('mobile-emoji-open', window.matchMedia('(max-width: 520px)').matches);
      }
    });

    document.addEventListener('click', (e) => {
      if (els.emojiPanel.contains(e.target) || e.target === els.emojiBtn) return;
      els.emojiPanel.classList.add('hidden');
      els.emojiPanel.classList.remove('mobile-emoji-open');
    });
  }

  function setupReplyUI() {
    if (els.cancelReplyBtn) els.cancelReplyBtn.addEventListener('click', clearReplyTarget);
    if (els.floatingReplyBtn) els.floatingReplyBtn.addEventListener('click', () => {
      if (selectedMessageForReply) setReplyTarget(selectedMessageForReply);
    });
  }

  function onTyping() {
    setActivityStatus(`${currentName} is typing...`);
    clearTimeout(typingTimer);
    typingTimer = setTimeout(clearActivityStatus, 800);
  }

  function handleCreateRoom() {
    const name = readName();
    if (!name) return;
    const room = generateRoomCode();
    ensureRoom(room, name);
    safeSet(CONFIG.NAME_KEY, name);
    safeSet(CONFIG.LAST_ROOM_KEY, room);
    window.location.href = `chat.html?room=${encodeURIComponent(room)}&name=${encodeURIComponent(name)}`;
  }

  function handleJoinRoom() {
    const name = readName();
    if (!name) return;
    const room = normalizeRoom(els.roomInput ? els.roomInput.value : '');
    if (!room) {
      toast('Please enter a room code.', 'error');
      return focus(els.roomInput);
    }

    ensureRoom(room, name);
    safeSet(CONFIG.NAME_KEY, name);
    safeSet(CONFIG.LAST_ROOM_KEY, room);
    window.location.href = `chat.html?room=${encodeURIComponent(room)}&name=${encodeURIComponent(name)}`;
  }

  function sendTextMessage() {
    if (!els.messageInput) return;
    const text = els.messageInput.value.trim();
    if (!text) return toast('Type a message first.', 'error');
    sendMessage({ type: 'text', text });
    els.messageInput.value = '';
    els.messageInput.focus();
  }

  function sendMessage(payload) {
    const msg = {
      id: makeId(),
      room: currentRoom,
      user: currentName,
      senderId: tabId,
      ts: Date.now(),
      replyTo: currentReply ? { id: currentReply.id, user: currentReply.user, text: currentReply.text, type: currentReply.type } : null,
      ...payload
    };

    const messages = getMessages(currentRoom);
    messages.push(msg);
    saveMessages(currentRoom, messages.slice(-CONFIG.MAX_MESSAGE_HISTORY));
    broadcast({ type: 'message', message: msg });
    renderChat();
    if (currentReply) clearReplyTarget();
  }

  function handleFileSelect() {
    const file = els.fileInput && els.fileInput.files ? els.fileInput.files[0] : null;
    if (!file) return;
    if (file.size > CONFIG.MAX_FILE_BYTES) {
      toast('File is too large. Keep it under 8 MB.', 'error');
      els.fileInput.value = '';
      return;
    }
    fileToDataURL(file).then((dataUrl) => {
      sendMessage({ type: 'file', fileName: file.name, fileType: file.type || 'application/octet-stream', fileSize: file.size, dataUrl });
    }).catch(() => toast('File could not be read.', 'error'));
    els.fileInput.value = '';
  }

  function setupMic() {
    if (!els.micBtn) return;
    els.micBtn.addEventListener('click', startVoiceRecording);
    if (els.voiceDeleteBtn) els.voiceDeleteBtn.addEventListener('click', deleteRecordingDraft);
    if (els.voicePauseBtn) els.voicePauseBtn.addEventListener('click', toggleRecordingPause);
    if (els.voiceSendBtn) els.voiceSendBtn.addEventListener('click', stopVoiceRecording);
  }

  async function startVoiceRecording() {
    if (isRecording) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
      return toast('Voice recording is not supported in this browser.', 'error');
    }

    try {
      recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingChunks = [];
      mediaRecorder = new MediaRecorder(recordingStream);
      recordingPaused = false;
      recordingStartTs = Date.now();
      pausedMsTotal = 0;
      pausedAt = 0;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) recordingChunks.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        try {
          if (!recordingChunks.length) return;
          const blob = new Blob(recordingChunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
          const dataUrl = await blobToDataURL(blob);
          sendMessage({ type: 'file', fileName: `voice_${Date.now()}.webm`, fileType: blob.type || 'audio/webm', fileSize: blob.size, dataUrl, durationSec: getRecordingDurationSec() });
          toast('Voice message sent.', 'success');
        } catch {
          toast('Voice message failed.', 'error');
        } finally {
          cleanupRecorder();
        }
      };

      mediaRecorder.start();
      isRecording = true;
      if (els.micBtn) {
        els.micBtn.textContent = '●';
        els.micBtn.classList.add('recording');
      }
      setActivityStatus(`${currentName} is recording voice...`);
      showVoiceComposer(true);
      startRecordingWave();
      startRecordingDurationTimer();
    } catch {
      cleanupRecorder();
      toast('Microphone permission denied or unavailable.', 'error');
    }
  }

  function stopVoiceRecording() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return cleanupRecorder();
    try { mediaRecorder.stop(); } catch { cleanupRecorder(); }
  }

  function deleteRecordingDraft() {
    recordingChunks = [];
    cleanupRecorder();
    toast('Voice recording deleted.', 'info');
  }

  function toggleRecordingPause() {
    if (!mediaRecorder) return;
    try {
      if (!recordingPaused && mediaRecorder.state === 'recording') {
        mediaRecorder.pause();
        recordingPaused = true;
        pausedAt = Date.now();
        if (els.voicePauseBtn) els.voicePauseBtn.textContent = '▶';
      } else if (recordingPaused && mediaRecorder.state === 'paused') {
        mediaRecorder.resume();
        recordingPaused = false;
        if (pausedAt) pausedMsTotal += Date.now() - pausedAt;
        pausedAt = 0;
        if (els.voicePauseBtn) els.voicePauseBtn.textContent = '⏸';
      }
    } catch {}
  }

  function cleanupRecorder() {
    clearActivityStatus();
    isRecording = false;
    recordingPaused = false;
    recordingStartTs = 0;
    pausedMsTotal = 0;
    pausedAt = 0;

    if (els.micBtn) {
      els.micBtn.textContent = '🎙';
      els.micBtn.classList.remove('recording');
    }

    showVoiceComposer(false);
    stopRecordingWave();
    stopRecordingDurationTimer();

    if (recordingStream) {
      recordingStream.getTracks().forEach((t) => t.stop());
      recordingStream = null;
    }

    recordingChunks = [];
    mediaRecorder = null;
  }

  function showVoiceComposer(show) {
    if (els.voiceComposer) els.voiceComposer.classList.toggle('hidden', !show);
    if (els.emojiBtn) els.emojiBtn.classList.toggle('hidden', show);
    if (els.fileBtn) els.fileBtn.classList.toggle('hidden', show);
    if (els.sendBtn) els.sendBtn.classList.toggle('hidden', show);
    if (els.messageInput) {
      els.messageInput.disabled = show;
      if (show) els.messageInput.blur();
    }
    if (els.voicePauseBtn) els.voicePauseBtn.textContent = '⏸';
  }

  function startRecordingDurationTimer() { updateVoiceTimer(); clearInterval(recordingDurationTimer); recordingDurationTimer = setInterval(updateVoiceTimer, 250); }
  function stopRecordingDurationTimer() { clearInterval(recordingDurationTimer); recordingDurationTimer = null; if (els.voiceTimer) els.voiceTimer.textContent = '0:00'; }
  function getRecordingDurationSec() { if (!recordingStartTs) return 0; const now = Date.now(); const pausedNow = recordingPaused && pausedAt ? now - pausedAt : 0; return Math.max(1, Math.floor((now - recordingStartTs - pausedMsTotal - pausedNow) / 1000)); }
  function updateVoiceTimer() { if (els.voiceTimer) { const s = getRecordingDurationSec(); els.voiceTimer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; } }
  function startRecordingWave() { if (!els.voiceWave) return; const frames = ['▁▃▅▇▅▃▁','▂▄▆█▆▄▂','▁▄▇█▇▄▁','▂▅▇▆▇▅▂']; let i = 0; els.voiceWave.textContent = frames[0]; clearInterval(recordingWaveTimer); recordingWaveTimer = setInterval(() => { if (recordingPaused) return; i = (i + 1) % frames.length; if (els.voiceWave) els.voiceWave.textContent = frames[i]; }, 220); }
  function stopRecordingWave() { clearInterval(recordingWaveTimer); recordingWaveTimer = null; if (els.voiceWave) els.voiceWave.textContent = ''; }

  function setActivityStatus(text) { if (!els.activityStatus) return; els.activityStatus.textContent = text; els.activityStatus.classList.remove('hidden'); }
  function clearActivityStatus() { if (!els.activityStatus) return; els.activityStatus.textContent = ''; els.activityStatus.classList.add('hidden'); }

  function startPresence() { heartbeat(); if (presenceTimer) clearInterval(presenceTimer); presenceTimer = setInterval(heartbeat, CONFIG.HEARTBEAT_MS); }
  function heartbeat() { if (!currentRoom) return; const payload = { tabId, room: currentRoom, user: currentName, ts: Date.now() }; safeSet(presenceKey(currentRoom, tabId), JSON.stringify(payload)); broadcast({ type: 'presence', payload }); updateOnlineCount(); }
  function cleanupPresence() { if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null; } if (!currentRoom) return; safeRemove(presenceKey(currentRoom, tabId)); try { if (roomChannel) roomChannel.close(); } catch {} roomChannel = null; }
  function onStorageUpdate(e) { if (!isChatPage || !e.key) return; if (e.key === messageKey(currentRoom) || e.key.startsWith(presencePrefix(currentRoom))) renderChat(); }

  function renderRoomQR() {
    if (!els.qrBox) return;
    if (typeof QRCode === 'undefined') {
      if (els.qrText) els.qrText.textContent = 'QR library not loaded';
      return;
    }
    const joinUrl = `${window.location.origin}${window.location.pathname.replace('chat.html', 'index.html')}?room=${encodeURIComponent(currentRoom)}`;
    els.qrBox.innerHTML = '';
    new QRCode(els.qrBox, { text: joinUrl, width: 104, height: 104, colorDark: '#08112b', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    if (els.qrText) els.qrText.textContent = 'Scan to join';
  }

  function renderChat() {
    if (!isChatPage || !els.messages) return;
    const messages = getMessages(currentRoom);
    els.messages.innerHTML = '';
    if (!messages.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No messages yet. Start the conversation.';
      els.messages.appendChild(empty);
      renderReplyPreview();
      updateOnlineCount();
      return;
    }

    messages.forEach((msg) => els.messages.appendChild(createMessageNode(msg)));
    els.messages.scrollTop = els.messages.scrollHeight;
    renderReplyPreview();
    updateOnlineCount();
  }

  function createMessageNode(msg) {
    const row = document.createElement('div');
    row.className = `message-row ${String(msg.senderId || '') === String(tabId) ? 'mine' : 'other'}`;

    const bubble = document.createElement('div');
    bubble.className = 'message';

    const meta = document.createElement('div');
    meta.className = 'message-meta';
    const name = document.createElement('span');
    name.className = 'message-name';
    name.textContent = msg.user || 'Guest';
    meta.appendChild(name);
    bubble.appendChild(meta);

    if (msg.type === 'file') {
      if (String(msg.fileType || '').startsWith('image/') && msg.dataUrl) {
        const img = document.createElement('img');
        img.className = 'chat-image';
        img.src = msg.dataUrl;
        bubble.appendChild(img);
      } else if (String(msg.fileType || '').startsWith('audio/') && msg.dataUrl) {
        const voice = document.createElement('div');
        voice.className = 'voice-msg';
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.src = msg.dataUrl;
        audio.className = 'chat-audio';
        const dur = document.createElement('div');
        dur.className = 'voice-duration';
        dur.textContent = `${msg.durationSec || 0}s`;
        voice.appendChild(audio);
        voice.appendChild(dur);
        bubble.appendChild(voice);
      } else {
        const link = document.createElement('a');
        link.className = 'file-link';
        link.href = msg.dataUrl || '#';
        link.download = msg.fileName || 'file';
        link.textContent = 'Download file';
        bubble.appendChild(link);
      }
    } else {
      const text = document.createElement('div');
      text.className = 'message-text';
      text.innerHTML = escapeHtml(msg.text || '');
      bubble.appendChild(text);
    }

    const footer = document.createElement('div');
    footer.className = 'message-footer';
    const time = document.createElement('span');
    time.className = 'message-time';
    time.textContent = formatTime(msg.ts);
    footer.appendChild(time);

    if (String(msg.senderId || '') === String(tabId)) {
      const tick = document.createElement('span');
      tick.className = 'tick ' + (getOnlineCount(currentRoom) > 1 ? 'seen' : 'delivered');
      tick.textContent = getOnlineCount(currentRoom) > 1 ? '✓✓' : '✓';
      footer.appendChild(tick);
    }

    bubble.appendChild(footer);
    row.addEventListener('click', () => { selectedMessageForReply = msg; if (els.floatingReplyBtn) els.floatingReplyBtn.classList.remove('hidden'); });
    row.appendChild(bubble);
    return row;
  }

  function setReplyTarget(msg) { currentReply = { id: msg.id, user: msg.user || 'Guest', text: msg.type === 'text' ? (msg.text || '') : (msg.fileName || msg.type || 'message'), type: msg.type || 'text' }; renderReplyPreview(); }
  function clearReplyTarget() { currentReply = null; selectedMessageForReply = null; renderReplyPreview(); }
  function renderReplyPreview() { if (!els.replyPreview) return; if (!currentReply) { els.replyPreview.classList.add('hidden'); if (els.floatingReplyBtn) els.floatingReplyBtn.classList.add('hidden'); return; } els.replyPreview.classList.remove('hidden'); if (els.replyPreviewName) els.replyPreviewName.textContent = currentReply.user; if (els.replyPreviewText) els.replyPreviewText.textContent = String(currentReply.text || '').slice(0, 80); }

  function clearChat() { if (!window.confirm('Clear all messages in this room?')) return; safeRemove(messageKey(currentRoom)); broadcast({ type: 'clear' }); clearReplyTarget(); renderChat(); }

  async function copyRoomCode() {
    try { await navigator.clipboard.writeText(currentRoom); toast('Room code copied.', 'success'); }
    catch { toast(`Room code: ${currentRoom}`, 'info'); }
  }

  function updateOnlineCount() { if (els.onlineCount) els.onlineCount.textContent = `Online: ${getOnlineCount(currentRoom)}`; }
  function getOnlineCount(room) {
    const now = Date.now();
    const prefix = presencePrefix(room);
    let count = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(prefix)) continue;
        const raw = safeGet(key);
        if (!raw) continue;
        try {
          const data = JSON.parse(raw);
          if (data && typeof data.ts === 'number' && now - data.ts <= CONFIG.PRESENCE_TTL_MS) count += 1;
          else safeRemove(key);
        } catch { safeRemove(key); }
      }
    } catch {}
    return Math.max(count, 1);
  }

  function ensureRoom(room, creatorName) { const rooms = getRooms(); if (!rooms[room]) { rooms[room] = { room, creator: creatorName || 'Guest', createdAt: Date.now() }; safeSet(CONFIG.ROOMS_KEY, JSON.stringify(rooms)); } }
  function getRooms() { const raw = safeGet(CONFIG.ROOMS_KEY); if (!raw) return {}; try { const parsed = JSON.parse(raw); return parsed && typeof parsed === 'object' ? parsed : {}; } catch { return {}; } }
  function generateRoomCode() { const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const rooms = getRooms(); for (let a = 0; a < 50; a++) { let code = ''; for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]; if (!rooms[code]) return code; } return `R${Date.now().toString(36).slice(-5).toUpperCase()}`; }
  function readName() { const name = cleanName(els.nameInput ? els.nameInput.value : safeGet(CONFIG.NAME_KEY)); if (!name) { toast('Please enter your name.', 'error'); focus(els.nameInput); return ''; } return name; }
  function cleanName(v) { return String(v || '').trim().replace(/\s+/g, ' ').slice(0, 32); }
  function normalizeRoom(v) { return String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12); }
  function formatTime(ts) { try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } }

  function broadcast(payload) { if (!roomChannel) return; try { roomChannel.postMessage(payload); } catch {} }
  function bindEnter(input, handler) { if (!input) return; input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); handler(); } }); }
  function q(s) { return document.querySelector(s); }
  function focus(el) { try { if (el && typeof el.focus === 'function') el.focus(); } catch {} }

  function toast(message, type = 'info') {
    const t = q('#toast');
    if (!t) return;
    t.textContent = message;
    t.dataset.type = type;
    t.style.opacity = '1';
    clearTimeout(t._hideTimer);
    t._hideTimer = setTimeout(() => { t.style.opacity = '0'; }, 2000);
  }

  function getTabId() {
    try {
      const existing = sessionStorage.getItem(CONFIG.TAB_ID_KEY);
      if (existing) return existing;
      const id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `tab_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(CONFIG.TAB_ID_KEY, id);
      return id;
    } catch {
      return `tab_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }
  }

  function makeId() { return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`; }
  function messageKey(room) { return `${CONFIG.MSG_PREFIX}${room}`; }
  function presenceKey(room, id = tabId) { return `${CONFIG.PRES_PREFIX}${room}_${id}`; }
  function presencePrefix(room) { return `${CONFIG.PRES_PREFIX}${room}_`; }
  function safeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function safeSet(key, value) { try { localStorage.setItem(key, String(value)); } catch {} }
  function safeRemove(key) { try { localStorage.removeItem(key); } catch {} }
  function getMessages(room) { const raw = safeGet(messageKey(room)); if (!raw) return []; try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; } }
  function saveMessages(room, messages) { safeSet(messageKey(room), JSON.stringify(messages)); }

  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('File read failed'));
      reader.readAsDataURL(file);
    });
  }

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Blob read failed'));
      reader.readAsDataURL(blob);
    });
  }

  function insertAtCaret(input, text) {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
    const next = start + text.length;
    input.setSelectionRange(next, next);
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
