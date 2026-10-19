import {test as base,expect} from '@playwright/test';
import {build} from 'esbuild';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
type Flow={requestId:string;token:string;title:string;templateVersionId:string;patientId:string};
type Staff={subject:string;bearer:string;orgId:string;locationId:string;practiceName:string;appointmentId:string;patientId:string;date:string};
type Ready={type:'ready';origin:string;subject:string;bearer:string;flows:Record<'unsigned'|'signed',Flow>;foreignLibraryId:string;staff:Staff};
type Result={immutableFactsVerified:boolean;exactPdfHashVerified:boolean;libraryCopies:number;pendingChartReviews:number;signatureFields:number;notificationIntents:number;independentIdentityVerified:boolean;sourceSha256:string;outputSha256:string;libraryId:string;frozenTitle:string};
type InsuranceResult={insuranceFactsVerified:boolean;immutableEvidenceVerified:boolean;zeroAndUnknownPreserved:boolean;evidenceCount:number;auditBusinessEvents:number;databaseEvidenceLinked:boolean;staffActorVerified:boolean};
type VerificationResult=Result|InsuranceResult;
type Harness=Ready&{verify:(flow:'unsigned'|'signed',expectedName:string)=>Promise<Result>;verifyInsurance:(caseId:string)=>Promise<InsuranceResult>};
const web=resolve(__dirname,'../..'),root=resolve(web,'../..');
async function waitWithin(promise:Promise<unknown>,milliseconds:number){
 let timer:NodeJS.Timeout|undefined;
 try{return await Promise.race([promise.then(()=>true),new Promise<false>(resolve=>{timer=setTimeout(()=>resolve(false),milliseconds);})]);}
 finally{clearTimeout(timer);}
}
export const test=base.extend<object, {realApi:Harness}>({realApi:[async({},provide)=>{
 if(process.env.CAREIQ_REAL_API_E2E!=='true')throw new Error('Set CAREIQ_REAL_API_E2E=true to run isolated real API integration.');
 const output=await mkdtemp(resolve(tmpdir(),'careiq-real-browser-'));
 let child:ChildProcess|undefined,childEnded:Promise<void>|undefined;let processClosed=false,sequence=0;
 const pending=new Map<number,{resolve:(value:VerificationResult)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>();
 let readyResolve:(value:Ready)=>void=()=>{},readyReject:(error:Error)=>void=()=>{},closedResolve:(value:unknown)=>void=()=>{};
 const ready=new Promise<Ready>((ok,bad)=>{readyResolve=ok;readyReject=bad;});const closed=new Promise<unknown>(ok=>{closedResolve=ok;});
 let closedSuccessfully=false;
 async function terminateOwnedChild(){
  if(!child||processClosed)return;
  child.kill('SIGTERM');
  if(childEnded&&!await waitWithin(childEnded,5_000)){child.kill('SIGKILL');await waitWithin(childEnded,5_000);}
 }
 try{
  await build({entryPoints:[resolve(web,'tests/browser/fixtures/real-api-entry.tsx')],outfile:resolve(output,'app.js'),bundle:true,platform:'browser',jsx:'automatic',nodePaths:[resolve(web,'node_modules')],define:{'process.env.NODE_ENV':'"test"','process.env.NEXT_PUBLIC_API_URL':'window.location.origin'},alias:{'@clerk/nextjs':resolve(web,'tests/browser/fixtures/real-api-clerk.tsx'),'next/link':resolve(web,'tests/browser/fixtures/mock-link.tsx'),'@':resolve(web,'src')},logLevel:'silent'});
  const styles=await Promise.all([resolve(web,'src/app/globals.css'),resolve(web,'src/app/access.css'),resolve(root,'packages/i18n/web.css'),resolve(web,'src/components/workflow/workflow.css')].map(path=>readFile(path,'utf8')));
  await writeFile(resolve(output,'styles.css'),styles.join('\n').replace(/@import\s+["']tailwindcss["'];/g,''),{mode:0o600});
  // API imports stay in the child, outside the web TypeScript tree. The child
  // derives a private restricted role URL only after the exact test-DB guard.
  const env:NodeJS.ProcessEnv={...process.env,CAREIQ_E2E_ASSET_DIR:output,DATABASE_URL:'',CAREIQ_AUDIT_DATABASE_URL:'',CAREIQ_SCANNER_COMMAND:''};delete env.AUDIT_READER_DATABASE_URL;
  child=spawn(process.execPath,[resolve(root,'apps/api/node_modules/tsx/dist/cli.mjs'),resolve(root,'apps/api/tests/browser-integration-server.ts')],{cwd:root,env,stdio:['ignore','ignore','ignore','ipc']});
  childEnded=new Promise<void>(resolve=>{child!.once('close',()=>{processClosed=true;resolve();});});
  const fail=(code:string)=>{const error=new Error(code);readyReject(error);for(const waiter of pending.values()){clearTimeout(waiter.timer);waiter.reject(error);}pending.clear();};
  child.on('error',()=>fail('REAL_API_CHILD_START_FAILED'));child.on('exit',()=>{if(!closedSuccessfully)fail('REAL_API_CHILD_EXITED');});
  child.on('message',(message:Ready|{type:'result';id:number;result:VerificationResult}|{type:'failure';id?:number;code:string}|{type:'closed';cleanup:unknown})=>{
   if(message.type==='ready')readyResolve(message);
   else if(message.type==='result'){const waiter=pending.get(message.id);if(waiter){clearTimeout(waiter.timer);pending.delete(message.id);waiter.resolve(message.result);}}
   else if(message.type==='closed'){closedSuccessfully=true;closedResolve(message.cleanup);}
   else fail(message.code);
  });
  const timer=setTimeout(()=>readyReject(new Error('REAL_API_FIXTURE_START_TIMEOUT')),60_000);const started=await ready.finally(()=>clearTimeout(timer));
  const verify=(flow:'unsigned'|'signed',expectedName:string)=>new Promise<Result>((ok,bad)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);bad(new Error('REAL_API_VERIFICATION_TIMEOUT'));},30_000);pending.set(id,{resolve:value=>ok(value as Result),reject:bad,timer});child!.send({type:'verify',id,flow,expectedName});});
  const verifyInsurance=(caseId:string)=>new Promise<InsuranceResult>((ok,bad)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);bad(new Error('REAL_INSURANCE_VERIFICATION_TIMEOUT'));},30_000);pending.set(id,{resolve:value=>ok(value as InsuranceResult),reject:bad,timer});child!.send({type:'verifyInsurance',id,caseId});});
  await provide({...started,verify,verifyInsurance});
 }finally{
  for(const waiter of pending.values())clearTimeout(waiter.timer);
  try{
   if(child){
    try{
     if(child.connected)child.send({type:'shutdown'},()=>{});
     // A disconnected child cannot silently bypass cleanup confirmation.
     if(!closedSuccessfully&&(!child.connected||!await waitWithin(closed,20_000)))throw new Error('REAL_API_FIXTURE_CLEANUP_UNCONFIRMED');
     expect(await closed).toEqual({ownedPracticesRemoved:true,ownedRoleRemoved:true,privateStorageRemoved:true});
     if(childEnded&&!await waitWithin(childEnded,10_000))throw new Error('REAL_API_CHILD_EXIT_UNCONFIRMED');
    }finally{await terminateOwnedChild();}
   }
  }finally{await rm(output,{recursive:true,force:true});}
 }
},{scope:'worker'}]});
export {expect};
