import { catalogs, translate, type Locale } from "../../../packages/i18n";
export type Readiness = { status: string; requiredCount: number; satisfiedCount: number; waivedCount: number; needsReviewCount: number; missingCount: number };
export type Requirement = { id: string; documentTypeId: string; label?: string; labelSnapshot?: string; lifecycleState?: string; progressState?: string; state?: string; revision: number; candidateVersionId?: string; dueAt?: string; reasonCodes?: string[] };
export type Patient = { id: string; firstName: string; lastName: string; displayName: string; email?: string; phone?: string; revision: number };
export type Appointment = { id: string; patientId: string; patient: { id: string; displayName: string }; providerId?: string; provider?: { id: string; displayName: string }; scheduledAt: string; endsAt?: string; status: string; reason?: string; revision: number; visitTypeId?: string; readiness?: Readiness; requirements?: Requirement[] };
export type Version = { id: string; versionNumber: number; status: string; source: string; sha256?: string; originalFilename?: string; contentType?: string; sizeBytes?: number; review?: { decision: string; id: string } };
export type Document = { id: string; patientId: string; documentTypeId: string; title: string; currentVersionId?: string; currentVersion?: Version; versions?: Version[]; archivedAt?: string; revision: number };
export type TemplateVersion = { id: string; versionNumber: number; state: string; content?: string; fieldSchema?: { key: string; label: string; type: string; required?: boolean; options?: string[] }[]; revision: number };
export type Template = { id: string; documentTypeId: string; title: string; active: boolean; publishedVersionId?: string; versions: TemplateVersion[]; revision: number };
export type Request = { id: string; patientId: string; appointmentId?: string; purpose: string; state: string; dueAt?: string; expiresAt?: string; deliveryState?: string; revision: number; items?: { requirementId: string }[] };
export type Work = { id: string; patientId: string; appointmentId?: string; requirementId?: string; requestId?: string; kind: string; state: string; assigneeUserId?: string; dueAt?: string; revision: number };
export type Catalog = { id: string; name?: string; displayName?: string; code?: string; status?: string; active?: boolean; defaultDurationMinutes?: number; revision: number };
export type Collection = "patients" | "appointments" | "documents" | "templates" | "requests" | "workItems" | "providers" | "visitTypes" | "documentTypes";
export type PageInfo = { hasMore: boolean; nextCursor: string | null; limit: number; total: number };
export type PageResult<T> = { data: T[]; pagination: PageInfo };
export type PatientDetail = Patient & { appointments?: Appointment[]; documents?: Document[]; requests?: Request[]; pagination?: Partial<Record<Collection, PageInfo>> };
export type Today = { date: string; timeZone: string; summary: Record<string,number>; appointments: { items: Appointment[]; pagination: PageInfo }; workItems: { items: Work[]; pagination: PageInfo } };
export type Snapshot = { location: { id: string; name: string; timeZone: string }; timeZone: string; patients: Patient[]; appointments: Appointment[]; documents: Document[]; templates: Template[]; requests: Request[]; workItems: Work[]; providers: Catalog[]; visitTypes: Catalog[]; documentTypes: Catalog[]; summary: Record<string, number>; capabilities: Record<string, boolean>; asOf: string; pagination: Partial<Record<Collection, PageInfo>>; relatedPagination?: { documentVersions?: Record<string,PageInfo>; templateVersions?: Record<string,PageInfo> } };
export const readable = (value?: string | null, locale: Locale = "en") => { const key = `mobile.status.${value || "pending"}`; return translate(locale, Object.hasOwn(catalogs.en,key) ? key : "mobile.status.other"); };
export function displayTime(value: string | undefined, zone: string, locale: Locale = "en") {
  if (!value) return translate(locale,"mobile.date.noDue");
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? translate(locale,"mobile.date.unavailable") : new Intl.DateTimeFormat(locale, { timeZone: zone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}
export function allowedStatusTransitions(status: string): string[] {
  return ({ scheduled: ["confirmed", "checked_in", "no_show"], confirmed: ["checked_in", "no_show"], checked_in: ["in_progress"], in_progress: ["completed"] } as Record<string, string[]>)[status] ?? [];
}

export const collectionPaths: Record<Collection,string> = { patients:"patients",appointments:"appointments",documents:"documents",templates:"templates",requests:"requests",workItems:"work-items",providers:"providers",visitTypes:"visit-types",documentTypes:"document-types" };
export function mergeWorkflowRows<T extends {id:string}>(existing:T[],incoming:T[]):T[] {return [...new Map([...existing,...incoming].map(row=>[row.id,row])).values()];}
export function locationDate(date:Date,zone:string):string {const parts=new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);return ["year","month","day"].map(key=>parts.find(part=>part.type===key)?.value).join("-");}
export function templateAnswers(fields:NonNullable<TemplateVersion["fieldSchema"]>,values:Record<string,string>) {return Object.fromEntries(fields.filter(field=>!field.type.includes("signature")).map(field=>[field.key,field.type==="checkbox"?values[field.key]==="true":values[field.key]??""]));}

export function activityLabel(action:string,locale:Locale="en") {const key=`access.audit.action.${action}`;return translate(locale,Object.hasOwn(catalogs.en,key)?key:"mobile.activity.generic");}
