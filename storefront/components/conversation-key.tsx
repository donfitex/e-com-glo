'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { LockKeyhole, Unlock } from 'lucide-react';
import { api } from '@/lib/client-api';
import { unlockInboxKey, type ContactKey } from '@/lib/contact-crypto';
export interface UnlockedConversationKey {
  keyId: string;
  privateKey: CryptoKey;
}
export function ConversationKey({
  requiredId,
  onUnlock,
  onLock,
  unlocked,
}: {
  admin: boolean;
  requiredId?: string;
  onUnlock: (value: UnlockedConversationKey) => void;
  onLock: () => void;
  unlocked: UnlockedConversationKey | null;
}) {
  const [registered, setRegistered] = useState<ContactKey | null>(null);
  const [ready, setReady] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api<ContactKey | null>('/conversations/key')
      .then((k) => {
        if (active) {
          setRegistered(k);
          setReady(true);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const target = requiredId ?? registered?.id;
  async function unlock(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const file = new FormData(e.currentTarget).get('recovery');
      if (!(file instanceof File) || !file.size || file.size > 64000)
        throw new Error(
          'Choose your downloaded recovery JSON file (up to 64 KB).',
        );
      const result = await unlockInboxKey(
        JSON.parse(await file.text()),
        passphrase,
      );
      if (target && result.keyId !== target)
        throw new Error('Use the store key shown for this conversation.');
      onUnlock(result);
      setPassphrase('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not unlock store key');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="secure-key-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow muted">STORE SECURITY</span>
          <h2>
            <LockKeyhole size={20} />
            {unlocked ? 'Store inbox unlocked' : 'Unlock the store inbox'}
          </h2>
        </div>
        {unlocked && (
          <button className="button outline" onClick={onLock}>
            Lock inbox
          </button>
        )}
      </div>
      <p>
        Use your existing administrator recovery file. Customer inboxes open
        automatically during normal sign-in.
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {!unlocked && ready && (
        <form className="form-card" onSubmit={unlock}>
          {!registered && (
            <p>
              Activate the store key in{' '}
              <Link href="/admin?section=inbox">Admin → Inbox</Link> first.
            </p>
          )}
          {target && <small>Required store key: {target}</small>}
          <label>
            Recovery key file
            <input
              type="file"
              name="recovery"
              accept="application/json,.json"
              required
            />
          </label>
          <label>
            Recovery passphrase
            <input
              type="password"
              required
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="off"
            />
          </label>
          <button className="button primary" disabled={busy}>
            <Unlock size={17} />
            {busy ? 'Unlocking…' : 'Unlock conversations'}
          </button>
        </form>
      )}
    </section>
  );
}
