"use client";
import { useClerk } from "@clerk/nextjs";
import { useRef, useState, type ReactNode } from "react";
import { authErrorMessage } from "@/lib/auth-errors";
export function SignOutButton({ children = "Sign out", redirectUrl = "/sign-in", className = "cq-a-link" }: { children?: ReactNode; redirectUrl?: string | (() => string); className?: string }) {
  const { signOut } = useClerk();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  return <div className="cq-a-account-action"><button className={className} type="button" disabled={busy} onClick={async () => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try { await signOut({ redirectUrl: typeof redirectUrl === "function" ? redirectUrl() : redirectUrl }); }
    catch (cause) { setError(authErrorMessage(cause)); }
    finally { locked.current = false; setBusy(false); }
  }}>{busy ? "One moment…" : children}</button>{error && <p className="cq-a-error" role="alert">{error}</p>}</div>;
}
