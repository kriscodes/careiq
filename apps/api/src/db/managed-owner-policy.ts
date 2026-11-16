/** Reviewed ownership repair: keep this inventory explicit and checked against PostgreSQL. */
export interface ManagedHelperRole {
  name: string;
  schemas: string[];
  tables: Record<string, string[]>;
  columns: Record<string, Record<string, string[]>>;
  execute: string[];
}
export interface ManagedHelperPolicy {
  relation: string;
  name: string;
  command: string;
  role: string;
  using: string | null;
  check: string | null;
}
export const managedHelperRoles: ManagedHelperRole[] = [
  {
    name: 'careiq_token_lookup',
    schemas: ['public', 'audit'],
    tables: {
      'audit.event_resources': ['INSERT'],
      'audit.events': ['INSERT'],
      'public.workflow_operations': ['SELECT'],
      'public.workflow_request_keys': ['SELECT'],
    },
    columns: {
      'audit.events': {
        SELECT: ['id'],
      },
      'public.document_requests': {
        SELECT: [
          'expires_at',
          'id',
          'location_id',
          'patient_id',
          'practice_id',
          'purpose',
          'revision',
          'state',
        ],
      },
      'public.locations': {
        SELECT: ['id', 'practice_id', 'status'],
      },
      'public.patient_access_grants': {
        SELECT: [
          'consumed_at',
          'expires_at',
          'id',
          'location_id',
          'patient_id',
          'practice_id',
          'request_id',
          'revoked_at',
          'token_hash',
        ],
      },
      'public.patient_sessions': {
        SELECT: [
          'expires_at',
          'grant_id',
          'id',
          'location_id',
          'patient_id',
          'practice_id',
          'request_id',
          'request_revision',
          'revoked_at',
          'token_hash',
        ],
      },
      'public.practices': {
        SELECT: ['id', 'status'],
      },
    },
    execute: [
      'public.careiq_patient_command_receipt(text,text)',
      'public.careiq_patient_completion_receipt(text)',
      'public.careiq_resolve_patient_access(text,boolean)',
    ],
  },
  {
    name: 'careiq_portal_operator',
    schemas: ['public', 'audit'],
    tables: {
      'audit.event_resources': ['INSERT'],
      'audit.events': ['INSERT'],
      'public.communication_endpoints': ['SELECT'],
      'public.communication_permission_events': ['INSERT', 'SELECT'],
      'public.destination_suppression_releases': ['SELECT'],
      'public.destination_suppressions': ['SELECT'],
      'public.location_assignments': ['SELECT'],
      'public.locations': ['SELECT'],
      'public.paperwork_library_items': ['SELECT'],
      'public.patient_portal_grants': ['SELECT'],
      'public.portal_communication_profiles': ['INSERT', 'SELECT'],
      'public.portal_communication_request_keys': ['INSERT', 'SELECT'],
      'public.practice_member_access': ['SELECT'],
      'public.practices': ['SELECT'],
    },
    columns: {
      'audit.events': {
        SELECT: ['id'],
      },
      'public.communication_endpoints': {
        UPDATE: ['id'],
      },
      'public.file_objects': {
        SELECT: [
          'detected_media_type',
          'id',
          'location_id',
          'original_filename',
          'patient_id',
          'practice_id',
          'sha256',
          'status',
          'storage_key',
        ],
      },
      'public.patient_portal_grants': {
        UPDATE: ['id'],
      },
      'public.patients': {
        SELECT: ['archived_at', 'date_of_birth', 'id', 'location_id', 'practice_id'],
        UPDATE: ['id'],
      },
      'public.portal_communication_profiles': {
        UPDATE: ['revision', 'updated_at'],
      },
    },
    execute: [
      'audit.capture_mutation()',
      'audit.record_event(jsonb,jsonb,jsonb)',
      'public.careiq_adult_self_eligible_at(date,text,timestamp with time zone)',
      'public.careiq_communication_profile_changed()',
      'public.careiq_portal_communication_choices(uuid,jsonb,bigint,text,text,uuid,text)',
      'public.careiq_portal_paperwork(uuid,boolean,timestamp with time zone,uuid)',
      'public.careiq_resolve_patient_access(text,boolean)',
    ],
  },
  {
    name: 'careiq_patient_operator',
    schemas: ['public', 'audit'],
    tables: {
      'public.appointments': ['SELECT'],
      'public.communication_endpoints': ['SELECT'],
      'public.communication_permission_events': ['SELECT'],
      'public.document_request_items': ['SELECT', 'UPDATE'],
      'public.document_requests': ['SELECT', 'UPDATE'],
      'public.document_reviews': ['SELECT'],
      'public.document_versions': ['SELECT'],
      'public.location_assignments': ['SELECT'],
      'public.locations': ['SELECT'],
      'public.outbox_events': ['INSERT', 'SELECT'],
      'public.paperwork_library_items': ['INSERT', 'SELECT'],
      'public.paperwork_notifications': ['INSERT', 'SELECT'],
      'public.patient_portal_grants': ['SELECT'],
      'public.practice_member_access': ['SELECT'],
      'public.practices': ['SELECT'],
      'public.prepared_documents': ['SELECT'],
      'public.requirement_evidence': ['INSERT', 'SELECT', 'UPDATE'],
      'public.signature_packets': ['SELECT'],
      'public.visit_requirements': ['SELECT', 'UPDATE'],
      'public.work_items': ['INSERT', 'SELECT', 'UPDATE'],
    },
    columns: {
      'public.documents': {
        SELECT: [
          'archived_at',
          'document_type_id',
          'id',
          'location_id',
          'patient_id',
          'practice_id',
          'title',
        ],
      },
      'public.file_objects': {
        SELECT: [
          'id',
          'location_id',
          'patient_id',
          'practice_id',
          'sha256',
          'status',
          'storage_key',
          'verified_at',
        ],
      },
      'public.patients': {
        SELECT: ['archived_at', 'date_of_birth', 'id', 'location_id', 'practice_id'],
        UPDATE: ['id'],
      },
      'public.template_versions': {
        SELECT: ['form_schema', 'id', 'practice_id', 'schema_version'],
      },
    },
    execute: [
      'audit.record_event(jsonb,jsonb,jsonb)',
      'public.careiq_adult_self_eligible_at(date,text,timestamp with time zone)',
      'public.careiq_form_completion_guard()',
      'public.careiq_form_signer_authorized(uuid)',
      'public.careiq_patient_close_request(text)',
      'public.careiq_patient_form_scope(uuid)',
      'public.careiq_patient_fulfill_item(uuid,uuid)',
      'public.careiq_patient_scope(text,jsonb)',
      'public.careiq_publish_completed_paperwork(uuid,uuid,boolean)',
      'public.careiq_resolve_patient_access(text,boolean)',
      'public.careiq_workflow_practice_scope(uuid)',
    ],
  },
  {
    name: 'careiq_patient_audit_writer',
    schemas: ['public', 'audit'],
    tables: {
      'audit.changes': ['INSERT'],
      'audit.event_resources': ['INSERT'],
      'audit.events': ['INSERT'],
      'public.location_assignments': ['SELECT'],
      'public.locations': ['SELECT'],
      'public.practice_member_access': ['SELECT'],
      'public.practices': ['SELECT'],
    },
    columns: {
      'public.patients': {
        SELECT: ['id', 'location_id', 'practice_id'],
      },
    },
    execute: [
      'audit.record_event(jsonb,jsonb,jsonb)',
      'public.careiq_resolve_patient_access(text,boolean)',
    ],
  },
  {
    name: 'careiq_suppression_reader',
    schemas: ['public'],
    tables: {
      'public.destination_suppression_releases': ['SELECT'],
      'public.destination_suppressions': ['SELECT'],
      'public.location_assignments': ['SELECT'],
      'public.locations': ['SELECT'],
      'public.practice_member_access': ['SELECT'],
      'public.practices': ['SELECT'],
    },
    columns: {},
    execute: [
      'public.careiq_delivery_destination_suppressed(text,text,text)',
      'public.careiq_resolve_patient_access(text,boolean)',
    ],
  },
];
export const managedHelperFunctions = [
  {
    signature: 'audit.record_event(jsonb,jsonb,jsonb)',
    owner: 'careiq_patient_audit_writer',
    sourceMigration: '0023_workflow-context-guards.sql',
    runtime: true,
  },
  {
    signature: 'public.careiq_form_completion_guard()',
    owner: 'careiq_patient_operator',
    sourceMigration: '0028_patient-paperwork.sql',
    runtime: false,
  },
  {
    signature: 'public.careiq_form_signer_authorized(uuid)',
    owner: 'careiq_patient_operator',
    sourceMigration: '0032_location-calendar-eligibility.sql',
    runtime: true,
  },
  {
    signature: 'public.careiq_patient_close_request(text)',
    owner: 'careiq_patient_operator',
    sourceMigration: '0022_workflow-patient-collection.sql',
    runtime: true,
  },
  {
    signature: 'public.careiq_patient_fulfill_item(uuid,uuid)',
    owner: 'careiq_patient_operator',
    sourceMigration: '0033_patient-fulfillment-purpose.sql',
    runtime: true,
  },
  {
    signature: 'public.careiq_publish_completed_paperwork(uuid,uuid,boolean)',
    owner: 'careiq_patient_operator',
    sourceMigration: '0042_paperwork_publication_permission.sql',
    runtime: true,
  },
  {
    signature: 'public.careiq_communication_profile_changed()',
    owner: 'careiq_portal_operator',
    sourceMigration: '0041_patient_communication_preferences.sql',
    runtime: false,
  },
  {
    signature: 'public.careiq_portal_communication_choices(uuid,jsonb,bigint,text,text,uuid,text)',
    owner: 'careiq_portal_operator',
    sourceMigration: '0041_patient_communication_preferences.sql',
    runtime: true,
  },
  {
    signature: 'public.careiq_portal_paperwork(uuid,boolean,timestamp with time zone,uuid)',
    owner: 'careiq_portal_operator',
    sourceMigration: '0032_location-calendar-eligibility.sql',
    runtime: true,
  },
  {
    signature: 'public.careiq_delivery_destination_suppressed(text,text,text)',
    owner: 'careiq_suppression_reader',
    sourceMigration: '0039_notification_delivery.sql',
    runtime: true,
  },
  {
    signature: 'public.careiq_patient_command_receipt(text,text)',
    owner: 'careiq_token_lookup',
    sourceMigration: '0034_patient-request-link-audit.sql',
    runtime: true,
  },
  {
    signature: 'public.careiq_patient_completion_receipt(text)',
    owner: 'careiq_token_lookup',
    sourceMigration: '0034_patient-request-link-audit.sql',
    runtime: true,
  },
  {
    signature: 'public.careiq_resolve_patient_access(text,boolean)',
    owner: 'careiq_token_lookup',
    sourceMigration: '0019_workflow-foundation.sql',
    runtime: true,
  },
];
/** Expressions match PostgreSQL's stored predicates; repeated table scopes stay readable. */
export const managedHelperPolicies: ManagedHelperPolicy[] = [];
function privatePolicy(
  role: string,
  name: string,
  command: string,
  relations: string[],
  using: string | null,
  check: string | null,
) {
  for (const relation of relations) {
    managedHelperPolicies.push({ relation, name, command, role, using, check });
  }
}
privatePolicy(
  'careiq_token_lookup',
  'managed_receipt_resources_insert',
  'INSERT',
  ['audit.event_resources'],
  null,
  'true',
);
privatePolicy(
  'careiq_token_lookup',
  'managed_receipt_audit_insert',
  'INSERT',
  ['audit.events'],
  null,
  `((actor_type = 'patient_session'::text)
    AND ((action)::text = ANY (ARRAY[('signatures.completion.receipt_access'::character varying)::text, ('patient_commands.receipt_access'::character varying)::text])))`,
);
privatePolicy(
  'careiq_token_lookup',
  'managed_receipt_audit_returning',
  'SELECT',
  ['audit.events'],
  `((actor_type = 'patient_session'::text)
    AND ((action)::text = ANY (ARRAY[('signatures.completion.receipt_access'::character varying)::text, ('patient_commands.receipt_access'::character varying)::text])))`,
  null,
);
privatePolicy(
  'careiq_token_lookup',
  'managed_token_lookup',
  'SELECT',
  [
    'public.document_requests',
    'public.locations',
    'public.patient_access_grants',
    'public.patient_sessions',
    'public.practices',
  ],
  'true',
  null,
);
privatePolicy(
  'careiq_token_lookup',
  'managed_token_receipts',
  'SELECT',
  ['public.workflow_operations', 'public.workflow_request_keys'],
  'true',
  null,
);
privatePolicy(
  'careiq_portal_operator',
  'managed_portal_resources_insert',
  'INSERT',
  ['audit.event_resources'],
  null,
  'true',
);
privatePolicy(
  'careiq_portal_operator',
  'managed_portal_audit_insert',
  'INSERT',
  ['audit.events'],
  null,
  "((actor_id = current_setting('app.portal_subject'::text, true)) AND (actor_type = 'user'::text))",
);
privatePolicy(
  'careiq_portal_operator',
  'managed_portal_audit_returning',
  'SELECT',
  ['audit.events'],
  "((actor_id = current_setting('app.portal_subject'::text, true)) AND (actor_type = 'user'::text))",
  null,
);
privatePolicy(
  'careiq_portal_operator',
  'managed_portal_lock',
  'UPDATE',
  ['public.communication_endpoints', 'public.patient_portal_grants', 'public.patients'],
  'true',
  'false',
);
privatePolicy(
  'careiq_portal_operator',
  'managed_portal_select',
  'SELECT',
  [
    'public.communication_endpoints',
    'public.communication_permission_events',
    'public.destination_suppression_releases',
    'public.destination_suppressions',
    'public.file_objects',
    'public.locations',
    'public.paperwork_library_items',
    'public.patient_portal_grants',
    'public.patients',
    'public.portal_communication_profiles',
    'public.portal_communication_request_keys',
    'public.practices',
  ],
  'true',
  null,
);
privatePolicy(
  'careiq_portal_operator',
  'managed_portal_consent_insert',
  'INSERT',
  ['public.communication_permission_events'],
  null,
  "((source = 'patient_portal'::text) AND (actor_user_id = current_setting('app.portal_subject'::text, true)))",
);
privatePolicy(
  'careiq_portal_operator',
  'managed_portal_profile_insert',
  'INSERT',
  ['public.portal_communication_profiles'],
  null,
  `(EXISTS ( SELECT 1
  FROM patient_portal_grants g
  WHERE ((g.id = portal_communication_profiles.grant_id)
    AND (g.patient_id = portal_communication_profiles.patient_id)
    AND (g.practice_id = portal_communication_profiles.practice_id)
    AND (g.location_id = portal_communication_profiles.location_id)
    AND (g.clerk_user_id = current_setting('app.portal_subject'::text, true))
    AND (g.revoked_at IS NULL)
    AND (g.expires_at > now()))))`,
);
privatePolicy(
  'careiq_portal_operator',
  'managed_portal_profile_update',
  'UPDATE',
  ['public.portal_communication_profiles'],
  'true',
  'true',
);
privatePolicy(
  'careiq_portal_operator',
  'managed_portal_receipt_insert',
  'INSERT',
  ['public.portal_communication_request_keys'],
  null,
  'true',
);
privatePolicy(
  'careiq_patient_operator',
  'managed_patient_select',
  'SELECT',
  [
    'public.appointments',
    'public.communication_endpoints',
    'public.communication_permission_events',
    'public.document_request_items',
    'public.document_requests',
    'public.document_reviews',
    'public.document_versions',
    'public.documents',
    'public.file_objects',
    'public.outbox_events',
    'public.paperwork_library_items',
    'public.paperwork_notifications',
    'public.patient_portal_grants',
    'public.patients',
    'public.prepared_documents',
    'public.requirement_evidence',
    'public.signature_packets',
    'public.template_versions',
    'public.visit_requirements',
    'public.work_items',
  ],
  'true',
  null,
);
privatePolicy(
  'careiq_patient_operator',
  'managed_patient_lock',
  'UPDATE',
  ['public.patients'],
  'true',
  'false',
);
privatePolicy(
  'careiq_patient_audit_writer',
  'managed_event_change_insert',
  'INSERT',
  ['audit.changes'],
  null,
  'true',
);
privatePolicy(
  'careiq_patient_audit_writer',
  'managed_event_resource_insert',
  'INSERT',
  ['audit.event_resources'],
  null,
  'true',
);
privatePolicy(
  'careiq_patient_audit_writer',
  'managed_event_insert',
  'INSERT',
  ['audit.events'],
  null,
  'true',
);
privatePolicy(
  'careiq_suppression_reader',
  'managed_suppression_release_read',
  'SELECT',
  ['public.destination_suppression_releases'],
  'true',
  null,
);
privatePolicy(
  'careiq_suppression_reader',
  'managed_suppression_read',
  'SELECT',
  ['public.destination_suppressions'],
  'true',
  null,
);

function patientScope(table: string, patientColumn = 'patient_id', tokenField = 'patient_id') {
  return `(COALESCE((careiq_clinical_scope(practice_id, location_id)
    AND (location_id = careiq_context_uuid('app.location_id'::text))), false)
  OR (EXISTS ( SELECT 1
  FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
  WHERE ((((access.access ->> 'practice_id'::text))::uuid = ${table}.practice_id)
    AND (((access.access ->> 'location_id'::text))::uuid = ${table}.location_id)
    AND (((access.access ->> '${tokenField}'::text))::uuid = ${table}.${patientColumn})))))`;
}
for (const table of [
  'document_request_items',
  'document_requests',
  'outbox_events',
  'paperwork_library_items',
  'paperwork_notifications',
  'requirement_evidence',
  'visit_requirements',
  'work_items',
]) {
  const scope =
    table === 'outbox_events'
      ? patientScope(table, 'patient_request_id', 'request_id')
      : patientScope(table);
  privatePolicy(
    'careiq_patient_operator',
    'managed_patient_write',
    'ALL',
    [`public.${table}`],
    scope,
    scope,
  );
}
// Token actors may validate only their own patient; clinical actors keep established location scope.
privatePolicy(
  'careiq_patient_audit_writer',
  'managed_audit_patient_identity',
  'SELECT',
  ['public.patients'],
  patientScope('patients', 'id'),
  null,
);
export const managedHelperRoleNames = managedHelperRoles.map((role) => role.name);
