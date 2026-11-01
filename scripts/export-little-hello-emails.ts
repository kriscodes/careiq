import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { littleHelloCatalog } from '../apps/api/src/notifications/little-hello-copy.js';
import { renderLittleHelloEmail, type LittleHelloEmailInput } from '../apps/api/src/notifications/little-hello-email.js';

/** Fictional content only. This export never sends email or reads provider credentials. */
export function exportLittleHelloExamples(origin: string, assetBaseUrl?: string) {
  const examples: Record<string,string | number> = {first_name:'Alex',practice_name:'Evergreen Medical',inviter_name:'Maya Chen',teammate_name:'Alex Morgan',location_names:'Downtown',new_masked_email:'a•••@example.test',event_time:'Oct 21, 2026 at 9:41 AM PDT',device:'Chrome on macOS',approximate_location:'Los Angeles, California',provider_name:'Google',code:'482916',count:2,expires_at:'Oct 25, 2026 at 5 PM PDT'};
  const templates = littleHelloCatalog.flatMap(template => (['en','es'] as const).map(locale => {
    const keys = new Set([...JSON.stringify(template).matchAll(/\{\{([a-z_]+)\}\}/g)].map(match => match[1]!));
    const values = Object.fromEntries(Object.entries(examples).filter(([key]) => keys.has(key)));
    if (template.code) values.code = examples.code!;
    const patient = template.id.startsWith('patient_');
    const account = (template.audience as readonly string[]).includes('patient');
    const practiceRole = !patient && !account ? {kind:template.id === 'owner_welcome' || template.id === 'owner_join_review' ? 'owner' as const : 'member' as const} : undefined;
    let path = '/';
    if (template.id === 'patient_secure_request' || template.id === 'patient_secure_reminder') path = '/patient-workflow#token=example-only';
    if (template.id === 'patient_paperwork_ready' || template.id === 'patient_portal_invitation') path = '/patient-paperwork?item=example-only';
    const input: LittleHelloEmailInput = {purpose:template.id,locale,origin,assetBaseUrl,values,practiceRole,...(template.cta ? {actionUrl:origin.replace(/\/$/,'')+path} : {})};
    const result = renderLittleHelloEmail(input);
    return {id:template.id+'--'+locale,purpose:template.id,locale,subject:result.subject,html:result.html,text:result.text};
  }));
  return {schemaVersion:1,kind:'fictional-review-examples',notice:'Example names, codes, links, locations and dates only. These are not provider-variable templates and cannot send email.',templates};
}

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes('--help')) { console.log('Export Little hello email review examples.\n\n  apps/api/node_modules/.bin/tsx scripts/export-little-hello-emails.ts --origin https://APP-ORIGIN --out .local-review/email-examples [--asset-base https://APP-ORIGIN/brand/little-hello/]\n\nOffline only. No provider credentials are read and no email is sent. Existing output files are never overwritten.'); return; }
  const options: Record<string,string> = {};
  for (let index=0; index<args.length; index+=2) {
    const flag=args[index],value=args[index+1];if (!flag || !['--origin','--out','--asset-base'].includes(flag) || !value || value.startsWith('--') || options[flag]) throw new Error('Use --origin and --out, with optional --asset-base.');options[flag]=value;
  }
  if (!options['--origin'] || !options['--out']) throw new Error('--origin and --out are required.');
  const bundle=exportLittleHelloExamples(options['--origin'],options['--asset-base']);
  const directory=resolve(options['--out']);await mkdir(directory,{recursive:true});
  await writeFile(resolve(directory,'catalog.json'),JSON.stringify(bundle,null,2)+'\n',{flag:'wx',mode:0o600});
  for (const template of bundle.templates) {
    await writeFile(resolve(directory,template.id+'.html'),template.html,{flag:'wx',mode:0o600});
    await writeFile(resolve(directory,template.id+'.txt'),template.text+'\n',{flag:'wx',mode:0o600});
  }
  console.log(`Exported ${bundle.templates.length} English/Spanish review examples. Nothing was sent or applied.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error=>{console.error(error.message);process.exitCode=1;});
