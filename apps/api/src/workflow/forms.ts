import { addBoundedPdfPage } from './pdf-limits.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { body, fingerprint, isoDate, text, validateFields, WorkflowError } from './policy.js';
export type FormField = {
    id: string;
    key: string;
    label: string;
    type: string;
    required: boolean;
    sectionId?: string;
    helpText?: string;
    placeholder?: string;
    signerRole?: string;
    options?: string[];
    maxLength?: number;
    min?: number;
    max?: number;
};
export type FormSection = {
    id: string;
    title: string;
    description?: string;
    repeatable: boolean;
    minItems: number;
    maxItems: number;
};
export type FormRule = {
    id: string;
    targetFieldKey: string;
    sourceFieldKey: string;
    operator: 'equals' | 'not_equals' | 'checked' | 'not_checked' | 'has_value';
    value?: string | boolean | number;
};
export type FormBinding = {
    fieldKey: string;
    destination: 'patient.preferredName' | 'patient.email' | 'patient.phone' | 'patient.dateOfBirth';
    reviewRequired: true;
};
export type FormSchema = {
    mode: 'guided';
    documentTitle?: string;
    defaultLocale: 'en' | 'es';
    completionPolicy: 'form_only' | 'form_then_sign';
    sections: FormSection[];
    rules: FormRule[];
    bindings: FormBinding[];
    signing: {
        roles: Array<{
            key: string;
            label: string;
            required: boolean;
        }>;
        consentText: string;
        consentTextVersion: string;
    };
    delivery: {
        emailCopy: boolean;
    };
};
export type Authoring = {
    schemaVersion: number;
    fieldSchema: FormField[];
    formSchema: FormSchema | Record<string, never>;
};
const keyOf = (value: unknown, name: string) => { const s = text(value, name, 64)!; if (!/^[a-z][a-z0-9_]*$/.test(s) || ['__proto__', 'constructor', 'prototype'].includes(s))
    throw new WorkflowError('INVALID_FORM_KEY', 422, { field: name }); return s; };
const optionalText = (v: unknown, name: string, max: number) => v === undefined || v === '' ? undefined : text(v, name, max)!;
const list = (v: unknown, max: number) => { if (!Array.isArray(v) || v.length > max)
    throw new WorkflowError('INVALID_FORM_SCHEMA', 422); return v; };
const integer = (v: unknown, fallback: number, min: number, max: number) => { const n = v ?? fallback; if (!Number.isSafeInteger(n) || Number(n) < min || Number(n) > max)
    throw new WorkflowError('INVALID_FORM_LIMIT', 422); return Number(n); };
const boolean = (v: unknown, fallback = false) => { if (v !== undefined && typeof v !== 'boolean')
    throw new WorkflowError('INVALID_FORM_FLAG', 422); return v === undefined ? fallback : v as boolean; };
export function validateAuthoring(schemaVersion: unknown, fields: unknown, schema: unknown): Authoring {
    if (schemaVersion === undefined || schemaVersion === 1)
        return { schemaVersion: 1, fieldSchema: validateFields(fields ?? []) as FormField[], formSchema: {} };
    if (schemaVersion !== 2)
        throw new WorkflowError('UNSUPPORTED_FORM_SCHEMA', 422);
    const s = body(schema ?? {}, ['mode', 'documentTitle', 'defaultLocale', 'completionPolicy', 'sections', 'rules', 'bindings', 'signing', 'delivery']);
    if (s.mode !== undefined && s.mode !== 'guided')
        throw new WorkflowError('FORM_MODE_UNAVAILABLE', 422);
    if (s.defaultLocale !== undefined && !['en', 'es'].includes(String(s.defaultLocale)))
        throw new WorkflowError('INVALID_FORM_LOCALE', 422);
    if (s.completionPolicy !== undefined && !['form_only', 'form_then_sign'].includes(String(s.completionPolicy)))
        throw new WorkflowError('INVALID_COMPLETION_POLICY', 422);
    const sectionIds = new Set<string>();
    const sections = list(s.sections ?? [], 20).map(raw => { const r = body(raw, ['id', 'title', 'description', 'repeatable', 'minItems', 'maxItems']); const id = keyOf(r.id, 'section.id'); if (sectionIds.has(id))
        throw new WorkflowError('DUPLICATE_SECTION', 422); sectionIds.add(id); const repeatable = boolean(r.repeatable); const minItems = integer(r.minItems, 0, 0, 20), maxItems = integer(r.maxItems, repeatable ? 10 : 1, 1, 20); if (minItems > maxItems || !repeatable && (minItems > 1 || maxItems !== 1))
        throw new WorkflowError('INVALID_FORM_LIMIT', 422); return { id, title: text(r.title, 'section.title', 120)!, description: optionalText(r.description, 'section.description', 1000), repeatable, minItems, maxItems }; });
    const keys = new Set<string>(), ids = new Set<string>();
    const fieldSchema = list(fields ?? [], 100).map(raw => { const f = body(raw, ['id', 'key', 'label', 'type', 'required', 'sectionId', 'helpText', 'placeholder', 'signerRole', 'options', 'maxLength', 'min', 'max', 'page', 'x', 'y', 'width', 'height']); const key = keyOf(f.key, 'field.key'), id = keyOf(f.id ?? key, 'field.id'); if (keys.has(key) || ids.has(id) || sectionIds.has(key))
        throw new WorkflowError('DUPLICATE_FIELD', 422); keys.add(key); ids.add(id); const type = String(f.type); if (!['text', 'textarea', 'date', 'checkbox', 'select', 'email', 'phone', 'number', 'radio', 'typed_signature'].includes(type))
        throw new WorkflowError('INVALID_FIELD_TYPE', 422); const sectionId = f.sectionId ? keyOf(f.sectionId, 'field.sectionId') : undefined; if (sectionId && !sectionIds.has(sectionId))
        throw new WorkflowError('UNKNOWN_SECTION', 422); const options = f.options === undefined ? undefined : list(f.options, 50).map(o => text(o, 'option', 120)!); if (options && new Set(options).size !== options.length || ['select', 'radio'].includes(type) && !options?.length)
        throw new WorkflowError('INVALID_FIELD_OPTIONS', 422); const signerRole = f.signerRole ? keyOf(f.signerRole, 'signerRole') : undefined; if (type === 'typed_signature' && (sectionId && sections.find(s => s.id === sectionId)?.repeatable || signerRole && signerRole !== 'patient'))
        throw new WorkflowError('SIGNER_POLICY_UNAVAILABLE', 422); if (['page', 'x', 'y', 'width', 'height'].some(c => f[c] !== undefined))
        throw new WorkflowError('PDF_OVERLAY_UNAVAILABLE', 422); if (f.min !== undefined && (typeof f.min !== 'number' || !Number.isFinite(f.min)) || f.max !== undefined && (typeof f.max !== 'number' || !Number.isFinite(f.max)) || f.min !== undefined && f.max !== undefined && Number(f.min) > Number(f.max))
        throw new WorkflowError('INVALID_FIELD_RANGE', 422); return { id, key, label: text(f.label ?? key, 'label', 120)!, type, required: boolean(f.required), ...(sectionId ? { sectionId } : {}), ...(optionalText(f.helpText, 'helpText', 1000) ? { helpText: optionalText(f.helpText, 'helpText', 1000) } : {}), ...(optionalText(f.placeholder, 'placeholder', 240) ? { placeholder: optionalText(f.placeholder, 'placeholder', 240) } : {}), ...(signerRole ? { signerRole } : {}), ...(options ? { options } : {}), ...(f.maxLength !== undefined ? { maxLength: integer(f.maxLength, 4000, 1, 4000) } : {}), ...(f.min !== undefined ? { min: Number(f.min) } : {}), ...(f.max !== undefined ? { max: Number(f.max) } : {}) }; });
    const signatureFields=fieldSchema.filter(field=>field.type==='typed_signature');
    if(signatureFields.length>30 || signatureFields.length && !signatureFields.some(field=>field.required))throw new WorkflowError('INVALID_SIGNATURE_FIELD_POLICY',422);
    const fieldByKey = new Map(fieldSchema.map(f => [f.key, f]));
    const ruleIds = new Set<string>();
    const rules = list(s.rules ?? [], 100).map(raw => { const r = body(raw, ['id', 'targetFieldKey', 'sourceFieldKey', 'operator', 'value']); const id = keyOf(r.id, 'rule.id'), targetFieldKey = keyOf(r.targetFieldKey, 'targetFieldKey'), sourceFieldKey = keyOf(r.sourceFieldKey, 'sourceFieldKey'), target = fieldByKey.get(targetFieldKey), source = fieldByKey.get(sourceFieldKey); if (ruleIds.has(id) || !target || !source || target === source || source.type === 'typed_signature' || target.type === 'typed_signature')
        throw new WorkflowError('INVALID_FORM_RULE', 422); ruleIds.add(id); if (!['equals', 'not_equals', 'checked', 'not_checked', 'has_value'].includes(String(r.operator)))
        throw new WorkflowError('INVALID_FORM_RULE', 422); if (r.value !== undefined && !['string', 'number', 'boolean'].includes(typeof r.value) || typeof r.value === 'string' && r.value.length > 4000)
        throw new WorkflowError('INVALID_FORM_RULE', 422); if (['equals', 'not_equals'].includes(String(r.operator)) && r.value === undefined || ['checked', 'not_checked'].includes(String(r.operator)) && source.type !== 'checkbox')
        throw new WorkflowError('INVALID_FORM_RULE', 422); if (['equals', 'not_equals'].includes(String(r.operator)) && (source.type === 'checkbox' && typeof r.value !== 'boolean' || source.type === 'number' && (typeof r.value !== 'number' || !Number.isFinite(r.value)) || !['checkbox', 'number'].includes(source.type) && typeof r.value !== 'string' || ['select', 'radio'].includes(source.type) && !source.options?.includes(String(r.value))))
        throw new WorkflowError('UNREACHABLE_FORM_RULE', 422); if (source.sectionId && sections.find(s => s.id === source.sectionId)?.repeatable && source.sectionId !== target.sectionId)
        throw new WorkflowError('CROSS_REPEAT_RULE_UNSUPPORTED', 422); return { id, targetFieldKey, sourceFieldKey, operator: r.operator as FormRule['operator'], ...(r.value !== undefined ? { value: r.value as string | boolean | number } : {}) }; });
    const dependencies=new Map<string,string[]>();
    for(const rule of rules){const sources=dependencies.get(rule.targetFieldKey) ?? [];sources.push(rule.sourceFieldKey);dependencies.set(rule.targetFieldKey,sources);}
    const visitState=new Map<string,'visiting'|'visited'>();
    const visit=(key:string):void=>{
        if(visitState.get(key)==='visiting')throw new WorkflowError('CYCLIC_FORM_RULE',422);
        if(visitState.get(key)==='visited')return;
        visitState.set(key,'visiting');
        for(const source of dependencies.get(key) ?? [])visit(source);
        visitState.set(key,'visited');
    };
    for(const field of fieldSchema)visit(field.key);
    const bindingKeys = new Set<string>();
    const bindings = list(s.bindings ?? [], 100).map(raw => { const b = body(raw, ['fieldKey', 'destination', 'reviewRequired']); const fieldKey = keyOf(b.fieldKey, 'binding.fieldKey'), field = fieldByKey.get(fieldKey); if (!field || field.type === 'typed_signature' || field.sectionId && sections.find(s => s.id === field.sectionId)?.repeatable || bindingKeys.has(fieldKey) || !['patient.preferredName', 'patient.email', 'patient.phone', 'patient.dateOfBirth'].includes(String(b.destination)) || b.reviewRequired !== true)
        throw new WorkflowError('INVALID_FIELD_BINDING', 422); if (b.destination === 'patient.dateOfBirth' && field.type !== 'date' || b.destination === 'patient.email' && field.type !== 'email' || ['checkbox', 'number'].includes(field.type))
        throw new WorkflowError('INVALID_FIELD_BINDING', 422); bindingKeys.add(fieldKey); return { fieldKey, destination: b.destination as FormBinding['destination'], reviewRequired: true as const }; });
    const signing = body(s.signing ?? {}, ['roles', 'consentText', 'consentTextVersion']);
    const roles = list(signing.roles ?? [], 1).map(raw => { const r = body(raw, ['key', 'label', 'required']); if (r.key !== 'patient' || r.required !== true)
        throw new WorkflowError('SIGNER_POLICY_UNAVAILABLE', 422); return { key: 'patient', label: text(r.label ?? 'Patient', 'role.label', 120)!, required: true }; });
    const completionPolicy = (s.completionPolicy ?? 'form_only') as FormSchema['completionPolicy'];
    if (completionPolicy === 'form_then_sign' && roles.length !== 1 || completionPolicy === 'form_only' && fieldSchema.some(f => f.type === 'typed_signature'))
        throw new WorkflowError('SIGNER_POLICY_REQUIRED', 422);
    const consentText = optionalText(signing.consentText, 'consentText', 10000) ?? '', consentTextVersion = optionalText(signing.consentTextVersion, 'consentTextVersion', 120) ?? '';
    if (completionPolicy === 'form_then_sign' && (!consentText || !consentTextVersion))
        throw new WorkflowError('CONSENT_VERSION_REQUIRED', 422);
    const delivery = body(s.delivery ?? {}, ['emailCopy']);
    return { schemaVersion: 2, fieldSchema, formSchema: { mode: 'guided', ...(optionalText(s.documentTitle,'documentTitle',240) ? {documentTitle:optionalText(s.documentTitle,'documentTitle',240)} : {}), defaultLocale: (s.defaultLocale ?? 'en') as 'en' | 'es', completionPolicy, sections, rules, bindings, signing: { roles, consentText, consentTextVersion }, delivery: { emailCopy: boolean(delivery.emailCopy) } } };
}
export const authoringFromVersion = (version: Record<string, any>) => validateAuthoring(Number(version.schema_version ?? version.schemaVersion ?? 1), version.field_schema ?? version.fieldSchema, version.form_schema ?? version.formSchema);
export const authoringHash = (version: Record<string, any>, authoring = authoringFromVersion(version)) => fingerprint({ schemaVersion: authoring.schemaVersion, content: version.content, fieldSchema: authoring.fieldSchema, ...(authoring.schemaVersion === 2 ? { formSchema: authoring.formSchema } : {}) });
const present = (value: unknown) => value !== undefined && value !== null && (typeof value !== 'string' || Boolean(value.trim()));
export function validateFormAnswers(authoring: Authoring, value: unknown, final = true) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.byteLength(JSON.stringify(value)) > 128000)
        throw new WorkflowError('INVALID_ANSWERS', 422);
    const input = value as Record<string, unknown>, out: Record<string, unknown> = {}, activeFieldKeys: string[] = [];
    const schema = authoring.schemaVersion === 2 ? authoring.formSchema as FormSchema : { sections: [], rules: [] } as unknown as FormSchema;
    const repeatSections = schema.sections.filter(s => s.repeatable), repeatedKeys = new Set(authoring.fieldSchema.filter(f => repeatSections.some(s => s.id === f.sectionId)).map(f => f.key));
    if (Object.keys(input).some(k => !authoring.fieldSchema.some(f => f.key === k && !repeatedKeys.has(k)) && !repeatSections.some(s => s.id === k)))
        throw new WorkflowError('UNKNOWN_ANSWER_FIELD', 422);
    const rulesByTarget=new Map<string,FormRule[]>();
    for(const rule of schema.rules){const rules=rulesByTarget.get(rule.targetFieldKey) ?? [];rules.push(rule);rulesByTarget.set(rule.targetFieldKey,rules);}
    // A cache belongs to one immutable answer context; repeating rows receive separate caches.
    const applicabilityFor=(context:Record<string,unknown>)=>{
        const memo=new Map<string,boolean>(),visiting=new Set<string>();
        const applicable=(key:string):boolean=>{
            if(memo.has(key))return memo.get(key)!;
            if(visiting.has(key))return false;
            visiting.add(key);
            const result=(rulesByTarget.get(key) ?? []).every(rule=>{
                if(!applicable(rule.sourceFieldKey))return false;
                const value=context[rule.sourceFieldKey];
                return rule.operator==='equals' ? value===rule.value : rule.operator==='not_equals' ? value!==rule.value : rule.operator==='checked' ? value===true : rule.operator==='not_checked' ? value===false : present(value);
            });
            visiting.delete(key);memo.set(key,result);return result;
        };
        return applicable;
    };
    const applicable=applicabilityFor(input);
    const answer = (f: FormField, v: unknown, path: string) => { if (f.type === 'typed_signature') {
        if (present(v))
            throw new WorkflowError('SIGNATURE_REQUIRES_SIGNING', 422, { field: path });
        return undefined;
    } if (final && f.required && (!present(v) || f.type === 'checkbox' && v !== true))
        throw new WorkflowError('REQUIRED_FIELD', 422, { field: path }); if (!present(v))
        return v === null ? null : undefined; if (f.type === 'checkbox') {
        if (typeof v !== 'boolean')
            throw new WorkflowError('INVALID_ANSWER_TYPE', 422, { field: path });
        return v;
    } if (f.type === 'number') {
        if (typeof v !== 'number' || !Number.isFinite(v) || f.min !== undefined && v < f.min || f.max !== undefined && v > f.max)
            throw new WorkflowError('INVALID_ANSWER_NUMBER', 422, { field: path });
        return v;
    } const binding=authoring.schemaVersion===2 ? (authoring.formSchema as FormSchema).bindings.find(binding=>binding.fieldKey===f.key) : undefined; const destinationLimit=binding?.destination==='patient.preferredName'?100:binding?.destination==='patient.email'?254:binding?.destination==='patient.phone'?40:4000;
        if (typeof v !== 'string' || v.length > Math.min(f.maxLength ?? 4000,destinationLimit) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))
        throw new WorkflowError('INVALID_ANSWER_TYPE', 422, { field: path }); if (['select', 'radio'].includes(f.type) && !f.options?.includes(v))
        throw new WorkflowError('INVALID_ANSWER_OPTION', 422, { field: path }); if (f.type === 'date')
        isoDate(v); if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
        throw new WorkflowError('INVALID_EMAIL', 422, { field: path }); if (f.type === 'phone' && v.length > 40)
        throw new WorkflowError('INVALID_ANSWER_TYPE', 422, { field: path }); return v; };
    for (const f of authoring.fieldSchema.filter(f => !repeatedKeys.has(f.key))) {
        if (!applicable(f.key))
            continue;
        activeFieldKeys.push(f.key);
        const v = answer(f, input[f.key], f.key);
        if (v !== undefined)
            out[f.key] = v;
    }
    for (const section of repeatSections) {
        const raw = input[section.id] ?? [];
        if (!Array.isArray(raw) || raw.length > section.maxItems || final && raw.length < section.minItems)
            throw new WorkflowError('INVALID_REPEAT_COUNT', 422, { field: section.id });
        const ids = new Set<string>();
        out[section.id] = raw.map((item, i) => { const r = body(item, ['id', 'answers']); if (typeof r.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(r.id) || ids.has(r.id))
            throw new WorkflowError('INVALID_REPEAT_ITEM', 422, { field: section.id }); ids.add(r.id); const fields = authoring.fieldSchema.filter(f => f.sectionId === section.id); if (!r.answers || typeof r.answers !== 'object' || Array.isArray(r.answers) || Object.keys(r.answers).some(k => !fields.some(f => f.key === k)))
            throw new WorkflowError('UNKNOWN_ANSWER_FIELD', 422); const context = { ...input, ...r.answers as Record<string, unknown> }, answers: Record<string, unknown> = {}, rowApplicable=applicabilityFor(context); for (const f of fields) {
            if (!rowApplicable(f.key))
                continue;
            const path = section.id + '.' + r.id + '.' + f.key;
            activeFieldKeys.push(path);
            const v = answer(f, (r.answers as Record<string, unknown>)[f.key], path);
            if (v !== undefined)
                answers[f.key] = v;
        } return { id: r.id, answers }; });
    }
    return { answers: out, activeFieldKeys, rulesetVersion: 'careiq-form-rules-v2' };
}
export async function renderFormTemplate(title: string, content: string, authoring: Authoring, answers: Record<string, unknown>) {
    const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
    let page = addBoundedPdfPage(pdf), y = page.getHeight() - 50;
    const safe = (value: string) => Array.from(value.replace(/\r\n?/g, '\n')).map(character => {
        if (character === '\n') return character;
        try { font.encodeText(character); return character; }
        catch { throw new WorkflowError('PDF_UNSUPPORTED_CHARACTER', 422, { field: 'document' }); }
    }).join('');
    const line = (value: string, size = 11) => {
        for (const paragraph of safe(value).split('\n')) {
            const lines: string[] = []; let chunk = '';
            for (const character of paragraph) {
                if (chunk && font.widthOfTextAtSize(chunk + character, size) > page.getWidth() - 90) { lines.push(chunk); chunk = ''; }
                chunk += character;
            }
            lines.push(chunk);
            for (const text of lines) {
                if (y < 50) { page = addBoundedPdfPage(pdf); y = page.getHeight() - 50; }
                page.drawText(text, {x:45, y, size, font, color:rgb(.15,.2,.18)}); y -= size + 7;
            }
        }
    };
    const form = authoring.schemaVersion === 2 ? authoring.formSchema as FormSchema : null;
    for (const field of authoring.fieldSchema) {
        safe(field.label);
        if (field.helpText)
            safe(field.helpText);
        if (field.options)
            for (const option of field.options)
                safe(option);
    }
    if (form)
        for (const section of form.sections) {
            safe(section.title);
            if (section.description)
                safe(section.description);
        }
    const active = new Set(validateFormAnswers(authoring, answers, false).activeFieldKeys);
    line(title, 20);
    y -= 10;
    line(content);
    y -= 10;
    const format = (v: unknown) => v === true ? (form?.defaultLocale === 'es' ? 'Sí' : 'Yes') : v === false ? 'No' : v === null ? (form?.defaultLocale === 'es' ? 'No proporcionado' : 'Not provided') : String(v ?? '');
    for (const f of authoring.fieldSchema.filter(f => !f.sectionId)) {
        if (f.type !== 'typed_signature' && active.has(f.key))
            line(f.label + ': ' + format(answers[f.key]));
    }
    if (form)
        for (const section of form.sections) {
            line(section.title, 14);
            if (section.description)
                line(section.description);
            const fields = authoring.fieldSchema.filter(f => f.sectionId === section.id);
            if (section.repeatable) {
                for (const [i, item] of ((answers[section.id] ?? []) as Array<{
                    id: string;
                    answers: Record<string, unknown>;
                }>).entries()) {
                    line(section.title + ' ' + (i + 1), 12);
                    for (const f of fields)
                        if (Object.hasOwn(item.answers, f.key))
                            line(f.label + ': ' + format(item.answers[f.key]));
                }
            }
            else
                for (const f of fields)
                    if (f.type !== 'typed_signature' && active.has(f.key))
                        line(f.label + ': ' + format(answers[f.key]));
        }
    if (form?.completionPolicy === 'form_then_sign')
        line('Signature is collected separately after reviewing this frozen document.');
    pdf.setTitle(safe(title));
    pdf.setProducer('CareIQ guided form renderer v2');
    return Buffer.from(await pdf.save());
}
