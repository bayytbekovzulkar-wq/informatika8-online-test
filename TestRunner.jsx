import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';

function formatClock(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function isQuestionAnswered(question, answer) {
  if (!answer) return false;
  if (question.question_type === 'number' || question.question_type === 'text') {
    return String(answer.answer_text || '').trim().length > 0;
  }
  return Array.isArray(answer.selected_answer_ids) && answer.selected_answer_ids.length > 0;
}

export default function TestRunner({ attemptId, onExit, showToast }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [viewMode, setViewMode] = useState('single'); // 'single' | 'list'
  const [remainingSec, setRemainingSec] = useState(null);
  const [saveState, setSaveState] = useState('saved'); // 'saved' | 'saving' | 'error'
  const [submitting, setSubmitting] = useState(false);
  const [showExitModal, setShowExitModal] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [resultData, setResultData] = useState(null);

  const answersRef = useRef(answers);
  answersRef.current = answers;
  const saveTimerRef = useRef(null);
  const autoSubmittedRef = useRef(false);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const data = await api.getAttempt(attemptId);
        if (!active) return;
        setAttempt(data.attempt);
        if (data.attempt.status !== 'in_progress') {
          setResultData(data.attempt);
        } else {
          setQuestions(data.questions || []);
          setAnswers(data.saved_answers || {});
          setRemainingSec(data.attempt.remaining_seconds);
        }
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [attemptId]);

  // Защита от случайного обновления или закрытия вкладки во время активного теста
  useEffect(() => {
    if (!attempt || attempt.status !== 'in_progress' || resultData) return;
    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = 'Тестирование не завершено. Вы уверены, что хотите покинуть страницу?';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [attempt, resultData]);

  // Автосохранение промежуточного прогресса на сервер (D1)
  const scheduleSave = useCallback(
    (nextAnswers) => {
      setSaveState('saving');
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        try {
          await api.saveProgress(attemptId, nextAnswers);
          setSaveState('saved');
        } catch {
          setSaveState('error');
        }
      }, 650);
    },
    [attemptId]
  );

  const handleSubmit = useCallback(
    async (isAuto = false) => {
      if (submitting) return;
      setSubmitting(true);
      setShowSubmitModal(false);
      setError('');
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

      try {
        const res = await api.submitAttempt(attemptId, answersRef.current);
        setResultData({
          ...res.result,
          results_hidden: res.results_hidden,
          test_title: attempt?.test_title,
          topic_title: attempt?.topic_title
        });
        showToast(
          isAuto
            ? 'Время вышло — тест автоматически отправлен на проверку.'
            : 'Тест успешно отправлен и проверен!'
        );
      } catch (err) {
        setError(err.message);
      } finally {
        setSubmitting(false);
      }
    },
    [attemptId, attempt, submitting, showToast]
  );

  // Живой таймер + автоотправка по истечении времени
  useEffect(() => {
    if (remainingSec === null || resultData || !attempt || attempt.status !== 'in_progress') {
      return;
    }
    if (remainingSec <= 0) {
      if (!autoSubmittedRef.current) {
        autoSubmittedRef.current = true;
        handleSubmit(true);
      }
      return;
    }
    const id = setInterval(() => {
      setRemainingSec((prev) => (prev !== null ? Math.max(0, prev - 1) : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [remainingSec, resultData, attempt, handleSubmit]);

  function updateAnswer(questionId, updater) {
    setAnswers((prev) => {
      const current = prev[questionId] || { selected_answer_ids: [], answer_text: '' };
      const updated = { ...prev, [questionId]: updater(current) };
      scheduleSave(updated);
      return updated;
    });
  }

  function renderQuestionBody(q, index) {
    const ans = answers[q.id] || { selected_answer_ids: [], answer_text: '' };
    const selectedIds = ans.selected_answer_ids || [];

    return (
      <div className="card" key={q.id} style={{ marginBottom: '1rem' }}>
        <div className="flex-between" style={{ marginBottom: '0.6rem' }}>
          <span className="badge badge-completed">
            Вопрос {index + 1} из {questions.length}
          </span>
          <span style={{ fontSize: '0.84rem', color: 'var(--text-subtle)', fontWeight: 600 }}>
            {q.points} {q.points === 1 ? 'балл' : 'балла'}
          </span>
        </div>

        <h3 style={{ margin: '0.35rem 0 1rem', fontSize: '1.08rem', lineHeight: 1.45 }}>
          {q.question_text}
        </h3>

        {(q.question_type === 'single' || q.question_type === 'boolean') && (
          <div>
            {q.options.map((opt) => {
              const checked = selectedIds.includes(opt.id);
              return (
                <label
                  key={opt.id}
                  className={`option-card ${checked ? 'selected' : ''}`}
                >
                  <input
                    type="radio"
                    name={`q-${q.id}`}
                    checked={checked}
                    onChange={() =>
                      updateAnswer(q.id, () => ({ selected_answer_ids: [opt.id], answer_text: '' }))
                    }
                  />
                  <span>{opt.answer_text}</span>
                </label>
              );
            })}
          </div>
        )}

        {q.question_type === 'multiple' && (
          <div>
            <div style={{ fontSize: '0.83rem', color: 'var(--text-subtle)', marginBottom: '0.5rem' }}>
              Выберите один или несколько правильных вариантов:
            </div>
            {q.options.map((opt) => {
              const checked = selectedIds.includes(opt.id);
              return (
                <label
                  key={opt.id}
                  className={`option-card ${checked ? 'selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      updateAnswer(q.id, (cur) => {
                        const set = new Set(cur.selected_answer_ids || []);
                        if (set.has(opt.id)) set.delete(opt.id);
                        else set.add(opt.id);
                        return { selected_answer_ids: Array.from(set), answer_text: '' };
                      })
                    }
                  />
                  <span>{opt.answer_text}</span>
                </label>
              );
            })}
          </div>
        )}

        {q.question_type === 'number' && (
          <div className="field">
            <label>Введите числовой ответ</label>
            <input
              type="text"
              inputMode="decimal"
              className="input"
              placeholder="Например: 22"
              value={ans.answer_text || ''}
              onChange={(e) =>
                updateAnswer(q.id, () => ({ selected_answer_ids: [], answer_text: e.target.value }))
              }
            />
          </div>
        )}

        {q.question_type === 'text' && (
          <div className="field">
            <label>Введите текстовый ответ</label>
            <input
              type="text"
              className="input"
              placeholder="Введите ваш ответ..."
              value={ans.answer_text || ''}
              onChange={(e) =>
                updateAnswer(q.id, () => ({ selected_answer_ids: [], answer_text: e.target.value }))
              }
            />
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return <div className="card">Загрузка теста...</div>;
  }

  if (error && !attempt) {
    return (
      <div className="card">
        <div className="alert alert-error">{error}</div>
        <button className="btn btn-secondary" onClick={onExit}>
          Вернуться к списку тестов
        </button>
      </div>
    );
  }

  // Экран результата после завершения теста
  if (resultData) {
    return (
      <div className="card" style={{ maxWidth: 780, margin: '0 auto' }}>
        <div className="alert alert-success">
          Тест <strong>{resultData.test_title}</strong> успешно завершён и сохранён в базе данных.
        </div>

        {resultData.results_hidden ? (
          <div style={{ padding: '1rem 0' }}>
            <h2>Ответы отправлены учителю</h2>
            <p style={{ color: 'var(--text-muted)' }}>
              Учитель временно отключил публикацию оценок для учеников. Ваш результат сохранён и
              будет доступен после публикации.
            </p>
          </div>
        ) : (
          <div>
            <div className="flex-between" style={{ marginBottom: '1.25rem' }}>
              <div>
                <div style={{ fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 600 }}>
                  {resultData.topic_title}
                </div>
                <h2 style={{ margin: '0.2rem 0 0' }}>{resultData.test_title}</h2>
              </div>
              <span
                className={`badge badge-grade-${resultData.grade}`}
                style={{ fontSize: '1.05rem', padding: '0.5rem 1rem' }}
              >
                Итоговая оценка: {resultData.grade}
              </span>
            </div>

            <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
              <div className="kpi-card">
                <div className="kpi-label">Правильных ответов</div>
                <div className="kpi-value">
                  {resultData.correct_count} / {resultData.total_questions}
                </div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Процент выполнения</div>
                <div className="kpi-value">{resultData.percentage}%</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Баллы</div>
                <div className="kpi-value">
                  {resultData.earned_points} / {resultData.max_points}
                </div>
              </div>
            </div>

            {Array.isArray(resultData.review) && resultData.review.length > 0 && (
              <div style={{ marginTop: '1.25rem' }}>
                <h3>Разбор ответов</h3>
                {resultData.review.map((item, idx) => (
                  <div
                    key={item.question_id}
                    style={{
                      padding: '0.85rem 1rem',
                      borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${item.is_correct ? '#a7f3d0' : '#fecaca'}`,
                      background: item.is_correct ? '#f0fdf4' : '#fef2f2',
                      marginBottom: '0.65rem'
                    }}
                  >
                    <div className="flex-between">
                      <strong>
                        {idx + 1}. {item.question_text}
                      </strong>
                      <span
                        className="badge"
                        style={{
                          background: item.is_correct ? '#dcfce7' : '#fee2e2',
                          color: item.is_correct ? '#166534' : '#991b1b'
                        }}
                      >
                        {item.is_correct ? `Верно (+${item.earned_points})` : 'Неверно (0)'}
                      </span>
                    </div>
                    {item.explanation && (
                      <div style={{ marginTop: '0.45rem', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                        <strong>Пояснение:</strong> {item.explanation}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: '1.25rem' }}>
          <button className="btn btn-primary" onClick={onExit}>
            Вернуться к списку тестов
          </button>
        </div>
      </div>
    );
  }

  const answeredCount = questions.filter((q) => isQuestionAnswered(q, answers[q.id])).length;
  const unansweredCount = questions.length - answeredCount;
  const progressPct = questions.length ? Math.round((answeredCount / questions.length) * 100) : 0;

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="test-runner-header">
          <div>
            <div style={{ fontSize: '0.82rem', color: 'var(--primary)', fontWeight: 600 }}>
              {attempt.topic_title}
            </div>
            <h2 style={{ margin: '0.15rem 0 0.25rem' }}>{attempt.test_title}</h2>
            {attempt.test_description && (
              <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                {attempt.test_description}
              </p>
            )}
          </div>

          <div className="flex-gap">
            <div className={`timer-pill ${remainingSec !== null && remainingSec <= 120 ? 'danger' : ''}`}>
              <span>⏱</span>
              <span>{formatClock(remainingSec ?? 0)}</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowExitModal(true)}>
              Выйти
            </button>
          </div>
        </div>

        <div className="flex-between" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          <span>
            Отвечено: <strong>{answeredCount}</strong> из <strong>{questions.length}</strong> ({progressPct}%)
            {unansweredCount > 0 && (
              <span style={{ color: 'var(--warning)', marginLeft: '0.5rem' }}>
                • Не отвечено: {unansweredCount}
              </span>
            )}
          </span>
          <div className="flex-gap">
            <span style={{ fontSize: '0.8rem', color: 'var(--text-subtle)' }}>
              {saveState === 'saving'
                ? 'Сохранение...'
                : saveState === 'error'
                ? 'Ошибка автосохранения'
                : 'Прогресс сохранён'}
            </span>
            <button
              className={`btn btn-sm ${viewMode === 'single' ? 'btn-secondary' : 'btn-ghost'}`}
              onClick={() => setViewMode('single')}
            >
              По одному
            </button>
            <button
              className={`btn btn-sm ${viewMode === 'list' ? 'btn-secondary' : 'btn-ghost'}`}
              onClick={() => setViewMode('list')}
            >
              Все вопросы
            </button>
          </div>
        </div>

        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progressPct}%` }} />
        </div>

        {/* Навигатор по вопросам с выделением неотвеченных */}
        <div className="question-palette">
          {questions.map((q, idx) => {
            const answered = isQuestionAnswered(q, answers[q.id]);
            const isCurrent = viewMode === 'single' && idx === currentIndex;
            const cls = isCurrent ? 'current' : answered ? 'answered' : 'unanswered';
            return (
              <button
                key={q.id}
                type="button"
                className={`palette-item ${cls}`}
                title={answered ? 'Ответ сохранён' : 'Вопрос без ответа'}
                onClick={() => {
                  setViewMode('single');
                  setCurrentIndex(idx);
                }}
              >
                {idx + 1}
              </button>
            );
          })}
        </div>
      </div>

      {/* Текущий вопрос или список */}
      {viewMode === 'single' && questions[currentIndex] ? (
        <>
          {renderQuestionBody(questions[currentIndex], currentIndex)}
          <div className="flex-between">
            <button
              className="btn btn-ghost"
              disabled={currentIndex === 0}
              onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
            >
              ← Предыдущий вопрос
            </button>
            <div className="flex-gap">
              {currentIndex < questions.length - 1 ? (
                <button
                  className="btn btn-secondary"
                  onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}
                >
                  Следующий вопрос →
                </button>
              ) : null}
              <button
                className="btn btn-primary"
                onClick={() => setShowSubmitModal(true)}
                disabled={submitting}
              >
                {submitting ? 'Отправка...' : 'Завершить тест'}
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          {questions.map((q, idx) => renderQuestionBody(q, idx))}
          <div style={{ textAlign: 'right' }}>
            <button
              className="btn btn-primary"
              onClick={() => setShowSubmitModal(true)}
              disabled={submitting}
            >
              {submitting ? 'Отправка...' : 'Завершить и отправить тест'}
            </button>
          </div>
        </>
      )}

      {/* Модальное окно подтверждения отправки */}
      {showSubmitModal && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h3 style={{ marginTop: 0 }}>Завершить тестирование?</h3>
            <p style={{ color: 'var(--text-muted)' }}>
              Отвечено на <strong>{answeredCount}</strong> из <strong>{questions.length}</strong>{' '}
              вопросов.
              {unansweredCount > 0 && (
                <>
                  {' '}
                  Осталось неотвеченных вопросов: <strong>{unansweredCount}</strong>.
                </>
              )}
            </p>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-subtle)' }}>
              После отправки изменить ответы будет невозможно.
            </p>
            <div className="flex-gap" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button className="btn btn-ghost" onClick={() => setShowSubmitModal(false)}>
                Вернуться к тесту
              </button>
              <button className="btn btn-primary" onClick={() => handleSubmit(false)} disabled={submitting}>
                Подтвердить отправку
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно предупреждения перед выходом */}
      {showExitModal && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h3 style={{ marginTop: 0 }}>Выйти из тестирования?</h3>
            <p style={{ color: 'var(--text-muted)' }}>
              Ваши промежуточные ответы сохранены на сервере, однако таймер продолжит идти. Вы
              сможете вернуться и продолжить тест, пока не истекло время.
            </p>
            <div className="flex-gap" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button className="btn btn-ghost" onClick={() => setShowExitModal(false)}>
                Остаться в тесте
              </button>
              <button className="btn btn-danger" onClick={onExit}>
                Выйти к списку тестов
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
