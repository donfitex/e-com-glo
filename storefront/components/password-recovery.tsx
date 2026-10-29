'use client';
import { useEffect, useState, useRef, type FormEvent } from 'react';
import Link from 'next/link';
import { Mail, KeyRound, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/client-api';
import { useSession } from './session';
export function PasswordRecovery({ reset = false }: { reset?: boolean }) {
  const { refresh } = useSession();
  const [token, setToken] = useState('');
  const [ready, setReady] = useState(!reset);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const initialized = useRef(false);
  useEffect(() => {
    if (!reset) return;
    const read = () => {
      if (!window.location.hash && initialized.current) return;
      initialized.current = true;
      const value =
        new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
      if (/^[a-f0-9]{64}$/.test(value)) {
        setToken(value);
        setError('');
        setDone(false);
        window.history.replaceState(null, '', window.location.pathname);
      } else {
        setToken('');
        setError('This reset link is missing or invalid. Request a new one.');
      }
      setReady(true);
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [reset]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const values = new FormData(e.currentTarget);
    try {
      if (reset) {
        if (values.get('password') !== values.get('confirm'))
          throw new Error('Your passwords do not match.');
        await api('/auth/reset-password', {
          method: 'POST',
          body: JSON.stringify({ token, password: values.get('password') }),
        });
        await api('/auth/logout', { method: 'POST' });
        await refresh();
        setToken('');
      } else
        await api('/auth/forgot-password', {
          method: 'POST',
          body: JSON.stringify({ email: values.get('email') }),
        });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout shell page">
      <div className="auth-intro">
        <span className="eyebrow muted">A FRESH START, SIMPLY</span>
        <h1>
          {reset
            ? 'Make it secure.\nMake it yours.'
            : 'Let’s get you\nback in.'}
        </h1>
        <p>
          {reset
            ? 'Choose a strong password for your E-com Global account.'
            : 'Forgot your password? We’ll help you return to your account.'}
        </p>
      </div>
      <div className="form-card">
        {done ? (
          <div className="recovery-complete">
            <CheckCircle2 size={32} />
            <h2>{reset ? 'Your password is updated.' : 'Check your email.'}</h2>
            <p>
              {reset
                ? 'Sign in with your new password. Your previous account sessions have been signed out.'
                : 'If an account uses that email address, we’ll send a password reset link. Check your spam folder too. The link expires in 30 minutes and can be used once.'}
            </p>
            <Link className="button primary" href="/login">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h2>{reset ? 'Choose a new password' : 'Reset your password'}</h2>
            <p>
              {reset
                ? 'Use at least 12 characters and avoid a password you use elsewhere.'
                : 'Enter the email address you use for your account.'}
            </p>
            {error && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}
            {reset ? (
              <>
                <label>
                  New password
                  <input
                    type="password"
                    name="password"
                    required
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                  />
                </label>
                <label>
                  Confirm new password
                  <input
                    type="password"
                    name="confirm"
                    required
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                  />
                </label>
              </>
            ) : (
              <label>
                Email address
                <input
                  type="email"
                  name="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                />
              </label>
            )}
            <button
              className="button primary"
              disabled={busy || !ready || (reset && !token)}
            >
              {reset ? <KeyRound size={18} /> : <Mail size={18} />}{' '}
              {busy
                ? 'Just a moment…'
                : reset
                  ? 'Update password'
                  : 'Send reset link'}
            </button>
            {reset && (
              <Link className="text-link" href="/forgot-password">
                Request a new reset link
              </Link>
            )}
            <Link className="text-link recovery-back" href="/login">
              <ArrowLeft size={16} />
              Back to sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
