import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import TurnstileWidget from './TurnstileWidget.jsx';

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatTime(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m} мин ${String(r).padStart(2, '0')} сек`;
}

export default function StudentPortal({
  config,
  student,
  onLoginSuccess,
  onLogout,
  onOpenAttempt,
  showToast
}) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [tests, setTests] = useState([]);
  const [history, setHistory] = useState([]);
  const [loadingTests, setLoadingTests] = useState(false);
  const [startingTestId, setStartingTestId] = useState(null);
  const [topicFilter, setTopicFilter] = useState('all');

  async function loadStudentTests() {
    setLoadingTests(true);
    setError('');
    try {
      const data = await api.studentTests();
      setTests(data.tests || []);
      setHistory(data.history || []);
    } catch (err) {
      if (err.status === 401) {
        onLogout();
      } else {
        setError(err.message);
      }
    } finally {
      setLoadingTests(false);
    }
  }

  useEffect(() => {
    if (student) {
      loadStudentTests();
    }
  }, [student]);

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api.studentLogin({
        first_name: firstName,
        last_name: lastName,
        join_code: joinCode,
        turnstile_token: turnstileToken
      });
      onLoginSuccess(data.student);
      showToast(`Добро пожаловать, ${data.student.first_name}!`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleStartTest(test) {
    setStartingTestId(test.id);
    setError('');
    try {
      const res = await api.startTest(test.id);
      onOpenAttempt(res.attempt_id);
    } catch (err) {
      setError(err.message);
    } finally {
      setStartingTestId(null);
    }
  }

  // Экран входа ученика
  if (!student) {
    return (
      <div>
        <div className="hero-card">
          <h1>Добро пожаловать в {config?.app_name || 'Informatika 8 — Online Test'}</h1>
          <p>
            Онлайн-платформа тестирования по информатике для учеников 8-го класса.
            Регистрация не требуется — введите имя, фамилию и код подключения, полученный от учителя.
          </p>
        </div>

        <div className="auth-wrapper">
          <div className="card">
            <h2 style={{ marginTop: 0, marginBottom: '0.4rem' }}>Вход ученика</h2>
            <p style={{ marginTop: 0, color: 'var(--text-subtle)', fontSize: '0.9rem' }}>
              После входа вы увидите тесты, назначенные именно вашему классу.
            </p>

            {error && <div className="alert alert-error">{error}</div>}

            <form className="form-grid" onSubmit={handleLogin}>
              <div className="field">
                <label htmlFor="student-first-name">Имя</label>
                <input
                  id="student-first-name"
                  className="input"
                  placeholder="Например: Айбек"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  minLength={2}
                  maxLength={60}
                />
              </div>

              <div className="field">
                <label htmlFor="student-last-name">Фамилия</label>
                <input
                  id="student-last-name"
                  className="input"
                  placeholder="Например: Токтосунов"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  minLength={2}
                  maxLength={60}
                />
              </div>

              <div className="field">
                <label htmlFor="student-join-code">Код подключения класса</label>
                <input
                  id="student-join-code"
                  className="input"
                  placeholder="Например: INFO8A"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  required
                  minLength={3}
                  maxLength={24}
                  style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}
                />
              </div>

              <TurnstileWidget
                siteKey={config?.turnstile_site_key}
                onVerify={setTurnstileToken}
              />

              <button className="btn btn-primary" type="submit" disabled={loading}>
                {loading ? 'Выполняется вход...' : 'Войти'}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  const topics = Array.from(new Set(tests.map((t) => t.topic_title)));
  const visibleTests =
    topicFilter === 'all' ? tests : tests.filter((t) => t.topic_title === topicFilter);

  return (
    <div>
      <div className="hero-card">
        <div className="flex-between">
          <div>
            <h1>
              Здравствуйте, {student.first_name} {student.last_name}!
            </h1>
            <p>
              Ваш класс: <strong>{student.class_name}</strong>. Выберите доступный тест для
              прохождения. Все ответы сохраняются автоматически.
            </p>
          </div>
          <button
            className="btn"
            style={{ background: 'rgba(255,255,255,0.16)', color: '#fff', borderColor: 'rgba(255,255,255,0.35)' }}
            onClick={onLogout}
          >
            Выйти
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="flex-between" style={{ marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>Доступные тесты ({visibleTests.length})</h2>
        <div className="flex-gap">
          <select
            className="select"
            style={{ width: 'auto', minWidth: 220 }}
            value={topicFilter}
            onChange={(e) => setTopicFilter(e.target.value)}
          >
            <option value="all">Все темы программы</option>
            {topics.map((tp) => (
              <option key={tp} value={tp}>
                {tp}
              </option>
            ))}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={loadStudentTests} disabled={loadingTests}>
            Обновить
          </button>
        </div>
      </div>

      {loadingTests ? (
        <div className="card">Загрузка списка тестов...</div>
      ) : visibleTests.length === 0 ? (
        <div className="card">Для вашего класса пока нет назначенных тестов.</div>
      ) : (
        <div className="grid-cards" style={{ marginBottom: '2rem' }}>
          {visibleTests.map((t) => (
            <div className="card card-hover" key={t.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div className="flex-between">
                <span className={`badge badge-${t.status}`}>{t.status_label}</span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-subtle)', fontWeight: 600 }}>
                  {t.kind === 'practice' ? 'Практика' : 'Тест'}
                </span>
              </div>

              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 600 }}>
                  {t.topic_title}
                </div>
                <h3 style={{ margin: '0.2rem 0 0.35rem', fontSize: '1.08rem' }}>{t.title}</h3>
                {t.description && (
                  <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                    {t.description}
                  </p>
                )}
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '0.5rem',
                  padding: '0.7rem',
                  background: 'var(--surface-soft)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.85rem'
                }}
              >
                <div>
                  <span style={{ color: 'var(--text-subtle)' }}>Вопросов:</span>{' '}
                  <strong>{t.question_count}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-subtle)' }}>Время:</span>{' '}
                  <strong>{t.duration_minutes} мин</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-subtle)' }}>Попытки:</span>{' '}
                  <strong>
                    {t.attempts_used} / {t.allowed_attempts}
                  </strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-subtle)' }}>Проходной:</span>{' '}
                  <strong>{t.passing_score}%</strong>
                </div>
              </div>

              {t.last_result && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.55rem 0.75rem',
                    background: '#f8faff',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.86rem'
                  }}
                >
                  <span>
                    Последний результат: <strong>{t.last_result.percentage}%</strong> (
                    {t.last_result.correct_count}/{t.last_result.total_questions})
                  </span>
                  <span className={`badge badge-grade-${t.last_result.grade}`}>
                    Оценка {t.last_result.grade}
                  </span>
                </div>
              )}

              {t.status_reason && !t.can_start && (
                <div style={{ fontSize: '0.82rem', color: 'var(--text-subtle)' }}>
                  {t.status_reason}
                </div>
              )}

              <div style={{ marginTop: 'auto', paddingTop: '0.25rem' }}>
                {t.can_start ? (
                  <button
                    className="btn btn-primary"
                    style={{ width: '100%' }}
                    onClick={() => handleStartTest(t)}
                    disabled={startingTestId === t.id}
                  >
                    {startingTestId === t.id
                      ? 'Запуск...'
                      : t.active_attempt_id
                      ? 'Продолжить прохождение'
                      : 'Начать тестирование'}
                  </button>
                ) : (
                  <button className="btn btn-ghost" style={{ width: '100%' }} disabled>
                    {t.status_label}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* История тестирований ученика */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>История моих тестирований</h3>
        {history.length === 0 ? (
          <p style={{ color: 'var(--text-subtle)', marginBottom: 0 }}>
            Вы ещё не завершили ни одного теста.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Тест</th>
                  <th>Тема</th>
                  <th>Дата</th>
                  <th>Время</th>
                  <th>Результат</th>
                  <th>Оценка</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>
                      <strong>{h.test_title}</strong>
                    </td>
                    <td>{h.topic_title}</td>
                    <td>{formatDate(h.finished_at)}</td>
                    <td>{formatTime(h.time_spent_seconds)}</td>
                    <td>
                      {h.results_hidden
                        ? 'Скрыто учителем'
                        : `${h.correct_count}/${h.total_questions} (${h.percentage}%)`}
                    </td>
                    <td>
                      {h.results_hidden ? (
                        <span className="badge badge-unavailable">—</span>
                      ) : (
                        <span className={`badge badge-grade-${h.grade}`}>Оценка {h.grade}</span>
                      )}
                    </td>
                    <td>
                      {!h.results_hidden && (
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => onOpenAttempt(h.id)}
                        >
                          Подробнее
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
