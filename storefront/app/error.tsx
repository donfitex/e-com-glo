'use client';
import Link from 'next/link';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="shell page empty-state">
      <h1>A small interruption.</h1>
      <p>We couldn’t load this page. Please try again.</p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
      <Link className="text-link" href="/shop">
        Back to the collection
      </Link>
    </div>
  );
}
