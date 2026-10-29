import Link from 'next/link';
export default function NotFound() {
  return (
    <div className="shell page empty-state">
      <span className="eyebrow">404</span>
      <h1>This find has moved on.</h1>
      <p>The page or product you’re looking for isn’t available.</p>
      <Link className="button primary" href="/shop">
        Explore the collection
      </Link>
    </div>
  );
}
