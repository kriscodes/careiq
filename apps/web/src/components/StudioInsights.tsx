'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { observeStudioPage } from '../../../../packages/studio-insights/collector';

export function StudioInsights() {
  const pathname = usePathname();
  useEffect(() => observeStudioPage('careiq-web', pathname), [pathname]);
  return null;
}
