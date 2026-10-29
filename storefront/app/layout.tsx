import { siteContent } from '@/lib/server-api';
import { SiteProvider } from '@/components/site-provider';
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
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const site = await siteContent();
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t;try{t=localStorage.getItem("ecom-theme-v1")}catch(e){}document.documentElement.dataset.theme=t==="dark"||t==="light"?t:matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"})()`,
          }}
        />
      </head>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <SiteProvider value={site}>
          <SessionProvider>
            <Header />
            <main id="main">{children}</main>
            <Footer />
          </SessionProvider>
        </SiteProvider>
      </body>
    </html>
  );
}
