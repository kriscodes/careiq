-- Support bounded primary pages and exact version/readiness graph lookups at larger locations.
CREATE INDEX patients_scope_created_idx ON public.patients(practice_id,location_id,created_at DESC,id DESC);
CREATE INDEX appointments_scope_created_idx ON public.appointments(practice_id,location_id,created_at DESC,id DESC);
CREATE INDEX documents_scope_created_idx ON public.documents(practice_id,location_id,created_at DESC,id DESC);
CREATE INDEX document_requests_scope_created_idx ON public.document_requests(practice_id,location_id,created_at DESC,id DESC);
CREATE INDEX work_items_scope_created_idx ON public.work_items(practice_id,location_id,created_at DESC,id DESC);
CREATE INDEX document_templates_scope_created_idx ON public.document_templates(practice_id,created_at DESC,id DESC);
CREATE INDEX providers_scope_created_idx ON public.providers(practice_id,created_at DESC,id DESC);
CREATE INDEX visit_types_scope_created_idx ON public.visit_types(practice_id,created_at DESC,id DESC);
CREATE INDEX document_types_scope_created_idx ON public.document_types(practice_id,created_at DESC,id DESC);
CREATE INDEX document_versions_document_created_idx ON public.document_versions(practice_id,location_id,document_id,created_at DESC,id DESC);
CREATE INDEX template_versions_template_created_idx ON public.template_versions(practice_id,template_id,created_at DESC,id DESC);
CREATE INDEX documents_patient_type_created_idx ON public.documents(practice_id,location_id,patient_id,document_type_id,created_at DESC,id DESC) WHERE archived_at IS NULL;
CREATE INDEX document_reviews_version_created_idx ON public.document_reviews(document_version_id,created_at DESC,id DESC);
CREATE INDEX signature_packets_output_idx ON public.signature_packets(practice_id,location_id,output_version_id) WHERE output_version_id IS NOT NULL;
