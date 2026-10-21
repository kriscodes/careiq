import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  applyProviderPlan, buildProviderPlan, createClerkTemplateClient, inspectProviderTemplates,
  main, sourceFingerprint, themeProviderBody, validateReplacement,
} from '../little-hello-clerk-emails.mjs';

// Deliberately invented fixtures: no production slugs, credentials, or real URLs.
const template = (overrides = {}) => ({
  id: 'fixture_template', object: 'template', instance_id: 'ins_fixture',
  template_type: 'email', slug: 'fixture_verification', can_edit_body: true,
  name: 'Fixture verification', subject: 'Your {{app.name}} code',
  body: '<p>Your code: {{otp_code}}</p><a href="{{action_url}}">Continue</a>{{> copyright}}',
  markup: '<fixture-editor-source/>', available_variables: ['otp_code', 'action_url', 'app.name'],
  required_variables: ['otp_code', 'action_url'], delivered_by_clerk: true,
  enabled: true, from_email_name: 'hello', reply_to_email_name: 'help', updated_at: 1,
  ...overrides,
});
const snapshot = (templates = [template()]) => ({
  schemaVersion: 1, provider: 'clerk', instanceId: 'ins_fixture',
  inspectedAt: '2026-10-21T00:00:00.000Z', templates,
});
const errorFetch = async () => { throw new Error('Unexpected network request'); };

function mockClient(current = [template()], { instanceId = 'ins_fixture', update } = {}) {
  const events = [];
  return {
    events,
    client: {
      getInstance: async () => { events.push('instance'); return { id: instanceId }; },
      getTemplate: async (slug) => { events.push(`read:${slug}`); return current.find((item) => item.slug === slug); },
      updateTemplate: async (slug, payload) => {
        events.push(`write:${slug}`);
        return update ? update(slug, payload) : { ...current.find((item) => item.slug === slug), ...payload };
      },
    },
  };
}

test('default CLI is offline and does not require a secret key', async () => {
  let output = '';
  await main([], { env: {}, fetchImpl: errorFetch, log: (value) => { output = value; } });
  assert.match(output, /offline by default/);
  assert.match(output, /deprecated/);
});

test('provider branding preserves source content, expressions, dynamic hrefs and subject', () => {
  const original = template();
  const plan = buildProviderPlan(snapshot([original]));
  const item = plan.templates[0];
  assert.equal(item.id, `provider--${original.slug}`);
  assert.ok(item.payload.body.includes(original.body));
  assert.match(item.payload.body, /color-scheme" content="light"/);
  assert.match(item.payload.body, /background:#ffffff/);
  assert.match(item.payload.body, /A little more room to care\./);
  assert.equal(item.payload.subject, original.subject);
  assert.deepEqual(Object.keys(item.payload).sort(), ['body', 'subject']);
  assert.equal(item.source.markup, original.markup);
  assert.equal(item.sourceSha256, sourceFingerprint(original));
  assert.match(plan.warning, /editor markup/);
});

test('full-document provider HTML keeps existing styles and body markup', () => {
  const original = '<!doctype html><html><head><style>.original{padding:3px}</style></head><body><div class="original">{{otp_code}}</div></body></html>';
  const themed = themeProviderBody(original);
  assert.ok(themed.includes('<style>.original{padding:3px}</style>'));
  assert.ok(themed.includes('<div class="original">{{otp_code}}</div>'));
  assert.equal((themed.match(/<html>/g) || []).length, 1);
  assert.equal((themed.match(/<body>/g) || []).length, 1);
  assert.match(themed, /supported-color-schemes/);
});

test('HTTPS brand origin uses the agreed asset and rejects unsafe image origins', () => {
  const branded = themeProviderBody('<p>Hello</p>', { brandOrigin: 'https://app.example.test' });
  assert.match(branded, /https:\/\/app.example.test\/brand\/little-hello\/careiq-wordmark.png/);
  assert.match(branded, /https:\/\/app.example.test\/brand\/little-hello\/little-hello-companion.png/);
  assert.match(branded, /bgcolor="#ffffff"/);
  assert.match(branded, /alt="" role="presentation"/);
  for (const brandOrigin of ['http://example.test', 'https://a:b@example.test', 'https://example.test/private', 'https://example.test/?secret=x']) {
    assert.throws(() => themeProviderBody('<p>Hello</p>', { brandOrigin }), /HTTPS origin/);
  }
  const fallback = themeProviderBody('<p>Hello</p>');
  assert.doesNotMatch(fallback, /<img/);
  assert.match(fallback, />CareIQ/);
  assert.match(fallback, /color:#0067e8[^>]*>\+<\/span>/);
});

test('dark-preference CSS and double branding require review', () => {
  assert.throws(() => themeProviderBody('<style>@media (prefers-color-scheme: dark){body{background:black}}</style>'), /dark-preference/);
  assert.throws(() => themeProviderBody('<style>body{background:light-dark(white,black)}</style>'), /dark-preference/);
  assert.throws(() => themeProviderBody(themeProviderBody('<p>Hello</p>')), /already has/);
});

test('unverified slugs, locked templates and missing variable metadata fail closed', () => {
  assert.throws(() => buildProviderPlan(snapshot(), { slugs: ['not_returned_by_provider'] }), /Unknown provider slug/);
  assert.throws(() => buildProviderPlan(snapshot([template({ can_edit_body: false })]), { slugs: ['fixture_verification'] }), /does not allow/);
  assert.throws(() => buildProviderPlan(snapshot([template({ required_variables: undefined })])), /variable metadata/);
});

test('mapped HTML cannot remove tokens, introduce unknown expressions or demote action links', () => {
  const original = template();
  const valid = { subject: original.subject, body: themeProviderBody(original.body) };
  assert.equal(validateReplacement(original, valid), valid);
  assert.throws(() => validateReplacement(original, { ...valid, body: valid.body.replace('{{otp_code}}', '123456') }), /removed provider expression/);
  assert.throws(() => validateReplacement(original, { ...valid, body: `${valid.body}{{unverified_role}}` }), /unverified provider expression/);
  assert.throws(() => validateReplacement(original, { ...valid, body: valid.body.replace('href="{{action_url}}"', 'data-action="{{action_url}}"') }), /action URL/);
  assert.throws(() => validateReplacement(original, { ...valid, delivered_by_clerk: false }), /excluded/);
  assert.throws(() => validateReplacement(original, { ...valid, markup: null }), /excluded/);
  assert.throws(() => validateReplacement(original, { ...valid, body: `${valid.body}<script>alert(1)</script>` }), /unsafe script/);
});

test('catalog mapping requires exact reviewed provider slug and retained expressions', () => {
  const original = template();
  const catalog = { schemaVersion: 1, templates: [{ id: 'sample', subject: original.subject, html: themeProviderBody(original.body), text: 'Sample' }] };
  const mappings = { schemaVersion: 1, mappings: [{ slug: original.slug, templateId: 'sample' }] };
  const plan = buildProviderPlan(snapshot(), { catalog, mappings });
  assert.equal(plan.templates[0].payload.body, catalog.templates[0].html);
  assert.throws(() => buildProviderPlan(snapshot(), { catalog }), /explicit --mappings/);
  assert.throws(() => buildProviderPlan(snapshot(), { catalog, mappings: { ...mappings, mappings: [{ slug: 'guessed_slug', templateId: 'sample' }] } }), /not selected/);
});

test('REST client uses only documented template endpoints with pinned version and no redirects', async () => {
  const calls = [];
  const client = createClerkTemplateClient({ secretKey: 'sk_test_fixture_only', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({}) };
  } });
  await client.getInstance();
  await client.listTemplates(100);
  await client.getTemplate('fixture_verification');
  await client.updateTemplate('fixture_verification', { subject: 'Hello', body: '<p>Hello</p>' });
  assert.deepEqual(calls.map((call) => call.options.method), ['GET', 'GET', 'GET', 'PUT']);
  assert.equal(calls[1].url, 'https://api.clerk.com/v1/templates/email?limit=100&offset=100');
  assert.equal(calls[0].options.headers['Clerk-API-Version'], '2026-05-12');
  assert.ok(calls.every((call) => call.options.redirect === 'error'));
  assert.deepEqual(JSON.parse(calls[3].options.body), { subject: 'Hello', body: '<p>Hello</p>' });
  assert.throws(() => client.getTemplate('../users'), /Invalid provider/);
  assert.throws(() => client.updateTemplate('fixture', { body: 'Hello', subject: 'Hello', delivered_by_clerk: false }), /Unsafe/);
});

test('provider errors are redacted and not retried', async () => {
  let calls = 0;
  const client = createClerkTemplateClient({ secretKey: 'sk_test_fixture_only', fetchImpl: async () => {
    calls += 1;
    return { ok: false, status: 410, json: async () => ({ secret: 'do-not-log' }) };
  } });
  await assert.rejects(client.getInstance(), (error) => /410/.test(error.message) && !error.message.includes('do-not-log'));
  assert.equal(calls, 1);
});

test('inspection only reads instance/template pages and retains exact metadata', async () => {
  const offsets = [];
  const snapshotResult = await inspectProviderTemplates({
    getInstance: async () => ({ id: 'ins_fixture' }),
    listTemplates: async (offset) => {
      offsets.push(offset);
      return offset === 0
        ? Array.from({ length: 100 }, (_, index) => template({ slug: `fixture_${index}` }))
        : [template({ slug: 'fixture_last' })];
    },
  }, { now: () => 'fixture-time' });
  assert.deepEqual(offsets, [0, 100]);
  assert.equal(snapshotResult.templates.length, 101);
  assert.equal(snapshotResult.inspectedAt, 'fixture-time');
  assert.equal(snapshotResult.templates[0].markup, '<fixture-editor-source/>');
});

test('apply validates every source, saves a backup, then writes only content', async () => {
  const originals = [template(), template({ slug: 'fixture_second', id: 'fixture_second' })];
  const { client, events } = mockClient(originals);
  const result = await applyProviderPlan(buildProviderPlan(snapshot(originals)), {
    client, writeBackup: async (backup) => { events.push('backup'); assert.deepEqual(backup.templates, originals); },
  });
  assert.deepEqual(events, ['instance', 'read:fixture_verification', 'read:fixture_second', 'backup', 'write:fixture_verification', 'write:fixture_second']);
  assert.equal(result.applied.length, 2);
});

test('instance mismatch, drift, backup failure and unsafe plan all block provider writes', async () => {
  const plan = buildProviderPlan(snapshot());
  const wrong = mockClient([template()], { instanceId: 'another_instance' });
  await assert.rejects(applyProviderPlan(plan, { client: wrong.client, writeBackup: async () => {} }), /another Clerk instance/);
  assert.deepEqual(wrong.events, ['instance']);
  const changed = mockClient([template({ body: '<p>A newer template</p>' })]);
  await assert.rejects(applyProviderPlan(plan, { client: changed.client, writeBackup: async () => {} }), /changed after inspection/);
  assert.ok(!changed.events.some((event) => event.startsWith('write:')));
  const noBackup = mockClient();
  await assert.rejects(applyProviderPlan(plan, { client: noBackup.client, writeBackup: async () => { throw new Error('disk full'); } }), /disk full/);
  assert.ok(!noBackup.events.some((event) => event.startsWith('write:')));
  const unsafe = structuredClone(plan);
  unsafe.templates[0].payload.from_email_name = 'changed';
  const unsafeClient = mockClient();
  await assert.rejects(applyProviderPlan(unsafe, { client: unsafeClient.client, writeBackup: async () => {} }), /excluded/);
  assert.ok(!unsafeClient.events.some((event) => event.startsWith('write:')));
});

test('partial apply stops on provider failure and reports backup plus confirmed writes', async () => {
  const originals = [template(), template({ slug: 'fixture_second' })];
  const { client, events } = mockClient(originals, { update: async (slug, payload) => {
    if (slug === 'fixture_second') throw new Error('Provider unavailable');
    return { ...originals[0], ...payload };
  } });
  let backedUp = false;
  await assert.rejects(applyProviderPlan(buildProviderPlan(snapshot(originals)), {
    client, writeBackup: async () => { backedUp = true; },
  }), /Updated templates: fixture_verification\. The pre-change backup is saved/);
  assert.equal(backedUp, true);
  assert.equal(events.filter((event) => event.startsWith('write:')).length, 2);
});

test('provider response changing delivery settings stops apply', async () => {
  const { client } = mockClient([template()], { update: async (_slug, payload) => ({ ...template(), ...payload, delivered_by_clerk: false }) });
  await assert.rejects(applyProviderPlan(buildProviderPlan(snapshot()), { client, writeBackup: async () => {} }), /changed delivered_by_clerk unexpectedly/);
});

test('offline export writes private exclusive files without using credentials or network', async () => {
  const base = join(process.cwd(), '.local-review');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, 'little-hello-clerk-test-'));
  try {
    const sourcePath = join(directory, 'source.json');
    const planPath = join(directory, 'plan.json');
    await writeFile(sourcePath, JSON.stringify(snapshot()), { mode: 0o600 });
    await main(['--snapshot', sourcePath, '--out', planPath], { env: {}, fetchImpl: errorFetch, log: () => {} });
    const result = JSON.parse(await readFile(planPath, 'utf8'));
    assert.equal(result.templates[0].slug, 'fixture_verification');
    assert.equal((await stat(planPath)).mode & 0o777, 0o600);
    await assert.rejects(main(['--snapshot', sourcePath, '--out', planPath], { env: {}, fetchImpl: errorFetch, log: () => {} }), /EEXIST/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
