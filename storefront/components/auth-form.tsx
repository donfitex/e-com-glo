'use client';
import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import { initializeCustomerInbox } from '@/lib/customer-inbox';
import type { User } from '@/lib/types';
import { api } from '@/lib/client-api';
import { useSession } from './session';
export function AuthForm({ register = false }: { register?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useSession();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      await api(`/auth/${register ? 'register' : 'login'}`, {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(form)),
      });
      // Prepare private messaging during normal sign-in; no recovery prompts for customers.
      const me = await api<User>('/auth/me');
      if (me.role === 'CUSTOMER') {
        try {
          await initializeCustomerInbox(me.id, String(form.get('password')));
        } catch {
          /* Account access and checkout remain available if device crypto/storage is unavailable. */
        }
      }
      await refresh();
      const next = params.get('next');
      router.push(
        next?.startsWith('/') && !next.startsWith('//') && !next.includes('\\')
          ? next
          : '/account',
      );
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout shell page">
      <div className="auth-intro">
        <span className="eyebrow muted">YOUR WORLD OF GOOD FINDS</span>
        <h1>
          {register ? 'Make yourself\nat home.' : 'Good to have\nyou back.'}
        </h1>
        <p>
          One account for everyday essentials,
          <br />
          unexpected favorites, and everything in between.
        </p>
        <span className="auth-assurance">
          <ShieldCheck size={20} /> Your account stays protected.
        </span>
      </div>
      <form className="form-card" onSubmit={submit}>
        <h2>{register ? 'Create your account' : 'Sign in to E-com Global'}</h2>
        <p>
          {register
            ? 'Your next great find starts here.'
            : 'Pick up where you left off.'}
        </p>
        {register && (
          <label>
            Full name
            <input name="name" required maxLength={120} autoComplete="name" />
          </label>
        )}
        <label>
          Email address
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            maxLength={254}
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            required
            minLength={12}
            maxLength={128}
            autoComplete={register ? 'new-password' : 'current-password'}
          />
        </label>
        <small>Use at least 12 characters.</small>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? 'Just a moment…' : register ? 'Create account' : 'Sign in'}
          <ArrowUpRight size={17} />
        </button>
        <p className="form-switch">
          {register ? 'Already part of the community?' : 'New around here?'}{' '}
          <Link
            href={`${register ? '/login' : '/register'}${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`}
          >
            {register ? 'Sign in' : 'Create an account'}
          </Link>
        </p>
      </form>
    </div>
  );
}
