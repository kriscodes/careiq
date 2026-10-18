"use client";
import { useEffect, type ReactNode } from "react";
import { I18nProvider } from "../../../web/src/i18n/provider";
import { useSiteContent } from "../content/localized";
import { siteConfig } from "../lib/site-config";
import { Header } from "./Header";
import { Footer } from "./Footer";
function SiteChrome({children}:{children:ReactNode}) {
  const content=useSiteContent();
  useEffect(()=>{const privacy=location.pathname.startsWith("/privacy");document.title=privacy?content.seo.privacyTitle:content.seo.homeTitle;const meta=document.querySelector('meta[name="description"]');if(meta)meta.setAttribute("content",privacy?content.seo.privacyDescription:content.seo.homeDescription);},[content]);
  return <><a className="skip-link" href="#main-content">{content.navigation.skip}</a><Header brand={content.brand} copy={content.navigation} appUrl={siteConfig.appUrl}/>{children}<Footer/></>;
}
export function SiteShell({children}:{children:ReactNode}) { return <I18nProvider><SiteChrome>{children}</SiteChrome></I18nProvider>; }
