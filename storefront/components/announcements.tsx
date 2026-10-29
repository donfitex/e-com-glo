'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Megaphone, MailCheck, Send } from 'lucide-react';
import { api } from '@/lib/client-api';
import { useSession } from './session';
import { notifyInboxChanged } from './inbox-notifications';
import { ProductImageUpload } from './product-image-upload';
interface Announcement {
  id: string;
  title: string;
  body: string;
  kind: 'BUSINESS' | 'PROMOTION';
  href: string | null;
  imageUrl: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
  read: boolean;
}
export function Announcements({
  management = false,
}: {
  management?: boolean;
}) {
  const { user, loading } = useSession();
  const [items, setItems] = useState<Announcement[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [promotions, setPromotions] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const [draftId, setDraftId] = useState('');
  const load = useCallback(async () => {
    const list = await api<{ items: Announcement[]; total: number }>(
      `${management ? '/admin/broadcasts' : '/announcements'}?page=${page}&limit=12`,
    );
    setItems(list.items);
    setTotal(list.total);
  }, [management, page]);
  useEffect(() => {
    if (!user) return;
    void load().catch((e) => setError(e.message));
    if (!management)
      void api<{ promotions: boolean }>('/preferences')
        .then((p) => setPromotions(p.promotions))
        .catch((e) => setError(e.message));
  }, [user, management, load]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const values = new FormData(form);
      const savingId = editing?.id ?? (draftId || crypto.randomUUID());
      if (!editing) setDraftId(savingId);
      const photo = values.get('photo');
      let imageUrl = editing?.imageUrl ?? null;
      if (photo instanceof File && photo.size)
        imageUrl = (
          await api<{ url: string }>('/admin/images', {
            method: 'POST',
            body: photo,
            headers: { 'Content-Type': photo.type },
          })
        ).url;
      await api('/admin/broadcasts', {
        method: 'POST',
        body: JSON.stringify({
          id: savingId,
          title: values.get('title'),
          body: values.get('body'),
          kind: values.get('kind'),
          href: values.get('href') || null,
          imageUrl,
        }),
      });
      setEditing(null);
      setDraftId('');
      setFormVersion((v) => v + 1);
      setNotice('Draft saved. Preview it below before publishing.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save draft');
    } finally {
      setBusy(false);
    }
  }
  async function action(id: string, kind: 'publish' | 'archive' | 'read') {
    setBusy(true);
    setError('');
    try {
      await api(
        management
          ? `/admin/broadcasts/${id}/${kind}`
          : `/announcements/${id}/read`,
        { method: 'POST', body: '{}' },
      );
      setNotice(
        kind === 'publish'
          ? 'Published to registered users’ store inboxes.'
          : kind === 'archive'
            ? 'Announcement archived.'
            : 'Marked as read.',
      );
      await load();
      notifyInboxChanged();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not update announcement',
      );
    } finally {
      setBusy(false);
    }
  }
  async function preference(value: boolean) {
    const previous = promotions;
    setPromotions(value);
    setBusy(true);
    try {
      await api('/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ promotions: value }),
      });
      setPromotions(value);
      await load();
      notifyInboxChanged();
      setNotice('Notification preference saved.');
    } catch (e) {
      setPromotions(previous);
      setError(e instanceof Error ? e.message : 'Could not save preference');
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <p>Loading store updates…</p>;
  if (!user)
    return (
      <p>
        <Link href="/login?next=/account/updates">
          Sign in to see your store updates.
        </Link>
      </p>
    );
  return (
    <section>
      <div className="section-heading">
        <div>
          <span className="eyebrow muted">
            {management ? 'REACH YOUR COMMUNITY' : 'GOOD THINGS, KEPT IN VIEW'}
          </span>
          <h1>{management ? 'Announcements & promotions' : 'Store updates'}</h1>
          <p>
            {management
              ? 'Create a draft, preview it and publish to registered customers.'
              : 'Business updates and offers from E-com Global, together in your inbox.'}
          </p>
        </div>
        <Megaphone />
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {management ? (
        <form
          key={`${formVersion}-${editing?.id ?? 'new'}`}
          className="form-card broadcast-composer"
          onSubmit={save}
        >
          <h2>{editing ? 'Edit draft' : 'Create an announcement'}</h2>
          <label>
            Announcement title
            <input
              name="title"
              required
              maxLength={160}
              defaultValue={editing?.title}
            />
          </label>
          <label>
            Announcement type
            <select name="kind" defaultValue={editing?.kind ?? 'BUSINESS'}>
              <option value="BUSINESS">
                Business update · all registered users
              </option>
              <option value="PROMOTION">
                Promotion · users with offers enabled
              </option>
            </select>
          </label>
          <label>
            Announcement message
            <textarea
              name="body"
              required
              maxLength={5000}
              rows={5}
              defaultValue={editing?.body}
            />
          </label>
          <label>
            Destination link (optional)
            <input
              name="href"
              placeholder="/shop"
              maxLength={250}
              defaultValue={editing?.href ?? ''}
            />
          </label>
          <ProductImageUpload
            existing={editing?.imageUrl ?? undefined}
            required={false}
            label="Announcement image (optional)"
          />
          <div className="product-secondary-actions">
            <button className="button primary" disabled={busy}>
              Save announcement draft
            </button>
            {editing && (
              <button
                type="button"
                className="button outline"
                onClick={() => setEditing(null)}
              >
                Cancel editing
              </button>
            )}
          </div>
          <small>
            Only store links are accepted. Published messages are immutable;
            archive an old message to withdraw it. Promotions respect customer
            preferences.
          </small>
        </form>
      ) : (
        <label className="preference-control">
          <input
            type="checkbox"
            checked={promotions}
            disabled={busy}
            onChange={(e) => void preference(e.target.checked)}
          />
          <span>
            Receive offers and promotions in my store inbox
            <small>
              You can turn offers off anytime. Business updates remain
              available.
            </small>
          </span>
        </label>
      )}
      <div className="announcement-grid">
        {items.map((item) => (
          <article
            className={`announcement-card ${item.read ? '' : 'unread'}`}
            key={item.id}
          >
            {item.imageUrl && <img src={item.imageUrl} alt="" loading="lazy" />}
            <div>
              <span className="eyebrow muted">
                {item.kind === 'PROMOTION' ? 'OFFER' : 'STORE UPDATE'}
                {management
                  ? item.archivedAt
                    ? ' · ARCHIVED'
                    : item.publishedAt
                      ? ' · PUBLISHED'
                      : ' · DRAFT'
                  : !item.read
                    ? ' · NEW'
                    : ''}
              </span>
              <h2>{item.title}</h2>
              <p>{item.body}</p>
              {item.href && (
                <Link className="text-link" href={item.href}>
                  Explore more →
                </Link>
              )}
              <div className="product-secondary-actions">
                {management
                  ? !item.archivedAt && (
                      <>
                        {!item.publishedAt && (
                          <>
                            <button
                              className="button outline"
                              onClick={() => setEditing(item)}
                            >
                              Edit draft
                            </button>
                            <button
                              className="button primary"
                              disabled={busy}
                              onClick={() => void action(item.id, 'publish')}
                            >
                              <Send size={16} />
                              Publish announcement
                            </button>
                          </>
                        )}
                        <button
                          className="text-link"
                          disabled={busy}
                          onClick={() => void action(item.id, 'archive')}
                        >
                          Archive
                        </button>
                      </>
                    )
                  : !item.read && (
                      <button
                        className="button outline"
                        disabled={busy}
                        onClick={() => void action(item.id, 'read')}
                      >
                        <MailCheck size={16} />
                        Mark update read
                      </button>
                    )}
              </div>
            </div>
          </article>
        ))}
      </div>
      {!items.length && (
        <div className="empty-state">
          <Megaphone />
          <h2>
            {management
              ? 'A good update starts here.'
              : 'You’re all caught up.'}
          </h2>
          <p>
            {management
              ? 'Save your first draft to preview it before publishing.'
              : 'New store announcements will appear here.'}
          </p>
        </div>
      )}
      <div className="pagination">
        {page > 1 && (
          <button className="text-link" onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
        )}
        {page * 12 < total && (
          <button className="text-link" onClick={() => setPage((p) => p + 1)}>
            Next updates
          </button>
        )}
      </div>
    </section>
  );
}
