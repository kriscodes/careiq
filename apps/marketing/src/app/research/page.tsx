import type { Metadata } from 'next';
import { content } from '../../content/content';
import { ResearchContent } from '../../components/ResearchContent';

export const metadata: Metadata = {
  title: content.seo.researchTitle,
  description: content.seo.researchDescription,
  alternates: { canonical: '/research/' },
  openGraph: {
    title: content.seo.researchTitle,
    description: content.seo.researchDescription,
    url: '/research/',
  },
  twitter: { title: content.seo.researchTitle, description: content.seo.researchDescription },
};
export default function Research() {
  return <ResearchContent />;
}
