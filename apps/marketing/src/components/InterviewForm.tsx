"use client";

import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { FIELD_LIMITS, INTERVIEW_ROLES, type InterviewFieldErrors } from "@careiq/interview-contract";
import type { FormField, SiteContent } from "../content/content";
import { prepareSubmission, submitInterview, type Attempt, type FormValues, type SubmissionResult } from "../lib/submission";
import { Icon } from "./Icon";

const subscribeToHydration = () => () => {};
const browserReady = () => true;
const serverReady = () => false;

const initialValues: FormValues = { name: "", email: "", role: "", practiceName: "", website: "" };
type Status = "idle" | "submitting" | SubmissionResult["kind"];

export function InterviewForm({ copy, apiUrl, enabled }: { copy: SiteContent["form"]; apiUrl?: string; enabled: boolean }) {
  const hydrated = useSyncExternalStore(subscribeToHydration, browserReady, serverReady);
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<InterviewFieldErrors>({});
  const [status, setStatus] = useState<Status>("idle");
  const previousAttempt = useRef<Attempt | null>(null);
  const pending = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const fieldOrder: FormField[] = ["name", "email", "role", "practiceName"];
  const isUnavailable = !enabled || !apiUrl;

  const fieldError = (field: FormField) => errors[field] ? copy.validation[field][errors[field]] : undefined;
  const update = (field: keyof FormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };
  const focusFirstError = (fields: InterviewFieldErrors) => {
    const first = fieldOrder.find((field) => fields[field]);
    if (first) (form.current?.elements.namedItem(first) as HTMLElement | null)?.focus();
  };
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || status === "success" || isUnavailable || !hydrated) return;
    let prepared: ReturnType<typeof prepareSubmission>;
    try { prepared = prepareSubmission(values, previousAttempt.current, () => crypto.randomUUID()); }
    catch { setStatus("error"); return; }
    if (!prepared.parsed.ok) {
      setErrors(prepared.parsed.fields);
      setStatus("invalid");
      focusFirstError(prepared.parsed.fields);
      return;
    }
    previousAttempt.current = prepared.attempt;
    pending.current = true;
    setErrors({});
    setStatus("submitting");
    const result = await submitInterview(apiUrl, prepared.parsed.data);
    pending.current = false;
    setStatus(result.kind);
    if (result.kind === "invalid") { setErrors(result.fields); focusFirstError(result.fields); }
    if (result.kind === "success") {
      setValues(initialValues);
      previousAttempt.current = null;
      statusRef.current?.focus();
    }
  }

  let message = "";
  if (isUnavailable || status === "unavailable") message = copy.unavailable;
  else if (status === "success") message = copy.success;
  else if (status === "submitting") message = copy.submitting;
  else if (status === "error") message = copy.error;
  else if (status === "rateLimited") message = copy.rateLimited;
  else if (status === "invalid") message = copy.validationSummary;

  return <div id="interview-form" className="interview-form cq-surface">
    <div className="form-heading"><span className="form-heading-icon"><Icon name="mail" /></span><h3>{copy.heading}</h3><p>{copy.description}</p></div>
    <div ref={statusRef} tabIndex={-1} className={`form-status ${message ? "has-message" : ""} ${status === "success" ? "is-success" : ""}`} role="status" aria-live="polite" aria-atomic="true">
      {status === "success" && <><span className="success-icon"><Icon name="check" /></span><h4>{copy.successHeading}</h4></>}
      {message && <p>{message}</p>}
      {status === "success" && <p className="success-detail">{copy.successDetail}</p>}
    </div>
    {status !== "success" && <form ref={form} method="post" action={apiUrl ? `${apiUrl}/api/v1/public/interview-requests` : undefined} onSubmit={onSubmit} noValidate aria-busy={status === "submitting"}>
      <noscript><p className="patient-warning">{copy.javascriptRequired}</p></noscript>
      <p className="form-required">{copy.requiredNote}</p>
      <fieldset disabled={status === "submitting" || isUnavailable || !hydrated}>
        <div className="cq-field"><label htmlFor="interview-name">{copy.labels.name}</label><input id="interview-name" name="name" className="cq-input" required autoComplete="name" maxLength={FIELD_LIMITS.name} value={values.name} onChange={(event) => update("name", event.target.value)} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "name-error" : undefined} />{fieldError("name") && <p id="name-error" className="field-error">{fieldError("name")}</p>}</div>
        <div className="cq-field"><label htmlFor="interview-email">{copy.labels.email}</label><input id="interview-email" name="email" type="email" inputMode="email" className="cq-input" required autoComplete="email" maxLength={FIELD_LIMITS.email} value={values.email} onChange={(event) => update("email", event.target.value)} aria-invalid={Boolean(errors.email)} aria-describedby={`email-help${errors.email ? " email-error" : ""}`} /><p id="email-help" className="field-help">{copy.emailHelp}</p>{fieldError("email") && <p id="email-error" className="field-error">{fieldError("email")}</p>}</div>
        <div className="cq-field"><label htmlFor="interview-role">{copy.labels.role}</label><div className="cq-select-wrap"><select id="interview-role" name="role" className="cq-input" required value={values.role} onChange={(event) => update("role", event.target.value)} aria-invalid={Boolean(errors.role)} aria-describedby={errors.role ? "role-error" : undefined}><option value="">{copy.rolePlaceholder}</option>{INTERVIEW_ROLES.map((role) => <option key={role} value={role}>{copy.roleLabels[role]}</option>)}</select></div>{fieldError("role") && <p id="role-error" className="field-error">{fieldError("role")}</p>}</div>
        <div className="cq-field"><label htmlFor="interview-practice">{copy.labels.practiceName} <span className="optional">({copy.labels.optional})</span></label><input id="interview-practice" name="practiceName" className="cq-input" autoComplete="organization" maxLength={FIELD_LIMITS.practiceName} value={values.practiceName} onChange={(event) => update("practiceName", event.target.value)} aria-invalid={Boolean(errors.practiceName)} aria-describedby={errors.practiceName ? "practiceName-error" : undefined} />{fieldError("practiceName") && <p id="practiceName-error" className="field-error">{fieldError("practiceName")}</p>}</div>
        <div className="honeypot" aria-hidden="true"><label htmlFor="interview-website">{copy.labels.website}</label><input id="interview-website" name="website" type="text" tabIndex={-1} autoComplete="off" value={values.website} onChange={(event) => update("website", event.target.value)} /></div>
        <p className="patient-warning">{copy.patientWarning}</p>
        <p className="privacy-disclosure">{copy.privacyPrefix} <a href="/privacy/">{copy.privacyLink}</a> {copy.privacySuffix}</p>
        <button className="cq-button cq-primary form-submit" type="submit" disabled={status === "submitting" || isUnavailable || !hydrated}>{status === "submitting" ? copy.submitting : ["error", "rateLimited", "unavailable"].includes(status) ? copy.retry : copy.submit}<Icon name="arrow" /></button>
      </fieldset>
    </form>}
  </div>;
}
