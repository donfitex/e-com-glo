import { RecentlyViewed } from '@/components/recently-viewed';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  Globe2,
  ShieldCheck,
  PackageCheck,
  Headphones,
  Shirt,
  Armchair,
  Sparkles,
  Dumbbell,
  BookOpen,
  Leaf,
  Puzzle,
} from 'lucide-react';
import { safeCatalog, defaultCurrency } from '@/lib/server-api';
import { ProductCard } from '@/components/product-card';
import { siteContent } from '@/lib/server-api';
import { siteText } from '@/lib/site-content';
export const dynamic = 'force-dynamic';
const icons = [
  Headphones,
  Shirt,
  Armchair,
  Sparkles,
  Dumbbell,
  BookOpen,
  Leaf,
  Puzzle,
];
export default async function Home() {
  const [data, site] = await Promise.all([
    safeCatalog({ currency: defaultCurrency(), limit: '4' }),
    siteContent(),
  ]);
  const t = (section: string, field: string, fallback: string) =>
    siteText(site, section, field, fallback);
  const enabled = (section: string) =>
    site?.content[section]?.enabled !== false;
  return (
    <>
      {enabled('hero') && (
        <section className="shell hero">
          <div className="hero-copy">
            <div className="eyebrow hero-kicker">
              <span /> {t('hero', 'eyebrow', 'THE EVERYDAY, REIMAGINED')}
            </div>
            <h1>
              {t('hero', 'title', 'Good finds.')}
              <br />
              {t('hero', 'secondLine', 'Global')}{' '}
              <em>{t('hero', 'highlight', 'possibilities.')}</em>
            </h1>
            <p>
              {t(
                'hero',
                'description',
                'From the things you need to the things you love. Discover a world of thoughtful finds, all in one place.',
              )}
            </p>
            <Link
              className="button primary"
              href={t('hero', 'buttonHref', '/shop')}
            >
              {t('hero', 'buttonLabel', 'Find your next favorite')}{' '}
              <ArrowUpRight size={18} />
            </Link>
            <div className="hero-footnote">
              <span className="tiny-globe">
                <Globe2 size={19} />
              </span>
              <span>
                {t('hero', 'footnote', 'Many categories. One great discovery.')}
              </span>
            </div>
          </div>
          <div className="hero-visual">
            <span className="hero-orbit orbit-one" />
            <span className="hero-orbit orbit-two" />
            <div className="hero-disc" />
            <img
              className="hero-headphones product-art"
              src={t('hero', 'imageUrl', '/products/headphones.svg')}
              alt={t(
                'hero',
                'imageAlt',
                'Sculptural sage green wireless headphones',
              )}
            />
            <div className="floating-label">
              <span className="label-dot" />
              <div>
                <small>
                  {t('hero', 'labelEyebrow', 'A LITTLE EVERYDAY UPGRADE')}
                </small>
                <strong>
                  {t('hero', 'labelTitle', 'Less noise. More you.')}
                </strong>
              </div>
            </div>
            <span className="hero-corner">
              {t('hero', 'cornerText', 'SOUND GOOD. FEEL GOOD.')}
            </span>
            <span className="vertical-note">
              {t('hero', 'verticalNote', 'THE E-COM GLOBAL EDIT / 01')}
            </span>
          </div>
        </section>
      )}
      {enabled('trust') && (
        <section className="shell trust-strip" aria-label="Shopping benefits">
          <div>
            <Globe2 />
            <span>
              <strong>{t('trust', 'title1', 'A world of choice')}</strong>
              <small>
                {t('trust', 'text1', 'Eight currencies. Every category.')}
              </small>
            </span>
          </div>
          <div>
            <ShieldCheck />
            <span>
              <strong>{t('trust', 'title2', 'Your account, protected')}</strong>
              <small>
                {t('trust', 'text2', 'Secure sign-in and checkout.')}
              </small>
            </span>
          </div>
          <div>
            <PackageCheck />
            <span>
              <strong>{t('trust', 'title3', 'Know before you order')}</strong>
              <small>
                {t('trust', 'text3', 'Clear totals. Upfront delivery rules.')}
              </small>
            </span>
          </div>
        </section>
      )}
      {enabled('categories') && (
        <section className="shell section">
          <div className="section-heading">
            <div>
              <span className="eyebrow muted">
                {t('categories', 'eyebrow', 'A GOOD PLACE TO START')}
              </span>
              <h2>{t('categories', 'title', 'Find your kind of everyday.')}</h2>
            </div>
            <Link
              className="text-link"
              href={t('categories', 'buttonHref', '/shop')}
            >
              {t('categories', 'buttonLabel', 'Explore all categories')}{' '}
              <ArrowUpRight size={17} />
            </Link>
          </div>
          <div className="category-grid">
            {data.categories.map((category, i) => {
              const Icon =
                (
                  {
                    electronics: Headphones,
                    fashion: Shirt,
                    'home-living': Armchair,
                    beauty: Sparkles,
                    sports: Dumbbell,
                    books: BookOpen,
                    groceries: Leaf,
                    toys: Puzzle,
                  } as Record<string, typeof Headphones>
                )[category.slug] ?? icons[i % icons.length]!;
              return (
                <Link
                  className="category-card"
                  key={category.id}
                  href={`/shop?category=${category.slug}`}
                >
                  <span className={`category-icon category-color-${i % 4}`}>
                    <Icon size={27} strokeWidth={1.4} />
                  </span>
                  <span>{category.name}</span>
                  <ArrowUpRight size={15} />
                </Link>
              );
            })}
          </div>
          {data.error && (
            <div className="notice" role="status">
              {data.error} <Link href="/">Reload catalog</Link>
            </div>
          )}
        </section>
      )}
      {enabled('arrivals') && (
        <section className="shell section arrivals">
          <div className="section-heading">
            <div>
              <span className="eyebrow muted">
                {t('arrivals', 'eyebrow', 'WORTH A CLOSER LOOK')}
              </span>
              <h2>{t('arrivals', 'title', 'Meet your next favorites.')}</h2>
            </div>
            <Link
              className="text-link"
              href={t('arrivals', 'buttonHref', '/shop')}
            >
              {t('arrivals', 'buttonLabel', 'Shop the collection')}{' '}
              <ArrowUpRight size={17} />
            </Link>
          </div>
          <div className="product-grid">
            {data.products.items.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
          {!data.error && !data.products.total && (
            <div className="empty-state">
              <h3>Good things are on the way.</h3>
              <p>Our catalog is being curated. Check back soon.</p>
            </div>
          )}
        </section>
      )}
      {enabled('editorial') && (
        <section className="shell editorial">
          <div className="editorial-art">
            <img
              className="product-art"
              src={t('editorial', 'imageUrl', '/products/lamp.svg')}
              alt={t('editorial', 'imageAlt', 'Warm terracotta table lamp')}
              loading="lazy"
            />
            <span className="eyebrow">
              {t('editorial', 'imageCaption', 'MAKE ROOM FOR WHAT YOU LOVE.')}
            </span>
          </div>
          <div className="editorial-copy">
            <span className="eyebrow">
              {t('editorial', 'eyebrow', 'THE HOME & LIVING EDIT')}
            </span>
            <h2>
              {t('editorial', 'title', 'A little comfort. A lot of character.')}
            </h2>
            <p>
              {t(
                'editorial',
                'description',
                'Simple details that make your space feel a little more like you. Discover a new perspective on everyday living.',
              )}
            </p>
            <Link
              className="button light"
              href={t('editorial', 'buttonHref', '/shop?category=home-living')}
            >
              {t('editorial', 'buttonLabel', 'Make yourself at home')}{' '}
              <ArrowRight size={17} />
            </Link>
          </div>
        </section>
      )}
      <RecentlyViewed />
      {enabled('closing') && (
        <section className="shell closing">
          <span className="eyebrow muted">
            {t('closing', 'eyebrow', 'YOUR EVERYDAY, WITHOUT LIMITS')}
          </span>
          <h2>
            {t('closing', 'title', 'Great finds are closer than you think.')}
          </h2>
          <p>
            {t(
              'closing',
              'description',
              'Explore something different. Find something that feels like you.',
            )}
          </p>
          <Link
            className="text-link"
            href={t('closing', 'buttonHref', '/shop')}
          >
            {t('closing', 'buttonLabel', 'Discover E-com Global')}{' '}
            <ArrowUpRight size={17} />
          </Link>
        </section>
      )}
    </>
  );
}
