// Криптографические утилиты для Cloudflare Workers (Web Crypto API)
// PBKDF2-SHA256 для паролей, HMAC-SHA256 для подписанных HttpOnly сессий

const PBKDF2_ITERATIONS = 100000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const clean = String(hex || '').trim();
  if (clean.length % 2 !== 0) return new Uint8Array(0);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function base64UrlEncode(str) {
  const bytes = typeof str === 'string' ? encoder.encode(str) : str;
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecodeToString(b64url) {
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return decoder.decode(bytes);
}

function timingSafeEqual(aBytes, bBytes) {
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

/**
 * Хеширует пароль с использованием PBKDF2-SHA256 и случайной соли.
 * Формат: pbkdf2_sha256$<iterations>$<salt_hex>$<hash_hex>
 */
export async function hashPassword(password) {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(String(password)),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    HASH_BITS
  );

  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(new Uint8Array(derived))}`;
}

/**
 * Проверяет пароль по сохранённому хешу (с защитой от атак по времени).
 */
export async function verifyPassword(password, storedHash) {
  const parts = String(storedHash || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') {
    return false;
  }
  const iterations = parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < 10000 || iterations > 500000) {
    return false;
  }
  const salt = hexToBytes(parts[2]);
  const expected = hexToBytes(parts[3]);
  if (salt.length === 0 || expected.length === 0) return false;

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(String(password)),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    expected.length * 8
  );

  return timingSafeEqual(new Uint8Array(derived), expected);
}

async function getHmacKey(secret) {
  const keyText = String(secret || '').trim();
  if (!keyText || keyText.length < 16) {
    throw new Error('SESSION_SECRET не настроен (требуется минимум 16 символов)');
  }
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(keyText),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/**
 * Создаёт подписанный токен сессии (формат payload.signature).
 */
export async function signSessionToken(payload, secret, ttlHours = 8) {
  const nowSec = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: nowSec,
    exp: nowSec + Math.max(1, Number(ttlHours) || 8) * 3600
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const key = await getHmacKey(secret);
  const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(encodedPayload));
  const encodedSig = base64UrlEncode(new Uint8Array(sigBuf));
  return `${encodedPayload}.${encodedSig}`;
}

/**
 * Проверяет подпись и срок действия токена сессии.
 */
export async function verifySessionToken(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [encodedPayload, encodedSig] = parts;
  try {
    const key = await getHmacKey(secret);
    const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(encodedPayload));
    const expectedSig = base64UrlEncode(new Uint8Array(sigBuf));
    if (!timingSafeEqual(encoder.encode(encodedSig), encoder.encode(expectedSig))) {
      return null;
    }
    const payload = JSON.parse(base64UrlDecodeToString(encodedPayload));
    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload || typeof payload.exp !== 'number' || payload.exp <= nowSec) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/**
 * Генерирует удобный код подключения для класса (например, INF-7K2M).
 */
export function generateJoinCode(prefix = 'INF') {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const random = new Uint8Array(4);
  crypto.getRandomValues(random);
  let suffix = '';
  for (let i = 0; i < random.length; i++) {
    suffix += alphabet[random[i] % alphabet.length];
  }
  return `${prefix}${suffix}`;
}
