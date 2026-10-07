"use client";

import { UserButton, useAuth, useOrganizationList, useUser } from "@clerk/nextjs";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "@/lib/api/client";
import { availableTimeZones, onboardingInput, onboardingView, timeZoneLabel, validateDraft, type OnboardingState, type PracticeDraft } from "@/lib/access-flow";
import { AccessActionError, authErrorMessage } from "@/lib/auth-errors";
import { SignOutButton } from "./SignOutButton";
import { AccessError, AccessField, AccessHeading, AccessShell, AccessStatus } from "./AccessShell";

const emptyDraft = (): PracticeDraft => ({ practiceName: "", locationName: "", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", address: "", step: 1 });
const message = (cause: unknown) => {
  if (cause instanceof ApiError && cause.status === 401) window.location.replace("/sign-in?reason=expired");
  return cause instanceof ApiError ? cause.message : authErrorMessage(cause);
};

export function PracticeOnboarding({ onInvitations }: { onInvitations: () => void }) {
  const { getToken } = useAuth();
  const { user } = useUser();
  const { setActive, userMemberships } = useOrganizationList({ userMemberships: true });
  const [snapshot, setSnapshot] = useState<OnboardingState | null>(null);
  const [draft, setDraft] = useState<PracticeDraft>(emptyDraft);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState<PracticeDraft | null>(null);
  const [createdOrg, setCreatedOrg] = useState("");
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [requestKey] = useState(() => crypto.randomUUID());
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationSent, setVerificationSent] = useState(false);
  const locked = useRef(false);
  const lifetime = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    void (async () => {
      try {
        const token = await getToken({ skipCache: true }); if (!token) throw new AccessActionError("Please sign in again.");
        const result = await apiRequest<{ data: OnboardingState }>("/api/v1/onboarding/state", token, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setSnapshot(result.data); setError("");
        if (result.data.draft) { setDraft(result.data.draft); setStep(result.data.draft.step); }
        if (result.data.operation?.state === "pending") setSubmitted(result.data.draft);
        if (result.data.operation?.state === "complete") setCreatedOrg(result.data.operation.organizationId || "");
      } catch (cause) { if (!controller.signal.aborted) setError(message(cause)); }
    })();
    return () => controller.abort();
  }, [getToken, attempt]);

  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(""); setFeedback("");
    try { await action(); } catch (cause) { if (!lifetime.current?.signal.aborted) setError(message(cause)); }
    finally { locked.current = false; if (!lifetime.current?.signal.aborted) setBusy(false); }
  }
  async function token() { const value = await getToken({ skipCache: true }); lifetime.current?.signal.throwIfAborted(); if (!value) throw new AccessActionError("Please sign in again."); return value; }
  async function saveDraft(value: PracticeDraft) {
    const result = await apiRequest<{ data: PracticeDraft }>("/api/v1/onboarding/draft", await token(), { method: "PUT", body: JSON.stringify(value), signal: lifetime.current?.signal });
    lifetime.current?.signal.throwIfAborted(); setDraft(result.data); return result.data;
  }
  async function saveLater() { await run(async () => { if (!snapshot || snapshot.operation || submitted) return; await saveDraft({ ...draft, step }); setSaved(true); }); }
  async function create(value: PracticeDraft) {
    const validation = validateDraft(value, true); if (validation) throw new AccessActionError(validation);
    setSubmitted(value);
    try {
      const result = await apiRequest<{ data: { orgId: string } }>("/api/v1/onboarding", await token(), { method: "POST", headers: { "Idempotency-Key": requestKey }, body: JSON.stringify(onboardingInput(value)), signal: lifetime.current?.signal });
      lifetime.current?.signal.throwIfAborted(); setCreatedOrg(result.data.orgId);
    } catch (cause) {
      // Definitive validation/eligibility refusals did not begin provisioning.
      if (cause instanceof ApiError && [400, 403].includes(cause.status) && !["PROVISIONING_CONFLICT", "ONBOARDING_RETRY_CONFLICT"].includes(cause.code)) setSubmitted(null);
      throw cause;
    }
  }
  async function retrySubmitted() {
    await run(async () => {
      const result = await apiRequest<{ data: OnboardingState }>("/api/v1/onboarding/state", await token(), { signal: lifetime.current?.signal });
      lifetime.current?.signal.throwIfAborted(); setSnapshot(result.data);
      if (result.data.operation?.state === "complete" && result.data.operation.organizationId) { setCreatedOrg(result.data.operation.organizationId); return; }
      const original = submitted || result.data.draft;
      if (!original) throw new AccessActionError("Your setup is pending. Contact your CareIQ administrator to resume the original details.");
      await create(original);
    });
  }
  async function activate(view: "workspace" | "invite" | "owneraccess") {
    await run(async () => {
      if (!setActive || !createdOrg) throw new AccessActionError("Your practice is not ready yet. Check setup again.");
      await userMemberships.revalidate?.(); lifetime.current?.signal.throwIfAborted();
      await setActive({ organization: createdOrg, navigate: ({ session, decorateUrl }) => {
        window.location.assign(decorateUrl(session.currentTask ? "/session-tasks" : view === "workspace" ? "/" : `/?manage=${view}`));
      } });
    });
  }
  async function next(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      if (!snapshot || snapshot.operation || submitted) return;
      const nextStep = step === 3 ? 3 : (step + 1) as 2 | 3;
      const value = { ...draft, step: nextStep };
      const validation = validateDraft(value, step === 3); if (validation) throw new AccessActionError(validation);
      await saveDraft(value);
      if (step === 3) await create(value); else setStep(nextStep);
    });
  }
  const account = <UserButton />;
  if (!snapshot) return <AccessShell account={account}><AccessHeading title={error ? "We couldn’t open your setup" : "Checking your practice setup…"}>{error ? "Try again to continue with your saved details." : "One moment while we check your account."}</AccessHeading><AccessError>{error}</AccessError>{error && <button className="cq-a-primary" onClick={() => setAttempt(n => n + 1)}>Try again</button>}</AccessShell>;
  const view = onboardingView(snapshot);
  if (view === "verify") {
    const email = user?.primaryEmailAddress;
    return <AccessShell account={account}><AccessHeading title="Verify your email" mark="mail">Verify your account email before setting up a new practice.</AccessHeading>{email && <p className="cq-a-account">{email.emailAddress}</p>}{verificationSent ? <form className="cq-a-form" onSubmit={event => { event.preventDefault(); void run(async () => { if (!email) return; await email.attemptVerification({ code: verificationCode }); await user?.reload(); lifetime.current?.signal.throwIfAborted(); setSnapshot(null); setAttempt(n => n + 1); }); }}><AccessField label="Verification code" name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={verificationCode} onChange={event => setVerificationCode(event.target.value)} /><AccessError>{error}</AccessError><button disabled={busy} className="cq-a-primary">Verify & continue</button></form> : <button className="cq-a-primary" disabled={busy || !email} onClick={() => void run(async () => { await email?.prepareVerification({ strategy: "email_code" }); setVerificationSent(true); })}>Send verification code</button>}<button className="cq-a-link" onClick={onInvitations}>View my invitations</button></AccessShell>;
  }
  if (view === "restricted") return <AccessShell account={account}><AccessHeading title="Practice setup needs approval" mark="building">Your account is ready. New practice setup is currently available to approved practice owners.</AccessHeading><p className="cq-a-account">{user?.primaryEmailAddress?.emailAddress}</p><div className="cq-a-note">If you were invited to an existing practice, use the invitation sent to your email. Contact your CareIQ administrator for new practice setup.</div><div className="cq-a-actions"><button className="cq-a-primary" onClick={onInvitations}>View my invitations</button><SignOutButton>Use another account</SignOutButton></div></AccessShell>;
  if (createdOrg) return <AccessShell account={account} wide><AccessHeading title="Your practice is ready" mark="check">{draft.practiceName || "Your practice"} and its first location have been created.</AccessHeading><div className="cq-a-list"><div><span><strong>{draft.practiceName}</strong><small>You’re the practice owner.</small></span></div><div><span><strong>{draft.locationName}</strong><small>{timeZoneLabel(draft.timeZone)}</small></span></div></div><AccessError>{error}</AccessError><button disabled={busy} className="cq-a-primary" onClick={() => void activate("workspace")}>Continue to practice →</button><div className="cq-a-actions"><button disabled={busy} className="cq-a-secondary" onClick={() => void activate("invite")}>Invite a teammate</button><button disabled={busy} className="cq-a-link" onClick={() => void activate("owneraccess")}>Set my location access</button></div></AccessShell>;
  if (submitted || view === "pending" || view === "complete") return <AccessShell account={account} wide><AccessHeading title="Finishing your setup" mark="clock">Your submitted details stay with this setup. Check the same operation to continue.</AccessHeading><div className="cq-a-note">Your practice may already have been created. Retry with the same details to avoid starting another practice.</div><AccessError>{error}</AccessError><div className="cq-a-actions"><button disabled={busy} className="cq-a-primary" onClick={() => void retrySubmitted()}>{busy ? "Checking setup…" : "Check setup status"}</button><SignOutButton>I’ll come back later</SignOutButton></div></AccessShell>;
  if (saved) return <AccessShell account={account}><AccessHeading title="Your setup is saved" mark="check">Continue when you’re ready. Your practice has not been created yet.</AccessHeading><button className="cq-a-primary" onClick={() => setSaved(false)}>Continue setup</button><SignOutButton /></AccessShell>;
  const zones = availableTimeZones(draft.timeZone);
  return <AccessShell account={account} step={step} wide>
    {step > 1 && <button className="cq-a-link cq-a-back" disabled={busy} onClick={() => setStep(step === 3 ? 2 : 1)}>← Back</button>}
    <AccessHeading title={step === 1 ? "What’s your practice called?" : step === 2 ? "Add your first location" : "Everything look right?"}>{step === 1 ? "Use the name your team will recognize." : step === 2 ? "Start with one location. You can add more later." : "Review your details before creating your practice."}</AccessHeading>
    {step === 3 && <div className="cq-a-summary"><section><header><h2>Practice</h2><button type="button" className="cq-a-link" disabled={busy} onClick={() => setStep(1)}>Edit practice</button></header><strong>{draft.practiceName}</strong><small>Owner · {user?.fullName || user?.primaryEmailAddress?.emailAddress}</small></section><section><header><h2>First location</h2><button className="cq-a-link" disabled={busy} onClick={() => setStep(2)}>Edit location</button></header><strong>{draft.locationName}</strong><small>{timeZoneLabel(draft.timeZone)}{draft.address && <><br />{draft.address}</>}</small></section></div>}
    <form className="cq-a-form" onSubmit={next} aria-busy={busy}><fieldset disabled={busy}>
      {step === 1 && <AccessField label="Practice name" name="practiceName" required autoComplete="organization" maxLength={120} value={draft.practiceName} onChange={event => setDraft(value => ({ ...value, practiceName: event.target.value }))} hint="This will appear in your practice workspace." />}
      {step === 2 && <><AccessField label="Location name" name="locationName" required maxLength={120} value={draft.locationName} placeholder="Main location" onChange={event => setDraft(value => ({ ...value, locationName: event.target.value }))} /><div className="cq-a-field"><label htmlFor="cq-a-timezone">Time zone</label><select className="cq-a-input" id="cq-a-timezone" value={draft.timeZone} required onChange={event => setDraft(value => ({ ...value, timeZone: event.target.value }))} aria-describedby="cq-a-timezone-hint">{zones.map(zone => <option value={zone} key={zone}>{timeZoneLabel(zone)}</option>)}</select><small id="cq-a-timezone-hint">Suggested from your device. Check that it matches this location.</small></div><details className="cq-a-details" open={!!draft.address || undefined}><summary>＋ Add address (optional)</summary><AccessField label="Street address" name="address" autoComplete="street-address" maxLength={500} value={draft.address} onChange={event => setDraft(value => ({ ...value, address: event.target.value }))} placeholder="Street, city, state and postal code" /></details></>}
      {step === 3 && <label className="cq-a-check"><input type="checkbox" name="authority" required /><span>I’m authorized to set up and manage this practice.</span></label>}
      <AccessError>{error}</AccessError><button className="cq-a-primary">{busy ? "Saving…" : step === 3 ? "Create practice and location" : step === 2 ? "Review practice" : "Continue"} →</button>
      {step < 3 && <button type="button" className="cq-a-link" onClick={() => void saveLater()}>Save & finish later</button>}
      {step === 3 && <p className="cq-a-policy">Team invitations and location access come next.</p>}
    </fieldset></form><AccessStatus>{feedback}</AccessStatus>
  </AccessShell>;
}
