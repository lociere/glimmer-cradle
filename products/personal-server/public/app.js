const state = {
  socket: null,
  reconnectTimer: null,
  readinessTimer: null,
  connected: false,
  view: 'conversation',
  product: null,
  messages: loadMessages(),
  runtimes: [],
  extensions: [],
  extensionInstallations: [],
  extensionSelectedVersions: {},
  extensionPreview: null,
};

const elements = Object.fromEntries([
  'login-layer', 'login-form', 'access-token', 'login-message', 'app-shell',
  'connection-dot', 'connection-label', 'pane-status-dot', 'pane-status-label',
  'inspector-dot', 'inspector-connection', 'conversation-view', 'system-view', 'extensions-view',
  'title-section', 'title-page', 'pane-eyebrow', 'pane-title', 'message-list',
  'empty-state', 'thinking-state', 'composer-form', 'message-input', 'send-button',
  'clear-button', 'refresh-button', 'logout-button', 'ready-summary', 'ready-time',
  'runtime-list', 'tts-section', 'tts-state', 'asr-section', 'asr-state', 'product-name',
  'extension-refresh-button',
  'extension-install-form', 'extension-source-kind', 'extension-primary-label',
  'extension-primary-input', 'extension-secondary-label', 'extension-secondary-input',
  'extension-channel-label', 'extension-channel-input', 'extension-install-message',
  'extension-preview', 'extension-preview-name', 'extension-preview-trust',
  'extension-preview-details', 'extension-cancel-button', 'extension-commit-button',
  'extension-list',
].map((id) => [id, document.getElementById(id)]));

void initialize();

async function initialize() {
  bindEvents();
  const response = await fetch('/api/v1/session', { cache: 'no-store' });
  const session = await response.json();
  if (!session.authenticated) {
    showLogin();
    return;
  }
  await showApp();
}

function bindEvents() {
  elements['login-form'].addEventListener('submit', (event) => {
    event.preventDefault();
    void login();
  });
  elements['composer-form'].addEventListener('submit', (event) => {
    event.preventDefault();
    sendMessage();
  });
  elements['message-input'].addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
  elements['message-input'].addEventListener('input', resizeComposer);
  elements['clear-button'].addEventListener('click', () => {
    state.messages = [];
    persistMessages();
    renderMessages();
  });
  elements['refresh-button'].addEventListener('click', () => void refreshReadiness());
  elements['extension-refresh-button'].addEventListener('click', requestExtensionProjection);
  elements['extension-source-kind'].addEventListener('change', updateExtensionSourceFields);
  elements['extension-install-form'].addEventListener('submit', (event) => {
    event.preventDefault();
    prepareExtensionInstall();
  });
  elements['extension-cancel-button'].addEventListener('click', cancelExtensionInstall);
  elements['extension-commit-button'].addEventListener('click', commitExtensionInstall);
  elements['logout-button'].addEventListener('click', () => void logout());
  for (const button of document.querySelectorAll('[data-view]')) {
    button.addEventListener('click', () => switchView(button.dataset.view));
  }
  updateExtensionSourceFields();
}

async function login() {
  elements['login-message'].textContent = '';
  const token = elements['access-token'].value;
  const response = await fetch('/api/v1/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  elements['access-token'].value = '';
  if (!response.ok) {
    elements['login-message'].textContent = response.status === 429
      ? '尝试次数过多，请稍后再试。'
      : '访问令牌不正确。';
    return;
  }
  await showApp();
}

async function logout() {
  await fetch('/api/v1/session', { method: 'DELETE' });
  showLogin();
}

function showLogin() {
  clearTimeout(state.reconnectTimer);
  clearTimeout(state.readinessTimer);
  state.socket?.close();
  state.socket = null;
  elements['app-shell'].hidden = true;
  elements['login-layer'].hidden = false;
  setTimeout(() => elements['access-token'].focus(), 0);
}

async function showApp() {
  elements['login-layer'].hidden = true;
  elements['app-shell'].hidden = false;
  await refreshProduct();
  renderMessages();
  setConnection('waiting');
  void refreshReadiness(true);
}

async function refreshProduct() {
  try {
    const response = await fetch('/api/v1/product', { cache: 'no-store' });
    if (!response.ok) throw new Error(`product_${response.status}`);
    state.product = await response.json();
  } catch {
    // Optional surfaces stay hidden when the product projection cannot be verified.
    state.product = {
      display_name: 'Glimmer Cradle Personal Server',
      features: { audio: { tts: false, asr: false }, extensions: false },
    };
  }
  applyProductProjection();
}

function applyProductProjection() {
  const features = state.product?.features || {};
  const audio = features.audio || {};
  elements['tts-section'].hidden = audio.tts !== true;
  elements['asr-section'].hidden = audio.asr !== true;
  for (const element of document.querySelectorAll('[data-product-feature="extensions"]')) {
    element.hidden = features.extensions !== true;
  }
  elements['product-name'].textContent = state.product?.display_name || 'Personal Server';
  if (features.extensions !== true && state.view === 'extensions') switchView('conversation');
}

function connectSurface() {
  clearTimeout(state.reconnectTimer);
  if (state.socket?.readyState === WebSocket.OPEN || state.socket?.readyState === WebSocket.CONNECTING) return;
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${scheme}//${location.host}/api/v1/surface`);
  state.socket = socket;
  setConnection('connecting');
  socket.addEventListener('open', () => setConnection('online'));
  socket.addEventListener('message', (event) => handleFrame(event.data));
  socket.addEventListener('close', () => {
    if (state.socket !== socket) return;
    state.socket = null;
    setConnection('waiting');
    scheduleReadiness(1000);
  });
  socket.addEventListener('error', () => socket.close());
}

function handleFrame(raw) {
  let frame;
  try { frame = JSON.parse(raw); } catch { return; }
  if (frame.kind === 'reply') {
    const text = frame.reply?.text || frame.reply?.messages?.map((item) => item.text).filter(Boolean).join('\n') || '';
    if (text) appendMessage('assistant', text, frame.trace_id || '');
    elements['thinking-state'].hidden = true;
  } else if (frame.kind === 'thought') {
    elements['thinking-state'].hidden = !frame.thought?.active;
  } else if (frame.kind === 'runtime_readiness') {
    state.runtimes = frame.runtime_readiness?.runtimes || [];
    renderRuntimes();
  } else if (frame.kind === 'audio_status') {
    renderAudioStatus(frame.audio_status || {});
  } else if (frame.kind === 'extension_install_preview') {
    handleExtensionInstallPreview(frame.extension_install_preview || {});
  } else if (frame.kind === 'extension_install_result') {
    handleExtensionInstallResult(frame.extension_install_result || {});
  } else if (frame.kind === 'extension_uninstall_result') {
    handleExtensionUninstallResult(frame.extension_uninstall_result || {});
  } else if (frame.kind === 'extension_lifecycle_result') {
    handleExtensionLifecycleResult(frame.extension_lifecycle_result || {});
  } else if (frame.kind === 'extension_runtime_projection_result') {
    const result = frame.extension_runtime_projection_result || {};
    setExtensionProjections(result.projections, result.installations);
  } else if (frame.kind === 'extension_runtime_projection_changed') {
    mergeExtensionProjection(frame.extension_runtime_projection_changed);
  }
}

function sendSurfaceFrame(frame) {
  if (state.socket?.readyState !== WebSocket.OPEN) {
    setExtensionMessage('服务尚未连接。', true);
    return false;
  }
  state.socket.send(JSON.stringify({ timestamp: Date.now(), ...frame }));
  return true;
}

function sendMessage() {
  const text = elements['message-input'].value.trim();
  if (!text || state.socket?.readyState !== WebSocket.OPEN) return;
  state.socket.send(JSON.stringify({
    kind: 'chat_input',
    timestamp: Date.now(),
    chat_input: { text },
  }));
  appendMessage('user', text, '');
  elements['message-input'].value = '';
  resizeComposer();
  elements['thinking-state'].hidden = false;
}

function appendMessage(role, text, traceId) {
  state.messages.push({ role, text, traceId, timestamp: Date.now() });
  state.messages = state.messages.slice(-100);
  persistMessages();
  renderMessages();
}

function renderMessages() {
  elements['message-list'].replaceChildren();
  if (state.messages.length === 0) {
    elements['message-list'].append(elements['empty-state']);
    elements['empty-state'].hidden = false;
    return;
  }
  elements['empty-state'].hidden = true;
  for (const item of state.messages) {
    const row = document.createElement('div');
    row.className = `message ${item.role}`;
    const content = document.createElement('article');
    content.textContent = item.text;
    const time = document.createElement('time');
    time.textContent = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    content.append(time);
    row.append(content);
    elements['message-list'].append(row);
  }
  elements['message-list'].scrollTop = elements['message-list'].scrollHeight;
}

async function refreshReadiness(connectWhenReady = false) {
  clearTimeout(state.readinessTimer);
  const response = await fetch('/api/v1/status', { cache: 'no-store' });
  if (response.status === 401) {
    showLogin();
    return;
  }
  const readiness = await response.json();
  elements['ready-summary'].textContent = readiness.ready ? '基础服务已就绪' : readiness.summary || '尚未就绪';
  elements['ready-time'].textContent = new Date().toLocaleTimeString();
  if (readiness.ready && (connectWhenReady || !state.socket)) connectSurface();
  if (!readiness.ready && state.socket?.readyState !== WebSocket.OPEN) setConnection('waiting');
  scheduleReadiness(readiness.ready ? 5000 : 1500);
}

function scheduleReadiness(delayMs) {
  clearTimeout(state.readinessTimer);
  state.readinessTimer = setTimeout(() => void refreshReadiness(true), delayMs);
}

function renderRuntimes() {
  elements['runtime-list'].replaceChildren();
  for (const runtime of state.runtimes) {
    const row = document.createElement('div');
    row.className = 'runtime-item';
    const identity = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = runtime.runtime_id;
    const phase = document.createElement('p');
    phase.textContent = runtime.phase || runtime.owner || '';
    identity.append(name, phase);
    const summary = document.createElement('div');
    summary.textContent = runtime.summary || '';
    const badge = document.createElement('span');
    badge.className = `runtime-badge ${runtime.state === 'ready' || runtime.state === 'stopped' ? '' : runtime.state === 'failed' ? 'error' : 'warn'}`;
    badge.textContent = runtime.state === 'stopped' ? '未启用' : runtime.state;
    row.append(identity, summary, badge);
    elements['runtime-list'].append(row);
  }
}

function renderAudioStatus(status) {
  if (!elements['tts-section'].hidden) elements['tts-state'].textContent = audioLaneLabel(status.tts);
  if (!elements['asr-section'].hidden) elements['asr-state'].textContent = audioLaneLabel(status.asr);
}

function updateExtensionSourceFields() {
  const kind = elements['extension-source-kind'].value;
  const primary = {
    registry: ['目录地址', 'https://.../catalog.json', 'url'],
    repository: ['仓库地址', 'https://github.com/publisher/extension', 'url'],
    release_manifest: ['发布清单地址', 'https://.../release-manifest.json', 'url'],
  }[kind];
  const secondary = {
    registry: ['扩展 ID', 'publisher.extension'],
    repository: ['精确版本标签', 'v1.0.0'],
  }[kind];
  elements['extension-primary-label'].firstChild.textContent = primary[0];
  elements['extension-primary-input'].placeholder = primary[1];
  elements['extension-primary-input'].type = primary[2];
  elements['extension-secondary-label'].hidden = !secondary;
  elements['extension-secondary-input'].required = Boolean(secondary);
  if (secondary) {
    elements['extension-secondary-label'].firstChild.textContent = secondary[0];
    elements['extension-secondary-input'].placeholder = secondary[1];
  }
  elements['extension-channel-label'].hidden = kind !== 'registry';
}

function prepareExtensionInstall() {
  const kind = elements['extension-source-kind'].value;
  const primary = elements['extension-primary-input'].value.trim();
  const secondary = elements['extension-secondary-input'].value.trim();
  const requestId = createRequestId('extension-install-prepare');
  let source;
  if (kind === 'registry') {
    source = { kind, catalog_url: primary, extension_id: secondary, channel: elements['extension-channel-input'].value };
  } else if (kind === 'repository') {
    source = { kind, repository: primary, tag: secondary };
  } else {
    source = { kind: 'release_manifest', url: primary };
  }
  if (!sendSurfaceFrame({ kind: 'extension_install_prepare', extension_install_prepare: { request_id: requestId, source } })) return;
  state.extensionPreview = null;
  elements['extension-preview'].hidden = true;
  setExtensionMessage('正在下载并验证发布信息…');
}

function handleExtensionInstallPreview(preview) {
  if (preview.status !== 'ready' || !preview.transaction_id || !preview.extension) {
    state.extensionPreview = null;
    elements['extension-preview'].hidden = true;
    setExtensionMessage(preview.message || '无法验证扩展发布。', true);
    return;
  }
  state.extensionPreview = preview;
  const extension = preview.extension;
  const trust = preview.trust || {};
  elements['extension-preview-name'].textContent = `${extension.name} · ${extension.id}@${extension.version}`;
  elements['extension-preview-trust'].textContent = trust.listing_reviewed
    ? '来源目录已经审核；安装包仍由本机完成摘要与结构校验。'
    : '该来源未经摇篮审核，请只安装你信任的发布者提供的包。';
  elements['extension-preview-details'].replaceChildren(
    detailRow('发布者', extension.publisher),
    detailRow('权限', extension.permissions.length ? extension.permissions.join('、') : '无额外权限'),
    detailRow('产品', extension.products?.join('、') || 'any'),
    detailRow('平台', extension.platforms.join('、')),
    detailRow('SHA-256', preview.artifact?.sha256 || '未知'),
    detailRow('签名', trust.artifact_signed ? '已验证' : '未验证'),
    detailRow('构建证明', trust.build_attested ? '已验证' : '未验证'),
  );
  elements['extension-preview'].hidden = false;
  setExtensionMessage('检查完成，请核对权限和信任信息。');
}

function commitExtensionInstall() {
  const preview = state.extensionPreview;
  if (!preview?.transaction_id) return;
  elements['extension-commit-button'].disabled = true;
  sendSurfaceFrame({
    kind: 'extension_install_commit',
    extension_install_commit: {
      request_id: createRequestId('extension-install-commit'),
      transaction_id: preview.transaction_id,
      approved_permissions: [...preview.extension.permissions],
    },
  });
  setExtensionMessage('正在重新校验并安装…');
}

function cancelExtensionInstall() {
  const transactionId = state.extensionPreview?.transaction_id;
  if (transactionId) {
    sendSurfaceFrame({
      kind: 'extension_install_cancel',
      extension_install_cancel: { request_id: createRequestId('extension-install-cancel'), transaction_id: transactionId },
    });
  }
  clearExtensionPreview();
  setExtensionMessage('已取消安装。');
}

function handleExtensionInstallResult(result) {
  elements['extension-commit-button'].disabled = false;
  if (result.status === 'success') {
    setExtensionMessage(`${result.extension_id}@${result.version} 已安装。`);
    clearExtensionPreview();
    requestExtensionProjection();
    return;
  }
  if (result.status === 'cancelled') {
    clearExtensionPreview();
    setExtensionMessage('已取消安装。');
    return;
  }
  setExtensionMessage(result.message || '扩展安装失败。', true);
}

function requestExtensionProjection() {
  sendSurfaceFrame({
    kind: 'extension_runtime_projection_request',
    extension_runtime_projection_request: { request_id: createRequestId('extension-projection') },
  });
}

function setExtensionProjections(value, installations = []) {
  state.extensions = (Array.isArray(value) ? value : value ? [value] : [])
    .sort((a, b) => a.extension_id.localeCompare(b.extension_id));
  state.extensionInstallations = Array.isArray(installations) ? installations : [];
  renderExtensions();
}

function mergeExtensionProjection(value) {
  if (!value?.extension_id) return;
  const index = state.extensions.findIndex((item) => item.extension_id === value.extension_id);
  if (index >= 0) state.extensions[index] = value;
  else state.extensions.push(value);
  state.extensions.sort((a, b) => a.extension_id.localeCompare(b.extension_id));
  renderExtensions();
}

function renderExtensions() {
  elements['extension-list'].replaceChildren();
  if (state.extensions.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'extension-list-empty';
    empty.textContent = '尚未安装扩展。';
    elements['extension-list'].append(empty);
    return;
  }
  for (const extension of state.extensions) {
    const installation = state.extensionInstallations.find((item) => item.extension_id === extension.extension_id);
    const versions = installation?.installed_versions || (extension.version ? [extension.version] : []);
    const activeVersion = installation?.active_version || '';
    const previousVersion = state.extensionSelectedVersions[extension.extension_id];
    const selectedVersion = versions.includes(previousVersion)
      ? previousVersion
      : activeVersion || extension.version || versions[0] || '';
    state.extensionSelectedVersions[extension.extension_id] = selectedVersion;
    const row = document.createElement('article');
    row.className = 'extension-item';
    const identity = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = extension.display_name || extension.extension_id;
    const meta = document.createElement('p');
    meta.textContent = `${extension.extension_id}@${activeVersion || extension.version || 'unknown'} · ${extension.summary || extension.lifecycle}`;
    identity.append(title, meta);
    const badge = document.createElement('span');
    badge.className = `runtime-badge ${extension.lifecycle === 'failed' ? 'error' : isExtensionRunning(extension.lifecycle) ? '' : 'warn'}`;
    badge.textContent = extension.lifecycle;
    const actions = document.createElement('div');
    actions.className = 'extension-item-actions';
    const versionSelect = document.createElement('select');
    versionSelect.setAttribute('aria-label', `${extension.extension_id} 版本`);
    for (const version of versions) {
      const option = document.createElement('option');
      option.value = version;
      option.textContent = `${version}${version === activeVersion ? ' · 当前' : ''}`;
      versionSelect.append(option);
    }
    versionSelect.value = selectedVersion;
    const lifecycleButton = document.createElement('button');
    lifecycleButton.type = 'button';
    const updateActions = () => {
      const switching = isExtensionRunning(extension.lifecycle) && versionSelect.value !== activeVersion;
      lifecycleButton.textContent = switching ? '切换版本' : isExtensionRunning(extension.lifecycle) ? '停止' : '启动';
      uninstallButton.disabled = !versionSelect.value
        || (isExtensionRunning(extension.lifecycle) && versionSelect.value === activeVersion);
    };
    versionSelect.addEventListener('change', () => {
      state.extensionSelectedVersions[extension.extension_id] = versionSelect.value;
      updateActions();
    });
    lifecycleButton.addEventListener('click', () => requestExtensionLifecycle(extension, versionSelect.value, activeVersion));
    const uninstallButton = document.createElement('button');
    uninstallButton.type = 'button';
    uninstallButton.className = 'danger-button';
    uninstallButton.textContent = '卸载';
    uninstallButton.addEventListener('click', () => requestExtensionUninstall(extension, versionSelect.value, activeVersion));
    updateActions();
    actions.append(versionSelect, lifecycleButton, uninstallButton);
    row.append(identity, badge, actions);
    elements['extension-list'].append(row);
  }
}

function requestExtensionLifecycle(extension, selectedVersion, activeVersion) {
  const switching = isExtensionRunning(extension.lifecycle) && selectedVersion !== activeVersion;
  const operation = isExtensionRunning(extension.lifecycle) && !switching ? 'stop' : 'start';
  sendSurfaceFrame({
    kind: 'extension_lifecycle_request',
    extension_lifecycle_request: {
      request_id: createRequestId('extension-lifecycle'),
      extension_id: extension.extension_id,
      version: operation === 'start' ? selectedVersion : undefined,
      operation,
    },
  });
  setExtensionMessage(`${operation === 'start' ? '正在启动' : '正在停止'} ${extension.extension_id}…`);
}

function requestExtensionUninstall(extension, version, activeVersion) {
  if (!version || (isExtensionRunning(extension.lifecycle) && version === activeVersion)) return;
  if (!window.confirm(`卸载 ${extension.extension_id}@${version}？`)) return;
  sendSurfaceFrame({
    kind: 'extension_uninstall_request',
    extension_uninstall_request: {
      request_id: createRequestId('extension-uninstall'),
      extension_id: extension.extension_id,
      version,
    },
  });
  setExtensionMessage(`正在卸载 ${extension.extension_id}@${version}…`);
}

function handleExtensionLifecycleResult(result) {
  setExtensionMessage(result.status === 'success'
    ? `${result.extension_id} 已${result.operation === 'start' ? '启动' : '停止'}。`
    : result.message || '扩展状态变更失败。', result.status !== 'success');
  requestExtensionProjection();
}

function handleExtensionUninstallResult(result) {
  setExtensionMessage(result.status === 'success'
    ? `${result.extension_id}@${result.version} 已卸载。`
    : result.message || '扩展卸载失败。', result.status !== 'success');
  requestExtensionProjection();
}

function clearExtensionPreview() {
  state.extensionPreview = null;
  elements['extension-preview'].hidden = true;
  elements['extension-commit-button'].disabled = false;
}

function detailRow(label, value) {
  const row = document.createElement('div');
  const term = document.createElement('dt');
  const description = document.createElement('dd');
  term.textContent = label;
  description.textContent = value;
  row.append(term, description);
  return row;
}

function setExtensionMessage(message, error = false) {
  elements['extension-install-message'].textContent = message;
  elements['extension-install-message'].classList.toggle('is-error', error);
}

function isExtensionRunning(lifecycle) {
  return ['loaded', 'starting', 'running', 'stopping', 'degraded'].includes(lifecycle);
}

function createRequestId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function audioLaneLabel(lane) {
  if (!lane?.enabled || lane.route_state === 'disabled') return '未启用';
  if (lane.route_state === 'ready') return '已就绪';
  if (lane.route_state === 'degraded') return '能力受限';
  return '需要处理';
}

function setConnection(value) {
  state.connected = value === 'online';
  const labels = { online: '在线', connecting: '连接中', waiting: '等待服务', offline: '离线' };
  for (const id of ['connection-dot', 'pane-status-dot', 'inspector-dot']) {
    elements[id].className = value === 'online' ? 'is-online' : value === 'offline' ? 'is-offline' : '';
  }
  elements['connection-label'].textContent = labels[value];
  elements['pane-status-label'].textContent = labels[value];
  elements['inspector-connection'].textContent = labels[value];
  elements['send-button'].disabled = value !== 'online';
}

function switchView(view) {
  if (!['conversation', 'system', 'extensions'].includes(view)) return;
  if (view === 'extensions' && state.product?.features?.extensions !== true) return;
  state.view = view;
  const system = view === 'system';
  const extensions = view === 'extensions';
  elements['conversation-view'].hidden = system || extensions;
  elements['system-view'].hidden = !system;
  elements['extensions-view'].hidden = !extensions;
  elements['title-section'].textContent = system ? '系统' : extensions ? '能力' : '对话';
  elements['title-page'].textContent = system ? '运行状态' : extensions ? '扩展' : '当前对话';
  elements['pane-eyebrow'].textContent = system ? '系统' : extensions ? '能力' : '对话';
  elements['pane-title'].textContent = system ? '系统' : extensions ? '扩展' : '对话';
  for (const button of document.querySelectorAll('[data-view]')) {
    button.classList.toggle('is-active', button.dataset.view === view);
  }
  if (system) void refreshReadiness();
  if (extensions) requestExtensionProjection();
}

function resizeComposer() {
  const input = elements['message-input'];
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}

function loadMessages() {
  try {
    const value = JSON.parse(localStorage.getItem('glimmer.personal-server.messages') || '[]');
    return Array.isArray(value) ? value.slice(-100) : [];
  } catch { return []; }
}

function persistMessages() {
  localStorage.setItem('glimmer.personal-server.messages', JSON.stringify(state.messages));
}
