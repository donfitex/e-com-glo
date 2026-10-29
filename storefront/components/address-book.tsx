'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { MapPin, Plus, Star, Trash2 } from 'lucide-react';
import { api } from '@/lib/client-api';
import type { Address } from '@/lib/types';
import { useSession } from './session';
export interface SavedAddress {
  id: string;
  label: string;
  address: Address;
  isDefault: boolean;
}
export function AddressBook() {
  const { user, loading } = useSession();
  const [items, setItems] = useState<SavedAddress[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<SavedAddress | null>(null);
  const [version, setVersion] = useState(0);
  const load = useCallback(
    async () => setItems(await api<SavedAddress[]>('/addresses')),
    [],
  );
  useEffect(() => {
    if (user) void load().catch((e) => setError(e.message));
  }, [user, load]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const { label, ...address } = Object.fromEntries(new FormData(form));
    setBusy(true);
    setError('');
    try {
      await api('/addresses', {
        method: 'POST',
        body: JSON.stringify({ label, address }),
      });
      setEditing(null);
      setVersion((v) => v + 1);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save address');
    } finally {
      setBusy(false);
    }
  }
  async function action(id: string, kind: 'default' | 'delete') {
    setBusy(true);
    setError('');
    try {
      await api(`/addresses/${id}${kind === 'default' ? '/default' : ''}`, {
        method: kind === 'default' ? 'PATCH' : 'DELETE',
        ...(kind === 'default' ? { body: '{}' } : {}),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update address');
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <p>Loading delivery addresses…</p>;
  if (!user)
    return (
      <p>
        <Link href="/login?next=/account/addresses">
          Sign in to manage your delivery addresses.
        </Link>
      </p>
    );
  return (
    <section>
      <div className="page-heading">
        <span className="eyebrow muted">YOUR PLACES, READY WHEN YOU ARE</span>
        <h1>Delivery addresses</h1>
        <p>
          Save up to ten destinations. Choose a saved address or enter somewhere
          new at checkout.
        </p>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <div className="address-grid">
        {items.map((item) => (
          <article className="address-card" key={item.id}>
            <div className="section-heading">
              <h2>
                <MapPin size={18} /> {item.label}
              </h2>
              {item.isDefault && <span className="eyebrow muted">DEFAULT</span>}
            </div>
            <p>
              {item.address.name}
              <br />
              {item.address.line1}
              {item.address.line2 && (
                <>
                  <br />
                  {item.address.line2}
                </>
              )}
              <br />
              {item.address.city}, {item.address.region}{' '}
              {item.address.postalCode}
              <br />
              {item.address.country}
            </p>
            <small>
              {item.address.phone}
              <br />
              {item.address.email}
            </small>
            <div className="product-secondary-actions">
              {!item.isDefault && (
                <button
                  className="text-link"
                  disabled={busy}
                  onClick={() => void action(item.id, 'default')}
                >
                  <Star size={16} />
                  Make default
                </button>
              )}
              <button className="text-link" onClick={() => setEditing(item)}>
                Use as template
              </button>
              <button
                className="text-link"
                disabled={busy}
                onClick={() => void action(item.id, 'delete')}
              >
                <Trash2 size={16} />
                Remove address
              </button>
            </div>
          </article>
        ))}
      </div>
      <form
        className="form-card address-editor"
        onSubmit={save}
        key={`${version}-${editing?.id ?? 'new'}`}
      >
        <h2>
          <Plus size={20} />
          {editing ? 'Save a new version' : 'Add a delivery address'}
        </h2>
        <label>
          Address label
          <input
            name="label"
            required
            maxLength={60}
            defaultValue={editing?.label ?? 'Home'}
          />
        </label>
        <div className="form-columns">
          {(
            [
              'name',
              'email',
              'phone',
              'line1',
              'line2',
              'city',
              'region',
              'postalCode',
              'country',
            ] as const
          ).map((field) => (
            <label key={field}>
              {
                {
                  name: 'Full name',
                  email: 'Contact email',
                  phone: 'Phone number',
                  line1: 'Address line 1',
                  line2: 'Address line 2 (optional)',
                  city: 'City',
                  region: 'State / region (optional)',
                  postalCode: 'Postal code',
                  country: 'Country code (e.g. NG)',
                }[field]
              }
              <input
                name={field}
                required={field !== 'line2' && field !== 'region'}
                type={
                  field === 'email'
                    ? 'email'
                    : field === 'phone'
                      ? 'tel'
                      : 'text'
                }
                maxLength={
                  field === 'country'
                    ? 2
                    : field === 'name'
                      ? 120
                      : field === 'email'
                        ? 254
                        : field === 'phone'
                          ? 40
                          : field === 'postalCode'
                            ? 30
                            : field === 'city' || field === 'region'
                              ? 100
                              : 200
                }
                defaultValue={
                  editing?.address[field] ??
                  (field === 'name'
                    ? user.name
                    : field === 'email'
                      ? user.email
                      : '')
                }
              />
            </label>
          ))}
        </div>
        <button
          className="button primary"
          disabled={busy || items.length >= 10}
        >
          {busy ? 'Saving…' : 'Save delivery address'}
        </button>
        <small>
          Existing orders keep their original delivery details. Removing a saved
          address does not change an order.
        </small>
      </form>
    </section>
  );
}
