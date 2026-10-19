import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { TenantContext } from '../middleware/tenant-context.js';
import { pool } from '../db/client.js';
import { recordWorkflowAudit } from './workflow-audit.js';
import { body, camel, checkRevision, concurrency, fingerprint, id, instant, requestKey, text, WorkflowError } from '../workflow/policy.js';
import { authoringFromVersion, validateFormAnswers, type FormSchema } from '../workflow/forms.js';
import { verifiedBindingInput, paperworkCursorFor, paperworkCursorFrom } from '../workflow/paperwork-policy.js';
import { patientAdultSelfEligible } from '../workflow/patient-eligibility.js';
import { command, row, scoped, type CommandContext, type QueryClient } from '../workflow/transaction.js';
import { readPrivate, sha256 } from '../workflow/storage.js';
import { deliveryReceipt, freezePrepared, insert, issueGrant, localDelivery, patientCommand, patientTransaction, update } from './workflow.service.js';

const scope=(t:TenantContext)=>[t.practiceId,t.locationId];
function completionPolicy(version:Record<string,any>) {
    const authoring=authoringFromVersion(version);
    if(authoring.schemaVersion!==2) throw new WorkflowError('FORM_SCHEMA_V2_REQUIRED',422);
    const schema=authoring.formSchema as FormSchema;
    if(schema.completionPolicy==='form_then_sign' && (schema.signing.roles.length!==1 || schema.signing.roles[0]?.key!=='patient' || schema.signing.roles[0]?.required!==true)) throw new WorkflowError('SIGNER_POLICY_UNAVAILABLE',409);
    return {authoring,schema};
}
export async function requireFormSignerAuthority(client:QueryClient,requestId:string){if((await client.query('SELECT careiq_form_signer_authorized($1) AS allowed',[requestId])).rows[0]?.allowed!==true)throw new WorkflowError('SIGNER_AUTHORITY_UNAVAILABLE',409);}
function validEmail(value:unknown) { const email=text(value,'recipient.address',254)!; if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new WorkflowError('INVALID_EMAIL',422);return email; }

export async function executePaperwork(t:TenantContext,action:string,target:string,input:unknown,context:CommandContext) {
    return command(t,action,target,input,context,async client=>{
        if(action==='paperwork.requests.create') {
            const p=body(input,['patientId','templateVersionId','requirementId','appointmentId','recipient','expiresAt','dueAt','delivery']);
            const patient=await row(client,'patients',t,id(p.patientId));
            if(patient.archived_at) throw new WorkflowError('PATIENT_ARCHIVED',409);
            const version=await row(client,'template_versions',t,id(p.templateVersionId),true,true);
            const template=await row(client,'document_templates',t,version.template_id,true,true);
            if(version.state!=='published'||!template.active) throw new WorkflowError('PUBLISHED_TEMPLATE_REQUIRED',409);
            const {schema}=completionPolicy(version);
            const requirement=p.requirementId ? await row(client,'visit_requirements',t,id(p.requirementId)) : null;
            if(requirement && (requirement.patient_id!==patient.id || requirement.document_type_id!==template.document_type_id || requirement.lifecycle_state!=='active' || requirement.required_template_version_id && requirement.required_template_version_id!==version.id || requirement.signature_required && schema.completionPolicy!=='form_then_sign')) throw new WorkflowError('REQUIREMENT_SCOPE_MISMATCH',422);
            const appointmentId=p.appointmentId ? id(p.appointmentId) : requirement?.appointment_id ?? null;
            if(appointmentId) {const appointment=await row(client,'appointments',t,appointmentId);if(appointment.patient_id!==patient.id || ['cancelled','completed','no_show'].includes(appointment.status) || requirement && requirement.appointment_id!==appointmentId)throw new WorkflowError('APPOINTMENT_UNAVAILABLE',409);}
            const recipient=body(p.recipient ?? {},['name','channel','address']);
            const channel=recipient.channel ?? 'local_review';
            if(!['local_review','email','sms'].includes(String(channel)))throw new WorkflowError('INVALID_CHANNEL',422);
            const expiresAt=p.expiresAt ? instant(p.expiresAt,'expiresAt') : new Date(Date.now()+7*86400000),dueAt=p.dueAt ? instant(p.dueAt,'dueAt') : null;
            if(expiresAt<=new Date() || expiresAt.getTime()>Date.now()+30*86400000 || dueAt && dueAt>expiresAt)throw new WorkflowError('INVALID_REQUEST_EXPIRY',422);
            const request=await insert(client,'document_requests',t,{patient_id:patient.id,appointment_id:appointmentId,purpose:'form_completion',form_completion_policy:schema.completionPolicy,recipient_name:text(recipient.name ?? [patient.first_name,patient.last_name].filter(Boolean).join(' '),'recipient.name',200),recipient_email:channel==='email'?validEmail(recipient.address):null,recipient_phone:channel==='sms'?text(recipient.address,'recipient.address',40):null,expires_at:expiresAt,due_at:dueAt,state:'open',created_by_actor_id:t.userId});
            const prepared=await insert(client,'prepared_documents',t,{patient_id:patient.id,appointment_id:appointmentId,requirement_id:requirement?.id ?? null,template_version_id:version.id,answers:'{}',created_by_actor_id:t.userId});
            await insert(client,'document_request_items',t,{patient_id:patient.id,request_id:request.id,requirement_id:requirement?.id ?? null,document_type_id:template.document_type_id,prepared_document_id:prepared.id});
            if(schema.completionPolicy==='form_then_sign')await requireFormSignerAuthority(client,request.id);
            const localReviewPath=await issueGrant(client,t,request),delivery=body(p.delivery ?? {},['sendNow']);
            if(delivery.sendNow!==undefined && typeof delivery.sendNow!=='boolean')throw new WorkflowError('INVALID_DELIVERY_OPTION',422);
            const attempt=delivery.sendNow===true ? await localDelivery(client,t,request,'initial') : null;
            await recordWorkflowAudit(client,t,{action:'paperwork.requests.created',entityType:'request',entityId:request.id,requestId:context.requestId,resources:[{resourceType:'request',resourceId:request.id,patientId:patient.id},{resourceType:'prepared_document',resourceId:prepared.id,patientId:patient.id}],metadata:{templateVersionId:version.id,purpose:'form_completion'}});
            return {id:request.id,state:'open',revision:1,preparedDocumentId:prepared.id,completionPolicy:schema.completionPolicy,localReviewPath,...(attempt?deliveryReceipt(attempt):{deliveryState:'not_requested'})};
        }
        if(action==='paperwork.portal.bind') {
            const p=verifiedBindingInput(input),patient=await row(client,'patients',t,id(target));
            if(patient.archived_at || !await patientAdultSelfEligible(client,patient.id))throw new WorkflowError('ADULT_SELF_ACCESS_REQUIRED',422);
            const expiresAt=p.expiresAt ? instant(p.expiresAt,'expiresAt') : new Date(Date.now()+90*86400000);
            if(expiresAt<=new Date() || expiresAt.getTime()>Date.now()+90*86400000)throw new WorkflowError('INVALID_PORTAL_EXPIRY',422);
            const grant=await insert(client,'patient_portal_grants',t,{patient_id:patient.id,clerk_user_id:p.clerkUserId,relationship:'self',verification_method:'staff_in_person',verification_reference:p.verificationReference,verified_by_actor_id:t.userId,verified_email:p.verifiedEmail,email_verified_at:p.verifiedEmail?new Date():null,paperwork_email_enabled:p.paperworkEmailEnabled,expires_at:expiresAt});
            await recordWorkflowAudit(client,t,{action:'paperwork.portal.binding.verified',entityType:'patient_portal_grant',entityId:grant.id,requestId:context.requestId,resources:[{resourceType:'patient',resourceId:patient.id,patientId:patient.id},{resourceType:'patient_portal_grant',resourceId:grant.id,patientId:patient.id}],metadata:{verificationMethod:'staff_in_person',assurance:'staff_verified_binding'},changes:[{resourceType:'patient_portal_grant',resourceId:grant.id,fieldPath:'clerkUserId',captureMode:'protected_reference',protectedReference:'patient_portal_grants/'+grant.id}]});
            return {id:grant.id,state:'active',revision:1,patientId:patient.id,expiresAt:expiresAt.toISOString()};
        }
        if(action==='paperwork.portal.revoke') {
            const p=body(input,['reasonCode']),grant=await row(client,'patient_portal_grants',t,id(target));checkRevision(grant,context.expectedRevision);
            const reason=text(p.reasonCode,'reasonCode',80)!;
            if(grant.revoked_at)throw new WorkflowError('PORTAL_GRANT_REVOKED',409);
            const result=await update(client,'patient_portal_grants',t,grant.id,{revoked_at:new Date(),revocation_reason_code:reason});
            await recordWorkflowAudit(client,t,{action:'paperwork.portal.binding.revoked',entityType:'patient_portal_grant',entityId:grant.id,reasonCode:reason,requestId:context.requestId,resources:[{resourceType:'patient_portal_grant',resourceId:grant.id,patientId:grant.patient_id}]});
            return {...concurrency(result),state:'revoked'};
        }
        if(action==='paperwork.library.release') {
            const p=body(input,['releaseState','reasonCode']),item=await row(client,'paperwork_library_items',t,id(target));checkRevision(item,context.expectedRevision);
            if(!['released','restricted','voided','superseded'].includes(String(p.releaseState)))throw new WorkflowError('INVALID_RELEASE_STATE',422);
            const reason=text(p.reasonCode,'reasonCode',80)!;
            const changed=await update(client,'paperwork_library_items',t,item.id,{release_state:p.releaseState,release_reason_code:reason});
            await recordWorkflowAudit(client,t,{action:'paperwork.library.release.changed',entityType:'paperwork_library_item',entityId:item.id,reasonCode:reason,requestId:context.requestId,resources:[{resourceType:'document_version',resourceId:item.document_version_id,patientId:item.patient_id},{resourceType:'request',resourceId:item.request_id,patientId:item.patient_id}],metadata:{fromState:item.release_state,toState:String(p.releaseState)}});
            return concurrency(changed);
        }
        if(action==='paperwork.notifications.retry') {
            const p=body(input,[]),notification=await row(client,'paperwork_notifications',t,id(target));checkRevision(notification,context.expectedRevision);
            // Recheck the pinned audience and exact-copy grant before a known-safe explicit retry.
            const grant=notification.recipient_grant_id ? (await client.query('SELECT * FROM patient_portal_grants WHERE id=$1 AND patient_id=$2 AND practice_id=$3 AND location_id=$4 FOR SHARE',[notification.recipient_grant_id,notification.patient_id,...scope(t)])).rows[0] : null;
            const {notificationEligibility}=await import('../workflow/paperwork-policy.js');
            const library=await row(client,'paperwork_library_items',t,notification.library_item_id),patient=await row(client,'patients',t,notification.patient_id,false);
            const eligibility=library.release_state!=='released'?{state:'suppressed',failureCode:'PAPERWORK_RELEASE_RESTRICTED'}:patient.archived_at||!await patientAdultSelfEligible(client,patient.id)?{state:'suppressed',failureCode:'PATIENT_PORTAL_ACCESS_UNAVAILABLE'}:notification.channel==='sms'?(grant&&!grant.revoked_at&&new Date(grant.expires_at)>new Date()?{state:'needs_attention',failureCode:'DELIVERY_PROVIDER_UNAVAILABLE'}:{state:'suppressed',failureCode:'PATIENT_PORTAL_ACCESS_UNAVAILABLE'}):notificationEligibility(grant?{revokedAt:grant.revoked_at,expiresAt:grant.expires_at,email:grant.verified_email,emailVerifiedAt:grant.email_verified_at,enabled:grant.paperwork_email_enabled}:null);
            const uncertain=await client.query("SELECT id FROM delivery_intents WHERE paperwork_notification_id=$1 AND state IN ('queued','scheduled','retry_waiting','submitting','accepted','unknown') LIMIT 1",[notification.id]);
            if(uncertain.rowCount)throw new WorkflowError('DELIVERY_RECONCILIATION_REQUIRED',409);
            let retryIntent:any=null;
            if(eligibility.failureCode==='DELIVERY_PROVIDER_UNAVAILABLE'){
                const {enqueuePaperworkNotification}=await import('./patient-delivery.service.js');
                retryIntent=await enqueuePaperworkNotification(client,t,notification,context.idempotencyKey!);
            }
            const changed=retryIntent?await row(client,'paperwork_notifications',t,notification.id,false):await update(client,'paperwork_notifications',t,notification.id,{state:eligibility.state,failure_code:eligibility.failureCode});
            const nextState=changed.state,nextFailure=changed.failure_code;
            await recordWorkflowAudit(client,t,{action:'paperwork.notifications.retry.gated',entityType:'paperwork_notification',entityId:notification.id,requestId:context.requestId,metadata:{failureCode:nextFailure,resultState:nextState},resources:[{resourceType:'document_version',resourceId:notification.document_version_id,patientId:notification.patient_id}]});
            return {...concurrency(changed),failureCode:nextFailure,...(retryIntent?{deliveryIntentId:retryIntent.id}:{} )};
        }
        throw new WorkflowError('UNKNOWN_PAPERWORK_COMMAND',404);
    });
}

export async function getPatientFormProjection(client:QueryClient,t:TenantContext,access:any) {
    const prepared=(await client.query('SELECT p.* FROM prepared_documents p JOIN document_request_items i ON i.prepared_document_id=p.id AND i.patient_id=p.patient_id AND i.practice_id=p.practice_id AND i.location_id=p.location_id WHERE i.request_id=$1',[access.request_id])).rows[0];
    if(!prepared)return null;
    const version=await row(client,'template_versions',t,prepared.template_version_id,false,true),template=await row(client,'document_templates',t,version.template_id,false,true),{authoring,schema}=completionPolicy(version);
    const draft=validateFormAnswers(authoring,prepared.answers,false);
    return {preparedDocumentId:prepared.id,templateVersionId:version.id,title:schema.documentTitle ?? template.title,content:version.content,fields:authoring.fieldSchema,formSchema:{...schema,bindings:[]},answers:draft.answers,revision:Number(prepared.revision),state:prepared.state,completionPolicy:schema.completionPolicy,activeFieldKeys:draft.activeFieldKeys};
}
async function formDraft(client:QueryClient,t:TenantContext,access:any) {
    const request=await row(client,'document_requests',t,access.request_id);
    if(request.purpose!=='form_completion')throw new WorkflowError('FORM_REQUEST_REQUIRED',409);
    const item=(await client.query('SELECT * FROM document_request_items WHERE request_id=$1 FOR UPDATE',[request.id])).rows[0];
    if(!item?.prepared_document_id)throw new WorkflowError('FORM_REQUEST_UNAVAILABLE',409);
    const prepared=await row(client,'prepared_documents',t,item.prepared_document_id);
    if(prepared.state!=='draft')throw new WorkflowError('FROZEN_FORM_IMMUTABLE',409);
    const version=await row(client,'template_versions',t,prepared.template_version_id,false,true),policy=completionPolicy(version);
    if(request.form_completion_policy!==policy.schema.completionPolicy)throw new WorkflowError('FORM_POLICY_CONFLICT',409);
    return {request,item,prepared,version,...policy};
}
export async function patientFormAnswers(token:string,input:unknown,key:string,expectedRevision:number,requestId:string) {
    const p=body(input,['answers']);
    return patientTransaction(token,true,async(client,t,access)=>patientCommand(client,t,access,key,'patient_forms.answers',{...p,expectedRevision},async()=>{
        const {prepared,authoring}=await formDraft(client,t,access);checkRevision(prepared,expectedRevision);
        const draft=validateFormAnswers(authoring,p.answers,false),changed=await update(client,'prepared_documents',t,prepared.id,{answers:JSON.stringify(draft.answers)});
        await recordWorkflowAudit(client,t,{action:'patient_forms.answers.saved',entityType:'prepared_document',entityId:prepared.id,requestId,actorType:'patient_session',resources:[{resourceType:'prepared_document',resourceId:prepared.id,patientId:access.patient_id}],metadata:{revision:Number(changed.revision)},changes:[{resourceType:'prepared_document',resourceId:prepared.id,fieldPath:'answers',captureMode:'changed_only'}]});
        return {id:prepared.id,state:'draft',revision:Number(changed.revision),savedAt:new Date().toISOString()};
    }));
}
export async function publishCompletedPaperwork(client:QueryClient,_t:TenantContext,request:any,version:any,_requestId:string,options:{signed:boolean}) {
    return (await client.query('SELECT careiq_publish_completed_paperwork($1,$2,$3) AS result',[request.id,version.id,options.signed])).rows[0].result;
}
export async function patientFormFreeze(token:string,input:unknown,key:string,expectedRevision:number,requestId:string) {
    const p=body(input,[]),payload={...p,expectedRevision};key=requestKey(key);
    const receipt=(await pool.query('SELECT careiq_patient_command_receipt($1,$2) AS receipt',[sha256(Buffer.from(token)),key])).rows[0]?.receipt;
    if(receipt) {if(receipt.operation!=='patient_forms.freeze'||receipt.requestHash!==fingerprint({sessionId:receipt.sessionId,requestId:receipt.requestId,operation:'patient_forms.freeze',payload}))throw new WorkflowError('IDEMPOTENCY_KEY_REUSED',409);return receipt.response;}
    return patientTransaction(token,true,async(client,t,access)=>{
        const result=await patientCommand(client,t,access,key,'patient_forms.freeze',payload,async()=>{
            const {request,item,prepared,authoring,schema}=await formDraft(client,t,access);checkRevision(prepared,expectedRevision);
            validateFormAnswers(authoring,prepared.answers,true);
            if(schema.completionPolicy==='form_then_sign')await requireFormSignerAuthority(client,request.id);
            const frozen=await freezePrepared(client,t,prepared,{requestId,patientRequestId:request.id});
            if(new Date(request.expires_at).getTime()<=Date.now())throw new WorkflowError('PATIENT_LINK_UNAVAILABLE',410);
            await client.query('UPDATE document_request_items SET source_version_id=$2,revision=revision+1,updated_at=now() WHERE id=$1',[item.id,frozen.version.id]);
            if(schema.completionPolicy==='form_then_sign') {
                const packet=await insert(client,'signature_packets',t,{patient_id:access.patient_id,request_id:request.id,source_version_id:frozen.version.id,recipient_snapshot:JSON.stringify({name:request.recipient_name,role:'patient'}),consent_text_version:schema.signing.consentTextVersion,consent_text:schema.signing.consentText,consent_hash:sha256(Buffer.from(schema.signing.consentText))});
                const signatureFields=authoring.fieldSchema.filter(f=>f.type==='typed_signature');
                for(const field of signatureFields.length?signatureFields:[{key:'patient_signature',required:true}])await insert(client,'signature_fields',t,{patient_id:access.patient_id,packet_id:packet.id,field_key:field.key,page:1,x:.1,y:.75,width:.5,height:.1,field_type:'signature',required:field.required});
                await recordWorkflowAudit(client,t,{action:'patient_forms.frozen',entityType:'prepared_document',entityId:prepared.id,requestId,actorType:'patient_session',resources:[{resourceType:'document_version',resourceId:frozen.version.id,patientId:access.patient_id}],metadata:{documentVersionId:frozen.version.id,resultState:'ready_to_sign'}});
                return {id:request.id,state:'ready_to_sign',documentVersionId:frozen.version.id,packetId:packet.id,preparedRevision:Number(prepared.revision)+1,signed:false};
            }
            await client.query('UPDATE document_request_items SET fulfilled_version_id=$2,state=\'fulfilled\',is_open=false,revision=revision+1,updated_at=now() WHERE id=$1',[item.id,frozen.version.id]);
            const library=await publishCompletedPaperwork(client,t,request,frozen.version,requestId,{signed:false});
            return {id:request.id,state:'completed',documentVersionId:frozen.version.id,signed:false,...library};
        });
        if(result.state==='completed')await client.query("SELECT careiq_patient_close_request('completed')");
        return result;
    });
}

export async function staffPaperwork(t:TenantContext,patientId:string,requestId:string,options:{libraryCursor?:string;notificationCursor?:string}={}) {
    return scoped(t,async client=>{
        const patient=await row(client,'patients',t,id(patientId),false);
        const binding=(kind:string)=>fingerprint({kind,patientId:patient.id,practiceId:t.practiceId,locationId:t.locationId,actor:t.userId,membership:t.membershipId??null});
        const libraryCursor=paperworkCursorFrom(options.libraryCursor,binding('staff_library')),notificationCursor=paperworkCursorFrom(options.notificationCursor,binding('staff_notifications'));
        const library=(await client.query('SELECT id,document_version_id,document_id,title,version_number,signed,release_state,release_reason_code,completed_at,completed_at::text AS seek_time,revision FROM paperwork_library_items WHERE practice_id=$1 AND location_id=$2 AND patient_id=$3 AND ($4::timestamptz IS NULL OR (completed_at,id)<($4::timestamptz,$5::uuid)) ORDER BY completed_at DESC,id DESC LIMIT 101',[...scope(t),patient.id,libraryCursor?.time??null,libraryCursor?.id??null])).rows;
        const notifications=(await client.query('SELECT id,library_item_id,document_version_id,state,failure_code,provider_id,created_at,created_at::text AS seek_time,revision FROM paperwork_notifications WHERE practice_id=$1 AND location_id=$2 AND patient_id=$3 AND ($4::timestamptz IS NULL OR (created_at,id)<($4::timestamptz,$5::uuid)) ORDER BY created_at DESC,id DESC LIMIT 101',[...scope(t),patient.id,notificationCursor?.time??null,notificationCursor?.id??null])).rows;
        const page=(rows:any[],kind:string)=>{const visible=rows.slice(0,100),last=visible.at(-1);return{items:visible.map(({seek_time,...item})=>camel(item)),hasMore:rows.length>100,nextCursor:rows.length>100&&last?paperworkCursorFor({time:last.seek_time,id:last.id},binding(kind)):null};};
        const libraryPage=page(library,'staff_library'),notificationPage=page(notifications,'staff_notifications');
        await recordWorkflowAudit(client,t,{action:'paperwork.staff.read',entityType:'patient',entityId:patient.id,requestId,resources:[{resourceType:'patient',resourceId:patient.id,patientId:patient.id}],metadata:{count:libraryPage.items.length}});
        return {libraryItems:libraryPage.items,notifications:notificationPage.items,pagination:{libraryItems:{hasMore:libraryPage.hasMore,nextCursor:libraryPage.nextCursor},notifications:{hasMore:notificationPage.hasMore,nextCursor:notificationPage.nextCursor}}};
    },requestId,true);
}
export async function portalPaperwork(subject:string,sessionId:string,itemId?:string,cursor?:string) {
    const before=paperworkCursorFrom(cursor,fingerprint({kind:'portal_library',subject}));
    const client=await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.portal_subject',$1,true),set_config('app.portal_session',$2,true)",[subject,sessionId]);
        const items=(await client.query('SELECT careiq_portal_paperwork($1,$2,$3,$4) AS result',[itemId?id(itemId):null,Boolean(itemId),before?.time??null,before?.id??null])).rows[0]?.result ?? [];
        if(itemId) {
            const item=items[0];
            if(!item || item.releaseState!=='released' || item.fileStatus!=='available' || item.sha256!==item.storedHash)throw new WorkflowError('DOCUMENT_UNAVAILABLE',409);
            const bytes=await readPrivate(item.storageKey);
            if(sha256(bytes)!==item.sha256)throw new WorkflowError('STORAGE_INTEGRITY_FAILURE',503);
            await client.query('COMMIT');
            return {bytes,contentType:item.contentType,filename:item.filename};
        }
        const hasMore=items.length>100,selected=items.slice(0,100),last=selected.at(-1),visible=selected.map(({cursorTime,...item}:any)=>item);
        await client.query('COMMIT');return {items:visible,hasMore,nextCursor:hasMore&&last?paperworkCursorFor({time:last.cursorTime,id:last.id},fingerprint({kind:'portal_library',subject})):null};
    } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
}

export async function recordPortalPaperworkFailure(subject:string,sessionId:string,code:string,requestId:string) {
    const client=await pool.connect();
    try{await client.query('BEGIN');await client.query("SELECT set_config('app.portal_subject',$1,true),set_config('app.portal_session',$2,true)",[subject,sessionId]);const result=(await client.query('SELECT careiq_record_portal_failure($1,$2) AS id',[code,requestId])).rows[0].id;await client.query('COMMIT');return result as string;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
