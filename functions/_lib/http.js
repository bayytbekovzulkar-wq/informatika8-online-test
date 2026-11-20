// Вспомогательные функции HTTP, cookies, безопасности и проверки Cloudflare Turnstile

export const STUDENT_COOKIE = 'inf8_student_session';
export const TEACHER_COOKIE = 'inf8_teacher_session';

export function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders
    }
  });
}

export function errorResponse(message, status = 400, details = undefined) {
  const body = details ? { error: message, details } : { error: message };
  return jsonResponse(body, status);
}

export async function readJsonBody(request) {
  try {
    const text = await request.text();
    if (!text) return {};
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const key = part.slice(0, idx).trim();
      const val = part.slice(idx + 1).trim();
      cookies[key] = decodeURIComponent(val);
    }
  }
  return cookies;
}

export function buildSessionCookie(name, value, maxAgeSeconds, request) {
  const isHttps = new URL(request.url).protocol === 'https:';
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`
  ];
  if (isHttps) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function clearSessionCookie(name, request) {
  return buildSessionCookie(name, '', 0, request);
}

/**
 * Базовая защита от CSRF (проверка Origin/Referer для изменяющих запросов).
 */
export function verifySameOrigin(request) {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return true;
  }
  const reqOrigin = new URL(request.url).origin;
  const origin = request.headers.get('Origin');
  if (origin) {
    return origin === reqOrigin;
  }
  const referer = request.headers.get('Referer');
  if (referer) {
    try {
      return new URL(referer).origin === reqOrigin;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Проверка токена Cloudflare Turnstile (если задан TURNSTILE_SECRET_KEY).
 */
export async function verifyTurnstile(token, env, request) {
  const secret = String(env.TURNSTILE_SECRET_KEY || '').trim();
  if (!secret) {
    return { ok: true, skipped: true };
  }
  if (!token) {
    return { ok: false, error: 'Подтвердите проверку безопасности (Turnstile).' };
  }
  try {
    const formData = new FormData();
    formData.append('secret', secret);
    formData.append('response', token);
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip) formData.append('remoteip', ip);

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!data.success) {
      return { ok: false, error: 'Проверка Turnstile не пройдена. Попробуйте снова.' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Ошибка проверки Turnstile.' };
  }
}

export function getSessionSecret(env) {
  const secret = String(env.SESSION_SECRET || '').trim();
  if (secret.length >= 16) return secret;
  // Запасной ключ только для локального режима разработки без .dev.vars
  return 'local-dev-only-informatika8-session-secret-key';
}
