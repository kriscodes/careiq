import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  integer,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { practiceMemberAccess } from './practice-access.js';

export const practiceOwnerAccess = pgTable(
  'practice_owner_access',
  {
    practiceId: uuid('practice_id').notNull(),
    ownerUserId: text('owner_user_id').notNull(),
    disabledPermissions: text('disabled_permissions')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    allLocations: boolean('all_locations').notNull().default(true),
    revision: integer('revision').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'practice_owner_access_pkey',
      columns: [table.practiceId, table.ownerUserId],
    }),
    foreignKey({
      name: 'practice_owner_access_member_fk',
      columns: [table.practiceId, table.ownerUserId],
      foreignColumns: [practiceMemberAccess.practiceId, practiceMemberAccess.userId],
    }).onDelete('cascade'),
    check('practice_owner_access_revision_check', sql`${table.revision} >= 0`),
    check(
      'practice_owner_access_permissions_check',
      sql`coalesce(array_ndims(${table.disabledPermissions}),1)=1 AND cardinality(${table.disabledPermissions}) <= 17 AND array_position(${table.disabledPermissions},NULL) IS NULL AND ${table.disabledPermissions} <@ ARRAY['org:patients:read','org:patients:create','org:patients:update','org:appointments:read','org:appointments:create','org:appointments:update','org:documents:read','org:documents:upload','org:documents:review','org:documents:archive','org:requests:send','org:requirements:waive','org:requirements:manage','org:work:manage','org:workflow:configure','org:paperwork:manage','org:activity:read']::text[]`,
    ),
    pgPolicy('practice_owner_self', {
      for: 'all',
      to: ['public'],
      using: sql`${table.practiceId}=careiq_context_uuid('app.practice_id') AND ${table.ownerUserId}=NULLIF(current_setting('app.actor_user_id',true),'')`,
      withCheck: sql`${table.practiceId}=careiq_context_uuid('app.practice_id') AND ${table.ownerUserId}=NULLIF(current_setting('app.actor_user_id',true),'')`,
    }),
  ],
).enableRLS();
