"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode, type InputHTMLAttributes } from "react";
import { InterviewIcon, type InterviewIconName } from "../InterviewIcon";

export function AccessHeading({ title, children, mark }: { title: string; children?: ReactNode; mark?: InterviewIconName }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [title]);
  return <>{mark && <div className="cq-a-mark"><InterviewIcon name={mark} /></div>}<h1 ref={heading} tabIndex={-1}>{title}</h1>{children && <p className="cq-a-lead">{children}</p>}</>;
}

export function AccessShell({ children, step, wide = false, account }: { children: ReactNode; step?: 1 | 2 | 3; wide?: boolean; account?: ReactNode }) {
  const help = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  return <div className={`cq-access ${step ? "cq-access-setup" : ""}`}>
    <header className="cq-a-header"><Link href="/" className="cq-a-brand" aria-label="CareIQ home"><span className="cq-symbol" aria-hidden="true" />careiq</Link><div className="cq-a-header-actions">{account}<button ref={opener} className="cq-a-link" type="button" onClick={() => help.current?.showModal()}>Need help?</button></div></header>
    <div className="cq-a-layout">{step && <aside className="cq-a-sidebar" aria-label="Practice setup progress"><h2>Your practice</h2><p>A few details to get started.</p><ol>{["Practice", "Location", "Review"].map((name, index) => <li key={name} aria-current={step === index + 1 ? "step" : undefined}><span>{step > index + 1 ? <InterviewIcon name="check" /> : index + 1}</span><div><strong>{name}</strong><small>{["Your practice name", "Your first location", "Confirm & create"][index]}</small></div></li>)}</ol><p className="cq-a-sidebar-bottom"><strong>Keep it simple.</strong>Add your team and more locations when you’re ready.</p></aside>}
      <main className={`cq-a-main ${wide ? "cq-a-wide" : ""}`}><div className="cq-a-content">{step && <div className="cq-a-progress"><div><span>Practice setup</span><span>Step {step} of 3</span></div><progress max={3} value={step} aria-label={`Practice setup: step ${step} of 3`} /></div>}{children}</div></main>
    </div><footer className="cq-a-footer"><span>{step ? "Your practice. One step at a time." : "A little more room to care."}</span><span>CareIQ</span></footer>
    <dialog className="cq-a-help" ref={help} aria-labelledby="cq-help-title" onClose={() => opener.current?.focus()} onClick={event => { if (event.target === event.currentTarget) help.current?.close(); }}><div><header><h2 id="cq-help-title">A little help getting started</h2><button type="button" className="cq-a-link" onClick={() => help.current?.close()}>Close</button></header><p>For practice access, contact your practice owner. For account or new practice setup, contact your CareIQ administrator.</p><div className="cq-a-note">An invitation may use a different email. Sign in with the address it was sent to.</div><button type="button" className="cq-a-secondary" onClick={() => help.current?.close()}>Back to CareIQ</button></div></dialog>
  </div>;
}

export function AccessError({ children }: { children?: ReactNode }) { return children ? <p className="cq-a-error" id="cq-access-error" role="alert">{children}</p> : null; }
export function AccessStatus({ children }: { children?: ReactNode }) { return children ? <p className="cq-a-feedback" role="status">{children}</p> : null; }
export function AccessField({ label, hint, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = props.id || `cq-a-${props.name}`;
  return <div className="cq-a-field"><label htmlFor={id}>{label}</label><input {...props} id={id} className="cq-a-input" aria-describedby={hint ? `${id}-hint` : props["aria-describedby"]} />{hint && <small id={`${id}-hint`}>{hint}</small>}</div>;
}
export function AccessPassword({ label = "Password", name = "password", creating = false, action }: { label?: string; name?: string; creating?: boolean; action?: ReactNode }) {
  const [visible, setVisible] = useState(false);
  return <div className="cq-a-field"><div className="cq-a-field-head"><label htmlFor={`cq-a-${name}`}>{label}</label>{action}</div><div className="cq-a-password"><input className="cq-a-input" id={`cq-a-${name}`} name={name} required type={visible ? "text" : "password"} autoComplete={creating ? "new-password" : "current-password"} placeholder={creating ? "Create a password" : "Enter your password"} /><button type="button" aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`} aria-pressed={visible} onClick={() => setVisible(value => !value)}>{visible ? "Hide" : "Show"}</button></div>{creating && <small>Your password must meet the requirements for your account.</small>}</div>;
}
