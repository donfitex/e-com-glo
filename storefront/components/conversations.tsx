'use client';
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type FormEvent,
} from 'react';
import Link from 'next/link';
import { customerInboxKey } from '@/lib/customer-inbox';
import { MessageCircle, Plus, Send, CheckCheck } from 'lucide-react';
import { api } from '@/lib/client-api';
import {
  decryptReply,
  encryptReply,
  type ContactKey,
  type ConversationEnvelope,
} from '@/lib/contact-crypto';
import { useSession } from './session';
import {
  useInboxNotifications,
  notifyInboxChanged,
} from './inbox-notifications';
import {
  ConversationKey,
  type UnlockedConversationKey,
} from './conversation-key';
interface Thread {
  id: string;
  customerKeyId: string;
  adminKeyId: string;
  resolved: boolean;
  sequence: number;
  unread: boolean;
  updatedAt: string;
  customerKey: ContactKey;
  adminKey: ContactKey;
}
interface Entry {
  id: string;
  senderId: string;
  fromAdmin: boolean;
  sequence: number;
  createdAt: string;
  envelope: ConversationEnvelope;
}
interface Detail {
  thread: Thread;
  messages: Entry[];
  hasOlder: boolean;
}
function ConversationPanel() {
  const { user, loading } = useSession();
  const admin = user?.role === 'ADMIN';
  const { announcementUnread } = useInboxNotifications();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [clear, setClear] = useState<Record<string, string>>({});
  const [key, setKey] = useState<UnlockedConversationKey | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState('');
  const generation = useRef(0);
  const pending = useRef<{
    body: string;
    envelope: ConversationEnvelope;
  } | null>(null);
  useEffect(() => {
    if (!user || admin) return;
    let active = true;
    const restore = () => {
      void customerInboxKey(user.id).then((value) => {
        if (active) setKey(value);
      });
    };
    restore();
    window.addEventListener('customer-key-ready', restore);
    return () => {
      active = false;
      window.removeEventListener('customer-key-ready', restore);
    };
  }, [user, admin]);
  const load = useCallback(async () => {
    const list = await api<{ items: Thread[]; total: number }>(
      `/conversations?page=${page}&limit=12`,
    );
    setThreads(list.items);
    setTotal(list.total);
  }, [page]);
  useEffect(() => {
    if (!user) return;
    void load().catch((e) => setError(e.message));
  }, [user, load]);
  const refresh = useCallback(async () => {
    if (!selected) return;
    const result = await api<Detail>(`/conversations/${selected}`);
    setDetail((current) =>
      current &&
      current.thread.id === result.thread.id &&
      current.thread.sequence === result.thread.sequence &&
      current.thread.resolved === result.thread.resolved
        ? current
        : result,
    );
  }, [selected]);
  useEffect(() => {
    if (!user) return;
    const poll = () => {
      if (document.visibilityState === 'visible') {
        void load().catch(() => {});
        void refresh().catch(() => {});
      }
    };
    const timer = setInterval(poll, 15000);
    window.addEventListener('focus', poll);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', poll);
    };
  }, [user, load, refresh]);
  useEffect(() => {
    generation.current++;
    setClear({});
    setDetail(null);
    setBody('');
    pending.current = null;
    if (selected) void refresh().catch((e) => setError(e.message));
  }, [selected, refresh]);
  useEffect(() => {
    if (!detail || !key) return;
    const attempt = ++generation.current;
    const current = detail;
    void (async () => {
      const decoded = await Promise.all(
        current.messages.map(async (m) => {
          if (
            m.envelope.senderId !== m.senderId ||
            m.envelope.conversationId !== current.thread.id ||
            m.envelope.id !== m.id
          )
            throw new Error('Message identity verification failed');
          return [
            m.id,
            await decryptReply(m.envelope, key.keyId, key.privateKey),
          ] as const;
        }),
      );
      if (attempt !== generation.current) return;
      setClear(Object.fromEntries(decoded));
      const sequence = current.messages.at(-1)?.sequence ?? 0;
      if (sequence) {
        await api(`/conversations/${current.thread.id}/read`, {
          method: 'POST',
          body: JSON.stringify({ sequence }),
        });
        notifyInboxChanged();
        void load().catch(() => {});
      }
    })().catch((e) => {
      if (attempt === generation.current)
        setError(e instanceof Error ? e.message : 'Message decryption failed');
    });
    return () => {
      generation.current++;
    };
  }, [detail, key, load]);
  function lock() {
    generation.current++;
    setKey(null);
    setClear({});
    setBody('');
    pending.current = null;
  }
  async function start() {
    if (!key || !user) return;
    setBusy(true);
    setError('');
    try {
      const recipient = await api<ContactKey | null>('/contact/key');
      if (!recipient)
        throw new Error('The store has not activated its secure inbox.');
      const t = await api<Thread>('/conversations', {
        method: 'POST',
        body: JSON.stringify({
          id: crypto.randomUUID(),
          customerKeyId: key.keyId,
          adminKeyId: recipient.id,
        }),
      });
      setSelected(t.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start conversation');
    } finally {
      setBusy(false);
    }
  }
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!key || !detail || !user) return;
    setBusy(true);
    setError('');
    try {
      const envelope =
        pending.current?.body === body &&
        pending.current.envelope.conversationId === detail.thread.id
          ? pending.current.envelope
          : await encryptReply(
              body,
              detail.thread.id,
              user.id,
              detail.thread.customerKey,
              detail.thread.adminKey,
            );
      pending.current = { body, envelope };
      await api(`/conversations/${detail.thread.id}/messages`, {
        method: 'POST',
        body: JSON.stringify(envelope),
      });
      pending.current = null;
      setBody('');
      await refresh();
      await load();
      notifyInboxChanged();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not send message. Your draft is kept.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function resolve() {
    if (!detail) return;
    try {
      await api(`/conversations/${detail.thread.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ resolved: !detail.thread.resolved }),
      });
      await refresh();
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not update conversation',
      );
    }
  }
  async function older() {
    if (!detail?.messages.length) return;
    try {
      const old = await api<Detail>(
        `/conversations/${detail.thread.id}?before=${detail.messages[0]!.sequence}`,
      );
      setDetail((current) =>
        current?.thread.id === old.thread.id
          ? {
              ...current,
              messages: [...old.messages, ...current.messages],
              hasOlder: old.hasOlder,
            }
          : current,
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not load earlier messages',
      );
    }
  }
  if (loading) return <p>Loading your inbox…</p>;
  if (!user)
    return (
      <div className="empty-state">
        <MessageCircle />
        <h1>A conversation that stays with you.</h1>
        <p>
          Sign in to send private messages, receive replies and track your
          support conversations.
        </p>
        <Link className="button primary" href="/login?next=/account/inbox">
          Sign in to your inbox
        </Link>
      </div>
    );
  const requiredId = detail
    ? admin
      ? detail.thread.adminKeyId
      : detail.thread.customerKeyId
    : undefined;
  const unlockedForThread = !!key && (!requiredId || key.keyId === requiredId);
  return (
    <section className="conversations">
      <div className="section-heading">
        <div>
          <span className="eyebrow muted">HERE TO HELP, EVERY STEP</span>
          <h1>{admin ? 'Customer conversations' : 'Your private inbox'}</h1>
          <p>
            Replies, updates and a little peace of mind. Private messages, with
            seamless account recovery.
          </p>
        </div>
        {!admin && (
          <button
            className="button primary"
            disabled={!key || busy}
            onClick={() => void start()}
          >
            <Plus size={17} />
            New conversation
          </button>
        )}
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button className="text-link" onClick={() => setError('')}>
            Dismiss
          </button>
        </div>
      )}
      {admin ? (
        <ConversationKey
          admin
          requiredId={requiredId}
          unlocked={key}
          onUnlock={setKey}
          onLock={lock}
        />
      ) : (
        <div className="conversation-assurance">
          <strong>You’re connected to E-com Global support.</strong>
          <p>
            Your messages stay private. We’ll notify you here when the team
            replies.
          </p>
          {!key && (
            <Link className="button outline" href="/login?next=/account/inbox">
              Sign in to sync your private messages
            </Link>
          )}
        </div>
      )}
      {admin && key && requiredId !== undefined && !unlockedForThread && (
        <p className="notice">
          This conversation uses an older recovery key. Lock the inbox, then
          import key {requiredId}.
        </p>
      )}
      {!admin && (
        <div className="section-heading">
          <Link className="button outline" href="/account/updates">
            Store updates
            {announcementUnread ? ` · ${announcementUnread} unread` : ''}
          </Link>
          <Link className="text-link" href="/help">
            Help & frequently asked questions →
          </Link>
        </div>
      )}
      <div className="conversation-layout">
        <aside className="conversation-list" aria-label="Conversations">
          <div className="section-heading">
            <h2>Conversations</h2>
            <button
              className="text-link"
              onClick={() => void load().catch((e) => setError(e.message))}
            >
              Refresh list
            </button>
          </div>
          {!threads.length && (
            <p>
              No conversations yet.{' '}
              {admin
                ? 'New customer messages will appear here.'
                : 'Start a conversation whenever you need a hand.'}
            </p>
          )}
          {threads.map((t) => (
            <button
              key={t.id}
              className={`thread-card ${selected === t.id ? 'selected' : ''}`}
              onClick={() => setSelected(t.id)}
            >
              <strong>Support · {t.id.slice(0, 8)}</strong>
              <span>
                {t.resolved
                  ? 'Resolved'
                  : t.sequence
                    ? 'Open conversation'
                    : 'Draft conversation'}
                {t.unread ? ' · Unread' : ''}
              </span>
              <small>{new Date(t.updatedAt).toLocaleString()}</small>
            </button>
          ))}
          <div className="pagination">
            {page > 1 && (
              <button
                className="text-link"
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
            )}
            {page * 12 < total && (
              <button
                className="text-link"
                onClick={() => setPage((p) => p + 1)}
              >
                Next conversations
              </button>
            )}
          </div>
        </aside>
        <div className="conversation-detail" aria-label="Conversation messages">
          {!detail ? (
            <div className="empty-state">
              <MessageCircle />
              <h2>Your messages, all together.</h2>
              <p>Choose a conversation to see its history.</p>
            </div>
          ) : (
            <>
              <div className="section-heading">
                <div>
                  <h2>Support · {detail.thread.id.slice(0, 8)}</h2>
                  <span className="eyebrow muted">
                    {detail.thread.resolved ? 'RESOLVED' : 'OPEN'} ·{' '}
                    {detail.thread.sequence} MESSAGES
                  </span>
                </div>
                <button
                  className="button outline"
                  onClick={() => void resolve()}
                >
                  <CheckCheck size={17} />
                  {detail.thread.resolved
                    ? 'Reopen conversation'
                    : 'Mark resolved'}
                </button>
              </div>
              {detail.hasOlder && (
                <button className="text-link" onClick={() => void older()}>
                  Load earlier messages
                </button>
              )}
              <div className="message-history" aria-live="polite">
                {detail.messages.map((m) => (
                  <article
                    key={m.id}
                    className={`message-bubble ${m.senderId === user.id ? 'outgoing' : 'incoming'}`}
                  >
                    <div className="message-meta">
                      <strong>
                        {m.senderId === user.id
                          ? 'You'
                          : m.fromAdmin
                            ? 'Store team'
                            : 'Customer'}
                      </strong>
                      <time dateTime={m.createdAt}>
                        {new Date(m.createdAt).toLocaleString()}
                      </time>
                    </div>
                    <p>
                      {clear[m.id] ??
                        (admin
                          ? 'Encrypted message · unlock the store key to read.'
                          : 'Loading your private message…')}
                    </p>
                  </article>
                ))}
                {!detail.messages.length && (
                  <p>
                    Start with your question, delivery concern or order
                    reference.
                  </p>
                )}
              </div>
              <form className="reply-composer" onSubmit={send}>
                <label>
                  Your reply
                  <textarea
                    required
                    maxLength={5000}
                    rows={4}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    disabled={!unlockedForThread || busy}
                    placeholder="Write your message…"
                  />
                </label>
                <div className="section-heading">
                  <small>{body.length}/5,000 · Encrypted before sending</small>
                  <button
                    className="button primary"
                    disabled={!unlockedForThread || busy || !body.trim()}
                  >
                    <Send size={16} />
                    {busy ? 'Sending…' : 'Send reply'}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

// Remount all private view state when the signed-in identity changes.
export function Conversations() {
  const { user } = useSession();
  return <ConversationPanel key={user?.id ?? 'signed-out'} />;
}
