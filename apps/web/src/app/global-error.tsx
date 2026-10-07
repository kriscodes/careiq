"use client";
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <html lang="en"><body style={{ margin: 0, background: "#fff", color: "#2b3832", fontFamily: "system-ui, sans-serif" }}><main style={{ maxWidth: 440, margin: "15vh auto", padding: 24 }}><p style={{ fontWeight: 700 }}>careiq</p><h1>CareIQ is unavailable right now</h1><p>We couldn’t open your account. Try again, or contact your CareIQ administrator if this continues.</p><button type="button" onClick={retry} style={{ background: "#496f5a", color: "#fff", border: 0, borderRadius: 10, padding: "14px 24px", font: "inherit", cursor: "pointer" }}>Try again</button></main></body></html>;
}
