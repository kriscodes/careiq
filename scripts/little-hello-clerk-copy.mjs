/**
 * Purpose-written Little hello copy for reviewed Clerk email sources.
 * Pure/offline: no credentials, files, provider calls, or delivery settings.
 * The caller must supply the fingerprint of the source reviewed before rendering.
 * Subjects remain byte-for-byte provider originals. Only app_logo is replaced by
 * the two reviewed brand images; the installer validates that narrow exception.
 */
import { sourceFingerprint, validateReplacement } from './little-hello-clerk-emails.mjs';

export const CLERK_LITTLE_HELLO_MARKER = 'careiq-little-hello-provider-v1';
const BLUE = '#0067e8';
const TEXT = '#23313c';
const MUTED = '#536473';
const BORDER = '#dce4ec';
const TOKEN = /\{\{\{?[\s\S]*?\}\}\}?/g;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const common = ['{{> app_logo}}', '{{> footer}}'];
const app = '{{app.name}}';
const greeting = ['{{#if greeting_name}}', '{{greeting_name}}', '{{/if}}'];
const requested = ['{{requested_from}}', '{{requested_at}}'];
const magic = [app, '{{ttl_minutes}}', '{{magic_link}}', ...requested];
const account = ['{{primary_email_address}}'];
const contracts = {
  account_locked: [app, '{{locked_date}}', '{{failed_attempts}}', '{{lockout_duration}}', '{{unlock_time}}'],
  magic_link_sign_in: magic,
  magic_link_sign_up: magic,
  magic_link_user_profile: magic,
  invitation: [app, '{{invitation.expires_in_days}}', '{{action_url}}'],
  mfa_enabled: [app, ...greeting, ...account, ...requested],
  organization_invitation: [app, '{{#if inviter_name}}', '{{escapeURIs inviter_name}}', '{{escapeURIs org.name}}', '{{else}}', '{{/if}}', '{{action_url}}'],
  organization_invitation_accepted: ['{{org.name}}', '{{email_address}}', '{{escapeURIs org.name}}', '{{app.url}}'],
  passkey_added: [app, ...greeting, '{{escapeURIs passkey_name}}', ...account],
  passkey_removed: [app, '{{greeting_name}}', '{{escapeURIs passkey_name}}', ...account],
  password_changed: [app, ...greeting, ...account],
  password_removed: [app, '{{greeting_name}}', ...account],
  primary_email_address_changed: [app, '{{new_email_address}}'],
  reset_password_code: [app, '{{otp_code}}', ...requested],
  new_device_sign_in: [app, '{{#if sign_in_method}}', '{{sign_in_method}}', '{{/if}}', '{{browser_name}}', '{{operating_system}}', '{{location}}', '{{ip_address}}', '{{session_created_at}}', '{{#if revoke_session_url}}', '{{revoke_session_url}}', '{{#if support_email}}', '{{support_email}}'],
  verification_code: [app, '{{otp_code}}', ...requested],
};
export const CLERK_LITTLE_HELLO_SLUGS = Object.freeze(Object.keys(contracts));

const controls = {
  mfa_enabled: ['{{#if greeting_name}}', '{{/if}}'],
  organization_invitation: ['{{#if inviter_name}}', '{{else}}', '{{/if}}'],
  passkey_added: ['{{#if greeting_name}}', '{{/if}}'],
  password_changed: ['{{#if greeting_name}}', '{{/if}}'],
  new_device_sign_in: ['{{#if sign_in_method}}', '{{/if}}', '{{#if revoke_session_url}}', '{{/if}}', '{{#if support_email}}', '{{/if}}'],
};

const titles = {
  account_locked: 'Your account has been locked - {{app.name}}',
  magic_link_sign_in: 'Sign in to {{app.name}}',
  magic_link_sign_up: 'Sign up to {{app.name}}',
  magic_link_user_profile: 'Verify your email address to {{app.name}}',
  invitation: 'Your invitation to {{app.name}}',
  mfa_enabled: 'Multi-factor Authentication Enabled - {{app.name}}',
  organization_invitation: 'Your invitation to {{app.name}}',
  organization_invitation_accepted: 'New team member in {{org.name}}',
  passkey_added: 'Your {{app.name}} passkey has been added',
  passkey_removed: 'Your {{app.name}} passkey has been removed',
  password_changed: 'Your {{app.name}} password has been changed',
  password_removed: 'Your {{app.name}} password has been removed',
  primary_email_address_changed: 'Your {{app.name}} primary email address was updated',
  reset_password_code: '{{otp_code}} is your {{app.name}} reset password code',
  new_device_sign_in: 'New sign in to your account',
  verification_code: '{{otp_code}} is your {{app.name}} verification code',
};

function escapeAttribute(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Public HTTPS path to the directory containing the two approved PNG files. */
export function validateClerkCopyAssetBaseUrl(value) {
  assert(typeof value === 'string' && value.trim() === value && value, 'A reviewed public HTTPS assetBaseUrl is required.');
  let url;
  try { url = new URL(value); } catch { throw new Error('assetBaseUrl must be a public HTTPS directory URL.'); }
  const host = url.hostname.toLowerCase();
  assert(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
    && !url.port && !/[\\%]/.test(value) && host.includes('.')
    && !/^[\d.]+$/.test(host) && !host.includes(':')
    && !/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)
    && !/\.(?:localhost|local|internal|test|invalid)$/.test(host),
  'assetBaseUrl must be a public HTTPS directory URL without credentials, query, fragment, or a private host.');
  return url.href.replace(/\/+$/, '');
}

function expressions(body) {
  return [...new Set(body.match(TOKEN) || [])].sort();
}

// A conditional path includes its branch and position, so moving a functional
// token or action from an optional block to the main message cannot pass review.
function structure(body) {
  const stack = [];
  const control = [];
  const context = new Map();
  const ranges = [];
  let nextBlock = 0;
  let previous = 0;
  const path = () => stack.map(({ id, name, branch }) => `${id}:${name}:${branch}`).join('/');
  for (const match of body.matchAll(TOKEN)) {
    ranges.push({ start: previous, end: match.index, path: path() });
    const token = match[0];
    const open = /^\{\{#if\s+([^}]+)\}\}$/.exec(token);
    if (open) {
      control.push(token);
      stack.push({ id: nextBlock++, name: open[1], branch: 'if' });
    } else if (token === '{{else}}') {
      assert(stack.length && stack.at(-1).branch === 'if', 'Malformed provider conditional else.');
      control.push(token);
      stack.at(-1).branch = 'else';
    } else if (token === '{{/if}}') {
      assert(stack.length, 'Malformed provider conditional closing token.');
      control.push(token);
      stack.pop();
    } else {
      assert(!/^\{\{[#/^!]/.test(token), 'Unsupported provider template control expression.');
      if (!context.has(token)) context.set(token, new Set());
      context.get(token).add(path());
    }
    previous = match.index + token.length;
  }
  assert(stack.length === 0, 'Unclosed provider conditional.');
  ranges.push({ start: previous, end: body.length, path: path() });
  const hrefs = [...body.matchAll(/\bhref\s*=\s*(["'])([\s\S]*?)\1/gi)]
    .filter((match) => match[2].includes('{{'))
    .map((match) => {
      const range = ranges.find(({ start, end }) => match.index >= start && match.index <= end);
      assert(range, 'A provider action href crosses a conditional token.');
      return `${range.path}\u0000${match[2]}`;
    }).sort();
  return { control, context, hrefs };
}

function sameArray(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateContract(source, expectedSourceSha256) {
  assert(source && Object.hasOwn(contracts, source.slug), `Unsupported Clerk Little hello template: ${source?.slug || '(missing)'}.`);
  assert(source.template_type === 'email' && source.can_edit_body === true, 'Only inspected editable Clerk email templates are supported.');
  assert(typeof source.body === 'string' && source.body.trim() && !source.body.includes(CLERK_LITTLE_HELLO_MARKER), 'Expected an unbranded reviewed source body.');
  assert(typeof expectedSourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(expectedSourceSha256), 'A reviewed expectedSourceSha256 is required.');
  assert(sourceFingerprint(source) === expectedSourceSha256, `${source.slug}: provider source changed after review; inspect and review again.`);
  assert(sameArray(expressions(source.body), [...new Set([...common, ...contracts[source.slug]])].sort()), `${source.slug}: provider expression contract changed; review the mapping.`);
  const original = structure(source.body);
  assert(sameArray(original.control, controls[source.slug] || []), `${source.slug}: provider conditional structure changed; review the mapping.`);
  return original;
}

const p = (text, extra = '') => `<p style="margin:0 0 18px;font:16px/1.65 Arial,sans-serif;color:${TEXT};${extra}">${text}</p>`;
const note = (text) => p(text, `font-size:13px;line-height:1.65;color:${MUTED};`);
const hi = '{{#if greeting_name}}' + p('Hi {{greeting_name}},') + '{{/if}}';
const requestDetails = () => note('Requested from {{requested_from}} at {{requested_at}}.');
const unexpected = () => note('If you didn’t make this change, open CareIQ directly to review your account security. Never reply with a password or verification code.');
const code = () => `<div style="margin:24px 0;padding:22px 12px;border:1px solid ${BORDER};border-radius:14px;background:#ffffff;text-align:center;font:700 32px/1.3 Arial,sans-serif;letter-spacing:6px;color:${BLUE};word-break:break-word">{{otp_code}}</div>`;
const action = (href, label) => `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0"><tr><td bgcolor="${BLUE}" style="border-radius:12px;background:${BLUE}"><a href="${href}" style="display:inline-block;padding:15px 24px;border:1px solid ${BLUE};border-radius:12px;background:${BLUE};color:#ffffff;text-decoration:none;font:700 15px/1.3 Arial,sans-serif">${label}</a></td></tr></table>${note(`Button not opening? <a href="${href}" style="color:${BLUE};text-decoration:underline">Use this link instead</a>.`)}`;
const detail = (label, value) => `<tr><td valign="top" style="padding:7px 12px 7px 0;font:13px/1.6 Arial,sans-serif;color:${MUTED}">${label}</td><td valign="top" style="padding:7px 0;font:14px/1.5 Arial,sans-serif;color:${TEXT};word-break:break-word">${value}</td></tr>`;
const details = (rows) => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;margin:20px 0;border-top:1px solid ${BORDER};border-bottom:1px solid ${BORDER};background:#ffffff">${rows}</table>`;

function content(slug) {
  switch (slug) {
    case 'account_locked': return {
      heading: 'Your account is locked.', preheader: 'A pause to help keep your account safe.',
      body: p('Access to your {{app.name}} account has been temporarily restricted after unsuccessful sign-in attempts.')
        + details(detail('Locked on', '{{locked_date}}') + detail('Failed attempts', '{{failed_attempts}}'))
        + p('Your account will unlock automatically after {{lockout_duration}}, at {{unlock_time}}.')
        + note('If you don’t recognize these attempts or need help, contact support through a channel you trust. Never send your password or verification codes by email.'),
    };
    case 'magic_link_sign_in': return {
      heading: 'Hello again.', preheader: 'Your sign-in link is ready.',
      body: p('Use this link to sign in to {{app.name}}.') + p('It expires in {{ttl_minutes}} minutes.')
        + action('{{magic_link}}', 'Sign in') + requestDetails()
        + note('If you didn’t request this link, you can ignore this email. Keep your sign-in link to yourself.'),
    };
    case 'magic_link_sign_up': return {
      heading: 'A little hello.', preheader: 'One small step to your account.',
      body: p('Use this link to continue creating your {{app.name}} account.') + p('It expires in {{ttl_minutes}} minutes.')
        + action('{{magic_link}}', 'Continue creating account') + requestDetails()
        + note('Creating an account does not grant practice access. If you didn’t request this link, you can ignore this email.'),
    };
    case 'magic_link_user_profile': return {
      heading: 'New email. Same you.', preheader: 'Confirm the email address you want to use.',
      body: p('Use this link to verify this email address for your {{app.name}} account.') + p('It expires in {{ttl_minutes}} minutes.')
        + action('{{magic_link}}', 'Verify email address') + requestDetails()
        + note('If you didn’t request this, don’t use or share the link. Email verification does not grant practice access.'),
    };
    case 'invitation': return {
      heading: 'A little hello.', preheader: 'You have an invitation to CareIQ.',
      body: p('You’ve been invited to join {{app.name}}.') + p('This invitation expires in {{invitation.expires_in_days}} days.')
        + action('{{action_url}}', 'Accept invitation')
        + note('Use the email address that received this invitation. Account access and practice permissions are confirmed separately.'),
    };
    case 'mfa_enabled': return {
      heading: 'An extra layer, added.', preheader: 'Two-step verification is now enabled.',
      body: hi + p('Two-step verification is now enabled for your account with {{primary_email_address}}.') + requestDetails() + unexpected(),
    };
    case 'organization_invitation': return {
      heading: 'Your team says hello.', preheader: 'A little hello from your new team.',
      body: '{{#if inviter_name}}' + p('{{escapeURIs inviter_name}} invited you to join {{escapeURIs org.name}} in {{app.name}}.')
        + '{{else}}' + p('You’re invited to join {{escapeURIs org.name}} in {{app.name}}.') + '{{/if}}'
        + p('Accept with the email address that received this invitation. After you join, the practice owner reviews your role and location access.')
        + action('{{action_url}}', 'Accept invitation') + note('Joining does not activate clinical access. Your practice access stays pending until the owner completes that review.'),
    };
    case 'organization_invitation_accepted': return {
      heading: 'Someone joined the team.', preheader: 'A new team member is ready for your review.',
      body: p('{{email_address}} accepted an invitation to {{escapeURIs org.name}}.')
        + p('Review their role and locations in CareIQ. If access is still pending, confirm it there.')
        + action('{{app.url}}', 'Review practice access')
        + note('Accepting an invitation does not automatically activate clinical access.'),
    };
    case 'passkey_added': return {
      heading: 'Passkey added.', preheader: 'A new way to sign in, added to your account.',
      body: hi + p('A passkey ({{escapeURIs passkey_name}}) was added for your account with {{primary_email_address}}.')
        + p('If this was you, you’re all set.') + unexpected(),
    };
    case 'passkey_removed': return {
      heading: 'Passkey removed.', preheader: 'A security update for your account.',
      body: p('Hi {{greeting_name}},') + p('The passkey {{escapeURIs passkey_name}} was removed from your account with {{primary_email_address}}.') + unexpected(),
    };
    case 'password_changed': return {
      heading: 'Password updated.', preheader: 'A quick confirmation for your account.',
      body: hi + p('The password for your account with {{primary_email_address}} was changed.') + p('If this was you, you’re all set.') + unexpected(),
    };
    case 'password_removed': return {
      heading: 'A security change.', preheader: 'The password on your account was removed.',
      body: p('Hi {{greeting_name}},') + p('The password for your account with {{primary_email_address}} was removed.') + unexpected(),
    };
    case 'primary_email_address_changed': return {
      heading: 'Email updated.', preheader: 'A confirmation of your account change.',
      body: p('Your account’s primary email address was updated to {{new_email_address}}.') + unexpected()
        + note('This is an automatic security notice. Please don’t reply with account details.'),
    };
    case 'reset_password_code': return {
      heading: 'A fresh start.', preheader: 'The code for the password reset you requested.',
      body: p('Enter this code in {{app.name}} to continue resetting your password.') + code() + requestDetails()
        + note('Didn’t request this? You can ignore this email. Your password changes only after the reset is completed. Never share this code.'),
    };
    case 'new_device_sign_in': return {
      heading: 'Was this you?', preheader: 'Check that this new sign-in was yours.',
      body: p('A new device signed in to your {{app.name}} account. If you recognize it, there’s nothing else to do.')
        + p('If you don’t recognize this sign-in, open CareIQ directly to review your account security.')
        + '{{#if sign_in_method}}' + details(detail('Sign-in type', '{{sign_in_method}}')) + '{{/if}}'
        + details(detail('Device', '{{browser_name}} on {{operating_system}}') + detail('Approximate location', '{{location}}')
          + detail('IP address', '{{ip_address}}') + detail('Time', '{{session_created_at}}'))
        + '{{#if revoke_session_url}}' + p('If you don’t recognize this device, you can sign it out below.')
        + action('{{revoke_session_url}}', 'Sign out of this device') + '{{/if}}'
        + '{{#if support_email}}' + note('Need help? Contact <a href="mailto:{{support_email}}" style="color:#0067e8;text-decoration:underline">{{support_email}}</a>.') + '{{/if}}'
        + note('Location is approximate. CareIQ will never ask you to email your password or a verification code.'),
    };
    case 'verification_code': return {
      heading: 'One small check.', preheader: 'Your CareIQ verification code is inside.',
      body: p('Enter this code in {{app.name}} to complete the verification you started.') + code() + requestDetails()
        + note('Keep this code to yourself. If you didn’t request it, you can ignore this email. Never send it to someone who asks for it.'),
    };
    default: throw new Error(`Unsupported Clerk Little hello template: ${slug}.`);
  }
}

function layout(source, copy, assetBaseUrl) {
  const base = escapeAttribute(assetBaseUrl);
  return `<!doctype html>
<html lang="en" style="color-scheme:only light;background:#ffffff"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${titles[source.slug]}</title><style>:root{color-scheme:only light}html,body{margin:0!important;background-color:#ffffff!important;color:${TEXT}}a{color:${BLUE}}p,td,a{overflow-wrap:anywhere;word-break:break-word}.container{width:100%!important;max-width:560px!important}@media only screen and (max-width:480px){.careiq-card{padding:20px!important}.careiq-page{padding:24px 14px!important}.careiq-heading{font-size:30px!important}}</style></head>
<body bgcolor="#ffffff" style="margin:0;padding:0;background:#ffffff;color:${TEXT};font-family:Arial,sans-serif;color-scheme:only light">
<!-- ${CLERK_LITTLE_HELLO_MARKER} -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#ffffff">${copy.preheader}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#ffffff" style="width:100%;background:#ffffff"><tr><td class="careiq-page" align="center" style="padding:36px 18px">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" bgcolor="#ffffff" style="width:100%;max-width:560px;background:#ffffff"><tr><td style="padding:0 10px 28px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td valign="middle"><img src="${base}/careiq-wordmark.png" width="130" alt="CareIQ" style="display:block;width:130px;height:auto;border:0"></td><td align="right" valign="middle"><img src="${base}/little-hello-companion.png" width="48" height="48" alt="" role="presentation" style="display:block;width:48px;height:48px;border:0"></td></tr></table></td></tr>
<tr><td class="careiq-card" style="padding:28px;border:1px solid ${BORDER};border-radius:20px;background:#ffffff"><h1 class="careiq-heading" style="margin:0 0 22px;font:700 34px/1.15 Georgia,serif;letter-spacing:-1px;color:${BLUE}">${copy.heading}</h1>${copy.body}</td></tr>
<tr><td style="padding:24px 10px 10px;text-align:center;font:13px/1.6 Arial,sans-serif;color:${MUTED}">A little more room to care.</td></tr>
<tr><td style="padding:6px 10px;font:12px/1.6 Arial,sans-serif;color:${MUTED}">{{> footer}}</td></tr></table>
</td></tr></table></body></html>`;
}

/**
 * Render one supported reviewed source. The fingerprint must come from the
 * reviewed inspection, not a new provider fetch at the point of application.
 * The installer independently compares the live provider source before writing.
 */
export function renderClerkLittleHelloCopy(source, { assetBaseUrl, expectedSourceSha256 } = {}) {
  const original = validateContract(source, expectedSourceSha256);
  const assets = validateClerkCopyAssetBaseUrl(assetBaseUrl);
  const payload = { subject: source.subject, body: layout(source, content(source.slug), assets) };
  const replacement = structure(payload.body);
  assert(sameArray(original.control, replacement.control), `${source.slug}: mapped conditional order changed.`);
  assert(sameArray(original.hrefs, replacement.hrefs), `${source.slug}: mapped action URL count or conditional context changed.`);
  for (const [token, paths] of original.context) {
    if (token === '{{> app_logo}}') continue;
    assert(sameArray([...paths].sort(), [...(replacement.context.get(token) || [])].sort()), `${source.slug}: mapped expression conditional context changed for ${token}.`);
  }
  // The existing installer owns the sole reviewed app_logo presentation exception.
  // All remaining expressions, required variables, URLs, and safety checks apply.
  return validateReplacement(source, payload);
}
