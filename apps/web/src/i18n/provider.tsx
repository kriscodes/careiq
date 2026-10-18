"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { directionOf, formatDate, formatNumber, localeCookie, preferredLocale, resolveLocale, translate, uiError, type Locale, type MessageValues } from "../../../../packages/i18n";

type Scope = "staff" | "patient";
type AccountSave = (locale: Locale) => Promise<unknown>;
type I18n = {
  locale: Locale;
  direction: "ltr" | "rtl";
  scope: Scope;
  t: (key: string, values?: MessageValues) => string;
  setLocale: (locale: Locale) => void;
  formatDate: (date: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (number: number, options?: Intl.NumberFormatOptions) => string;
  uiError: (error: unknown, fallbackKey?: string) => string;
  preferenceError: string;
  ready: boolean;
  registerAccount: (locale?: string | null, save?: AccountSave, accountId?: string | null) => void;
};
const defaultContext: I18n = {
  locale:"en",direction:"ltr",scope:"staff",t:(key,values)=>translate("en",key,values),setLocale:()=>{},formatDate:(date,options)=>formatDate("en",date,options),formatNumber:(number,options)=>formatNumber("en",number,options),uiError:(error,key)=>uiError("en",error,key),preferenceError:"",ready:true,registerAccount:()=>{},
};
const Context = createContext<I18n>(defaultContext);

export function I18nProvider({children,initialLocale="en",scope="staff"}:{children:ReactNode;initialLocale?:Locale;scope?:Scope}) {
  const parentLocale=useContext(Context).locale;
  const [locale,setCurrent] = useState<Locale>(()=>resolveLocale(initialLocale));
  const [preferenceError,setPreferenceError] = useState("");
  const [ready,setReady] = useState(false);
  const accountSave = useRef<AccountSave | undefined>(undefined);
  const accountPreferenceLoaded = useRef(false);
  const accountIdentity = useRef<string | null | undefined>(undefined);
  const explicitChoice = useRef(false);
  const selectedLocale = useRef(resolveLocale(initialLocale));
  const queuedSave = useRef<{ locale: Locale; generation: number; accountId: string | null | undefined; save: AccountSave } | null>(null);
  const saving = useRef(false);
  const changeGeneration = useRef(0);
  useEffect(()=>{
    const cookieName=localeCookie(scope);
    let stored:string|null=null;
    try { stored=localStorage.getItem(cookieName); } catch { /* Storage can be disabled. */ }
    const cookie=document.cookie.split("; ").find(part=>part.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
    const detected=stored ?? cookie;
    const initial=detected ? resolveLocale(detected) : preferredLocale(navigator.languages ?? [navigator.language]);
    const timer=setTimeout(()=>{if(!accountPreferenceLoaded.current&&!explicitChoice.current){selectedLocale.current=initial;setCurrent(initial);document.cookie=`${cookieName}=${initial}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol==="https:"?"; Secure":""}`;}setReady(true);},0);
    const onStorage=(event:StorageEvent)=>{if(event.key===cookieName&&event.newValue){const next=resolveLocale(event.newValue);selectedLocale.current=next;explicitChoice.current=true;changeGeneration.current++;setCurrent(next);document.cookie=`${cookieName}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol==="https:"?"; Secure":""}`;}};
    window.addEventListener("storage",onStorage);
    return ()=>{clearTimeout(timer);window.removeEventListener("storage",onStorage);};
  },[scope]);
  useEffect(()=>{
    if (scope === "staff" && window.location.pathname.startsWith("/patient-workflow")) return;
    document.documentElement.lang=locale;
    document.documentElement.dir=directionOf(locale);
    return ()=>{if(scope==="patient"){document.documentElement.lang=parentLocale;document.documentElement.dir=directionOf(parentLocale);}};
  },[locale,scope,parentLocale]);
  const queueAccountSave=useCallback((next:Locale,generation:number)=>{
    const save=accountSave.current;
    if(!save)return;
    queuedSave.current={locale:next,generation,accountId:accountIdentity.current,save};
    if(saving.current)return;
    saving.current=true;
    void (async()=>{
      try{
        while(queuedSave.current){
          const task=queuedSave.current;queuedSave.current=null;
          if(task.accountId!==accountIdentity.current)continue;
          try{await task.save(task.locale);}catch{if(task.accountId===accountIdentity.current&&task.generation===changeGeneration.current)setPreferenceError(translate(task.locale,"common.language.saveFailed"));}
        }
      }finally{saving.current=false;}
    })();
  },[]);
  const setLocale=useCallback((raw:Locale)=>{
    const next=resolveLocale(raw);
    selectedLocale.current=next;explicitChoice.current=true;
    setCurrent(next);setPreferenceError("");
    const cookieName=localeCookie(scope);
    try { localStorage.setItem(cookieName,next); } catch { /* The active session still changes language. */ }
    document.cookie=`${cookieName}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol==="https:"?"; Secure":""}`;
    const generation=++changeGeneration.current;
    if(scope==="staff")queueAccountSave(next,generation);
  },[scope,queueAccountSave]);
  const registerAccount=useCallback((raw?:string|null,save?:AccountSave,accountId?:string|null)=>{
    const previousIdentity=accountIdentity.current;
    if(accountId!==undefined){
      if(previousIdentity!==undefined&&previousIdentity!==accountId){explicitChoice.current=false;changeGeneration.current++;queuedSave.current=null;}
      accountIdentity.current=accountId;
    }
    accountSave.current=save;
    accountPreferenceLoaded.current=!!raw;
    if(raw&&!explicitChoice.current){const next=resolveLocale(raw);selectedLocale.current=next;setCurrent(next);try{localStorage.setItem(localeCookie(scope),next);}catch{}document.cookie=`${localeCookie(scope)}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol==="https:"?"; Secure":""}`;}
    if(previousIdentity===undefined&&accountId!==undefined&&explicitChoice.current&&save)queueAccountSave(selectedLocale.current,changeGeneration.current);
  },[scope,queueAccountSave]);
  const context=useMemo<I18n>(()=>({locale,direction:directionOf(locale),scope,setLocale,registerAccount,preferenceError,ready,t:(key,values)=>translate(locale,key,values),formatDate:(date,options)=>formatDate(locale,date,options),formatNumber:(number,options)=>formatNumber(locale,number,options),uiError:(error,key)=>uiError(locale,error,key)}),[locale,scope,setLocale,registerAccount,preferenceError,ready]);
  return <Context.Provider value={context}>{children}</Context.Provider>;
}
export const useI18n=()=>useContext(Context);
