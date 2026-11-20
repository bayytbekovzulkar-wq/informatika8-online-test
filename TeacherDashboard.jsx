import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import TeacherTestEditor from './TeacherTestEditor.jsx';

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

function formatDuration(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m} мин ${String(r).padStart(2, '0')} сек`;
}

export default function TeacherDashboard({ teacher, onLogout, showToast }) {
  const [tab, setTab] = useState('overview');
  const [error, setError] = useState('');

  // Общие справочники
  const [classes, setClasses] = useState([]);
  const [topics, setTopics] = useState([]);
  const [tests, setTests] = useState([]);

  // Главная статистика
  const [dashboard, setDashboard] = useState(null);

  // Классы
  const [newClassName, setNewClassName] = useState('');
  const [newClassCode, setNewClassCode] = useState('');
  const [editingClass, setEditingClass] = useState(null);
  const [classStudentsModal, setClassStudentsModal] = useState(null);

  // Ученики
  const [students, setStudents] = useState([]);
  const [studentSearch, setStudentSearch] = useState('');
  const [studentClassFilter, setStudentClassFilter] = useState('');
  const [studentHistoryModal, setStudentHistoryModal] = useState(null);
  const [retakeTestId, setRetakeTestId] = useState('');

  // Тесты
  const [editingTestId, setEditingTestId] = useState(null);
  const [newTestForm, setNewTestForm] = useState({
    title: '',
    description: '',
    topic_id: '',
    class_id: '',
    kind: 'test',
    duration_minutes: 20,
    passing_score: 50,
    max_attempts: 1,
    is_active: true
  });

  // Результаты
  const [results, setResults] = useState([]);
  const [resFilters, setResFilters] = useState({
    class_id: '',
    student_id: '',
    topic_id: '',
    test_id: '',
    date_from: '',
    date_to: '',
    search: '',
    sort: 'date_desc'
  });

  // Настройки и смена пароля
  const [settingsForm, setSettingsForm] = useState(null);
  const [pwdForm, setPwdForm] = useState({ current_password: '', new_password: '', confirm: '' });

  async function loadCore() {
    try {
      const [clsRes, topRes, tstRes] = await Promise.all([
        api.getClasses(),
        api.getTopics(),
        api.getTests()
      ]);
      setClasses(clsRes.classes || []);
      setTopics(topRes.topics || []);
      setTests(tstRes.tests || []);
      if (!newTestForm.topic_id && topRes.topics?.length) {
        setNewTestForm((p) => ({ ...p, topic_id: String(topRes.topics[0].id) }));
      }
    } catch (err) {
      if (err.status === 401) onLogout();
      else setError(err.message);
    }
  }

  async function loadDashboard() {
    try {
      const data = await api.teacherDashboard();
      setDashboard(data);
    } catch (err) {
      if (err.status === 401) onLogout();
      else setError(err.message);
    }
  }

  async function loadStudents() {
    try {
      const data = await api.getStudents({
        class_id: studentClassFilter,
        search: studentSearch
      });
      setStudents(data.students || []);
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadResults(filters = resFilters) {
    try {
      const data = await api.getResults(filters);
      setResults(data.results || []);
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadSettings() {
    try {
      const data = await api.getSettings();
      setSettingsForm(data.settings);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadCore();
    loadDashboard();
  }, []);

  useEffect(() => {
    setError('');
    if (tab === 'overview') loadDashboard();
    if (tab === 'classes' || tab === 'tests') loadCore();
    if (tab === 'students') loadStudents();
    if (tab === 'results') loadResults();
    if (tab === 'settings') loadSettings();
  }, [tab]);

  // ==================== Действия с классами ====================
  async function handleCreateClass(e) {
    e.preventDefault();
    setError('');
    try {
      await api.createClass({ name: newClassName, join_code: newClassCode || undefined });
      setNewClassName('');
      setNewClassCode('');
      showToast('Класс создан.');
      await loadCore();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleUpdateClass(e) {
    e.preventDefault();
    try {
      await api.updateClass(editingClass.id, {
        name: editingClass.name,
        join_code: editingClass.join_code
      });
      setEditingClass(null);
      showToast('Класс обновлён.');
      await loadCore();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRegenerateCode(cls) {
    try {
      await api.updateClass(cls.id, { name: cls.name, regenerate_code: true });
      showToast(`Новый код подключения для класса ${cls.name} создан.`);
      await loadCore();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteClass(cls) {
    if (!window.confirm(`Удалить класс «${cls.name}» и всех его учеников?`)) return;
    try {
      await api.deleteClass(cls.id);
      showToast('Класс удалён.');
      await loadCore();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleOpenClassStudents(cls) {
    try {
      const res = await api.getClassStudents(cls.id);
      setClassStudentsModal({ cls, students: res.students || [] });
    } catch (err) {
      setError(err.message);
    }
  }

  // ==================== Действия с учениками ====================
  async function handleOpenStudentHistory(st) {
    try {
      const data = await api.getStudentHistory(st.id);
      setStudentHistoryModal(data);
      setRetakeTestId(tests[0]?.id ? String(tests[0].id) : '');
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleGrantRetake(studentId, testId) {
    try {
      await api.grantRetake(studentId, Number(testId));
      showToast('Ученику выдана дополнительная попытка.');
      if (studentHistoryModal && studentHistoryModal.student.id === studentId) {
        const refreshed = await api.getStudentHistory(studentId);
        setStudentHistoryModal(refreshed);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteStudent(st) {
    if (!window.confirm(`Удалить ученика «${st.last_name} ${st.first_name}» и все его результаты?`)) return;
    try {
      await api.deleteStudent(st.id);
      showToast('Запись ученика удалена.');
      await loadStudents();
    } catch (err) {
      setError(err.message);
    }
  }

  // ==================== Действия с тестами ====================
  async function handleCreateTest(e) {
    e.preventDefault();
    setError('');
    try {
      const res = await api.createTest({
        ...newTestForm,
        topic_id: Number(newTestForm.topic_id),
        class_id: newTestForm.class_id ? Number(newTestForm.class_id) : null
      });
      setNewTestForm({ ...newTestForm, title: '', description: '' });
      showToast('Тест создан! Теперь добавьте вопросы.');
      await loadCore();
      setEditingTestId(res.test.id);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleToggleTest(t) {
    try {
      await api.updateTest(t.id, { is_active: !t.is_active });
      showToast(t.is_active ? 'Тест отключён.' : 'Тест включён.');
      await loadCore();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteTest(t) {
    if (!window.confirm(`Удалить тест «${t.title}» со всеми вопросами и попытками?`)) return;
    try {
      await api.deleteTest(t.id);
      showToast('Тест удалён.');
      await loadCore();
    } catch (err) {
      setError(err.message);
    }
  }

  // ==================== Настройки и пароль ====================
  async function handleSaveSettings(e) {
    e.preventDefault();
    setError('');
    try {
      const res = await api.updateSettings(settingsForm);
      setSettingsForm(res.settings);
      showToast('Настройки платформы сохранены.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    setError('');
    if (pwdForm.new_password !== pwdForm.confirm) {
      setError('Новый пароль и подтверждение не совпадают.');
      return;
    }
    try {
      await api.teacherChangePassword({
        current_password: pwdForm.current_password,
        new_password: pwdForm.new_password
      });
      setPwdForm({ current_password: '', new_password: '', confirm: '' });
      showToast('Пароль учителя успешно изменён.');
    } catch (err) {
      setError(err.message);
    }
  }

  // Если открыт редактор конкретного теста
  if (editingTestId) {
    return (
      <TeacherTestEditor
        testId={editingTestId}
        topics={topics}
        classes={classes}
        onBack={() => {
          setEditingTestId(null);
          loadCore();
        }}
        showToast={showToast}
      />
    );
  }

  const totalDistCount = (dashboard?.grade_distribution || []).reduce((acc, g) => acc + Number(g.cnt || 0), 0);

  return (
    <div>
      <div className="hero-card" style={{ padding: '1.5rem 1.8rem' }}>
        <div className="flex-between">
          <div>
            <h1 style={{ fontSize: '1.45rem' }}>Кабинет учителя</h1>
            <p>
              Администратор: <strong>{teacher.full_name}</strong> ({teacher.username})
            </p>
          </div>
          <button
            className="btn"
            style={{ background: 'rgba(255,255,255,0.16)', color: '#fff', borderColor: 'rgba(255,255,255,0.35)' }}
            onClick={onLogout}
          >
            Выйти из кабинета
          </button>
        </div>
      </div>

      <div className="tabs">
        {[
          { id: 'overview', label: 'Главная панель' },
          { id: 'classes', label: 'Классы' },
          { id: 'students', label: 'Ученики' },
          { id: 'tests', label: 'Тесты и программа' },
          { id: 'results', label: 'Результаты' },
          { id: 'settings', label: 'Настройки' }
        ].map((item) => (
          <button
            key={item.id}
            className={`tab-btn ${tab === item.id ? 'active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* ==================== 1. ГЛАВНАЯ ПАНЕЛЬ ==================== */}
      {tab === 'overview' && (
        <div>
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-label">Всего учеников</div>
              <div className="kpi-value">{dashboard?.stats?.total_students ?? 0}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Создано тестов</div>
              <div className="kpi-value">{dashboard?.stats?.total_tests ?? 0}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Завершённых тестирований</div>
              <div className="kpi-value">{dashboard?.stats?.completed_attempts ?? 0}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Средний балл / %</div>
              <div className="kpi-value">
                {dashboard?.stats?.avg_grade || 0}{' '}
                <span style={{ fontSize: '0.95rem', color: 'var(--text-subtle)' }}>
                  ({dashboard?.stats?.avg_percentage || 0}%)
                </span>
              </div>
            </div>
          </div>

          <div className="form-grid-2" style={{ marginBottom: '1.25rem' }}>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Распределение оценок</h3>
              {[5, 4, 3, 2].map((g) => {
                const row = (dashboard?.grade_distribution || []).find((x) => Number(x.grade) === g);
                const cnt = Number(row?.cnt || 0);
                const pct = totalDistCount ? Math.round((cnt / totalDistCount) * 100) : 0;
                return (
                  <div className="bar-row" key={g}>
                    <span>
                      <span className={`badge badge-grade-${g}`}>Оценка {g}</span>
                    </span>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <strong style={{ textAlign: 'right' }}>{cnt}</strong>
                  </div>
                );
              })}
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>Успеваемость по темам</h3>
              {(dashboard?.topic_stats || []).map((tp) => (
                <div className="bar-row" key={tp.id} style={{ gridTemplateColumns: '1fr 110px 64px' }}>
                  <span style={{ fontSize: '0.85rem' }}>{tp.title}</span>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${tp.avg_percentage || 0}%` }} />
                  </div>
                  <strong style={{ textAlign: 'right', fontSize: '0.85rem' }}>
                    {tp.avg_percentage ? `${tp.avg_percentage}%` : '—'}
                  </strong>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Последние результаты</h3>
            {(dashboard?.recent_results || []).length === 0 ? (
              <p style={{ color: 'var(--text-subtle)', marginBottom: 0 }}>
                Пока нет завершённых тестирований.
              </p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Ученик</th>
                      <th>Класс</th>
                      <th>Тест</th>
                      <th>Результат</th>
                      <th>Оценка</th>
                      <th>Дата</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.recent_results.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <strong>
                            {r.last_name} {r.first_name}
                          </strong>
                        </td>
                        <td>{r.class_name}</td>
                        <td>{r.test_title}</td>
                        <td>
                          {r.correct_count}/{r.total_questions} ({r.percentage}%)
                        </td>
                        <td>
                          <span className={`badge badge-grade-${r.grade}`}>Оценка {r.grade}</span>
                        </td>
                        <td>{formatDate(r.finished_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== 2. КЛАССЫ ==================== */}
      {tab === 'classes' && (
        <div className="form-grid">
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Создать новый класс</h3>
            <form className="form-grid-3" onSubmit={handleCreateClass} style={{ alignItems: 'end' }}>
              <div className="field">
                <label>Название класса</label>
                <input
                  className="input"
                  placeholder="Например: 8-Б"
                  value={newClassName}
                  onChange={(e) => setNewClassName(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label>Код подключения (оставьте пустым для автогенерации)</label>
                <input
                  className="input"
                  placeholder="Например: INFO8B"
                  value={newClassCode}
                  onChange={(e) => setNewClassCode(e.target.value.toUpperCase())}
                />
              </div>
              <button className="btn btn-primary" type="submit">
                + Создать класс
              </button>
            </form>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Список классов ({classes.length})</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Класс</th>
                    <th>Код подключения</th>
                    <th>Учеников</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {classes.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.name}</strong>
                      </td>
                      <td>
                        <code
                          style={{
                            padding: '0.2rem 0.55rem',
                            borderRadius: 6,
                            background: 'var(--primary-soft)',
                            color: 'var(--primary)',
                            fontWeight: 700
                          }}
                        >
                          {c.join_code}
                        </code>
                      </td>
                      <td>{c.student_count}</td>
                      <td>
                        <div className="flex-gap">
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleOpenClassStudents(c)}
                          >
                            Ученики
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => setEditingClass({ ...c })}
                          >
                            Изменить
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleRegenerateCode(c)}
                          >
                            Новый код
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDeleteClass(c)}
                          >
                            Удалить
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 3. УЧЕНИКИ ==================== */}
      {tab === 'students' && (
        <div className="card">
          <div className="flex-between" style={{ marginBottom: '1rem' }}>
            <h3 style={{ margin: 0 }}>Ученики ({students.length})</h3>
            <div className="flex-gap">
              <input
                className="input"
                style={{ width: 230 }}
                placeholder="Поиск по имени или фамилии..."
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
              />
              <select
                className="select"
                style={{ width: 160 }}
                value={studentClassFilter}
                onChange={(e) => setStudentClassFilter(e.target.value)}
              >
                <option value="">Все классы</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button className="btn btn-primary btn-sm" onClick={loadStudents}>
                Найти
              </button>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Фамилия и Имя</th>
                  <th>Класс</th>
                  <th>Пройдено тестов</th>
                  <th>Средний %</th>
                  <th>Средняя оценка</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {students.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-subtle)' }}>
                      Ученики не найдены.
                    </td>
                  </tr>
                ) : (
                  students.map((st) => (
                    <tr key={st.id}>
                      <td>
                        <strong>
                          {st.last_name} {st.first_name}
                        </strong>
                      </td>
                      <td>{st.class_name}</td>
                      <td>{st.attempts_count}</td>
                      <td>{st.avg_percentage ? `${st.avg_percentage}%` : '—'}</td>
                      <td>{st.avg_grade || '—'}</td>
                      <td>
                        <div className="flex-gap">
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleOpenStudentHistory(st)}
                          >
                            История и пересдача
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDeleteStudent(st)}
                          >
                            Удалить
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================== 4. ТЕСТЫ И ПРОГРАММА ==================== */}
      {tab === 'tests' && (
        <div className="form-grid">
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Создать новый тест или практическое задание</h3>
            <form className="form-grid" onSubmit={handleCreateTest}>
              <div className="form-grid-2">
                <div className="field">
                  <label>Название</label>
                  <input
                    className="input"
                    placeholder="Например: Практикум по двоичной арифметике"
                    value={newTestForm.title}
                    onChange={(e) => setNewTestForm({ ...newTestForm, title: e.target.value })}
                    required
                  />
                </div>
                <div className="field">
                  <label>Тема учебной программы</label>
                  <select
                    className="select"
                    value={newTestForm.topic_id}
                    onChange={(e) => setNewTestForm({ ...newTestForm, topic_id: e.target.value })}
                    required
                  >
                    {topics.map((tp) => (
                      <option key={tp.id} value={tp.id}>
                        {tp.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-grid-3">
                <div className="field">
                  <label>Класс</label>
                  <select
                    className="select"
                    value={newTestForm.class_id}
                    onChange={(e) => setNewTestForm({ ...newTestForm, class_id: e.target.value })}
                  >
                    <option value="">Все классы</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Тип</label>
                  <select
                    className="select"
                    value={newTestForm.kind}
                    onChange={(e) => setNewTestForm({ ...newTestForm, kind: e.target.value })}
                  >
                    <option value="test">Тест</option>
                    <option value="practice">Практическое задание</option>
                  </select>
                </div>
                <div className="field">
                  <label>Время (мин)</label>
                  <input
                    type="number"
                    min={1}
                    max={240}
                    className="input"
                    value={newTestForm.duration_minutes}
                    onChange={(e) =>
                      setNewTestForm({ ...newTestForm, duration_minutes: Number(e.target.value) })
                    }
                  />
                </div>
              </div>

              <div>
                <button className="btn btn-primary" type="submit">
                  + Создать и перейти к добавлению вопросов
                </button>
              </div>
            </form>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Все тесты ({tests.length})</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Название</th>
                    <th>Тема</th>
                    <th>Класс</th>
                    <th>Вопросов</th>
                    <th>Время</th>
                    <th>Статус</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {tests.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <strong>{t.title}</strong>
                      </td>
                      <td style={{ fontSize: '0.84rem' }}>{t.topic_title}</td>
                      <td>{t.class_name || 'Все классы'}</td>
                      <td>{t.question_count}</td>
                      <td>{t.duration_minutes} мин</td>
                      <td>
                        <span className={`badge ${t.is_active ? 'badge-available' : 'badge-unavailable'}`}>
                          {t.is_active ? 'Включён' : 'Отключён'}
                        </span>
                      </td>
                      <td>
                        <div className="flex-gap">
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => setEditingTestId(t.id)}
                          >
                            Вопросы / Редактор
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleToggleTest(t)}
                          >
                            {t.is_active ? 'Выкл.' : 'Вкл.'}
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDeleteTest(t)}
                          >
                            Удалить
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>
              Учебная программа по информатике (8 класс)
            </h3>
            <p style={{ marginTop: '-0.3rem', color: 'var(--text-subtle)', fontSize: '0.88rem' }}>
              Составители учебной программы: <strong>Ибирайым кызы А., Н. Н. Осипова</strong>
            </p>
            <div className="grid-cards">
              {topics.map((tp) => (
                <div
                  key={tp.id}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '1rem',
                    background: 'var(--surface-soft)'
                  }}
                >
                  <div className="flex-between" style={{ marginBottom: '0.4rem' }}>
                    <strong style={{ color: 'var(--primary)' }}>{tp.title}</strong>
                    <span className="badge badge-completed">Тестов: {tp.tests_count}</span>
                  </div>
                  <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem', fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                    {(tp.subtopics || []).map((sub, i) => (
                      <li key={i}>{sub}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ==================== 5. РЕЗУЛЬТАТЫ И ЭКСПОРТ ==================== */}
      {tab === 'results' && (
        <div className="card">
          <div className="flex-between" style={{ marginBottom: '1rem' }}>
            <h3 style={{ margin: 0 }}>Результаты тестирований ({results.length})</h3>
            <div className="flex-gap">
              <a className="btn btn-secondary btn-sm" href={api.getExportUrl(resFilters, 'csv')}>
                Экспорт CSV
              </a>
              <a className="btn btn-primary btn-sm" href={api.getExportUrl(resFilters, 'xls')}>
                Экспорт Excel (.xls)
              </a>
            </div>
          </div>

          <div className="form-grid-3" style={{ marginBottom: '1rem' }}>
            <input
              className="input"
              placeholder="Поиск ученика, класса, теста..."
              value={resFilters.search}
              onChange={(e) => setResFilters({ ...resFilters, search: e.target.value })}
            />
            <select
              className="select"
              value={resFilters.class_id}
              onChange={(e) => setResFilters({ ...resFilters, class_id: e.target.value })}
            >
              <option value="">Все классы</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              className="select"
              value={resFilters.topic_id}
              onChange={(e) => setResFilters({ ...resFilters, topic_id: e.target.value })}
            >
              <option value="">Все темы</option>
              {topics.map((tp) => (
                <option key={tp.id} value={tp.id}>
                  {tp.title}
                </option>
              ))}
            </select>
            <select
              className="select"
              value={resFilters.test_id}
              onChange={(e) => setResFilters({ ...resFilters, test_id: e.target.value })}
            >
              <option value="">Все тесты</option>
              {tests.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
            <div className="flex-gap">
              <input
                type="date"
                className="input"
                style={{ flex: 1 }}
                value={resFilters.date_from}
                onChange={(e) => setResFilters({ ...resFilters, date_from: e.target.value })}
              />
              <input
                type="date"
                className="input"
                style={{ flex: 1 }}
                value={resFilters.date_to}
                onChange={(e) => setResFilters({ ...resFilters, date_to: e.target.value })}
              />
            </div>
            <div className="flex-gap">
              <select
                className="select"
                style={{ flex: 1 }}
                value={resFilters.sort}
                onChange={(e) => setResFilters({ ...resFilters, sort: e.target.value })}
              >
                <option value="date_desc">Сначала новые</option>
                <option value="grade_desc">Оценка: по убыванию</option>
                <option value="grade_asc">Оценка: по возрастанию</option>
                <option value="pct_desc">Процент: по убыванию</option>
                <option value="pct_asc">Процент: по возрастанию</option>
              </select>
              <button className="btn btn-primary btn-sm" onClick={() => loadResults(resFilters)}>
                Применить
              </button>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ученик</th>
                  <th>Класс</th>
                  <th>Тест / Тема</th>
                  <th>Дата</th>
                  <th>Ответы</th>
                  <th>%</th>
                  <th>Оценка</th>
                  <th>Время</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {results.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-subtle)' }}>
                      Результаты по выбранным фильтрам не найдены.
                    </td>
                  </tr>
                ) : (
                  results.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong>
                          {r.last_name} {r.first_name}
                        </strong>
                      </td>
                      <td>{r.class_name}</td>
                      <td>
                        <div>
                          <strong>{r.test_title}</strong>
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-subtle)' }}>
                          {r.topic_title}
                        </div>
                      </td>
                      <td style={{ fontSize: '0.84rem' }}>{formatDate(r.finished_at)}</td>
                      <td>
                        {r.correct_count}/{r.total_questions}
                      </td>
                      <td>
                        <strong>{r.percentage}%</strong>
                      </td>
                      <td>
                        <span className={`badge badge-grade-${r.grade}`}>Оценка {r.grade}</span>
                      </td>
                      <td style={{ fontSize: '0.84rem' }}>{formatDuration(r.time_spent_seconds)}</td>
                      <td>
                        <div className="flex-gap">
                          <button
                            className="btn btn-secondary btn-sm"
                            title="Разрешить повторное прохождение"
                            onClick={() => handleGrantRetake(r.student_id, r.test_id)}
                          >
                            +Попытка
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={async () => {
                              if (!window.confirm('Удалить эту запись результата?')) return;
                              await api.deleteResult(r.id);
                              showToast('Запись удалена.');
                              await loadResults();
                            }}
                          >
                            Удалить
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================== 6. НАСТРОЙКИ ==================== */}
      {tab === 'settings' && settingsForm && (
        <div className="form-grid-2">
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Система оценивания и публикация</h3>
            <form className="form-grid" onSubmit={handleSaveSettings}>
              <div className="field">
                <label>Минимальный % для оценки «5»</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  className="input"
                  value={settingsForm.grade_5_min}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, grade_5_min: Number(e.target.value) })
                  }
                />
              </div>
              <div className="field">
                <label>Минимальный % для оценки «4»</label>
                <input
                  type="number"
                  min={1}
                  max={99}
                  className="input"
                  value={settingsForm.grade_4_min}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, grade_4_min: Number(e.target.value) })
                  }
                />
              </div>
              <div className="field">
                <label>Минимальный % для оценки «3» (ниже — оценка «2»)</label>
                <input
                  type="number"
                  min={1}
                  max={98}
                  className="input"
                  value={settingsForm.grade_3_min}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, grade_3_min: Number(e.target.value) })
                  }
                />
              </div>
              <div className="field">
                <label>Автоматическое завершение сессии (часов)</label>
                <input
                  type="number"
                  min={1}
                  max={72}
                  className="input"
                  value={settingsForm.session_ttl_hours}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, session_ttl_hours: Number(e.target.value) })
                  }
                />
              </div>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={settingsForm.show_results_to_students}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, show_results_to_students: e.target.checked })
                  }
                />
                Показывать оценки и результаты ученикам
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={settingsForm.show_explanations_to_students}
                  onChange={(e) =>
                    setSettingsForm({
                      ...settingsForm,
                      show_explanations_to_students: e.target.checked
                    })
                  }
                />
                Показывать пояснения после завершения теста
              </label>
              <button className="btn btn-primary" type="submit">
                Сохранить настройки
              </button>
            </form>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Смена пароля учителя</h3>
            <form className="form-grid" onSubmit={handleChangePassword}>
              <div className="field">
                <label>Текущий пароль</label>
                <input
                  type="password"
                  className="input"
                  value={pwdForm.current_password}
                  onChange={(e) => setPwdForm({ ...pwdForm, current_password: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Новый пароль (минимум 6 символов)</label>
                <input
                  type="password"
                  className="input"
                  value={pwdForm.new_password}
                  onChange={(e) => setPwdForm({ ...pwdForm, new_password: e.target.value })}
                  required
                  minLength={6}
                />
              </div>
              <div className="field">
                <label>Подтвердите новый пароль</label>
                <input
                  type="password"
                  className="input"
                  value={pwdForm.confirm}
                  onChange={(e) => setPwdForm({ ...pwdForm, confirm: e.target.value })}
                  required
                  minLength={6}
                />
              </div>
              <button className="btn btn-secondary" type="submit">
                Обновить пароль
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ==================== МОДАЛКИ ==================== */}
      {editingClass && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h3 style={{ marginTop: 0 }}>Редактировать класс</h3>
            <form className="form-grid" onSubmit={handleUpdateClass}>
              <div className="field">
                <label>Название класса</label>
                <input
                  className="input"
                  value={editingClass.name}
                  onChange={(e) => setEditingClass({ ...editingClass, name: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Код подключения</label>
                <input
                  className="input"
                  value={editingClass.join_code}
                  onChange={(e) =>
                    setEditingClass({ ...editingClass, join_code: e.target.value.toUpperCase() })
                  }
                  required
                />
              </div>
              <div className="flex-gap" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setEditingClass(null)}>
                  Отмена
                </button>
                <button type="submit" className="btn btn-primary">
                  Сохранить
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {classStudentsModal && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="flex-between" style={{ marginBottom: '0.75rem' }}>
              <h3 style={{ margin: 0 }}>
                Ученики класса {classStudentsModal.cls.name} ({classStudentsModal.students.length})
              </h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setClassStudentsModal(null)}>
                ✕
              </button>
            </div>
            {classStudentsModal.students.length === 0 ? (
              <p style={{ color: 'var(--text-subtle)' }}>В этот класс ещё никто не входил.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ФИО</th>
                      <th>Тестов</th>
                      <th>Ср. оценка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {classStudentsModal.students.map((s) => (
                      <tr key={s.id}>
                        <td>
                          {s.last_name} {s.first_name}
                        </td>
                        <td>{s.attempts_count}</td>
                        <td>{s.avg_grade || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {studentHistoryModal && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: 680 }}>
            <div className="flex-between" style={{ marginBottom: '0.75rem' }}>
              <h3 style={{ margin: 0 }}>
                {studentHistoryModal.student.last_name} {studentHistoryModal.student.first_name} (
                {studentHistoryModal.student.class_name})
              </h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setStudentHistoryModal(null)}>
                ✕
              </button>
            </div>

            <div
              style={{
                padding: '0.85rem',
                background: 'var(--surface-soft)',
                borderRadius: 'var(--radius-sm)',
                marginBottom: '1rem'
              }}
            >
              <div style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: '0.45rem' }}>
                Разрешить повторное прохождение теста:
              </div>
              <div className="flex-gap">
                <select
                  className="select"
                  style={{ flex: 1 }}
                  value={retakeTestId}
                  onChange={(e) => setRetakeTestId(e.target.value)}
                >
                  {tests.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!retakeTestId}
                  onClick={() => handleGrantRetake(studentHistoryModal.student.id, retakeTestId)}
                >
                  + Выдать попытку
                </button>
              </div>
            </div>

            {studentHistoryModal.attempts.length === 0 ? (
              <p style={{ color: 'var(--text-subtle)' }}>Попыток тестирования пока нет.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Тест</th>
                      <th>Дата</th>
                      <th>Результат</th>
                      <th>Оценка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentHistoryModal.attempts.map((a) => (
                      <tr key={a.id}>
                        <td>{a.test_title}</td>
                        <td>{formatDate(a.finished_at || a.started_at)}</td>
                        <td>
                          {a.status === 'in_progress'
                            ? 'В процессе'
                            : `${a.correct_count}/${a.total_questions} (${a.percentage}%)`}
                        </td>
                        <td>
                          {a.status === 'in_progress' ? (
                            '—'
                          ) : (
                            <span className={`badge badge-grade-${a.grade}`}>Оценка {a.grade}</span>
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
      )}
    </div>
  );
}
