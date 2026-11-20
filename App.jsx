import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api/client.js';
import StudentPortal from './components/StudentPortal.jsx';
import TestRunner from './components/TestRunner.jsx';
import TeacherAuth from './components/TeacherAuth.jsx';
import TeacherDashboard from './components/TeacherDashboard.jsx';

export default function App() {
  const [mode, setMode] = useState(() =>
    window.location.pathname.startsWith('/teacher') ? 'teacher' : 'student'
  );
  const [config, setConfig] = useState(null);
  const [student, setStudent] = useState(null);
  const [teacher, setTeacher] = useState(null);
  const [activeAttemptId, setActiveAttemptId] = useState(null);
  const [toast, setToast] = useState('');

  const showToast = useCallback((message) => {
    setToast(message);
    setTimeout(() => {
      setToast((cur) => (cur === message ? '' : cur));
    }, 3500);
  }, []);

  useEffect(() => {
    api.getConfig().then(setConfig).catch(() => {});
    api.studentMe().then((res) => setStudent(res.student)).catch(() => setStudent(null));
    api.teacherMe().then((res) => setTeacher(res.teacher)).catch(() => setTeacher(null));
  }, []);

  function switchMode(nextMode) {
    if (activeAttemptId) {
      if (!window.confirm('Вы находитесь в процессе тестирования. Выйти из теста?')) return;
      setActiveAttemptId(null);
    }
    setMode(nextMode);
    const targetPath = nextMode === 'teacher' ? '/teacher' : '/';
    window.history.pushState({}, '', targetPath);
  }

  async function handleStudentLogout() {
    await api.studentLogout().catch(() => {});
    setStudent(null);
    setActiveAttemptId(null);
    showToast('Вы вышли из кабинета ученика.');
  }

  async function handleTeacherLogout() {
    await api.teacherLogout().catch(() => {});
    setTeacher(null);
    showToast('Сессия учителя завершена.');
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand" onClick={() => switchMode('student')}>
            <div className="brand-logo">I8</div>
            <div>
              <div className="brand-title">{config?.app_name || 'Informatika 8 — Online Test'}</div>
              <div className="brand-sub">Информатика • 8 класс • Онлайн-тестирование</div>
            </div>
          </div>

          <nav className="topbar-actions">
            <button
              className={`btn btn-sm ${mode === 'student' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => switchMode('student')}
            >
              Ученикам
            </button>
            <button
              className={`btn btn-sm ${mode === 'teacher' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => switchMode('teacher')}
            >
              Кабинет учителя
            </button>
          </nav>
        </div>
      </header>

      <main className="container">
        {mode === 'student' ? (
          activeAttemptId ? (
            <TestRunner
              attemptId={activeAttemptId}
              onExit={() => setActiveAttemptId(null)}
              showToast={showToast}
            />
          ) : (
            <StudentPortal
              config={config}
              student={student}
              onLoginSuccess={setStudent}
              onLogout={handleStudentLogout}
              onOpenAttempt={setActiveAttemptId}
              showToast={showToast}
            />
          )
        ) : teacher ? (
          <TeacherDashboard
            teacher={teacher}
            onLogout={handleTeacherLogout}
            showToast={showToast}
          />
        ) : (
          <TeacherAuth
            config={config}
            onSuccess={setTeacher}
            showToast={showToast}
          />
        )}
      </main>

      <footer className="footer">
        <strong>Informatika 8 — Online Test</strong> • Учебная программа по информатике (8 класс),
        составители: {config?.curriculum_authors || 'Ибирайым кызы А., Н. Н. Осипова'} • Работает на
        Cloudflare Pages, Workers и D1
      </footer>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
