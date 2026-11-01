"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/i18n/provider";
import type { PracticeMember } from "@/lib/api/practice";

export type OwnershipTransferPayload = { userId: string; practiceId: string; confirmationName: string; acknowledgedUserId: string };
type Props = { practice: { id: string; name: string }; members: PracticeMember[]; busy: boolean; onTransfer: (payload: OwnershipTransferPayload) => Promise<void> };
const recipientLabel = (member: PracticeMember) => member.displayName && member.email ? `${member.displayName} (${member.email})` : member.email || member.displayName || member.userId;

export function OwnershipTransfer(props: Props) {
  const recipients = props.members.filter(member => !member.isOwner && member.status === "active" && member.role === "org:admin");
  // A changed practice or recipient directory must invalidate an earlier confirmation.
  const identity = JSON.stringify([props.practice.id, props.practice.name, recipients.map(member => [member.userId, recipientLabel(member)])]);
  return <OwnershipTransferForm key={identity} {...props} recipients={recipients} />;
}

function OwnershipTransferForm({ practice, recipients, busy, onTransfer }: Props & { recipients: PracticeMember[] }) {
  const { t } = useI18n();
  const prefix = useId();
  const [userId, setUserId] = useState("");
  const [confirmationName, setConfirmationName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const locked = useRef(false);
  const recipient = recipients.find(member => member.userId === userId);
  const name = recipient ? recipientLabel(recipient) : "";
  const ready = Boolean(recipient && confirmationName === practice.name && practice.name);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || busy || locked.current) return;
    locked.current = true; setSubmitting(true);
    try {
      await onTransfer({ userId, practiceId: practice.id, confirmationName, acknowledgedUserId: userId });
      setUserId(""); setConfirmationName("");
    } catch { /* The settings owner displays the localized API error. */ }
    finally { locked.current = false; setSubmitting(false); }
  }
  return <section className="cq-setup-section cq-ownership-transfer" aria-labelledby={`${prefix}-title`}>
    <h2 id={`${prefix}-title`}>{t("access.ownership.title")}</h2><p>{t("access.ownership.intro")}</p>
    {!recipients.length ? <p>{t("access.ownership.noEligible")}</p> : <form onSubmit={submit}>
      <fieldset className="cq-setup-fields" disabled={busy || submitting}>
        <label className="cq-field">{t("access.ownership.recipientLabel")}<select className="cq-input" name="userId" value={userId} required onChange={event => { setUserId(event.target.value); setConfirmationName(""); }}><option value="" disabled>{t("access.ownership.selectRecipient")}</option>{recipients.map(member => <option key={member.userId} value={member.userId}>{recipientLabel(member)}</option>)}</select></label>
        {recipient && <><p id={`${prefix}-warning`} className="cq-ownership-warning">{t("access.ownership.warning", { practice: practice.name, recipient: name })}</p><label className="cq-field">{t("access.ownership.phraseLabel", { practice: practice.name })}<input className="cq-input" name="confirmationName" value={confirmationName} onChange={event => setConfirmationName(event.target.value)} required maxLength={120} autoComplete="off" spellCheck={false} aria-describedby={`${prefix}-warning ${prefix}-hint`} /></label><small id={`${prefix}-hint`}>{t("access.ownership.phraseHint")}</small><button className="cq-button cq-ownership-confirm" type="submit" disabled={!ready}>{t(submitting ? "access.ownership.transferring" : "access.ownership.acknowledge", { recipient: name })}</button></>}
      </fieldset>
    </form>}
  </section>;
}
