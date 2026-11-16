import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import { ReleaseCheckError } from './migration-safety.js';
import {
  managedHelperFunctions,
  managedHelperPolicies,
  managedHelperRoleNames,
  managedHelperRoles,
} from './managed-owner-policy.js';

type CatalogClient = Pick<PoolClient, 'query'>;
type Grant = { role: string; object: string; privilege: string; grantable: boolean };
export type ManagedPolicyRow = {
  relation: string;
  name: string;
  command: string;
  roles: string[];
  permissive: string;
  using: string | null;
  check: string | null;
};
const normalize = (value: string | null) => value?.replace(/\s+/g, ' ').trim() ?? null;
const canonicalSignature = (signature: string) => signature.replace(/,\s*/g, ',');
const reviewedBodies = new Map(
  managedHelperFunctions.map((fn) => {
    const name = fn.signature.split('(')[0]!;
    const source = readFileSync(
      new URL(`../../drizzle/${fn.sourceMigration}`, import.meta.url),
      'utf8',
    );
    const escaped = name.replaceAll('.', '\\.');
    const definition = new RegExp(
      `CREATE (?:OR REPLACE )?FUNCTION ${escaped}\\([\\s\\S]*?RETURNS (\\w+) LANGUAGE (\\w+)[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`,
    ).exec(source);
    if (!definition) {
      throw new Error(`Reviewed helper definition missing: ${name}`);
    }
    return [fn.signature, { result: definition[1], language: definition[2], body: definition[3] }];
  }),
);

function requireExactGrants(actual: Grant[], expected: Grant[], boundary: string) {
  const key = (grant: Grant) =>
    `${grant.role}|${grant.object}|${grant.privilege}|${grant.grantable}`;
  const wanted = new Set(expected.map(key));
  const received = new Set(actual.map(key));
  if (
    actual.length !== received.size ||
    received.size !== wanted.size ||
    [...received].some((grant) => !wanted.has(grant))
  ) {
    throw new ReleaseCheckError(
      `Managed helper ${boundary} grants differ from the reviewed repair.`,
    );
  }
}

/** Returns true only after checking every field of a known private helper policy. */
export function isReviewedManagedHelperPolicy(actual: ManagedPolicyRow) {
  const expected = managedHelperPolicies.find(
    (policy) => policy.relation === actual.relation && policy.name === actual.name,
  );
  if (!expected) {
    return false;
  }
  if (
    actual.command !== expected.command ||
    actual.permissive !== 'PERMISSIVE' ||
    actual.roles.join() !== expected.role ||
    normalize(actual.using) !== normalize(expected.using) ||
    normalize(actual.check) !== normalize(expected.check)
  ) {
    throw new ReleaseCheckError(
      `Managed helper row-level security policy ${actual.relation}.${actual.name} differs from the reviewed repair.`,
    );
  }
  return true;
}

async function verifyRoles(client: CatalogClient) {
  const roles = (
    await client.query<{
      name: string;
      privileged: boolean;
      reachable: boolean;
      can_create: boolean;
    }>(
      `/* managed_helper_roles */ SELECT r.rolname AS name,
    r.rolcanlogin OR r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolinherit AS privileged,
    pg_has_role(current_user,r.oid,'MEMBER') OR pg_has_role('careiq_clinical_runtime',r.oid,'MEMBER') AS reachable,
    has_database_privilege(r.oid,current_database(),'CREATE') OR
      EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname !~ '^pg_temp_' AND n.nspname !~ '^pg_toast_temp_' AND has_schema_privilege(r.oid,n.oid,'CREATE')) AS can_create
    FROM pg_roles r WHERE r.rolname=ANY($1::text[])`,
      [managedHelperRoleNames],
    )
  ).rows;
  if (
    roles.length !== managedHelperRoleNames.length ||
    roles.some((role) => role.privileged || role.reachable || role.can_create)
  ) {
    throw new ReleaseCheckError(
      'Managed helper roles must remain private, nonprivileged and unavailable to runtime identities.',
    );
  }
  const memberships = (
    await client.query<{ safe: boolean }>(
      `/* managed_helper_memberships */
    SELECT m.roleid=ANY(SELECT oid FROM pg_roles WHERE rolname=ANY($1::text[]))
      AND m.member=(SELECT relowner FROM pg_class WHERE oid='public.patients'::regclass)
      AND NOT m.inherit_option AND NOT m.set_option AS safe
    FROM pg_auth_members m WHERE m.roleid=ANY(SELECT oid FROM pg_roles WHERE rolname=ANY($1::text[]))
      OR m.member=ANY(SELECT oid FROM pg_roles WHERE rolname=ANY($1::text[]))`,
      [managedHelperRoleNames],
    )
  ).rows;
  if (memberships.some((membership) => !membership.safe)) {
    throw new ReleaseCheckError(
      'Managed helper memberships permit unreviewed inheritance, administration or SET ROLE.',
    );
  }
  const ownership = (
    await client.query<{ unsafe: boolean }>(
      `/* managed_helper_ownership */ SELECT EXISTS(
    SELECT 1 FROM pg_shdepend ownership JOIN pg_roles role ON role.oid=ownership.refobjid
    WHERE ownership.refclassid='pg_authid'::regclass AND ownership.deptype='o'
      AND role.rolname=ANY($1::text[])
      AND NOT (ownership.classid='pg_proc'::regclass
        AND ownership.dbid=(SELECT oid FROM pg_database WHERE datname=current_database())
        AND ownership.objid=ANY(SELECT to_regprocedure(signature)::oid FROM unnest($2::text[]) reviewed(signature)))
    ) AS unsafe`,
      [managedHelperRoleNames, managedHelperFunctions.map((fn) => fn.signature)],
    )
  ).rows[0];
  if (!ownership || ownership.unsafe) {
    throw new ReleaseCheckError('Managed helpers must own only their reviewed functions.');
  }
}

async function verifyGrants(client: CatalogClient) {
  const tableGrants = (
    await client.query<Grant>(
      `/* managed_helper_table_grants */
    SELECT r.rolname AS role,n.nspname||'.'||c.relname AS object,a.privilege_type AS privilege,a.is_grantable AS grantable
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a
    JOIN pg_roles r ON r.oid=a.grantee WHERE r.rolname=ANY($1::text[])`,
      [managedHelperRoleNames],
    )
  ).rows;
  requireExactGrants(
    tableGrants,
    managedHelperRoles.flatMap((role) =>
      Object.entries(role.tables).flatMap(([object, privileges]) =>
        privileges.map((privilege) => ({ role: role.name, object, privilege, grantable: false })),
      ),
    ),
    'table',
  );
  const columnGrants = (
    await client.query<Grant>(
      `/* managed_helper_column_grants */
    SELECT r.rolname AS role,n.nspname||'.'||c.relname||'.'||att.attname AS object,a.privilege_type AS privilege,a.is_grantable AS grantable
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute att ON att.attrelid=c.oid
    CROSS JOIN LATERAL aclexplode(att.attacl) a JOIN pg_roles r ON r.oid=a.grantee WHERE r.rolname=ANY($1::text[])`,
      [managedHelperRoleNames],
    )
  ).rows;
  requireExactGrants(
    columnGrants,
    managedHelperRoles.flatMap((role) =>
      Object.entries(role.columns).flatMap(([table, privileges]) =>
        Object.entries(privileges).flatMap(([privilege, columns]) =>
          columns.map((column) => ({
            role: role.name,
            object: `${table}.${column}`,
            privilege,
            grantable: false,
          })),
        ),
      ),
    ),
    'column',
  );
  const schemaGrants = (
    await client.query<Grant>(
      `/* managed_helper_schema_grants */
    SELECT r.rolname AS role,n.nspname AS object,a.privilege_type AS privilege,a.is_grantable AS grantable
    FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a JOIN pg_roles r ON r.oid=a.grantee WHERE r.rolname=ANY($1::text[])`,
      [managedHelperRoleNames],
    )
  ).rows;
  requireExactGrants(
    schemaGrants,
    managedHelperRoles.flatMap((role) =>
      role.schemas.map((object) => ({
        role: role.name,
        object,
        privilege: 'USAGE',
        grantable: false,
      })),
    ),
    'schema',
  );
  const effectiveSchemas = (
    await client.query<{ role: string; schema: string; can_use: boolean }>(
      `/* managed_helper_effective_schemas */
    SELECT r.rolname AS role,n.nspname AS schema,has_schema_privilege(r.oid,n.oid,'USAGE') AS can_use
    FROM pg_roles r CROSS JOIN pg_namespace n WHERE r.rolname=ANY($1::text[])
      AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'`,
      [managedHelperRoleNames],
    )
  ).rows;
  if (
    !effectiveSchemas.length ||
    effectiveSchemas.some(
      (row) =>
        row.can_use !==
        managedHelperRoles.find((role) => role.name === row.role)!.schemas.includes(row.schema),
    )
  ) {
    throw new ReleaseCheckError(
      'Managed helper effective schema privileges differ from the reviewed repair.',
    );
  }
  const databaseGrants = (
    await client.query<Grant>(
      `/* managed_helper_database_grants */
    SELECT r.rolname AS role,d.datname AS object,a.privilege_type AS privilege,a.is_grantable AS grantable
    FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a JOIN pg_roles r ON r.oid=a.grantee WHERE r.rolname=ANY($1::text[])`,
      [managedHelperRoleNames],
    )
  ).rows;
  requireExactGrants(databaseGrants, [], 'database');
  const functionGrants = (
    await client.query<Grant>(
      `/* managed_helper_function_grants */
    SELECT r.rolname AS role,n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' AS object,
      a.privilege_type AS privilege,a.is_grantable AS grantable
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(p.proacl) a
    JOIN pg_roles r ON r.oid=a.grantee WHERE r.rolname=ANY($1::text[])`,
      [managedHelperRoleNames],
    )
  ).rows;
  requireExactGrants(
    functionGrants.map((grant) => ({ ...grant, object: canonicalSignature(grant.object) })),
    managedHelperRoles.flatMap((role) =>
      role.execute.map((object) => ({
        role: role.name,
        object: canonicalSignature(object),
        privilege: 'EXECUTE',
        grantable: false,
      })),
    ),
    'function',
  );

  // Explicit ACL comparison alone misses PUBLIC grants; compare effective table/column
  // privileges too. Roles have no parent memberships, as verified above.
  const effective = (
    await client.query<{
      role: string;
      relation: string;
      column: string;
      select: boolean;
      insert: boolean;
      update: boolean;
      references: boolean;
      excessive: boolean;
    }>(
      `/* managed_helper_effective_grants */ SELECT r.rolname AS role,n.nspname||'.'||c.relname AS relation,att.attname AS column,
    has_column_privilege(r.oid,c.oid,att.attnum,'SELECT') AS select,has_column_privilege(r.oid,c.oid,att.attnum,'INSERT') AS insert,
    has_column_privilege(r.oid,c.oid,att.attnum,'UPDATE') AS update,has_column_privilege(r.oid,c.oid,att.attnum,'REFERENCES') AS references,
    has_table_privilege(r.oid,c.oid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN') AS excessive
    FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute att ON att.attrelid=c.oid
    WHERE r.rolname=ANY($1::text[]) AND n.nspname IN ('public','audit') AND c.relkind IN ('r','p','v','m','f') AND att.attnum>0 AND NOT att.attisdropped`,
      [managedHelperRoleNames],
    )
  ).rows;
  if (
    !effective.length ||
    effective.some((grant) => {
      const role = managedHelperRoles.find((candidate) => candidate.name === grant.role)!;
      const allowed = (privilege: string) =>
        role.tables[grant.relation]?.includes(privilege) ||
        role.columns[grant.relation]?.[privilege]?.includes(grant.column) ||
        false;
      return (
        grant.excessive ||
        grant.references ||
        grant.select !== allowed('SELECT') ||
        grant.insert !== allowed('INSERT') ||
        grant.update !== allowed('UPDATE')
      );
    })
  ) {
    throw new ReleaseCheckError(
      'Managed helper effective privileges exceed the reviewed projection.',
    );
  }
}

// PostgreSQL's canonical forms of the DEFAULT clauses in the checked source SQL.
const reviewedDefaults: Record<string, [number, string]> = {
  'public.careiq_resolve_patient_access(text,boolean)': [1, 'true'],
  'public.careiq_portal_paperwork(uuid,boolean,timestamp with time zone,uuid)': [
    4,
    'NULL::uuid, false, NULL::timestamp with time zone, NULL::uuid',
  ],
  'public.careiq_portal_communication_choices(uuid,jsonb,bigint,text,text,uuid,text)': [
    7,
    "NULL::uuid, NULL::jsonb, NULL::bigint, ''::text, ''::text, NULL::uuid, NULL::text",
  ],
  'audit.record_event(jsonb,jsonb,jsonb)': [2, "'[]'::jsonb, '[]'::jsonb"],
};

async function verifyFunctions(client: CatalogClient) {
  const signatures = managedHelperFunctions.map((fn) => fn.signature);
  const functions = (
    await client.query<{
      signature: string | null;
      owner: string;
      body: string;
      result: string;
      language: string;
      config: string[] | null;
      security_definer: boolean;
      returns_set: boolean;
      strict: boolean;
      leakproof: boolean;
      kind: string;
      volatility: string;
      parallel: string;
      default_count: number;
      defaults: string | null;
    }>(
      `/* managed_helper_functions */ SELECT expected.signature,r.rolname AS owner,p.prosrc AS body,format_type(p.prorettype,NULL) AS result,
    l.lanname AS language,p.proconfig AS config,p.prosecdef AS security_definer,p.proretset AS returns_set,p.proisstrict AS strict,
    p.proleakproof AS leakproof,p.prokind AS kind,p.provolatile AS volatility,p.proparallel AS parallel,
    p.pronargdefaults AS default_count,pg_get_expr(p.proargdefaults,0) AS defaults
    FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner JOIN pg_language l ON l.oid=p.prolang
    LEFT JOIN unnest($1::text[]) expected(signature) ON p.oid=to_regprocedure(expected.signature)
    WHERE expected.signature IS NOT NULL OR r.rolname=ANY($2::text[])`,
      [signatures, managedHelperRoleNames],
    )
  ).rows;
  if (
    functions.length !== managedHelperFunctions.length ||
    functions.some((actual) => {
      const expected = managedHelperFunctions.find((fn) => fn.signature === actual.signature);
      const source = expected && reviewedBodies.get(expected.signature);
      return (
        !expected ||
        !source ||
        actual.owner !== expected.owner ||
        actual.body !== source.body ||
        actual.default_count !== (reviewedDefaults[expected.signature]?.[0] ?? 0) ||
        actual.defaults !== (reviewedDefaults[expected.signature]?.[1] ?? null) ||
        actual.result !== source.result ||
        actual.language !== source.language ||
        !actual.security_definer ||
        actual.returns_set ||
        actual.strict ||
        actual.leakproof ||
        actual.kind !== 'f' ||
        actual.volatility !== 'v' ||
        actual.parallel !== 'u' ||
        actual.config?.length !== 1 ||
        actual.config[0] !== 'search_path=pg_catalog, public, pg_temp'
      );
    })
  ) {
    throw new ReleaseCheckError(
      'Managed helper function definitions or ownership differ from the reviewed repair.',
    );
  }
  const migrator = (
    await client.query<{ owner: string }>(
      `SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid='public.patients'::regclass`,
    )
  ).rows[0]?.owner;
  if (!migrator || managedHelperRoleNames.includes(migrator)) {
    throw new ReleaseCheckError('Managed helper migration owner is invalid.');
  }
  const callers = (
    await client.query<Grant>(
      `/* managed_helper_callers */
    SELECT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS role,expected.signature AS object,
      a.privilege_type AS privilege,a.is_grantable AS grantable
    FROM unnest($1::text[]) expected(signature) JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a`,
      [signatures],
    )
  ).rows;
  const expectedCallers = managedHelperFunctions.flatMap((fn) => [
    { role: fn.owner, object: fn.signature, privilege: 'EXECUTE', grantable: false },
    { role: migrator, object: fn.signature, privilege: 'EXECUTE', grantable: true },
    ...(fn.runtime
      ? [
          {
            role: 'careiq_clinical_runtime',
            object: fn.signature,
            privilege: 'EXECUTE',
            grantable: false,
          },
        ]
      : []),
    ...managedHelperRoles
      .filter((role) => role.name !== fn.owner && role.execute.includes(fn.signature))
      .map((role) => ({
        role: role.name,
        object: fn.signature,
        privilege: 'EXECUTE',
        grantable: false,
      })),
  ]);
  requireExactGrants(callers, expectedCallers, 'entry-point EXECUTE');
}

/** Read-only catalog validation; never reads clinical rows or changes a grant. */
export async function verifyManagedHelperOwnership(client: CatalogClient) {
  await verifyRoles(client);
  await verifyFunctions(client);
  await verifyGrants(client);
  const policies = (
    await client.query<ManagedPolicyRow>(
      `/* managed_helper_policies */
    SELECT schemaname||'.'||tablename AS relation,policyname AS name,cmd AS command,roles::text[],permissive,qual AS using,with_check AS check
    FROM pg_policies WHERE policyname LIKE 'managed_%' OR roles::text[] && $1::text[]`,
      [managedHelperRoleNames],
    )
  ).rows;
  if (
    policies.length !== managedHelperPolicies.length ||
    policies.some((policy) => !isReviewedManagedHelperPolicy(policy))
  ) {
    throw new ReleaseCheckError(
      'Managed helper policy inventory differs from the reviewed repair.',
    );
  }
  // Preserve historical RLS modes: audit tables enable RLS without FORCE because
  // their separate capture functions retain the table owner; new private helpers
  // never own those tables and are therefore still constrained by their policies.
  const protectedRelations = [...new Set(managedHelperPolicies.map((policy) => policy.relation))];
  const security = (
    await client.query<{ relation: string; enabled: boolean; forced: boolean }>(
      `/* managed_helper_forced_rls */
    SELECT names.relation,c.relrowsecurity AS enabled,c.relforcerowsecurity AS forced
    FROM unnest($1::text[]) names(relation) JOIN pg_class c ON c.oid=to_regclass(names.relation)`,
      [protectedRelations],
    )
  ).rows;
  if (
    security.length !== protectedRelations.length ||
    security.some(
      (row) =>
        row.enabled !== (row.relation !== 'public.practices') ||
        row.forced !== (row.relation.startsWith('public.') && row.relation !== 'public.practices'),
    )
  ) {
    throw new ReleaseCheckError(
      'Managed helper relations must retain their reviewed row-level security modes.',
    );
  }
}
