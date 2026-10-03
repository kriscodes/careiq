import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Header } from "../components/Header";
import { Footer } from "../components/Footer";
import { content } from "../content/content";
import { siteConfig } from "../lib/site-config";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.siteUrl),
  title: content.seo.homeTitle,
  description: content.seo.homeDescription,
  alternates: { canonical: "/" },
  applicationName: content.brand.business,
  robots: { index: siteConfig.allowIndexing, follow: siteConfig.allowIndexing },
  openGraph: {
    type: "website", locale: "en_US", siteName: content.brand.business,
    title: content.seo.homeTitle, description: content.seo.homeDescription, url: "/",
  },
  twitter: { card: "summary", title: content.seo.homeTitle, description: content.seo.homeDescription },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>
    <a className="skip-link" href="#main-content">{content.navigation.skip}</a>
    <Header brand={content.brand} copy={content.navigation} appUrl={siteConfig.appUrl} />
    {children}
    <Footer />
  </body></html>;
}
