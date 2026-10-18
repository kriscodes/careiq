import test from 'node:test';
import assert from 'node:assert/strict';
import { authoringHash, validateAuthoring, validateFormAnswers, renderFormTemplate, type FormSchema } from '../src/workflow/forms.js';
import { WorkflowError } from '../src/workflow/policy.js';
const fields = [{ id: 'has_medications', key: 'has_medications', label: 'Taking medications?', type: 'checkbox', required: false }, { id: 'medication_note', key: 'medication_note', label: 'Medication', type: 'text', required: true }];
const schema = { sections: [], rules: [{ id: 'when_medications', sourceFieldKey: 'has_medications', targetFieldKey: 'medication_note', operator: 'checked' }], bindings: [], completionPolicy: 'form_only' };
const error = (code: string) => (e: unknown) => e instanceof WorkflowError && e.code === code;
test('conditional form answers exclude hidden values and enforce active required fields', () => { const a = validateAuthoring(2, fields, schema); assert.deepEqual(validateFormAnswers(a, { has_medications: false, medication_note: 'old protected answer' }).answers, { has_medications: false }); assert.throws(() => validateFormAnswers(a, { has_medications: true }), error('REQUIRED_FIELD')); assert.throws(() => validateFormAnswers(a, { has_medications: true, medication_note: '  ' }), error('REQUIRED_FIELD')); assert.deepEqual(validateFormAnswers(a, { has_medications: true }, false).answers, { has_medications: true }); });
test('repeating answers retain stable ids and respect published bounds and applicability', () => { const a = validateAuthoring(2, [{ key: 'label', type: 'text', label: 'Item', sectionId: 'items', required: true }], { sections: [{ id: 'items', title: 'Items', repeatable: true, minItems: 1, maxItems: 2 }] }); assert.deepEqual(validateFormAnswers(a, { items: [{ id: 'stable_1', answers: { label: 'one' } }] }).activeFieldKeys, ['items.stable_1.label']); assert.throws(() => validateFormAnswers(a, { items: [] }), error('INVALID_REPEAT_COUNT')); assert.throws(() => validateFormAnswers(a, { items: [{ id: 'same', answers: { label: 'a' } }, { id: 'same', answers: { label: 'b' } }] }), error('INVALID_REPEAT_ITEM')); });
test('publication rejects cycles, unsupported signatures, unknown fields and guided geometry', () => { assert.throws(() => validateAuthoring(2, fields, { ...schema, rules: [...schema.rules, { id: 'cycle', sourceFieldKey: 'medication_note', targetFieldKey: 'has_medications', operator: 'has_value' }] }), error('CYCLIC_FORM_RULE')); assert.throws(() => validateAuthoring(2, fields, { signing: { roles: [{ key: 'provider', label: 'Provider', required: true }] } }), error('SIGNER_POLICY_UNAVAILABLE')); assert.throws(() => validateAuthoring(2, [{ key: 'a', label: 'A', type: 'text', x: .2 }], {}), error('PDF_OVERLAY_UNAVAILABLE')); assert.throws(() => validateFormAnswers(validateAuthoring(2, fields, schema), { unknown: 'value' }), error('UNKNOWN_ANSWER_FIELD')); });
test('mapping is registered and always reviewed; signatures cannot masquerade as answers', () => { assert.throws(() => validateAuthoring(2, fields, { bindings: [{ fieldKey: 'medication_note', destination: 'patients.secret', reviewRequired: true }] }), error('INVALID_FIELD_BINDING')); const a = validateAuthoring(2, [{ key: 'signature', type: 'typed_signature', label: 'Signature', signerRole: 'patient', required: true }], { completionPolicy: 'form_then_sign', signing: { roles: [{ key: 'patient', label: 'Patient', required: true }], consentText: 'I agree to sign.', consentTextVersion: 'v1' } }); assert.throws(() => validateFormAnswers(a, { signature: 'name' }), error('SIGNATURE_REQUIRES_SIGNING')); });
test('PDF generation preserves supported Spanish text and rejects unsupported glyphs', async () => { const a = validateAuthoring(2, [{ key: 'name', label: 'Nombre', type: 'text', required: true }], {}); const pdf = await renderFormTemplate('Formulario', 'Autorización', a, { name: 'José Muñoz' }); assert.ok(pdf.length > 500); await assert.rejects(renderFormTemplate('Form', 'Body', a, { name: '患者' }), error('PDF_UNSUPPORTED_CHARACTER')); });
test('schema content hashes bind conditional rules and delivery policy', () => { const a = validateAuthoring(2, fields, schema), b = validateAuthoring(2, fields, { ...schema, delivery: { emailCopy: true } }); assert.notEqual(authoringHash({ content: 'body' }, a), authoringHash({ content: 'body' }, b)); assert.equal(validateAuthoring(1, [{ key: 'legacy', label: 'Legacy', type: 'text' }], {}).schemaVersion, 1); });
test('electronic signing record preserves Spanish names and rejects unsupported signature glyphs', async () => { const { renderSigned } = await import('../src/workflow/storage.js'); const authoring = validateAuthoring(2, [{ key: 'name', label: 'Nombre', type: 'text' }], {}); const source = await renderFormTemplate('Consent', 'Body', authoring, { name: 'José' }), evidence = { completedAt: '2026-10-17T12:00:00Z', sourceSha256: 'a'.repeat(64), consentTextVersion: 'v1', verificationMethod: 'email_link', requestId: 'test' }; assert.ok((await renderSigned(source, evidence, [{ key: 'patient_signature', type: 'typed_signature', value: 'José Muñoz' }])).length > source.length); await assert.rejects(renderSigned(source, evidence, [{ key: 'patient_signature', type: 'typed_signature', value: '患者' }]), error('PDF_UNSUPPORTED_CHARACTER')); });

test('PDF renderer accepts multiline legal text and bounded wide answers',async()=>{const a=validateAuthoring(2,[{key:'note',label:'Note',type:'textarea'}],{});const bytes=await renderFormTemplate('Legal form','First paragraph.\nSecond paragraph.\r\nThird paragraph.',a,{note:'W'.repeat(4000)});const {PDFDocument}=await import('pdf-lib');assert.ok((await PDFDocument.load(bytes)).getPageCount()>1);});

test('signing publication cannot exceed supported field count or omit a required signature',()=>{const signing={roles:[{key:'patient',label:'Patient',required:true}],consentText:'I agree.',consentTextVersion:'v1'},policy={completionPolicy:'form_then_sign',signing};assert.throws(()=>validateAuthoring(2,Array.from({length:31},(_,i)=>({key:'signature_'+i,label:'Signature',type:'typed_signature',required:true})),policy),error('INVALID_SIGNATURE_FIELD_POLICY'));assert.throws(()=>validateAuthoring(2,[{key:'signature',label:'Signature',type:'typed_signature',required:false}],policy),error('INVALID_SIGNATURE_FIELD_POLICY'));});

test('reviewed demographics enforce registered destination limits before freeze',()=>{const authoring=validateAuthoring(2,[{key:'preferred',label:'Preferred name',type:'text'}],{bindings:[{fieldKey:'preferred',destination:'patient.preferredName',reviewRequired:true}]});assert.throws(()=>validateFormAnswers(authoring,{preferred:'x'.repeat(101)}),error('INVALID_ANSWER_TYPE'));assert.equal(validateFormAnswers(authoring,{preferred:'x'.repeat(100)}).answers.preferred,'x'.repeat(100));});

test('signing record paginates all assigned fields instead of clipping evidence below a page',async()=>{
 const {renderSigned}=await import('../src/workflow/storage.js'),{PDFDocument}=await import('pdf-lib');
 const source=await renderFormTemplate('Consent','Original consent content.',validateAuthoring(2,[],{}),{});
 const evidence={completedAt:'2026-10-17T12:00:00Z',sourceSha256:'a'.repeat(64),consentTextVersion:'v1',verificationMethod:'email_link',requestId:'test'};
 const fields=Array.from({length:30},(_,i)=>({key:'patient_signature_'+i,type:'typed_signature',value:'Synthetic signature name '.repeat(40)}));
 const result=await PDFDocument.load(await renderSigned(source,evidence,fields));assert.ok(result.getPageCount()>2);
});

test('large conditional DAG evaluation stays bounded by fields and edges and rejects cycles',()=>{
 const fields=Array.from({length:51},(_,i)=>({key:'field_'+i,label:'Field '+i,type:'checkbox'}));
 const rules=fields.slice(2).flatMap((field,i)=>[{id:'rule_'+i+'_a',targetFieldKey:field.key,sourceFieldKey:'field_'+(i+1),operator:'checked'},{id:'rule_'+i+'_b',targetFieldKey:field.key,sourceFieldKey:'field_'+i,operator:'checked'}]);
 const authoring=validateAuthoring(2,fields,{rules});let reads=0;
 const values=Object.fromEntries(fields.map(field=>[field.key,true]));
 const answers=new Proxy(values,{get(target,key,receiver){if(typeof key==='string'&&key.startsWith('field_'))reads++;return Reflect.get(target,key,receiver);}});
 const evaluated=validateFormAnswers(authoring,answers);assert.equal(evaluated.activeFieldKeys.length,fields.length);assert.ok(reads<=fields.length*3+rules.length,`Expected a bounded graph walk, observed ${reads} answer reads.`);
 assert.throws(()=>validateAuthoring(2,fields,{rules:[...rules,{id:'cycle',targetFieldKey:'field_0',sourceFieldKey:'field_50',operator:'checked'}]}),error('CYCLIC_FORM_RULE'));
});
test('conditional answer caches remain isolated for each repeating row',()=>{
 const authoring=validateAuthoring(2,[{key:'show',label:'Show',type:'checkbox',sectionId:'items'},{key:'detail',label:'Detail',type:'text',sectionId:'items'}],{sections:[{id:'items',title:'Items',repeatable:true}],rules:[{id:'show_detail',targetFieldKey:'detail',sourceFieldKey:'show',operator:'checked'}]});
 const evaluated=validateFormAnswers(authoring,{items:[{id:'first',answers:{show:false,detail:'Discard first'}},{id:'second',answers:{show:true,detail:'Keep second'}},{id:'third',answers:{show:false,detail:'Discard third'}}]});
 assert.deepEqual(evaluated.answers.items,[{id:'first',answers:{show:false}},{id:'second',answers:{show:true,detail:'Keep second'}},{id:'third',answers:{show:false}}]);
});


test('drawn signatures bound PNG pixels, chunks and decompression before embedding',async()=>{
 const {renderSigned}=await import('../src/workflow/storage.js'),{deflateSync}=await import('node:zlib');
 const source=await renderFormTemplate('Consent','Original content.',validateAuthoring(2,[],{}),{}),evidence={completedAt:'2026-10-17T12:00:00Z',sourceSha256:'a'.repeat(64),consentTextVersion:'v1',verificationMethod:'email_link',requestId:'test'};
 const fixture=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
 const field=(png:Buffer)=>[{key:'patient_signature',type:'drawn_signature',value:'data:image/png;base64,'+png.toString('base64')}];
 assert.ok((await renderSigned(source,evidence,field(fixture))).length>source.length);
 const hugePixels=Buffer.from(fixture);hugePixels.writeUInt32BE(0x7fffffff,16);await assert.rejects(renderSigned(source,evidence,field(hugePixels)),error('INVALID_SIGNATURE_IMAGE'));
 const hugeChunk=Buffer.from(fixture);hugeChunk.writeUInt32BE(0xfffffff0,33);await assert.rejects(renderSigned(source,evidence,field(hugeChunk)),error('INVALID_SIGNATURE_IMAGE'));
 // CRC is ignored by the upstream decoder; these attack chunks exercise our pre-decoder bounds.
 const chunk=(type:string,data:Buffer)=>{const size=Buffer.alloc(4);size.writeUInt32BE(data.length);return Buffer.concat([size,Buffer.from(type),data,Buffer.alloc(4)]);};
 const end=fixture.subarray(fixture.length-12),bomb=Buffer.concat([fixture.subarray(0,33),chunk('IDAT',deflateSync(Buffer.alloc(8*1024*1024))),end]);
 assert.ok(bomb.length<150000);await assert.rejects(renderSigned(source,evidence,field(bomb)),error('INVALID_SIGNATURE_IMAGE'));
 const animated=Buffer.concat([fixture.subarray(0,33),chunk('acTL',Buffer.alloc(8)),fixture.subarray(33)]);await assert.rejects(renderSigned(source,evidence,field(animated)),error('INVALID_SIGNATURE_IMAGE'));
 const malformedMetadata=Buffer.concat([fixture.subarray(0,33),chunk('tEXt',Buffer.from('missing-null-terminator')),fixture.subarray(33)]);
 assert.ok((await renderSigned(source,evidence,field(malformedMetadata))).length>source.length);
});


test('legal text and signing sources cannot expand beyond the local PDF page bound',async()=>{
 const {renderSigned,renderTemplate}=await import('../src/workflow/storage.js'),{PDFDocument}=await import('pdf-lib'),{maximumPdfPages}=await import('../src/workflow/pdf-limits.js');
 const content='A\n'.repeat(6000);assert.ok(content.length<20000);
 await assert.rejects(renderFormTemplate('Consent',content,validateAuthoring(2,[],{}),{}),error('PDF_PAGE_LIMIT_EXCEEDED'));
 await assert.rejects(renderTemplate('Legacy consent',content,[],{}),error('PDF_PAGE_LIMIT_EXCEEDED'));
 const source=await PDFDocument.create();for(let i=0;i<maximumPdfPages;i++)source.addPage();
 await assert.rejects(renderSigned(Buffer.from(await source.save()),{},[]),error('PDF_PAGE_LIMIT_EXCEEDED'));
});

test('private document keys reject path traversal and ambiguous filenames before file access',async()=>{
 const {readPrivate}=await import('../src/workflow/storage.js');
 for(const key of ['../.env','/etc/passwd','00000000-0000-4000-8000-000000000000.pdf/../../.env','00000000-0000-4000-8000-000000000000.pdf%00','00000000-0000-4000-8000-000000000000.pdf\\..\\.env'])assert.throws(()=>readPrivate(key),error('INVALID_STORAGE_REFERENCE'));
});
