'use client';
import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { I18nProvider } from '../../../web/src/i18n/provider';
import { useSiteContent } from '../content/localized';
import { siteConfig } from '../lib/site-config';
import { Header } from './Header';
import { Footer } from './Footer';
function SiteChrome({ children }: { children: ReactNode }) {
  const content = useSiteContent();
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    const route = pathname.replace(/\/$/, '') || '/';
    const privacy = route === '/privacy';
    const research = route === '/research';
    const home = pathname === '/';
    const title = privacy
      ? content.seo.privacyTitle
      : research
        ? content.seo.researchTitle
        : home
          ? content.seo.homeTitle
          : content.seo.notFoundTitle;
    const description = privacy
      ? content.seo.privacyDescription
      : research
        ? content.seo.researchDescription
        : home
          ? content.seo.homeDescription
          : content.notFound.description;
    const updateMetadata = () => {
      if (document.title !== title) {
        document.title = title;
      }
      const meta = document.querySelector('meta[name="description"]');
      if (meta && meta.getAttribute('content') !== description) {
        meta.setAttribute('content', description);
      }
    };
    updateMetadata();
    // Next can apply static English metadata after the persisted locale hydrates.
    // Keep the visible page title and description aligned with the selected language.
    const observer = new MutationObserver(updateMetadata);
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['content'],
    });
    return () => observer.disconnect();
  }, [content, pathname]);
  useEffect(() => {
    // Preserve published interview and research links when moving their content.
    const routeLegacyAnchor = () => {
      if (pathname !== '/') {
        return;
      }
      const hash = window.location.hash;
      if (['#interview-form', '#interview', '#founder', '#questions', '#focus'].includes(hash)) {
        router.replace(`/research/${hash}`);
      } else if (hash === '#research') {
        router.replace('/research/');
      }
    };
    routeLegacyAnchor();
    window.addEventListener('hashchange', routeLegacyAnchor);
    return () => window.removeEventListener('hashchange', routeLegacyAnchor);
  }, [pathname, router]);
  return (
    <>
      <a className="skip-link" href="#main-content">
        {content.navigation.skip}
      </a>
      <Header brand={content.brand} copy={content.navigation} appUrl={siteConfig.appUrl} />
      {children}
      <Footer />
    </>
  );
}
export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <SiteChrome>{children}</SiteChrome>
    </I18nProvider>
  );
}
