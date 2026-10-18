import { createHash,createHmac,randomBytes,timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { TenantContext } from '../middleware/tenant-context.js';
import { WorkflowError,id,isoDate } from './policy.js';

export const workflowCollections=['patients','appointments','documents','requests','workItems','templates','providers','visitTypes','documentTypes','documentVersions','templateVersions'] as const;
export type WorkflowCollection=typeof workflowCollections[number];
export type WorkflowReadOptions={collection?:WorkflowCollection;cursor?:string;limit?:number;patientId?:string;appointmentId?:string;documentId?:string;templateId?:string;requestId?:string;date?:string;search?:string};
export type WorkflowPage={hasMore:boolean;nextCursor:string|null;limit:number;total:number};
type QueryClient=Pick<PoolClient,'query'>;
type Row=Record<string,any>;
type Caps=Record<string,boolean>;
const processSecret=randomBytes(32).toString('hex');
// pg's Date decoder truncates PostgreSQL microseconds. Preserve the exact seek boundary without exposing an internal DTO field.
const preciseCreatedAt=new WeakMap<Row,string>();
function cursorRows(rows:Row[]){for(const row of rows){if(typeof row.__careiq_created_at==='string'){preciseCreatedAt.set(row,row.__careiq_created_at);delete row.__careiq_created_at;}}return rows;}
const secret=()=>process.env.CAREIQ_WORKFLOW_CURSOR_SECRET||processSecret;
const tables:Record<WorkflowCollection,string>={patients:'patients',appointments:'appointments',documents:'documents',requests:'document_requests',workItems:'work_items',templates:'document_templates',providers:'providers',visitTypes:'visit_types',documentTypes:'document_types',documentVersions:'document_versions',templateVersions:'template_versions'};
const primaryCollections=workflowCollections.filter(c=>c!=='documentVersions'&&c!=='templateVersions');
const emptyPage=(limit:number):WorkflowPage=>({hasMore:false,nextCursor:null,limit,total:0});
const ids=(rows:Row[],column='id')=>[...new Set(rows.map(row=>row[column]).filter((value):value is string=>typeof value==='string'))];
const merge=(...arrays:Row[][])=>[...new Map(arrays.flat().map(row=>[row.id,row])).values()].sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime()||(preciseCreatedAt.get(b)??'').localeCompare(preciseCreatedAt.get(a)??'')||String(b.id).localeCompare(String(a.id)));
function optionsFor(input:WorkflowReadOptions):Required<Pick<WorkflowReadOptions,'limit'>>&WorkflowReadOptions {
 const limit=input.limit??50;
 if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new WorkflowError('INVALID_PAGINATION',400);
 if(input.collection&&!workflowCollections.includes(input.collection))throw new WorkflowError('INVALID_COLLECTION',400);
 if(input.cursor&&(!input.collection||typeof input.cursor!=='string'||input.cursor.length>2000))throw new WorkflowError('INVALID_CURSOR',400);
 const output={...input,limit};for(const key of ['patientId','appointmentId','documentId','templateId','requestId'] as const)if(output[key])output[key]=id(output[key],key);
 if(output.date)output.date=isoDate(output.date);
 if(output.search!==undefined){if(typeof output.search!=='string'||output.search.trim().length>200)throw new WorkflowError('INVALID_SEARCH',400);output.search=output.search.trim();}
 if(output.collection==='documentVersions'&&!output.documentId||output.collection==='templateVersions'&&!output.templateId)throw new WorkflowError('HISTORY_PARENT_REQUIRED',400);
 return output;
}
function binding(t:TenantContext,o:WorkflowReadOptions,collection:WorkflowCollection){
 return createHash('sha256').update(JSON.stringify({practice:t.practiceId,location:t.locationId,actor:t.userId,membership:t.membershipId??null,collection,limit:o.limit,patientId:o.patientId??null,appointmentId:o.appointmentId??null,documentId:o.documentId??null,templateId:o.templateId??null,requestId:o.requestId??null,date:o.date??null,search:o.search??null})).digest('hex');
}
function cursorFor(row:Row,bind:string){
 const payload=Buffer.from(JSON.stringify({v:1,b:bind,t:preciseCreatedAt.get(row)??new Date(row.created_at).toISOString(),id:row.id,expires:Date.now()+24*3600000})).toString('base64url');
 return payload+'.'+createHmac('sha256',secret()).update(payload).digest('base64url');
}
function cursorFrom(value:string|undefined,bind:string):{time:string;id:string}|undefined {
 if(!value)return;
 try{const [payload,signature,...extra]=value.split('.');if(!payload||!signature||extra.length)throw new Error();const expected=createHmac('sha256',secret()).update(payload).digest();const received=Buffer.from(signature,'base64url');if(received.length!==expected.length||!timingSafeEqual(received,expected))throw new Error();const parsed=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));if(parsed.v!==1||parsed.b!==bind||!Number.isFinite(parsed.expires)||parsed.expires<Date.now()||typeof parsed.t!=='string'||!Number.isFinite(Date.parse(parsed.t)))throw new Error();return{time:parsed.t,id:id(parsed.id)};}catch{throw new WorkflowError('INVALID_CURSOR',400);}
}

/** All identifiers are module constants. HTTP values enter PostgreSQL only as parameters. */
function scopeFor(collection:WorkflowCollection,t:TenantContext,o:WorkflowReadOptions){
 const values:unknown[]=[t.practiceId,t.locationId];const practiceOnly=['templates','providers','visitTypes','documentTypes','templateVersions'].includes(collection);
 const clauses=[`t.practice_id=$1`,practiceOnly?'$2::uuid IS NOT NULL':'t.location_id=$2'];
 const param=(value:unknown)=>{values.push(value);return'$'+values.length;};
 const relatedPatient=(table:string,parent:string)=>`(SELECT parent.patient_id FROM ${table} parent WHERE parent.id=${parent}::uuid AND parent.practice_id=$1 AND parent.location_id=$2)`;
 const patientColumn=collection==='patients'?'t.id':'t.patient_id';
 if(!practiceOnly){
  if(o.patientId)clauses.push(`${patientColumn}=${param(o.patientId)}::uuid`);
  if(o.appointmentId&&collection!=='appointments')clauses.push(`${patientColumn}=${relatedPatient('appointments',param(o.appointmentId))}`);
  if(o.documentId&&!['documents','documentVersions'].includes(collection))clauses.push(`${patientColumn}=${relatedPatient('documents',param(o.documentId))}`);
  if(o.requestId&&collection!=='requests')clauses.push(`${patientColumn}=${relatedPatient('document_requests',param(o.requestId))}`);
  if(o.templateId&&!o.patientId&&!o.appointmentId&&!o.documentId&&!o.requestId)clauses.push('false');
 }
 if(collection==='patients'&&o.search){const key=param('%'+o.search.replace(/[\\%_]/g,'\\$&')+'%');clauses.push(`(concat_ws(' ',t.first_name,t.last_name) ILIKE ${key} OR t.preferred_name ILIKE ${key} OR t.email ILIKE ${key} OR t.phone ILIKE ${key})`);}
 if(collection==='appointments'){
  if(o.appointmentId)clauses.push('t.id='+param(o.appointmentId)+'::uuid');
  if(o.requestId)clauses.push(`t.id=(SELECT parent.appointment_id FROM document_requests parent WHERE parent.id=${param(o.requestId)}::uuid AND parent.practice_id=$1 AND parent.location_id=$2)`);
  if(o.documentId){const key=param(o.documentId);clauses.push(`(EXISTS(SELECT 1 FROM visit_requirements r JOIN requirement_evidence e ON e.requirement_id=r.id JOIN document_versions v ON v.id=e.document_version_id WHERE r.appointment_id=t.id AND r.practice_id=$1 AND r.location_id=$2 AND v.document_id=${key}::uuid) OR EXISTS(SELECT 1 FROM document_requests r JOIN document_request_items i ON i.request_id=r.id JOIN document_versions v ON v.id IN(i.source_version_id,i.fulfilled_version_id) WHERE r.appointment_id=t.id AND r.practice_id=$1 AND r.location_id=$2 AND v.document_id=${key}::uuid))`);}
  if(o.date){const date=param(o.date);const zone='(SELECT time_zone FROM locations WHERE id=$2 AND practice_id=$1)';clauses.push(`t.scheduled_at>=(${date}::date::timestamp AT TIME ZONE ${zone}) AND t.scheduled_at<((${date}::date+1)::timestamp AT TIME ZONE ${zone})`);}
 }
 if(collection==='documents'){
  if(o.documentId)clauses.push('t.id='+param(o.documentId)+'::uuid');
  if(o.requestId){const key=param(o.requestId);clauses.push(`(t.request_id=${key}::uuid OR EXISTS(SELECT 1 FROM document_versions v JOIN document_request_items i ON v.id IN(i.source_version_id,i.fulfilled_version_id) WHERE v.document_id=t.id AND i.request_id=${key}::uuid))`);}
 }
 if(collection==='requests'){
  if(o.requestId)clauses.push('t.id='+param(o.requestId)+'::uuid');
  if(o.appointmentId)clauses.push('t.appointment_id='+param(o.appointmentId)+'::uuid');
  if(o.documentId){const key=param(o.documentId);clauses.push(`(EXISTS(SELECT 1 FROM documents d WHERE d.id=${key}::uuid AND d.request_id=t.id) OR EXISTS(SELECT 1 FROM document_request_items i JOIN document_versions v ON v.id IN(i.source_version_id,i.fulfilled_version_id) WHERE i.request_id=t.id AND v.document_id=${key}::uuid))`);}
 }
 if(collection==='workItems'){
  if(o.appointmentId)clauses.push('t.appointment_id='+param(o.appointmentId)+'::uuid');
  if(o.requestId){const key=param(o.requestId);clauses.push(`(t.request_id=${key}::uuid OR EXISTS(SELECT 1 FROM document_request_items i WHERE i.request_id=${key}::uuid AND i.requirement_id=t.requirement_id))`);}
  if(o.date){const date=param(o.date);clauses.push(`(t.due_at IS NULL OR t.due_at<((${date}::date+1)::timestamp AT TIME ZONE (SELECT time_zone FROM locations WHERE id=$2 AND practice_id=$1)))`);}
 }
 if(collection==='templates'&&o.templateId)clauses.push('t.id='+param(o.templateId)+'::uuid');
 if(collection==='documentVersions')clauses.push('t.document_id='+param(o.documentId)+'::uuid');
 if(collection==='templateVersions')clauses.push('t.template_id='+param(o.templateId)+'::uuid');
 return{values,where:clauses.join(' AND ')};
}
function permitted(collection:WorkflowCollection,c:Caps){
 if(collection==='patients')return!!c.patientsRead;
 if(collection==='appointments'||collection==='workItems')return!!c.appointmentsRead;
 if(collection==='templates'||collection==='templateVersions')return!!(c.documentsRead||c.configurationManage);
 if(collection==='documents'||collection==='requests'||collection==='documentVersions')return!!c.documentsRead;
 return true;
}
async function page(client:QueryClient,t:TenantContext,caps:Caps,o:ReturnType<typeof optionsFor>,collection:WorkflowCollection){
 if(!permitted(collection,caps)||o.collection&&o.collection!==collection)return{rows:[] as Row[],page:emptyPage(o.limit)};
 const {values,where}=scopeFor(collection,t,o);const bind=binding(t,o,collection);const cursor=cursorFrom(o.cursor,bind);
 const count=await client.query(`SELECT count(*)::text AS count FROM ${tables[collection]} t WHERE ${where}`,values);const total=Number(count.rows[0].count);
 let seek='';if(cursor){values.push(cursor.time,cursor.id);seek=` AND (t.created_at,t.id)<($${values.length-1}::timestamptz,$${values.length}::uuid)`;}
 values.push(o.limit+1);const found=(await client.query(`SELECT t.*,t.created_at::text AS __careiq_created_at FROM ${tables[collection]} t WHERE ${where}${seek} ORDER BY t.created_at DESC,t.id DESC LIMIT $${values.length}`,values)).rows;
 cursorRows(found);const selected=found.slice(0,o.limit);const hasMore=found.length>o.limit;return{rows:selected,page:{hasMore,nextCursor:hasMore?cursorFor(selected.at(-1)!,bind):null,limit:o.limit,total}};
}
async function byIds(client:QueryClient,t:TenantContext,table:string,entityIds:string[],practiceOnly=false){
 if(!entityIds.length)return[] as Row[];
 return cursorRows((await client.query(`SELECT *,created_at::text AS __careiq_created_at FROM ${table} WHERE practice_id=$1 ${practiceOnly?'AND $2::uuid IS NOT NULL':'AND location_id=$2'} AND id=ANY($3::uuid[]) ORDER BY created_at DESC,id DESC`,[t.practiceId,t.locationId,entityIds])).rows);
}
async function related(client:QueryClient,t:TenantContext,table:string,column:string,entityIds:string[],extra=''){
 if(!entityIds.length)return[] as Row[];
 return cursorRows((await client.query(`SELECT *,created_at::text AS __careiq_created_at FROM ${table} WHERE practice_id=$1 AND location_id=$2 AND ${column}=ANY($3::uuid[]) ${extra} ORDER BY created_at DESC,id DESC`,[t.practiceId,t.locationId,entityIds])).rows);
}
async function totals(client:QueryClient,t:TenantContext,o:WorkflowReadOptions,caps:Caps){
 if(!caps.appointmentsRead)return{activeAppointments:0,appointmentsNeedingDocuments:0,checkedIn:0,openWorkItems:0};
 const appointmentScope=scopeFor('appointments',t,o),workScope=scopeFor('workItems',t,o);
 const appts=await client.query(`SELECT count(*) FILTER(WHERE t.status NOT IN('cancelled','completed','no_show'))::text AS active,
 count(*) FILTER(WHERE t.status='checked_in')::text AS checked_in,
 count(*) FILTER(WHERE t.status NOT IN('cancelled','completed','no_show') AND EXISTS(
 SELECT 1 FROM visit_requirements r WHERE r.appointment_id=t.id AND r.practice_id=t.practice_id AND r.location_id=t.location_id AND r.required AND r.lifecycle_state='active' AND NOT EXISTS(
 SELECT 1 FROM requirement_evidence e JOIN document_versions v ON v.id=e.document_version_id AND v.patient_id=r.patient_id AND v.practice_id=r.practice_id AND v.location_id=r.location_id
 JOIN documents d ON d.id=v.document_id AND d.archived_at IS NULL JOIN file_objects f ON f.id=v.file_object_id AND f.status='available'
 WHERE e.requirement_id=r.id AND e.revoked_at IS NULL
 AND (r.required_template_version_id IS NULL OR r.required_template_version_id=v.template_version_id)
 AND (r.maximum_age_days IS NULL OR COALESCE(v.completed_at,f.uploaded_at,v.received_at)>=t.scheduled_at-make_interval(days=>r.maximum_age_days))
 AND (NOT r.review_required OR EXISTS(SELECT 1 FROM document_reviews review WHERE review.id=e.accepted_review_id AND review.document_version_id=v.id AND review.decision='accepted' AND NOT EXISTS(SELECT 1 FROM document_reviews next_review WHERE next_review.supersedes_review_id=review.id)))
 AND (NOT r.signature_required OR EXISTS(SELECT 1 FROM signature_packets packet WHERE packet.output_version_id=v.id AND packet.state='completed'))
 )))::text AS needs_documents FROM appointments t WHERE ${appointmentScope.where}`,appointmentScope.values);
 const work=await client.query(`SELECT count(*)::text AS count FROM work_items t WHERE ${workScope.where} AND t.state IN('open','in_progress')`,workScope.values);
 return{activeAppointments:Number(appts.rows[0].active),appointmentsNeedingDocuments:Number(appts.rows[0].needs_documents),checkedIn:Number(appts.rows[0].checked_in),openWorkItems:Number(work.rows[0].count)};
}

/** Run within the caller's authorized repeatable-read transaction. Only page rows and their exact readiness dependencies are loaded. */
export async function loadWorkflowReadModel(client:QueryClient,t:TenantContext,caps:Caps,input:WorkflowReadOptions={}){
 const o=optionsFor(input);if(!t.locationId)throw new WorkflowError('LOCATION_CONTEXT_REQUIRED',409);
 const location=(await client.query('SELECT id,name,time_zone FROM locations WHERE practice_id=$1 AND id=$2',[t.practiceId,t.locationId])).rows[0];if(!location)throw new WorkflowError('RESOURCE_NOT_FOUND',404);
 const pages={} as Record<WorkflowCollection,Row[]>;const pagination={} as Record<WorkflowCollection,WorkflowPage>;const primaryIds={} as Record<WorkflowCollection,string[]>;
 for(const collection of workflowCollections){const selected=await page(client,t,caps,o,collection);pages[collection]=selected.rows;pagination[collection]=selected.page;primaryIds[collection]=ids(selected.rows);}
 let {patients,appointments,documents,requests,workItems,templates,providers,visitTypes,documentTypes}=pages;
 // Work rows and selected request details also need their appointment's complete checklist.
 if(caps.appointmentsRead)appointments=merge(appointments,await byIds(client,t,'appointments',ids([...workItems,...requests],'appointment_id')));
 const requirements=caps.appointmentsRead?await related(client,t,'visit_requirements','appointment_id',ids(appointments),"AND lifecycle_state<>'retired'"):[];
 const evidence=caps.appointmentsRead?await related(client,t,'requirement_evidence','requirement_id',ids(requirements),'AND revoked_at IS NULL'):[];
 let requestItems=merge(await related(client,t,'document_request_items','request_id',ids(requests)),await related(client,t,'document_request_items','requirement_id',ids(requirements),'AND is_open'));
 requests=merge(requests,await byIds(client,t,'document_requests',ids(requestItems,'request_id')));
 // One latest candidate per patient/type avoids scanning every historical version into application memory.
 const candidates=requirements.length?cursorRows((await client.query(`SELECT v.*,v.created_at::text AS __careiq_created_at FROM (SELECT DISTINCT patient_id,document_type_id FROM visit_requirements WHERE practice_id=$1 AND location_id=$2 AND id=ANY($3::uuid[])) r JOIN LATERAL(
 SELECT candidate.* FROM documents d JOIN LATERAL(SELECT version.* FROM document_versions version WHERE version.document_id=d.id AND version.practice_id=$1 AND version.location_id=$2 ORDER BY version.created_at DESC,version.id DESC LIMIT 1) candidate ON true
 WHERE d.practice_id=$1 AND d.location_id=$2 AND d.patient_id=r.patient_id AND d.document_type_id=r.document_type_id AND d.archived_at IS NULL
 ORDER BY candidate.created_at DESC,candidate.id DESC LIMIT 1
 ) v ON true`,[t.practiceId,t.locationId,ids(requirements)])).rows):[];
 let versions=merge(pages.documentVersions,await byIds(client,t,'document_versions',[...ids(documents,'current_version_id'),...ids(evidence,'document_version_id'),...ids(requestItems,'source_version_id'),...ids(requestItems,'fulfilled_version_id')]),candidates);
 // Bound displayed history, while current/evidence/frozen versions above are always included regardless of age.
 const history=caps.documentsRead&&documents.length?cursorRows((await client.query(`SELECT v.*,v.created_at::text AS __careiq_created_at FROM documents d JOIN LATERAL(SELECT * FROM document_versions v WHERE v.document_id=d.id AND v.practice_id=$1 AND v.location_id=$2 ORDER BY v.created_at DESC,v.id DESC LIMIT 20) v ON true WHERE d.id=ANY($3::uuid[]) AND d.practice_id=$1 AND d.location_id=$2`,[t.practiceId,t.locationId,ids(documents)])).rows):[];
 versions=merge(versions,history);documents=merge(documents,await byIds(client,t,'documents',ids(versions,'document_id')));
 let packets=merge(await related(client,t,'signature_packets','request_id',ids(requests)),await related(client,t,'signature_packets','output_version_id',ids(versions)));
 versions=merge(versions,await byIds(client,t,'document_versions',[...ids(packets,'source_version_id'),...ids(packets,'output_version_id')]));
 documents=merge(documents,await byIds(client,t,'documents',ids(versions,'document_id')));
 const objects=await byIds(client,t,'file_objects',ids(versions,'file_object_id'));
 const reviews=versions.length?(await client.query(`SELECT review.* FROM document_reviews review WHERE review.practice_id=$1 AND review.location_id=$2 AND review.document_version_id=ANY($3::uuid[]) AND NOT EXISTS(SELECT 1 FROM document_reviews successor WHERE successor.supersedes_review_id=review.id) ORDER BY review.created_at DESC,review.id DESC`,[t.practiceId,t.locationId,ids(versions)])).rows:[];
 // Labels may be dependencies even when their row is on a later primary page.
 if(caps.patientsRead)patients=merge(patients,await byIds(client,t,'patients',ids([...appointments,...documents,...requests,...workItems],'patient_id')));
 providers=merge(providers,await byIds(client,t,'providers',ids(appointments,'provider_id'),true));
 visitTypes=merge(visitTypes,await byIds(client,t,'visit_types',ids(appointments,'visit_type_id'),true));
 const referencedTemplateVersions=await byIds(client,t,'template_versions',ids(versions,'template_version_id'),true);
 templates=merge(templates,await byIds(client,t,'document_templates',ids(referencedTemplateVersions,'template_id'),true));
 let templateVersions=merge(pages.templateVersions,referencedTemplateVersions,await byIds(client,t,'template_versions',ids(templates,'published_version_id'),true));
 if((caps.documentsRead||caps.configurationManage)&&templates.length)templateVersions=merge(templateVersions,cursorRows((await client.query(`SELECT v.*,v.created_at::text AS __careiq_created_at FROM document_templates t JOIN LATERAL(SELECT * FROM template_versions v WHERE v.template_id=t.id AND v.practice_id=$1 ORDER BY v.created_at DESC,v.id DESC LIMIT 20) v ON true WHERE t.practice_id=$1 AND $2::uuid IS NOT NULL AND t.id=ANY($3::uuid[])`,[t.practiceId,t.locationId,ids(templates)])).rows));
 documentTypes=merge(documentTypes,await byIds(client,t,'document_types',ids([...documents,...requirements,...templates,...requestItems],'document_type_id'),true));
 const deliveries=caps.documentsRead&&requests.length?(await client.query(`SELECT a.* FROM document_requests r JOIN LATERAL(SELECT * FROM delivery_attempts a WHERE a.request_id=r.id AND a.practice_id=$1 AND a.location_id=$2 ORDER BY a.sequence DESC LIMIT 1) a ON true WHERE r.id=ANY($3::uuid[]) AND r.practice_id=$1 AND r.location_id=$2`,[t.practiceId,t.locationId,ids(requests)])).rows:[];
 const summary=await totals(client,t,o,caps);
 const relatedPagination={documentVersions:{} as Record<string,WorkflowPage>,templateVersions:{} as Record<string,WorkflowPage>};
 for(const [collection,parentRows,parentColumn]of [['documentVersions',documents,'document_id'],['templateVersions',templates,'template_id']] as const){
  const primaryParents=parentRows.filter(row=>primaryIds[collection==='documentVersions'?'documents':'templates'].includes(row.id));if(!primaryParents.length)continue;
  const practiceOnly=collection==='templateVersions';const counts=(await client.query(`SELECT ${parentColumn} AS parent_id,count(*)::text AS total FROM ${tables[collection]} WHERE practice_id=$1 ${practiceOnly?'AND $2::uuid IS NOT NULL':'AND location_id=$2'} AND ${parentColumn}=ANY($3::uuid[]) GROUP BY ${parentColumn}`,[t.practiceId,t.locationId,ids(primaryParents)])).rows;
  const all=collection==='documentVersions'?versions:templateVersions;
  for(const count of counts){const shown=all.filter(v=>v[parentColumn]===count.parent_id).slice(0,20);const historyOptions={collection,limit:20,...(collection==='documentVersions'?{documentId:count.parent_id}:{templateId:count.parent_id})};const hasMore=Number(count.total)>20;relatedPagination[collection][count.parent_id]={limit:20,total:Number(count.total),hasMore,nextCursor:hasMore?cursorFor(shown.at(-1)!,binding(t,historyOptions,collection)):null};}
 }
 return{location,patients,appointments,providers,visitTypes,documentTypes,documents,versions,objects,reviews,requirements,evidence,requests,requestItems,workItems,templates,templateVersions,packets,deliveries,primaryIds,pagination,relatedPagination,summary,totals:summary,collectionLimit:o.limit};
}
