import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';

const QUESTION_TYPES = [
  { value: 'single', label: 'Один правильный ответ' },
  { value: 'multiple', label: 'Несколько правильных ответов' },
  { value: 'boolean', label: 'Верно / Неверно' },
  { value: 'number', label: 'Ввод числового ответа' },
  { value: 'text', label: 'Ввод текстового ответа' }
];

function emptyQuestionForm() {
  return {
    id: null,
    question_type: 'single',
    question_text: '',
    points: 1,
    explanation: '',
    correct_value: '',
    answers: [
      { answer_text: '', is_correct: true },
      { answer_text: '', is_correct: false },
      { answer_text: '', is_correct: false },
      { answer_text: '', is_correct: false }
    ]
  };
}

export default function TeacherTestEditor({ testId, topics, classes, onBack, showToast }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [testForm, setTestForm] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [savingMeta, setSavingMeta] = useState(false);

  const [qForm, setQForm] = useState(emptyQuestionForm());
  const [savingQ, setSavingQ] = useState(false);

  async function loadDetail() {
    setLoading(true);
    setError('');
    try {
      const data = await api.getTestDetail(testId);
      setTestForm({
        ...data.test,
        class_id: data.test.class_id ?? '',
        question_limit: data.test.question_limit ?? '',
        starts_at: data.test.starts_at ? data.test.starts_at.slice(0, 16) : '',
        ends_at: data.test.ends_at ? data.test.ends_at.slice(0, 16) : '',
        is_active: Boolean(data.test.is_active),
        shuffle_questions: Boolean(data.test.shuffle_questions),
        shuffle_answers: Boolean(data.test.shuffle_answers),
        show_results: Boolean(data.test.show_results)
      });
      setQuestions(data.questions || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDetail();
  }, [testId]);

  async function handleSaveMeta(e) {
    e.preventDefault();
    setSavingMeta(true);
    setError('');
    try {
      await api.updateTest(testId, {
        ...testForm,
        class_id: testForm.class_id ? Number(testForm.class_id) : null,
        question_limit: testForm.question_limit ? Number(testForm.question_limit) : null,
        starts_at: testForm.starts_at || null,
        ends_at: testForm.ends_at || null
      });
      showToast('Параметры теста сохранены.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingMeta(false);
    }
  }

  function handleQuestionTypeChange(nextType) {
    if (nextType === 'boolean') {
      setQForm((prev) => ({
        ...prev,
        question_type: nextType,
        answers: [
          { answer_text: 'Верно', is_correct: true },
          { answer_text: 'Неверно', is_correct: false }
        ]
      }));
    } else if (nextType === 'single' || nextType === 'multiple') {
      setQForm((prev) => ({
        ...prev,
        question_type: nextType,
        answers:
          prev.answers && prev.answers.length >= 2 && prev.question_type !== 'boolean'
            ? prev.answers
            : [
                { answer_text: '', is_correct: true },
                { answer_text: '', is_correct: false },
                { answer_text: '', is_correct: false },
                { answer_text: '', is_correct: false }
              ]
      }));
    } else {
      setQForm((prev) => ({ ...prev, question_type: nextType }));
    }
  }

  function startEditQuestion(q) {
    setQForm({
      id: q.id,
      question_type: q.question_type,
      question_text: q.question_text,
      points: q.points,
      explanation: q.explanation || '',
      correct_value: q.correct_value || '',
      answers:
        q.answers && q.answers.length > 0
          ? q.answers.map((a) => ({ answer_text: a.answer_text, is_correct: Boolean(a.is_correct) }))
          : emptyQuestionForm().answers
    });
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }

  async function handleSaveQuestion(e) {
    e.preventDefault();
    setSavingQ(true);
    setError('');
    try {
      const payload = {
        question_type: qForm.question_type,
        question_text: qForm.question_text,
        points: Number(qForm.points) || 1,
        explanation: qForm.explanation,
        correct_value: qForm.correct_value,
        answers: qForm.answers
      };
      if (qForm.id) {
        await api.updateQuestion(qForm.id, payload);
        showToast('Вопрос обновлён.');
      } else {
        await api.addQuestion(testId, payload);
        showToast('Вопрос добавлен в тест.');
      }
      setQForm(emptyQuestionForm());
      await loadDetail();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingQ(false);
    }
  }

  async function handleDeleteQuestion(qId) {
    if (!window.confirm('Удалить этот вопрос из теста?')) return;
    try {
      await api.deleteQuestion(qId);
      showToast('Вопрос удалён.');
      await loadDetail();
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading || !testForm) {
    return <div className="card">Загрузка редактора теста...</div>;
  }

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: '1rem' }}>
        <button className="btn btn-ghost" onClick={onBack}>
          ← Назад к списку тестов
        </button>
        <span className="badge badge-completed">Вопросов в тесте: {questions.length}</span>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Параметры теста */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <h3 style={{ marginTop: 0 }}>Настройки теста</h3>
        <form className="form-grid" onSubmit={handleSaveMeta}>
          <div className="form-grid-2">
            <div className="field">
              <label>Название теста</label>
              <input
                className="input"
                value={testForm.title}
                onChange={(e) => setTestForm({ ...testForm, title: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label>Тип задания</label>
              <select
                className="select"
                value={testForm.kind}
                onChange={(e) => setTestForm({ ...testForm, kind: e.target.value })}
              >
                <option value="test">Тест</option>
                <option value="practice">Практическое задание</option>
              </select>
            </div>
          </div>

          <div className="field">
            <label>Описание / инструкция для учеников</label>
            <textarea
              className="textarea"
              value={testForm.description}
              onChange={(e) => setTestForm({ ...testForm, description: e.target.value })}
            />
          </div>

          <div className="form-grid-3">
            <div className="field">
              <label>Тема учебной программы</label>
              <select
                className="select"
                value={testForm.topic_id}
                onChange={(e) => setTestForm({ ...testForm, topic_id: Number(e.target.value) })}
              >
                {topics.map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Класс (или для всех)</label>
              <select
                className="select"
                value={testForm.class_id}
                onChange={(e) => setTestForm({ ...testForm, class_id: e.target.value })}
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
              <label>Лимит вопросов (пусто = все)</label>
              <input
                type="number"
                min={1}
                className="input"
                placeholder="Все вопросы"
                value={testForm.question_limit}
                onChange={(e) => setTestForm({ ...testForm, question_limit: e.target.value })}
              />
            </div>
          </div>

          <div className="form-grid-3">
            <div className="field">
              <label>Время на выполнение (мин)</label>
              <input
                type="number"
                min={1}
                max={240}
                className="input"
                value={testForm.duration_minutes}
                onChange={(e) => setTestForm({ ...testForm, duration_minutes: Number(e.target.value) })}
              />
            </div>

            <div className="field">
              <label>Проходной балл (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                className="input"
                value={testForm.passing_score}
                onChange={(e) => setTestForm({ ...testForm, passing_score: Number(e.target.value) })}
              />
            </div>

            <div className="field">
              <label>Максимум попыток</label>
              <input
                type="number"
                min={1}
                max={20}
                className="input"
                value={testForm.max_attempts}
                onChange={(e) => setTestForm({ ...testForm, max_attempts: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="form-grid-2">
            <div className="field">
              <label>Дата начала (опционально)</label>
              <input
                type="datetime-local"
                className="input"
                value={testForm.starts_at}
                onChange={(e) => setTestForm({ ...testForm, starts_at: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Дата окончания (опционально)</label>
              <input
                type="datetime-local"
                className="input"
                value={testForm.ends_at}
                onChange={(e) => setTestForm({ ...testForm, ends_at: e.target.value })}
              />
            </div>
          </div>

          <div className="flex-gap" style={{ gap: '1.25rem' }}>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={testForm.is_active}
                onChange={(e) => setTestForm({ ...testForm, is_active: e.target.checked })}
              />
              Тест активен
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={testForm.shuffle_questions}
                onChange={(e) => setTestForm({ ...testForm, shuffle_questions: e.target.checked })}
              />
              Перемешивать вопросы
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={testForm.shuffle_answers}
                onChange={(e) => setTestForm({ ...testForm, shuffle_answers: e.target.checked })}
              />
              Перемешивать ответы
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={testForm.show_results}
                onChange={(e) => setTestForm({ ...testForm, show_results: e.target.checked })}
              />
              Показывать результат ученику
            </label>
          </div>

          <div>
            <button className="btn btn-primary" type="submit" disabled={savingMeta}>
              {savingMeta ? 'Сохранение...' : 'Сохранить настройки теста'}
            </button>
          </div>
        </form>
      </div>

      {/* Список вопросов теста */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <h3 style={{ marginTop: 0 }}>Вопросы теста ({questions.length})</h3>
        {questions.length === 0 ? (
          <p style={{ color: 'var(--text-subtle)' }}>Пока нет вопросов. Добавьте первый вопрос ниже.</p>
        ) : (
          questions.map((q, idx) => (
            <div
              key={q.id}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '1rem',
                marginBottom: '0.75rem',
                background: 'var(--surface-soft)'
              }}
            >
              <div className="flex-between" style={{ marginBottom: '0.45rem' }}>
                <div className="flex-gap">
                  <span className="badge badge-completed">№ {idx + 1}</span>
                  <span className="badge badge-unavailable">
                    {QUESTION_TYPES.find((t) => t.value === q.question_type)?.label || q.question_type}
                  </span>
                  <span style={{ fontSize: '0.84rem', color: 'var(--text-subtle)' }}>
                    Баллы: <strong>{q.points}</strong>
                  </span>
                </div>
                <div className="flex-gap">
                  <button className="btn btn-secondary btn-sm" onClick={() => startEditQuestion(q)}>
                    Редактировать
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDeleteQuestion(q.id)}>
                    Удалить
                  </button>
                </div>
              </div>

              <div style={{ fontWeight: 600, marginBottom: '0.45rem' }}>{q.question_text}</div>

              {q.question_type === 'number' || q.question_type === 'text' ? (
                <div style={{ fontSize: '0.88rem', color: 'var(--success)' }}>
                  Правильный ответ: <strong>{q.correct_value}</strong>
                </div>
              ) : (
                <ul style={{ margin: '0.35rem 0', paddingLeft: '1.25rem', fontSize: '0.9rem' }}>
                  {q.answers.map((a) => (
                    <li
                      key={a.id}
                      style={{
                        color: a.is_correct ? 'var(--success)' : 'var(--text-muted)',
                        fontWeight: a.is_correct ? 700 : 400
                      }}
                    >
                      {a.answer_text} {a.is_correct ? '✓' : ''}
                    </li>
                  ))}
                </ul>
              )}

              {q.explanation && (
                <div style={{ fontSize: '0.84rem', color: 'var(--text-subtle)', marginTop: '0.35rem' }}>
                  <strong>Пояснение:</strong> {q.explanation}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Форма добавления / редактирования вопроса */}
      <div className="card">
        <div className="flex-between" style={{ marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0 }}>
            {qForm.id ? 'Редактировать вопрос' : 'Добавить новый вопрос'}
          </h3>
          {qForm.id && (
            <button className="btn btn-ghost btn-sm" onClick={() => setQForm(emptyQuestionForm())}>
              Отменить редактирование
            </button>
          )}
        </div>

        <form className="form-grid" onSubmit={handleSaveQuestion}>
          <div className="form-grid-2">
            <div className="field">
              <label>Тип вопроса</label>
              <select
                className="select"
                value={qForm.question_type}
                onChange={(e) => handleQuestionTypeChange(e.target.value)}
              >
                {QUESTION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Количество баллов</label>
              <input
                type="number"
                min={0.5}
                step={0.5}
                className="input"
                value={qForm.points}
                onChange={(e) => setQForm({ ...qForm, points: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="field">
            <label>Текст вопроса</label>
            <textarea
              className="textarea"
              placeholder="Введите формулировку вопроса..."
              value={qForm.question_text}
              onChange={(e) => setQForm({ ...qForm, question_text: e.target.value })}
              required
            />
          </div>

          {qForm.question_type === 'number' || qForm.question_type === 'text' ? (
            <div className="field">
              <label>
                Правильный ответ{' '}
                <span style={{ fontWeight: 400, color: 'var(--text-subtle)' }}>
                  (несколько допустимых вариантов можно указать через «;»)
                </span>
              </label>
              <input
                className="input"
                placeholder={qForm.question_type === 'number' ? 'Например: 22' : 'Например: инверсия; отрицание'}
                value={qForm.correct_value}
                onChange={(e) => setQForm({ ...qForm, correct_value: e.target.value })}
                required
              />
            </div>
          ) : (
            <div className="field">
              <label>Варианты ответов (отметьте правильные)</label>
              {qForm.answers.map((ans, idx) => (
                <div key={idx} className="flex-gap" style={{ marginBottom: '0.5rem' }}>
                  <input
                    type={qForm.question_type === 'multiple' ? 'checkbox' : 'radio'}
                    name="correct-option"
                    checked={ans.is_correct}
                    onChange={() => {
                      setQForm((prev) => ({
                        ...prev,
                        answers: prev.answers.map((item, i) =>
                          prev.question_type === 'multiple'
                            ? i === idx
                              ? { ...item, is_correct: !item.is_correct }
                              : item
                            : { ...item, is_correct: i === idx }
                        )
                      }));
                    }}
                  />
                  <input
                    className="input"
                    style={{ flex: 1 }}
                    placeholder={`Вариант ${idx + 1}`}
                    value={ans.answer_text}
                    disabled={qForm.question_type === 'boolean'}
                    onChange={(e) => {
                      const val = e.target.value;
                      setQForm((prev) => ({
                        ...prev,
                        answers: prev.answers.map((item, i) =>
                          i === idx ? { ...item, answer_text: val } : item
                        )
                      }));
                    }}
                  />
                  {qForm.question_type !== 'boolean' && qForm.answers.length > 2 && (
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() =>
                        setQForm((prev) => ({
                          ...prev,
                          answers: prev.answers.filter((_, i) => i !== idx)
                        }))
                      }
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {qForm.question_type !== 'boolean' && (
                <div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      setQForm((prev) => ({
                        ...prev,
                        answers: [...prev.answers, { answer_text: '', is_correct: false }]
                      }))
                    }
                  >
                    + Добавить вариант ответа
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="field">
            <label>Пояснение к правильному ответу (опционально)</label>
            <input
              className="input"
              placeholder="Краткое объяснение решения..."
              value={qForm.explanation}
              onChange={(e) => setQForm({ ...qForm, explanation: e.target.value })}
            />
          </div>

          <div>
            <button className="btn btn-primary" type="submit" disabled={savingQ}>
              {savingQ ? 'Сохранение...' : qForm.id ? 'Сохранить изменения вопроса' : 'Добавить вопрос'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
