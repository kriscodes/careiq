import assert from "node:assert/strict";
import { test } from "node:test";
import { activeAnswers, blankSchema, draftOf, fieldVisible, removeField, validateDraft } from "../src/components/workflow/form-studio-model";
import type { TemplateField } from "../src/lib/api/workflow";
test("hidden conditional branches and downstream conditions are excluded from every outgoing answer payload", () => {
  const fields: TemplateField[] = [{ key: "has_allergies", label: "Allergies", type: "checkbox" }, { key: "allergies", label: "Details", type: "text", required: true }, { key: "reaction", label: "Reaction", type: "text" }];
  const schema = blankSchema(); schema.rules = [{ id: "r1", targetFieldKey: "allergies", sourceFieldKey: "has_allergies", operator: "checked" }, { id: "r2", targetFieldKey: "reaction", sourceFieldKey: "allergies", operator: "has_value" }];
  const clean = activeAnswers(fields, schema, { has_allergies: false, allergies: "old private answer", reaction: "old private answer", unknown: "discard" });
  assert.deepEqual(clean, { has_allergies: false });
  assert.equal(fieldVisible(fields[2], schema, { has_allergies: false, allergies: "stale" }, fields), false);
  const reopened = activeAnswers(fields, schema, { ...clean, has_allergies: true }); assert.deepEqual(reopened, { has_allergies: true });
});
test("repeat entry identifiers survive normalization while unknown and signature answers never enter form drafts", () => {
  const schema = blankSchema(); schema.sections = [{ id: "medications", title: "Medications", repeatable: true }];
  const fields: TemplateField[] = [{ key: "name", label: "Name", type: "text", sectionId: "medications" }, { key: "sign", label: "Sign", type: "typed_signature" }];
  assert.deepEqual(activeAnswers(fields, schema, { medications: [{ id: "stable-row", answers: { name: "Synthetic", unknown: "discard" } }], sign: "unauthorized signature" }), { medications: [{ id: "stable-row", answers: { name: "Synthetic" } }] });
});
test("removing a field also removes its governed mapping and dependent visibility rules", () => {
  const schema = blankSchema(); schema.rules = [{ id: "r1", targetFieldKey: "detail", sourceFieldKey: "source", operator: "checked" }]; schema.bindings = [{ fieldKey: "source", destination: "patient.email", reviewRequired: true }];
  const result = removeField({ title: "Intake", documentTypeId: "intake", content: "Details", fields: [{ key: "source", label: "Source", type: "checkbox" }, { key: "detail", label: "Detail", type: "text" }], formSchema: schema }, "source"); assert.equal(result.fields.length, 1); assert.deepEqual(result.formSchema.rules, []); assert.deepEqual(result.formSchema.bindings, []);
});
test("publication requires valid choices and explicit versioned signing consent", () => {
  const schema = blankSchema(); schema.completionPolicy = "form_then_sign";
  const draft = { title: "Intake", documentTypeId: "intake", content: "Details", fields: [{ key: "choice", label: "Choice", type: "select", options: ["Duplicate", "Duplicate"] }], formSchema: schema };
  assert.deepEqual(validateDraft(draft).sort(), ["consent", "options"]); schema.signing.consentText = "I consent"; draft.fields[0].options = ["Yes", "No"]; assert.deepEqual(validateDraft(draft), []);
});

test("legacy empty form schemas normalize safely while v2 frozen consent stays exact", () => {
  const legacy = draftOf(null, { id: "v1", schemaVersion: 1, formSchema: {} as ReturnType<typeof blankSchema>, content: "Legacy text", fieldSchema: [{ key: "name", label: "Name", type: "text" }] });
  assert.deepEqual(legacy.formSchema.sections, []); assert.deepEqual(legacy.formSchema.rules, []); assert.equal(legacy.content, "Legacy text");
  const schema = blankSchema(); schema.signing.consentText = "Exact frozen legal wording"; schema.signing.consentTextVersion = "exact-v7";
  const modern = draftOf(null, { id: "v2", schemaVersion: 2, formSchema: schema }); assert.deepEqual(modern.formSchema, schema); modern.formSchema.signing.consentText = "Local edit"; assert.equal(schema.signing.consentText, "Exact frozen legal wording");
});
test("visibility agrees with server rules for absent, null, whitespace, false and zero answers", () => {
  const fields: TemplateField[] = [{ key: "source", label: "Source", type: "text" }, { key: "target", label: "Target", type: "text", required: true }];
  const schema = blankSchema(); schema.rules = [{ id: "rule", sourceFieldKey: "source", targetFieldKey: "target", operator: "not_equals", value: "No" }];
  for (const value of [undefined, null, "", " ", false, 0, "Yes"]) assert.equal(fieldVisible(fields[1], schema, { source: value }, fields), true);
  assert.equal(fieldVisible(fields[1], schema, { source: "No" }, fields), false);
  schema.rules[0].operator = "has_value";
  for (const value of [undefined, null, "", " ", "\n\t"]) assert.equal(fieldVisible(fields[1], schema, { source: value }, fields), false);
  for (const value of [false, 0, "Yes"]) assert.equal(fieldVisible(fields[1], schema, { source: value }, fields), true);
});

test('client visibility memoizes a large shared conditional DAG with bounded answer reads',()=>{
 const fields:TemplateField[]=Array.from({length:51},(_,i)=>({key:'field_'+i,label:'Field '+i,type:'checkbox'}));
 const schema=blankSchema();schema.rules=fields.slice(2).flatMap((field,i)=>[{id:'rule_'+i+'_a',targetFieldKey:field.key,sourceFieldKey:'field_'+(i+1),operator:'checked' as const},{id:'rule_'+i+'_b',targetFieldKey:field.key,sourceFieldKey:'field_'+i,operator:'checked' as const}]);
 let reads=0;const values=Object.fromEntries(fields.map(field=>[field.key,true]));const answers=new Proxy(values,{get(target,key,receiver){if(typeof key==='string'&&key.startsWith('field_'))reads++;return Reflect.get(target,key,receiver);}});
 assert.equal(fieldVisible(fields.at(-1)!,schema,answers,fields),true);assert.ok(reads<=schema.rules.length,`Expected at most one answer read per rule, observed ${reads}.`);
 schema.rules.push({id:'cycle',targetFieldKey:'field_0',sourceFieldKey:'field_50',operator:'checked'});assert.equal(fieldVisible(fields.at(-1)!,schema,answers,fields),false);
});
test('client repeating row visibility uses independent answer-context caches',()=>{
 const fields:TemplateField[]=[{key:'show',label:'Show',type:'checkbox',sectionId:'items'},{key:'detail',label:'Detail',type:'text',sectionId:'items'}],schema=blankSchema();schema.sections=[{id:'items',title:'Items',repeatable:true}];schema.rules=[{id:'show_detail',targetFieldKey:'detail',sourceFieldKey:'show',operator:'checked'}];
 assert.deepEqual(activeAnswers(fields,schema,{items:[{id:'first',answers:{show:false,detail:'Discard first'}},{id:'second',answers:{show:true,detail:'Keep second'}},{id:'third',answers:{show:false,detail:'Discard third'}}]}),{items:[{id:'first',answers:{show:false}},{id:'second',answers:{show:true,detail:'Keep second'}},{id:'third',answers:{show:false}}]});
});
