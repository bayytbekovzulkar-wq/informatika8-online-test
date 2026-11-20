// Проверка серверной авторизации для ученика и учителя

import { verifySessionToken } from './crypto.js';
import {
  STUDENT_COOKIE,
  TEACHER_COOKIE,
  getSessionSecret,
  parseCookies
} from './http.js';

export async function getAuthenticatedTeacher(request, env) {
  const cookies = parseCookies(request);
  const token = cookies[TEACHER_COOKIE];
  if (!token) return null;

  const payload = await verifySessionToken(token, getSessionSecret(env));
  if (!payload || payload.role !== 'teacher' || !payload.teacherId) {
    return null;
  }

  const teacher = await env.DB.prepare(
    'SELECT id, username, full_name, created_at FROM teachers WHERE id = ?'
  )
    .bind(payload.teacherId)
    .first();

  if (!teacher) return null;
  return { ...teacher, sessionExp: payload.exp };
}

export async function getAuthenticatedStudent(request, env) {
  const cookies = parseCookies(request);
  const token = cookies[STUDENT_COOKIE];
  if (!token) return null;

  const payload = await verifySessionToken(token, getSessionSecret(env));
  if (!payload || payload.role !== 'student' || !payload.studentId || !payload.classId) {
    return null;
  }

  const student = await env.DB.prepare(
    `SELECT s.id, s.first_name, s.last_name, s.class_id, c.name AS class_name, c.join_code
     FROM students s
     JOIN classes c ON c.id = s.class_id
     WHERE s.id = ? AND s.class_id = ?`
  )
    .bind(payload.studentId, payload.classId)
    .first();

  if (!student) return null;
  return { ...student, sessionExp: payload.exp };
}
