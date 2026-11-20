// Клиент для взаимодействия с Cloudflare Workers API (/api/*)

async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    const err = new Error((data && data.error) || `Ошибка сервера (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  getConfig: () => request('/config'),

  // ===== Ученик =====
  studentLogin: (payload) =>
    request('/student/login', { method: 'POST', body: JSON.stringify(payload) }),
  studentLogout: () => request('/student/logout', { method: 'POST' }),
  studentMe: () => request('/student/me'),
  studentTests: () => request('/student/tests'),
  startTest: (testId) => request(`/student/tests/${testId}/start`, { method: 'POST' }),
  getAttempt: (attemptId) => request(`/student/attempts/${attemptId}`),
  saveProgress: (attemptId, answers) =>
    request(`/student/attempts/${attemptId}/progress`, {
      method: 'PUT',
      body: JSON.stringify({ answers })
    }),
  submitAttempt: (attemptId, answers) =>
    request(`/student/attempts/${attemptId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ answers })
    }),

  // ===== Учитель =====
  teacherSetupStatus: () => request('/teacher/setup-status'),
  teacherSetup: (payload) =>
    request('/teacher/setup', { method: 'POST', body: JSON.stringify(payload) }),
  teacherLogin: (payload) =>
    request('/teacher/login', { method: 'POST', body: JSON.stringify(payload) }),
  teacherLogout: () => request('/teacher/logout', { method: 'POST' }),
  teacherMe: () => request('/teacher/me'),
  teacherChangePassword: (payload) =>
    request('/teacher/change-password', { method: 'POST', body: JSON.stringify(payload) }),

  teacherDashboard: () => request('/teacher/dashboard'),

  getClasses: () => request('/teacher/classes'),
  createClass: (payload) =>
    request('/teacher/classes', { method: 'POST', body: JSON.stringify(payload) }),
  updateClass: (id, payload) =>
    request(`/teacher/classes/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteClass: (id) => request(`/teacher/classes/${id}`, { method: 'DELETE' }),
  getClassStudents: (id) => request(`/teacher/classes/${id}/students`),

  getStudents: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined)
    ).toString();
    return request(`/teacher/students${qs ? `?${qs}` : ''}`);
  },
  deleteStudent: (id) => request(`/teacher/students/${id}`, { method: 'DELETE' }),
  getStudentHistory: (id) => request(`/teacher/students/${id}/history`),
  grantRetake: (studentId, testId) =>
    request(`/teacher/students/${studentId}/grant-retake`, {
      method: 'POST',
      body: JSON.stringify({ test_id: testId })
    }),

  getTopics: () => request('/teacher/topics'),
  createTopic: (payload) =>
    request('/teacher/topics', { method: 'POST', body: JSON.stringify(payload) }),

  getTests: () => request('/teacher/tests'),
  getTestDetail: (id) => request(`/teacher/tests/${id}`),
  createTest: (payload) =>
    request('/teacher/tests', { method: 'POST', body: JSON.stringify(payload) }),
  updateTest: (id, payload) =>
    request(`/teacher/tests/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteTest: (id) => request(`/teacher/tests/${id}`, { method: 'DELETE' }),

  addQuestion: (testId, payload) =>
    request(`/teacher/tests/${testId}/questions`, { method: 'POST', body: JSON.stringify(payload) }),
  updateQuestion: (questionId, payload) =>
    request(`/teacher/questions/${questionId}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteQuestion: (questionId) =>
    request(`/teacher/questions/${questionId}`, { method: 'DELETE' }),

  getResults: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined)
    ).toString();
    return request(`/teacher/results${qs ? `?${qs}` : ''}`);
  },
  deleteResult: (attemptId) => request(`/teacher/results/${attemptId}`, { method: 'DELETE' }),
  getExportUrl: (params = {}, format = 'csv') => {
    const qs = new URLSearchParams({
      ...Object.fromEntries(
        Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined)
      ),
      format
    }).toString();
    return `/api/teacher/results/export?${qs}`;
  },

  getSettings: () => request('/teacher/settings'),
  updateSettings: (payload) =>
    request('/teacher/settings', { method: 'PUT', body: JSON.stringify(payload) })
};
