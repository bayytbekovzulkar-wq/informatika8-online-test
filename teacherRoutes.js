// API-маршруты кабинета учителя (административная панель)

import {
  generateJoinCode,
  hashPassword,
  signSessionToken,
  verifyPassword
} from './crypto.js';
import { getAuthenticatedTeacher } from './auth.js';
import {
  TEACHER_COOKIE,
  buildSessionCookie,
  clearSessionCookie,
  errorResponse,
  getSessionSecret,
  jsonResponse,
  readJsonBody,
  verifyTurnstile
} from './http.js';
import { getPlatformSettings, updatePlatformSettings } from './settings.js';

function csvEscape(val) {
  const s = String(val ?? '');
  if (s.includes(';') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function xmlEscape(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDuration(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m} мин ${String(rem).padStart(2, '0')} сек`;
}

async function queryFilteredResults(db, url) {
  const params = url.searchParams;
  const classId = params.get('class_id');
  const studentId = params.get('student_id');
  const topicId = params.get('topic_id');
  const testId = params.get('test_id');
  const dateFrom = params.get('date_from');
  const dateTo = params.get('date_to');
  const search = (params.get('search') || '').trim().toLowerCase();
  const sort = params.get('sort') || 'date_desc';

  const where = ["a.status != 'in_progress'"];
  const binds = [];

  if (classId && Number.isFinite(Number(classId))) {
    where.push('s.class_id = ?');
    binds.push(Number(classId));
  }
  if (studentId && Number.isFinite(Number(studentId))) {
    where.push('a.student_id = ?');
    binds.push(Number(studentId));
  }
  if (topicId && Number.isFinite(Number(topicId))) {
    where.push('t.topic_id = ?');
    binds.push(Number(topicId));
  }
  if (testId && Number.isFinite(Number(testId))) {
    where.push('a.test_id = ?');
    binds.push(Number(testId));
  }
  if (dateFrom) {
    where.push('date(a.finished_at) >= date(?)');
    binds.push(dateFrom);
  }
  if (dateTo) {
    where.push('date(a.finished_at) <= date(?)');
    binds.push(dateTo);
  }
  if (search) {
    where.push(
      "(lower(s.first_name || ' ' || s.last_name) LIKE ? OR lower(s.last_name || ' ' || s.first_name) LIKE ? OR lower(t.title) LIKE ? OR lower(c.name) LIKE ?)"
    );
    const like = `%${search}%`;
    binds.push(like, like, like, like);
  }

  const orderByMap = {
    date_desc: 'a.finished_at DESC, a.id DESC',
    date_asc: 'a.finished_at ASC, a.id ASC',
    grade_desc: 'a.grade DESC, a.percentage DESC, a.finished_at DESC',
    grade_asc: 'a.grade ASC, a.percentage ASC, a.finished_at DESC',
    pct_desc: 'a.percentage DESC, a.finished_at DESC',
    pct_asc: 'a.percentage ASC, a.finished_at DESC'
  };
  const orderBy = orderByMap[sort] || orderByMap.date_desc;

  const sql = `
    SELECT a.id, a.test_id, a.student_id, a.attempt_number, a.finished_at, a.time_spent_seconds,
           a.total_questions, a.correct_count, a.earned_points, a.max_points, a.percentage, a.grade, a.passed,
           s.first_name, s.last_name, s.class_id,
           c.name AS class_name,
           t.title AS test_title, t.topic_id,
           tp.title AS topic_title
    FROM test_attempts a
    JOIN students s ON s.id = a.student_id
    JOIN classes c ON c.id = s.class_id
    JOIN tests t ON t.id = a.test_id
    JOIN topics tp ON tp.id = t.topic_id
    WHERE ${where.join(' AND ')}
    ORDER BY ${orderBy}
    LIMIT 1000
  `;

  const res = await db.prepare(sql).bind(...binds).all();
  return res.results || [];
}

export async function handleTeacherRoutes(request, env, pathSegments) {
  const method = request.method.toUpperCase();
  const db = env.DB;
  const url = new URL(request.url);

  // GET /api/teacher/setup-status — проверка, создан ли первый учитель
  if (pathSegments.length === 1 && pathSegments[0] === 'setup-status' && method === 'GET') {
    const row = await db.prepare('SELECT COUNT(*) AS cnt FROM teachers').first();
    return jsonResponse({
      needs_setup: Number(row?.cnt || 0) === 0,
      requires_setup_token: Boolean(String(env.INITIAL_SETUP_TOKEN || '').trim())
    });
  }

  // POST /api/teacher/setup — создание первого аккаунта учителя (работает только при пустой таблице teachers)
  if (pathSegments.length === 1 && pathSegments[0] === 'setup' && method === 'POST') {
    const existing = await db.prepare('SELECT COUNT(*) AS cnt FROM teachers').first();
    if (Number(existing?.cnt || 0) > 0) {
      return errorResponse('Аккаунт учителя уже создан. Выполните вход.', 403);
    }

    const body = await readJsonBody(request);
    if (!body) return errorResponse('Некорректный JSON.');

    const requiredToken = String(env.INITIAL_SETUP_TOKEN || '').trim();
    if (requiredToken && String(body.setup_token || '').trim() !== requiredToken) {
      return errorResponse('Неверный токен первичной настройки (INITIAL_SETUP_TOKEN).', 403);
    }

    const username = String(body.username || '').trim();
    const fullName = String(body.full_name || '').trim();
    const password = String(body.password || '');

    if (username.length < 3 || username.length > 40) {
      return errorResponse('Логин должен содержать от 3 до 40 символов.');
    }
    if (fullName.length < 2 || fullName.length > 100) {
      return errorResponse('Укажите ФИО учителя.');
    }
    if (password.length < 6) {
      return errorResponse('Пароль должен содержать не менее 6 символов.');
    }

    const passwordHash = await hashPassword(password);
    const ins = await db
      .prepare('INSERT INTO teachers (username, full_name, password_hash) VALUES (?, ?, ?)')
      .bind(username, fullName, passwordHash)
      .run();

    const settings = await getPlatformSettings(db);
    const token = await signSessionToken(
      { role: 'teacher', teacherId: ins.meta.last_row_id },
      getSessionSecret(env),
      settings.session_ttl_hours
    );
    const cookie = buildSessionCookie(
      TEACHER_COOKIE,
      token,
      settings.session_ttl_hours * 3600,
      request
    );

    return jsonResponse(
      {
        teacher: { id: ins.meta.last_row_id, username, full_name: fullName }
      },
      201,
      { 'Set-Cookie': cookie }
    );
  }

  // POST /api/teacher/login
  if (pathSegments.length === 1 && pathSegments[0] === 'login' && method === 'POST') {
    const body = await readJsonBody(request);
    if (!body) return errorResponse('Некорректный JSON.');

    const turnstile = await verifyTurnstile(body.turnstile_token, env, request);
    if (!turnstile.ok) return errorResponse(turnstile.error, 403);

    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username || !password) {
      return errorResponse('Введите логин и пароль.');
    }

    const teacher = await db
      .prepare('SELECT id, username, full_name, password_hash FROM teachers WHERE username = ?')
      .bind(username)
      .first();

    if (!teacher || !(await verifyPassword(password, teacher.password_hash))) {
      return errorResponse('Неверный логин или пароль.', 401);
    }

    const settings = await getPlatformSettings(db);
    const token = await signSessionToken(
      { role: 'teacher', teacherId: teacher.id },
      getSessionSecret(env),
      settings.session_ttl_hours
    );
    const cookie = buildSessionCookie(
      TEACHER_COOKIE,
      token,
      settings.session_ttl_hours * 3600,
      request
    );

    return jsonResponse(
      {
        teacher: { id: teacher.id, username: teacher.username, full_name: teacher.full_name }
      },
      200,
      { 'Set-Cookie': cookie }
    );
  }

  // POST /api/teacher/logout
  if (pathSegments.length === 1 && pathSegments[0] === 'logout' && method === 'POST') {
    return jsonResponse(
      { ok: true },
      200,
      { 'Set-Cookie': clearSessionCookie(TEACHER_COOKIE, request) }
    );
  }

  // Защита всех административных маршрутов на сервере
  const teacher = await getAuthenticatedTeacher(request, env);
  if (!teacher) {
    return errorResponse('Требуется авторизация учителя. Сессия отсутствует или истекла.', 401);
  }

  // GET /api/teacher/me
  if (pathSegments.length === 1 && pathSegments[0] === 'me' && method === 'GET') {
    return jsonResponse({ teacher });
  }

  // POST /api/teacher/change-password
  if (pathSegments.length === 1 && pathSegments[0] === 'change-password' && method === 'POST') {
    const body = await readJsonBody(request);
    if (!body) return errorResponse('Некорректный JSON.');
    const currentPassword = String(body.current_password || '');
    const newPassword = String(body.new_password || '');

    if (newPassword.length < 6) {
      return errorResponse('Новый пароль должен содержать не менее 6 символов.');
    }

    const row = await db
      .prepare('SELECT password_hash FROM teachers WHERE id = ?')
      .bind(teacher.id)
      .first();

    if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
      return errorResponse('Текущий пароль указан неверно.', 400);
    }

    const newHash = await hashPassword(newPassword);
    await db
      .prepare("UPDATE teachers SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(newHash, teacher.id)
      .run();

    return jsonResponse({ ok: true, message: 'Пароль успешно обновлён.' });
  }

  // GET /api/teacher/dashboard — главная статистика
  if (pathSegments.length === 1 && pathSegments[0] === 'dashboard' && method === 'GET') {
    const [studentsCnt, testsCnt, attemptsAgg, gradeDist, topicStats, recent] = await Promise.all([
      db.prepare('SELECT COUNT(*) AS cnt FROM students').first(),
      db.prepare('SELECT COUNT(*) AS cnt FROM tests').first(),
      db
        .prepare(
          `SELECT COUNT(*) AS completed_count,
                  ROUND(AVG(percentage), 1) AS avg_percentage,
                  ROUND(AVG(grade), 2) AS avg_grade
           FROM test_attempts WHERE status != 'in_progress'`
        )
        .first(),
      db
        .prepare(
          `SELECT grade, COUNT(*) AS cnt
           FROM test_attempts WHERE status != 'in_progress'
           GROUP BY grade ORDER BY grade DESC`
        )
        .all(),
      db
        .prepare(
          `SELECT tp.id, tp.title,
                  COUNT(a.id) AS attempts_count,
                  ROUND(AVG(a.percentage), 1) AS avg_percentage,
                  ROUND(AVG(a.grade), 2) AS avg_grade
           FROM topics tp
           LEFT JOIN tests t ON t.topic_id = tp.id
           LEFT JOIN test_attempts a ON a.test_id = t.id AND a.status != 'in_progress'
           GROUP BY tp.id
           ORDER BY tp.sort_order ASC`
        )
        .all(),
      db
        .prepare(
          `SELECT a.id, a.finished_at, a.correct_count, a.total_questions, a.percentage, a.grade,
                  s.first_name, s.last_name, c.name AS class_name, t.title AS test_title
           FROM test_attempts a
           JOIN students s ON s.id = a.student_id
           JOIN classes c ON c.id = s.class_id
           JOIN tests t ON t.id = a.test_id
           WHERE a.status != 'in_progress'
           ORDER BY a.finished_at DESC
           LIMIT 8`
        )
        .all()
    ]);

    return jsonResponse({
      stats: {
        total_students: Number(studentsCnt?.cnt || 0),
        total_tests: Number(testsCnt?.cnt || 0),
        completed_attempts: Number(attemptsAgg?.completed_count || 0),
        avg_percentage: Number(attemptsAgg?.avg_percentage || 0),
        avg_grade: Number(attemptsAgg?.avg_grade || 0)
      },
      grade_distribution: gradeDist.results || [],
      topic_stats: topicStats.results || [],
      recent_results: recent.results || []
    });
  }

  // ==================== КЛАССЫ ====================
  if (pathSegments[0] === 'classes') {
    // GET /api/teacher/classes
    if (pathSegments.length === 1 && method === 'GET') {
      const res = await db
        .prepare(
          `SELECT c.*,
                  (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id) AS student_count
           FROM classes c ORDER BY c.name ASC`
        )
        .all();
      return jsonResponse({ classes: res.results || [] });
    }

    // POST /api/teacher/classes
    if (pathSegments.length === 1 && method === 'POST') {
      const body = await readJsonBody(request);
      if (!body) return errorResponse('Некорректный JSON.');
      const name = String(body.name || '').trim();
      const joinCode = String(body.join_code || generateJoinCode('INF8')).trim().toUpperCase();

      if (name.length < 1 || name.length > 40) {
        return errorResponse('Введите название класса (до 40 символов).');
      }
      if (joinCode.length < 3 || joinCode.length > 24) {
        return errorResponse('Код подключения должен быть от 3 до 24 символов.');
      }

      try {
        const ins = await db
          .prepare('INSERT INTO classes (name, join_code) VALUES (?, ?)')
          .bind(name, joinCode)
          .run();
        return jsonResponse(
          { class: { id: ins.meta.last_row_id, name, join_code: joinCode, student_count: 0 } },
          201
        );
      } catch {
        return errorResponse('Класс с таким названием или кодом подключения уже существует.', 409);
      }
    }

    // PUT /api/teacher/classes/:id
    if (pathSegments.length === 2 && method === 'PUT') {
      const id = Number(pathSegments[1]);
      const body = await readJsonBody(request);
      if (!Number.isFinite(id) || !body) return errorResponse('Некорректные данные.');

      const name = String(body.name || '').trim();
      const joinCode = body.regenerate_code
        ? generateJoinCode('INF8')
        : String(body.join_code || '').trim().toUpperCase();

      if (name.length < 1 || name.length > 40) return errorResponse('Введите название класса.');
      if (joinCode.length < 3 || joinCode.length > 24) return errorResponse('Некорректный код класса.');

      try {
        await db
          .prepare('UPDATE classes SET name = ?, join_code = ? WHERE id = ?')
          .bind(name, joinCode, id)
          .run();
        const updated = await db.prepare('SELECT * FROM classes WHERE id = ?').bind(id).first();
        return jsonResponse({ class: updated });
      } catch {
        return errorResponse('Такое название класса или код подключения уже заняты.', 409);
      }
    }

    // DELETE /api/teacher/classes/:id
    if (pathSegments.length === 2 && method === 'DELETE') {
      const id = Number(pathSegments[1]);
      if (!Number.isFinite(id)) return errorResponse('Некорректный ID класса.');
      await db.prepare('DELETE FROM classes WHERE id = ?').bind(id).run();
      return jsonResponse({ ok: true });
    }

    // GET /api/teacher/classes/:id/students
    if (pathSegments.length === 3 && pathSegments[2] === 'students' && method === 'GET') {
      const id = Number(pathSegments[1]);
      if (!Number.isFinite(id)) return errorResponse('Некорректный ID класса.');
      const res = await db
        .prepare(
          `SELECT s.*,
                  (SELECT COUNT(*) FROM test_attempts a WHERE a.student_id = s.id AND a.status != 'in_progress') AS attempts_count,
                  (SELECT ROUND(AVG(a.grade), 2) FROM test_attempts a WHERE a.student_id = s.id AND a.status != 'in_progress') AS avg_grade
           FROM students s WHERE s.class_id = ? ORDER BY s.last_name ASC, s.first_name ASC`
        )
        .bind(id)
        .all();
      return jsonResponse({ students: res.results || [] });
    }
  }

  // ==================== УЧЕНИКИ ====================
  if (pathSegments[0] === 'students') {
    // GET /api/teacher/students
    if (pathSegments.length === 1 && method === 'GET') {
      const classId = url.searchParams.get('class_id');
      const search = (url.searchParams.get('search') || '').trim().toLowerCase();
      const where = ['1=1'];
      const binds = [];

      if (classId && Number.isFinite(Number(classId))) {
        where.push('s.class_id = ?');
        binds.push(Number(classId));
      }
      if (search) {
        where.push(
          "(lower(s.first_name || ' ' || s.last_name) LIKE ? OR lower(s.last_name || ' ' || s.first_name) LIKE ?)"
        );
        const like = `%${search}%`;
        binds.push(like, like);
      }

      const res = await db
        .prepare(
          `SELECT s.id, s.first_name, s.last_name, s.class_id, s.created_at, s.last_seen_at,
                  c.name AS class_name,
                  (SELECT COUNT(*) FROM test_attempts a WHERE a.student_id = s.id AND a.status != 'in_progress') AS attempts_count,
                  (SELECT ROUND(AVG(a.percentage), 1) FROM test_attempts a WHERE a.student_id = s.id AND a.status != 'in_progress') AS avg_percentage,
                  (SELECT ROUND(AVG(a.grade), 2) FROM test_attempts a WHERE a.student_id = s.id AND a.status != 'in_progress') AS avg_grade
           FROM students s
           JOIN classes c ON c.id = s.class_id
           WHERE ${where.join(' AND ')}
           ORDER BY c.name ASC, s.last_name ASC, s.first_name ASC`
        )
        .bind(...binds)
        .all();

      return jsonResponse({ students: res.results || [] });
    }

    // DELETE /api/teacher/students/:id
    if (pathSegments.length === 2 && method === 'DELETE') {
      const id = Number(pathSegments[1]);
      if (!Number.isFinite(id)) return errorResponse('Некорректный ID ученика.');
      await db.prepare('DELETE FROM students WHERE id = ?').bind(id).run();
      return jsonResponse({ ok: true });
    }

    // GET /api/teacher/students/:id/history
    if (pathSegments.length === 3 && pathSegments[2] === 'history' && method === 'GET') {
      const id = Number(pathSegments[1]);
      if (!Number.isFinite(id)) return errorResponse('Некорректный ID ученика.');
      const student = await db
        .prepare(
          `SELECT s.*, c.name AS class_name
           FROM students s JOIN classes c ON c.id = s.class_id WHERE s.id = ?`
        )
        .bind(id)
        .first();
      if (!student) return errorResponse('Ученик не найден.', 404);

      const attempts = await db
        .prepare(
          `SELECT a.*, t.title AS test_title, tp.title AS topic_title
           FROM test_attempts a
           JOIN tests t ON t.id = a.test_id
           JOIN topics tp ON tp.id = t.topic_id
           WHERE a.student_id = ?
           ORDER BY a.started_at DESC`
        )
        .bind(id)
        .all();

      const retakes = await db
        .prepare('SELECT test_id, extra_attempts FROM retake_permissions WHERE student_id = ?')
        .bind(id)
        .all();

      return jsonResponse({
        student,
        attempts: attempts.results || [],
        retake_permissions: retakes.results || []
      });
    }

    // POST /api/teacher/students/:id/grant-retake — разрешить повторное прохождение теста
    if (pathSegments.length === 3 && pathSegments[2] === 'grant-retake' && method === 'POST') {
      const studentId = Number(pathSegments[1]);
      const body = await readJsonBody(request);
      const testId = Number(body?.test_id);
      if (!Number.isFinite(studentId) || !Number.isFinite(testId)) {
        return errorResponse('Укажите корректный тест и ученика.');
      }

      await db
        .prepare(
          `INSERT INTO retake_permissions (student_id, test_id, extra_attempts, granted_by_teacher_id, granted_at)
           VALUES (?, ?, 1, ?, datetime('now'))
           ON CONFLICT(student_id, test_id) DO UPDATE SET
             extra_attempts = retake_permissions.extra_attempts + 1,
             granted_by_teacher_id = excluded.granted_by_teacher_id,
             granted_at = datetime('now')`
        )
        .bind(studentId, testId, teacher.id)
        .run();

      return jsonResponse({ ok: true, message: 'Дополнительная попытка выдана ученику.' });
    }
  }

  // ==================== ТЕМЫ ====================
  if (pathSegments[0] === 'topics') {
    if (pathSegments.length === 1 && method === 'GET') {
      const res = await db
        .prepare(
          `SELECT tp.*,
                  (SELECT COUNT(*) FROM tests t WHERE t.topic_id = tp.id) AS tests_count
           FROM topics tp ORDER BY tp.sort_order ASC, tp.id ASC`
        )
        .all();
      const topics = (res.results || []).map((t) => ({
        ...t,
        subtopics: JSON.parse(t.subtopics_json || '[]')
      }));
      return jsonResponse({ topics });
    }

    if (pathSegments.length === 1 && method === 'POST') {
      const body = await readJsonBody(request);
      const title = String(body?.title || '').trim();
      const description = String(body?.description || '').trim();
      const subtopics = Array.isArray(body?.subtopics) ? body.subtopics : [];
      if (title.length < 3) return errorResponse('Введите название темы.');

      const code = `topic-${Date.now()}`;
      const ins = await db
        .prepare(
          'INSERT INTO topics (code, title, description, subtopics_json, sort_order) VALUES (?, ?, ?, ?, 99)'
        )
        .bind(code, title, description, JSON.stringify(subtopics))
        .run();
      return jsonResponse({ id: ins.meta.last_row_id, title }, 201);
    }
  }

  // ==================== ТЕСТЫ И ВОПРОСЫ ====================
  if (pathSegments[0] === 'tests') {
    // GET /api/teacher/tests
    if (pathSegments.length === 1 && method === 'GET') {
      const res = await db
        .prepare(
          `SELECT t.*, tp.title AS topic_title, c.name AS class_name,
                  (SELECT COUNT(*) FROM questions q WHERE q.test_id = t.id) AS question_count,
                  (SELECT COUNT(*) FROM test_attempts a WHERE a.test_id = t.id AND a.status != 'in_progress') AS attempts_count
           FROM tests t
           JOIN topics tp ON tp.id = t.topic_id
           LEFT JOIN classes c ON c.id = t.class_id
           ORDER BY tp.sort_order ASC, t.created_at DESC`
        )
        .all();
      return jsonResponse({ tests: res.results || [] });
    }

    // POST /api/teacher/tests
    if (pathSegments.length === 1 && method === 'POST') {
      const body = await readJsonBody(request);
      if (!body) return errorResponse('Некорректный JSON.');
      const title = String(body.title || '').trim();
      const topicId = Number(body.topic_id);
      if (title.length < 2) return errorResponse('Введите название теста.');
      if (!Number.isFinite(topicId)) return errorResponse('Выберите тему.');

      const classId = body.class_id ? Number(body.class_id) : null;
      const questionLimit = body.question_limit ? Math.max(1, Number(body.question_limit)) : null;
      const durationMinutes = Math.max(1, Math.min(240, Number(body.duration_minutes) || 20));
      const passingScore = Math.max(0, Math.min(100, Number(body.passing_score ?? 50)));
      const maxAttempts = Math.max(1, Math.min(20, Number(body.max_attempts) || 1));
      const kind = body.kind === 'practice' ? 'practice' : 'test';

      const ins = await db
        .prepare(
          `INSERT INTO tests (
             topic_id, class_id, title, description, kind, question_limit,
             duration_minutes, passing_score, starts_at, ends_at,
             is_active, max_attempts, shuffle_questions, shuffle_answers, show_results
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          topicId,
          classId,
          title,
          String(body.description || '').trim(),
          kind,
          questionLimit,
          durationMinutes,
          passingScore,
          body.starts_at || null,
          body.ends_at || null,
          body.is_active === false ? 0 : 1,
          maxAttempts,
          body.shuffle_questions === false ? 0 : 1,
          body.shuffle_answers === false ? 0 : 1,
          body.show_results === false ? 0 : 1
        )
        .run();

      const created = await db.prepare('SELECT * FROM tests WHERE id = ?').bind(ins.meta.last_row_id).first();
      return jsonResponse({ test: created }, 201);
    }

    // GET /api/teacher/tests/:id — полная карточка теста с вопросами и вариантами
    if (pathSegments.length === 2 && method === 'GET') {
      const id = Number(pathSegments[1]);
      if (!Number.isFinite(id)) return errorResponse('Некорректный ID теста.');
      const test = await db.prepare('SELECT * FROM tests WHERE id = ?').bind(id).first();
      if (!test) return errorResponse('Тест не найден.', 404);

      const qRes = await db
        .prepare('SELECT * FROM questions WHERE test_id = ? ORDER BY sort_order ASC, id ASC')
        .bind(id)
        .all();
      const aRes = await db
        .prepare(
          `SELECT * FROM answers
           WHERE question_id IN (SELECT id FROM questions WHERE test_id = ?)
           ORDER BY sort_order ASC, id ASC`
        )
        .bind(id)
        .all();

      const answersByQ = new Map();
      for (const a of aRes.results || []) {
        if (!answersByQ.has(a.question_id)) answersByQ.set(a.question_id, []);
        answersByQ.get(a.question_id).push({ ...a, is_correct: Boolean(a.is_correct) });
      }

      const questions = (qRes.results || []).map((q) => ({
        ...q,
        answers: answersByQ.get(q.id) || []
      }));

      return jsonResponse({ test, questions });
    }

    // PUT /api/teacher/tests/:id
    if (pathSegments.length === 2 && method === 'PUT') {
      const id = Number(pathSegments[1]);
      const body = await readJsonBody(request);
      if (!Number.isFinite(id) || !body) return errorResponse('Некорректные данные.');

      const existing = await db.prepare('SELECT * FROM tests WHERE id = ?').bind(id).first();
      if (!existing) return errorResponse('Тест не найден.', 404);

      const title = body.title !== undefined ? String(body.title).trim() : existing.title;
      if (title.length < 2) return errorResponse('Название теста слишком короткое.');

      await db
        .prepare(
          `UPDATE tests SET
             topic_id = ?, class_id = ?, title = ?, description = ?, kind = ?,
             question_limit = ?, duration_minutes = ?, passing_score = ?,
             starts_at = ?, ends_at = ?, is_active = ?, max_attempts = ?,
             shuffle_questions = ?, shuffle_answers = ?, show_results = ?,
             updated_at = datetime('now')
           WHERE id = ?`
        )
        .bind(
          body.topic_id !== undefined ? Number(body.topic_id) : existing.topic_id,
          body.class_id !== undefined ? (body.class_id ? Number(body.class_id) : null) : existing.class_id,
          title,
          body.description !== undefined ? String(body.description).trim() : existing.description,
          body.kind !== undefined ? (body.kind === 'practice' ? 'practice' : 'test') : existing.kind,
          body.question_limit !== undefined
            ? body.question_limit
              ? Math.max(1, Number(body.question_limit))
              : null
            : existing.question_limit,
          body.duration_minutes !== undefined
            ? Math.max(1, Math.min(240, Number(body.duration_minutes)))
            : existing.duration_minutes,
          body.passing_score !== undefined
            ? Math.max(0, Math.min(100, Number(body.passing_score)))
            : existing.passing_score,
          body.starts_at !== undefined ? body.starts_at || null : existing.starts_at,
          body.ends_at !== undefined ? body.ends_at || null : existing.ends_at,
          body.is_active !== undefined ? (body.is_active ? 1 : 0) : existing.is_active,
          body.max_attempts !== undefined
            ? Math.max(1, Math.min(20, Number(body.max_attempts)))
            : existing.max_attempts,
          body.shuffle_questions !== undefined
            ? body.shuffle_questions
              ? 1
              : 0
            : existing.shuffle_questions,
          body.shuffle_answers !== undefined
            ? body.shuffle_answers
              ? 1
              : 0
            : existing.shuffle_answers,
          body.show_results !== undefined ? (body.show_results ? 1 : 0) : existing.show_results,
          id
        )
        .run();

      const updated = await db.prepare('SELECT * FROM tests WHERE id = ?').bind(id).first();
      return jsonResponse({ test: updated });
    }

    // DELETE /api/teacher/tests/:id
    if (pathSegments.length === 2 && method === 'DELETE') {
      const id = Number(pathSegments[1]);
      if (!Number.isFinite(id)) return errorResponse('Некорректный ID теста.');
      await db.prepare('DELETE FROM tests WHERE id = ?').bind(id).run();
      return jsonResponse({ ok: true });
    }

    // POST /api/teacher/tests/:testId/questions — добавление вопроса
    if (pathSegments.length === 3 && pathSegments[2] === 'questions' && method === 'POST') {
      const testId = Number(pathSegments[1]);
      const body = await readJsonBody(request);
      if (!Number.isFinite(testId) || !body) return errorResponse('Некорректные данные.');

      const type = String(body.question_type || 'single');
      if (!['single', 'multiple', 'boolean', 'number', 'text'].includes(type)) {
        return errorResponse('Неподдерживаемый тип вопроса.');
      }
      const qText = String(body.question_text || '').trim();
      if (qText.length < 2) return errorResponse('Введите текст вопроса.');

      const points = Math.max(0.5, Number(body.points) || 1);
      const explanation = String(body.explanation || '').trim();
      const correctValue =
        type === 'number' || type === 'text' ? String(body.correct_value ?? '').trim() : null;

      if ((type === 'number' || type === 'text') && !correctValue) {
        return errorResponse('Укажите правильный ответ для вопроса с вводом.');
      }

      const maxOrderRow = await db
        .prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM questions WHERE test_id = ?')
        .bind(testId)
        .first();
      const nextOrder = Number(maxOrderRow?.m || 0) + 1;

      const ins = await db
        .prepare(
          `INSERT INTO questions (test_id, question_type, question_text, points, explanation, correct_value, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(testId, type, qText, points, explanation, correctValue, nextOrder)
        .run();
      const questionId = ins.meta.last_row_id;

      if (type === 'single' || type === 'multiple' || type === 'boolean') {
        let answersList = Array.isArray(body.answers) ? body.answers : [];
        if (type === 'boolean' && answersList.length === 0) {
          answersList = [
            { answer_text: 'Верно', is_correct: Boolean(body.boolean_correct ?? true) },
            { answer_text: 'Неверно', is_correct: !Boolean(body.boolean_correct ?? true) }
          ];
        }
        const validAnswers = answersList.filter((a) => String(a.answer_text || '').trim().length > 0);
        if (validAnswers.length < 2) {
          await db.prepare('DELETE FROM questions WHERE id = ?').bind(questionId).run();
          return errorResponse('Добавьте минимум 2 варианта ответа.');
        }
        if (!validAnswers.some((a) => Boolean(a.is_correct))) {
          await db.prepare('DELETE FROM questions WHERE id = ?').bind(questionId).run();
          return errorResponse('Отметьте хотя бы один правильный вариант ответа.');
        }

        for (let i = 0; i < validAnswers.length; i++) {
          await db
            .prepare(
              'INSERT INTO answers (question_id, answer_text, is_correct, sort_order) VALUES (?, ?, ?, ?)'
            )
            .bind(
              questionId,
              String(validAnswers[i].answer_text).trim(),
              validAnswers[i].is_correct ? 1 : 0,
              i + 1
            )
            .run();
        }
      }

      return jsonResponse({ id: questionId }, 201);
    }
  }

  // ==================== РЕДАКТИРОВАНИЕ / УДАЛЕНИЕ ВОПРОСА ====================
  if (pathSegments[0] === 'questions' && pathSegments.length === 2) {
    const questionId = Number(pathSegments[1]);
    if (!Number.isFinite(questionId)) return errorResponse('Некорректный ID вопроса.');

    if (method === 'PUT') {
      const body = await readJsonBody(request);
      if (!body) return errorResponse('Некорректный JSON.');
      const existing = await db.prepare('SELECT * FROM questions WHERE id = ?').bind(questionId).first();
      if (!existing) return errorResponse('Вопрос не найден.', 404);

      const type = String(body.question_type || existing.question_type);
      const qText = String(body.question_text || '').trim();
      if (qText.length < 2) return errorResponse('Введите текст вопроса.');

      const points = Math.max(0.5, Number(body.points) || 1);
      const explanation = String(body.explanation || '').trim();
      const correctValue =
        type === 'number' || type === 'text' ? String(body.correct_value ?? '').trim() : null;

      await db
        .prepare(
          `UPDATE questions
           SET question_type = ?, question_text = ?, points = ?, explanation = ?, correct_value = ?
           WHERE id = ?`
        )
        .bind(type, qText, points, explanation, correctValue, questionId)
        .run();

      if (type === 'single' || type === 'multiple' || type === 'boolean') {
        const answersList = (Array.isArray(body.answers) ? body.answers : []).filter(
          (a) => String(a.answer_text || '').trim().length > 0
        );
        if (answersList.length < 2 || !answersList.some((a) => Boolean(a.is_correct))) {
          return errorResponse('Укажите минимум 2 варианта и отметьте правильный ответ.');
        }
        await db.prepare('DELETE FROM answers WHERE question_id = ?').bind(questionId).run();
        for (let i = 0; i < answersList.length; i++) {
          await db
            .prepare(
              'INSERT INTO answers (question_id, answer_text, is_correct, sort_order) VALUES (?, ?, ?, ?)'
            )
            .bind(
              questionId,
              String(answersList[i].answer_text).trim(),
              answersList[i].is_correct ? 1 : 0,
              i + 1
            )
            .run();
        }
      } else {
        await db.prepare('DELETE FROM answers WHERE question_id = ?').bind(questionId).run();
      }

      return jsonResponse({ ok: true });
    }

    if (method === 'DELETE') {
      await db.prepare('DELETE FROM questions WHERE id = ?').bind(questionId).run();
      return jsonResponse({ ok: true });
    }
  }

  // ==================== РЕЗУЛЬТАТЫ И ЭКСПОРТ ====================
  if (pathSegments[0] === 'results') {
    if (pathSegments.length === 1 && method === 'GET') {
      const results = await queryFilteredResults(db, url);
      return jsonResponse({ results });
    }

    if (pathSegments.length === 2 && pathSegments[1] === 'export' && method === 'GET') {
      const format = (url.searchParams.get('format') || 'csv').toLowerCase();
      const rows = await queryFilteredResults(db, url);
      const headers = [
        'Ученик',
        'Класс',
        'Тест',
        'Тема',
        'Дата прохождения',
        'Правильных ответов',
        'Всего вопросов',
        'Процент (%)',
        'Оценка',
        'Время выполнения'
      ];

      if (format === 'xls' || format === 'excel') {
        const xmlRows = [
          `<Row>${headers.map((h) => `<Cell><Data ss:Type="String">${xmlEscape(h)}</Data></Cell>`).join('')}</Row>`,
          ...rows.map((r) => {
            const cells = [
              { t: 'String', v: `${r.last_name} ${r.first_name}` },
              { t: 'String', v: r.class_name },
              { t: 'String', v: r.test_title },
              { t: 'String', v: r.topic_title },
              { t: 'String', v: r.finished_at || '' },
              { t: 'Number', v: r.correct_count },
              { t: 'Number', v: r.total_questions },
              { t: 'Number', v: r.percentage },
              { t: 'Number', v: r.grade },
              { t: 'String', v: formatDuration(r.time_spent_seconds) }
            ];
            return `<Row>${cells.map((c) => `<Cell><Data ss:Type="${c.t}">${xmlEscape(c.v)}</Data></Cell>`).join('')}</Row>`;
          })
        ].join('\n');

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Результаты">
  <Table>
${xmlRows}
  </Table>
 </Worksheet>
</Workbook>`;

        return new Response(xml, {
          status: 200,
          headers: {
            'Content-Type': 'application/vnd.ms-excel; charset=utf-8',
            'Content-Disposition': 'attachment; filename="informatika8-results.xls"'
          }
        });
      }

      // CSV с UTF-8 BOM и разделителем ';' для корректного открытия в Excel (RU)
      const csvLines = [
        headers.map(csvEscape).join(';'),
        ...rows.map((r) =>
          [
            `${r.last_name} ${r.first_name}`,
            r.class_name,
            r.test_title,
            r.topic_title,
            r.finished_at || '',
            r.correct_count,
            r.total_questions,
            r.percentage,
            r.grade,
            formatDuration(r.time_spent_seconds)
          ]
            .map(csvEscape)
            .join(';')
        )
      ];

      return new Response('\uFEFF' + csvLines.join('\r\n'), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="informatika8-results.csv"'
        }
      });
    }

    if (pathSegments.length === 2 && method === 'DELETE') {
      const attemptId = Number(pathSegments[1]);
      if (!Number.isFinite(attemptId)) return errorResponse('Некорректный ID записи.');
      await db.prepare('DELETE FROM test_attempts WHERE id = ?').bind(attemptId).run();
      return jsonResponse({ ok: true });
    }
  }

  // ==================== НАСТРОЙКИ ПЛАТФОРМЫ ====================
  if (pathSegments.length === 1 && pathSegments[0] === 'settings') {
    if (method === 'GET') {
      const settings = await getPlatformSettings(db);
      return jsonResponse({ settings });
    }
    if (method === 'PUT') {
      const body = await readJsonBody(request);
      if (!body) return errorResponse('Некорректный JSON.');

      const g5 = Number(body.grade_5_min ?? 90);
      const g4 = Number(body.grade_4_min ?? 70);
      const g3 = Number(body.grade_3_min ?? 50);
      if (!(g5 > g4 && g4 > g3 && g3 > 0 && g5 <= 100)) {
        return errorResponse('Шкала оценок должна соблюдать порядок: 0 < Оценка 3 < Оценка 4 < Оценка 5 ≤ 100.');
      }

      const updated = await updatePlatformSettings(db, {
        platform_name: body.platform_name,
        grade_5_min: g5,
        grade_4_min: g4,
        grade_3_min: g3,
        show_results_to_students: Boolean(body.show_results_to_students),
        show_explanations_to_students: Boolean(body.show_explanations_to_students),
        session_ttl_hours: Math.max(1, Math.min(72, Number(body.session_ttl_hours) || 8))
      });

      return jsonResponse({ settings: updated, message: 'Настройки сохранены.' });
    }
  }

  return errorResponse('Административный маршрут не найден.', 404);
}
