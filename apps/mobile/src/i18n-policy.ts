import { catalogs, resolveLocale, translate, uiError, type Locale, type MessageValues } from "../../../packages/i18n";
export type LocaleScope = "staff" | "patient";
export const localeStorageKey = (scope: LocaleScope) => `careiq.locale.${scope}.v1`;
export function deviceLocale() { try { return resolveLocale(Intl.DateTimeFormat().resolvedOptions().locale); } catch { return "en" as Locale; } }
const prefix = "@@careiq-copy:";
const errorPrefix = "@@careiq-error:";
/** A local display descriptor; never a server enum, request payload, or stored patient record. */
export function copyMessage(key: string, values?: MessageValues) { return values ? prefix + JSON.stringify({ key, values }) : key; }
export function displayCopy(locale: Locale, value: string | undefined | null): string {
  if (!value) return "";
  if (value.startsWith(errorPrefix)) { try { return uiError(locale,JSON.parse(value.slice(errorPrefix.length))); } catch { return translate(locale,"common.error.unexpected"); } }
  if (value.startsWith(prefix)) { try { const parsed = JSON.parse(value.slice(prefix.length)); if (typeof parsed.key === "string" && Object.hasOwn(catalogs.en, parsed.key)) return translate(locale, parsed.key, parsed.values); } catch { /* Malformed descriptors are not executable content. */ } return translate(locale, "common.unknownLabel"); }
  return Object.hasOwn(catalogs.en, value) ? translate(locale, value) : value;
}
export class NativeCopyError extends Error { constructor(readonly key: string, readonly values?: MessageValues) { super(key); this.name = "NativeCopyError"; } }
export function nativeError(cause: unknown) {
  if (cause instanceof NativeCopyError) return copyMessage(cause.key,cause.values);
  const record=cause&&typeof cause==="object"?cause as {code?:unknown;status?:unknown;message?:unknown;retryHint?:unknown;errors?:{code?:unknown}[]}:{};
  const known=typeof record.message==="string"?Object.keys(catalogs.en).find(key=>catalogs.en[key]===record.message):undefined;
  if(known)return known;
  const code=record.code??record.errors?.[0]?.code;
  return errorPrefix+JSON.stringify({...(typeof code==="string"&&/^[A-Za-z0-9_-]{1,96}$/.test(code)?{code}:{}),...(typeof record.status==="number"&&Number.isFinite(record.status)?{status:record.status}:{}),...(["read","idempotentWrite","write"].includes(String(record.retryHint))?{retryHint:record.retryHint}:{})});
}

export type LocaleStorage = { read: (key:string)=>Promise<string|null>; write: (key:string,value:string)=>Promise<void> };
/** A late device/account preference cannot overwrite an explicit choice for the same account. */
export function createLocalePreference(scope:LocaleScope,storage:LocaleStorage) {
  let generation=0;
  let identity:string|null|undefined;
  let explicitlyChosen=false;
  let storageWrite:Promise<void>=Promise.resolve();
  return {
    async restore(apply:(locale:Locale)=>void,accountPreference?:string|null,fallback:Locale="en",accountId?:string|null) {
      if(identity!==accountId){identity=accountId;generation++;explicitlyChosen=false;}
      if(explicitlyChosen)return;
      const current=generation;
      const raw=accountPreference||await storage.read(localeStorageKey(scope));
      if(current===generation&&!explicitlyChosen)apply(raw?resolveLocale(raw):fallback);
    },
    async choose(raw:Locale,apply:(locale:Locale)=>void) {
      const locale=resolveLocale(raw);generation++;explicitlyChosen=true;apply(locale);
      const saved=storageWrite.catch(()=>{}).then(()=>storage.write(localeStorageKey(scope),locale));
      storageWrite=saved;
      await saved;
    }
  };
}

type LocaleSave = {accountId:string;locale:Locale;write:(locale:Locale)=>Promise<void>;waiters:{resolve:()=>void;reject:(error:unknown)=>void}[]};
/** Serialize profile writes and coalesce queued choices so the latest choice is saved last. */
export function createLocaleSaveQueue() {
  let accountId:string|null=null;
  let queued:LocaleSave|null=null;
  let running=false;
  async function drain() {
    if(running)return;
    running=true;
    while(queued){
      const next=queued;queued=null;
      if(next.accountId!==accountId){next.waiters.forEach(waiter=>waiter.resolve());continue;}
      try{await next.write(next.locale);next.waiters.forEach(waiter=>waiter.resolve());}
      catch(error){next.waiters.forEach(waiter=>waiter.reject(error));}
    }
    running=false;
  }
  return {
    selectAccount(next:string|null){
      if(next===accountId)return;
      accountId=next;
      queued?.waiters.forEach(waiter=>waiter.resolve());queued=null;
    },
    save(identity:string,locale:Locale,write:(locale:Locale)=>Promise<void>):Promise<void>{
      if(identity!==accountId)return Promise.resolve();
      return new Promise<void>((resolve,reject)=>{
        const waiters=queued?.accountId===identity?queued.waiters:[];
        queued={accountId:identity,locale,write,waiters:[...waiters,{resolve,reject}]};
        void drain();
      });
    }
  };
}


/** The deepest active locale scope controls mobile web's document language. */
export function createActiveLocaleRegistry(apply:(locale:Locale)=>void) {
  const entries=new Map<symbol,{depth:number;locale:Locale}>();
  function update(){const active=[...entries.values()].sort((a,b)=>b.depth-a.depth)[0];if(active)apply(active.locale);}
  return {set(id:symbol,depth:number,locale:Locale){entries.set(id,{depth,locale});update();},remove(id:symbol){entries.delete(id);update();}};
}
