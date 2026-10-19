import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Pool} from 'pg';
import {isolatedTestDatabaseUrl} from './local-test-database.js';
import {WorkflowError} from '../src/workflow/policy.js';

const url=isolatedTestDatabaseUrl();
const code=(expected:string)=>(error:unknown)=>error instanceof WorkflowError&&error.code===expected;

test('patient forms freeze exact answers and publish signed/unsigned copies behind explicit account binding', {skip:!url},async context=>{
    const admin=new Pool({connectionString:url,ssl:false}),role='careiq_paperwork_test_'+randomUUID().replaceAll('-',''),password=randomUUID();
    const storage=await mkdtemp(join(tmpdir(),'careiq-paperwork-'));
    const practiceId=randomUUID(),locationId=randomUUID(),userId='user_Staff'+randomUUID().replaceAll('-',''),subject='user_Patient'+randomUUID().replaceAll('-',''),membershipId='membership_'+randomUUID();
    const tenant={practiceId,locationId,userId,membershipId,orgId:'org_'+randomUUID()};
    const old={url:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL_MODE,storage:process.env.CAREIQ_PRIVATE_STORAGE_DIR};
    let runtimePool:Pool|undefined;
    try {
        await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
        await admin.query(`GRANT careiq_clinical_runtime TO ${role}`);
        await admin.query("INSERT INTO practices(id,clerk_org_id,name,authorization_mode,status) VALUES($1,$2,'Synthetic paperwork','location','active')",[practiceId,tenant.orgId]);
        await admin.query("INSERT INTO locations(id,practice_id,name,time_zone) VALUES($1,$2,'Synthetic paperwork','UTC')",[locationId,practiceId]);
        await admin.query("INSERT INTO practice_member_access(practice_id,user_id,membership_id,status) VALUES($1,$2,$3,'active')",[practiceId,userId,membershipId]);
        await admin.query("INSERT INTO location_assignments(practice_id,user_id,location_id,active,granted_by) VALUES($1,$2,$3,true,$2)",[practiceId,userId,locationId]);
        const runtimeUrl=new URL(url!);runtimeUrl.username=role;runtimeUrl.password=password;
        process.env.DATABASE_URL=runtimeUrl.href;process.env.DATABASE_SSL_MODE='disable';process.env.CAREIQ_PRIVATE_STORAGE_DIR=storage;
        const service=await import('../src/services/workflow.service.js'),paperwork=await import('../src/services/patient-paperwork.service.js');
        ({pool:runtimePool}=await import('../src/db/client.js'));
        const ctx=(expectedRevision?:number)=>({requestId:randomUUID(),idempotencyKey:randomUUID(),expectedRevision});
        const run=(action:string,target:string,input:unknown,expectedRevision?:number)=>service.execute(tenant,action,target,input,ctx(expectedRevision));
        const patient=(await run('patients.create','',{firstName:'Synthetic',lastName:'Paperwork',dateOfBirth:'1980-01-01'})).id as string;
        const type=(await run('document-types.create','',{code:'paperwork',name:'Synthetic paperwork'})).id as string;
        const authoring=(signed:boolean,emailCopy=true)=>({schemaVersion:2,content:'Synthetic legal content, frozen at publication.',fieldSchema:[{key:'patient_name',label:'Patient name',type:'text',required:true},{key:'has_detail',label:'Add detail?',type:'checkbox',required:false},{key:'detail',label:'Detail',type:'text',required:false},...(signed?[{key:'patient_signature',label:'Patient signature',type:'typed_signature',required:true,signerRole:'patient'}]:[])],formSchema:{mode:'guided',defaultLocale:'en',completionPolicy:signed?'form_then_sign':'form_only',sections:[],rules:[{id:'detail_rule',targetFieldKey:'detail',sourceFieldKey:'has_detail',operator:'checked'}],bindings:[{fieldKey:'patient_name',destination:'patient.preferredName',reviewRequired:true}],signing:signed?{roles:[{key:'patient',label:'Patient',required:true}],consentText:'Synthetic electronic signature consent with explicit intent.',consentTextVersion:'synthetic-consent-v1'}:{roles:[]},delivery:{emailCopy}}});
        const publish=async(signed:boolean,emailCopy=true)=>{const template=await run('templates.create','',{documentTypeId:type,title:signed?'Synthetic signed form':'Synthetic submitted form',...authoring(signed,emailCopy)});await run('templates.publication',String(template.id),{expectedDraftRevision:1},1);return(await admin.query('SELECT published_version_id FROM document_templates WHERE id=$1',[template.id])).rows[0].published_version_id as string;};
        let grantId='',unsignedVersion='',unsignedItem='',signedVersion='';
        await context.test('private calendar rule covers exact birthday/upper-bound/leap-day edges without runtime clock overrides',async()=>{
            for(const [dob,zone,at,expected] of [
                ['2008-10-18','America/Los_Angeles','2026-10-18T00:30:00Z',false],
                ['2008-10-18','UTC','2026-10-18T00:30:00Z',true],
                ['2008-10-18','America/Los_Angeles','2026-10-18T07:00:00Z',true],
                ['2008-10-18','Asia/Tokyo','2026-10-17T15:00:00Z',true],
                ['1896-10-18','America/Los_Angeles','2026-10-18T00:30:00Z',true],
                ['1896-10-18','America/Los_Angeles','2026-10-18T07:00:00Z',false],
                ['2008-02-29','America/Los_Angeles','2026-02-28T20:00:00Z',false],
                ['2008-02-29','America/Los_Angeles','2026-03-01T08:00:00Z',true],
            ] as const)assert.equal((await admin.query('SELECT careiq_adult_self_eligible_at($1::date,$2,$3::timestamptz) AS eligible',[dob,zone,at])).rows[0].eligible,expected);
            assert.equal((await admin.query('SELECT has_function_privilege($1,$2,$3) AS allowed',[role,'public.careiq_adult_self_eligible_at(date,text,timestamptz)','EXECUTE'])).rows[0].allowed,false);
            await assert.rejects(runtimePool!.query("SELECT careiq_adult_self_eligible_at('2008-10-18','UTC','2026-10-18T00:30Z')"),error=>(error as {code?:string}).code==='42501');
        });
        await context.test('staff attestation binds one adult account, while unrelated authenticated accounts see no paperwork',async()=>{
            const grant=await run('paperwork.portal.bind',patient,{clerkUserId:subject,relationship:'self',verificationMethod:'staff_in_person',verificationReference:'Synthetic in-person identity verification',verifiedEmail:'synthetic@example.test',emailDestinationVerified:true,paperworkEmailEnabled:true});grantId=String(grant.id);
            const {staffPortalGrants}=await import('../src/services/portal-admin.service.js');const managed=await staffPortalGrants(tenant,patient,randomUUID());assert.equal(managed.items.length,1);assert.equal(managed.items[0].clerkUserId,subject);assert.equal(managed.adultSelfEligible,true);assert.equal(Object.hasOwn(managed.items[0],'verifiedEmail'),false);assert.equal(Object.hasOwn(managed.items[0],'verificationReference'),false);
            const otherPatient=(await run('patients.create','',{firstName:'Synthetic',lastName:'Other adult',dateOfBirth:'1985-01-01'})).id as string;assert.deepEqual((await staffPortalGrants(tenant,otherPatient,randomUUID())).items,[]);
            await assert.rejects(staffPortalGrants({...tenant,locationId:randomUUID()},patient,randomUUID()),code('LOCATION_ACCESS_DENIED'));
            assert.deepEqual((await paperwork.portalPaperwork('user_UnrelatedAccount','sess_UnrelatedAccount')).items,[]);
            const minor=(await run('patients.create','',{firstName:'Synthetic',lastName:'Minor',dateOfBirth:'2020-01-01'})).id as string;
            await assert.rejects(run('paperwork.portal.bind',minor,{clerkUserId:'user_MinorAccount',relationship:'self',verificationMethod:'staff_in_person',verificationReference:'Synthetic'}),code('ADULT_SELF_ACCESS_REQUIRED'));
            await assert.rejects(run('paperwork.portal.bind',patient,{clerkUserId:'user_ProxyAccount',relationship:'guardian',verificationMethod:'staff_in_person',verificationReference:'Synthetic'}),code('REPRESENTATIVE_AUTHORITY_UNAVAILABLE'));
        });
        await context.test('draft saves enforce revision/applicability and freeze is idempotent, immutable and honestly unsigned',async()=>{
            const version=await publish(false),request=await run('paperwork.requests.create','',{patientId:patient,templateVersionId:version,recipient:{name:'Synthetic Patient',channel:'local_review'}});
            const templateId=(await admin.query('SELECT template_id FROM template_versions WHERE id=$1',[version])).rows[0].template_id;
            await run('templates.update',templateId,{title:'Renamed logical template',active:false},2);
            await assert.rejects(run('paperwork.requests.create','',{patientId:patient,templateVersionId:version,recipient:{name:'Synthetic Patient',channel:'local_review'}}),code('PUBLISHED_TEMPLATE_REQUIRED'));
            const session=await service.exchangePatientSession({token:String(request.localReviewPath).split('=')[1]},randomUUID());
            const projection=await service.patientRequest(session.sessionToken,randomUUID());assert.equal(projection.form?.state,'draft');assert.equal(projection.form?.title,'Synthetic submitted form');assert.equal(projection.signature,null);
            await assert.rejects(paperwork.patientFormFreeze(session.sessionToken,{},randomUUID(),1,randomUUID()),code('REQUIRED_FIELD'));
            await assert.rejects(paperwork.patientFormAnswers(session.sessionToken,{answers:{patient_name:'Synthetic',unknown:'not allowed'}},randomUUID(),1,randomUUID()),code('UNKNOWN_ANSWER_FIELD'));
            const saved=await paperwork.patientFormAnswers(session.sessionToken,{answers:{patient_name:'Synthetic report',has_detail:false,detail:'Inactive private value'}},randomUUID(),1,randomUUID());assert.equal(saved.revision,2);assert.equal(Object.hasOwn(saved,'answers'),false);assert.equal(Object.hasOwn((await admin.query('SELECT answers FROM prepared_documents WHERE id=$1',[saved.id])).rows[0].answers,'detail'),false);
            await assert.rejects(paperwork.patientFormAnswers(session.sessionToken,{answers:{patient_name:'Stale'}},randomUUID(),1,randomUUID()),code('REVISION_CONFLICT'));
            const key=randomUUID(),frozen=await paperwork.patientFormFreeze(session.sessionToken,{},key,2,randomUUID());unsignedVersion=String(frozen.documentVersionId);unsignedItem=String(frozen.libraryItemId);assert.equal(frozen.state,'completed');assert.equal(frozen.signed,false);assert.equal(frozen.notificationState,'needs_attention');assert.equal(frozen.failureCode,'DELIVERY_PROVIDER_UNAVAILABLE');
            const replay=await paperwork.patientFormFreeze(session.sessionToken,{},key,2,randomUUID());assert.equal(replay.documentVersionId,unsignedVersion);
            const freezeReceiptAudit=(await admin.query("SELECT authorization_context FROM audit.events WHERE entity_id=$1 AND action='patient_commands.receipt_access'",[request.id])).rows;assert.ok(freezeReceiptAudit.length>0);for(const event of freezeReceiptAudit){assert.equal(event.authorization_context.verificationMethod,'patient_request_link');assert.equal(event.authorization_context.assurance,'link_possession');}
            await assert.rejects(paperwork.patientFormFreeze(session.sessionToken,{},key,3,randomUUID()),code('IDEMPOTENCY_KEY_REUSED'));
            assert.equal((await admin.query('SELECT count(*) FROM paperwork_library_items WHERE document_version_id=$1',[unsignedVersion])).rows[0].count,'1');
            const saveReceipts=(await admin.query("SELECT response FROM workflow_request_keys WHERE target_id=$1 AND operation='patient_forms.answers'",[request.id])).rows;assert.equal(saveReceipts.length,1);assert.equal(Object.hasOwn(saveReceipts[0].response,'answers'),false);assert.equal(JSON.stringify(saveReceipts[0].response).includes('Synthetic report'),false);
            const submission=(await admin.query('SELECT answers FROM form_submissions WHERE document_version_id=$1',[unsignedVersion])).rows[0];assert.deepEqual(submission.answers,{patient_name:'Synthetic report',has_detail:false});
            const candidates=(await admin.query('SELECT state FROM form_change_candidates WHERE request_id=$1',[request.id])).rows;assert.equal(candidates.length,1);assert.equal(candidates[0].state,'pending');
            assert.equal((await admin.query('SELECT preferred_name FROM patients WHERE id=$1',[patient])).rows[0].preferred_name,null);
            await assert.rejects(service.patientRequest(session.sessionToken,randomUUID()),code('PATIENT_LINK_UNAVAILABLE'));
        });
        await context.test('account library returns the exact frozen version and never exposes byte pointers in list DTOs',async()=>{
            const listed=await paperwork.portalPaperwork(subject,'sess_VerifiedPatient');assert.equal(listed.items?.length,1);assert.equal(listed.items?.[0].documentVersionId,unsignedVersion);assert.equal(listed.items?.[0].signed,false);assert.equal(Object.hasOwn(listed.items?.[0]??{},'storageKey'),false);assert.equal(Object.hasOwn(listed.items?.[0]??{},'cursorTime'),false);
            const content=await paperwork.portalPaperwork(subject,'sess_VerifiedPatient',unsignedItem);assert.ok(content.bytes?.subarray(0,5).equals(Buffer.from('%PDF-')));
            await assert.rejects(paperwork.portalPaperwork('user_UnrelatedAccount','sess_UnrelatedAccount',unsignedItem),error=>(error as {code?:string}).code==='42501');
        });
        await context.test('new patient-only signing rejects unsupported age/authority at dispatch, freeze and acknowledgement',async()=>{
            const version=await publish(true);
            for(const info of [{firstName:'Synthetic',lastName:'Minor signer',dateOfBirth:'2020-01-01'},{firstName:'Synthetic',lastName:'Unknown authority'}]) {
                const unsupported=String((await run('patients.create','',info)).id);
                await assert.rejects(run('paperwork.requests.create','',{patientId:unsupported,templateVersionId:version,recipient:{name:'Synthetic',channel:'local_review'}}),code('SIGNER_AUTHORITY_UNAVAILABLE'));
                assert.equal((await admin.query('SELECT count(*) FROM document_requests WHERE patient_id=$1',[unsupported])).rows[0].count,'0');
            }
            const respondent=String((await run('patients.create','',{firstName:'Synthetic',lastName:'Authority changed',dateOfBirth:'1980-01-01'})).id);
            const request=await run('paperwork.requests.create','',{patientId:respondent,templateVersionId:version,recipient:{name:'Synthetic',channel:'local_review'}}),session=await service.exchangePatientSession({token:String(request.localReviewPath).split('=')[1]},randomUUID());
            await paperwork.patientFormAnswers(session.sessionToken,{answers:{patient_name:'Synthetic authority',has_detail:false}},randomUUID(),1,randomUUID());
            await run('patients.update',respondent,{dateOfBirth:'2020-01-01'},1);
            await assert.rejects(paperwork.patientFormFreeze(session.sessionToken,{},randomUUID(),2,randomUUID()),code('SIGNER_AUTHORITY_UNAVAILABLE'));
            assert.equal((await admin.query('SELECT count(*) FROM signature_packets WHERE request_id=$1',[request.id])).rows[0].count,'0');
            await run('patients.update',respondent,{dateOfBirth:'1980-01-01'},2);
            await paperwork.patientFormFreeze(session.sessionToken,{},randomUUID(),2,randomUUID());
            const current=await service.patientRequest(session.sessionToken,randomUUID()),payload={expectedRevision:current.signature!.revision,sourceSha256:current.signature!.sourceSha256,consent:{accepted:true,textVersion:current.signature!.consentTextVersion},fields:[{key:'patient_signature',type:'typed_signature',value:'Synthetic authority'}]};
            await run('patients.update',respondent,{dateOfBirth:'2020-01-01'},3);
            await assert.rejects(service.patientCompletion(session.sessionToken,payload,randomUUID(),randomUUID()),code('SIGNER_AUTHORITY_UNAVAILABLE'));
            await run('patients.update',respondent,{dateOfBirth:'1980-01-01',archived:true},4);
            await assert.rejects(service.patientCompletion(session.sessionToken,payload,randomUUID(),randomUUID()),code('SIGNER_AUTHORITY_UNAVAILABLE'));
            const packet=(await admin.query('SELECT state,output_version_id FROM signature_packets WHERE request_id=$1',[request.id])).rows[0];assert.equal(packet.state,'pending');assert.equal(packet.output_version_id,null);
            assert.equal((await admin.query('SELECT count(*) FROM paperwork_library_items WHERE request_id=$1',[request.id])).rows[0].count,'0');
        });
        await context.test('signing becomes available only after freeze and completion waits for required signature evidence',async()=>{
            const version=await publish(true),request=await run('paperwork.requests.create','',{patientId:patient,templateVersionId:version,recipient:{name:'Synthetic Patient',channel:'local_review'}}),session=await service.exchangePatientSession({token:String(request.localReviewPath).split('=')[1]},randomUUID());
            assert.equal((await service.patientRequest(session.sessionToken,randomUUID())).signature,null);
            const sessionFact=(await admin.query('SELECT id,verification_method,assurance FROM patient_sessions WHERE request_id=$1',[request.id])).rows[0];assert.equal(sessionFact.verification_method,'patient_request_link');assert.equal(sessionFact.assurance,'link_possession');const sessionAudit=(await admin.query("SELECT metadata FROM audit.events WHERE entity_id=$1 AND action='patient_sessions.exchanged'",[sessionFact.id])).rows[0].metadata;assert.equal(sessionAudit.verificationMethod,'patient_request_link');assert.equal(sessionAudit.assurance,'link_possession');
            await assert.rejects(service.patientCompletion(session.sessionToken,{expectedRevision:1,sourceSha256:'a'.repeat(64),consent:{accepted:true,textVersion:'synthetic-consent-v1'},fields:[{key:'patient_signature',type:'typed_signature',value:'Synthetic'}]},randomUUID(),randomUUID()),error=>error instanceof WorkflowError);
            await paperwork.patientFormAnswers(session.sessionToken,{answers:{patient_name:'Synthetic signer',has_detail:false}},randomUUID(),1,randomUUID());
            const frozen=await paperwork.patientFormFreeze(session.sessionToken,{},randomUUID(),2,randomUUID());assert.equal(frozen.state,'ready_to_sign');assert.equal((await admin.query('SELECT state FROM document_requests WHERE id=$1',[request.id])).rows[0].state,'open');
            const current=await service.patientRequest(session.sessionToken,randomUUID());assert.ok(current.signature?.sourceSha256);assert.equal(current.form?.state,'ready');
            const legacyAppointment=randomUUID(),legacyRequirement=randomUUID();await admin.query("INSERT INTO appointments(id,practice_id,location_id,patient_id,scheduled_at) VALUES($1,$2,$3,$4,now()+interval '1 day')",[legacyAppointment,practiceId,locationId,patient]);
            await admin.query("INSERT INTO visit_requirements(id,practice_id,location_id,patient_id,appointment_id,document_type_id,label_snapshot,signature_required) VALUES($1,$2,$3,$4,$5,$6,'Synthetic required signature',true)",[legacyRequirement,practiceId,locationId,patient,legacyAppointment,type]);
            await assert.rejects(run('requests.create',patient,{patientId:patient,appointmentId:legacyAppointment,purpose:'signature',items:[{requirementId:legacyRequirement,sourceDocumentVersionId:frozen.documentVersionId}],recipient:{name:'Synthetic',channel:'local_review'}}),code('FORM_COMPLETION_REQUEST_REQUIRED'));
            await assert.rejects(paperwork.patientFormAnswers(session.sessionToken,{answers:{patient_name:'Changed'}},randomUUID(),3,randomUUID()),code('FROZEN_FORM_IMMUTABLE'));
            const payload={expectedRevision:current.signature!.revision,sourceSha256:current.signature!.sourceSha256,consent:{accepted:true,textVersion:current.signature!.consentTextVersion},fields:[{key:'patient_signature',type:'typed_signature',value:'Synthetic signer'}]};
            await assert.rejects(service.patientCompletion(session.sessionToken,{...payload,consent:{...payload.consent,accepted:false}},randomUUID(),randomUUID()),code('CONSENT_REQUIRED'));
            const completionKey=randomUUID(),completed=await service.patientCompletion(session.sessionToken,payload,completionKey,randomUUID());signedVersion=String(completed.documentVersionId);assert.equal(completed.state,'completed');assert.equal(completed.certificateSignatureApplied,false);
            assert.equal((await service.patientCompletion(session.sessionToken,payload,completionKey,randomUUID())).documentVersionId,signedVersion);
            const signatureReceiptAudit=(await admin.query("SELECT authorization_context FROM audit.events WHERE entity_id=$1 AND action='signatures.completion.receipt_access'",[request.id])).rows;assert.ok(signatureReceiptAudit.length>0);for(const event of signatureReceiptAudit){assert.equal(event.authorization_context.verificationMethod,'patient_request_link');assert.equal(event.authorization_context.assurance,'link_possession');}
            const item=(await admin.query('SELECT * FROM paperwork_library_items WHERE document_version_id=$1',[signedVersion])).rows[0];assert.equal(item.signed,true);assert.notEqual(signedVersion,frozen.documentVersionId);
            const object=(await admin.query('SELECT f.* FROM signature_packets p JOIN file_objects f ON f.id=p.evidence_object_id WHERE p.request_id=$1',[request.id])).rows[0];
            const {readPrivate,storePrivate,sha256}=await import('../src/workflow/storage.js'),{fingerprint}=await import('../src/workflow/policy.js');
            const retained=await readPrivate(object.storage_key),evidence=JSON.parse(retained.toString());assert.equal(evidence.schemaVersion,2);assert.equal(sha256(retained),object.sha256);
            const {auditEventId,decisionHash,...decision}=evidence.authorityDecision;
            assert.equal(decision.policyVersion,'careiq-adult-self-location-calendar-v1');assert.equal(decision.decision,'eligible');assert.equal(decision.independentIdentityVerification,false);assert.equal(decision.minimumAge,18);assert.equal(decision.maximumAgeExclusive,130);assert.ok(Number.isFinite(Date.parse(decision.evaluatedAt)));assert.equal(decisionHash,fingerprint(decision));
            assert.equal(decision.practiceId,practiceId);assert.equal(decision.locationId,locationId);assert.equal(decision.patientId,patient);assert.equal(decision.requestId,request.id);assert.equal(decision.sourceVersionId,frozen.documentVersionId);assert.equal(decision.sourceSha256,current.signature!.sourceSha256);assert.equal(Object.hasOwn(decision,'dateOfBirth'),false);assert.equal(evidence.assurance,'link_possession');assert.equal(current.signature!.verificationMethod,'patient_request_link');assert.equal(evidence.verificationMethod,'patient_request_link');assert.equal(Object.hasOwn(evidence,'emailDelivered'),false);assert.equal(Object.hasOwn(evidence,'identityVerified'),false);
            const authority=(await admin.query('SELECT action,metadata,authorization_context FROM audit.events WHERE id=$1',[auditEventId])).rows[0];assert.equal(authority.action,'signatures.authority.verified');assert.equal(authority.metadata.policyVersion,decision.policyVersion);assert.equal(authority.authorization_context.evaluatedAt,decision.evaluatedAt);assert.equal(Object.hasOwn(authority.metadata,'patientId'),false);
            const event=(await admin.query("SELECT * FROM signature_events WHERE packet_id=$1 AND event_type='completed'",[current.signature!.packetId])).rows[0];assert.deepEqual(event.evidence_metadata.authorityDecision,evidence.authorityDecision);assert.equal((await admin.query('SELECT causation_event_id FROM audit.events WHERE id=$1',[event.audit_event_id])).rows[0].causation_event_id,auditEventId);const completionAudit=(await admin.query('SELECT metadata FROM audit.events WHERE id=$1',[event.audit_event_id])).rows[0].metadata;assert.equal(completionAudit.verificationMethod,'patient_request_link');assert.equal(completionAudit.assurance,'link_possession');
            // Current demographics may change; protected completion facts and private evidence remain exact.
            await admin.query("UPDATE patients SET date_of_birth='2015-01-01' WHERE id=$1",[patient]);
            try {assert.deepEqual(await readPrivate(object.storage_key),retained);assert.deepEqual((await admin.query('SELECT evidence_metadata FROM signature_events WHERE id=$1',[event.id])).rows[0].evidence_metadata.authorityDecision,evidence.authorityDecision);} finally {await admin.query("UPDATE patients SET date_of_birth='1980-01-01' WHERE id=$1",[patient]);}
            await assert.rejects(storePrivate(object.storage_key,Buffer.from('{}')),code('IMMUTABLE_OBJECT_CONFLICT'));
            await assert.rejects(admin.query("UPDATE signature_events SET evidence_metadata='{}' WHERE id=$1",[event.id]),(error:any)=>error.code==='23514'&&error.message==='IMMUTABLE_WORKFLOW_FACT');
            await assert.rejects(admin.query("UPDATE audit.events SET metadata='{}' WHERE id=$1",[auditEventId]),(error:any)=>error.code==='23514'&&error.message==='IMMUTABLE_WORKFLOW_FACT');
            assert.equal((await admin.query('SELECT count(*) FROM outbox_events WHERE event_type=$1 AND aggregate_id IN(SELECT id FROM paperwork_notifications WHERE request_id=$2)',['paperwork.notification.requested',request.id])).rows[0].count,'1');
        });
        await context.test('voided and superseded copies retain history while every direct byte request is denied and auditable',async()=>{
            const signedItem=(await admin.query('SELECT id FROM paperwork_library_items WHERE document_version_id=$1',[signedVersion])).rows[0].id;
            for(const [itemId,releaseState] of [[unsignedItem,'voided'],[signedItem,'superseded']]) {
                await run('paperwork.library.release',itemId,{releaseState,reasonCode:'synthetic_standing_change'},1);
                const listed=await paperwork.portalPaperwork(subject,'sess_VerifiedPatient');assert.equal(listed.items?.find((item:any)=>item.id===itemId)?.releaseState,releaseState);
                await assert.rejects(paperwork.portalPaperwork(subject,'sess_VerifiedPatient',itemId),error=>(error as {code?:string}).code==='42501');
            }
            const eventId=await paperwork.recordPortalPaperworkFailure(subject,'sess_VerifiedPatient','PAPERWORK_COPY_NOT_FOUND',randomUUID());
            const event=(await admin.query('SELECT scope_kind,actor_type,actor_id,outcome,reason_code FROM audit.events WHERE id=$1',[eventId])).rows[0];
            assert.deepEqual(event,{scope_kind:'platform',actor_type:'user',actor_id:subject,outcome:'denied',reason_code:'PAPERWORK_COPY_NOT_FOUND'});
            assert.equal((await admin.query('SELECT count(*) FROM audit.event_resources WHERE event_id=$1',[eventId])).rows[0].count,'0');
        });
        await context.test('binding, library, retry, staff eligibility and signing all use the current location calendar',async()=>{
            const dates=(await admin.query("WITH clock AS MATERIALIZED(SELECT clock_timestamp() AS value) SELECT (value AT TIME ZONE 'UTC')::date::text AS utc_date,(value AT TIME ZONE 'Pacific/Kiritimati')::date::text AS east_date FROM clock")).rows[0];
            const zone=dates.east_date!==dates.utc_date?'Pacific/Kiritimati':'Etc/GMT+12';
            await admin.query('UPDATE locations SET time_zone=$2 WHERE id=$1',[locationId,zone]);
            try {
                const birth=(await admin.query("WITH clock AS MATERIALIZED(SELECT (clock_timestamp() AT TIME ZONE $1)::date AS value) SELECT (value-interval '18 years')::date::text AS adult,(value+1-interval '18 years')::date::text AS premature,(value-interval '130 years')::date::text AS upper FROM clock",[zone])).rows[0];
                const calendarSubject='user_Calendar'+randomUUID().replaceAll('-',''),respondent=String((await run('patients.create','',{firstName:'Synthetic',lastName:'Calendar boundary',dateOfBirth:birth.adult})).id);
                const binding={clerkUserId:calendarSubject,relationship:'self',verificationMethod:'staff_in_person',verificationReference:'Synthetic calendar identity verification',verifiedEmail:'calendar@example.test',emailDestinationVerified:true,paperworkEmailEnabled:true};
                await assert.rejects(run('paperwork.portal.bind',respondent,{...binding,checkedAt:'2099-01-01T00:00:00Z'}),code('UNKNOWN_FIELD'));
                await run('paperwork.portal.bind',respondent,binding);
                const {staffPortalGrants}=await import('../src/services/portal-admin.service.js');assert.equal((await staffPortalGrants(tenant,respondent,randomUUID())).adultSelfEligible,true);
                const unsignedTemplate=await publish(false),unsignedRequest=await run('paperwork.requests.create','',{patientId:respondent,templateVersionId:unsignedTemplate,recipient:{name:'Synthetic calendar',channel:'local_review'}}),unsignedSession=await service.exchangePatientSession({token:String(unsignedRequest.localReviewPath).split('=')[1]},randomUUID());
                await paperwork.patientFormAnswers(unsignedSession.sessionToken,{answers:{patient_name:'Synthetic calendar',has_detail:false}},randomUUID(),1,randomUUID());
                const completed=await paperwork.patientFormFreeze(unsignedSession.sessionToken,{},randomUUID(),2,randomUUID()),copyId=String(completed.libraryItemId);
                assert.equal((await paperwork.portalPaperwork(calendarSubject,'sess_CalendarPatient')).items?.length,1);assert.ok((await paperwork.portalPaperwork(calendarSubject,'sess_CalendarPatient',copyId)).bytes);
                const notification=(await admin.query('SELECT id FROM paperwork_notifications WHERE request_id=$1',[unsignedRequest.id])).rows[0].id;
                const signedTemplate=await publish(true),signRequest=await run('paperwork.requests.create','',{patientId:respondent,templateVersionId:signedTemplate,recipient:{name:'Synthetic calendar',channel:'local_review'}}),signSession=await service.exchangePatientSession({token:String(signRequest.localReviewPath).split('=')[1]},randomUUID());
                await paperwork.patientFormAnswers(signSession.sessionToken,{answers:{patient_name:'Synthetic calendar',has_detail:false}},randomUUID(),1,randomUUID());
                await run('patients.update',respondent,{dateOfBirth:birth.premature},1);
                assert.equal((await staffPortalGrants(tenant,respondent,randomUUID())).adultSelfEligible,false);
                await assert.rejects(run('paperwork.portal.bind',respondent,{...binding,clerkUserId:'user_DifferentCalendarAccount'}),code('ADULT_SELF_ACCESS_REQUIRED'));
                assert.deepEqual((await paperwork.portalPaperwork(calendarSubject,'sess_CalendarPatient')).items,[]);await assert.rejects(paperwork.portalPaperwork(calendarSubject,'sess_CalendarPatient',copyId),error=>(error as {code?:string}).code==='42501');
                const suppressed=await run('paperwork.notifications.retry',notification,{},1);assert.equal(suppressed.state,'suppressed');assert.equal(suppressed.failureCode,'PATIENT_PORTAL_ACCESS_UNAVAILABLE');
                await assert.rejects(run('paperwork.requests.create','',{patientId:respondent,templateVersionId:signedTemplate,recipient:{name:'Synthetic calendar',channel:'local_review'}}),code('SIGNER_AUTHORITY_UNAVAILABLE'));
                await assert.rejects(paperwork.patientFormFreeze(signSession.sessionToken,{},randomUUID(),2,randomUUID()),code('SIGNER_AUTHORITY_UNAVAILABLE'));
                await run('patients.update',respondent,{dateOfBirth:birth.adult},2);
                assert.equal((await staffPortalGrants(tenant,respondent,randomUUID())).adultSelfEligible,true);assert.equal((await paperwork.portalPaperwork(calendarSubject,'sess_CalendarPatient')).items?.length,1);assert.ok((await paperwork.portalPaperwork(calendarSubject,'sess_CalendarPatient',copyId)).bytes);
                const retried=await run('paperwork.notifications.retry',notification,{},2);assert.equal(retried.state,'suppressed');assert.equal(retried.failureCode,'CONFIRMED_ENDPOINT_REQUIRED');assert.equal(typeof retried.deliveryIntentId,'string');
                await paperwork.patientFormFreeze(signSession.sessionToken,{},randomUUID(),2,randomUUID());
                const current=await service.patientRequest(signSession.sessionToken,randomUUID()),payload={expectedRevision:current.signature!.revision,sourceSha256:current.signature!.sourceSha256,consent:{accepted:true,textVersion:current.signature!.consentTextVersion},fields:[{key:'patient_signature',type:'typed_signature',value:'Synthetic calendar'}]};
                await run('patients.update',respondent,{dateOfBirth:birth.upper},3);
                assert.equal((await staffPortalGrants(tenant,respondent,randomUUID())).adultSelfEligible,false);assert.deepEqual((await paperwork.portalPaperwork(calendarSubject,'sess_CalendarPatient')).items,[]);await assert.rejects(service.patientCompletion(signSession.sessionToken,payload,randomUUID(),randomUUID()),code('SIGNER_AUTHORITY_UNAVAILABLE'));
                await run('patients.update',respondent,{dateOfBirth:birth.adult},4);
                assert.equal((await service.patientCompletion(signSession.sessionToken,payload,randomUUID(),randomUUID())).state,'completed');
            } finally {await admin.query("UPDATE locations SET time_zone='UTC' WHERE id=$1",[locationId]);}
        });
        await context.test('publication follows latest active SMS paperwork permission independently of frozen email-copy choice',async()=>{
            const respondent=String((await run('patients.create','',{firstName:'Synthetic',lastName:'SMS paperwork',dateOfBirth:'1980-01-01'})).id),endpoint=randomUUID();
            await run('paperwork.portal.bind',respondent,{clerkUserId:'user_SmsPaperwork'+randomUUID().replaceAll('-',''),relationship:'self',verificationMethod:'staff_in_person',verificationReference:'Synthetic SMS paperwork identity verification'});
            await admin.query("INSERT INTO communication_endpoints(id,practice_id,location_id,patient_id,channel,address,address_fingerprint,verification_reference,verified_by_actor_id,time_zone) VALUES($1,$2,$3,$4,'sms','+12025550123',$5,'Synthetic verified SMS destination',$6,'UTC')",[endpoint,practiceId,locationId,respondent,'a'.repeat(64),userId]);
            const permission=async(purpose:string,allowed:boolean)=>admin.query("INSERT INTO communication_permission_events(practice_id,location_id,patient_id,endpoint_id,purpose,allowed,source,actor_user_id,verification_reference) VALUES($1,$2,$3,$4,$5,$6,'staff_verified',$7,'Synthetic explicit permission')",[practiceId,locationId,respondent,endpoint,purpose,allowed,userId]);
            const version=await publish(false,false);
            const complete=async()=>{
                const request=await run('paperwork.requests.create','',{patientId:respondent,templateVersionId:version,recipient:{name:'Synthetic SMS patient',channel:'local_review'}}),session=await service.exchangePatientSession({token:String(request.localReviewPath).split('=')[1]},randomUUID());
                await paperwork.patientFormAnswers(session.sessionToken,{answers:{patient_name:'Synthetic SMS patient',has_detail:false}},randomUUID(),1,randomUUID());
                const key=randomUUID(),frozen=await paperwork.patientFormFreeze(session.sessionToken,{},key,2,randomUUID());
                assert.equal(frozen.state,'completed');assert.equal(frozen.signed,false);
                assert.equal((await admin.query('SELECT count(*) FROM paperwork_library_items WHERE document_version_id=$1',[frozen.documentVersionId])).rows[0].count,'1');
                const notifications=(await admin.query('SELECT id,channel,state,failure_code FROM paperwork_notifications WHERE request_id=$1',[request.id])).rows;
                return {request,session,key,frozen,notifications};
            };
            await permission('request',true);
            const noConsent=await complete();assert.equal(noConsent.frozen.notificationState,'not_requested');assert.equal(noConsent.notifications.length,0);
            await permission('paperwork',true);
            const optedIn=await complete();assert.equal(optedIn.frozen.notificationState,'needs_attention');assert.equal(optedIn.frozen.failureCode,'DELIVERY_PROVIDER_UNAVAILABLE');assert.equal(optedIn.notifications.length,1);assert.equal(optedIn.notifications[0].channel,'sms');
            const replay=await paperwork.patientFormFreeze(optedIn.session.sessionToken,{},optedIn.key,2,randomUUID());assert.equal(replay.libraryItemId,optedIn.frozen.libraryItemId);
            assert.equal((await admin.query("SELECT count(*) FROM outbox_events WHERE event_type='paperwork.notification.requested' AND aggregate_id=$1",[optedIn.notifications[0].id])).rows[0].count,'1');
            await permission('paperwork',false);
            const withdrawn=await complete();assert.equal(withdrawn.frozen.notificationState,'not_requested');assert.equal(withdrawn.notifications.length,0);
            await permission('paperwork',true);await admin.query("UPDATE communication_endpoints SET status='invalid' WHERE id=$1",[endpoint]);
            const inactive=await complete();assert.equal(inactive.frozen.notificationState,'not_requested');assert.equal(inactive.notifications.length,0);
        });
        await context.test('database grants prevent fabricated library copies and revoked binding stops historical byte access immediately',async()=>{
            const client=await runtimePool!.connect();try{await client.query('BEGIN');await client.query("SELECT set_config('app.practice_id',$1,true),set_config('app.location_id',$2,true),set_config('app.actor_user_id',$3,true)",[practiceId,locationId,userId]);
                await client.query('SAVEPOINT denied');await assert.rejects(client.query("INSERT INTO paperwork_library_items(id) VALUES($1)",[randomUUID()]),error=>(error as {code?:string}).code==='42501');await client.query('ROLLBACK TO SAVEPOINT denied');
                await client.query('SAVEPOINT immutable');await assert.rejects(client.query("UPDATE patient_portal_grants SET expires_at=expires_at+interval '1 day' WHERE id=$1",[grantId]),error=>(error as {code?:string}).code==='23514');await client.query('ROLLBACK TO SAVEPOINT immutable');
                await client.query('ROLLBACK');}finally{client.release();}
            await run('paperwork.portal.revoke',grantId,{reasonCode:'synthetic_revocation'},1);
            assert.deepEqual((await paperwork.portalPaperwork(subject,'sess_VerifiedPatient')).items,[]);
            await assert.rejects(paperwork.portalPaperwork(subject,'sess_VerifiedPatient',unsignedItem),error=>(error as {code?:string}).code==='42501');
            assert.equal((await admin.query('SELECT count(*) FROM paperwork_library_items WHERE document_version_id=ANY($1::uuid[])',[[unsignedVersion,signedVersion]])).rows[0].count,'2');
        });
    } finally {
        await runtimePool?.end();await admin.query(`DROP OWNED BY ${role}`);await admin.query(`DROP ROLE IF EXISTS ${role}`);await admin.end();await rm(storage,{recursive:true,force:true});
        if(old.url===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=old.url;
        if(old.ssl===undefined)delete process.env.DATABASE_SSL_MODE;else process.env.DATABASE_SSL_MODE=old.ssl;
        if(old.storage===undefined)delete process.env.CAREIQ_PRIVATE_STORAGE_DIR;else process.env.CAREIQ_PRIVATE_STORAGE_DIR=old.storage;
    }
});
