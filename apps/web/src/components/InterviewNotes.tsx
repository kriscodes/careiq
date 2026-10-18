"use client";
import { useI18n } from "@/i18n/provider";
import { localizeAccessText } from "@/components/access/display";
import { InterviewIcon } from "./InterviewIcon";

export const INTERVIEW_DESIGN_VERSION = "v0.1 — Interview Design";

export function InterviewReviewerBar({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  return <aside className="cq-reviewer-bar" aria-label={t("access.copy.interview_reviewer_tools_separate_from_the_application")}>
    <div className="cq-reviewer-intro"><span className="cq-reviewer-icon"><InterviewIcon name="code" /></span><div><strong>{t("access.copy.interview_demo_developer_notes")}</strong><p>{t("access.notes.outside", { version: localizeAccessText(t, INTERVIEW_DESIGN_VERSION) })}</p></div></div>
    <button className="cq-button cq-reviewer-button" onClick={onOpen}><InterviewIcon name="workflow" />{t("access.copy.architecture_notes")}</button>
  </aside>;
}

export function InterviewArchitectureNotes() {
  const { t, formatNumber } = useI18n();
  const steps = [
    [t("access.copy.staff_action"), t("access.notes.nextReact"), t("access.copy.the_patient_or_appointment_form_sends_an_authenticated_request_to_the_care")],
    [t("access.copy.verified_identity"), t("access.notes.clerk"), t("access.copy.the_api_verifies_the_session_and_active_organization_the_client_does_not_c")],
    [t("access.copy.resolved_practice"), t("access.notes.api"), t("access.copy.the_current_user_endpoint_provisions_the_organization_s_practice_tenant_mi")],
    [t("access.copy.validated_operation"), t("access.notes.nodeDrizzle"), t("access.copy.the_api_validates_required_fields_appointment_creation_checks_that_the_sel")],
    [t("access.copy.isolated_transaction"), t("access.notes.postgresRls"), t("access.copy.a_transaction_local_practice_id_controls_row_visibility_and_writes_a_compo")],
    [t("access.copy.updated_workspace"), t("access.copy.api_response_ui"), t("access.copy.after_success_the_returned_record_updates_the_current_practice_s_list_refr")],
  ];
  return <div className="cq-notes-body"><div className="cq-notes-notice"><strong>{t("access.copy.illustrated_architecture_not_live_telemetry")}</strong><p>{t("access.copy.this_panel_is_for_interview_reviewers_it_explains_the_implementation_witho")}</p></div>
    <ol className="cq-flow-steps">{steps.map(([title, technology, description], index) => <li key={title}><span className="cq-step-number">{formatNumber(index + 1)}</span><div><h3>{title}</h3><p>{description}</p><code>{technology}</code></div></li>)}</ol>
    <div className="cq-notes-limit"><p>{t("access.copy.this_running_application_uses_the_configured_api_and_database_creating_pat")}</p><br /><InterviewIcon name="code" /><span>{t("access.copy.this_slice_implements_patient_and_appointment_creation_listing_it_does_not")}</span></div>
  </div>;
}
