"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, apiRequest } from "@/lib/api/client";
import type { AccessContext, Location, PracticeAdmin, PracticeMember } from "@/lib/api/practice";
import { createSubmissionAttempt } from "@/lib/submission-attempt";
import { PracticePicker } from "./PracticeAccess";

const roleName = (role: string) => role.replace(/^org:/, "").replaceAll("_", " ");

function LocationChoices({ locations, selected = [], disabled = false }: { locations: Location[]; selected?: string[]; disabled?: boolean }) {
  return <fieldset className="cq-location-choices" disabled={disabled}><legend>Assigned locations</legend>{locations.filter(location => location.status !== "closed").map(location => <label className="cq-check" key={location.id}><input type="checkbox" name="locationIds" value={location.id} defaultChecked={selected.includes(location.id)} />{location.name}</label>)}{!locations.length && <p>Add a location before assigning staff.</p>}</fieldset>;
}

function MemberAccess({ member, data, busy, save }: { member: PracticeMember; data: PracticeAdmin; busy: boolean; save: (path: string, input: object) => Promise<void> }) {
  return <form className="cq-team-member" onSubmit={event => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void save(`/api/v1/practice/members/${encodeURIComponent(member.userId)}/activate`, { role: fields.get("role"), locationIds: fields.getAll("locationIds") });
  }}>
    <h3>{member.displayName || member.email || (member.isOwner ? "Practice owner" : "Team member")}</h3><p className="cq-muted">{member.email || member.userId}{member.isOwner ? " · Practice owner" : ""}</p><p>Status: {member.status.replaceAll("_", " ")}</p>
    <label className="cq-field">Role<select name="role" className="cq-input" defaultValue={member.role ?? "org:member"} disabled={busy}>{[...new Set([...data.allowedRoles, ...(member.role ? [member.role] : [])])].map(role => <option key={role} value={role}>{roleName(role)}</option>)}</select></label>
    <LocationChoices locations={data.locations} selected={member.status === "pending_assignment" ? member.proposedLocationIds ?? [] : member.locationIds} disabled={busy} />
    <div className="cq-actions"><button type="submit" className="cq-button cq-primary" disabled={busy}>Confirm role and locations</button>{!member.isOwner && <button type="button" className="cq-button" disabled={busy || member.status === "suspended" || member.status === "revoked"} onClick={() => void save(`/api/v1/practice/members/${encodeURIComponent(member.userId)}/suspend`, {})}>Suspend access</button>}</div>
  </form>;
}

export function PracticeSettings({ context, onClose }: { context: AccessContext; onClose: () => void }) {
  const { getToken } = useAuth();
  const [data, setData] = useState<PracticeAdmin | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [invitationAttempt] = useState(() => createSubmissionAttempt());
  const lifetime = useRef<AbortController | null>(null);
  const locked = useRef(false);

  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const token = await getToken({ organizationId: context.orgId ?? undefined, skipCache: true });
        if (!token) throw new Error("Please sign in again.");
        const result = await apiRequest<{ data: PracticeAdmin }>("/api/v1/practice/admin", token, { signal: controller.signal });
        if (!controller.signal.aborted) { setData(result.data); setError(""); }
      } catch (cause) { if (!controller.signal.aborted) { setData(null); setError(cause instanceof Error ? cause.message : "Unable to open practice settings."); } }
    })();
    return () => controller.abort();
  }, [getToken, context.orgId, version]);

  async function save(path: string, input: object, key?: string) {
    if (locked.current) throw new Error("Another update is in progress. Please wait.");
    locked.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const token = await getToken({ organizationId: context.orgId ?? undefined, skipCache: true });
      if (!token) throw new Error("Please sign in again.");
      if (lifetime.current?.signal.aborted) return;
      await apiRequest(path, token, { method: "POST", headers: key ? { "Idempotency-Key": key } : undefined, body: JSON.stringify(input), signal: lifetime.current?.signal });
      if (!lifetime.current?.signal.aborted) { setMessage("Saved. Access changes apply to new requests."); setData(null); setVersion(value => value + 1); }
    } catch (cause) {
      if (cause instanceof ApiError && [401, 403].includes(cause.status) && !lifetime.current?.signal.aborted) { setData(null); onClose(); }
      if (!lifetime.current?.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to save. Please try again.");
      throw cause;
    } finally { locked.current = false; if (!lifetime.current?.signal.aborted) setBusy(false); }
  }

  // Forms consume the rejection; keeping save rejecting preserves invitation retry keys.
  const saveAction = async (path: string, input: object) => { await save(path, input).catch(() => {}); };
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const input = { email: String(fields.get("email")).trim(), role: String(fields.get("role")), locationIds: fields.getAll("locationIds") };
    await invitationAttempt.submit(input, async key => {
      await save("/api/v1/practice/invitations", input, key);
      if (!lifetime.current?.signal.aborted) form.reset();
    }).catch(() => {});
  }

  return <main className="cq-setup cq-settings">
    <header className="cq-heading"><div><h1>Practice settings</h1><p>{context.practice?.name}</p></div><button className="cq-button" onClick={onClose}>Done</button></header><PracticePicker />
    {error && <p className="cq-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {!data ? <><p role="status">{error ? "Settings could not be loaded." : "Loading locations and team…"}</p>{error && <button className="cq-button" onClick={() => setVersion(value => value + 1)}>Try again</button>}</> : <>
      <section className="cq-setup-section"><h2>Locations</h2>{data.locations.map(location => <div className="cq-team-row" key={location.id}><div><strong>{location.name}</strong><p>{location.timeZone} · {location.status}</p></div><button className="cq-button" disabled={busy} onClick={() => void saveAction(`/api/v1/locations/${location.id}/status`, { status: location.status === "closed" ? "active" : "closed" })}>{location.status === "closed" ? "Reopen location" : "Close location"}</button></div>)}
        <form onSubmit={event => { event.preventDefault(); const fields = new FormData(event.currentTarget); void saveAction("/api/v1/locations", { name: String(fields.get("name")).trim(), timeZone: String(fields.get("timeZone")).trim(), address: String(fields.get("address")).trim() || undefined }); }}><fieldset className="cq-setup-fields" disabled={busy}><legend>Add a location</legend><label className="cq-field">Name<input className="cq-input" name="name" required maxLength={120} /></label><label className="cq-field">Time zone<input className="cq-input" name="timeZone" required maxLength={80} defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone} /></label><label className="cq-field">Address (optional)<input className="cq-input" name="address" maxLength={500} /></label><button className="cq-button" type="submit">Add location</button></fieldset></form>
      </section>
      <section className="cq-setup-section"><h2>Invite your team</h2><p>Select a role and locations for the invitation. After your employee joins, confirm their access below.</p><form onSubmit={event => void invite(event)}><fieldset className="cq-setup-fields" disabled={busy}><label className="cq-field">Employee email<input className="cq-input" name="email" type="email" required autoComplete="email" maxLength={254} /></label><label className="cq-field">Role<select className="cq-input" name="role">{data.allowedRoles.map(role => <option key={role} value={role}>{roleName(role)}</option>)}</select></label><LocationChoices locations={data.locations} /><button className="cq-button cq-primary" type="submit">Send invitation</button></fieldset></form>
        {data.invitations.map(invitation => <div className="cq-team-row" key={invitation.id}><div><strong>{invitation.email}</strong><p>{roleName(invitation.role)} · {invitation.status}{invitation.providerRevocationPending ? " · Delivery provider confirmation pending" : ""}</p></div>{(["sending", "invited"].includes(invitation.status) || invitation.providerRevocationPending) && <button className="cq-button" disabled={busy} onClick={() => void saveAction(`/api/v1/practice/invitations/${invitation.id}/revoke`, {})}>{invitation.providerRevocationPending ? "Retry revocation" : "Revoke invitation"}</button>}</div>)}
      </section>
      <section className="cq-setup-section"><h2>Team access</h2><p>Roles grant specific actions. Location assignments determine where those actions are available. Practice administration alone does not grant access to patient records.</p>{data.members.map(member => <MemberAccess key={`${member.userId}:${version}`} member={member} data={data} busy={busy} save={saveAction} />)}</section>
      <section className="cq-setup-section"><h2>Transfer practice ownership</h2><p>The new owner must already be an active administrator. This transfers your authority to manage this practice.</p><form onSubmit={event => { event.preventDefault(); const fields = new FormData(event.currentTarget); void saveAction("/api/v1/practice/ownership", { userId: fields.get("userId") }); }}><fieldset className="cq-setup-fields" disabled={busy}><label className="cq-field">New owner<select className="cq-input" name="userId" required defaultValue=""><option value="" disabled>Select an active administrator</option>{data.members.filter(member => !member.isOwner && member.status === "active" && member.role === "org:admin").map(member => <option key={member.userId} value={member.userId}>{member.displayName || member.email || member.userId}</option>)}</select></label><label className="cq-check"><input type="checkbox" required />I confirm the ownership transfer.</label><button className="cq-button" type="submit">Transfer ownership</button></fieldset></form></section>
    </>}
  </main>;
}
