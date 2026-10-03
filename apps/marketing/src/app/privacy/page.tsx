import Link from "next/link";
import type { Metadata } from "next";
import { PRIVACY_NOTICE_VERSION } from "@careiq/interview-contract";
import { content } from "../../content/content";
import { siteConfig } from "../../lib/site-config";

export const metadata: Metadata = {
  title: content.seo.privacyTitle,
  description: content.seo.privacyDescription,
  alternates: { canonical: "/privacy/" },
  openGraph: { title: content.seo.privacyTitle, description: content.seo.privacyDescription, url: "/privacy/" },
  twitter: { title: content.seo.privacyTitle, description: content.seo.privacyDescription },
};

export default function Privacy() {
  return <main id="main-content" className="privacy-page container"><article>
    <Link className="text-link back-link" href="/">← {content.privacy.back}</Link>
    <p className="eyebrow">{content.privacy.eyebrow}</p><h1>{content.privacy.heading}</h1><p className="notice-version">{content.privacy.versionLabel}: {PRIVACY_NOTICE_VERSION}</p><p className="privacy-intro">{content.privacy.intro}</p>
    {content.privacy.sections.map((section) => <section key={section.heading}><h2>{section.heading}</h2>{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</section>)}
    <section className="privacy-contact"><h2>{content.privacy.contactHeading}</h2>{siteConfig.privacyEmail ? <><p>{content.privacy.contactText}</p><a href={`mailto:${siteConfig.privacyEmail}`}>{siteConfig.privacyEmail}</a></> : <p>{content.privacy.contactUnavailable}</p>}</section>
  </article></main>;
}
