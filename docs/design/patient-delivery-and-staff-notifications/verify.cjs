const {chromium}=require('/Users/kristian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const directory=__dirname;
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
 const errors=[],checks=[],externalRequests=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(!r.url().startsWith('file:'))externalRequests.push(r.url())});
 await page.goto('file://'+path.join(directory,'prototype/index.html'));
 const configure=v=>page.evaluate(v=>window.careiqDesign.configure(v),v);
 const snapshot=()=>page.evaluate(()=>window.careiqDesign.snapshot());
 const click=action=>page.locator(`[data-action="${action}"]`).first().click();
 const check=async name=>{
  const result=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,visibleText:[...document.querySelectorAll('button,input,select,textarea')].filter(x=>x.getBoundingClientRect().width&&x.getBoundingClientRect().height&&!x.closest('[inert]')).filter(x=>{const b=x.getBoundingClientRect();return (b.right>innerWidth+1||b.left < -1)&&!x.closest('.tablewrap')&&!x.closest('nav')}).map(x=>x.textContent.trim().slice(0,60))}));
  checks.push({name,...result,passed:result.scroll<=result.width+1&&!result.visibleText.length});
 };
 const capture=async name=>{await page.locator('#toast').evaluate(x=>x.classList.remove('show'));await page.screenshot({path:path.join(directory,'screens',name+'.png'),fullPage:true})};
 for(const width of[1440,1024,768,390,320]){
  await page.setViewportSize({width,height:1000});
  for(const view of['delivery','reminders','templates','inbox','preferences','rules','providers','patient','states','handoff']){
   await configure({page:view,demoState:'Default',filter:'All',query:''});await check(`${view}-${width}`);
   if(width===1440||width===390&&['delivery','inbox','patient','templates'].includes(view))await capture(`${view}-${width}`);
  }
 }
 for(const width of[1440,320]){
  await page.setViewportSize({width,height:1000});
  for(const demoState of['Service unavailable','Access removed','No messages','Read only','Dispatch paused','Stale request','Unknown outcome','Opted out','No valid recipient']){await configure({page:'delivery',demoState});await check(`state-${demoState}-${width}`)}
  for(const patientState of['Secure sign-in','Copy available','Expired link','Cancelled request','Preparing copy','Access unavailable','Communication choices','Open request']){await configure({page:'patient',demoState:'Default',patientState});await check(`patient-${patientState}-${width}`)}
 }
 await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>window.careiqDesign.reset());
 await click('compose');await page.locator('#compose-channel').selectOption('Email + SMS');await click('compose-review');
 assert.match(await page.locator('dialog').innerText(),/two channel messages/);await capture('compose-review-1440');
 await click('queue-message');assert.equal((await snapshot()).deliveries.filter(x=>x.name==='Quinn Taylor').length,2);checks.push({name:'one intent per chosen channel',passed:true});
 await click('compose');await page.locator('#compose-channel').selectOption('Email + SMS');await click('compose-review');await click('queue-message');assert.equal((await snapshot()).deliveries.filter(x=>x.name==='Quinn Taylor').length,2);checks.push({name:'same initial request is not duplicated',passed:true});
 await click('detail-d2');assert.equal(await page.getByRole('button',{name:'Send reminder',exact:true}).count(),0);await click('reconcile-d2');assert.equal((await snapshot()).deliveries.find(x=>x.id==='d2').status,'Delivered');await click('close');assert.equal(await page.getByText('One SMS message has an uncertain outcome',{exact:true}).count(),0);checks.push({name:'unknown outcome reconciles original without a second send',passed:true});
 await page.locator('#location').selectOption('Northside');assert.equal(await page.getByText('Maya Patel',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Review outcome',exact:true}).count(),0);checks.push({name:'patient delivery scope filters rows and attention banner',passed:true});
 await configure({location:'All permitted locations'});await click('detail-d5');assert.match(await page.locator('dialog').innerText(),/No provider call has occurred/);assert.doesNotMatch(await page.locator('dialog').innerText(),/Attempt 1/);await click('close');checks.push({name:'queued intent does not fabricate an actual provider attempt',passed:true});
 await configure({demoState:'Read only'});await click('detail-d2');assert.equal(await page.getByRole('button',{name:'Check original send',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Review destination & access',exact:true}).count(),0);await click('close');checks.push({name:'read-only details expose no mutations',passed:true});
 await configure({page:'inbox',demoState:'Default',location:'All permitted locations'});await click('alert-n2');assert.equal((await snapshot()).alerts.find(x=>x.id==='n2').unread,false);assert.equal((await snapshot()).alerts.find(x=>x.id==='n2').current,'Overdue');await capture('staff-notification-detail-1440');await click('close');checks.push({name:'reading an overdue alert does not resolve work',passed:true});
 await page.locator('#location').selectOption('Downtown');await click('mark-all');assert.equal((await snapshot()).alerts.find(x=>x.id==='n5').unread,false);assert.equal((await snapshot()).alerts.find(x=>x.id==='n2').current,'Overdue');checks.push({name:'mark-read does not complete source work',passed:true});
 await configure({page:'rules',location:'All permitted locations'});assert.equal(await page.locator('[data-action="save-rules"]').isDisabled(),true);await page.locator('#location').selectOption('Downtown');assert.equal(await page.locator('[data-action="save-rules"]').isEnabled(),true);checks.push({name:'policy mutation requires one explicit location',passed:true});
 await configure({page:'reminders',location:'Downtown'});assert.equal(await page.locator('#auto-reminders').isChecked(),false);await page.locator('#auto-reminders').check();await click('save-reminders');assert.equal((await snapshot()).autoReminders,true);checks.push({name:'automatic reminders start off and require explicit enable',passed:true});
 await configure({page:'preferences'});await page.getByLabel('New assignments email preference').selectOption('In-app only');await click('save-preferences');await configure({page:'inbox'});await configure({page:'preferences'});assert.equal(await page.getByLabel('New assignments email preference').inputValue(),'In-app only');checks.push({name:'saved staff email preference survives local navigation',passed:true});
 await configure({page:'patient',event:'request',patientState:'Secure sign-in'});await click('patient-auth');assert.equal((await snapshot()).patientState,'Open request');assert.equal(await page.getByText('Your submission was received',{exact:true}).count(),0);checks.push({name:'request verification does not claim submission or completion',passed:true});
 await configure({page:'patient',event:'complete',patientState:'Secure sign-in'});await click('patient-auth');assert.equal((await snapshot()).patientState,'Copy available');await capture('patient-copy-1440');checks.push({name:'completed-copy journey opens authenticated library preview',passed:true});
 await page.setViewportSize({width:320,height:740});await configure({page:'delivery',demoState:'Default'});await click('compose');await check('composer-dialog-320');await capture('compose-320');await page.keyboard.press('Escape');assert.equal(await page.locator('dialog').isVisible(),false);assert.equal(await page.locator('[data-action="compose"]').evaluate(x=>x===document.activeElement),true);checks.push({name:'native dialog Escape and focus restoration',passed:true});
 await click('detail-d3');await check('failed-detail-320');await capture('delivery-failure-320');await click('close');
 await configure({page:'templates',event:'complete',channel:'SMS',locale:'es'});await check('spanish-sms-320');await capture('sms-completed-spanish-320');
 await configure({page:'patient',patientState:'Communication choices'});await check('patient-communication-choices-320');await capture('patient-communication-choices-320');
 await page.setViewportSize({width:640,height:1000});await page.addStyleTag({content:'html{font-size:200%}body{font-size:200%}button,input,select,textarea{font-size:1em!important}'});await configure({page:'inbox'});await check('enlarged-controls-inbox-640');
 const failed=checks.filter(x=>!x.passed);const result={date:'2026-10-18',scope:'Synthetic browser prototype; no live provider, authentication, database, native-device or compliance validation',checks,errors,externalRequests,passed:!failed.length&&!errors.length&&!externalRequests.length};
 await fs.writeFile(path.join(directory,'verification.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({checks:checks.length,failed,errors,externalRequests,passed:result.passed},null,2));await browser.close();assert.equal(result.passed,true);
})().catch(e=>{console.error(e);process.exitCode=1});
