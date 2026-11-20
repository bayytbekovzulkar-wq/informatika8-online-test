// Главная точка входа Cloudflare Pages Functions (Workers API)
// Все запросы /api/* обрабатываются этим маршрутизатором с подключением D1 (env.DB)

import { errorResponse, jsonResponse, verifySameOrigin } from '../_lib/http.js';
import { getPlatformSettings } from '../_lib/settings.js';
import { handleStudentRoutes } from '../_lib/studentRoutes.js';
import { handleTeacherRoutes } from '../_lib/teacherRoutes.js';

export async function onRequest(context) {
  const { request, env, params } = context;

  // Проверка наличия подключённой базы данных Cloudflare D1
  if (!env || !env.DB) {
    return errorResponse(
      'База данных Cloudflare D1 (binding: DB) не подключена. Проверьте настройки Functions -> D1 Database Bindings в Cloudflare Dashboard.',
      500
    );
  }

  // Базовая защита от межсайтовых поддельных запросов (CSRF)
  if (!verifySameOrigin(request)) {
    return errorResponse('Запрос отклонён политикой безопасности (Origin mismatch).', 403);
  }

  const rawPath = params && params.path ? params.path : [];
  const segments = Array.isArray(rawPath)
    ? rawPath.filter(Boolean)
    : String(rawPath).split('/').filter(Boolean);

  try {
    // GET /api/health
    if (segments.length === 1 && segments[0] === 'health' && request.method === 'GET') {
      const check = await env.DB.prepare('SELECT 1 AS ok').first();
      return jsonResponse({ status: 'ok', db: Boolean(check?.ok) });
    }

    // GET /api/config — публичная конфигурация для фронтенда (без секретов)
    if (segments.length === 1 && segments[0] === 'config' && request.method === 'GET') {
      const settings = await getPlatformSettings(env.DB);
      return jsonResponse({
        app_name: env.APP_NAME || settings.platform_name,
        curriculum_authors: settings.curriculum_authors,
        turnstile_site_key: String(env.TURNSTILE_SITE_KEY || '').trim() || null,
        grading_scale: {
          grade_5_min: settings.grade_5_min,
          grade_4_min: settings.grade_4_min,
          grade_3_min: settings.grade_3_min
        }
      });
    }

    // Маршруты ученика: /api/student/*
    if (segments[0] === 'student') {
      return await handleStudentRoutes(request, env, segments.slice(1));
    }

    // Маршруты учителя: /api/teacher/*
    if (segments[0] === 'teacher') {
      return await handleTeacherRoutes(request, env, segments.slice(1));
    }

    return errorResponse('API-маршрут не найден.', 404);
  } catch (err) {
    console.error('API Error:', err);
    return errorResponse('Внутренняя ошибка сервера. Попробуйте позже.', 500);
  }
}
