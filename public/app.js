/* ============================================================
 * 批次照片去背 · 主要邏輯
 * - 使用 OpenAI gpt-image-1 / gpt-image-2 (/v1/images/edits) 進行去背
 * - API Key 加密儲存在 creds.json，登入後解密到 sessionStorage
 * ============================================================ */

const STORAGE_KEYS = {
  model: 'bg_remover_model',
  prompt: 'bg_remover_prompt',
  size: 'bg_remover_size',
  quality: 'bg_remover_quality',
  concurrency: 'bg_remover_concurrency',
};

const DEFAULT_PROMPTS = {
  'gpt-image-1':
    'Remove the background completely. Keep only the main subject with clean, precise edges. Output a transparent background.',
  'gpt-image-2':
    'Isolate the main subject from the photo. Place it cleanly centered against a pure white (#FFFFFF) background with no shadow. Preserve precise edges, hair, and fine details. Do not alter the subject itself.',
};

const state = {
  items: new Map(), // id -> { id, file, name, originalUrl, resultBlob, resultUrl, status, error }
  selected: new Set(),
};

/* ---------- DOM refs ---------- */
const $ = (id) => document.getElementById(id);
const settingsPanel = $('settingsPanel');
const settingsToggle = $('settingsToggle');
const logoutBtn = $('logoutBtn');
const loggedInAs = $('loggedInAs');
const loginOverlay = $('loginOverlay');
const loginForm = $('loginForm');
const loginUsername = $('loginUsername');
const loginPassword = $('loginPassword');
const loginSubmit = $('loginSubmit');
const loginError = $('loginError');
const loginSetupHint = $('loginSetupHint');
const modelSelect = $('model');
const modelHint = $('modelHint');
const promptInput = $('prompt');
const sizeSelect = $('size');
const qualitySelect = $('quality');
const concurrencySelect = $('concurrency');
const dropzone = $('dropzone');
const fileInput = $('fileInput');
const browseBtn = $('browseBtn');
const grid = $('grid');
const emptyState = $('emptyState');
const counter = $('counter');
const selectAllChk = $('selectAll');
const clearBtn = $('clearBtn');
const processBtn = $('processBtn');
const downloadSelectedBtn = $('downloadSelectedBtn');
const downloadZipBtn = $('downloadZipBtn');
const cardTemplate = $('cardTemplate');
const modal = $('modal');
const modalTitle = $('modalTitle');
const beforeImg = $('beforeImg');
const afterImg = $('afterImg');
const afterPane = $('afterPane');
const compareEl = $('compare');
const compareHandle = $('compareHandle');
const modalDownload = $('modalDownload');
const toast = $('toast');

/* ---------- Settings persistence ---------- */
function loadSettings() {
  modelSelect.value = localStorage.getItem(STORAGE_KEYS.model) || 'gpt-image-2';
  promptInput.value =
    localStorage.getItem(STORAGE_KEYS.prompt) || DEFAULT_PROMPTS[modelSelect.value];
  sizeSelect.value = localStorage.getItem(STORAGE_KEYS.size) || 'auto';
  qualitySelect.value = localStorage.getItem(STORAGE_KEYS.quality) || 'medium';
  concurrencySelect.value = localStorage.getItem(STORAGE_KEYS.concurrency) || '2';
  updateModelHint();
}

function updateModelHint() {
  if (!modelHint) return;
  if (modelSelect.value === 'gpt-image-2') {
    modelHint.textContent = '⚠️ gpt-image-2 不支援透明背景，輸出會是白底（不是真正的去背 PNG）';
  } else {
    modelHint.textContent = '✓ gpt-image-1 支援透明背景，可輸出真正的去背 PNG';
  }
}

function saveSetting(key, value) {
  localStorage.setItem(key, value);
}

modelSelect.addEventListener('change', (e) => {
  saveSetting(STORAGE_KEYS.model, e.target.value);
  updateModelHint();
  const currentPrompt = promptInput.value.trim();
  const wasDefault = Object.values(DEFAULT_PROMPTS).includes(currentPrompt) || currentPrompt === '';
  if (wasDefault) {
    promptInput.value = DEFAULT_PROMPTS[e.target.value];
    saveSetting(STORAGE_KEYS.prompt, promptInput.value);
  }
});
promptInput.addEventListener('change', (e) => saveSetting(STORAGE_KEYS.prompt, e.target.value));
sizeSelect.addEventListener('change', (e) => saveSetting(STORAGE_KEYS.size, e.target.value));
qualitySelect.addEventListener('change', (e) => saveSetting(STORAGE_KEYS.quality, e.target.value));
concurrencySelect.addEventListener('change', (e) => saveSetting(STORAGE_KEYS.concurrency, e.target.value));

settingsToggle.addEventListener('click', () => settingsPanel.classList.toggle('hidden'));

/* ---------- File upload ---------- */
browseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  fileInput.click();
});
dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

['dragenter', 'dragover'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('drag');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag');
  })
);
dropzone.addEventListener('drop', (e) => {
  const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
  handleFiles(files);
});

function handleFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const item = {
      id,
      file,
      name: file.name,
      originalUrl: URL.createObjectURL(file),
      resultBlob: null,
      resultUrl: null,
      status: 'pending', // pending | processing | done | error
      error: null,
    };
    state.items.set(id, item);
    state.selected.add(id);
    renderCard(item);
  }
  fileInput.value = '';
  refreshUi();
}

/* ---------- Card rendering ---------- */
function renderCard(item) {
  const node = cardTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.id = item.id;
  node.querySelector('.filename').textContent = item.name;
  node.querySelector('.thumb-img').src = item.originalUrl;

  const checkbox = node.querySelector('.select-one');
  checkbox.checked = state.selected.has(item.id);
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) state.selected.add(item.id);
    else state.selected.delete(item.id);
    refreshUi();
  });

  node.querySelector('.remove').addEventListener('click', () => removeItem(item.id));
  node.querySelector('.compare-btn').addEventListener('click', () => openCompare(item.id));
  node.querySelector('.download-btn').addEventListener('click', () => downloadOne(item.id));

  grid.appendChild(node);
  updateCardStatus(item);
}

function updateCardStatus(item) {
  const card = grid.querySelector(`[data-id="${item.id}"]`);
  if (!card) return;
  const overlay = card.querySelector('.status-overlay');
  const label = card.querySelector('.status-label');
  const elapsedEl = card.querySelector('.elapsed');
  const compareBtn = card.querySelector('.compare-btn');
  const downloadBtn = card.querySelector('.download-btn');
  const thumbImg = card.querySelector('.thumb-img');

  label.className = 'status-label';
  overlay.classList.remove('hidden');

  elapsedEl.textContent = item.processedMs != null ? formatDuration(item.processedMs) : '';

  switch (item.status) {
    case 'pending':
      label.textContent = '待處理';
      compareBtn.disabled = true;
      downloadBtn.disabled = true;
      thumbImg.src = item.originalUrl;
      break;
    case 'processing':
      label.classList.add('processing');
      label.textContent = '處理中';
      compareBtn.disabled = true;
      downloadBtn.disabled = true;
      break;
    case 'done':
      label.classList.add('done');
      label.textContent = '完成';
      compareBtn.disabled = false;
      downloadBtn.disabled = false;
      thumbImg.src = item.resultUrl || item.originalUrl;
      // hide overlay briefly so user can see result clearly
      setTimeout(() => overlay.classList.add('hidden'), 400);
      break;
    case 'error':
      label.classList.add('error');
      label.textContent = item.error ? `失敗: ${truncate(item.error, 30)}` : '失敗';
      compareBtn.disabled = true;
      downloadBtn.disabled = true;
      break;
  }
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

function removeItem(id) {
  const item = state.items.get(id);
  if (!item) return;
  URL.revokeObjectURL(item.originalUrl);
  if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
  state.items.delete(id);
  state.selected.delete(id);
  const card = grid.querySelector(`[data-id="${id}"]`);
  if (card) card.remove();
  refreshUi();
}

/* ---------- UI refresh ---------- */
function refreshUi() {
  const total = state.items.size;
  const doneCount = [...state.items.values()].filter((i) => i.status === 'done').length;
  const selectedCount = state.selected.size;
  const pendingCount = [...state.items.values()].filter((i) => i.status === 'pending' || i.status === 'error').length;

  counter.textContent = total === 0
    ? '0 張照片'
    : `${total} 張照片 · 完成 ${doneCount} · 已選 ${selectedCount}`;

  emptyState.classList.toggle('hidden', total > 0);
  selectAllChk.checked = total > 0 && selectedCount === total;
  selectAllChk.indeterminate = selectedCount > 0 && selectedCount < total;

  processBtn.disabled = pendingCount === 0;
  downloadSelectedBtn.disabled = selectedCount === 0 || ![...state.selected].some((id) => state.items.get(id)?.status === 'done');
  downloadZipBtn.disabled = doneCount === 0;
}

selectAllChk.addEventListener('change', () => {
  if (selectAllChk.checked) {
    state.items.forEach((_, id) => state.selected.add(id));
  } else {
    state.selected.clear();
  }
  grid.querySelectorAll('.select-one').forEach((cb) => {
    cb.checked = state.selected.has(cb.closest('.photo-card').dataset.id);
  });
  refreshUi();
});

clearBtn.addEventListener('click', () => {
  if (state.items.size === 0) return;
  if (!confirm('確定要清空所有照片嗎？')) return;
  state.items.forEach((item) => {
    URL.revokeObjectURL(item.originalUrl);
    if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
  });
  state.items.clear();
  state.selected.clear();
  grid.innerHTML = '';
  refreshUi();
});

/* ---------- OpenAI call ---------- */
async function callOpenAI(file) {
  const apiKey = getSessionApiKey();
  if (!apiKey) throw new Error('登入已過期，請重新登入');

  const model = modelSelect.value || 'gpt-image-2';
  const formData = new FormData();
  formData.append('model', model);
  formData.append('image', file, file.name);
  formData.append('prompt', promptInput.value.trim() || DEFAULT_PROMPTS[model] || DEFAULT_PROMPTS['gpt-image-2']);
  // gpt-image-2 does not support transparent backgrounds — only set on gpt-image-1
  if (model === 'gpt-image-1') {
    formData.append('background', 'transparent');
  }
  formData.append('output_format', 'png');
  formData.append('n', '1');
  if (sizeSelect.value !== 'auto') formData.append('size', sizeSelect.value);
  formData.append('quality', qualitySelect.value);

  const response = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const txt = await response.text();
    let message = `HTTP ${response.status}`;
    try {
      const j = JSON.parse(txt);
      message = j?.error?.message || message;
    } catch {
      message = txt.slice(0, 200) || message;
    }
    throw new Error(message);
  }

  const json = await response.json();
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error('回應沒有圖片資料');
  return base64ToBlob(b64, 'image/png');
}

function base64ToBlob(b64, type) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/* ---------- Batch processing with concurrency ---------- */
processBtn.addEventListener('click', () => processBatch());

async function processBatch() {
  if (!getSessionApiKey()) {
    showToast('登入已過期，請重新登入', 'error');
    showLogin();
    return;
  }

  const targets = [...state.items.values()].filter((i) => i.status === 'pending' || i.status === 'error');
  if (targets.length === 0) return;

  processBtn.disabled = true;
  const concurrency = parseInt(concurrencySelect.value, 10) || 2;
  const queue = [...targets];
  let active = 0;
  let completed = 0;
  const startedAt = performance.now();

  return new Promise((resolve) => {
    const next = () => {
      if (queue.length === 0 && active === 0) {
        const elapsedMs = performance.now() - startedAt;
        refreshUi();
        const kind = completed === targets.length ? 'success' : 'error';
        showToast(
          `處理完成：${completed} / ${targets.length} · 總耗時 ${formatDuration(elapsedMs)}`,
          kind,
          4500
        );
        resolve();
        return;
      }
      while (active < concurrency && queue.length > 0) {
        const item = queue.shift();
        active++;
        item.status = 'processing';
        item.processedMs = null;
        const itemStartedAt = performance.now();
        updateCardStatus(item);
        refreshUi();
        callOpenAI(item.file)
          .then((blob) => {
            if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
            item.resultBlob = blob;
            item.resultUrl = URL.createObjectURL(blob);
            item.status = 'done';
            item.error = null;
            completed++;
          })
          .catch((err) => {
            item.status = 'error';
            item.error = err.message || String(err);
            console.error('處理失敗', item.name, err);
          })
          .finally(() => {
            item.processedMs = performance.now() - itemStartedAt;
            active--;
            updateCardStatus(item);
            refreshUi();
            next();
          });
      }
    };
    next();
  });
}

/* ---------- Download ---------- */
function pngFilename(name) {
  const base = name.replace(/\.[^.]+$/, '');
  return `${base}-nobg.png`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadOne(id) {
  const item = state.items.get(id);
  if (!item || !item.resultBlob) return;
  downloadBlob(item.resultBlob, pngFilename(item.name));
}

downloadSelectedBtn.addEventListener('click', async () => {
  const items = [...state.selected]
    .map((id) => state.items.get(id))
    .filter((i) => i && i.status === 'done' && i.resultBlob);
  if (items.length === 0) {
    showToast('沒有可下載的選取項目', 'error');
    return;
  }
  if (items.length === 1) {
    downloadOne(items[0].id);
    return;
  }
  await downloadAsZip(items, `bg-removed-selected-${stamp()}.zip`);
});

downloadZipBtn.addEventListener('click', async () => {
  const items = [...state.items.values()].filter((i) => i.status === 'done' && i.resultBlob);
  if (items.length === 0) {
    showToast('還沒有完成的圖片', 'error');
    return;
  }
  await downloadAsZip(items, `bg-removed-all-${stamp()}.zip`);
});

async function downloadAsZip(items, zipName) {
  showToast(`打包中… (${items.length} 張)`, 'success');
  const zip = new JSZip();
  const seen = new Map();
  for (const item of items) {
    let name = pngFilename(item.name);
    const count = (seen.get(name) || 0) + 1;
    seen.set(name, count);
    if (count > 1) name = name.replace(/\.png$/, `-${count}.png`);
    zip.file(name, item.resultBlob);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, zipName);
  showToast(`已下載 ${zipName}`, 'success');
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/* ---------- Compare modal ---------- */
let currentCompareId = null;

function openCompare(id) {
  const item = state.items.get(id);
  if (!item || !item.resultUrl) return;
  currentCompareId = id;
  modalTitle.textContent = `前後對比 · ${item.name}`;
  beforeImg.src = item.originalUrl;
  afterImg.src = item.resultUrl;
  setComparePosition(50);
  modal.classList.remove('hidden');
}

function closeCompare() {
  modal.classList.add('hidden');
  currentCompareId = null;
}

modal.addEventListener('click', (e) => {
  if (e.target.matches('[data-close]')) closeCompare();
});

modalDownload.addEventListener('click', () => {
  if (currentCompareId) downloadOne(currentCompareId);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeCompare();
});

/* ---------- Compare slider drag ---------- */
function setComparePosition(percent) {
  const p = Math.max(0, Math.min(100, percent));
  afterPane.style.clipPath = `inset(0 0 0 ${p}%)`;
  compareHandle.style.left = `${p}%`;
}

let dragging = false;
function onDragStart(e) {
  dragging = true;
  onDragMove(e);
}
function onDragMove(e) {
  if (!dragging) return;
  const rect = compareEl.getBoundingClientRect();
  const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  setComparePosition((x / rect.width) * 100);
}
function onDragEnd() { dragging = false; }

compareEl.addEventListener('mousedown', onDragStart);
window.addEventListener('mousemove', onDragMove);
window.addEventListener('mouseup', onDragEnd);
compareEl.addEventListener('touchstart', onDragStart, { passive: true });
window.addEventListener('touchmove', onDragMove, { passive: true });
window.addEventListener('touchend', onDragEnd);

/* ---------- Toast ---------- */
let toastTimer = null;
function showToast(message, kind = '', duration = 2400) {
  toast.textContent = message;
  toast.className = `toast ${kind}`;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), duration);
}

function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)} 毫秒`;
  const totalSec = ms / 1000;
  if (totalSec < 60) return `${totalSec.toFixed(1)} 秒`;
  const m = Math.floor(totalSec / 60);
  const s = Math.round(totalSec - m * 60);
  return `${m} 分 ${s} 秒`;
}

/* ---------- Auth / Login ---------- */
let credsCache = null;

async function loadCreds() {
  if (credsCache && credsCache.ciphertext) return credsCache;
  try {
    const res = await fetch('creds.json?v=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('creds.json not found');
    credsCache = await res.json();
    return credsCache;
  } catch (err) {
    return null;
  }
}

function showLogin() {
  loginOverlay.classList.remove('hidden');
  loginError.classList.add('hidden');
  loginPassword.value = '';
  setTimeout(() => loginPassword.focus(), 50);
}

function hideLogin() {
  loginOverlay.classList.add('hidden');
}

function setLoggedInUi(username) {
  loggedInAs.textContent = username;
  loggedInAs.classList.remove('hidden');
  logoutBtn.classList.remove('hidden');
}

function showLoginError(message) {
  loginError.textContent = message;
  loginError.classList.remove('hidden');
}

async function tryLogin(username, password) {
  const creds = await loadCreds();
  if (!creds || !creds.ciphertext) {
    loginSetupHint.classList.remove('hidden');
    throw new Error('尚未完成初始設定');
  }
  const expected = (creds.username || '').toLowerCase().trim();
  if (username.toLowerCase().trim() !== expected) {
    throw new Error('帳號或密碼錯誤');
  }
  let apiKey;
  try {
    apiKey = await decryptSecret(creds, password);
  } catch {
    throw new Error('帳號或密碼錯誤');
  }
  if (!apiKey || !apiKey.startsWith('sk-')) {
    throw new Error('解密成功但 key 格式異常');
  }
  setSessionApiKey(apiKey);
  return creds.username;
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.classList.add('hidden');
  loginSubmit.disabled = true;
  const originalText = loginSubmit.textContent;
  loginSubmit.textContent = '驗證中…';
  try {
    const username = await tryLogin(loginUsername.value, loginPassword.value);
    setLoggedInUi(username);
    hideLogin();
    loginPassword.value = '';
  } catch (err) {
    showLoginError(err.message || '登入失敗');
  } finally {
    loginSubmit.disabled = false;
    loginSubmit.textContent = originalText;
  }
});

logoutBtn.addEventListener('click', () => {
  clearSessionApiKey();
  loggedInAs.classList.add('hidden');
  logoutBtn.classList.add('hidden');
  showLogin();
});

/* ---------- Init ---------- */
loadSettings();
refreshUi();

(async () => {
  const creds = await loadCreds();
  const sessionKey = getSessionApiKey();
  if (sessionKey && creds && creds.username) {
    setLoggedInUi(creds.username);
    hideLogin();
  } else {
    if (!creds || !creds.ciphertext) {
      loginSetupHint.classList.remove('hidden');
    }
    showLogin();
    if (creds && creds.username) {
      loginUsername.value = creds.username;
      setTimeout(() => loginPassword.focus(), 50);
    }
  }
})();
