import Link from "next/link";
import type { Metadata } from "next";
import { content } from "../content/content";
import { Icon } from "../components/Icon";

export const metadata: Metadata = { title: content.seo.notFoundTitle, robots: { index: false, follow: false } };
export default function NotFound() {
  return <main id="main-content" className="not-found container"><p className="eyebrow">{content.notFound.eyebrow}</p><h1>{content.notFound.heading}</h1><p>{content.notFound.description}</p><Link className="cq-button cq-primary" href="/">{content.notFound.cta}<Icon name="arrow" /></Link></main>;
}
