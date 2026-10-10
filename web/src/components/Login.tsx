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
          <svg width="72" height="72" viewBox="0 0 512 512" role="img" aria-label="Фото ВК">
            <defs>
              <linearGradient id="loginBrand" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#5b9bff" />
                <stop offset="0.55" stopColor="#4c8bf5" />
                <stop offset="1" stopColor="#2f6ae0" />
              </linearGradient>
              <linearGradient id="loginGloss" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#ffffff" stopOpacity="0.22" />
                <stop offset="0.5" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>
            </defs>
            <rect width="512" height="512" rx="116" fill="url(#loginBrand)" />
            <rect width="512" height="256" rx="116" fill="url(#loginGloss)" />
            <text
              x="256"
              y="262"
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
              fontWeight="700"
              fontSize="312"
              fill="#ffffff"
            >
              В
            </text>
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