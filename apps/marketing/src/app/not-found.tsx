import type { Metadata } from "next";
import { content } from "../content/content";
import { NotFoundContent } from "../components/NotFoundContent";

export const metadata: Metadata = { title: content.seo.notFoundTitle, robots: { index: false, follow: false } };
export default function NotFound() {
  return <NotFoundContent/>;
}
