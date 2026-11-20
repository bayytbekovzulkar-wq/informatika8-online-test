// API-маршруты для ученика: вход, список тестов, запуск, автосохранение, отправка

import { signSessionToken } from './crypto.js';
import { getAuthenticatedStudent } from './auth.js';
import { calculateGrade, evaluateQuestion, shuffleArray } from './grading.js';
import {
  STUDENT_COOKIE,
  buildSessionCookie,
  clearSessionCookie,
  errorResponse,
  getSessionSecret,
  jsonResponse,
  readJsonBody,
  verifyTurnstile
} from './http.js';
import { getPlatformSettings } from './settings.js';

function normalizeStudentKey(firstName, lastName) {
  return `${String(lastName || '').trim().toLowerCase()}|${String(firstName || '').trim().toLowerCase()}`
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
}

function parseIsoOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Вычисляет доступность теста для конкретного ученика.
 */
function computeTestStatus(test, completedCount, activeAttemptId, extraAttempts) {
  const now = Date.now();
  const startsAt = parseIsoOrNull(test.starts_at);
  const endsAt = parseIsoOrNull(test.ends_at);
  const allowedAttempts = (Number(test.max_attempts) || 1) + (Number(extraAttempts) || 0);

  if (activeAttemptId) {
    return {
      status: 'available',
      status_label: 'Продолжить тест',
      reason: 'Есть незавершённая попытка',
      can_start: true,
      allowed_attempts: allowedAttempts
    };
  }

  if (!test.is_active) {
    return {
      status: 'unavailable',
      status_label: 'Недоступен',
      reason: 'Тест отключён учителем',
      can_start: false,
      allowed_attempts: allowedAttempts
    };
  }

  if (Number(test.question_count) === 0) {
    return {
      status: 'unavailable',
      status_label: 'Недоступен',
      reason: 'В тесте пока нет вопросов',
      can_start: false,
      allowed_attempts: allowedAttempts
    };
  }

  if (startsAt && now < startsAt.getTime()) {
    return {
      status: 'unavailable',
      status_label: 'Недоступен',
      reason: 'Тестирование ещё не началось',
      can_start: false,
      allowed_attempts: allowedAttempts
    };
  }

  if (endsAt && now > endsAt.getTime()) {
    return {
      status: completedCount > 0 ? 'completed' : 'unavailable',
      status_label: completedCount > 0 ? 'Завершён' : 'Недоступен',
      reason: 'Срок прохождения теста истёк',
      can_start: false,
      allowed_attempts: allowedAttempts
    };
  }

  if (completedCount >= allowedAttempts) {
    return {
      status: 'completed',
      status_label: 'Завершён',
      reason: 'Все доступные попытки использованы',
      can_start: false,
      allowed_attempts: allowedAttempts
    };
  }

  return {
    status: 'available',
    status_label: 'Доступен',
    reason: null,
    can_start: true,
    allowed_attempts: allowedAttempts
  };
}

/**
 * Финализирует попытку на сервере (идемпотентно).
 */
async function finalizeAttempt(db, attempt, test, settings) {
  const order = JSON.parse(attempt.question_order_json || '[]');
  const questionIds = order.map((q) => Number(q.question_id)).filter(Number.isFinite);

  let questions = [];
  if (questionIds.length > 0) {
    const placeholders = questionIds.map(() => '?').join(',');
    const qRes = await db
      .prepare(
        `SELECT id, question_type, question_text, points, explanation, correct_value
         FROM questions WHERE id IN (${placeholders})`
      )
      .bind(...questionIds)
      .all();
    const byId = new Map((qRes.results || []).map((q) => [q.id, q]));
    questions = questionIds.map((id) => byId.get(id)).filter(Boolean);
  }

  const answersRes = await db
    .prepare(
      `SELECT id, question_id, answer_text, is_correct
       FROM answers WHERE question_id IN (SELECT id FROM questions WHERE test_id = ?)`
    )
    .bind(attempt.test_id)
    .all();

  const correctIdsByQuestion = new Map();
  const answerTextsByQuestion = new Map();
  for (const a of answersRes.results || []) {
    if (!answerTextsByQuestion.has(a.question_id)) {
      answerTextsByQuestion.set(a.question_id, []);
    }
    answerTextsByQuestion.get(a.question_id).push(a);
    if (a.is_correct === 1) {
      if (!correctIdsByQuestion.has(a.question_id)) {
        correctIdsByQuestion.set(a.question_id, []);
      }
      correctIdsByQuestion.get(a.question_id).push(a.id);
    }
  }

  const savedRes = await db
    .prepare(
      'SELECT question_id, selected_answer_ids_json, answer_text FROM student_answers WHERE attempt_id = ?'
    )
    .bind(attempt.id)
    .all();
  const savedMap = new Map();
  for (const row of savedRes.results || []) {
    savedMap.set(row.question_id, {
      selected_answer_ids: JSON.parse(row.selected_answer_ids_json || '[]'),
      answer_text: row.answer_text
    });
  }

  let correctCount = 0;
  let earnedPoints = 0;
  let maxPoints = 0;
  const reviewItems = [];

  for (const q of questions) {
    const qPoints = Number(q.points) || 1;
    maxPoints += qPoints;
    const studentAns = savedMap.get(q.id) || null;
    const correctIds = correctIdsByQuestion.get(q.id) || [];
    const evalRes = evaluateQuestion(q, correctIds, studentAns);

    if (evalRes.isCorrect) correctCount += 1;
    earnedPoints += evalRes.earnedPoints;

    await db
      .prepare(
        `INSERT INTO student_answers (attempt_id, question_id, selected_answer_ids_json, answer_text, is_correct, earned_points, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(attempt_id, question_id) DO UPDATE SET
           is_correct = excluded.is_correct,
           earned_points = excluded.earned_points,
           updated_at = datetime('now')`
      )
      .bind(
        attempt.id,
        q.id,
        JSON.stringify(studentAns?.selected_answer_ids || []),
        studentAns?.answer_text ?? null,
        evalRes.isCorrect ? 1 : 0,
        evalRes.earnedPoints
      )
      .run();

    reviewItems.push({
      question_id: q.id,
      question_text: q.question_text,
      question_type: q.question_type,
      is_correct: evalRes.isCorrect,
      earned_points: evalRes.earnedPoints,
      max_points: qPoints,
      explanation: q.explanation || ''
    });
  }

  const percentage = maxPoints > 0 ? Math.round((earnedPoints / maxPoints) * 1000) / 10 : 0;
  const grade = calculateGrade(percentage, settings);
  const passed = percentage >= (Number(test.passing_score) || 50) ? 1 : 0;

  const startedMs = new Date(attempt.started_at + (attempt.started_at.endsWith('Z') ? '' : 'Z')).getTime();
  const maxDurationSec = (Number(test.duration_minutes) || 20) * 60;
  const elapsedSec = Math.max(1, Math.min(maxDurationSec, Math.floor((Date.now() - startedMs) / 1000)));

  const updateRes = await db
    .prepare(
      `UPDATE test_attempts
       SET status = 'completed',
           finished_at = datetime('now'),
           time_spent_seconds = ?,
           total_questions = ?,
           correct_count = ?,
           earned_points = ?,
           max_points = ?,
           percentage = ?,
           grade = ?,
           passed = ?
       WHERE id = ? AND status = 'in_progress'`
    )
    .bind(
      elapsedSec,
      questions.length,
      correctCount,
      earnedPoints,
      maxPoints,
      percentage,
      grade,
      passed,
      attempt.id
    )
    .run();

  if (updateRes.meta && updateRes.meta.changes === 0) {
    return null; // Уже отправлено параллельным запросом
  }

  return {
    attempt_id: attempt.id,
    status: 'completed',
    total_questions: questions.length,
    correct_count: correctCount,
    earned_points: earnedPoints,
    max_points: maxPoints,
    percentage,
    grade,
    passed: Boolean(passed),
    time_spent_seconds: elapsedSec,
    review: reviewItems
  };
}

export async function handleStudentRoutes(request, env, pathSegments) {
  const method = request.method.toUpperCase();
  const db = env.DB;

  // POST /api/student/login
  if (pathSegments.length === 1 && pathSegments[0] === 'login' && method === 'POST') {
    const body = await readJsonBody(request);
    if (!body) return errorResponse('Некорректный формат JSON.');

    const turnstile = await verifyTurnstile(body.turnstile_token, env, request);
    if (!turnstile.ok) return errorResponse(turnstile.error, 403);

    const firstName = String(body.first_name || '').trim();
    const lastName = String(body.last_name || '').trim();
    const joinCode = String(body.join_code || '').trim().toUpperCase();

    if (firstName.length < 2 || firstName.length > 60) {
      return errorResponse('Введите корректное имя (от 2 до 60 символов).');
    }
    if (lastName.length < 2 || lastName.length > 60) {
      return errorResponse('Введите корректную фамилию (от 2 до 60 символов).');
    }
    if (!joinCode || joinCode.length < 3 || joinCode.length > 32) {
      return errorResponse('Введите код подключения класса.');
    }

    const cls = await db
      .prepare('SELECT id, name, join_code FROM classes WHERE upper(join_code) = ?')
      .bind(joinCode)
      .first();

    if (!cls) {
      return errorResponse('Класс с таким кодом подключения не найден. Проверьте код у учителя.', 404);
    }

    const normalizedKey = normalizeStudentKey(firstName, lastName);
    let student = await db
      .prepare('SELECT id, first_name, last_name, class_id FROM students WHERE class_id = ? AND normalized_key = ?')
      .bind(cls.id, normalizedKey)
      .first();

    if (!student) {
      const insert = await db
        .prepare(
          `INSERT INTO students (class_id, first_name, last_name, normalized_key, last_seen_at)
           VALUES (?, ?, ?, ?, datetime('now'))`
        )
        .bind(cls.id, firstName, lastName, normalizedKey)
        .run();
      student = {
        id: insert.meta.last_row_id,
        first_name: firstName,
        last_name: lastName,
        class_id: cls.id
      };
    } else {
      await db
        .prepare("UPDATE students SET first_name = ?, last_name = ?, last_seen_at = datetime('now') WHERE id = ?")
        .bind(firstName, lastName, student.id)
        .run();
      student.first_name = firstName;
      student.last_name = lastName;
    }

    const settings = await getPlatformSettings(db);
    const token = await signSessionToken(
      { role: 'student', studentId: student.id, classId: cls.id },
      getSessionSecret(env),
      settings.session_ttl_hours
    );

    const cookie = buildSessionCookie(
      STUDENT_COOKIE,
      token,
      settings.session_ttl_hours * 3600,
      request
    );

    return jsonResponse(
      {
        student: {
          id: student.id,
          first_name: student.first_name,
          last_name: student.last_name,
          class_id: cls.id,
          class_name: cls.name
        }
      },
      200,
      { 'Set-Cookie': cookie }
    );
  }

  // POST /api/student/logout
  if (pathSegments.length === 1 && pathSegments[0] === 'logout' && method === 'POST') {
    return jsonResponse(
      { ok: true },
      200,
      { 'Set-Cookie': clearSessionCookie(STUDENT_COOKIE, request) }
    );
  }

  // Все дальнейшие маршруты требуют авторизации ученика
  const student = await getAuthenticatedStudent(request, env);
  if (!student) {
    return errorResponse('Сессия ученика не найдена или истекла. Войдите снова.', 401);
  }

  // GET /api/student/me
  if (pathSegments.length === 1 && pathSegments[0] === 'me' && method === 'GET') {
    return jsonResponse({
      student: {
        id: student.id,
        first_name: student.first_name,
        last_name: student.last_name,
        class_id: student.class_id,
        class_name: student.class_name
      }
    });
  }

  // GET /api/student/tests — список тестов класса и история прохождений ученика
  if (pathSegments.length === 1 && pathSegments[0] === 'tests' && method === 'GET') {
    const settings = await getPlatformSettings(db);

    const testsRes = await db
      .prepare(
        `SELECT t.*, tp.title AS topic_title, tp.code AS topic_code,
                (SELECT COUNT(*) FROM questions q WHERE q.test_id = t.id) AS total_bank_questions
         FROM tests t
         JOIN topics tp ON tp.id = t.topic_id
         WHERE t.class_id IS NULL OR t.class_id = ?
         ORDER BY tp.sort_order ASC, t.created_at DESC`
      )
      .bind(student.class_id)
      .all();

    const attemptsRes = await db
      .prepare(
        `SELECT a.*, t.title AS test_title, t.show_results AS test_show_results, tp.title AS topic_title
         FROM test_attempts a
         JOIN tests t ON t.id = a.test_id
         JOIN topics tp ON tp.id = t.topic_id
         WHERE a.student_id = ?
         ORDER BY a.started_at DESC`
      )
      .bind(student.id)
      .all();

    const retakesRes = await db
      .prepare('SELECT test_id, extra_attempts FROM retake_permissions WHERE student_id = ?')
      .bind(student.id)
      .all();
    const extraMap = new Map((retakesRes.results || []).map((r) => [r.test_id, r.extra_attempts]));

    const completedByTest = new Map();
    const activeByTest = new Map();
    const lastCompletedByTest = new Map();

    for (const a of attemptsRes.results || []) {
      if (a.status === 'in_progress') {
        activeByTest.set(a.test_id, a.id);
      } else {
        completedByTest.set(a.test_id, (completedByTest.get(a.test_id) || 0) + 1);
        if (!lastCompletedByTest.has(a.test_id)) {
          lastCompletedByTest.set(a.test_id, a);
        }
      }
    }

    const tests = (testsRes.results || []).map((t) => {
      const effectiveQuestionCount = t.question_limit
        ? Math.min(Number(t.question_limit), Number(t.total_bank_questions))
        : Number(t.total_bank_questions);
      const completedCount = completedByTest.get(t.id) || 0;
      const activeAttemptId = activeByTest.get(t.id) || null;
      const extraAttempts = extraMap.get(t.id) || 0;
      const statusInfo = computeTestStatus(
        { ...t, question_count: effectiveQuestionCount },
        completedCount,
        activeAttemptId,
        extraAttempts
      );
      const lastAttempt = lastCompletedByTest.get(t.id);
      const canSeeResult = settings.show_results_to_students && Boolean(t.show_results);

      return {
        id: t.id,
        title: t.title,
        description: t.description,
        kind: t.kind,
        topic_id: t.topic_id,
        topic_title: t.topic_title,
        question_count: effectiveQuestionCount,
        duration_minutes: t.duration_minutes,
        passing_score: t.passing_score,
        starts_at: t.starts_at,
        ends_at: t.ends_at,
        attempts_used: completedCount,
        allowed_attempts: statusInfo.allowed_attempts,
        active_attempt_id: activeAttemptId,
        status: statusInfo.status,
        status_label: statusInfo.status_label,
        status_reason: statusInfo.reason,
        can_start: statusInfo.can_start,
        last_result:
          lastAttempt && canSeeResult
            ? {
                attempt_id: lastAttempt.id,
                percentage: lastAttempt.percentage,
                grade: lastAttempt.grade,
                correct_count: lastAttempt.correct_count,
                total_questions: lastAttempt.total_questions,
                finished_at: lastAttempt.finished_at
              }
            : null
      };
    });

    const history = (attemptsRes.results || [])
      .filter((a) => a.status !== 'in_progress')
      .map((a) => {
        const visible = settings.show_results_to_students && Boolean(a.test_show_results);
        return {
          id: a.id,
          test_id: a.test_id,
          test_title: a.test_title,
          topic_title: a.topic_title,
          attempt_number: a.attempt_number,
          finished_at: a.finished_at,
          time_spent_seconds: a.time_spent_seconds,
          results_hidden: !visible,
          correct_count: visible ? a.correct_count : null,
          total_questions: visible ? a.total_questions : null,
          percentage: visible ? a.percentage : null,
          grade: visible ? a.grade : null,
          passed: visible ? Boolean(a.passed) : null
        };
      });

    return jsonResponse({
      student: {
        id: student.id,
        first_name: student.first_name,
        last_name: student.last_name,
        class_name: student.class_name
      },
      tests,
      history,
      settings: {
        show_results_to_students: settings.show_results_to_students,
        curriculum_authors: settings.curriculum_authors
      }
    });
  }

  // POST /api/student/tests/:testId/start
  if (pathSegments.length === 3 && pathSegments[0] === 'tests' && pathSegments[2] === 'start' && method === 'POST') {
    const testId = Number(pathSegments[1]);
    if (!Number.isFinite(testId)) return errorResponse('Некорректный ID теста.');

    const test = await db
      .prepare('SELECT * FROM tests WHERE id = ? AND (class_id IS NULL OR class_id = ?)')
      .bind(testId, student.class_id)
      .first();

    if (!test) {
      return errorResponse('Тест не найден или недоступен для вашего класса.', 404);
    }

    // Проверяем существующую незавершённую попытку
    const activeAttempt = await db
      .prepare(
        "SELECT * FROM test_attempts WHERE test_id = ? AND student_id = ? AND status = 'in_progress' ORDER BY id DESC LIMIT 1"
      )
      .bind(testId, student.id)
      .first();

    if (activeAttempt) {
      return jsonResponse({ attempt_id: activeAttempt.id, resumed: true });
    }

    const completedRow = await db
      .prepare(
        "SELECT COUNT(*) AS cnt FROM test_attempts WHERE test_id = ? AND student_id = ? AND status != 'in_progress'"
      )
      .bind(testId, student.id)
      .first();
    const completedCount = Number(completedRow?.cnt || 0);

    const retakeRow = await db
      .prepare('SELECT extra_attempts FROM retake_permissions WHERE student_id = ? AND test_id = ?')
      .bind(student.id, testId)
      .first();
    const extraAttempts = Number(retakeRow?.extra_attempts || 0);

    const qRes = await db
      .prepare('SELECT id, sort_order FROM questions WHERE test_id = ? ORDER BY sort_order ASC, id ASC')
      .bind(testId)
      .all();
    let questionsList = qRes.results || [];

    const statusInfo = computeTestStatus(
      { ...test, question_count: questionsList.length },
      completedCount,
      null,
      extraAttempts
    );
    if (!statusInfo.can_start) {
      return errorResponse(statusInfo.reason || 'Тест сейчас недоступен.', 403);
    }

    if (test.shuffle_questions) {
      questionsList = shuffleArray(questionsList);
    }
    if (test.question_limit && Number(test.question_limit) > 0 && Number(test.question_limit) < questionsList.length) {
      questionsList = questionsList.slice(0, Number(test.question_limit));
    }

    const ansRes = await db
      .prepare(
        `SELECT id, question_id, sort_order
         FROM answers WHERE question_id IN (SELECT id FROM questions WHERE test_id = ?)
         ORDER BY sort_order ASC, id ASC`
      )
      .bind(testId)
      .all();

    const ansByQ = new Map();
    for (const a of ansRes.results || []) {
      if (!ansByQ.has(a.question_id)) ansByQ.set(a.question_id, []);
      ansByQ.get(a.question_id).push(a.id);
    }

    const orderSpec = questionsList.map((q) => {
      let aIds = ansByQ.get(q.id) || [];
      if (test.shuffle_answers && aIds.length > 1) {
        aIds = shuffleArray(aIds);
      }
      return { question_id: q.id, answer_ids: aIds };
    });

    const durationSec = (Number(test.duration_minutes) || 20) * 60;
    const expiresAtIso = new Date(Date.now() + durationSec * 1000).toISOString();

    const insert = await db
      .prepare(
        `INSERT INTO test_attempts (
           test_id, student_id, attempt_number, status, started_at, expires_at,
           total_questions, question_order_json
         ) VALUES (?, ?, ?, 'in_progress', datetime('now'), ?, ?, ?)`
      )
      .bind(
        testId,
        student.id,
        completedCount + 1,
        expiresAtIso,
        orderSpec.length,
        JSON.stringify(orderSpec)
      )
      .run();

    return jsonResponse({ attempt_id: insert.meta.last_row_id, resumed: false }, 201);
  }

  // GET /api/student/attempts/:attemptId — получение вопросов (без правильных ответов!) или итога
  if (pathSegments.length === 2 && pathSegments[0] === 'attempts' && method === 'GET') {
    const attemptId = Number(pathSegments[1]);
    if (!Number.isFinite(attemptId)) return errorResponse('Некорректный ID попытки.');

    const attempt = await db
      .prepare('SELECT * FROM test_attempts WHERE id = ? AND student_id = ?')
      .bind(attemptId, student.id)
      .first();

    if (!attempt) {
      return errorResponse('Попытка тестирования не найдена.', 404);
    }

    const test = await db
      .prepare(
        `SELECT t.*, tp.title AS topic_title
         FROM tests t JOIN topics tp ON tp.id = t.topic_id
         WHERE t.id = ?`
      )
      .bind(attempt.test_id)
      .first();

    const settings = await getPlatformSettings(db);

    // Если время истекло, автоматически финализируем на сервере
    if (attempt.status === 'in_progress') {
      const expiresMs = new Date(attempt.expires_at).getTime();
      if (Date.now() > expiresMs + 10000) {
        await finalizeAttempt(db, attempt, test, settings);
        const updated = await db.prepare('SELECT * FROM test_attempts WHERE id = ?').bind(attemptId).first();
        Object.assign(attempt, updated);
      }
    }

    if (attempt.status !== 'in_progress') {
      const visible = settings.show_results_to_students && Boolean(test.show_results);
      let review = [];
      if (visible && settings.show_explanations_to_students) {
        const revRes = await db
          .prepare(
            `SELECT sa.question_id, sa.is_correct, sa.earned_points,
                    q.question_text, q.question_type, q.points AS max_points, q.explanation
             FROM student_answers sa
             JOIN questions q ON q.id = sa.question_id
             WHERE sa.attempt_id = ?`
          )
          .bind(attempt.id)
          .all();
        review = (revRes.results || []).map((r) => ({
          ...r,
          is_correct: Boolean(r.is_correct)
        }));
      }

      return jsonResponse({
        attempt: {
          id: attempt.id,
          status: attempt.status,
          test_title: test.title,
          topic_title: test.topic_title,
          finished_at: attempt.finished_at,
          time_spent_seconds: attempt.time_spent_seconds,
          results_hidden: !visible,
          total_questions: visible ? attempt.total_questions : null,
          correct_count: visible ? attempt.correct_count : null,
          earned_points: visible ? attempt.earned_points : null,
          max_points: visible ? attempt.max_points : null,
          percentage: visible ? attempt.percentage : null,
          grade: visible ? attempt.grade : null,
          passed: visible ? Boolean(attempt.passed) : null,
          review
        }
      });
    }

    // Собираем вопросы строго без правильных ответов и пояснений!
    const order = JSON.parse(attempt.question_order_json || '[]');
    const qIds = order.map((o) => Number(o.question_id)).filter(Number.isFinite);
    const placeholders = qIds.map(() => '?').join(',');

    const qRes = qIds.length
      ? await db
          .prepare(
            `SELECT id, question_type, question_text, points
             FROM questions WHERE id IN (${placeholders})`
          )
          .bind(...qIds)
          .all()
      : { results: [] };
    const qMap = new Map((qRes.results || []).map((q) => [q.id, q]));

    const aRes = qIds.length
      ? await db
          .prepare(
            `SELECT id, question_id, answer_text
             FROM answers WHERE question_id IN (${placeholders})`
          )
          .bind(...qIds)
          .all()
      : { results: [] };
    const aMap = new Map((aRes.results || []).map((a) => [a.id, a]));

    const savedRes = await db
      .prepare('SELECT question_id, selected_answer_ids_json, answer_text FROM student_answers WHERE attempt_id = ?')
      .bind(attempt.id)
      .all();
    const savedAnswers = {};
    for (const s of savedRes.results || []) {
      savedAnswers[s.question_id] = {
        selected_answer_ids: JSON.parse(s.selected_answer_ids_json || '[]'),
        answer_text: s.answer_text ?? ''
      };
    }

    const questions = order
      .map((item) => {
        const q = qMap.get(item.question_id);
        if (!q) return null;
        const options = (item.answer_ids || [])
          .map((aid) => aMap.get(aid))
          .filter(Boolean)
          .map((a) => ({ id: a.id, answer_text: a.answer_text }));
        return {
          id: q.id,
          question_type: q.question_type,
          question_text: q.question_text,
          points: q.points,
          options
        };
      })
      .filter(Boolean);

    const remainingSeconds = Math.max(
      0,
      Math.floor((new Date(attempt.expires_at).getTime() - Date.now()) / 1000)
    );

    return jsonResponse({
      attempt: {
        id: attempt.id,
        status: attempt.status,
        test_id: test.id,
        test_title: test.title,
        test_description: test.description,
        topic_title: test.topic_title,
        duration_minutes: test.duration_minutes,
        expires_at: attempt.expires_at,
        remaining_seconds: remainingSeconds,
        total_questions: questions.length
      },
      questions,
      saved_answers: savedAnswers
    });
  }

  // PUT /api/student/attempts/:attemptId/progress — сохранение промежуточных ответов в D1
  if (
    pathSegments.length === 3 &&
    pathSegments[0] === 'attempts' &&
    pathSegments[2] === 'progress' &&
    method === 'PUT'
  ) {
    const attemptId = Number(pathSegments[1]);
    const body = await readJsonBody(request);
    if (!Number.isFinite(attemptId) || !body) {
      return errorResponse('Некорректные данные прогресса.');
    }

    const attempt = await db
      .prepare('SELECT id, test_id, status, expires_at, question_order_json FROM test_attempts WHERE id = ? AND student_id = ?')
      .bind(attemptId, student.id)
      .first();

    if (!attempt) return errorResponse('Попытка не найдена.', 404);
    if (attempt.status !== 'in_progress') {
      return errorResponse('Тест уже завершён, изменение ответов невозможно.', 409);
    }

    const order = JSON.parse(attempt.question_order_json || '[]');
    const allowedQuestionIds = new Set(order.map((o) => Number(o.question_id)));

    const answersPayload = body.answers && typeof body.answers === 'object' ? body.answers : {};
    let savedCount = 0;

    for (const [qIdStr, val] of Object.entries(answersPayload)) {
      const qId = Number(qIdStr);
      if (!allowedQuestionIds.has(qId) || !val || typeof val !== 'object') continue;
      const selectedIds = Array.isArray(val.selected_answer_ids)
        ? val.selected_answer_ids.map(Number).filter(Number.isFinite)
        : [];
      const answerText = val.answer_text !== undefined && val.answer_text !== null
        ? String(val.answer_text).slice(0, 500)
        : null;

      await db
        .prepare(
          `INSERT INTO student_answers (attempt_id, question_id, selected_answer_ids_json, answer_text, updated_at)
           VALUES (?, ?, ?, ?, datetime('now'))
           ON CONFLICT(attempt_id, question_id) DO UPDATE SET
             selected_answer_ids_json = excluded.selected_answer_ids_json,
             answer_text = excluded.answer_text,
             updated_at = datetime('now')`
        )
        .bind(attempt.id, qId, JSON.stringify(selectedIds), answerText)
        .run();
      savedCount += 1;
    }

    return jsonResponse({ ok: true, saved_count: savedCount });
  }

  // POST /api/student/attempts/:attemptId/submit — финальная отправка и серверная проверка
  if (
    pathSegments.length === 3 &&
    pathSegments[0] === 'attempts' &&
    pathSegments[2] === 'submit' &&
    method === 'POST'
  ) {
    const attemptId = Number(pathSegments[1]);
    const body = await readJsonBody(request);
    if (!Number.isFinite(attemptId)) return errorResponse('Некорректный ID попытки.');

    const attempt = await db
      .prepare('SELECT * FROM test_attempts WHERE id = ? AND student_id = ?')
      .bind(attemptId, student.id)
      .first();

    if (!attempt) return errorResponse('Попытка не найдена.', 404);
    if (attempt.status !== 'in_progress') {
      return errorResponse('Эта попытка уже была отправлена ранее.', 409);
    }

    // Сохраняем финальный пакет ответов, если передан в теле submit
    if (body && body.answers && typeof body.answers === 'object') {
      const order = JSON.parse(attempt.question_order_json || '[]');
      const allowedQuestionIds = new Set(order.map((o) => Number(o.question_id)));
      for (const [qIdStr, val] of Object.entries(body.answers)) {
        const qId = Number(qIdStr);
        if (!allowedQuestionIds.has(qId) || !val || typeof val !== 'object') continue;
        const selectedIds = Array.isArray(val.selected_answer_ids)
          ? val.selected_answer_ids.map(Number).filter(Number.isFinite)
          : [];
        const answerText = val.answer_text !== undefined && val.answer_text !== null
          ? String(val.answer_text).slice(0, 500)
          : null;

        await db
          .prepare(
            `INSERT INTO student_answers (attempt_id, question_id, selected_answer_ids_json, answer_text, updated_at)
             VALUES (?, ?, ?, ?, datetime('now'))
             ON CONFLICT(attempt_id, question_id) DO UPDATE SET
               selected_answer_ids_json = excluded.selected_answer_ids_json,
               answer_text = excluded.answer_text,
               updated_at = datetime('now')`
          )
          .bind(attempt.id, qId, JSON.stringify(selectedIds), answerText)
          .run();
      }
    }

    const test = await db.prepare('SELECT * FROM tests WHERE id = ?').bind(attempt.test_id).first();
    const settings = await getPlatformSettings(db);

    const result = await finalizeAttempt(db, attempt, test, settings);
    if (!result) {
      return errorResponse('Попытка уже была завершена.', 409);
    }

    const visible = settings.show_results_to_students && Boolean(test.show_results);

    return jsonResponse({
      ok: true,
      message: 'Тест успешно отправлен и проверен.',
      results_hidden: !visible,
      result: visible
        ? {
            ...result,
            review: settings.show_explanations_to_students ? result.review : []
          }
        : {
            attempt_id: result.attempt_id,
            status: 'completed',
            time_spent_seconds: result.time_spent_seconds
          }
    });
  }

  return errorResponse('Маршрут ученика не найден.', 404);
}
