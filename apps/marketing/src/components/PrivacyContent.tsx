'use client';
import Link from 'next/link';
import React from 'react';
import {
  analyticsPreference,
  setAnalyticsOptOut,
  studioInsightsConfiguredOrigin,
  subscribeToAnalyticsPreference,
} from '../../../../packages/studio-insights/collector';
import { PRIVACY_NOTICE_VERSION } from '@careiq/interview-contract';
import { useSiteContent } from '../content/localized';
import { siteConfig } from '../lib/site-config';
function AnalyticsPreferences({
  copy,
}: {
  copy: ReturnType<typeof useSiteContent>['privacy']['analytics'];
}) {
  const preference = React.useSyncExternalStore(
    subscribeToAnalyticsPreference,
    analyticsPreference,
    () => null,
  );
  const excluded = preference === 'excluded';
  return (
    <section id="website-analytics">
      <h2>{copy.heading}</h2>
      <p>{copy.description}</p>
      {!studioInsightsConfiguredOrigin() ? (
        <p>{copy.disabled}</p>
      ) : preference === 'browser-blocked' ? (
        <p>{copy.browserBlocked}</p>
      ) : preference ? (
        <>
          <p role="status">{excluded ? copy.excluded : copy.included}</p>
          <button className="cq-button" type="button" onClick={() => setAnalyticsOptOut(!excluded)}>
            {excluded ? copy.include : copy.exclude}
          </button>
        </>
      ) : null}
    </section>
  );
}

export function PrivacyContent() {
  const content = useSiteContent();
  return (
    <main id="main-content" className="privacy-page container">
      <article>
        <Link className="text-link back-link" href="/">
          ← {content.privacy.back}
        </Link>
        <p className="eyebrow">{content.privacy.eyebrow}</p>
        <h1>{content.privacy.heading}</h1>
        <p className="notice-version">
          {content.privacy.versionLabel}: {PRIVACY_NOTICE_VERSION}
        </p>
        <p className="privacy-intro">{content.privacy.intro}</p>
        {content.privacy.sections.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}
        <AnalyticsPreferences copy={content.privacy.analytics} />
        <section className="privacy-contact">
          <h2>{content.privacy.contactHeading}</h2>
          {siteConfig.privacyEmail ? (
            <>
              <p>{content.privacy.contactText}</p>
              <a href={`mailto:${siteConfig.privacyEmail}`}>{siteConfig.privacyEmail}</a>
            </>
          ) : (
            <p>{content.privacy.contactUnavailable}</p>
          )}
        </section>
      </article>
    </main>
  );
}
