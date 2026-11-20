import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import TurnstileWidget from './TurnstileWidget.jsx';

export default function TeacherAuth({ config, onSuccess, showToast }) {
  const [setupStatus, setSetupStatus] = useState({ loading: true, needs_setup: false, requires_setup_token: false });
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .teacherSetupStatus()
      .then((res) => setSetupStatus({ loading: false, ...res }))
      .catch(() => setSetupStatus({ loading: false, needs_setup: false, requires_setup_token: false }));
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (setupStatus.needs_setup) {
        const res = await api.teacherSetup({
          username,
          full_name: fullName,
          password,
          setup_token: setupToken
        });
        showToast('Аккаунт учителя успешно создан!');
        onSuccess(res.teacher);
      } else {
        const res = await api.teacherLogin({
          username,
          password,
          turnstile_token: turnstileToken
        });
        showToast(`Вы вошли как ${res.teacher.full_name}`);
        onSuccess(res.teacher);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (setupStatus.loading) {
    return <div className="card auth-wrapper">Проверка состояния системы...</div>;
  }

  return (
    <div className="auth-wrapper">
      <div className="card">
        <div className="badge badge-completed" style={{ marginBottom: '0.6rem' }}>
          Кабинет учителя
        </div>
        <h2 style={{ marginTop: 0, marginBottom: '0.4rem' }}>
          {setupStatus.needs_setup ? 'Создание первого аккаунта учителя' : 'Вход в панель управления'}
        </h2>
        <p style={{ marginTop: 0, color: 'var(--text-subtle)', fontSize: '0.9rem' }}>
          {setupStatus.needs_setup
            ? 'В базе данных ещё нет ни одного учителя. Задайте логин и надёжный пароль администратора.'
            : 'Введите логин и пароль учителя для управления классами, тестами и результатами.'}
        </p>

        {error && <div className="alert alert-error">{error}</div>}

        <form className="form-grid" onSubmit={handleSubmit}>
          <div className="field">
            <label>Логин</label>
            <input
              className="input"
              placeholder="Например: admin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
            />
          </div>

          {setupStatus.needs_setup && (
            <div className="field">
              <label>ФИО учителя</label>
              <input
                className="input"
                placeholder="Например: Н. Н. Осипова"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                minLength={2}
              />
            </div>
          )}

          <div className="field">
            <label>Пароль</label>
            <input
              type="password"
              className="input"
              placeholder="Минимум 6 символов"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>

          {setupStatus.needs_setup && setupStatus.requires_setup_token && (
            <div className="field">
              <label>Токен первичной настройки (INITIAL_SETUP_TOKEN)</label>
              <input
                type="password"
                className="input"
                value={setupToken}
                onChange={(e) => setSetupToken(e.target.value)}
                required
              />
            </div>
          )}

          {!setupStatus.needs_setup && (
            <TurnstileWidget
              siteKey={config?.turnstile_site_key}
              onVerify={setTurnstileToken}
            />
          )}

          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting
              ? 'Подождите...'
              : setupStatus.needs_setup
              ? 'Создать аккаунт и войти'
              : 'Войти в кабинет учителя'}
          </button>
        </form>
      </div>
    </div>
  );
}
