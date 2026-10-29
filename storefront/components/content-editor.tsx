'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client-api';
import type { SiteContent } from '@/lib/site-content';
import { ProductImageUpload } from './product-image-upload';
const labels: Record<string, string> = {
  hero: 'Hero banner',
  editorial: 'Home & living banner',
  categories: 'Category heading',
  arrivals: 'Product heading',
  closing: 'Closing section',
  announcement: 'Announcement bar',
  trust: 'Shopping benefits',
  footer: 'Footer',
  faq: 'Help & FAQ',
};
const label = (value: string) =>
  value.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
export function ContentEditor() {
  const router = useRouter();
  const [site, setSite] = useState<SiteContent | null>(null);
  const [section, setSection] = useState('hero');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    api<SiteContent>('/admin/content')
      .then(setSite)
      .catch((e) => setError(e.message));
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!site) return;
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const current = site.content[section]!;
      const updated = Object.fromEntries(
        Object.entries(current).map(([key, value]) => [
          key,
          typeof value === 'boolean'
            ? values.has(key)
            : key === 'imageUrl'
              ? value
              : String(values.get(key) ?? value),
        ]),
      );
      const photo = values.get('photo');
      if (photo instanceof File && photo.size)
        updated.imageUrl = (
          await api<{ url: string }>('/admin/images', {
            method: 'POST',
            body: photo,
            headers: { 'Content-Type': photo.type },
          })
        ).url;
      const result = await api<SiteContent>('/admin/content', {
        method: 'PUT',
        body: JSON.stringify({
          revision: site.revision,
          content: { ...site.content, [section]: updated },
        }),
      });
      setSite(result);
      setVersion((v) => v + 1);
      setMessage('Section published. The storefront now uses your changes.');
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not publish this section.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="content-manager">
      <div className="section-heading">
        <div>
          <h2>Make the storefront yours.</h2>
          <p>
            Update each section, its links and photography. Published changes
            appear on the storefront.
          </p>
        </div>
        <a
          className="text-link"
          href="/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Preview storefront ↗
        </a>
      </div>
      <div className="content-tabs" aria-label="Storefront sections">
        {Object.entries(labels).map(([key, title]) => (
          <button
            className={`button ${section === key ? 'primary' : 'outline'}`}
            key={key}
            onClick={() => {
              setSection(key);
              setMessage('');
            }}
          >
            {title}
          </button>
        ))}
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
      {site ? (
        <form
          className="form-card content-form"
          key={`${section}-${version}`}
          onSubmit={save}
        >
          <h3>{labels[section]}</h3>
          {Object.entries(site.content[section] ?? {})
            .filter(([key]) => key !== 'imageUrl')
            .map(([key, value]) => (
              <label
                key={key}
                className={typeof value === 'boolean' ? 'checkbox-label' : ''}
              >
                {typeof value === 'boolean' ? (
                  <>
                    <input name={key} type="checkbox" defaultChecked={value} />{' '}
                    Show this section
                  </>
                ) : (
                  <>
                    {label(key)}
                    <textarea
                      name={key}
                      aria-label={label(key)}
                      defaultValue={value}
                      maxLength={
                        /description|answer/i.test(key) ||
                        (section === 'editorial' && key === 'title')
                          ? 1200
                          : /Href/.test(key)
                            ? 300
                            : 180
                      }
                      rows={/description|answer/i.test(key) ? 3 : 2}
                    />
                  </>
                )}
              </label>
            ))}
          {typeof site.content[section]?.imageUrl === 'string' && (
            <ProductImageUpload
              label="Section image"
              existing={String(site.content[section]?.imageUrl)}
              required={false}
            />
          )}
          <button className="button primary" disabled={busy}>
            {busy ? 'Publishing…' : 'Publish section'}
          </button>
        </form>
      ) : (
        !error && <p>Loading storefront content…</p>
      )}
    </section>
  );
}
