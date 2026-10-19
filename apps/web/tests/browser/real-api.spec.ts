import {randomUUID} from 'node:crypto';
import type {Page,Locator} from '@playwright/test';
import {test,expect} from './real-api-harness';
test.skip(process.env.CAREIQ_REAL_API_E2E!=='true','Explicit isolated real API/database opt-in required.');
// Read the exact Blob URL created by the application from its real HTTP fetch.
// Chromium's DevTools response.body() can return an empty PDF body; the UI Blob
// verifies the actual bytes the patient can open without substituting responses.
async function uiPdf(page:Page,link:Locator){
 await expect(link).toHaveAttribute('href',/^blob:/);
 return page.evaluate(async url=>{const response=await fetch(url!,{cache:'no-store'}),bytes=new Uint8Array(await response.arrayBuffer());return{size:bytes.length,prefix:new TextDecoder().decode(bytes.subarray(0,5)),sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('')};},await link.getAttribute('href'));
}
for(const flowName of ['unsigned','signed'] as const){
 test(`real HTTP/restricted DB: ${flowName} patient form, immutable PDF, library and foreign-copy refusal`,async({browser,realApi})=>{
  const flow=realApi.flows[flowName],name=flowName==='signed'?'Synthetic Browser Signer':'Synthetic Browser Respondent';
  const context=await browser.newContext({locale:'en-US',serviceWorkers:'block'});let external=0;
  try{
   await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin===realApi.origin||url.protocol==='blob:'||url.protocol==='data:')await route.continue();else{external++;await route.abort('blockedbyclient');}});
   // Keep the one-use link in private memory; navigation URLs and artifacts do
   // not contain it. The real patient component consumes the location hash.
   await context.addInitScript(({subject,bearer,token})=>{window.__careiqRealApiIdentity={subject,bearer};if(location.pathname==='/')history.replaceState(null,'',location.pathname+'#token='+token);},{subject:realApi.subject,bearer:realApi.bearer,token:flow.token});
   const page=await context.newPage();await page.goto(realApi.origin);await expect(page.getByRole('heading',{name:flow.title,exact:true})).toBeVisible();expect(new URL(page.url()).hash.length===0).toBe(true);
   const session=(await context.cookies()).find(cookie=>cookie.name==='careiq_patient_session');expect(session?.httpOnly).toBe(true);expect(session?.sameSite).toBe('Strict');expect(session?.path).toBe('/api/v1/patient-workflows');
   const early=await context.request.post(realApi.origin+'/api/v1/patient-workflows/completion',{headers:{Origin:realApi.origin,'Idempotency-Key':randomUUID()},data:{expectedRevision:1,sourceSha256:'a'.repeat(64),consent:{accepted:true,textVersion:'browser-consent-v1'},fields:[{key:'treatment_signature',type:'typed_signature',value:name}]}});expect(early.status()).toBe(409);
   await page.getByLabel('Your full name',{exact:false}).fill(name);await page.getByLabel('Add a note',{exact:false}).check();await page.getByLabel('Private note',{exact:false}).fill('HIDDEN_SYNTHETIC_VALUE_MUST_NOT_FREEZE');await page.getByLabel('Add a note',{exact:false}).uncheck();await expect(page.getByLabel('Private note',{exact:false})).toHaveCount(0);
   const saved=page.waitForResponse(response=>response.url().endsWith('/form/answers')&&response.request().method()==='PUT');await page.getByRole('button',{name:'Save progress',exact:true}).click();expect((await saved).status()).toBe(200);
   const freezeRequest=page.waitForRequest(request=>request.url().endsWith('/form/freeze')&&request.method()==='POST'),freezeResponse=page.waitForResponse(response=>response.url().endsWith('/form/freeze')&&response.request().method()==='POST');
   const signedProjection=flowName==='signed'?page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/patient-workflows/request'&&response.request().method()==='GET'):undefined;
   const signedDocument=flowName==='signed'?page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/patient-workflows/document'&&response.request().method()==='GET'):undefined;
   await page.getByRole('button',{name:flowName==='signed'?'Finish form & review document':'Submit completed form',exact:true}).click();const frozenRequest=await freezeRequest,frozenResponse=await freezeResponse;expect(frozenResponse.status()).toBe(200);const frozen=(await frozenResponse.json()).data;
   let completedVersionId:string=frozen.documentVersionId,sourceSha256:string|undefined;
   if(flowName==='signed'){
    const projection=(await(await signedProjection!).json()).data,pdf=await signedDocument!;expect(pdf.status()).toBe(200);expect(pdf.headers()['content-type']).toContain('application/pdf');const sourcePdf=await uiPdf(page,page.getByRole('link',{name:/Open document to review/}));expect(sourcePdf.prefix).toBe('%PDF-');expect(sourcePdf.size).toBeGreaterThan(0);sourceSha256=sourcePdf.sha256;expect(sourceSha256).toBe(projection.signature.sourceSha256);
    await page.getByRole('checkbox',{name:'I have read the document and am ready to sign.',exact:true}).check();await page.getByRole('checkbox',{name:'I consent to use an electronic signature.',exact:true}).check();await page.getByLabel('Full legal name',{exact:true}).fill(name);
    const completionRequest=page.waitForRequest(request=>request.url().endsWith('/completion')&&request.method()==='POST'),completion=page.waitForResponse(response=>response.url().endsWith('/completion')&&response.request().method()==='POST');await page.getByRole('button',{name:'Sign and finish',exact:true}).click();expect((await completionRequest).postDataJSON().sourceSha256).toBe(sourceSha256);const completed=await completion;expect(completed.status()).toBe(200);completedVersionId=(await completed.json()).data.documentVersionId;await expect(page.getByRole('heading',{name:'All signed. Thank you.',exact:true})).toBeVisible();
   }else{
    await expect(page.getByRole('heading',{name:'Your form was submitted',exact:true})).toBeVisible();const replay=await context.request.post(realApi.origin+'/api/v1/patient-workflows/form/freeze',{headers:{Origin:realApi.origin,'Idempotency-Key':frozenRequest.headers()['idempotency-key'],'If-Match':frozenRequest.headers()['if-match']},data:frozenRequest.postDataJSON()});expect(replay.status()).toBe(200);expect((await replay.json()).data.documentVersionId).toBe(frozen.documentVersionId);
   }
   const verified=await realApi.verify(flowName,name);expect(verified).toMatchObject({immutableFactsVerified:true,exactPdfHashVerified:true,libraryCopies:1,pendingChartReviews:1,signatureFields:flowName==='signed'?2:0,notificationIntents:0,independentIdentityVerified:false});
   expect(verified.frozenTitle).toBe(flow.title);if(sourceSha256)expect(verified.sourceSha256).toBe(sourceSha256);
   const libraryResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/patient-paperwork'&&response.request().method()==='GET');
   await page.goto(realApi.origin+'/patient-paperwork');const library=await libraryResponse;expect(library.status()).toBe(200);const listed=(await library.json()).data.items as Array<{id:string;documentVersionId:string;title:string;sha256:string;signed:boolean}>,item=listed.find(value=>value.id===verified.libraryId);expect(item?.documentVersionId).toBe(completedVersionId);expect(item?.title).toBe(verified.frozenTitle);expect(item?.sha256).toBe(verified.outputSha256);expect(item?.signed).toBe(flowName==='signed');const card=page.getByRole('article').filter({has:page.getByRole('heading',{name:flow.title,exact:true})});await expect(card).toHaveCount(1);
   const content=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/v1/patient-paperwork/${verified.libraryId}/content`);await card.getByRole('button',{name:'Open exact copy',exact:true}).click();const copy=await content;expect(copy.status()).toBe(200);expect(copy.headers()['content-type']).toContain('application/pdf');const copyPdf=await uiPdf(page,page.getByRole('link',{name:'Open exact copy',exact:true}));expect(copyPdf.prefix).toBe('%PDF-');expect(copyPdf.size).toBeGreaterThan(0);expect(copyPdf.sha256).toBe(verified.outputSha256);
   const foreign=await context.request.get(realApi.origin+'/api/v1/patient-paperwork/'+realApi.foreignLibraryId+'/content',{headers:{Authorization:'Bearer '+realApi.bearer}});expect(foreign.status()).toBe(404);expect(foreign.headers()['cache-control']).toBe('no-store');expect((await foreign.json()).error.code).toBe('PAPERWORK_COPY_NOT_FOUND');expect(external).toBe(0);
  }finally{await context.close();}
 });
}

test('real HTTP/restricted DB: manager insurance review preserves evidence and links the staff action audit',async({browser,realApi})=>{
 const staff=realApi.staff,context=await browser.newContext({locale:'en-US',serviceWorkers:'block'});let external=0;
 try{
  await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin===realApi.origin||url.protocol==='blob:'||url.protocol==='data:')await route.continue();else{external++;await route.abort('blockedbyclient');}});
  await context.addInitScript(identity=>{window.__careiqRealApiIdentity=identity;},staff);
  const page=await context.newPage();await page.goto(realApi.origin+'/staff');
  await page.getByRole('button',{name:'Manager',exact:true}).click();
  await page.getByLabel('Appointment day',{exact:true}).fill(staff.date);
  await expect(page.getByRole('heading',{name:'A clear view of your day.',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Open insurance queue',exact:false}).click();
  await page.getByRole('button',{name:'New verification case',exact:false}).click();
  const create=page.getByRole('dialog').last();
  await expect(create.getByLabel('Appointment',{exact:true}).locator(`option[value="${staff.appointmentId}"]`)).toHaveCount(1);
  await create.getByLabel('Appointment',{exact:true}).selectOption(staff.appointmentId);
  await create.getByLabel('Payer',{exact:true}).fill('Synthetic browser payer');
  await create.getByLabel('Member ID',{exact:true}).fill('SYNTHETIC-BROWSER-MEMBER');
  const createdResponse=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/insurance/cases')&&response.request().method()==='POST');
  await create.getByRole('button',{name:'Save to case history',exact:true}).click();
  const created=await createdResponse;expect(created.status()).toBe(201);const caseId=String((await created.json()).data.id);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const open=()=>page.getByRole('button',{name:'Review insurance for Synthetic Browser',exact:true}).click();
  await open();await page.getByRole('button',{name:'Record manual verification',exact:true}).click();
  const original=page.getByRole('dialog').last();
  await original.getByLabel('Evidence source',{exact:true}).selectOption('phone');
  const observedAt=new Date(Date.now()-120000).toISOString().slice(0,16);
  await original.getByLabel('Date and time checked',{exact:true}).fill(observedAt);
  await original.getByLabel('Source reference',{exact:true}).fill('Synthetic browser source A');
  await original.getByLabel('Copay (USD)',{exact:true}).fill('0');
  const firstEvidence=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/v1/locations/${staff.locationId}/insurance/cases/${caseId}/evidence`&&response.request().method()==='POST');
  await original.getByRole('button',{name:'Save to case history',exact:true}).click();expect((await firstEvidence).status()).toBe(201);
  await expect(page.getByRole('dialog')).toHaveCount(0);await open();
  await expect(page.getByRole('dialog')).toContainText('$0.00');await expect(page.getByRole('dialog')).toContainText('Unknown');
  await page.getByRole('button',{name:'Evidence',exact:true}).click();await page.getByRole('button',{name:'Correct current evidence',exact:true}).click();
  const correction=page.getByRole('dialog').last();
  await correction.getByLabel('Evidence source',{exact:true}).selectOption('phone');
  await correction.getByLabel('Date and time checked',{exact:true}).fill(observedAt);
  await correction.getByLabel('Source reference',{exact:true}).fill('Synthetic browser source B');
  await correction.getByLabel('Copay (USD)',{exact:true}).fill('25');
  const correctedResponse=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/v1/locations/${staff.locationId}/insurance/cases/${caseId}/evidence`&&response.request().method()==='POST');
  await correction.getByRole('button',{name:'Save to case history',exact:true}).click();expect((await correctedResponse).status()).toBe(201);
  await expect(page.getByRole('dialog')).toHaveCount(0);await open();await page.getByRole('button',{name:'Evidence',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Synthetic browser source A');await expect(page.getByRole('dialog')).toContainText('Synthetic browser source B');await expect(page.getByRole('dialog')).toContainText('Historical');
  await page.getByRole('button',{name:'Assign or schedule follow-up',exact:true}).click();
  const followUp=page.getByRole('dialog').last();
  await followUp.getByLabel('Owner',{exact:true}).selectOption(staff.subject);
  await followUp.getByLabel('Reason for this change',{exact:true}).selectOption('assignment');
  const assignment=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/v1/locations/${staff.locationId}/insurance/cases/${caseId}/follow-up`&&response.request().method()==='POST');
  await followUp.getByRole('button',{name:'Save to case history',exact:true}).click();expect((await assignment).status()).toBe(200);
  await expect(page.getByRole('dialog')).toHaveCount(0);await open();await page.getByRole('button',{name:'Activity',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Assignment or follow-up updated');
  expect(await realApi.verifyInsurance(caseId)).toEqual({insuranceFactsVerified:true,immutableEvidenceVerified:true,zeroAndUnknownPreserved:true,evidenceCount:2,auditBusinessEvents:4,databaseEvidenceLinked:true,staffActorVerified:true});
  expect(external).toBe(0);
 }finally{await context.close();}
});
