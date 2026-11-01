"use client";

/** A shared, quiet loading state; callers provide localized context. */
export function AccessLoading({ label, panel = false }: { label: string; panel?: boolean }) {
  return <div className={`cq-a-loading${panel ? " cq-a-loading-panel" : ""}`} role="status" aria-live="polite" aria-atomic="true">
    <span className="cq-a-loading-character" aria-hidden="true"><span className="cq-a-companion" /></span>
    <span className="cq-a-loading-label">{label}</span>
    {panel && <div className="cq-a-loading-skeleton" aria-hidden="true"><span /><span /><span /></div>}
  </div>;
}
