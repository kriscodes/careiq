// Stable API values. Display labels belong to marketing site-content.json.
export const INTERVIEW_ROLES = Object.freeze([
  "practice_owner", "practice_manager", "administrative_staff", "provider", "other",
]);
export const FIELD_LIMITS = Object.freeze({ name: 120, email: 254, practiceName: 160 });
export const PRIVACY_NOTICE_VERSION = "2026-10-02";
const allowedFields = new Set(["name", "email", "role", "practiceName", "submissionKey", "website"]);
const controls = /[\u0000-\u001f\u007f]/u;
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// No dependencies, secrets, database code, display copy, or browser storage.
export function parseInterviewRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, fields: { _form: "invalid" } };
  }
  const fields = {};
  if (Object.keys(value).some((key) => !allowedFields.has(key))) fields._form = "invalid";
  const text = (key, max, required = true) => {
    const raw = value[key];
    if (raw === undefined && !required) return "";
    if (typeof raw !== "string") { fields[key] = raw === undefined ? "required" : "invalid"; return ""; }
    const normalized = raw.trim();
    if (required && !normalized) fields[key] = "required";
    else if (raw.length > max || normalized.length > max) fields[key] = "too_long";
    else if (controls.test(raw)) fields[key] = "invalid";
    return normalized;
  };
  const name = text("name", FIELD_LIMITS.name);
  const email = text("email", FIELD_LIMITS.email).toLowerCase();
  // Ordinary email syntax, including general providers, plus addressing and
  // punycode domains. No DNS lookup or claim that a mailbox exists.
  const [mailbox, domain, extraPart] = email.split("@");
  const mailboxPattern = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i;
  const domainPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
  if (email && (extraPart !== undefined || !mailbox || mailbox.length > 64 ||
      !mailboxPattern.test(mailbox) || mailbox.startsWith(".") || mailbox.endsWith(".") ||
      mailbox.includes("..") || !domain || !domainPattern.test(domain))) fields.email = "invalid";
  const role = text("role", 32);
  if (role && !INTERVIEW_ROLES.includes(role)) fields.role = "invalid";
  const practiceName = text("practiceName", FIELD_LIMITS.practiceName, false);
  const submissionKey = text("submissionKey", 36).toLowerCase();
  if (submissionKey && !uuidV4.test(submissionKey)) fields.submissionKey = "invalid";
  const website = text("website", 200, false);
  if (Object.keys(fields).length) return { ok: false, fields };
  return { ok: true, data: { name, email, role, practiceName: practiceName || undefined, submissionKey, website } };
}
