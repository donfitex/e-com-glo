'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/client-api';
import {
  createInboxKey,
  unlockInboxKey,
  decryptContact,
  type KeyBackup,
  type ContactPayload,
  type MessageEnvelope,
} from '@/lib/contact-crypto';
import {
  useInboxNotifications,
  notifyInboxChanged,
} from './inbox-notifications';
interface KeyInfo {
  id: string;
  fingerprint: string;
  active: boolean;
  createdAt: string;
}
interface Message {
  id: string;
  keyId: string;
  status: 'NEW' | 'READ' | 'RESOLVED';
  createdAt: string;
  envelope?: MessageEnvelope;
}
const storageName = (id: string) => `ecom-inbox-backup-v1:${id}`;
function download(backup: KeyBackup) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `ecom-global-inbox-${backup.keyId}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function AdminInbox() {
  const { unread, refresh } = useInboxNotifications();
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedKey, setSelectedKey] = useState('');
  const [backup, setBackup] = useState<KeyBackup | null>(null);
  const [unlocked, setUnlocked] = useState<{
    keyId: string;
    privateKey: CryptoKey;
  } | null>(null);
  const [generated, setGenerated] = useState<Awaited<
    ReturnType<typeof createInboxKey>
  > | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [setup, setSetup] = useState(false);
  const [remember, setRemember] = useState(true);
  const [items, setItems] = useState<Message[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Message | null>(null);
  const [clear, setClear] = useState<ContactPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const sequence = useRef(0);
  const active = keys.find((key) => key.active);
  const loadMessages = useCallback(async () => {
    const response = await api<{ items: Message[]; total: number }>(
      `/admin/inbox/messages?page=${page}&limit=20${filter ? `&status=${filter}` : ''}`,
    );
    setItems(response.items);
    setTotal(response.total);
  }, [page, filter]);
  const chooseKey = useCallback((id: string) => {
    sequence.current++;
    setSelectedKey(id);
    setUnlocked(null);
    setClear(null);
    setBackup(null);
    try {
      const saved = localStorage.getItem(storageName(id));
      if (saved && saved.length <= 65536) setBackup(JSON.parse(saved));
    } catch {
      /* File import remains available. */
    }
  }, []);
  useEffect(() => {
    api<KeyInfo[]>('/admin/inbox/keys')
      .then((data) => {
        setKeys(data);
        chooseKey(data.find((key) => key.active)?.id ?? '');
        setLoaded(true);
      })
      .catch((e) => {
        setError(e.message);
        setLoaded(true);
      });
  }, [chooseKey]);
  useEffect(() => {
    void Promise.all([loadMessages(), refresh()]).catch((e) =>
      setError(e.message),
    );
  }, [loadMessages, unread]);
  function lock() {
    sequence.current++;
    setUnlocked(null);
    setClear(null);
    setMessage('Inbox locked.');
  }
  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError('');
    try {
      if (values.get('passphrase') !== values.get('confirm'))
        throw new Error('Recovery passphrases do not match.');
      if (!crypto.subtle) throw new Error('Inbox encryption requires HTTPS.');
      setGenerated(await createInboxKey(String(values.get('passphrase'))));
      setDownloaded(false);
      form.reset();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not create the recovery key.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function activate() {
    if (!generated || !downloaded) return;
    setBusy(true);
    setError('');
    try {
      const saved = await api<KeyInfo>('/admin/inbox/keys', {
        method: 'POST',
        body: JSON.stringify({
          id: generated.publicKey.id,
          expectedCurrentId: active?.id ?? null,
          publicJwk: generated.publicKey.publicJwk,
        }),
      });
      if (saved.fingerprint !== generated.publicKey.fingerprint)
        throw new Error('Inbox fingerprint verification failed.');
      if (remember) {
        try {
          localStorage.setItem(
            storageName(saved.id),
            JSON.stringify(generated.backup),
          );
        } catch {
          /* Downloaded recovery file is authoritative. */
        }
      }
      setKeys(await api<KeyInfo[]>('/admin/inbox/keys'));
      setSelectedKey(saved.id);
      setBackup(generated.backup);
      setUnlocked({ keyId: saved.id, privateKey: generated.privateKey });
      setGenerated(null);
      setSetup(false);
      setMessage(
        'Secure inbox activated. Keep your downloaded recovery file and its passphrase safe.',
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not activate the inbox. Keep the recovery file.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError('');
    try {
      let file: unknown = backup;
      const upload = new FormData(form).get('backup');
      if (upload instanceof File && upload.size) {
        if (upload.size > 65536) throw new Error('Recovery file is too large.');
        file = JSON.parse(await upload.text());
      }
      if (!file) throw new Error('Choose your downloaded recovery file.');
      const result = await unlockInboxKey(
        file,
        String(new FormData(form).get('passphrase')),
      );
      const known = keys.find((key) => key.id === result.keyId);
      if (
        !known ||
        known.id !== selectedKey ||
        known.fingerprint !== result.fingerprint
      )
        throw new Error('This recovery key belongs to a different inbox key.');
      setUnlocked({ keyId: result.keyId, privateKey: result.privateKey });
      setBackup(file as KeyBackup);
      if (remember) {
        try {
          localStorage.setItem(storageName(result.keyId), JSON.stringify(file));
        } catch {
          /* File import is still available. */
        }
      }
      form.reset();
      setMessage('Inbox unlocked on this page. Open a message to decrypt it.');
    } catch {
      setError(
        'Could not unlock this inbox key. Check the recovery file and passphrase.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function open(item: Message) {
    const revision = ++sequence.current;
    setSelected(item);
    setClear(null);
    setError('');
    setMessage('');
    if (!unlocked || unlocked.keyId !== item.keyId) {
      if (selectedKey !== item.keyId) chooseKey(item.keyId);
      setMessage(
        'Unlock the recovery key for this message, then open it again.',
      );
      return;
    }
    try {
      const record = await api<Message>(`/admin/inbox/messages/${item.id}`);
      const payload = await decryptContact(
        record.envelope!,
        unlocked.keyId,
        unlocked.privateKey,
      );
      if (revision !== sequence.current) return;
      setClear(payload);
      if (record.status === 'NEW') {
        await api(`/admin/inbox/messages/${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'READ' }),
        });
        notifyInboxChanged();
        await loadMessages();
      }
    } catch {
      if (revision === sequence.current)
        setError(
          'This message could not be decrypted. Check the selected key or message integrity.',
        );
    }
  }
  async function status(value: 'NEW' | 'RESOLVED') {
    if (!selected) return;
    await api(`/admin/inbox/messages/${selected.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: value }),
    });
    setSelected({ ...selected, status: value });
    notifyInboxChanged();
    await loadMessages();
    setMessage(
      value === 'RESOLVED'
        ? 'Message marked resolved.'
        : 'Message marked unread.',
    );
  }
  async function removeSelected() {
    if (
      !selected ||
      !window.confirm('Permanently delete this encrypted support message?')
    )
      return;
    setBusy(true);
    try {
      await api(`/admin/inbox/messages/${selected.id}`, { method: 'DELETE' });
      sequence.current++;
      setSelected(null);
      setClear(null);
      notifyInboxChanged();
      await loadMessages();
      setMessage('Message deleted.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-inbox">
      <div className="section-heading">
        <div>
          <span className="eyebrow muted">CUSTOMER CARE</span>
          <h2>Your secure inbox.</h2>
          <p>
            {unread} unread · {total} messages · message contents stay encrypted
            on the server.
          </p>
        </div>
        <button
          className="button outline"
          onClick={() =>
            void Promise.all([loadMessages(), refresh()]).catch((e) =>
              setError(e.message),
            )
          }
        >
          Refresh inbox
        </button>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}
      {loaded && (!active || setup) ? (
        <div className="inbox-security form-card">
          <LockKeyhole />
          <h3>
            {active
              ? 'Rotate the inbox encryption key'
              : 'Activate your encrypted inbox'}
          </h3>
          <p>
            Use a recovery passphrase different from your sign-in password. The
            server cannot recover this private key. Download the
            password-protected recovery file before activation. Keep old key
            backups to read older messages.
          </p>
          {!generated ? (
            <form onSubmit={generate}>
              <label>
                Recovery passphrase
                <input
                  name="passphrase"
                  type="password"
                  minLength={12}
                  maxLength={256}
                  required
                  autoComplete="new-password"
                />
              </label>
              <label>
                Confirm recovery passphrase
                <input
                  name="confirm"
                  type="password"
                  minLength={12}
                  maxLength={256}
                  required
                  autoComplete="new-password"
                />
              </label>
              <button className="button primary" disabled={busy}>
                {busy ? 'Creating encryption key…' : 'Create recovery key'}
              </button>
            </form>
          ) : (
            <>
              <p>Key fingerprint</p>
              <code className="fingerprint">
                {generated.publicKey.fingerprint}
              </code>
              <button
                className="button outline"
                onClick={() => {
                  download(generated.backup);
                  setDownloaded(true);
                }}
              >
                Download recovery key
              </button>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                Keep an encrypted copy on this device
              </label>
              <button
                className="button primary"
                disabled={!downloaded || busy}
                onClick={() => void activate()}
              >
                Activate inbox
              </button>
            </>
          )}
          {active && (
            <button
              className="text-link"
              onClick={() => {
                setSetup(false);
                setGenerated(null);
              }}
            >
              Cancel key rotation
            </button>
          )}
        </div>
      ) : (
        active && (
          <div className="inbox-security">
            <div className="inline-actions">
              <ShieldCheck size={20} />
              <strong>
                {unlocked ? 'Unlocked on this page' : 'Encrypted inbox locked'}
              </strong>
              {unlocked && (
                <button className="text-link" onClick={lock}>
                  Lock inbox
                </button>
              )}
              <button
                className="text-link"
                onClick={() => {
                  lock();
                  setSetup(true);
                }}
              >
                Rotate encryption key
              </button>
            </div>
            <label>
              Inbox encryption key
              <select
                value={selectedKey}
                onChange={(e) => chooseKey(e.target.value)}
              >
                {keys.map((key) => (
                  <option key={key.id} value={key.id}>
                    {key.active ? 'Active' : 'Previous'} ·{' '}
                    {key.fingerprint.slice(0, 16)}
                  </option>
                ))}
              </select>
            </label>
            {!unlocked && (
              <form className="inbox-unlock" onSubmit={unlock}>
                <label>
                  Recovery key file
                  <input
                    name="backup"
                    type="file"
                    accept="application/json,.json"
                    required={!backup}
                  />
                </label>
                <label>
                  Recovery passphrase
                  <input
                    name="passphrase"
                    type="password"
                    minLength={12}
                    maxLength={256}
                    required
                    autoComplete="off"
                  />
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  />
                  Remember encrypted file on this device
                </label>
                <button className="button primary" disabled={busy}>
                  Unlock inbox
                </button>
              </form>
            )}
            {backup && (
              <div className="inline-actions">
                <button className="text-link" onClick={() => download(backup)}>
                  Download recovery key again
                </button>
                <button
                  className="text-link"
                  onClick={() => {
                    try {
                      localStorage.removeItem(storageName(selectedKey));
                    } catch {
                      /* Storage may be unavailable. */
                    }
                    setBackup(null);
                    lock();
                  }}
                >
                  Remove saved copy from this device
                </button>
              </div>
            )}
          </div>
        )
      )}
      <label className="inbox-filter">
        Show messages
        <select
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All messages</option>
          <option value="NEW">Unread</option>
          <option value="READ">Read</option>
          <option value="RESOLVED">Resolved</option>
        </select>
      </label>
      <div className="inbox-layout">
        <div className="inbox-list">
          {items.length ? (
            items.map((item) => (
              <button
                key={item.id}
                className={`inbox-item ${selected?.id === item.id ? 'selected' : ''}`}
                onClick={() => void open(item)}
              >
                <Mail size={18} />
                <div>
                  <strong>Message #{item.id.slice(0, 8).toUpperCase()}</strong>
                  <small>{new Date(item.createdAt).toLocaleString()}</small>
                  <span className="status">
                    {item.status === 'NEW' ? 'UNREAD' : item.status}
                  </span>
                </div>
                <LockKeyhole size={14} />
              </button>
            ))
          ) : (
            <div className="empty-state">
              <Mail />
              <h3>No messages here yet.</h3>
              <p>Customer messages from Contact us will appear here.</p>
            </div>
          )}
        </div>
        <div className="inbox-reader">
          {clear && selected ? (
            <article>
              <span className="eyebrow muted">DECRYPTED ON THIS DEVICE</span>
              <h3>{clear.subject}</h3>
              <p>
                <strong>{clear.name}</strong> · {clear.email}
              </p>
              {clear.orderReference && (
                <p>Order reference: {clear.orderReference}</p>
              )}
              <p className="message-body">{clear.message}</p>
              <div className="inline-actions">
                <button
                  className="button primary"
                  disabled={busy || selected.status === 'RESOLVED'}
                  onClick={() =>
                    void status('RESOLVED').catch((e) => setError(e.message))
                  }
                >
                  Mark resolved
                </button>
                <button
                  className="button outline"
                  onClick={() =>
                    void status('NEW').catch((e) => setError(e.message))
                  }
                >
                  Mark unread
                </button>
              </div>
              <button
                className="text-link inbox-delete"
                disabled={busy}
                onClick={() =>
                  void removeSelected().catch((e) => setError(e.message))
                }
              >
                Delete message
              </button>
              <p className="filter-note">
                Replies are not sent automatically. Keep personal information
                within your approved support process.
              </p>
            </article>
          ) : (
            <div className="empty-state">
              <LockKeyhole />
              <h3>
                {selected
                  ? 'Unlock to read this message.'
                  : 'Choose a message.'}
              </h3>
              <p>
                Only your recovery key can decrypt the sender’s details and
                message.
              </p>
            </div>
          )}
        </div>
      </div>
      <div className="pagination">
        {page > 1 && (
          <button className="button outline" onClick={() => setPage(page - 1)}>
            Previous
          </button>
        )}
        {page * 20 < total && (
          <button className="button outline" onClick={() => setPage(page + 1)}>
            Next page
          </button>
        )}
      </div>
    </section>
  );
}
