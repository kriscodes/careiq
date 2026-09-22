"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";

type InterviewModalProps = {
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  developerNotes?: boolean;
};

export function InterviewModal({ title, description, children, onClose, busy = false, developerNotes = false }: InterviewModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLElement>("input:enabled, select:enabled, textarea:enabled")?.focus();

    return () => {
      // Only release this dialog. Cleanup must not close a newly opened parent view.
      if (dialog.open) dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus !== document.body && previousFocus.isConnected && !previousFocus.closest("[inert]") && !previousFocus.matches(":disabled")) {
        previousFocus.focus({ preventScroll: true });
        if (document.activeElement === previousFocus) return;
      }
      const fallback = document.querySelector<HTMLElement>("[data-cq-dialog-focus-fallback], main");
      if (!fallback || fallback.closest("[inert]")) return;
      const previousTabIndex = fallback.getAttribute("tabindex");
      fallback.setAttribute("tabindex", "-1");
      fallback.focus({ preventScroll: true });
      if (previousTabIndex === null) fallback.removeAttribute("tabindex");
      else fallback.setAttribute("tabindex", previousTabIndex);
    };
  }, []);

  return (
    <dialog ref={ref} className={`cq-modal${developerNotes ? " cq-modal-developer" : ""}`} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <header className="cq-modal-head">
        <div>
          {developerNotes && <p className="cq-form-note">DEVELOPER NOTES · INTERVIEW DEMO</p>}
          <h2 id={`${id}-title`}>{title}</h2>
          <p id={`${id}-description`}>{description}</p>
        </div>
        <button type="button" className="cq-iconbutton" aria-label={`Close ${title}`} disabled={busy} onClick={onClose}>×</button>
      </header>
      {children}
    </dialog>
  );
}
