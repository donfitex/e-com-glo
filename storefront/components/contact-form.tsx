'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LockKeyhole, Send } from 'lucide-react';
import { api, ApiError } from '@/lib/client-api';
import {
  encryptContact,
  type ContactKey,
  type ContactPayload,
  type MessageEnvelope,
} from '@/lib/contact-crypto';
import { useSession } from './session';
export function ContactForm() {
  const { user } = useSession();
  const [key, setKey] = useState<ContactKey | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState('');
  const cached = useRef<{ payload: string; envelope: MessageEnvelope } | null>(
    null,
  );
  useEffect(() => {
    api<ContactKey | null>('/contact/key')
      .then(setKey)
      .catch(() =>
        setError(
          'Could not load the secure contact form. Please try again later.',
        ),
      )
      .finally(() => setLoaded(true));
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    if (values.get('website')) return;
    setBusy(true);
    setError('');
    try {
      const current = await api<ContactKey | null>('/contact/key');
      if (!current)
        throw new Error('The store has not activated its secure inbox yet.');
      if (!crypto.subtle)
        throw new Error('Use a secure HTTPS connection to send your message.');
      setKey(current);
      const payload: ContactPayload = {
        name: String(values.get('name')),
        email: String(values.get('email')),
        subject: String(values.get('subject')),
        message: String(values.get('message')),
        orderReference: String(values.get('orderReference') ?? ''),
      };
      const serialized = JSON.stringify(payload);
      const envelope =
        cached.current?.payload === serialized &&
        cached.current.envelope.keyId === current.id
          ? cached.current.envelope
          : await encryptContact(payload, current);
      cached.current = { payload: serialized, envelope };
      const saved = await api<{ id: string }>('/contact/messages', {
        method: 'POST',
        body: JSON.stringify({ ...envelope, website: '' }),
      });
      setReceipt(saved.id);
      cached.current = null;
      form.reset();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) cached.current = null;
      setError(
        e instanceof Error
          ? e.message
          : 'Your message could not be sent. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="contact-layout">
      <div className="contact-intro">
        <span className="eyebrow muted">WE’RE HERE TO HELP</span>
        <h1>Let’s put things right.</h1>
        <p>
          Questions, delivery issues or complaints—send our team the details.
          Include your order reference when it helps.
        </p>
        <div className="contact-assurance">
          <LockKeyhole size={22} />
          <p>
            Your name, email and message are encrypted in your browser for the
            store’s inbox. Only an administrator with the recovery key can open
            them.
          </p>
        </div>
        <p className="filter-note">
          Please don’t include passwords, payment card details or one-time
          codes.
        </p>
      </div>
      <form className="form-card" onSubmit={submit}>
        <h2>Contact us</h2>
        {receipt && (
          <div className="notice" role="status">
            Your encrypted message was sent to the admin inbox. Reference:{' '}
            <strong>{receipt.slice(0, 8).toUpperCase()}</strong>
          </div>
        )}
        {loaded && !key && (
          <div className="notice" role="status">
            The store’s secure inbox is not activated yet. Please check back
            shortly.
          </div>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <label>
          Your name
          <input
            name="name"
            required
            maxLength={120}
            autoComplete="name"
            defaultValue={user?.name}
          />
        </label>
        <label>
          Email address
          <input
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            defaultValue={user?.email}
          />
        </label>
        <label>
          Subject
          <input name="subject" required maxLength={160} />
        </label>
        <label>
          Order reference (optional)
          <input name="orderReference" maxLength={64} autoComplete="off" />
        </label>
        <label>
          Message
          <textarea name="message" required maxLength={5000} rows={7} />
        </label>
        <label className="contact-honeypot" aria-hidden="true">
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
        <button className="button primary" disabled={busy || !loaded || !key}>
          {busy ? 'Encrypting and sending…' : 'Send secure message'}
          <Send size={16} />
        </button>
        {key && (
          <details className="key-fingerprint">
            <summary>Verify the inbox encryption key</summary>
            <p>
              For independent verification, compare this fingerprint with the
              store through a trusted channel.
            </p>
            <code>{key.fingerprint}</code>
          </details>
        )}
      </form>
    </div>
  );
}
