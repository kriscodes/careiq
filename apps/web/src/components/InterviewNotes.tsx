import { InterviewIcon } from "./InterviewIcon";

export const INTERVIEW_DESIGN_VERSION = "v0.1 — Interview Design";

export function InterviewReviewerBar({ onOpen }: { onOpen: () => void }) {
  return <aside className="cq-reviewer-bar" aria-label="Interview reviewer tools, separate from the application">
    <div className="cq-reviewer-intro"><span className="cq-reviewer-icon"><InterviewIcon name="code" /></span><div><strong>Interview demo · Developer notes</strong><p>{INTERVIEW_DESIGN_VERSION} · Outside the staff application</p></div></div>
    <button className="cq-button cq-reviewer-button" onClick={onOpen}><InterviewIcon name="workflow" />Architecture notes</button>
  </aside>;
}

export function InterviewArchitectureNotes() {
  const steps = [
    ["Staff action", "Next.js / React", "The patient or appointment form sends an authenticated request to the CareIQ API."],
    ["Verified identity", "Clerk", "The API verifies the session, active organization, and permissions. Practice administrators can create records; members can view them. The client does not choose the database practice ID."],
    ["Resolved practice", "CareIQ API", "The current-user endpoint provisions the organization’s practice. Tenant middleware resolves that mapping before domain requests."],
    ["Validated operation", "Node.js / Drizzle", "The API validates required fields. Appointment creation checks that the selected patient is visible to this practice."],
    ["Isolated transaction", "PostgreSQL / RLS", "A transaction-local practice ID controls row visibility and writes. A composite foreign key prevents appointments from referring to another practice’s patient."],
    ["Updated workspace", "API response / UI", "After success, the returned record updates the current practice’s list. Retrying an unchanged draft reuses its request key to avoid duplicate records. Refreshing reads the practice’s records from the API again."],
  ];
  return <div className="cq-notes-body"><div className="cq-notes-notice"><strong>Illustrated architecture — not live telemetry</strong><p>This panel is for interview reviewers. It explains the implementation without displaying request payloads, credentials, patient data, or fabricated timings.</p></div>
    <ol className="cq-flow-steps">{steps.map(([title, technology, description], index) => <li key={title}><span className="cq-step-number">{index + 1}</span><div><h3>{title}</h3><p>{description}</p><code>{technology}</code></div></li>)}</ol>
    <div className="cq-notes-limit"><p>This running application uses the configured API and database. Creating patients or appointments saves real records. Use synthetic data for the interview.</p><br /><InterviewIcon name="code" /><span>This slice implements patient and appointment creation/listing. It does not yet implement live tracing, provider availability, conflict detection, or an audit-history screen.</span></div>
  </div>;
}
