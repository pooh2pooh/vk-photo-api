import { useState } from "react";
import { ApiError, login } from "../api/client.js";

interface LoginProps {
  setupRequired: boolean;
  onSuccess: () => void;
}

export function Login({ setupRequired, onSuccess }: LoginProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = username.trim().length > 0 && password.length > 0 && !submitting;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);
    try {
      await login(username.trim(), password);
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось войти. Попробуйте ещё раз.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login">
      <div className="login__screen" aria-live="polite">
        <div className="login__brand">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="9" cy="11" r="2" fill="currentColor" />
            <path d="M6 17l4-4 3 3 3-3 2 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="login__title">Сохранённые фото</h1>
        <p className="login__subtitle">Войдите, чтобы открыть галерею</p>

        <form className="login__form" onSubmit={handleSubmit}>
          <label className="field">
            <span className="field__label">Логин</span>
            <input
              type="text"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Логин"
              disabled={submitting}
            />
          </label>

          <label className="field">
            <span className="field__label">Пароль</span>
            <span className="field__password">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Пароль"
                disabled={submitting}
              />
              <button
                type="button"
                className="field__toggle"
                onClick={() => setShowPassword((value) => !value)}
                tabIndex={-1}
                aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
              >
                {showPassword ? "🙈" : "👁"}
              </button>
            </span>
          </label>

          {error ? (
            <p key={error} className="login__error">
              {error}
            </p>
          ) : null}

          {setupRequired ? (
            <p className="login__hint">
              Сервер ещё не настроен: заполните <code>private/secrets.php</code> (логин, пароль,
              токен VK) или задайте переменные окружения.
            </p>
          ) : null}

          <button type="submit" className="login__submit" disabled={!canSubmit}>
            {submitting ? <span className="spinner spinner--button" aria-hidden="true" /> : null}
            {submitting ? "Вход…" : "Войти"}
          </button>
        </form>
      </div>
    </div>
  );
}