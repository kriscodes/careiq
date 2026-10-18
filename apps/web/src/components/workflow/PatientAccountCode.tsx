"use client";
import { useAuth, useUser } from "@clerk/nextjs";
import { useRef, useState } from "react";
import { useI18n } from "@/i18n/provider";
export function PatientAccountCode() {
  const { isLoaded, isSignedIn, userId } = useAuth(); const { isLoaded: userLoaded, user } = useUser(); const { t } = useI18n(); const [copied, setCopied] = useState(false); const field = useRef<HTMLInputElement>(null);
  if (!isLoaded || !isSignedIn || !userLoaded || !user?.id || user.id !== userId || !/^user_[A-Za-z0-9]+$/.test(user.id)) return null;
  async function copy() { if (!user?.id) return; try { await navigator.clipboard.writeText(user.id); setCopied(true); } catch { field.current?.focus(); field.current?.select(); } }
  return <section className="wf-patient-account-code" aria-label={t("workflow.portal.yourCode")}><h2>{t("workflow.portal.yourCode")}</h2><p>{t("workflow.portal.patientCodeHelp")}</p><div className="wf-actions"><label className="wf-field">{t("workflow.portal.accountCode")}<input ref={field} readOnly value={user.id} autoComplete="off" spellCheck={false} /></label><button className="wf-button" onClick={() => void copy()}>{t(copied ? "workflow.portal.copied" : "workflow.portal.copy")}</button></div><p className="wf-muted">{t("workflow.portal.codeIsNotProof")}</p></section>;
}
