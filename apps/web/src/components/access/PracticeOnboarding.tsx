"use client";

import { useI18n } from "@/i18n/provider";
import { localizeAccessText, accessZoneLabel } from "@/components/access/display";
import { UserButton, useAuth, useOrganizationList, useUser } from "@clerk/nextjs";
import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "@/lib/api/client";
import { availableTimeZones, onboardingInput, onboardingView, validateDraft, type OnboardingState, type PracticeDraft } from "@/lib/access-flow";
import { AccessActionError, authErrorMessage } from "@/lib/auth-errors";
import { SignOutButton } from "./SignOutButton";
import { AccessError, AccessField, AccessHeading, AccessShell, AccessStatus } from "./AccessShell";

const emptyDraft = (): PracticeDraft => ({ practiceName: "", locationName: "", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", address: "", step: 1 });


export function PracticeOnboarding({ onInvitations }: { onInvitations: () => void }) {
  const { t, uiError, locale } = useI18n();
  // Translation changes update notifications without restarting access checks or clearing form drafts.
  const onLoadText = useEffectEvent((value: unknown, fallback?: string) => typeof value === "string" ? t(value) : value instanceof ApiError ? uiError(value, fallback) : authErrorMessage(value, t));
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
        const token = await getToken({ skipCache: true }); if (!token) throw new AccessActionError(onLoadText("access.copy.please_sign_in_again"));
        const result = await apiRequest<{ data: OnboardingState }>("/api/v1/onboarding/state", token, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setSnapshot(result.data); setError("");
        if (result.data.draft) { setDraft(result.data.draft); setStep(result.data.draft.step); }
        if (result.data.operation?.state === "pending") setSubmitted(result.data.draft);
        if (result.data.operation?.state === "complete") setCreatedOrg(result.data.operation.organizationId || "");
      } catch (cause) { if (!controller.signal.aborted) setError(onLoadText(cause)); }
    })();
    return () => controller.abort();
  }, [getToken, attempt]);

  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(""); setFeedback("");
    try { await action(); } catch (cause) { if (!lifetime.current?.signal.aborted) setError((cause instanceof ApiError ? uiError(cause) : authErrorMessage(cause, t))); }
    finally { locked.current = false; if (!lifetime.current?.signal.aborted) setBusy(false); }
  }
  async function token() { const value = await getToken({ skipCache: true }); lifetime.current?.signal.throwIfAborted(); if (!value) throw new AccessActionError(t("access.copy.please_sign_in_again")); return value; }
  async function saveDraft(value: PracticeDraft) {
    const result = await apiRequest<{ data: PracticeDraft }>("/api/v1/onboarding/draft", await token(), { method: "PUT", body: JSON.stringify(value), signal: lifetime.current?.signal });
    lifetime.current?.signal.throwIfAborted(); setDraft(result.data); return result.data;
  }
  async function saveLater() { await run(async () => { if (!snapshot || snapshot.operation || submitted) return; await saveDraft({ ...draft, step }); setSaved(true); }); }
  async function create(value: PracticeDraft) {
    const validation = validateDraft(value, true); if (validation) throw new AccessActionError(localizeAccessText(t, validation));
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
      if (!original) throw new AccessActionError(t("access.copy.your_setup_is_pending_contact_your_careiq_administrator_to_resume_the_orig"));
      await create(original);
    });
  }
  async function activate(view: "workspace" | "invite" | "owneraccess") {
    await run(async () => {
      if (!setActive || !createdOrg) throw new AccessActionError(t("access.copy.your_practice_is_not_ready_yet_check_setup_again"));
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
      const validation = validateDraft(value, step === 3); if (validation) throw new AccessActionError(localizeAccessText(t, validation));
      await saveDraft(value);
      if (step === 3) await create(value); else setStep(nextStep);
    });
  }
  const account = <UserButton />;
  if (!snapshot) return <AccessShell account={account}><AccessHeading title={error ? t("access.copy.we_couldn_t_open_your_setup") : t("access.copy.checking_your_practice_setup")}>{error ? t("access.copy.try_again_to_continue_with_your_saved_details") : t("access.copy.one_moment_while_we_check_your_account")}</AccessHeading><AccessError>{error}</AccessError>{error && <button className="cq-a-primary" onClick={() => setAttempt(n => n + 1)}>{t("access.copy.try_again")}</button>}</AccessShell>;
  const view = onboardingView(snapshot);
  if (view === "verify") {
    const email = user?.primaryEmailAddress;
    return <AccessShell account={account}><AccessHeading title={t("access.copy.verify_your_email")} mark="mail">{t("access.copy.verify_your_account_email_before_setting_up_a_new_practice")}</AccessHeading>{email && <p className="cq-a-account">{email.emailAddress}</p>}{verificationSent ? <form className="cq-a-form" onSubmit={event => { event.preventDefault(); void run(async () => { if (!email) return; await email.attemptVerification({ code: verificationCode }); await user?.reload(); lifetime.current?.signal.throwIfAborted(); setSnapshot(null); setAttempt(n => n + 1); }); }}><AccessField label={t("access.copy.verification_code")} name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={verificationCode} onChange={event => setVerificationCode(event.target.value)} /><AccessError>{error}</AccessError><button disabled={busy} className="cq-a-primary">{t("access.copy.verify_continue")}</button></form> : <button className="cq-a-primary" disabled={busy || !email} onClick={() => void run(async () => { await email?.prepareVerification({ strategy: "email_code" }); setVerificationSent(true); })}>{t("access.copy.send_verification_code")}</button>}<button className="cq-a-link" onClick={onInvitations}>{t("access.copy.view_my_invitations")}</button></AccessShell>;
  }
  if (view === "restricted") return <AccessShell account={account}><AccessHeading title={t("access.copy.practice_setup_needs_approval")} mark="building">{t("access.copy.your_account_is_ready_new_practice_setup_is_currently_available_to_approve")}</AccessHeading><p className="cq-a-account">{user?.primaryEmailAddress?.emailAddress}</p><div className="cq-a-note">{t("access.copy.if_you_were_invited_to_an_existing_practice_use_the_invitation_sent_to_you")}</div><div className="cq-a-actions"><button className="cq-a-primary" onClick={onInvitations}>{t("access.copy.view_my_invitations")}</button><SignOutButton>{t("access.copy.use_another_account")}</SignOutButton></div></AccessShell>;
  if (createdOrg) return <AccessShell account={account} wide><AccessHeading title={t("access.copy.your_practice_is_ready")} mark="check">{t("access.setup.created", { practice: draft.practiceName || t("access.copy.your_practice") })}</AccessHeading><div className="cq-a-list"><div><span><strong>{draft.practiceName}</strong><small>{t("access.copy.you_re_the_practice_owner")}</small></span></div><div><span><strong>{draft.locationName}</strong><small>{accessZoneLabel(locale, draft.timeZone)}</small></span></div></div><AccessError>{error}</AccessError><button disabled={busy} className="cq-a-primary" onClick={() => void activate("workspace")}>{t("access.copy.continue_to_practice")}</button><div className="cq-a-actions"><button disabled={busy} className="cq-a-secondary" onClick={() => void activate("invite")}>{t("access.copy.invite_a_teammate")}</button><button disabled={busy} className="cq-a-link" onClick={() => void activate("owneraccess")}>{t("access.copy.set_my_location_access")}</button></div></AccessShell>;
  if (submitted || view === "pending" || view === "complete") return <AccessShell account={account} wide><AccessHeading title={t("access.copy.finishing_your_setup")} mark="clock">{t("access.copy.your_submitted_details_stay_with_this_setup_check_the_same_operation_to_co")}</AccessHeading><div className="cq-a-note">{t("access.copy.your_practice_may_already_have_been_created_retry_with_the_same_details_to")}</div><AccessError>{error}</AccessError><div className="cq-a-actions"><button disabled={busy} className="cq-a-primary" onClick={() => void retrySubmitted()}>{busy ? t("access.copy.checking_setup") : t("access.copy.check_setup_status")}</button><SignOutButton>{t("access.copy.i_ll_come_back_later")}</SignOutButton></div></AccessShell>;
  if (saved) return <AccessShell account={account}><AccessHeading title={t("access.copy.your_setup_is_saved")} mark="check">{t("access.copy.continue_when_you_re_ready_your_practice_has_not_been_created_yet")}</AccessHeading><button className="cq-a-primary" onClick={() => setSaved(false)}>{t("access.copy.continue_setup")}</button><SignOutButton /></AccessShell>;
  const zones = availableTimeZones(draft.timeZone);
  return <AccessShell account={account} step={step} wide>
    {step > 1 && <button className="cq-a-link cq-a-back" disabled={busy} onClick={() => setStep(step === 3 ? 2 : 1)}>{t("access.copy.back_aceb69")}</button>}
    <AccessHeading title={step === 1 ? t("access.copy.what_s_your_practice_called") : step === 2 ? t("access.copy.add_your_first_location") : t("access.copy.everything_look_right")}>{step === 1 ? t("access.copy.use_the_name_your_team_will_recognize") : step === 2 ? t("access.copy.start_with_one_location_you_can_add_more_later") : t("access.copy.review_your_details_before_creating_your_practice")}</AccessHeading>
    {step === 3 && <div className="cq-a-summary"><section><header><h2>{t("access.copy.practice")}</h2><button type="button" className="cq-a-link" disabled={busy} onClick={() => setStep(1)}>{t("access.copy.edit_practice")}</button></header><strong>{draft.practiceName}</strong><small>{t("access.setup.owner", { name: user?.fullName || user?.primaryEmailAddress?.emailAddress || t("access.copy.your_account") })}</small></section><section><header><h2>{t("access.copy.first_location")}</h2><button className="cq-a-link" disabled={busy} onClick={() => setStep(2)}>{t("access.copy.edit_location")}</button></header><strong>{draft.locationName}</strong><small>{accessZoneLabel(locale, draft.timeZone)}{draft.address && <><br />{draft.address}</>}</small></section></div>}
    <form className="cq-a-form" onSubmit={next} aria-busy={busy}><fieldset disabled={busy}>
      {step === 1 && <AccessField label={t("access.copy.practice_name")} name="practiceName" required autoComplete="organization" maxLength={120} value={draft.practiceName} onChange={event => setDraft(value => ({ ...value, practiceName: event.target.value }))} hint={t("access.copy.this_will_appear_in_your_practice_workspace")} />}
      {step === 2 && <><AccessField label={t("access.copy.location_name")} name="locationName" required maxLength={120} value={draft.locationName} placeholder={t("access.copy.main_location")} onChange={event => setDraft(value => ({ ...value, locationName: event.target.value }))} /><div className="cq-a-field"><label htmlFor="cq-a-timezone">{t("access.copy.time_zone")}</label><select className="cq-a-input" id="cq-a-timezone" value={draft.timeZone} required onChange={event => setDraft(value => ({ ...value, timeZone: event.target.value }))} aria-describedby="cq-a-timezone-hint">{zones.map(zone => <option value={zone} key={zone}>{accessZoneLabel(locale, zone)}</option>)}</select><small id="cq-a-timezone-hint">{t("access.copy.suggested_from_your_device_check_that_it_matches_this_location")}</small></div><details className="cq-a-details" open={!!draft.address || undefined}><summary>{t("access.copy.add_address_optional")}</summary><AccessField label={t("access.copy.street_address")} name="address" autoComplete="street-address" maxLength={500} value={draft.address} onChange={event => setDraft(value => ({ ...value, address: event.target.value }))} placeholder={t("access.copy.street_city_state_and_postal_code")} /></details></>}
      {step === 3 && <label className="cq-a-check"><input type="checkbox" name="authority" required /><span>{t("access.copy.i_m_authorized_to_set_up_and_manage_this_practice")}</span></label>}
      <AccessError>{error}</AccessError><button className="cq-a-primary">{busy ? t("access.copy.saving") : step === 3 ? t("access.copy.create_practice_and_location") : step === 2 ? t("access.copy.review_practice") : t("access.copy.continue")} →</button>
      {step < 3 && <button type="button" className="cq-a-link" onClick={() => void saveLater()}>{t("access.copy.save_finish_later")}</button>}
      {step === 3 && <p className="cq-a-policy">{t("access.copy.team_invitations_and_location_access_come_next")}</p>}
    </fieldset></form><AccessStatus>{feedback}</AccessStatus>
  </AccessShell>;
}
