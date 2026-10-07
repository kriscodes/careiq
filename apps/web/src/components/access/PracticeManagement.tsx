"use client";
import { UserButton, useAuth } from "@clerk/nextjs";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "@/lib/api/client";
import { AccessActionError, authErrorMessage } from "@/lib/auth-errors";
import type { AccessContext, PracticeAdmin } from "@/lib/api/practice";
import { AccessError, AccessField, AccessHeading, AccessShell, AccessStatus } from "./AccessShell";

export function PracticeManagement({ context, mode, onDone }: { context: AccessContext; mode: "invite" | "owneraccess"; onDone: () => void }) {
  const { getToken } = useAuth();
  const [data, setData] = useState<PracticeAdmin | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [retryInput, setRetryInput] = useState<{ email: string; role: string; locationIds: string[] } | null>(null);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const lifetime = useRef<AbortController | null>(null);
  const locked = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    void (async () => {
      try {
        const token = await getToken({ organizationId: context.orgId!, skipCache: true }); if (!token) throw new Error("Please sign in again.");
        const result = await apiRequest<{ data: PracticeAdmin }>("/api/v1/practice/admin", token, { signal: controller.signal });
        if (!controller.signal.aborted) { setData(result.data); setError(""); }
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof ApiError ? cause.message : authErrorMessage(cause)); }
    })();
    return () => controller.abort();
  }, [context.orgId, getToken, attempt]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (locked.current || !data) return;
    const fields = new FormData(event.currentTarget);
    locked.current = true; setBusy(true); setError("");
    try {
      const token = await getToken({ organizationId: context.orgId!, skipCache: true }); lifetime.current?.signal.throwIfAborted(); if (!token) throw new Error("Please sign in again.");
      if (mode === "invite") {
        const input = retryInput || { email: String(fields.get("email")).trim(), role: String(fields.get("role")), locationIds: fields.getAll("locationIds").map(String) };
        setRetryInput(input);
        await apiRequest("/api/v1/practice/invitations", token, { method: "POST", headers: { "Idempotency-Key": requestKey }, body: JSON.stringify(input), signal: lifetime.current?.signal });
        lifetime.current?.signal.throwIfAborted(); setSent(input.email); setRetryInput(null);
      } else {
        const owner = data.members.find(member => member.userId === context.userId && member.isOwner);
        if (!owner?.role || !data.allowedRoles.includes(owner.role)) throw new AccessActionError("Your current owner role could not be confirmed. Refresh access and try again.");
        await apiRequest(`/api/v1/practice/members/${encodeURIComponent(owner.userId)}/activate`, token, { method: "POST", body: JSON.stringify({ role: owner.role, locationIds: fields.getAll("locationIds") }), signal: lifetime.current?.signal });
        lifetime.current?.signal.throwIfAborted(); onDone();
      }
    } catch (cause) {
      if (!lifetime.current?.signal.aborted) {
        if (cause instanceof ApiError && [401, 403].includes(cause.status)) { onDone(); return; }
        setError(cause instanceof ApiError ? cause.message : authErrorMessage(cause));
        if (cause instanceof ApiError && [400, 409].includes(cause.status) && cause.code !== "INVITATION_RETRY_CONFLICT") { setRetryInput(null); setRequestKey(crypto.randomUUID()); }
      }
    } finally { locked.current = false; if (!lifetime.current?.signal.aborted) setBusy(false); }
  }
  if (sent) return <AccessShell account={<UserButton />}><AccessHeading title="Invitation sent" mark="mail">We sent an invitation to {sent}.</AccessHeading><div className="cq-a-note">Their access will stay pending until you confirm their role and locations after they join.</div><div className="cq-a-actions"><button className="cq-a-primary" onClick={onDone}>Back to your practice</button><button className="cq-a-secondary" onClick={() => { setSent(""); setRequestKey(crypto.randomUUID()); }}>Invite another teammate</button></div></AccessShell>;
  const owner = data?.members.find(member => member.userId === context.userId && member.isOwner);
  return <AccessShell account={<UserButton />} wide><button className="cq-a-link cq-a-back" disabled={busy} onClick={onDone}>← Back to your practice</button><AccessHeading title={mode === "invite" ? "Invite a teammate" : "Set your location access"}>{mode === "invite" ? "They’ll receive an email invitation. You’ll confirm their access after they join." : "Owner access lets you manage the practice. Choose where you also need access to patient records."}</AccessHeading>
    {!data ? <><p role="status">{error ? "Settings are unavailable." : "Checking your practice settings…"}</p><AccessError>{error}</AccessError>{error && <button className="cq-a-secondary" onClick={() => setAttempt(n => n + 1)}>Try again</button>}</> : <form className="cq-a-form" onSubmit={save} aria-busy={busy}><fieldset disabled={busy}>
      {mode === "invite" && <><AccessField label="Work email" name="email" type="email" required autoComplete="email" maxLength={254} readOnly={!!retryInput} defaultValue={retryInput?.email} /><div className="cq-a-field"><label htmlFor="cq-invite-role">Role</label><select id="cq-invite-role" className="cq-a-input" name="role" aria-describedby="cq-invite-role-hint" disabled={!!retryInput} defaultValue={retryInput?.role || data.allowedRoles.find(role => role === "org:member") || data.allowedRoles[0]}>{data.allowedRoles.map(role => <option key={role} value={role}>{role.replace(/^org:/, "").replaceAll("_", " ")}</option>)}</select><small id="cq-invite-role-hint">Roles do not give access to patient records on their own.</small></div></>}
      <fieldset disabled={busy || !!retryInput}><legend>{mode === "invite" ? "Proposed location access" : "Assign yourself to a location"}</legend><div className="cq-a-options">{data.locations.filter(location => location.status !== "closed").map(location => <label className="cq-a-choice" key={location.id}><input type="checkbox" name="locationIds" value={location.id} defaultChecked={mode === "owneraccess" ? owner?.locationIds.includes(location.id) : false} /><span><strong>{location.name}</strong><small>{context.practice?.name}</small></span></label>)}{!data.locations.some(location => location.status !== "closed") && <p>No active locations are available. Add one in Practice settings.</p>}</div></fieldset>
      {retryInput && <div className="cq-a-note">This invitation may already have been sent. Retry the same invitation to check its status.</div>}
      <AccessError>{error}</AccessError><button className="cq-a-primary">{busy ? "Saving…" : mode === "invite" ? retryInput ? "Check invitation status" : "Send invitation" : "Save my location access"}</button><button className="cq-a-link" type="button" onClick={onDone}>{mode === "invite" ? "I’ll do this later" : owner?.locationIds.length ? "Back to practice" : "Keep management access only"}</button>
    </fieldset><AccessStatus>{mode === "owneraccess" ? "Your current approved role will stay the same." : undefined}</AccessStatus></form>}
  </AccessShell>;
}
