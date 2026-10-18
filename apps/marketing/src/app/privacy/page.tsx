import type { Metadata } from "next";
import { content } from "../../content/content";
import { PrivacyContent } from "../../components/PrivacyContent";

export const metadata: Metadata = {
  title: content.seo.privacyTitle,
  description: content.seo.privacyDescription,
  alternates: { canonical: "/privacy/" },
  openGraph: { title: content.seo.privacyTitle, description: content.seo.privacyDescription, url: "/privacy/" },
  twitter: { title: content.seo.privacyTitle, description: content.seo.privacyDescription },
};

export default function Privacy() {
  return <PrivacyContent/>;
}
