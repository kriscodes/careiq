import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLERK_LITTLE_HELLO_MARKER, CLERK_LITTLE_HELLO_SLUGS,
  renderClerkLittleHelloCopy, validateClerkCopyAssetBaseUrl,
} from '../little-hello-clerk-copy.mjs';
import { sourceFingerprint, validateReplacement } from '../little-hello-clerk-emails.mjs';

const assetBaseUrl = 'https://cdn.example.com/reviewed/brand/little-hello';
const logo = '{{> app_logo}}';
const footer = '{{> footer}}';
const requested = '<p>{{requested_from}} at {{requested_at}}</p>';
const conditionalGreeting = '{{#if greeting_name}}<p>Hi {{greeting_name}}</p>{{/if}}';
const twoLinks = (href) => `<a href="${href}">Continue</a><a href="${href}">Fallback</a>`;
const magic = '<p>{{app.name}} {{ttl_minutes}}</p>' + twoLinks('{{magic_link}}') + requested;
const account = '<p>{{primary_email_address}}</p>';
const passkey = '<p>{{escapeURIs passkey_name}}</p>' + account;
// Minimal synthetic source templates exercise the actual provider expressions,
// never a real account, invitation, address, code, token, or private snapshot.
const bodies = {
  account_locked: '<p>{{app.name}} {{locked_date}} {{failed_attempts}} {{lockout_duration}} {{unlock_time}}</p>',
  magic_link_sign_in: magic,
  magic_link_sign_up: magic,
  magic_link_user_profile: magic,
  invitation: '<p>{{app.name}} {{invitation.expires_in_days}}</p>' + twoLinks('{{action_url}}'),
  mfa_enabled: '<p>{{app.name}}</p>' + conditionalGreeting + account + requested,
  organization_invitation: '<p>{{app.name}}</p>{{#if inviter_name}}<p>{{escapeURIs inviter_name}} {{escapeURIs org.name}} {{app.name}}</p>{{else}}<p>{{escapeURIs org.name}} {{app.name}}</p>{{/if}}' + twoLinks('{{action_url}}'),
  organization_invitation_accepted: '<p>{{org.name}} {{email_address}} {{escapeURIs org.name}}</p>' + twoLinks('{{app.url}}'),
  passkey_added: '<p>{{app.name}}</p>' + conditionalGreeting + passkey,
  passkey_removed: '<p>{{app.name}} {{greeting_name}}</p>' + passkey,
  password_changed: '<p>{{app.name}}</p>' + conditionalGreeting + account,
  password_removed: '<p>{{app.name}} {{greeting_name}}</p>' + account,
  primary_email_address_changed: '<p>{{app.name}} {{new_email_address}}</p>',
  reset_password_code: '<p>{{app.name}} {{otp_code}}</p>' + requested,
  new_device_sign_in: '<p>{{app.name}}</p>{{#if sign_in_method}}<p>{{sign_in_method}}</p>{{/if}}<p>{{browser_name}} {{operating_system}} {{location}} {{ip_address}} {{session_created_at}}</p>{{#if revoke_session_url}}' + twoLinks('{{revoke_session_url}}') + '{{/if}}{{#if support_email}}<a href="mailto:{{support_email}}">{{support_email}}</a>{{/if}}',
  verification_code: '<p>{{app.name}} {{otp_code}}</p>' + requested,
};
const requirements = {
  magic_link_sign_in: ['magic_link'], magic_link_sign_up: ['magic_link'], magic_link_user_profile: ['magic_link'],
  invitation: ['action_url'], organization_invitation: ['action_url'], organization_invitation_accepted: ['email_address'],
  mfa_enabled: ['primary_email_address'], passkey_added: ['primary_email_address'], passkey_removed: ['primary_email_address'],
  password_changed: ['primary_email_address'], password_removed: ['primary_email_address'],
  primary_email_address_changed: ['new_email_address'], reset_password_code: ['otp_code'], verification_code: ['otp_code'],
};
function fixture(slug = 'verification_code', overrides = {}) {
  return {
    object: 'template', template_type: 'email', slug, can_edit_body: true,
    subject: 'Original subject {{app.name}}\n',
    body: '<!doctype html><html><head><title>Fixture</title></head><body>' + logo + bodies[slug] + footer + '</body></html>',
    required_variables: requirements[slug] || [], available_variables: ['app.name'],
    ...overrides,
  };
}
function render(source, options = {}) {
  return renderClerkLittleHelloCopy(source, { assetBaseUrl, expectedSourceSha256: sourceFingerprint(source), ...options });
}
const tokens = (body) => [...new Set(body.match(/\{\{\{?[\s\S]*?\}\}\}?/g) || [])].sort();
const control = (body) => body.match(/\{\{(?:#if\s+[^}]+|else|\/if)\}\}/g) || [];
const hrefs = (body) => [...body.matchAll(/\bhref="([^"]+)"/g)].map((match) => match[1]).filter((href) => href.includes('{{')).sort();

test('exactly the 16 reviewed authentication/security slugs are supported', () => {
  assert.deepEqual([...CLERK_LITTLE_HELLO_SLUGS].sort(), Object.keys(bodies).sort());
});

for (const slug of Object.keys(bodies)) {
  test(`${slug}: preserves subject, functional expressions, controls, and every action anchor`, () => {
    const source = fixture(slug);
    const payload = render(source);
    assert.deepEqual(Object.keys(payload).sort(), ['body', 'subject']);
    assert.equal(payload.subject, source.subject);
    assert.equal(validateReplacement(source, payload), payload);
    assert.deepEqual(tokens(payload.body), tokens(source.body).filter((token) => token !== logo));
    assert.deepEqual(control(payload.body), control(source.body));
    assert.deepEqual(hrefs(payload.body), hrefs(source.body));
    assert.equal(payload.body.split(footer).length - 1, 1);
    assert.equal(payload.body.includes(logo), false);
    assert.equal(payload.body.split('/careiq-wordmark.png').length - 1, 1);
    assert.equal(payload.body.split('/little-hello-companion.png').length - 1, 1);
  });
}

test('full reviewed source fingerprint is mandatory and detects prose, subject, or metadata drift', () => {
  const source = fixture();
  assert.throws(() => renderClerkLittleHelloCopy(source, { assetBaseUrl }), /expectedSourceSha256/);
  const expectedSourceSha256 = sourceFingerprint(source);
  for (const changed of [
    { ...source, body: source.body.replace('Fixture', 'Changed source prose') },
    { ...source, subject: source.subject.trim() },
    { ...source, required_variables: [] },
  ]) assert.throws(() => render(changed, { expectedSourceSha256 }), /changed after review/);
});

test('billing, waitlist, opaque, unknown and noneditable sources fail closed', () => {
  for (const slug of ['billing_free_trial_renewal_upcoming', 'waitlist_invitation', 'opaque_token_usage_limit_alert', 'new_future_template', '__proto__']) {
    assert.throws(() => render(fixture('verification_code', { slug })), /Unsupported/);
  }
  assert.throws(() => render(fixture('verification_code', { can_edit_body: false })), /editable/);
});

test('new or missing provider expressions require mapping review', () => {
  const source = fixture();
  assert.throws(() => render({ ...source, body: source.body + '{{unknown_future_variable}}' }), /expression contract changed/);
  assert.throws(() => render({ ...source, body: source.body.replace('{{requested_at}}', '') }), /expression contract changed/);
});

test('provider conditional order cannot change even with a newly reviewed fingerprint', () => {
  const source = fixture('new_device_sign_in');
  const changed = source.body.replace('{{#if sign_in_method}}<p>{{sign_in_method}}</p>{{/if}}', '')
    .replace(footer, '{{#if sign_in_method}}<p>{{sign_in_method}}</p>{{/if}}' + footer);
  assert.throws(() => render({ ...source, body: changed }), /conditional structure changed/);
});

test('variables retain all original conditional branch contexts', () => {
  const source = fixture('organization_invitation');
  const changed = source.body.replace('{{escapeURIs org.name}} {{app.name}}</p>{{else}}', '{{escapeURIs org.name}}</p>{{else}}');
  assert.throws(() => render({ ...source, body: changed }), /expression conditional context changed/);
});

test('action URLs, fallback anchor counts and conditional scope cannot change', () => {
  const magicSource = fixture('magic_link_sign_in');
  assert.throws(() => render({ ...magicSource, body: magicSource.body.replace('href="{{magic_link}}"', 'href="{{magic_link}}?different=1"') }), /action URL count or conditional context changed/);
  assert.throws(() => render({ ...magicSource, body: magicSource.body.replace('<a href="{{magic_link}}">Fallback</a>', '') }), /action URL count or conditional context changed/);
  const deviceSource = fixture('new_device_sign_in');
  const outside = deviceSource.body.replace(twoLinks('{{revoke_session_url}}'), '')
    .replace(footer, twoLinks('{{revoke_session_url}}') + footer);
  assert.throws(() => render({ ...deviceSource, body: outside }), /action URL count or conditional context changed/);
});

test('new-device recovery guidance survives missing optional sign-out and support blocks', () => {
  const body = render(fixture('new_device_sign_in')).body;
  const withoutOptionalActions = body.replace(/\{\{#if (?:revoke_session_url|support_email)\}\}[\s\S]*?\{\{\/if\}\}/g, '');
  assert.match(withoutOptionalActions, /If you don’t recognize this sign-in, open CareIQ directly to review your account security\./);
  assert.doesNotMatch(withoutOptionalActions, /revoke_session_url|support_email|Sign out of this device/);
  assert.equal(body.split('open CareIQ directly to review your account security').length - 1, 1);
  assert.deepEqual(hrefs(body), ['mailto:{{support_email}}', '{{revoke_session_url}}', '{{revoke_session_url}}'].sort());
});

test('only reviewed public HTTPS asset directories are accepted', () => {
  for (const bad of [
    undefined, '', 'http://cdn.example.com/brand', 'https://localhost/brand', 'https://127.0.0.1/brand',
    'https://[::1]/brand', 'https://169.254.169.254/brand', 'https://careiq.local/brand', 'https://careiq.internal/brand',
    'https://careiq.test/brand', 'https://user:password@cdn.example.com/brand', 'https://cdn.example.com/brand?token=1',
    'https://cdn.example.com/brand#section', 'https://cdn.example.com:444/brand', 'https://cdn.example.com/%2e/brand',
    'javascript:alert(1)', 'data:image/png;base64,example',
  ]) assert.throws(() => validateClerkCopyAssetBaseUrl(bad), /public HTTPS/);
  assert.equal(validateClerkCopyAssetBaseUrl(assetBaseUrl + '/'), assetBaseUrl);
  assert.throws(() => render(fixture(), { assetBaseUrl: undefined }), /assetBaseUrl/);
});

test('light-only white layout, approved blue, fonts, assets and responsive provider footer are explicit', () => {
  for (const slug of CLERK_LITTLE_HELLO_SLUGS) {
    const body = render(fixture(slug)).body;
    assert.match(body, /color-scheme:only light/);
    assert.match(body, /bgcolor="#ffffff"/);
    assert.match(body, /Georgia,serif/);
    assert.match(body, /Arial,sans-serif/);
    assert.match(body, /overflow-wrap:anywhere;word-break:break-word/);
    assert.match(body, /\.careiq-card\{padding:20px!important\}/);
    assert.match(body, /#0067e8/);
    assert.match(body, /\.container\{width:100%!important;max-width:560px!important\}/);
    assert.match(body, new RegExp(CLERK_LITTLE_HELLO_MARKER));
    assert.doesNotMatch(body, /prefers-color-scheme|light-dark\(|color-scheme\s*:\s*dark|background[^;"}]*#(?:000|111|222)/i);
    assert.doesNotMatch(body, /<script\b|\bon\w+\s*=|(?:href|src)="(?:javascript:|data:)/i);
    for (const comment of body.match(/<!--[\s\S]*?-->/g) || []) assert.doesNotMatch(comment, /\{\{/);
  }
});

test('generic verification copy works across verification purposes without a fictional code or expiry', () => {
  const body = render(fixture()).body;
  assert.match(body, /complete the verification you started/);
  assert.doesNotMatch(body, /finish signing in|creating an account|two-step verification|\b123456\b|expires in/i);
  // The provider code may appear in both its original title context and body.
  assert.equal(body.split('{{otp_code}}').length - 1, 2);
});

test('organization acceptance asks for owner review without asserting an unknown activation state', () => {
  const body = render(fixture('organization_invitation_accepted')).body;
  assert.match(body, /<title>New team member in \{\{org\.name\}\}<\/title>/);
  assert.match(body, /Review their role and locations in CareIQ/);
  assert.match(body, /If access is still pending/);
  assert.match(body, /does not automatically activate clinical access/);
  assert.doesNotMatch(body, /Their practice access is pending/);
});

test('security guidance also fits people without a practice administrator', () => {
  for (const slug of ['mfa_enabled', 'passkey_added', 'passkey_removed', 'password_changed', 'password_removed', 'primary_email_address_changed']) {
    const body = render(fixture(slug)).body;
    assert.match(body, /open CareIQ directly to review your account security/);
    assert.doesNotMatch(body, /your practice administrator/i);
  }
  assert.match(render(fixture('account_locked')).body, /contact support through a channel you trust/);
});

test('required-variable metadata and already branded sources are still guarded', () => {
  assert.throws(() => render(fixture('verification_code', { required_variables: ['unavailable_variable'] })), /missing required/);
  const source = fixture();
  assert.throws(() => render({ ...source, body: source.body + CLERK_LITTLE_HELLO_MARKER }), /unbranded/);
});

test('rendering is deterministic and does not call the network', () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Unexpected network request'); };
  try {
    const source = fixture('new_device_sign_in');
    assert.deepEqual(render(source), render(source));
  } finally { globalThis.fetch = originalFetch; }
});
