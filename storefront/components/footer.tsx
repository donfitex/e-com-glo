'use client';
import { useSiteContent } from './site-provider';
import { siteText } from '@/lib/site-content';
import Link from 'next/link';
import { Globe2, ArrowUpRight } from 'lucide-react';
export function Footer() {
  const site = useSiteContent();
  return (
    <footer className="footer">
      <div className="shell footer-main">
        <div>
          <Link className="brand" href="/">
            <Globe2 size={30} />
            <span>
              E-com<span className="brand-light">Global</span>
              <i />
            </span>
          </Link>
          <p>
            {siteText(
              site,
              'footer',
              'description',
              'Everyday essentials. Unexpected discoveries. A little more possibility, wherever you are.',
            )}
          </p>
        </div>
        <div>
          <h3>Explore</h3>
          <Link href="/shop">
            All products <ArrowUpRight size={13} />
          </Link>
          <Link href="/shop?category=electronics">Electronics</Link>
          <Link href="/shop?category=home-living">Home & living</Link>
        </div>
        <div>
          <h3>Your account</h3>
          <Link href="/account">My account</Link>
          <Link href="/account/orders">Orders & tracking</Link>
          <Link href="/cart">Shopping bag</Link>
          <Link href="/wishlist">Saved products</Link>
          <Link href="/contact">Contact us</Link>
          <Link href="/help">Help & FAQ</Link>
        </div>
        <div className="footer-note">
          <span className="eyebrow">
            {siteText(
              site,
              'footer',
              'eyebrow',
              'BUILT FOR EVERYDAY DISCOVERY',
            )}
          </span>
          <h3>
            {siteText(
              site,
              'footer',
              'title',
              'One world. More possibilities.',
            )}
          </h3>
        </div>
      </div>
      <div className="shell footer-bottom">
        <span>© {new Date().getFullYear()} E-com Global</span>
        <Link href="/policies">Shipping, payments & privacy</Link>
        <span>
          {siteText(
            site,
            'footer',
            'bottomText',
            'Thoughtfully selected. Globally minded.',
          )}
        </span>
      </div>
    </footer>
  );
}
