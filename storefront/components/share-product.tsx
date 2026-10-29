'use client';
import { useState } from 'react';
import { Share2 } from 'lucide-react';
export function ShareProduct({ id, name }: { id: string; name: string }) {
  const [message, setMessage] = useState('');
  const [fallback, setFallback] = useState('');
  async function share() {
    const url = `${window.location.origin}/products/${id}`;
    try {
      if (navigator.share) await navigator.share({ title: name, url });
      else {
        await navigator.clipboard.writeText(url);
        setMessage('Product link copied.');
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setFallback(url);
      setMessage('Copy the product link below.');
    }
  }
  return (
    <div className="share-product">
      <button className="button outline" onClick={() => void share()}>
        <Share2 size={17} />
        Share product
      </button>
      {message && <span role="status">{message}</span>}
      {fallback && (
        <input
          aria-label="Product link"
          readOnly
          value={fallback}
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
    </div>
  );
}
