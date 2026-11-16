'use client';

import Link from 'next/link';
import { useI18n } from '../../../web/src/i18n/provider';
import { productContent } from '../content/product-content';
import { Icon, type IconName } from './Icon';
import { ProductPreview } from './ProductPreview';

const featureIcons: IconName[] = [
  'calendar',
  'user-plus',
  'mail',
  'check',
  'clock',
  'users',
  'workflow',
];

export function ProductHome() {
  const { locale } = useI18n();
  const copy = productContent[locale === 'es' ? 'es' : 'en'];
  return (
    <main id="main-content" className="product-page">
      <section className="product-hero container" aria-labelledby="product-heading">
        <div className="product-hero-copy">
          <p className="product-eyebrow">{copy.hero.eyebrow}</p>
          <h1 id="product-heading">{copy.hero.headline}</h1>
          <p className="product-lead">{copy.hero.description}</p>
          <div className="product-actions">
            <a className="cq-button cq-primary" href="#features">
              {copy.hero.primaryCta}
              <Icon name="arrow" />
            </a>
            <Link className="cq-button" href="/research/#interview-form">
              {copy.hero.secondaryCta}
            </Link>
          </div>
          <p className="product-note">{copy.hero.stage}</p>
        </div>
        <ProductPreview copy={copy.preview} />
      </section>
      <div className="product-strip">
        <div className="container product-strip-inner">
          <p>{copy.strip.heading}</p>
          <ul>
            {copy.strip.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
      <section
        id="features"
        className="product-section container"
        aria-labelledby="features-heading"
      >
        <p className="product-eyebrow">{copy.features.eyebrow}</p>
        <h2 id="features-heading">{copy.features.heading}</h2>
        <p className="product-intro">{copy.features.description}</p>
        <div className="product-feature-grid">
          {copy.features.cards.map((feature, index) => (
            <article className="product-feature-card" key={feature.title}>
              <span className="product-feature-icon">
                <Icon name={featureIcons[index]} />
              </span>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
        <p className="product-note product-feature-note">{copy.features.note}</p>
      </section>
      <section
        id="how-it-works"
        className="product-section product-flow-section"
        aria-labelledby="how-heading"
      >
        <div className="container product-flow">
          <div>
            <p className="product-eyebrow">{copy.flow.eyebrow}</p>
            <h2 id="how-heading">{copy.flow.heading}</h2>
            <p className="product-intro">{copy.flow.description}</p>
          </div>
          <ol className="product-flow-steps">
            {copy.flow.steps.map((step, index) => (
              <li key={step.title}>
                <span className="product-step-number" aria-hidden="true">
                  0{index + 1}
                </span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <section className="product-section container product-teams" aria-labelledby="teams-heading">
        <div>
          <p className="product-eyebrow">{copy.teams.eyebrow}</p>
          <h2 id="teams-heading">{copy.teams.heading}</h2>
          <p className="product-intro">{copy.teams.description}</p>
          <ul className="product-team-list">
            {copy.teams.roles.map((role) => (
              <li key={role.title}>
                <h3>{role.title}</h3>
                <p>{role.description}</p>
              </li>
            ))}
          </ul>
        </div>
        <div className="product-principle">
          <p className="product-eyebrow">{copy.teams.principleLabel}</p>
          <h3>{copy.teams.principle}</h3>
          <p>{copy.teams.principleDescription}</p>
          <div className="product-development">
            <h4>{copy.teams.stageHeading}</h4>
            <p>{copy.teams.stageDescription}</p>
          </div>
        </div>
      </section>
      <section className="container product-cta-section" aria-labelledby="product-cta-heading">
        <div className="product-cta">
          <div>
            <h2 id="product-cta-heading">{copy.cta.heading}</h2>
            <p>{copy.cta.description}</p>
          </div>
          <div className="product-cta-actions">
            <Link className="cq-button" href="/research/#interview-form">
              {copy.cta.label}
              <Icon name="arrow" />
            </Link>
            <Link className="product-research-link" href="/research/">
              {copy.cta.research}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
