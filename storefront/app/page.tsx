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
import { ProductArt } from '@/components/product-art';
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
  const data = await safeCatalog({ currency: defaultCurrency(), limit: '4' });
  return (
    <>
      <section className="shell hero">
        <div className="hero-copy">
          <div className="eyebrow hero-kicker">
            <span /> THE EVERYDAY, REIMAGINED
          </div>
          <h1>
            Good finds.
            <br />
            Global <em>possibilities.</em>
          </h1>
          <p>
            From the things you need to the things you love.
            <br className="desktop" /> Discover a world of thoughtful finds, all
            in one place.
          </p>
          <Link className="button primary" href="/shop">
            Find your next favorite <ArrowUpRight size={18} />
          </Link>
          <div className="hero-footnote">
            <span className="tiny-globe">
              <Globe2 size={19} />
            </span>
            <span>
              Many categories. <strong>One great discovery.</strong>
            </span>
          </div>
        </div>
        <div className="hero-visual">
          <span className="hero-orbit orbit-one" />
          <span className="hero-orbit orbit-two" />
          <div className="hero-disc" />
          <ProductArt
            className="hero-headphones"
            kind="headphones"
            alt="Sculptural sage green wireless headphones"
          />
          <div className="floating-label">
            <span className="label-dot" />
            <div>
              <small>A LITTLE EVERYDAY UPGRADE</small>
              <strong>Less noise. More you.</strong>
            </div>
          </div>
          <span className="hero-corner">
            SOUND GOOD.
            <br />
            FEEL GOOD.
          </span>
          <span className="vertical-note">THE E-COM GLOBAL EDIT / 01</span>
        </div>
      </section>
      <section className="shell trust-strip" aria-label="Shopping benefits">
        <div>
          <Globe2 />
          <span>
            <strong>A world of choice</strong>
            <small>Eight currencies. Every category.</small>
          </span>
        </div>
        <div>
          <ShieldCheck />
          <span>
            <strong>Your account, protected</strong>
            <small>Secure sign-in and checkout.</small>
          </span>
        </div>
        <div>
          <PackageCheck />
          <span>
            <strong>Know before you order</strong>
            <small>Clear totals. Upfront delivery rules.</small>
          </span>
        </div>
      </section>
      <section className="shell section">
        <div className="section-heading">
          <div>
            <span className="eyebrow muted">A GOOD PLACE TO START</span>
            <h2>Find your kind of everyday.</h2>
          </div>
          <Link className="text-link" href="/shop">
            Explore all categories <ArrowUpRight size={17} />
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
      <section className="shell section arrivals">
        <div className="section-heading">
          <div>
            <span className="eyebrow muted">WORTH A CLOSER LOOK</span>
            <h2>Meet your next favorites.</h2>
          </div>
          <Link className="text-link" href="/shop">
            Shop the collection <ArrowUpRight size={17} />
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
      <section className="shell editorial">
        <div className="editorial-art">
          <ProductArt kind="lamp" alt="Warm terracotta table lamp" />
          <span className="eyebrow">MAKE ROOM FOR WHAT YOU LOVE.</span>
        </div>
        <div className="editorial-copy">
          <span className="eyebrow">THE HOME & LIVING EDIT</span>
          <h2>
            A little comfort.
            <br />A lot of character.
          </h2>
          <p>
            Simple details that make your space feel a little more like you.
            Discover a new perspective on everyday living.
          </p>
          <Link className="button light" href="/shop?category=home-living">
            Make yourself at home <ArrowRight size={17} />
          </Link>
        </div>
      </section>
      <section className="shell closing">
        <span className="eyebrow muted">YOUR EVERYDAY, WITHOUT LIMITS</span>
        <h2>Great finds are closer than you think.</h2>
        <p>Explore something different. Find something that feels like you.</p>
        <Link className="text-link" href="/shop">
          Discover E-com Global <ArrowUpRight size={17} />
        </Link>
      </section>
    </>
  );
}
