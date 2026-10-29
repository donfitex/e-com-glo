import Link from 'next/link';
import { siteContent } from '@/lib/server-api';
import { siteText } from '@/lib/site-content';
export const metadata = { title: 'Help & FAQ' };
export default async function Page() {
  const site = await siteContent();
  const defaults = [
    [
      'How can I track my order?',
      'Sign in and open My account → Orders & tracking for your delivery estimate and shipment updates.',
    ],
    [
      'How do I pay?',
      'Checkout opens Paystack’s secure payment page. Your order updates after payment verification.',
    ],
    [
      'How do I report a problem?',
      'Use Contact us and include your order reference. Our team will review the details and confirm the applicable policy.',
    ],
  ];
  return (
    <div className="shell page help-page">
      <div className="page-heading">
        <span className="eyebrow muted">A LITTLE HELP, WHEN YOU NEED IT</span>
        <h1>Good questions. Clear answers.</h1>
        <p>Find the essentials, or get in touch with our team.</p>
      </div>
      {defaults.map(([question, answer], index) => (
        <details key={index}>
          <summary>
            {siteText(site, 'faq', `question${index + 1}`, question!)}
          </summary>
          <p>{siteText(site, 'faq', `answer${index + 1}`, answer!)}</p>
        </details>
      ))}
      <div className="inline-actions">
        <Link href="/contact" className="button primary">
          Contact us
        </Link>
        <Link href="/account/orders" className="button outline">
          Track an order
        </Link>
      </div>
    </div>
  );
}
