import type { FormSchema, TemplateField, TemplateVersion, WorkflowTemplate } from "@/lib/api/workflow";
export type FormAnswers = Record<string, unknown>;
export type StudioDraft = { title: string; documentTypeId: string; content: string; fields: TemplateField[]; formSchema: FormSchema };
export const fieldTypes = ["text", "textarea", "email", "phone", "date", "number", "checkbox", "select", "radio", "typed_signature"] as const;
export function blankSchema(): FormSchema { return { mode: "guided", defaultLocale: "en", completionPolicy: "form_only", sections: [], rules: [], bindings: [], signing: { roles: [{ key: "patient", label: "Patient", required: true }], consentText: "", consentTextVersion: "practice-consent-v1" }, delivery: { emailCopy: false } }; }
function normalizedSchema(version?: TemplateVersion): FormSchema {
  const defaults = blankSchema();
  if (!version?.formSchema || version.schemaVersion === 1) return defaults;
  const schema = version.formSchema;
  return structuredClone({ ...defaults, ...schema, sections: schema.sections ?? defaults.sections, rules: schema.rules ?? defaults.rules, bindings: schema.bindings ?? defaults.bindings, signing: { ...defaults.signing, ...schema.signing }, delivery: { ...defaults.delivery, ...schema.delivery } });
}
export function draftOf(template?: WorkflowTemplate | null, version?: TemplateVersion): StudioDraft { return { title: template?.title ?? template?.name ?? "", documentTypeId: template?.documentTypeId ?? "", content: version?.content ?? "", fields: structuredClone(version?.fieldSchema ?? version?.fields ?? template?.fields ?? []), formSchema: normalizedSchema(version) }; }
function visibilityFor(schema:FormSchema,answers:FormAnswers,fields:TemplateField[]){
  const fieldsByKey=new Map(fields.map(field=>[field.key,field]));
  const rulesByTarget=new Map<string,FormSchema['rules']>();
  for(const rule of schema.rules){const rules=rulesByTarget.get(rule.targetFieldKey) ?? [];rules.push(rule);rulesByTarget.set(rule.targetFieldKey,rules);}
  const memo=new Map<string,boolean>();
  const visible=(field:TemplateField,visiting:Set<string>):boolean=>{
    if(memo.has(field.key))return memo.get(field.key)!;
    if(visiting.has(field.key))return false;
    visiting.add(field.key);
    const result=(rulesByTarget.get(field.key) ?? []).every(rule=>{
      const source=fieldsByKey.get(rule.sourceFieldKey);
      if(source&&!visible(source,visiting))return false;
      const value=answers[rule.sourceFieldKey];
      if(rule.operator==='checked')return value===true;
      if(rule.operator==='not_checked')return value===false;
      if(rule.operator==='has_value')return value!==undefined&&value!==null&&(typeof value!=='string'||Boolean(value.trim()));
      if(rule.operator==='equals')return value===rule.value;
      return value!==rule.value;
    });
    visiting.delete(field.key);memo.set(field.key,result);return result;
  };
  return (field:TemplateField,visiting=new Set<string>())=>visible(field,new Set(visiting));
}
export function fieldVisible(field:TemplateField,schema:FormSchema,answers:FormAnswers,fields:TemplateField[]=[],visiting=new Set<string>()):boolean{
  return visibilityFor(schema,answers,fields)(field,visiting);
}
export function activeAnswers(fields: TemplateField[], schema: FormSchema, answers: FormAnswers): FormAnswers {
  const result: FormAnswers = {},visible=visibilityFor(schema,answers,fields);
  for (const field of fields) if (!field.sectionId || !schema.sections.find(section => section.id === field.sectionId)?.repeatable) { if (field.type !== "typed_signature" && visible(field) && answers[field.key] !== undefined) result[field.key] = answers[field.key]; }
  for (const section of schema.sections.filter(item => item.repeatable)) { const items = answers[section.id]; if (!Array.isArray(items)) continue; const sectionFields = fields.filter(field => field.sectionId === section.id); result[section.id] = items.map(item => { const row = item as { id: string; answers: FormAnswers }; const kept: FormAnswers = {},rowVisible=visibilityFor(schema,{...answers,...row.answers},fields); for (const field of sectionFields) if (field.type !== "typed_signature" && rowVisible(field) && row.answers[field.key] !== undefined) kept[field.key] = row.answers[field.key]; return { id: row.id, answers: kept }; }); }
  return result;
}
export function validateDraft(draft: StudioDraft): string[] {
  const issues: string[] = [];
  if (!draft.title.trim()) issues.push("title");
  if (!draft.documentTypeId) issues.push("documentType");
  if (!draft.content.trim()) issues.push("content");
  if (!draft.fields.length) issues.push("fields");
  const keys = new Set<string>();
  for (const field of draft.fields) { if (!field.label.trim() || !/^[a-z][a-z0-9_]{0,63}$/.test(field.key) || keys.has(field.key)) issues.push("fieldLabel"); keys.add(field.key); if (["select", "radio"].includes(field.type) && (!field.options?.length || field.options.some(option => !option.trim()) || new Set(field.options).size !== field.options.length)) issues.push("options"); }
  if (draft.formSchema.completionPolicy === "form_then_sign" && (!draft.formSchema.signing.consentText.trim() || !draft.formSchema.signing.consentTextVersion.trim())) issues.push("consent");
  if (draft.formSchema.completionPolicy === "form_only" && draft.fields.some(field => field.type === "typed_signature")) issues.push("signaturePolicy");
  for (const rule of draft.formSchema.rules) if (!keys.has(rule.targetFieldKey) || !keys.has(rule.sourceFieldKey) || rule.targetFieldKey === rule.sourceFieldKey) issues.push("condition");
  return [...new Set(issues)];
}
export function removeField(draft: StudioDraft, key: string): StudioDraft { return { ...draft, fields: draft.fields.filter(field => field.key !== key), formSchema: { ...draft.formSchema, rules: draft.formSchema.rules.filter(rule => rule.targetFieldKey !== key && rule.sourceFieldKey !== key), bindings: draft.formSchema.bindings.filter(binding => binding.fieldKey !== key) } }; }
