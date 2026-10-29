export const metadata = { title: 'Shipping, payments & privacy' };
export default function Policies() {
  return (
    <article className="shell page policy">
      <span className="eyebrow muted">CLEAR FROM THE START</span>
      <h1>Shopping with E-com Global.</h1>
      <h2>Delivery & tax</h2>
      <p>
        Delivery availability, shipping charges and configured tax are
        calculated from your destination and order currency before you place an
        order. Unsupported destinations cannot proceed to checkout. No delivery
        date is guaranteed by the current shipping calculation.
      </p>
      <h2>Payments & unpaid orders</h2>
      <p>
        Payments are collected through Stripe Checkout when the store’s payment
        service is configured. Orders remain unpaid until a verified payment
        notification is received. Unpaid pending orders expire after the
        configured reservation period; stock is then released. Contact the store
        operator for paid-order cancellations and refunds.
      </p>
      <h2>Currency</h2>
      <p>
        Prices use the product’s listed currency. All products in one bag must
        use the same currency. Selecting a currency filters the catalog; it does
        not convert prices.
      </p>
      <h2>Your account & privacy</h2>
      <p>
        We use your name and email to operate your account and your shipping
        address to process orders. Your sign-in session is stored in an
        HTTP-only cookie that expires after 15 minutes. Signing out removes that
        cookie. Payment-card details are handled by Stripe and are not collected
        by this storefront. The store operator must publish its legal identity,
        support contact, jurisdiction-specific privacy notices and return terms
        before opening for live trade.
      </p>
    </article>
  );
}
