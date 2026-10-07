import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { practices } from "./practices.js";
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
export const locations = pgTable("locations", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`), practiceId: uuid("practice_id").notNull().references(() => practices.id),
  name: text("name").notNull(), timeZone: text("time_zone").notNull(), address: text("address"), status: text("status").notNull().default("active"),
  createdAt: created(), updatedAt: updated(),
}, (t) => [unique("locations_id_practice_id_key").on(t.id,t.practiceId), check("locations_name_check",sql`length(btrim(${t.name})) BETWEEN 1 AND 120`),check("locations_status_check",sql`${t.status} IN ('active','closed')`)]);
export const practiceMemberAccess = pgTable("practice_member_access", {
  practiceId: uuid("practice_id").notNull().references(() => practices.id),userId:text("user_id").notNull(),membershipId:text("membership_id").notNull(),status:text("status").notNull(),reviewToken:uuid("review_token"),updatedAt:updated(),
},(t)=>[primaryKey({name:"practice_member_access_pkey",columns:[t.practiceId,t.userId]}),unique("practice_member_access_practice_id_membership_id_key").on(t.practiceId,t.membershipId),check("practice_member_access_status_check",sql`${t.status} IN ('pending_assignment','active','suspended','revoked')`)]);
export const locationAssignments=pgTable("location_assignments",{
 practiceId:uuid("practice_id").notNull(),userId:text("user_id").notNull(),locationId:uuid("location_id").notNull(),active:boolean("active").notNull().default(false),grantedBy:text("granted_by").notNull(),updatedAt:updated(),
},(t)=>[primaryKey({name:"location_assignments_pkey",columns:[t.practiceId,t.userId,t.locationId]}),foreignKey({name:"location_assignments_practice_id_user_id_fkey",columns:[t.practiceId,t.userId],foreignColumns:[practiceMemberAccess.practiceId,practiceMemberAccess.userId]}),foreignKey({name:"location_assignments_location_id_practice_id_fkey",columns:[t.locationId,t.practiceId],foreignColumns:[locations.id,locations.practiceId]})]);
export const practiceInvitations=pgTable("practice_invitations",{
 id:uuid("id").primaryKey().default(sql`uuidv7()`),practiceId:uuid("practice_id").notNull().references(()=>practices.id),actorUserId:text("actor_user_id").notNull(),requestKey:uuid("request_key").notNull(),requestHash:text("request_hash").notNull(),email:text("email").notNull(),role:text("role").notNull(),locationIds:uuid("location_ids").array().notNull().default(sql`'{}'`),clerkInvitationId:text("clerk_invitation_id").unique("practice_invitations_clerk_invitation_id_key"),status:text("status").notNull(),providerRevocationPending:boolean("provider_revocation_pending").notNull().default(false),acceptedUserId:text("accepted_user_id"),expiresAt:timestamp("expires_at",{withTimezone:true}),createdAt:created(),updatedAt:updated(),
},(t)=>[unique("practice_invitations_practice_id_actor_user_id_request_key_key").on(t.practiceId,t.actorUserId,t.requestKey),uniqueIndex("practice_invitation_outstanding_recipient").on(t.practiceId,t.email).where(sql`${t.status} IN ('sending','invited')`),check("practice_invitations_status_check",sql`${t.status} IN ('sending','invited','accepted','revoked','expired')`)]);
export const practiceInvitationAttempts=pgTable("practice_invitation_attempts",{
 invitationId:uuid("invitation_id").primaryKey().references(()=>practiceInvitations.id),practiceId:uuid("practice_id").notNull().references(()=>practices.id),sent:boolean("sent").notNull().default(false),attemptedAt:timestamp("attempted_at",{withTimezone:true}).notNull().defaultNow(),
});
export const practiceOnboarding=pgTable("practice_onboarding",{
 actorUserId:text("actor_user_id").primaryKey(),requestKey:uuid("request_key").notNull(),requestHash:text("request_hash").notNull(),id:uuid("id").notNull().unique("practice_onboarding_id_key").default(sql`uuidv7()`),clerkOrgId:text("clerk_org_id"),practiceId:uuid("practice_id").references(()=>practices.id),status:text("status").notNull().default("pending"),createdAt:created(),
},t=>[check("practice_onboarding_status_check",sql`${t.status} IN ('pending','complete')`)]);
export const practiceAdminEvents=pgTable("practice_admin_events",{
 id:uuid("id").primaryKey().default(sql`uuidv7()`),practiceId:uuid("practice_id").notNull().references(()=>practices.id),actorUserId:text("actor_user_id").notNull(),action:text("action").notNull(),subjectId:text("subject_id"),occurredAt:timestamp("occurred_at",{withTimezone:true}).notNull().defaultNow(),
});
export const practiceProviderEvents=pgTable("practice_provider_events",{
 eventId:text("event_id").notNull(),practiceId:uuid("practice_id").notNull().references(()=>practices.id),processedAt:timestamp("processed_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[primaryKey({name:"practice_provider_events_pkey",columns:[t.practiceId,t.eventId]})]);
