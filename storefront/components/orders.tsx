'use client';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useSession } from './session';
import { api } from '@/lib/client-api';
import { money, type Order, type Page } from '@/lib/types';
export function Orders({ id }: { id?: string }) {
  const { user, loading } = useSession();
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  useEffect(() => {
    if (!user) return;
    let active = true;
    setPending(true);
    (id
      ? api<Order>(`/orders/${id}`).then((order) => ({
          items: [order],
          total: 1,
        }))
      : api<Page<Order>>(`/orders?page=${page}&limit=10`)
    )
      .then((data) => {
        if (active) {
          setOrders(data.items);
          setTotal(data.total);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, [user, id, page]);
  if (loading) return <div className="shell page">Loading…</div>;
  if (!user)
    return (
      <div className="shell page empty-state">
        <h1>Your orders, all together.</h1>
        <Link className="button primary" href="/login?next=/account/orders">
          Sign in
        </Link>
      </div>
    );
  return (
    <div className="shell page">
      <div className="breadcrumb">
        <Link href="/account">My account</Link> / Orders
      </div>
      <div className="page-heading">
        <span className="eyebrow muted">YOUR GOOD FINDS</span>
        <h1>{id ? 'Your order.' : 'Orders & tracking.'}</h1>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {pending ? (
        <p>Loading your orders…</p>
      ) : orders.length ? (
        orders.map((order) => (
          <article className="order-card" key={order.id}>
            <div className="order-heading">
              <div>
                <small>ORDER #{order.id.slice(0, 8).toUpperCase()}</small>
                <p>
                  {new Date(order.createdAt).toLocaleDateString('en', {
                    dateStyle: 'medium',
                  })}
                </p>
              </div>
              <span className={`status status-${order.status.toLowerCase()}`}>
                {order.status}
              </span>
              <strong>{money(order.total, order.currency)}</strong>
            </div>
            {id ? (
              <>
                <div className="order-details">
                  {order.items?.map((item) => (
                    <div className="summary-row" key={item.productId}>
                      <span>
                        {item.name} × {item.quantity}
                      </span>
                      <strong>
                        {money(item.price * item.quantity, order.currency)}
                      </strong>
                    </div>
                  ))}
                  <div className="summary-row">
                    <span>Delivery</span>
                    <span>{money(order.shipping ?? 0, order.currency)}</span>
                  </div>
                  <div className="summary-row">
                    <span>Tax</span>
                    <span>{money(order.tax ?? 0, order.currency)}</span>
                  </div>
                  <p>
                    <strong>Ship to:</strong> {order.shippingAddress.name},{' '}
                    {order.shippingAddress.line1}, {order.shippingAddress.city},{' '}
                    {order.shippingAddress.country}
                  </p>
                  {order.shippingAddress.email && (
                    <p>
                      <strong>Contact email:</strong>{' '}
                      {order.shippingAddress.email}
                    </p>
                  )}
                  {order.shippingAddress.phone && (
                    <p>
                      <strong>Phone:</strong> {order.shippingAddress.phone}
                    </p>
                  )}
                  <p>
                    Payment: <strong>{order.paymentStatus ?? 'UNPAID'}</strong>
                  </p>
                </div>
              </>
            ) : (
              <Link className="text-link" href={`/account/orders/${order.id}`}>
                View order details →
              </Link>
            )}
          </article>
        ))
      ) : (
        !error && (
          <div className="empty-state">
            <h2>Your story starts with a great find.</h2>
            <p>You haven’t placed an order yet.</p>
            <Link className="button primary" href="/shop">
              Explore the collection
            </Link>
          </div>
        )
      )}
      {!id && (
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
              Next
            </button>
          )}
        </div>
      )}
    </div>
  );
}
