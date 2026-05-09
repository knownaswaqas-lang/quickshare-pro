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
  const isChatPage = !!document.querySelector('#messages, #chatBox, #messageList');
  const tabId = getTabId();

  const els = {
    homeTitle: q('#homeTitle'),
    nameInput: q('#nameInput'),
    roomInput: q('#roomInput'),
    createRoomBtn: q('#createRoomBtn'),
    joinRoomBtn: q('#joinRoomBtn'),

    roomTitle: q('#roomTitle'),
    roomCodeBadge: q('#roomCodeBadge'),
    onlineCount: q('#onlineCount'),
    messages: q('#messages'),
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
    typingStatus: q('#typingStatus'),
    replyPreview: q('#replyPreview'),
    replyPreviewName: q('#replyPreviewName'),
    replyPreviewText: q('#replyPreviewText'),
    cancelReplyBtn: q('#cancelReplyBtn'),
    floatingReplyBtn: q('#floatingReplyBtn'),

    previewModal: q('#filePreviewModal'),
    previewTitle: q('#previewTitle'),
    previewBody: q('#previewBody'),
    previewCropBtn: q('#previewCropBtn'),
    previewDrawBtn: q('#previewDrawBtn'),
    previewResetBtn: q('#previewResetBtn'),
    previewCancelBtn: q('#previewCancelBtn'),
    previewSendBtn: q('#previewSendBtn'),
    previewCloseBtn: q('#previewCloseBtn')
  };

  let roomChannel = null;
  let presenceTimer = null;
  let typingTimer = null;

  let mediaRecorder = null;
  let recordingStream = null;
  let recordingChunks = [];
  let isRecording = false;
  let recordingWaveTimer = null;

  let currentReply = null;
  let selectedMessageForReply = null;

  let attachmentDraft = null;
  let previewCanvas = null;
  let previewCtx = null;
  let previewDrawMode = false;
  let previewPointerDown = false;

  const currentRoom = normalizeRoom(params.get('room') || safeGet(CONFIG.LAST_ROOM_KEY) || '');
  const currentName = cleanName(params.get('name') || safeGet(CONFIG.NAME_KEY) || '') || 'Guest';

  boot();
  window.addEventListener('beforeunload', cleanupPresence);
  window.addEventListener('storage', onStorageUpdate);

  function boot() {
    if (!isChatPage) {
      initLanding();
      return;
    }
    initChat();
  }

  function initLanding() {
    if (els.homeTitle) els.homeTitle.textContent = CONFIG.APP_NAME;
    const scannedRoom = normalizeRoom(params.get('room') || '');
    const isScanJoinMode = !!scannedRoom;

    if (els.nameInput) {
      els.nameInput.value = safeGet(CONFIG.NAME_KEY) || '';
      bindEnter(els.nameInput, isScanJoinMode ? handleJoinRoom : handleCreateRoom);
    }

    if (els.roomInput) {
      if (scannedRoom) {
        els.roomInput.value = scannedRoom;
        els.roomInput.readOnly = true;
      }
      bindEnter(els.roomInput, handleJoinRoom);
    }

    if (isScanJoinMode && els.createRoomBtn) {
      els.createRoomBtn.classList.add('hidden');
    }

    if (els.createRoomBtn) els.createRoomBtn.addEventListener('click', handleCreateRoom);
    if (els.joinRoomBtn) els.joinRoomBtn.addEventListener('click', handleJoinRoom);
  }

  function initChat() {
    if (!currentRoom) {
      toast('Room code missing. Redirecting back...', 'error');
      setTimeout(() => (window.location.href = 'index.html'), 900);
      return;
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
    setupAttachmentModal();
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

    if (els.leaveBtn) {
      els.leaveBtn.addEventListener('click', () => {
        cleanupPresence();
        window.location.href = 'index.html';
      });
    }

    if (els.clearChatBtn) els.clearChatBtn.addEventListener('click', clearChat);
    if (els.copyRoomBtn) els.copyRoomBtn.addEventListener('click', copyRoomCode);
  }

  function setupChannel() {
    const channelName = `${CONFIG.CHANNEL_PREFIX}${currentRoom}`;
    if ('BroadcastChannel' in window) {
      roomChannel = new BroadcastChannel(channelName);
      roomChannel.onmessage = (event) => {
        const payload = event.data || {};
        if (!payload || typeof payload !== 'object') return;
        if (payload.type === 'message' || payload.type === 'clear' || payload.type === 'presence') {
          renderChat();
        }
      };
    }
  }

  function setupEmojiPanel() {
    if (!els.emojiBtn || !els.emojiPanel || !els.messageInput) return;

    const emojis = [
      '😀','😁','😂','🤣','🙂','😉','😍','😘','😎','🤝','🙏','👍','🔥',
      '🎉','💯','✅','💡','📎','❤️','🤍','🚀','👏','🌟','😢','😴','💭'
    ];

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
    if (els.floatingReplyBtn) {
      els.floatingReplyBtn.addEventListener('click', () => {
        if (selectedMessageForReply) setReplyTarget(selectedMessageForReply);
      });
    }
  }

  function setupAttachmentModal() {
    if (!els.previewModal) return;

    if (els.previewSendBtn) els.previewSendBtn.addEventListener('click', sendAttachmentDraft);
    if (els.previewCancelBtn) els.previewCancelBtn.addEventListener('click', closeAttachmentModal);
    if (els.previewCloseBtn) els.previewCloseBtn.addEventListener('click', closeAttachmentModal);
    if (els.previewResetBtn) els.previewResetBtn.addEventListener('click', resetAttachmentPreview);
    if (els.previewCropBtn) els.previewCropBtn.addEventListener('click', cropAttachmentPreview);
    if (els.previewDrawBtn) els.previewDrawBtn.addEventListener('click', togglePreviewDrawMode);

    els.previewModal.addEventListener('click', (e) => {
      if (e.target === els.previewModal) closeAttachmentModal();
    });
  }

  function setupMic() {
    if (!els.micBtn) return;
    let holdActive = false;
    let holdStartedAt = 0;

    const startHold = async () => {
      holdActive = true;
      holdStartedAt = Date.now();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
        toast('Voice recording is not supported in this browser.', 'error');
        return;
      }

      try {
        recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recordingChunks = [];
        mediaRecorder = new MediaRecorder(recordingStream);

        mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) recordingChunks.push(event.data);
        };

        mediaRecorder.onstop = async () => {
          try {
            const blob = new Blob(recordingChunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
            const dataUrl = await blobToDataURL(blob);

            sendMessage({
              type: 'file',
              fileName: `voice_${Date.now()}.webm`,
              fileType: blob.type || 'audio/webm',
              fileSize: blob.size,
              dataUrl
            });

            toast('Voice message sent.', 'success');
          } catch {
            toast('Voice message failed.', 'error');
          } finally {
            cleanupRecorder();
          }
        };

        mediaRecorder.start();
        isRecording = true;
        els.micBtn.textContent = '●';
        els.micBtn.classList.add('recording');
        startRecordingWave();
      } catch {
        cleanupRecorder();
        toast('Microphone permission denied or unavailable.', 'error');
      }
    };

    const stopHold = () => {
      holdActive = false;
      if (!isRecording) return;
      if (Date.now() - holdStartedAt < 500) {
        cleanupRecorder();
        toast('Hold mic to record voice.', 'info');
        return;
      }
      stopVoiceRecording();
    };

    els.micBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      startHold();
    });
    els.micBtn.addEventListener('pointerup', stopHold);
    els.micBtn.addEventListener('pointercancel', stopHold);
    els.micBtn.addEventListener('pointerleave', () => {
      if (holdActive) stopHold();
    });
  }

  function stopVoiceRecording() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      cleanupRecorder();
      return;
    }
    try {
      mediaRecorder.stop();
    } catch {
      cleanupRecorder();
    }
  }

  function cleanupRecorder() {
    isRecording = false;
    if (els.micBtn) {
      els.micBtn.textContent = '🎙';
      els.micBtn.classList.remove('recording');
    }
    stopRecordingWave();

    if (recordingStream) {
      recordingStream.getTracks().forEach((t) => t.stop());
      recordingStream = null;
    }

    recordingChunks = [];
    mediaRecorder = null;
  }

  function onTyping() {
    if (!els.typingStatus) return;
    els.typingStatus.textContent = 'Typing...';
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      if (els.typingStatus) els.typingStatus.textContent = '';
    }, 800);
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
      focus(els.roomInput);
      return;
    }

    ensureRoom(room, name);

    safeSet(CONFIG.NAME_KEY, name);
    safeSet(CONFIG.LAST_ROOM_KEY, room);
    window.location.href = `chat.html?room=${encodeURIComponent(room)}&name=${encodeURIComponent(name)}`;
  }

  function sendTextMessage() {
    if (!els.messageInput) return;
    const text = els.messageInput.value.trim();
    if (!text) {
      toast('Type a message first.', 'error');
      return;
    }

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
      replyTo: currentReply ? {
        id: currentReply.id,
        user: currentReply.user,
        text: currentReply.text,
        type: currentReply.type
      } : null,
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

    if (String(file.type || '').startsWith('image/')) {
      openImageAttachmentPreview(file);
    } else {
      openSimpleFileAttachmentPreview(file);
    }

    els.fileInput.value = '';
  }

  function openSimpleFileAttachmentPreview(file) {
    fileToDataURL(file)
      .then((dataUrl) => {
        attachmentDraft = { kind: 'file', file, dataUrl };

        if (els.previewTitle) els.previewTitle.textContent = `Preview: ${file.name}`;
        if (els.previewBody) {
          els.previewBody.innerHTML = '';
          const info = document.createElement('div');
          info.className = 'file-preview-info';
          info.innerHTML = `
            <div style="font-weight:700;margin-bottom:8px;">${escapeHtml(file.name)}</div>
            <div style="opacity:.8;margin-bottom:10px;">${escapeHtml(file.type || 'file')} • ${formatSize(file.size)}</div>
            <a class="file-link" href="${dataUrl}" download="${escapeHtmlAttr(file.name)}">Open file</a>
          `;
          els.previewBody.appendChild(info);
        }

        setPreviewButtonsVisibility(false);
        openAttachmentModal();
      })
      .catch(() => toast('File could not be read.', 'error'));
  }

  function openImageAttachmentPreview(file) {
    fileToDataURL(file)
      .then((dataUrl) => {
        const img = new Image();
        img.onload = () => {
          attachmentDraft = {
            kind: 'image',
            file,
            originalDataUrl: dataUrl,
            image: img,
            mime: file.type || 'image/png'
          };

          if (els.previewTitle) els.previewTitle.textContent = `Edit: ${file.name}`;
          if (els.previewBody) {
            els.previewBody.innerHTML = '';
            previewCanvas = document.createElement('canvas');
            previewCanvas.id = 'previewCanvas';
            previewCanvas.width = 960;
            previewCanvas.height = 620;
            previewCanvas.style.maxWidth = '100%';
            previewCanvas.style.width = '100%';
            previewCanvas.style.height = 'auto';
            previewCanvas.style.borderRadius = '18px';
            previewCanvas.style.background = '#0b1224';
            previewCtx = previewCanvas.getContext('2d');
            els.previewBody.appendChild(previewCanvas);
            bindCanvasDrawing(previewCanvas);
            drawImageContain(attachmentDraft.image);
          }

          setPreviewButtonsVisibility(true);
          openAttachmentModal();
        };
        img.onerror = () => toast('Image preview could not load.', 'error');
        img.src = dataUrl;
      })
      .catch(() => toast('Image could not be read.', 'error'));
  }

  function openAttachmentModal() {
    if (!els.previewModal) return;
    els.previewModal.classList.remove('hidden');
    els.previewModal.setAttribute('aria-hidden', 'false');
  }

  function closeAttachmentModal() {
    if (!els.previewModal) return;
    els.previewModal.classList.add('hidden');
    els.previewModal.setAttribute('aria-hidden', 'true');
    attachmentDraft = null;
    previewCanvas = null;
    previewCtx = null;
    previewDrawMode = false;
    previewPointerDown = false;
  }

  function sendAttachmentDraft() {
    if (!attachmentDraft) return;

    if (attachmentDraft.kind === 'image' && previewCanvas) {
      const dataUrl = previewCanvas.toDataURL(attachmentDraft.mime || 'image/png');
      sendMessage({
        type: 'file',
        fileName: attachmentDraft.file.name,
        fileType: attachmentDraft.mime || 'image/png',
        fileSize: dataUrl.length,
        dataUrl
      });
      toast('Image sent.', 'success');
      closeAttachmentModal();
      return;
    }

    if (attachmentDraft.kind === 'file') {
      sendMessage({
        type: 'file',
        fileName: attachmentDraft.file.name,
        fileType: attachmentDraft.file.type || 'application/octet-stream',
        fileSize: attachmentDraft.file.size,
        dataUrl: attachmentDraft.dataUrl
      });
      toast('File sent.', 'success');
      closeAttachmentModal();
    }
  }

  function resetAttachmentPreview() {
    if (!attachmentDraft || attachmentDraft.kind !== 'image' || !previewCanvas || !previewCtx) return;
    previewDrawMode = false;
    if (els.previewDrawBtn) els.previewDrawBtn.textContent = 'Pencil';
    drawImageContain(attachmentDraft.image);
  }

  function cropAttachmentPreview() {
    if (!attachmentDraft || attachmentDraft.kind !== 'image' || !previewCanvas || !previewCtx) return;
    previewDrawMode = false;
    if (els.previewDrawBtn) els.previewDrawBtn.textContent = 'Pencil';
    drawImageSquareCrop(attachmentDraft.image);
  }

  function togglePreviewDrawMode() {
    if (!attachmentDraft || attachmentDraft.kind !== 'image') return;
    previewDrawMode = !previewDrawMode;
    if (els.previewDrawBtn) els.previewDrawBtn.textContent = previewDrawMode ? 'Drawing...' : 'Pencil';
    toast(previewDrawMode ? 'Draw on image now.' : 'Pencil mode off.', 'info');
  }

  function bindCanvasDrawing(canvas) {
    canvas.onpointerdown = (e) => {
      if (!previewDrawMode || !previewCtx) return;
      previewPointerDown = true;
      canvas.setPointerCapture?.(e.pointerId);
      const { x, y } = getCanvasPoint(canvas, e);
      previewCtx.beginPath();
      previewCtx.moveTo(x, y);
    };

    canvas.onpointermove = (e) => {
      if (!previewDrawMode || !previewPointerDown || !previewCtx) return;
      const { x, y } = getCanvasPoint(canvas, e);
      previewCtx.lineTo(x, y);
      previewCtx.strokeStyle = '#ff3b30';
      previewCtx.lineWidth = 6;
      previewCtx.lineCap = 'round';
      previewCtx.lineJoin = 'round';
      previewCtx.stroke();
    };

    const stop = () => { previewPointerDown = false; };
    canvas.onpointerup = stop;
    canvas.onpointerleave = stop;
    canvas.onpointercancel = stop;
  }

  function drawImageContain(img) {
    if (!previewCanvas || !previewCtx) return;
    const canvas = previewCanvas;
    const ctx = previewCtx;

    canvas.width = 960;
    canvas.height = 620;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0b1224';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const ratio = Math.min(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
    const w = img.naturalWidth * ratio;
    const h = img.naturalHeight * ratio;
    const x = (canvas.width - w) / 2;
    const y = (canvas.height - h) / 2;
    ctx.drawImage(img, x, y, w, h);
  }

  function drawImageSquareCrop(img) {
    if (!previewCanvas || !previewCtx) return;
    const canvas = previewCanvas;
    const ctx = previewCtx;
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;

    canvas.width = 900;
    canvas.height = 900;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0b1224';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, sx, sy, side, side, 0, 0, canvas.width, canvas.height);
  }

  function setPreviewButtonsVisibility(isImage) {
    if (els.previewCropBtn) els.previewCropBtn.classList.toggle('hidden', !isImage);
    if (els.previewDrawBtn) els.previewDrawBtn.classList.toggle('hidden', !isImage);
    if (els.previewResetBtn) els.previewResetBtn.classList.toggle('hidden', !isImage);
  }

  function startPresence() {
    heartbeat();
    if (presenceTimer) clearInterval(presenceTimer);
    presenceTimer = setInterval(heartbeat, CONFIG.HEARTBEAT_MS);
  }

  function heartbeat() {
    if (!currentRoom) return;
    const key = presenceKey(currentRoom, tabId);
    const payload = { tabId, room: currentRoom, user: currentName, ts: Date.now() };
    safeSet(key, JSON.stringify(payload));
    broadcast({ type: 'presence', payload });
    updateOnlineCount();
  }

  function cleanupPresence() {
    if (presenceTimer) {
      clearInterval(presenceTimer);
      presenceTimer = null;
    }

    if (!currentRoom) return;
    safeRemove(presenceKey(currentRoom, tabId));

    try {
      if (roomChannel) roomChannel.close();
    } catch {}
    roomChannel = null;
  }

  function onStorageUpdate(e) {
    if (!isChatPage || !e.key) return;
    if (e.key === messageKey(currentRoom) || e.key.startsWith(presencePrefix(currentRoom))) {
      renderChat();
    }
  }


  function renderRoomQR() {
  if (!els.qrBox) return;
  if (typeof QRCode === 'undefined') {
    if (els.qrText) els.qrText.textContent = 'QR library not loaded';
    return;
  }

  const joinUrl = `${window.location.origin}${window.location.pathname.replace('chat.html', 'index.html')}?room=${encodeURIComponent(currentRoom)}`;
  els.qrBox.innerHTML = '';

  new QRCode(els.qrBox, {
    text: joinUrl,
    width: 104,
    height: 104,
    colorDark: '#08112b',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M
  });

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
      updateOnlineCount();
      renderReplyPreview();
      return;
    }

    for (const msg of messages) {
      els.messages.appendChild(createMessageNode(msg));
    }

    els.messages.scrollTop = els.messages.scrollHeight;
    updateOnlineCount();
    renderReplyPreview();
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

    if (msg.replyTo) {
      const reply = document.createElement('div');
      reply.className = 'quoted-reply';

      const rName = document.createElement('div');
      rName.className = 'quoted-name';
      rName.textContent = msg.replyTo.user || 'You';

      const rText = document.createElement('div');
      rText.className = 'quoted-text';
      rText.textContent = replyPreviewText(msg.replyTo);

      reply.appendChild(rName);
      reply.appendChild(rText);
      bubble.appendChild(reply);
    }

    if (msg.type === 'file') {
      const fileLine = document.createElement('div');
      fileLine.className = 'file-line';
      fileLine.textContent = `📎 ${msg.fileName || 'file'}`;
      bubble.appendChild(fileLine);

      if (String(msg.fileType || '').startsWith('image/') && msg.dataUrl) {
        const img = document.createElement('img');
        img.className = 'chat-image';
        img.src = msg.dataUrl;
        img.alt = msg.fileName || 'image';
        img.addEventListener('click', () => window.open(msg.dataUrl, '_blank'));
        bubble.appendChild(img);
      } else if (String(msg.fileType || '').startsWith('audio/') && msg.dataUrl) {
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.src = msg.dataUrl;
        audio.className = 'chat-audio';
        bubble.appendChild(audio);
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

    row.addEventListener('click', () => {
      selectedMessageForReply = msg;
      if (els.floatingReplyBtn) els.floatingReplyBtn.classList.remove('hidden');
    });

    row.appendChild(bubble);
    return row;
  }

  function setReplyTarget(msg) {
    currentReply = {
      id: msg.id,
      user: msg.user || 'Guest',
      text: msg.type === 'text' ? (msg.text || '') : (msg.fileName || msg.type || 'message'),
      type: msg.type || 'text'
    };
    renderReplyPreview();
  }

  function clearReplyTarget() {
    currentReply = null;
    selectedMessageForReply = null;
    renderReplyPreview();
  }

  function startRecordingWave() {
    if (!els.typingStatus) return;
    const frames = ['▁▃▅▇▅▃▁', '▂▄▆█▆▄▂', '▁▄▇█▇▄▁', '▂▅▇▆▇▅▂'];
    let i = 0;
    els.typingStatus.textContent = `Recording ${frames[0]}`;
    clearInterval(recordingWaveTimer);
    recordingWaveTimer = setInterval(() => {
      i = (i + 1) % frames.length;
      if (els.typingStatus) els.typingStatus.textContent = `Recording ${frames[i]}`;
    }, 220);
  }

  function stopRecordingWave() {
    clearInterval(recordingWaveTimer);
    recordingWaveTimer = null;
    if (els.typingStatus && els.typingStatus.textContent.startsWith('Recording')) {
      els.typingStatus.textContent = '';
    }
  }

  function renderReplyPreview() {
    if (!els.replyPreview) return;

    if (!currentReply) {
      els.replyPreview.classList.add('hidden');
      if (els.floatingReplyBtn) els.floatingReplyBtn.classList.add('hidden');
      return;
    }

    els.replyPreview.classList.remove('hidden');
    if (els.replyPreviewName) els.replyPreviewName.textContent = currentReply.user;
    if (els.replyPreviewText) els.replyPreviewText.textContent = replyPreviewText(currentReply);
  }

  function replyPreviewText(reply) {
    return String(reply?.text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'Attachment';
  }

  function updateOnlineCount() {
    if (!els.onlineCount) return;
    els.onlineCount.textContent = `Online: ${getOnlineCount(currentRoom)}`;
  }

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
          if (data && typeof data.ts === 'number' && now - data.ts <= CONFIG.PRESENCE_TTL_MS) {
            count += 1;
          } else {
            safeRemove(key);
          }
        } catch {
          safeRemove(key);
        }
      }
    } catch {}

    return Math.max(count, 1);
  }

  function getMessages(room) {
    const raw = safeGet(messageKey(room));
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveMessages(room, messages) {
    safeSet(messageKey(room), JSON.stringify(messages));
  }

  function clearChat() {
    if (!window.confirm('Clear all messages in this room?')) return;
    safeRemove(messageKey(currentRoom));
    broadcast({ type: 'clear' });
    clearReplyTarget();
    renderChat();
    toast('Chat cleared.', 'success');
  }

  async function copyRoomCode() {
    try {
      await navigator.clipboard.writeText(currentRoom);
      toast('Room code copied.', 'success');
    } catch {
      toast(`Room code: ${currentRoom}`, 'info');
    }
  }

  function roomExists(room) {
    const rooms = getRooms();
    return !!rooms[room];
  }

  function ensureRoom(room, creatorName) {
    const rooms = getRooms();
    if (!rooms[room]) {
      rooms[room] = {
        room,
        creator: creatorName || 'Guest',
        createdAt: Date.now()
      };
      safeSet(CONFIG.ROOMS_KEY, JSON.stringify(rooms));
    }
  }

  function getRooms() {
    const raw = safeGet(CONFIG.ROOMS_KEY);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const rooms = getRooms();

    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
      if (!rooms[code]) return code;
    }

    return `R${Date.now().toString(36).slice(-5).toUpperCase()}`;
  }

  function readName() {
    const name = cleanName(els.nameInput ? els.nameInput.value : safeGet(CONFIG.NAME_KEY));
    if (!name) {
      toast('Please enter your name.', 'error');
      focus(els.nameInput);
      return '';
    }
    return name;
  }

  function cleanName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 32);
  }

  function normalizeRoom(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  }

  function formatTime(ts) {
    try {
      return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  function formatSize(bytes) {
    if (bytes == null) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function broadcast(payload) {
    if (!roomChannel) return;
    try {
      roomChannel.postMessage(payload);
    } catch {}
  }

  function insertAtCaret(input, text) {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
    const next = start + text.length;
    input.setSelectionRange(next, next);
  }

  function bindEnter(input, handler) {
    if (!input) return;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handler();
      }
    });
  }

  function q(selector) {
    return document.querySelector(selector);
  }

  function focus(el) {
    try {
      if (el && typeof el.focus === 'function') el.focus();
    } catch {}
  }

  function toast(message, type = 'info') {
    const toastEl = q('#toast');
    if (!toastEl) {
      if (type === 'error') console.error(message);
      else console.log(message);
      return;
    }

    toastEl.textContent = message;
    toastEl.dataset.type = type;
    toastEl.style.opacity = '1';
    toastEl.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(toastEl._hideTimer);
    toastEl._hideTimer = setTimeout(() => {
      toastEl.style.opacity = '0';
      toastEl.style.transform = 'translateX(-50%) translateY(10px)';
    }, 2500);
  }

  function getTabId() {
    try {
      const existing = sessionStorage.getItem(CONFIG.TAB_ID_KEY);
      if (existing) return existing;

      const id = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : `tab_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

      sessionStorage.setItem(CONFIG.TAB_ID_KEY, id);
      return id;
    } catch {
      return `tab_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }
  }

  function makeId() {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function messageKey(room) {
    return `${CONFIG.MSG_PREFIX}${room}`;
  }

  function presenceKey(room, id = tabId) {
    return `${CONFIG.PRES_PREFIX}${room}_${id}`;
  }

  function presencePrefix(room) {
    return `${CONFIG.PRES_PREFIX}${room}_`;
  }

  function safeGet(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (err) {
      toast('Storage is blocked or full. Try a different browser.', 'error');
      console.error(err);
    }
  }

  function safeRemove(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  }

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

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeHtmlAttr(text) {
    return escapeHtml(text).replace(/`/g, '&#96;');
  }

  function getCanvasPoint(canvas, e) {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  }
})();
