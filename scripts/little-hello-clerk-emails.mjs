#!/usr/bin/env node
/**
 * Little hello branding for Clerk-owned authentication emails.
 *
 * No credentials are loaded from files and no network request occurs by default.
 * Inspect and apply are deliberately separate, explicit commands. The documented
 * Clerk template REST endpoints are deprecated; fail closed if they disappear.
 * References:
 * https://clerk.com/docs/guides/customizing-clerk/email-sms-templates
 * https://github.com/clerk/openapi-specs/blob/main/bapi/2026-05-12.yml
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const API = 'https://api.clerk.com/v1';
const API_VERSION = '2026-05-12';
const MARKER = 'careiq-little-hello-provider-v1';
const SAFE_SLUG = /^[a-zA-Z0-9_-]+$/;
const payloadKeys = ['body', 'subject'];
const deviceDarkStyles = /prefers-color-scheme\s*:\s*dark|light-dark\s*\(|color-scheme\s*:\s*(?:dark|light\s+dark)|name=["'](?:supported-)?color-schemes?["'][^>]*content=["'][^"']*dark/i;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function sourceFingerprint(template) {
  return createHash('sha256').update(JSON.stringify(stable(template))).digest('hex');
}

function expressions(value) {
  return [...new Set((value || '').match(/\{\{\{?[\s\S]*?\}\}\}?/g) || [])];
}

function dynamicHrefs(value) {
  return [...(value || '').matchAll(/\bhref\s*=\s*(["'])([\s\S]*?)\1/gi)]
    .map((match) => match[2]).filter((href) => href.includes('{{'));
}

/** Preserve conditional branches and the full action-link contract during layout changes. */
function providerStructure(value) {
  const controls = [], contexts = new Map(), transitions = [{ index: -1, context: '[]' }], stack = [];
  const context = () => JSON.stringify(stack.map(({ block, branch }) => [block, branch]));
  for (const match of (value || '').matchAll(/\{\{\{?[\s\S]*?\}\}\}?/g)) {
    const token = match[0], expression = token.replace(/^\{\{\{?\s*|\s*\}\}\}?$/g, '');
    if (expression.startsWith('#')) {
      controls.push(token); stack.push({ block: expression.slice(1), branch: 'then' });
    } else if (expression === 'else' || expression.startsWith('else ')) {
      assert(stack.length, 'Provider conditional has an unexpected else.');
      controls.push(token); stack.at(-1).branch = expression;
    } else if (expression.startsWith('/')) {
      assert(stack.length && stack.at(-1).block.split(/\s+/)[0] === expression.slice(1), 'Provider conditional nesting changed.');
      controls.push(token); stack.pop();
    } else {
      const paths = contexts.get(token) || new Set(); paths.add(context()); contexts.set(token, paths);
    }
    transitions.push({ index: match.index, context: context() });
  }
  assert(!stack.length, 'Provider conditional is not closed.');
  const actions = new Map();
  for (const match of (value || '').matchAll(/\bhref\s*=\s*(["'])([\s\S]*?)\1/gi)) {
    if (!match[2].includes('{{')) continue;
    const path = transitions.findLast(item => item.index < match.index).context;
    const key = JSON.stringify([match[2], path]); actions.set(key, (actions.get(key) || 0) + 1);
  }
  return { controls, contexts, actions: [...actions].sort(([a], [b]) => a.localeCompare(b)) };
}

/** Only the documented presentation partial may be replaced by the real brand images. */
function reviewedLogoReplacement(body) {
  if (!body.includes(`<!-- ${MARKER} -->`)) return false;
  const images = [...body.matchAll(/<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi)].map(match => {
    try {
      const url = new URL(match[2]);
      return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash ? url.href : null;
    } catch { return null; }
  }).filter(Boolean);
  const marks = images.filter(url => url.endsWith('/careiq-wordmark.png'));
  const companions = images.filter(url => url.endsWith('/little-hello-companion.png'));
  return marks.length === 1 && companions.length === 1 && marks[0].slice(0, -'careiq-wordmark.png'.length) === companions[0].slice(0, -'little-hello-companion.png'.length);
}

function escapeAttribute(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safeBrandOrigin(origin) {
  if (!origin) return undefined;
  const url = new URL(origin);
  assert(url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash,
    '--brand-origin must be an HTTPS origin without a path, query, credentials, or fragment.');
  return url.origin;
}

function validateSource(template) {
  assert(template && template.template_type === 'email' && SAFE_SLUG.test(template.slug || ''), 'Expected an inspected Clerk email template with a valid slug.');
  assert(template.can_edit_body === true, `Clerk template ${template.slug} does not allow body edits.`);
  assert(typeof template.body === 'string' && template.body.trim(), `Clerk template ${template.slug} has no source body.`);
  assert(template.subject === null || typeof template.subject === 'string', `Clerk template ${template.slug} has an invalid subject.`);
  assert(Array.isArray(template.required_variables) && Array.isArray(template.available_variables),
    `Clerk template ${template.slug} lacks provider variable metadata; inspect again.`);
}

export function validateReplacement(source, payload) {
  validateSource(source);
  assert(Object.keys(payload).sort().join(',') === payloadKeys.join(','), 'Only subject and body can be updated; editor markup, delivery and sender settings are excluded.');
  assert(typeof payload.body === 'string' && payload.body.trim(), 'Expected a nonempty HTML body.');
  assert(payload.subject === null || typeof payload.subject === 'string', 'Expected a string or null subject.');
  assert(!deviceDarkStyles.test(payload.body), 'Dark-preference CSS requires a reviewed light-only replacement.');
  for (const field of ['body', 'subject']) {
    const original = expressions(source[field]);
    const replacement = expressions(payload[field]);
    for (const token of original) {
      const replacedLogo = field === 'body' && token === '{{> app_logo}}' && reviewedLogoReplacement(payload.body);
      assert(replacement.includes(token) || replacedLogo, `${source.slug}: ${field} removed provider expression ${token}.`);
    }
    for (const token of replacement) {
      assert(original.includes(token), `${source.slug}: ${field} introduced an unverified provider expression ${token}.`);
    }
  }
  for (const href of dynamicHrefs(source.body)) {
    assert(dynamicHrefs(payload.body).includes(href), `${source.slug}: a provider action URL changed or is no longer an href.`);
  }
  const originalStructure = providerStructure(source.body), replacementStructure = providerStructure(payload.body);
  assert(JSON.stringify(originalStructure.controls) === JSON.stringify(replacementStructure.controls), `${source.slug}: provider conditional structure changed.`);
  assert(JSON.stringify(originalStructure.actions) === JSON.stringify(replacementStructure.actions), `${source.slug}: provider action URL count or conditional context changed.`);
  for (const [token, contexts] of originalStructure.contexts) {
    if (token === '{{> app_logo}}' && reviewedLogoReplacement(payload.body) && !replacementStructure.contexts.has(token)) continue;
    const next = replacementStructure.contexts.get(token);
    assert(next && JSON.stringify([...contexts].sort()) === JSON.stringify([...next].sort()), `${source.slug}: provider expression ${token} changed conditional context.`);
  }
  for (const variable of source.required_variables) {
    const name = variable.replace(/^\{\{\{?\s*|\s*\}\}\}?$/g, '');
    const present = expressions(payload.body).some((token) => token.replace(/^\{\{\{?\s*|\s*\}\}\}?$/g, '') === name);
    assert(present, `${source.slug}: missing required provider variable ${variable}.`);
  }
  assert(!/<script\b|\bon\w+\s*=|\b(?:href|src)\s*=\s*["']\s*(?:javascript:|data:)/i.test(payload.body),
    `${source.slug}: email HTML contains an unsafe script, handler, or embedded URL.`);
  return payload;
}

/** Preserve the provider's source body verbatim inside the branded envelope. */
export function themeProviderBody(body, { brandOrigin } = {}) {
  assert(typeof body === 'string' && body.trim(), 'Expected provider source HTML.');
  assert(!body.includes(MARKER), 'This source already has Little hello branding; inspect an unbranded source before exporting again.');
  assert(!deviceDarkStyles.test(body), 'The source has dark-preference CSS; provide a reviewed light-only mapping.');
  const origin = safeBrandOrigin(brandOrigin);
  const mark = origin
    ? `<img src="${escapeAttribute(origin)}/brand/little-hello/careiq-wordmark.png" width="130" alt="CareIQ" style="display:block;border:0;width:130px;height:auto">`
    : '<span style="font-family:Georgia,serif;font-weight:700;font-size:30px;letter-spacing:-1.5px;color:#23313c">CareIQ<span style="color:#0067e8">+</span></span>';
  const companion = origin
    ? `<img src="${escapeAttribute(origin)}/brand/little-hello/little-hello-companion.png" width="46" height="46" alt="" role="presentation" style="display:block;border:0;width:46px;height:46px">`
    : '<span aria-hidden="true" style="display:inline-block;font:bold 46px/1 Georgia,serif;color:#0067e8">+</span>';
  const open = `<!-- ${MARKER} --><table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#ffffff" style="width:100%;background:#ffffff;color:#23313c;font-family:Arial,sans-serif"><tr><td align="center" style="padding:36px 18px"><table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;background:#ffffff"><tr><td style="padding:0 18px 24px;border-bottom:1px solid #dce4ec"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td valign="middle">${mark}</td><td align="right" valign="middle">${companion}</td></tr></table></td></tr><tr><td style="padding:24px 0 18px;background:#ffffff;color:#23313c">`;
  const close = '</td></tr><tr><td style="padding:20px 18px;border-top:1px solid #dce4ec;font:12px/1.6 Arial,sans-serif;color:#536473">A little more room to care.</td></tr></table></td></tr></table>';
  const light = '<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><style>:root{color-scheme:light only}html,body{background-color:#ffffff!important}</style>';
  if (/<body\b[^>]*>/i.test(body) && /<\/body\s*>/i.test(body)) {
    let themed = body.replace(/(<body\b[^>]*>)/i, `$1${open}`).replace(/<\/body\s*>/i, `${close}</body>`);
    themed = /<\/head\s*>/i.test(themed)
      ? themed.replace(/<\/head\s*>/i, `${light}</head>`)
      : themed.replace(/(<html\b[^>]*>)/i, `$1<head>${light}</head>`);
    return themed;
  }
  assert(!/<(?:html|body|head)\b/i.test(body), 'Malformed full-document provider HTML requires a reviewed mapping.');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${light}</head><body style="margin:0;background:#ffffff">${open}${body}${close}</body></html>`;
}

function validateSnapshot(snapshot) {
  assert(snapshot?.schemaVersion === 1 && snapshot.provider === 'clerk' && typeof snapshot.instanceId === 'string' && snapshot.instanceId,
    'Expected a version 1 Clerk snapshot with an instance ID from --inspect.');
  assert(Array.isArray(snapshot.templates) && snapshot.templates.length > 0, 'The snapshot has no email templates.');
  assert(new Set(snapshot.templates.map((template) => template.slug)).size === snapshot.templates.length, 'The snapshot has duplicate template slugs.');
}

/** Build a reviewable offline plan. Slugs come only from an inspected instance. */
export function buildProviderPlan(snapshot, { slugs, brandOrigin, catalog, mappings } = {}) {
  validateSnapshot(snapshot);
  safeBrandOrigin(brandOrigin);
  const selected = slugs?.length ? slugs : snapshot.templates.filter((template) => template.can_edit_body === true).map((template) => template.slug);
  assert(selected.length > 0 && new Set(selected).size === selected.length, 'Select at least one unique editable template slug.');
  if (mappings) {
    assert(mappings.schemaVersion === 1 && Array.isArray(mappings.mappings), 'Expected version 1 mappings.');
    assert(catalog?.schemaVersion === 1 && Array.isArray(catalog.templates), 'Explicit mappings require a version 1 rendered catalog.');
    assert(new Set(mappings.mappings.map((mapping) => mapping.slug)).size === mappings.mappings.length, 'Duplicate mapped provider slug.');
    assert(new Set(catalog.templates.map((template) => template.id)).size === catalog.templates.length, 'Duplicate catalog template ID.');
    for (const mapping of mappings.mappings) assert(selected.includes(mapping.slug), `Mapping ${mapping.slug} is not selected from this snapshot.`);
  } else assert(!catalog, '--catalog requires explicit --mappings; provider slugs are never guessed.');
  const templates = selected.map((slug) => {
    const source = snapshot.templates.find((template) => template.slug === slug);
    assert(source, `Unknown provider slug ${slug}; inspect the target instance first.`);
    validateSource(source);
    const mapping = mappings?.mappings.find((item) => item.slug === slug);
    const rendered = mapping && catalog.templates.find((template) => template.id === mapping.templateId);
    assert(!mapping || rendered, `No rendered catalog template for ${mapping?.templateId}.`);
    const payload = {
      subject: rendered ? rendered.subject : source.subject,
      body: rendered ? rendered.html : themeProviderBody(source.body, { brandOrigin }),
    };
    validateReplacement(source, payload);
    return { id: `provider--${slug}`, slug, sourceSha256: sourceFingerprint(source), source, payload };
  });
  return {
    schemaVersion: 1, provider: 'clerk', instanceId: snapshot.instanceId,
    sourceInspectedAt: snapshot.inspectedAt, apiVersion: API_VERSION,
    warning: 'Clerk template REST endpoints are deprecated. Delivery, sender settings and editor markup are excluded from updates. Existing editor markup may need manual synchronization in the Clerk dashboard before later visual editing. This plan has not been applied.',
    templates,
  };
}

export function createClerkTemplateClient({ secretKey, fetchImpl = globalThis.fetch } = {}) {
  assert(typeof secretKey === 'string' && /^sk_(?:test|live)_\S+$/.test(secretKey), 'Set CLERK_SECRET_KEY for an explicit --inspect or --apply command.');
  async function request(path, { method = 'GET', body } = {}) {
    const response = await fetchImpl(`${API}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json', 'Clerk-API-Version': API_VERSION },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // Do not print provider error bodies: they may contain instance details or URLs.
    assert(response.ok, `Clerk template request failed (${response.status}); no retry was attempted. These endpoints are deprecated.`);
    return response.json();
  }
  return {
    getInstance: () => request('/instance'),
    listTemplates: (offset = 0) => request(`/templates/email?limit=100&offset=${offset}`),
    getTemplate: (slug) => {
      assert(SAFE_SLUG.test(slug), 'Invalid provider template slug.');
      return request(`/templates/email/${encodeURIComponent(slug)}`);
    },
    updateTemplate: (slug, payload, source) => {
      assert(SAFE_SLUG.test(slug), 'Invalid provider template slug.');
      assert(Object.keys(payload).sort().join(',') === payloadKeys.join(','), 'Unsafe provider update keys.');
      // The live endpoint requires name although its schema marks it optional.
      // Echo the exact inspected name; it is not an editable plan field.
      assert(source?.slug === slug && typeof source.name === 'string' && source.name.trim(), 'An exact retained provider name is required for an update.');
      return request(`/templates/email/${encodeURIComponent(slug)}`, { method: 'PUT', body: { name: source.name, ...payload } });
    },
  };
}

export async function inspectProviderTemplates(client, { now = () => new Date().toISOString() } = {}) {
  const instance = await client.getInstance();
  assert(typeof instance?.id === 'string' && instance.id, 'Clerk did not return an instance ID.');
  const templates = [];
  for (let offset = 0; offset < 10_000; offset += 100) {
    const page = await client.listTemplates(offset);
    assert(Array.isArray(page), 'Unexpected Clerk template-list response; refusing to infer its shape.');
    templates.push(...page);
    if (page.length < 100) {
      const snapshot = { schemaVersion: 1, provider: 'clerk', instanceId: instance.id, inspectedAt: now(), templates };
      validateSnapshot(snapshot);
      return snapshot;
    }
  }
  throw new Error('Clerk template pagination exceeded the safety limit.');
}

export async function applyProviderPlan(plan, { client, writeBackup } = {}) {
  assert(plan?.schemaVersion === 1 && plan.provider === 'clerk' && plan.apiVersion === API_VERSION && typeof plan.instanceId === 'string', 'Expected a version 1 Clerk export plan.');
  assert(Array.isArray(plan.templates) && plan.templates.length > 0, 'The plan has no templates.');
  assert(new Set(plan.templates.map((item) => item.slug)).size === plan.templates.length, 'The plan has duplicate slugs.');
  assert(typeof writeBackup === 'function', 'A backup writer is required before any provider change.');
  const instance = await client.getInstance();
  assert(instance.id === plan.instanceId, 'This secret key belongs to another Clerk instance; no changes were made.');
  const current = [];
  for (const item of plan.templates) {
    assert(item.slug === item.source?.slug && sourceFingerprint(item.source) === item.sourceSha256, 'Plan source fingerprint is invalid.');
    validateReplacement(item.source, item.payload);
    const template = await client.getTemplate(item.slug);
    assert(sourceFingerprint(template) === item.sourceSha256, `Clerk template ${item.slug} changed after inspection; inspect and export again. No changes were made.`);
    assert(typeof template.name === 'string' && template.name.trim(), `Clerk template ${item.slug} lacks its retained provider name; no changes were made.`);
    current.push(template);
  }
  // Complete validation and durable backup before the first write. No send,
  // invitation, preview, revert, or delivery-toggle endpoint is ever called.
  await writeBackup({ schemaVersion: 1, provider: 'clerk', instanceId: plan.instanceId, inspectedAt: new Date().toISOString(), templates: current });
  const applied = [];
  try {
    for (const item of plan.templates) {
      const updated = await client.updateTemplate(item.slug, item.payload, item.source);
      applied.push(item.slug);
      assert(updated?.slug === item.slug && updated.body === item.payload.body && updated.subject === item.payload.subject,
        `Clerk response did not confirm content for ${item.slug}; verify the instance before continuing.`);
      for (const field of ['name', 'delivered_by_clerk', 'enabled', 'from_email_name', 'reply_to_email_name']) {
        assert(updated[field] === item.source[field], `Clerk changed ${field} unexpectedly for ${item.slug}; inspect the saved backup before continuing.`);
      }
    }
  } catch (error) {
    throw new Error(`Apply stopped. Updated templates: ${applied.join(', ') || 'none confirmed'}. The pre-change backup is saved. ${error.message}`);
  }
  return { applied, instanceId: plan.instanceId };
}

const HELP = `Little hello — Clerk email branding (offline by default)

  node scripts/little-hello-clerk-emails.mjs --inspect --out .local-review/clerk-before.json
  node scripts/little-hello-clerk-emails.mjs --snapshot .local-review/clerk-before.json --out .local-review/clerk-plan.json [--slug SLUG] [--brand-origin https://YOUR-APP]
  node scripts/little-hello-clerk-emails.mjs --apply .local-review/clerk-plan.json --backup .local-review/clerk-backup.json

Only --inspect and --apply use CLERK_SECRET_KEY or make network calls.
All output files are private, created exclusively, and must be kept out of Git.
Review the exported HTML and provider variables before applying. The template
REST endpoints are deprecated; dashboard import is the fallback if unavailable.
Optional mapped catalog: --catalog FILE --mappings FILE; mappings must be exact
inspected slugs and all existing provider expressions/action hrefs must remain.
`;

async function privateJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}

export async function main(args = process.argv.slice(2), { env = process.env, fetchImpl, log = console.log } = {}) {
  if (!args.length || args.includes('--help')) { log(HELP); return; }
  const options = { slug: [] };
  const valueFlags = new Set(['snapshot', 'out', 'brand-origin', 'slug', 'catalog', 'mappings', 'apply', 'backup']);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    assert(flag.startsWith('--'), `Unexpected argument ${flag}.`);
    const name = flag.slice(2);
    if (name === 'inspect') { assert(!options.inspect, 'Duplicate --inspect.'); options.inspect = true; continue; }
    assert(valueFlags.has(name), `Unknown option ${flag}.`);
    const value = args[++index];
    assert(value && !value.startsWith('--'), `${flag} requires a value.`);
    if (name === 'slug') options.slug.push(value);
    else { assert(options[name] === undefined, `Duplicate ${flag}.`); options[name] = value; }
  }
  const modes = [options.inspect, options.apply, options.snapshot].filter(Boolean).length;
  assert(modes === 1, 'Choose exactly one of --inspect, --snapshot, or --apply.');
  const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
  if (options.inspect) {
    assert(options.out && !options.backup && !options.catalog && !options.mappings && !options['brand-origin'] && !options.slug.length, '--inspect requires only --out.');
    const snapshot = await inspectProviderTemplates(createClerkTemplateClient({ secretKey: env.CLERK_SECRET_KEY, fetchImpl }));
    await privateJson(options.out, snapshot);
    log(`Inspected ${snapshot.templates.length} Clerk email templates. Saved a private snapshot; no provider settings changed.`);
    return;
  }
  if (options.apply) {
    assert(options.backup && !options.out && !options.catalog && !options.mappings && !options['brand-origin'] && !options.slug.length, '--apply requires only --backup.');
    const plan = await readJson(options.apply);
    const result = await applyProviderPlan(plan, {
      client: createClerkTemplateClient({ secretKey: env.CLERK_SECRET_KEY, fetchImpl }),
      writeBackup: (value) => privateJson(options.backup, value),
    });
    log(`Applied ${result.applied.length} templates. No messages were sent and delivery settings were preserved.`);
    return;
  }
  assert(options.out && !options.backup, '--snapshot requires --out and does not use --backup.');
  const plan = buildProviderPlan(await readJson(options.snapshot), {
    slugs: options.slug, brandOrigin: options['brand-origin'],
    catalog: options.catalog ? await readJson(options.catalog) : undefined,
    mappings: options.mappings ? await readJson(options.mappings) : undefined,
  });
  await privateJson(options.out, plan);
  log(`Exported ${plan.templates.length} templates for review. Offline only; nothing was applied or sent.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
