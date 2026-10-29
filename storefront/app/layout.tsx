import type { Metadata } from 'next';
import { SessionProvider } from '@/components/session';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import './globals.css';
export const metadata: Metadata = {
  title: {
    default: 'E-com Global — Good finds. Global possibilities.',
    template: '%s | E-com Global',
  },
  description:
    'Discover electronics, fashion, home essentials and more. A world of everyday finds, all in one place.',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <SessionProvider>
          <Header />
          <main id="main">{children}</main>
          <Footer />
        </SessionProvider>
      </body>
    </html>
  );
}
