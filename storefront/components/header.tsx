'use client';
import Link from 'next/link';
import {
  Globe2,
  Search,
  UserRound,
  ShoppingBag,
  Menu,
  X,
  ArrowUpRight,
} from 'lucide-react';
import { useState } from 'react';
import { useSession } from './session';
import { useSiteContent } from './site-provider';
import { siteText } from '@/lib/site-content';
import { InboxBell } from './inbox-notifications';
import { ThemeToggle } from './theme-toggle';
export function Header() {
  const { user, count } = useSession();
  const site = useSiteContent();
  const [menu, setMenu] = useState(false);
  return (
    <>
      {site?.content.announcement?.enabled !== false && (
        <div className="announcement">
          <span>
            {siteText(
              site,
              'announcement',
              'text',
              'A world of good finds. All in one place.',
            )}
          </span>
          <Link href={siteText(site, 'announcement', 'buttonHref', '/shop')}>
            {siteText(
              site,
              'announcement',
              'buttonLabel',
              'Explore the collection',
            )}{' '}
            <ArrowUpRight size={13} />
          </Link>
        </div>
      )}
      <header className="header">
        <div className="shell header-main">
          <Link href="/" className="brand" aria-label="E-com Global home">
            <Globe2 size={34} strokeWidth={1.4} />
            <span>
              E-com<span className="brand-light">Global</span>
              <i />
            </span>
          </Link>
          <form className="search" action="/shop">
            <Search size={19} />
            <input
              aria-label="Search products"
              name="q"
              placeholder="What are you looking for?"
            />
            <button type="submit">Search</button>
          </form>
          <div
            className={`header-actions ${user?.role === 'ADMIN' ? 'admin-header-actions' : ''}`}
          >
            {user?.role === 'ADMIN' && <InboxBell />}
            <ThemeToggle />
            <Link className="account-link" href={user ? '/account' : '/login'}>
              <UserRound size={21} />
              <span>{user ? user.name.split(' ')[0] : 'Sign in'}</span>
            </Link>
            <Link
              className="bag"
              href="/cart"
              aria-label={`Shopping bag, ${count} items`}
            >
              <ShoppingBag size={22} />
              <span>{count}</span>
            </Link>
            <button
              className="icon-button mobile-menu"
              aria-label={menu ? 'Close menu' : 'Open menu'}
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              {menu ? <X /> : <Menu />}
            </button>
          </div>
        </div>
        <nav
          className={`shell nav ${menu ? 'nav-open' : ''}`}
          aria-label="Main navigation"
        >
          <Link
            href="/shop"
            onClick={() => setMenu(false)}
            className="all-categories"
          >
            <Menu size={16} /> All categories
          </Link>
          <Link
            href="/shop?category=electronics"
            onClick={() => setMenu(false)}
          >
            Electronics
          </Link>
          <Link href="/shop?category=fashion" onClick={() => setMenu(false)}>
            Fashion
          </Link>
          <Link
            href="/shop?category=home-living"
            onClick={() => setMenu(false)}
          >
            Home & living
          </Link>
          <Link href="/shop?category=beauty" onClick={() => setMenu(false)}>
            Beauty
          </Link>
          <Link href="/shop?category=sports" onClick={() => setMenu(false)}>
            Sports & outdoors
          </Link>
          <Link href="/contact" onClick={() => setMenu(false)}>
            Contact us
          </Link>
          <Link href="/shop" className="nav-discover">
            Discover something new <ArrowUpRight size={14} />
          </Link>
        </nav>
      </header>
    </>
  );
}
