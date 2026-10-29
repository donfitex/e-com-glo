'use client';
import { useState, useEffect, useCallback, type FormEvent } from 'react';
import Link from 'next/link';
import { ProductImageUpload } from './product-image-upload';
import { api } from '@/lib/client-api';
import { useSession } from './session';
import {
  money,
  currencies,
  type Product,
  type Category,
  type Page,
  type Order,
} from '@/lib/types';
const transitions: Record<string, string[]> = {
  PENDING: ['CANCELLED'],
  CONFIRMED: ['SHIPPED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};
export function Admin() {
  const { user, loading } = useSession();
  const [tab, setTab] = useState<'products' | 'categories' | 'orders'>(
    'products',
  );
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [editing, setEditing] = useState<Product | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const [categoryEdit, setCategoryEdit] = useState<Category | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [savedLink, setSavedLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const load = useCallback(async () => {
    setError('');
    try {
      const categoryData = await api<Category[]>('/categories');
      setCategories(categoryData);
      if (tab === 'products') {
        const data = await api<Page<Product>>(
          `/admin/products?page=${page}&limit=10`,
        );
        setProducts(data.items);
        setTotal(data.total);
      }
      if (tab === 'orders') {
        const data = await api<Page<Order>>(
          `/admin/orders?page=${page}&limit=10`,
        );
        setOrders(data.items);
        setTotal(data.total);
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not load management data.',
      );
    }
  }, [tab, page]);
  useEffect(() => {
    if (user?.role === 'ADMIN') void load();
  }, [user, load]);
  async function mutate(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError('');
    setMessage('');
    setSavedLink('');
    try {
      await action();
      setMessage(success);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function saveProduct(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const values = new FormData(form);
    const payload = {
      sku: String(values.get('sku')),
      name: String(values.get('name')),
      description: String(values.get('description')),
      price: Number(values.get('price')),
      currency: String(values.get('currency')),
      stock: Number(values.get('stock')),
      categoryId: String(values.get('categoryId')),
      active: values.get('active') === 'on',
      attributes: {
        ...(editing?.attributes ?? {}),
      },
    };
    if (
      await mutate(async () => {
        const photo = values.get('photo');
        if (photo instanceof File && photo.size) {
          const uploaded = await api<{ url: string }>('/admin/images', {
            method: 'POST',
            body: photo,
            headers: { 'Content-Type': photo.type },
          });
          payload.attributes.imageUrl = uploaded.url;
        }
        const saved = await api<Product>(
          `/products${editing ? `/${editing.id}` : ''}`,
          {
            method: editing ? 'PATCH' : 'POST',
            body: JSON.stringify(payload),
          },
        );
        if (saved.active)
          setSavedLink(
            `/shop?category=${encodeURIComponent(categories.find((c) => c.id === saved.categoryId)?.slug ?? '')}&currency=${saved.currency}`,
          );
        return saved;
      }, 'Product saved.')
    ) {
      setEditing(null);
      setFormVersion((version) => version + 1);
      form.reset();
    }
  }
  async function saveCategory(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    if (
      await mutate(
        () =>
          api(`/categories${categoryEdit ? `/${categoryEdit.id}` : ''}`, {
            method: categoryEdit ? 'PATCH' : 'POST',
            body: JSON.stringify(values),
          }),
        'Category saved.',
      )
    ) {
      setCategoryEdit(null);
      form.reset();
    }
  }
  if (loading) return <div className="shell page">Checking access…</div>;
  if (user?.role !== 'ADMIN')
    return (
      <div className="shell page empty-state">
        <h1>Store management.</h1>
        <p>Administrator access is required.</p>
        <Link href="/login?next=/admin" className="button primary">
          Sign in
        </Link>
      </div>
    );
  return (
    <div className="shell page">
      <div className="page-heading">
        <span className="eyebrow muted">E-COM GLOBAL / MANAGEMENT</span>
        <h1>Behind the good finds.</h1>
        <p>Catalog, inventory and orders, in one place.</p>
      </div>
      <nav className="admin-tabs" aria-label="Management sections">
        {(['products', 'categories', 'orders'] as const).map((name) => (
          <button
            key={name}
            className={tab === name ? 'selected' : ''}
            onClick={() => {
              setTab(name);
              setPage(1);
              setMessage('');
            }}
          >
            {name[0]!.toUpperCase() + name.slice(1)}
          </button>
        ))}
      </nav>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="notice" role="status">
          {message}
          {savedLink && (
            <Link className="text-link" href={savedLink} prefetch={false}>
              View category →
            </Link>
          )}
        </div>
      )}
      {tab === 'products' && (
        <div className="admin-layout">
          <div>
            <div className="results-heading">
              <span>{total} products · active and inactive</span>
              <span>Page {page}</span>
            </div>
            <div className="admin-list">
              {products.map((product) => (
                <article className="admin-row" key={product.id}>
                  <div>
                    <h3>{product.name}</h3>
                    <p>
                      {product.sku} · {money(product.price, product.currency)} ·{' '}
                      {product.stock} in stock
                    </p>
                    <span className="status">
                      {product.active ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </div>
                  <div className="inline-actions">
                    <button
                      className="button outline"
                      disabled={busy}
                      onClick={() => setEditing(product)}
                    >
                      Edit
                    </button>
                    <button
                      className="button outline"
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          () =>
                            api(`/products/${product.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ active: !product.active }),
                            }),
                          product.active
                            ? 'Product deactivated.'
                            : 'Product activated.',
                        )
                      }
                    >
                      {product.active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
          <form
            className="form-card admin-form"
            key={editing?.id ?? `new-product-${formVersion}`}
            onSubmit={saveProduct}
          >
            <h2>{editing ? 'Edit product' : 'Add a good find'}</h2>
            <label>
              Product name
              <input
                name="name"
                required
                maxLength={200}
                defaultValue={editing?.name}
              />
            </label>
            <label>
              SKU
              <input
                name="sku"
                required
                maxLength={100}
                defaultValue={editing?.sku}
              />
            </label>
            <label>
              Description
              <textarea
                name="description"
                required
                maxLength={10000}
                defaultValue={editing?.description}
              />
            </label>
            <div className="form-columns">
              <label>
                Price (minor units)
                <input
                  name="price"
                  type="number"
                  min={0}
                  max={1000000000}
                  step={1}
                  required
                  defaultValue={editing?.price}
                />
              </label>
              <label>
                Currency
                <select
                  name="currency"
                  defaultValue={editing?.currency ?? 'NGN'}
                >
                  {currencies.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
            <small>
              USD 1999 = $19.99; JPY 1999 = ¥1999. Existing SKU currency cannot
              change.
            </small>
            <div className="form-columns">
              <label>
                Stock
                <input
                  name="stock"
                  required
                  type="number"
                  min={0}
                  max={1000000}
                  step={1}
                  defaultValue={editing?.stock ?? 0}
                />
              </label>
              <label>
                Category
                <select
                  name="categoryId"
                  aria-label="Category"
                  required
                  defaultValue={editing?.categoryId}
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <ProductImageUpload
              existing={editing?.attributes.imageUrl}
              required={!editing}
            />
            <label className="checkbox-label">
              <input
                name="active"
                type="checkbox"
                defaultChecked={editing?.active ?? true}
              />{' '}
              Visible in the store
            </label>
            <button
              className="button primary"
              disabled={busy || !categories.length}
            >
              {busy ? 'Saving…' : 'Save product'}
            </button>
            {editing && (
              <button
                type="button"
                className="text-link"
                onClick={() => setEditing(null)}
              >
                Cancel editing
              </button>
            )}
          </form>
        </div>
      )}
      {tab === 'categories' && (
        <div className="admin-layout">
          <div className="admin-list">
            {categories.map((category) => (
              <div className="admin-row" key={category.id}>
                <div>
                  <h3>{category.name}</h3>
                  <p>{category.slug}</p>
                </div>
                <button
                  className="button outline"
                  onClick={() => setCategoryEdit(category)}
                >
                  Edit
                </button>
                <button
                  className="button outline"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete the empty category “${category.name}”?`,
                      )
                    )
                      void mutate(
                        () =>
                          api(`/categories/${category.id}`, {
                            method: 'DELETE',
                          }),
                        'Category deleted.',
                      );
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
          <form
            className="form-card admin-form"
            key={categoryEdit?.id ?? 'new-category'}
            onSubmit={saveCategory}
          >
            <h2>{categoryEdit ? 'Edit category' : 'Create a category'}</h2>
            <label>
              Name
              <input
                name="name"
                required
                maxLength={100}
                defaultValue={categoryEdit?.name}
              />
            </label>
            <label>
              Slug
              <input
                name="slug"
                required
                maxLength={100}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                defaultValue={categoryEdit?.slug}
                placeholder="e.g. home-living"
              />
            </label>
            <button className="button primary" disabled={busy}>
              Save category
            </button>
            {categoryEdit && (
              <button
                type="button"
                className="text-link"
                onClick={() => setCategoryEdit(null)}
              >
                Cancel editing
              </button>
            )}
          </form>
        </div>
      )}
      {tab === 'orders' && (
        <>
          <div className="results-heading">
            <span>{total} orders</span>
            <span>Page {page}</span>
          </div>
          <div className="admin-list">
            {orders.map((order) => (
              <div className="admin-row" key={order.id}>
                <div>
                  <h3>
                    #{order.id.slice(0, 8).toUpperCase()} ·{' '}
                    {order.shippingAddress.name}
                  </h3>
                  <p>
                    {new Date(order.createdAt).toLocaleDateString()} ·{' '}
                    {order.shippingAddress.country} ·{' '}
                    {money(order.total, order.currency)}
                  </p>
                  <span className="status">
                    {order.status} / {order.paymentStatus}
                  </span>
                </div>
                <label>
                  Update status
                  <select
                    aria-label={`Update order ${order.id.slice(0, 8)}`}
                    disabled={busy}
                    value=""
                    onChange={(e) => {
                      const status = e.target.value;
                      if (status)
                        void mutate(
                          () =>
                            api(`/admin/orders/${order.id}/status`, {
                              method: 'PATCH',
                              body: JSON.stringify({ status }),
                            }),
                          'Order status updated.',
                        );
                    }}
                  >
                    <option value="">Choose next step</option>
                    {(transitions[order.status] ?? [])
                      .filter(
                        (status) =>
                          status !== 'CANCELLED' ||
                          order.paymentStatus === 'UNPAID',
                      )
                      .map((status) => (
                        <option key={status}>{status}</option>
                      ))}
                  </select>
                </label>
              </div>
            ))}
          </div>
          <p className="filter-note">
            Paid orders are confirmed by verified Paystack notifications. Paid
            cancellations require the separate refund process; this dashboard
            cannot bypass it.
          </p>
        </>
      )}
      {tab !== 'categories' && (
        <div className="pagination">
          {page > 1 && (
            <button
              className="button outline"
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
          )}
          {page * 10 < total && (
            <button
              className="button outline"
              onClick={() => setPage(page + 1)}
            >
              Next page
            </button>
          )}
        </div>
      )}
    </div>
  );
}
