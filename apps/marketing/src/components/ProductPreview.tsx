import type { ProductContent } from '../content/product-content';

export function ProductPreview({ copy }: { copy: ProductContent['preview'] }) {
  return (
    <figure className="product-preview" aria-label={copy.label}>
      <div className="product-window">
        <div className="product-window-top">
          <span className="product-preview-logo" aria-hidden="true" />
          <span>{copy.practice}</span>
        </div>
        <div className="product-workspace">
          <div className="product-sidebar" aria-hidden="true">
            <strong>{copy.workspace}</strong>
            {copy.navigation.map((label, index) => (
              <span className={index === 0 ? 'product-sidebar-selected' : undefined} key={label}>
                {label}
              </span>
            ))}
          </div>
          <div className="product-dashboard">
            <p className="product-dashboard-label">{copy.eyebrow}</p>
            <h2>{copy.heading}</h2>
            <p className="product-dashboard-description">{copy.description}</p>
            <dl className="product-stats">
              {copy.stats.map((label, index) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{[12, 8, 4][index]}</dd>
                </div>
              ))}
            </dl>
            <div className="product-visits">
              <div className="product-visits-heading">
                <h3>{copy.visits}</h3>
                <span>{copy.today}</span>
              </div>
              <ul>
                {copy.rows.map((row, index) => (
                  <li key={row.name}>
                    <div>
                      <strong>
                        <span className="product-visit-time">{row.time}</span> {row.name}
                      </strong>
                      <span className="product-visit-type">{row.visit}</span>
                    </div>
                    <span
                      className={`product-status${index === 1 ? ' product-status-waiting' : ''}`}
                    >
                      {row.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
      <figcaption>{copy.caption}</figcaption>
    </figure>
  );
}
