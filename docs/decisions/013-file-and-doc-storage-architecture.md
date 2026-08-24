````md id="8x2f1m"
# ADR-013: File and Document Storage Architecture

**Status:** Accepted

## Context

CareIQ will need to store and manage files and documents associated with healthcare practices, patients, providers, workflows, integrations, and future platform capabilities.

Examples may include:

- Intake forms.
- Referrals.
- Insurance documents.
- PDFs.
- Images.
- Attachments.
- Generated reports.
- Export files.
- Imported documents.
- Other patient or practice-related files.

CareIQ requires a storage architecture that preserves tenant isolation, access control, auditability, security, lifecycle management, and future scalability.

Large file contents should not be stored directly in PostgreSQL as ordinary relational data.

PostgreSQL is better suited to storing the metadata, relationships, ownership information, lifecycle state, and authorization context associated with files.

The actual file contents require durable private object storage.

The architecture must also remain consistent with previously established decisions involving:

- Multi-tenancy.
- PostgreSQL Row-Level Security.
- Authentication and authorization.
- Audit logging.
- Background jobs and asynchronous processing.
- Integration architecture.
- Sensitive data handling.

## Decision

CareIQ will use private object storage for file contents and PostgreSQL for file and document metadata.

PostgreSQL will remain the system of record for document identity, tenant ownership, domain relationships, lifecycle state, and storage references.

Object storage will contain the actual file bytes.

Files will be private by default and will not be publicly accessible unless a future explicitly approved requirement justifies public access.

The architecture will remain object-storage-provider neutral.

The specific storage provider may be selected separately without changing the architectural model defined by this decision.

## Storage Model

CareIQ will separate file contents from document metadata.

Conceptually:

```text
CareIQ
   │
   ├── PostgreSQL
   │     │
   │     ├── Document Identity
   │     ├── Tenant Ownership
   │     ├── Domain Relationships
   │     ├── Storage Reference
   │     ├── Lifecycle State
   │     ├── Metadata
   │     └── Audit Relationships
   │
   └── Object Storage
         │
         └── File Contents
```

A document record may conceptually contain information such as:

```text
id
practice_id
patient_id
storage_key
original_filename
content_type
size_bytes
checksum
status
created_by
created_at
updated_at
```

The exact schema will be defined during implementation.

Not every document must be associated with a patient.

Documents may instead belong to another CareIQ domain entity when appropriate.

## Tenant Ownership

Every tenant-owned document must be associated with a CareIQ Practice.

Tenant-owned document metadata will contain or resolve an explicit `practice_id` consistent with ADR-007.

When a document belongs to another tenant-owned entity, such as a patient or appointment, the document must remain within the same authorized tenant boundary.

Document access must not rely solely on possession of an object-storage key or URL.

CareIQ authorization and tenant isolation remain authoritative.

## Private-by-Default Storage

Object storage used by CareIQ will be private by default.

Files must not be globally readable through predictable or permanent public URLs.

Access to file contents must occur only through explicitly authorized CareIQ workflows.

The object storage configuration must prevent accidental public exposure of CareIQ files.

Public file access, if ever required for a specific future use case, will require an explicit architectural and security decision.

## Document Access

CareIQ clients must not receive unrestricted direct access to object storage.

The normal access flow will require the client to request authorization through the CareIQ backend.

Conceptually:

```text
Client
  │
  ▼
CareIQ API
  │
  ├── Authenticate
  ├── Resolve Tenant
  ├── Authorize
  ├── Validate Document Ownership
  │
  ▼
Issue Controlled Access
  │
  ▼
Object Storage
```

The backend remains responsible for deciding whether a user, service account, integration, or other actor is authorized to access a document.

## Signed URLs

CareIQ may use short-lived signed URLs for authorized upload and download operations.

Signed URLs allow file contents to transfer directly between the client and object storage without requiring large payloads to pass through CareIQ API servers.

For uploads:

```text
Client
  │
  ├── Request Upload Authorization
  ▼
CareIQ API
  │
  ├── Authenticate
  ├── Authorize
  ├── Resolve Practice
  ├── Create or Reserve Document Record
  └── Issue Short-Lived Upload URL
          │
          ▼
     Object Storage
```

For downloads:

```text
Client
  │
  ├── Request Document Access
  ▼
CareIQ API
  │
  ├── Authenticate
  ├── Authorize
  ├── Validate Tenant Ownership
  └── Issue Short-Lived Download URL
          │
          ▼
     Object Storage
```

Signed URLs must:

- Be short-lived.
- Be scoped to a specific authorized object or operation.
- Not provide broader bucket access.
- Be issued only after CareIQ authorization succeeds.

The exact expiration duration may vary according to the operation and security requirements.

## Upload Lifecycle

A file must not automatically become available merely because its bytes were successfully uploaded.

Documents will support an explicit lifecycle.

A conceptual lifecycle may include:

```text
pending_upload
      │
      ▼
uploaded
      │
      ▼
scanning
      │
      ├── Passed
      │      │
      │      ▼
      │  available
      │
      └── Failed
             │
             ▼
       quarantined
       or rejected
```

The exact statuses may evolve according to implementation needs.

CareIQ should prevent normal document access until required validation and security checks have completed.

## File Validation

Uploaded files must be validated before being treated as trusted CareIQ documents.

Validation may include:

- File size.
- Declared content type.
- Actual detected file type.
- Allowed format.
- Checksum.
- Structural validation where appropriate.

Filename extensions must not be treated as authoritative evidence of file type.

CareIQ may define allowed file types and size limits according to document type, workflow, customer configuration, or security requirements.

Unsupported or invalid files should be rejected or quarantined.

## Malware Scanning

Uploaded files should support malware scanning or equivalent security validation before becoming generally available when required by the file type or workflow.

Malware scanning should occur asynchronously when appropriate using the background processing architecture defined in ADR-012.

Conceptually:

```text
Upload Complete
      │
      ▼
Background Scan
      │
      ├── Safe
      │    │
      │    ▼
      │ Available
      │
      └── Unsafe / Unknown
           │
           ▼
       Quarantine
```

Files that fail security validation must not become accessible through ordinary CareIQ workflows.

## Encryption

CareIQ file contents must be protected in transit and at rest.

Transport of files must use secure encrypted connections.

Object storage must use encryption at rest.

Storage credentials and signing credentials must remain server-side and must not be exposed directly to client applications.

Encryption requirements may be strengthened when applicable regulatory, contractual, customer, or security requirements demand additional controls.

## Storage Keys

Object storage keys must use CareIQ-controlled identifiers rather than sensitive patient or practice information.

Storage paths must not contain unnecessary personally identifiable or protected health information.

For example, CareIQ should prefer:

```text
practices/<practice-id>/documents/<document-id>
```

rather than:

```text
john-smith/medical-records/mri-result.pdf
```

Original filenames may be stored as protected metadata in PostgreSQL when needed for user-facing functionality.

The storage key itself should remain opaque and implementation-oriented.

## File Integrity

CareIQ should maintain metadata sufficient to verify file integrity.

Document metadata may include:

- Content length.
- Content type.
- Checksum or cryptographic hash.
- Upload completion state.
- Storage reference.

Checksums may be used to detect corruption, validate completed uploads, or support controlled duplicate detection.

The exact checksum algorithm and verification process will be selected during implementation.

## Document Versioning

CareIQ will avoid silently overwriting existing document contents in place.

When a document is replaced or revised, the architecture should preserve the ability to represent the replacement as a new version or new immutable object.

Conceptually:

```text
Document
   │
   ├── Version 1
   ├── Version 2
   └── Version 3
```

A new version should receive its own storage object rather than replacing the bytes of the previous version under the same storage key.

The exact user-facing versioning behavior may vary by document type and workflow.

The storage architecture must preserve the ability to reconstruct document history when required.

## Document Identity

CareIQ document entities will use the identifier strategy defined in ADR-009.

The CareIQ document identifier remains separate from:

- Original filenames.
- Object storage keys.
- External document identifiers.
- Third-party system identifiers.

Object storage keys must not become the primary CareIQ document identity.

## External Documents and Integrations

Documents imported through external systems must remain CareIQ-owned domain entities after import.

External identifiers may be stored as references or provenance information.

Examples may include:

- EHR document identifiers.
- Practice management system identifiers.
- External file identifiers.
- Partner system references.

External identifiers must not replace the CareIQ document primary identifier.

CareIQ should preserve useful provenance information describing the source of an imported document.

## Provenance

CareIQ document metadata should support recording the source of a file when relevant.

A document may originate from:

- A CareIQ user.
- A patient.
- A provider.
- A background workflow.
- An integration.
- An imported external system.
- A generated CareIQ report.
- Another explicitly identified source.

Provenance should be available for audit and troubleshooting purposes when appropriate.

## Audit Integration

Meaningful document operations must integrate with the Audit domain defined in ADR-010.

Auditable actions may include:

- Document upload.
- Document availability.
- Document replacement.
- Document version creation.
- Document access where required.
- Document download where appropriate.
- Document deletion or disposition.
- Quarantine actions.
- Administrative access.
- Privileged access.
- External import.
- External export.

Audit events should identify the relevant:

- Actor.
- Practice.
- Document.
- Action.
- Timestamp.
- Correlation context when available.

Protected audit records may capture additional details according to ADR-010.

Ordinary application logs are not a replacement for document audit history.

## Document Access Auditing

Access to sensitive documents may itself be a meaningful audit event.

CareIQ should support recording when protected documents are viewed, downloaded, exported, or otherwise accessed when required by security, privacy, compliance, or product requirements.

Customer-facing activity history and protected audit visibility will follow the access boundaries established in ADR-010.

## Background Processing

File-related work that is long-running or safely deferred should use the background processing architecture defined in ADR-012.

Examples include:

- Malware scanning.
- OCR.
- Thumbnail generation.
- Preview generation.
- Format conversion.
- Document parsing.
- Data extraction.
- AI processing.
- Integration synchronization.
- Large exports.

Background file-processing jobs must preserve tenant context and must remain subject to CareIQ authorization, audit, and sensitive-data handling requirements.

## Sensitive Data

CareIQ documents may contain sensitive information.

Document storage must therefore minimize unnecessary duplication of file contents and sensitive metadata.

Background jobs should normally pass document identifiers rather than copying document contents into durable job payloads.

Application logs must not contain raw document contents.

Audit logs must not unnecessarily duplicate full documents.

Metadata containing sensitive information must remain subject to the same authorization and tenant-isolation controls as other CareIQ domain data.

## Deletion

Deleting or removing a document from the active application experience must not automatically imply immediate destruction of the underlying object.

Document lifecycle and physical file disposition are separate concerns.

Conceptually:

```text
Active Document
      │
      ▼
Removed / Archived / Retained
      │
      ▼
Retention Requirements Evaluated
      │
      ▼
Authorized Disposition
```

CareIQ must not permanently delete retained document data through ordinary application behavior when retention, legal hold, contractual, regulatory, or other requirements prevent disposition.

The exact document retention policy may depend on document type and applicable requirements.

Detailed data-retention and disposition rules may be defined separately.

## Legal Holds and Retention

Documents subject to legal hold or other explicit retention requirements must not be physically deleted while the hold remains active.

CareIQ's file architecture must preserve the ability to prevent disposition of protected documents.

A normal user deletion request must not override an applicable legal hold or mandatory retention requirement.

The implementation of legal hold management and retention classification may be defined through future compliance or lifecycle architecture decisions.

## Orphaned Objects

CareIQ must account for file uploads that fail before a complete document workflow is established.

Examples may include:

- A signed upload URL is issued but never used.
- An upload succeeds but metadata finalization fails.
- A client abandons an upload.
- Processing fails before a document becomes available.

Object storage may therefore contain temporary or orphaned objects.

CareIQ will support controlled cleanup of objects that are confirmed to be unreferenced and no longer required.

Cleanup must:

- Avoid deleting valid document contents.
- Respect retention and legal-hold requirements.
- Be auditable when appropriate.
- Use background processing where appropriate.

## Failed Uploads

Failed or incomplete uploads must not create records that appear to represent valid available documents.

The document lifecycle must distinguish between:

- Reserved upload.
- Completed upload.
- Validated file.
- Available document.
- Failed or abandoned upload.

Cleanup of failed uploads may occur asynchronously after an appropriate expiration period.

## Access Control

Document access must use CareIQ's established RBAC and tenant authorization architecture.

Possession of:

- A document identifier.
- An object storage key.
- A filename.
- A previously issued URL.

must not by itself imply authorization.

The backend must validate the actor's current authorization before issuing new access to protected file contents.

Short-lived URLs should expire independently of the user's broader session.

## Privileged Access

Privileged CareIQ personnel may require access to documents for explicitly authorized support, security, legal, or operational purposes.

Such access must:

- Require explicit authorization.
- Follow least-privilege principles.
- Be isolated from ordinary tenant user access.
- Be audited.
- Respect applicable legal, contractual, and compliance requirements.

A generic platform administrator role must not automatically imply unrestricted document access unless that capability is explicitly granted.

## Provider Neutrality

ADR-013 defines the use of private object storage but does not select a specific object-storage provider.

Potential implementations may include compatible managed object-storage platforms.

The selected provider must support the security, encryption, access-control, durability, availability, and signed-access capabilities required by CareIQ.

The provider may be changed in the future without changing the conceptual CareIQ document architecture.

Object-storage-provider-specific identifiers should not become CareIQ domain identifiers.

## Scaling

Object storage and document metadata may scale independently.

PostgreSQL remains responsible for metadata and relationships.

Object storage remains responsible for file contents.

This separation allows CareIQ to grow file storage volume without forcing large binary content into the relational database.

Future scaling requirements may introduce:

- Storage lifecycle tiers.
- Archival storage.
- Replication.
- Geographic controls.
- Content-delivery infrastructure for explicitly approved non-sensitive use cases.
- Dedicated processing pipelines.

Such changes should preserve the security and ownership model defined by this ADR.

## Consequences

CareIQ will use a clear separation between relational document metadata and actual file contents.

PostgreSQL remains the authoritative source for:

- Document identity.
- Tenant ownership.
- Domain relationships.
- Lifecycle state.
- Storage references.
- Relevant metadata.

Private object storage remains responsible for file bytes.

Files are private by default.

Clients access file contents only after CareIQ authentication, tenant resolution, and authorization.

Short-lived signed URLs allow efficient direct file transfer without requiring CareIQ API servers to proxy large file payloads.

Tenant-owned documents remain explicitly associated with a CareIQ Practice.

Opaque object-storage keys reduce unnecessary exposure of sensitive information.

Upload lifecycle states prevent unvalidated files from immediately becoming trusted documents.

File validation and malware scanning reduce the risk of unsafe uploads.

Encryption protects file contents in transit and at rest.

Document versioning avoids silently destroying prior file contents through in-place overwrites.

Document operations integrate with the CareIQ Audit domain.

Sensitive document access may itself be auditable.

Background processing supports malware scanning, OCR, previews, conversion, extraction, integration work, and future AI processing.

CareIQ avoids unnecessary duplication of sensitive file contents in job payloads, application logs, and audit records.

Document deletion remains separate from physical file disposition.

Retention requirements and legal holds may prevent physical deletion even when a document is removed from normal application workflows.

Controlled orphan cleanup prevents abandoned uploads from accumulating indefinitely while preserving valid and retained documents.

The architecture remains object-storage-provider neutral.

This design introduces additional complexity involving:

- Object storage.
- Signed URLs.
- Upload lifecycle management.
- Security scanning.
- File validation.
- Versioning.
- Audit integration.
- Retention.
- Legal holds.
- Orphan cleanup.
- Access control.
- Background processing.

This complexity is accepted because CareIQ requires a secure and scalable foundation for healthcare-related document and file management.
````
