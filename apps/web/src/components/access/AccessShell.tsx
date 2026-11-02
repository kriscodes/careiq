"use client";

import type { ApplicationPageFrame, NavigationGuard } from "@/lib/application-navigation";
import { useI18n } from "@/i18n/provider";
import { localizeAccessText } from "@/components/access/display";
import Link from "next/link";
import { LanguageSelector } from "@/i18n/LanguageSelector";
import { useEffect, useRef, useState, type ReactNode, type RefObject, type InputHTMLAttributes } from "react";
import { InterviewIcon, type InterviewIconName } from "../InterviewIcon";

export function AccessHeading({ title, children, mark }: { title: string; children?: ReactNode; mark?: InterviewIconName }) {

  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [title]);
  return <>{mark && <div className="cq-a-mark"><InterviewIcon name={mark} /></div>}<h1 ref={heading} tabIndex={-1}>{title}</h1>{children && <p className="cq-a-lead">{children}</p>}</>;
}

export function AccessShell({ children, step, wide = false, account, centered = false, embedded = false }: { children: ReactNode; step?: 1 | 2 | 3; wide?: boolean; account?: ReactNode; centered?: boolean; embedded?: boolean }) {
  const { t } = useI18n();
  const help = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const Content = embedded ? "section" : "main";
  return <div className={`cq-access ${embedded ? "cq-access-embedded" : ""} ${step ? "cq-access-setup" : ""} ${centered ? "cq-access-centered" : ""}`}>
    {!embedded && <header className="cq-a-header">
      <Link href="/" className="cq-a-brand" aria-label={t("access.copy.careiq_home")}><span className="cq-a-wordmark" aria-hidden="true" /></Link>
      <div className="cq-a-header-actions">
        <LanguageSelector />
        {account && <div className="cq-a-header-account" role="group" aria-label={t("access.copy.your_account")}>{account}</div>}
        <button ref={opener} className="cq-a-link cq-a-header-help" type="button" onClick={() => help.current?.showModal()}>{t("access.auth.needAHand")}</button>
      </div>
    </header>}
    <div className="cq-a-layout">{step && <aside className="cq-a-sidebar" aria-label={t("access.copy.practice_setup_progress")}><h2>{t("access.copy.your_practice")}</h2><p>{t("access.copy.a_few_details_to_get_started")}</p><ol>{[t("access.copy.practice"), t("access.copy.location"), t("access.copy.review")].map((name, index) => <li key={name} aria-current={step === index + 1 ? "step" : undefined}><span>{step > index + 1 ? <InterviewIcon name="check" /> : index + 1}</span><div><strong>{name}</strong><small>{[t("access.copy.your_practice_name"), t("access.copy.your_first_location"), t("access.copy.confirm_create")][index]}</small></div></li>)}</ol><p className="cq-a-sidebar-bottom"><strong>{t("access.copy.keep_it_simple")}</strong>{t("access.copy.add_your_team_and_more_locations_when_you_re_ready")}</p></aside>}
      <Content className={`cq-a-main ${wide ? "cq-a-wide" : ""}`}><div className="cq-a-content">{centered && <div className="cq-a-hello" aria-hidden="true"><span className="cq-a-companion" /></div>}{step && <div className="cq-a-progress"><div><span>{t("access.copy.practice_setup")}</span><span>{t("access.setup.step", { step, total: 3 })}</span></div><progress max={3} value={step} aria-label={t("access.setup.progress", { step, total: 3 })} /></div>}{children}</div></Content>
    </div>{!embedded && <footer className="cq-a-footer"><span>{step ? t("access.copy.your_practice_one_step_at_a_time") : t("access.copy.a_little_more_room_to_care")}</span><span>careiq</span></footer>}
    {!embedded && <dialog className="cq-a-help" ref={help} aria-labelledby="cq-help-title" onClose={() => opener.current?.focus()} onClick={event => { if (event.target === event.currentTarget) help.current?.close(); }}><div><header><h2 id="cq-help-title">{t("access.copy.a_little_help_getting_started")}</h2><button type="button" className="cq-a-link" onClick={() => help.current?.close()}>{t("access.copy.close")}</button></header><p>{t("access.copy.for_practice_access_contact_your_practice_owner_for_account_or_new_practic")}</p><div className="cq-a-note">{t("access.copy.an_invitation_may_use_a_different_email_sign_in_with_the_address_it_was_se")}</div><button type="button" className="cq-a-secondary" onClick={() => help.current?.close()}>{t("access.copy.back_to_careiq")}</button></div></dialog>}
  </div>;
}

export function AccessError({ children }: { children?: ReactNode }) {
  const { t } = useI18n(); return children ? <p className="cq-a-error" id="cq-access-error" role="alert">{typeof children === "string" ? localizeAccessText(t, children) : children}</p> : null; }
export function AccessStatus({ children }: { children?: ReactNode }) {
  const { t } = useI18n(); return children ? <p className="cq-a-feedback" role="status">{typeof children === "string" ? localizeAccessText(t, children) : children}</p> : null; }
export function AccessField({ label, hint, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {

  const id = props.id || `cq-a-${props.name}`;
  return <div className="cq-a-field"><label htmlFor={id}>{label}</label><input {...props} id={id} className="cq-a-input" aria-describedby={hint ? `${id}-hint` : props["aria-describedby"]} />{hint && <small id={`${id}-hint`}>{hint}</small>}</div>;
}
export function AccessPassword({ label: providedLabel, name = "password", creating = false, action }: { label?: string; name?: string; creating?: boolean; action?: ReactNode }) {
  const { t } = useI18n();
  const label = providedLabel || t("access.copy.password");
  const [visible, setVisible] = useState(false);
  return <div className="cq-a-field"><div className="cq-a-field-head"><label htmlFor={`cq-a-${name}`}>{label}</label>{action}</div><div className="cq-a-password"><input className="cq-a-input" id={`cq-a-${name}`} name={name} required type={visible ? "text" : "password"} autoComplete={creating ? "new-password" : "current-password"} placeholder={creating ? t("access.copy.create_a_password") : t("access.copy.enter_your_password")} /><button type="button" aria-label={t(visible ? "access.auth.hidePassword" : "access.auth.showPassword", { label })} aria-pressed={visible} onClick={() => setVisible(value => !value)}>{visible ? t("access.copy.hide") : t("access.copy.show")}</button></div>{creating && <small>{t("access.copy.your_password_must_meet_the_requirements_for_your_account")}</small>}</div>;
}

export function AccessDiscardDialog({ id, dialog, keepEditing, opener, children, onDiscard }: { id: string; dialog: RefObject<HTMLDialogElement | null>; keepEditing: RefObject<HTMLButtonElement | null>; opener: RefObject<HTMLElement | null>; children: ReactNode; onDiscard: () => void }) {
  const { t } = useI18n();
  return <dialog className="cq-settings-unsaved" ref={dialog} aria-labelledby={`${id}-unsaved-title`} aria-describedby={`${id}-unsaved-body`} onClose={() => { if (opener.current?.isConnected) opener.current.focus(); }} onKeyDown={event => {
    if (event.key !== "Tab") return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")], first = buttons[0], last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}><h2 id={`${id}-unsaved-title`}>{t("access.settings.unsavedTitle")}</h2><p id={`${id}-unsaved-body`}>{children}</p><div className="cq-settings-dialog-actions"><button ref={keepEditing} type="button" className="cq-a-primary" onClick={() => dialog.current?.close()}>{t("access.settings.keepEditing")}</button><button type="button" className="cq-a-secondary" onClick={onDiscard}>{t("access.settings.discardChanges")}</button></div></dialog>;
}

export function ApplicationPage({ children, renderFrame, guard, blocked = false }: { children: ReactNode; renderFrame?: ApplicationPageFrame; guard?: NavigationGuard; blocked?: boolean }) {
  return renderFrame ? renderFrame(children, { guard, blocked }) : children;
}
