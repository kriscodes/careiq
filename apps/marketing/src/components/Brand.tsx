import Link from "next/link";
import type { SiteContent } from "../content/content";

export function Brand({ copy }: { copy: SiteContent["brand"] }) {
  return <Link className="cq-logo" href="/" aria-label={copy.homeLabel}><span className="cq-symbol" aria-hidden="true" /><span>{copy.product}<span className="cq-brand-labs">{copy.business.replace(copy.product, "").trim()}</span></span></Link>;
}
