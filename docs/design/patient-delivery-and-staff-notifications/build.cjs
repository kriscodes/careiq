const fs=require('node:fs/promises');
const path=require('node:path');
const vm=require('node:vm');
(async()=>{
 const directory=__dirname;
 let html=await fs.readFile(path.join(directory,'prototype/index.html'),'utf8');
 const css=await fs.readFile(path.join(directory,'prototype/styles.css'),'utf8');
 const js=await fs.readFile(path.join(directory,'prototype/app.js'),'utf8');
 html=html.replace('<link rel="stylesheet" href="styles.css">',`<style>${css}</style>`).replace('<script src="app.js"></script>',`<script>${js.replaceAll('href="../','href="./')}</script>`);
 await fs.writeFile(path.join(directory,'careiq-notifications-prototype.html'),html);
 const start=js.indexOf('const copy=')+'const copy='.length;
 const end=js.indexOf('\nfunction emailPreview',start);
 const copy=vm.runInNewContext('('+js.slice(start,end).trim().replace(/;$/,'')+')',Object.create(null),{timeout:1000});
 await fs.writeFile(path.join(directory,'message-copy.json'),JSON.stringify({status:'proposed copy; synthetic approved-version fixtures do not establish production approval',version:1,providerSelected:false,translations:{en:'review required before activation',es:'translation approval required before activation'},copy,defaultLinkPolicy:'First-party fixed origin, no external shortener or tracking, request verification distinct from authenticated exact-library access',smsFooterPolicy:'Append provider/region-approved opt-out/help/rates language; calculate final encoding and segments'},null,2));
 console.log('Standalone prototype and message copy generated.');
})().catch(e=>{console.error(e);process.exitCode=1});
