/* ============================================================
 * 加密 / 解密 + session 工具
 * - AES-256-GCM
 * - PBKDF2-SHA256, 600,000 iterations（OWASP 2025 建議）
 * - 全部用瀏覽器內建 Web Crypto API，不依賴外部函式庫
 * ============================================================ */

const PBKDF2_ITERATIONS = 600000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const SESSION_KEY = 'bg_remover_session_apikey';

function b64encode(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function b64decode(str) {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(password, salt) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptSecret(plaintext, password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt);
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return {
    salt: b64encode(salt),
    iv: b64encode(iv),
    ciphertext: b64encode(cipher),
  };
}

async function decryptSecret(record, password) {
  const salt = b64decode(record.salt);
  const iv = b64decode(record.iv);
  const cipher = b64decode(record.ciphertext);
  const key = await deriveKey(password, salt);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    cipher
  );
  return new TextDecoder().decode(plain);
}

function setSessionApiKey(apiKey) {
  sessionStorage.setItem(SESSION_KEY, apiKey);
}

function getSessionApiKey() {
  return sessionStorage.getItem(SESSION_KEY);
}

function clearSessionApiKey() {
  sessionStorage.removeItem(SESSION_KEY);
}
