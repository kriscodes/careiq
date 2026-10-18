import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import en from "../../../packages/i18n/catalogs/en/mobile.json";
import es from "../../../packages/i18n/catalogs/es/mobile.json";
import { catalogs, uiError, type Locale } from "../../../packages/i18n";
import { copyMessage, createActiveLocaleRegistry, createLocalePreference, createLocaleSaveQueue, displayCopy, localeStorageKey, NativeCopyError, nativeError } from "../src/i18n-policy";
import { displayTime } from "../src/workflow-contract";

test("staff account language and patient device language restore and save independently", async () => {
  const stored=new Map([[localeStorageKey("staff"),"es"],[localeStorageKey("patient"),"en"]]);
  const storage={read:async(key:string)=>stored.get(key)??null,write:async(key:string,value:string)=>{stored.set(key,value);}};
  const staff=createLocalePreference("staff",storage),patient=createLocalePreference("patient",storage);
  let staffLocale:Locale="en",patientLocale:Locale="es";
  await staff.restore(locale=>{staffLocale=locale;});await patient.restore(locale=>{patientLocale=locale;});
  assert.equal(staffLocale,"es");assert.equal(patientLocale,"en");
  await patient.choose("es",locale=>{patientLocale=locale;});
  await staff.choose("en",locale=>{staffLocale=locale;});
  assert.equal(stored.get(localeStorageKey("patient")),"es");assert.equal(stored.get(localeStorageKey("staff")),"en");
  await patient.restore(locale=>{patientLocale=locale;});assert.equal(patientLocale,"es");
});

test("late stored preferences cannot overwrite a language chosen while loading",async()=>{
  let release!:(locale:string)=>void;const loaded=new Promise<string>(resolve=>{release=resolve;});
  const applied:Locale[]=[];const stored=new Map<string,string>();
  const preference=createLocalePreference("patient",{read:()=>loaded,write:async(key,value)=>{stored.set(key,value);}});
  const pending=preference.restore(locale=>applied.push(locale));
  await preference.choose("en",locale=>applied.push(locale));release("es");await pending;
  assert.deepEqual(applied,["en"]);assert.equal(stored.get(localeStorageKey("patient")),"en");
});

test("saved account preference wins over the device and unavailable catalogs stay disabled",async()=>{
  const applied:Locale[]=[];const preference=createLocalePreference("staff",{read:async()=>"es",write:async()=>{}});
  await preference.restore(locale=>applied.push(locale),"en");
  await preference.choose("ar",locale=>applied.push(locale));
  assert.deepEqual(applied,["en","en"]);
});

test("deferred form labels and validation messages follow language changes without rewriting user text",()=>{
  const source=copyMessage("mobile.copy.hours_for_value0_6e88578",{value0:"Dr. Jordan Lee <original>"});
  assert.equal(displayCopy("en",source),"Hours for Dr. Jordan Lee <original>");
  assert.equal(displayCopy("es",source),"Horario de Dr. Jordan Lee <original>");
  assert.equal(displayCopy("es","Patient"),"Patient");
  assert.equal(displayCopy("es","Document received."),"Document received.");
  assert.equal(displayCopy("es",nativeError(new NativeCopyError("mobile.validation.required",{label:"correo electrónico"}))),"Ingresa correo electrónico.");
});

test("native errors discard raw server messages and preserve uncertain-save retry guidance",()=>{
  const error=nativeError({code:"NETWORK_ERROR",retryHint:"write",message:"private clinical server detail"});
  assert.equal(error.includes("private clinical"),false);
  assert.equal(displayCopy("es",error),uiError("es",{code:"NETWORK_ERROR",retryHint:"write"}));
  assert.notEqual(displayCopy("es",error),uiError("es",{code:"NETWORK_ERROR",retryHint:"read"}));
  assert.equal(displayCopy("es",nativeError({status:500,message:"private clinical server detail"})).includes("private clinical"),false);
});

test("mobile Spanish catalog is complete and preserves interpolation and plural arguments",()=>{
  assert.deepEqual(Object.keys(es).sort(),Object.keys(en).sort());
  const parameters=(value:string)=>[...new Set([...value.matchAll(/\{\s*(\w+)\s*(?:,|\})/g)].map(match=>match[1]))].sort();
  for(const[key,value]of Object.entries(en)){assert.ok((es as Record<string,string>)[key].trim(),key);assert.deepEqual(parameters((es as Record<string,string>)[key]),parameters(value),key);}
});

test("every explicit mobile catalog reference exists and locale dates retain the location time",async()=>{
  for(const folder of ["src","app"]){const dir=new URL(`../${folder}/`,import.meta.url);for(const file of(await readdir(dir)).filter(file=>/\.tsx?$/.test(file))){const source=await readFile(new URL(file,dir),"utf8");for(const match of source.matchAll(/["'`](mobile\.[A-Za-z0-9_.]+)["'`]/g)){assert.ok(Object.hasOwn(catalogs.en,match[1]),`${folder}/${file}: ${match[1]}`);}}}
  assert.match(displayTime("2026-04-18T16:00:00Z","America/Los_Angeles","es"),/abr/i);
  assert.match(displayTime("2026-04-18T16:00:00Z","America/Los_Angeles","es"),/9:00/);
});


test("late account metadata cannot undo an explicit choice but switching accounts restores their preference",async()=>{
  const applied:Locale[]=[];
  const preference=createLocalePreference("staff",{read:async()=>"en",write:async()=>{}});
  await preference.restore(locale=>applied.push(locale),undefined,"en","account-a");
  await preference.choose("es",locale=>applied.push(locale));
  await preference.restore(locale=>applied.push(locale),"en","en","account-a");
  assert.deepEqual(applied,["en","es"]);
  await preference.restore(locale=>applied.push(locale),"en","en","account-b");
  assert.deepEqual(applied,["en","es","en"]);
});

test("account profile saves run in order and coalesce to the latest queued language",async()=>{
  const queue=createLocaleSaveQueue();queue.selectAccount("account-a");
  const writes:Locale[]=[];let release!:()=>void;let stored:Locale="en";
  const first=queue.save("account-a","es",async locale=>{writes.push(locale);await new Promise<void>(resolve=>{release=resolve;});stored=locale;});
  const superseded=queue.save("account-a","es",async locale=>{writes.push(locale);stored=locale;});
  const latest=queue.save("account-a","en",async locale=>{writes.push(locale);stored=locale;});
  assert.deepEqual(writes,["es"]);release();await Promise.all([first,superseded,latest]);
  assert.deepEqual(writes,["es","en"]);assert.equal(stored,"en");
});

test("switching accounts discards queued profile saves for the previous user",async()=>{
  const queue=createLocaleSaveQueue();queue.selectAccount("account-a");
  let release!:()=>void;const writes:string[]=[];
  const first=queue.save("account-a","es",async()=>{writes.push("a-first");await new Promise<void>(resolve=>{release=resolve;});});
  const discarded=queue.save("account-a","en",async()=>{writes.push("a-stale");});
  queue.selectAccount("account-b");
  const next=queue.save("account-b","en",async()=>{writes.push("b");});
  release();await Promise.all([first,discarded,next]);
  assert.deepEqual(writes,["a-first","b"]);
});


test("device preference saves also keep the latest selection when storage is slow",async()=>{
  let release!:()=>void;let stored="en";const writes:string[]=[];
  const preference=createLocalePreference("patient",{read:async()=>null,write:async(_key,locale)=>{writes.push(locale);if(writes.length===1)await new Promise<void>(resolve=>{release=resolve;});stored=locale;}});
  const first=preference.choose("es",()=>{});const latest=preference.choose("en",()=>{});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(writes,["es"]);release();await Promise.all([first,latest]);
  assert.deepEqual(writes,["es","en"]);assert.equal(stored,"en");
});


test("the active patient document language stays independent of parent staff effects",()=>{
  const applied:Locale[]=[];const registry=createActiveLocaleRegistry(locale=>applied.push(locale));
  const staff=Symbol(),patient=Symbol();
  registry.set(staff,0,"es");registry.set(patient,1,"en");registry.set(staff,0,"es");
  assert.equal(applied.at(-1),"en");registry.set(patient,1,"es");registry.set(staff,0,"en");
  assert.equal(applied.at(-1),"es");registry.remove(patient);assert.equal(applied.at(-1),"en");
});
