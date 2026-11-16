import type { PoolClient } from 'pg';
import { ReleaseCheckError } from './migration-safety.js';

const normalize = (value: unknown) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
const permissions = [
  'org:patients:read',
  'org:patients:create',
  'org:patients:update',
  'org:appointments:read',
  'org:appointments:create',
  'org:appointments:update',
  'org:documents:read',
  'org:documents:upload',
  'org:documents:review',
  'org:documents:archive',
  'org:requests:send',
  'org:requirements:waive',
  'org:requirements:manage',
  'org:work:manage',
  'org:workflow:configure',
  'org:paperwork:manage',
  'org:activity:read',
];
const mutable = ['disabled_permissions', 'all_locations', 'revision', 'updated_at'];
const columnTypes: Record<string, [string, string | null]> = {
  practice_id: ['uuid', null],
  owner_user_id: ['text', null],
  disabled_permissions: ['text[]', "'{}'::text[]"],
  all_locations: ['boolean', 'true'],
  revision: ['integer', '0'],
  updated_at: ['timestamp with time zone', 'now()'],
};

/** Catalog-only: owner preferences cannot widen actor/practice isolation or runtime grants. */
export async function verifyOwnerAccessDatabaseRelease(client: Pick<PoolClient, 'query'>) {
  const metadata = (
    await client.query(`/* owner_access_metadata */ SELECT c.relkind,c.relrowsecurity,c.relforcerowsecurity,
    pg_has_role(current_user,c.relowner,'MEMBER') AS owns,
    has_table_privilege(current_user,c.oid,'SELECT') AS can_select,has_table_privilege(current_user,c.oid,'INSERT') AS can_insert,
    has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS excessive,
    EXISTS(SELECT 1 FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=0) OR
      EXISTS(SELECT 1 FROM pg_attribute at CROSS JOIN LATERAL aclexplode(at.attacl) a WHERE at.attrelid=c.oid AND a.grantee=0) AS public_access
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='practice_owner_access'`)
  ).rows;
  if (
    metadata.length !== 1 ||
    metadata.some(
      (row) =>
        row.relkind !== 'r' ||
        !row.relrowsecurity ||
        !row.relforcerowsecurity ||
        row.owns ||
        !row.can_select ||
        !row.can_insert ||
        row.excessive ||
        row.public_access,
    )
  ) {
    throw new ReleaseCheckError(
      'Owner access runtime grants or forced row-level security differ from this release.',
    );
  }
  const columns = (
    await client.query(`/* owner_access_columns */ SELECT a.attname,a.attnotnull,format_type(a.atttypid,a.atttypmod) AS type,pg_get_expr(d.adbin,d.adrelid) AS default_value,
    has_column_privilege(current_user,a.attrelid,a.attnum,'INSERT') AS can_insert,
    has_column_privilege(current_user,a.attrelid,a.attnum,'UPDATE') AS can_update,
    has_column_privilege(current_user,a.attrelid,a.attnum,'REFERENCES') AS can_reference
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid='public.practice_owner_access'::regclass AND a.attnum>0 AND NOT a.attisdropped`)
  ).rows;
  if (
    columns.length !== 6 ||
    columns.some(
      (row) =>
        !Object.hasOwn(columnTypes, row.attname) ||
        !row.attnotnull ||
        row.type !== columnTypes[row.attname]![0] ||
        (row.default_value === null ? null : normalize(row.default_value)) !==
          columnTypes[row.attname]![1] ||
        !row.can_insert ||
        row.can_reference ||
        row.can_update !== mutable.includes(row.attname),
    )
  ) {
    throw new ReleaseCheckError(
      'Owner access columns, defaults or mutable grants differ from this release.',
    );
  }
  const policies = (
    await client.query(`/* owner_access_policies */ SELECT polname,polcmd,polpermissive,polroles=ARRAY[0::oid] AS public_role,
    pg_get_expr(polqual,polrelid) AS using_expression,pg_get_expr(polwithcheck,polrelid) AS check_expression FROM pg_policy WHERE polrelid='public.practice_owner_access'::regclass`)
  ).rows;
  const expression =
    "((practice_id = careiq_context_uuid('app.practice_id'::text)) AND (owner_user_id = NULLIF(current_setting('app.actor_user_id'::text, true), ''::text)))";
  if (
    policies.length !== 1 ||
    policies.some(
      (row) =>
        row.polname !== 'practice_owner_self' ||
        row.polcmd !== '*' ||
        !row.polpermissive ||
        !row.public_role ||
        normalize(row.using_expression) !== expression ||
        normalize(row.check_expression) !== expression,
    )
  ) {
    throw new ReleaseCheckError(
      'Owner access actor and practice policies differ from this release.',
    );
  }
  const constraints = (
    await client.query(
      `/* owner_access_constraints */ SELECT conname,convalidated,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.practice_owner_access'::regclass AND contype IN ('p','f','c')`,
    )
  ).rows;
  const expected: Record<string, string> = {
    practice_owner_access_pkey: 'PRIMARY KEY (practice_id, owner_user_id)',
    practice_owner_access_member_fk:
      'FOREIGN KEY (practice_id, owner_user_id) REFERENCES practice_member_access(practice_id, user_id) ON DELETE CASCADE',
    practice_owner_access_revision_check: 'CHECK ((revision >= 0))',
    practice_owner_access_permissions_check: `CHECK (((COALESCE(array_ndims(disabled_permissions), 1) = 1) AND (cardinality(disabled_permissions) <= 17) AND (array_position(disabled_permissions, NULL::text) IS NULL) AND (disabled_permissions <@ ARRAY[${permissions.map((value) => `'${value}'::text`).join(', ')}])))`,
  };
  if (
    constraints.length !== 4 ||
    constraints.some(
      (row) =>
        !row.convalidated ||
        !Object.hasOwn(expected, row.conname) ||
        normalize(row.definition) !== expected[row.conname],
    )
  ) {
    throw new ReleaseCheckError(
      'Owner access identity, restriction or revision constraints differ from this release.',
    );
  }
}
