"use client";

/** A shared loading state. Inline button content preserves its parent's accessible name. */
export function AccessLoading({ label, panel = false, inline = false, announce = !inline }: { label: string; panel?: boolean; inline?: boolean; announce?: boolean }) {
  const Container = inline ? "span" : "div";
  return <Container className={`cq-a-loading${panel && !inline ? " cq-a-loading-panel" : ""}${inline ? " cq-a-loading-inline" : ""}`} role={announce ? "status" : undefined} aria-live={announce ? "polite" : undefined} aria-atomic={announce ? true : undefined}>
    <span className="cq-a-loading-character" aria-hidden="true"><span className="cq-a-companion" /></span>
    <span className="cq-a-loading-label">{label}</span>
    {panel && !inline && <span className="cq-a-loading-skeleton" aria-hidden="true"><span /><span /><span /></span>}
  </Container>;
}
