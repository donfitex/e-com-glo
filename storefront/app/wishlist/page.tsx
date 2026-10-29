import { WishlistPage } from '@/components/wishlist-page';
export const metadata = { title: 'Saved products' };
export default function Page() {
  return (
    <div className="shell page">
      <WishlistPage />
    </div>
  );
}
