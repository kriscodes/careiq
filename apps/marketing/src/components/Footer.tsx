'use client';
import Link from 'next/link';
import { useSiteContent } from '../content/localized';
import { siteConfig } from '../lib/site-config';
import { Brand } from './Brand';

export function Footer() {
  const content = useSiteContent();
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-top">
          <div>
            <Brand copy={content.brand} />
            <p>{content.footer.description}</p>
          </div>
          <div className="footer-links">
            <Link href="/#features">{content.navigation.features}</Link>
            <Link href="/research/">{content.navigation.research}</Link>
            <a href="/privacy/">{content.footer.privacy}</a>
            {siteConfig.contactEmail && (
              <a href={`mailto:${siteConfig.contactEmail}`}>{content.footer.contact}</a>
            )}
          </div>
        </div>
        <div className="footer-bottom">
          <span>
            © {new Date().getUTCFullYear()} {content.footer.copyright}
          </span>
          <span>{content.footer.stage}</span>
        </div>
      </div>
    </footer>
  );
}
