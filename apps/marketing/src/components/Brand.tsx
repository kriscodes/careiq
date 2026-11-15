import Link from 'next/link';
import Image from 'next/image';
import type { SiteContent } from '../content/content';

export function Brand({ copy }: { copy: SiteContent['brand'] }) {
  return (
    <Link className="cq-logo" href="/" aria-label={copy.homeLabel}>
      <Image src="/brand/careiq-wordmark.png" width={132} height={44} alt={copy.product} priority />
    </Link>
  );
}
