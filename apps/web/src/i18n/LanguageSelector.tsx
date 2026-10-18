"use client";

import { useId } from "react";
import { availableLocales, type Locale } from "../../../../packages/i18n";
import { useI18n } from "./provider";

export function LanguageSelector({className=""}:{className?:string}) {
  const {locale,setLocale,t,preferenceError,ready}=useI18n();
  const id=useId();
  return <div className={`cq-language ${className}`}>
    <label htmlFor={id} className="cq-visually-hidden">{t("common.language.label")}</label>
    <span className="cq-language-icon" aria-hidden="true">文<span>A</span></span>
    <select id={id} className="cq-language-select" value={locale} disabled={!ready} onChange={event=>setLocale(event.target.value as Locale)} aria-describedby={preferenceError?`${id}-error`:undefined}>
      {availableLocales.map(language=><option key={language.code} value={language.code} lang={language.code}>{language.name}</option>)}
    </select>
    <span className="cq-visually-hidden" role="status" aria-live="polite">{t("common.language.changed",{language:availableLocales.find(language=>language.code===locale)?.name ?? locale})}</span>
    {preferenceError&&<span className="cq-language-error" id={`${id}-error`} role="status">{preferenceError}</span>}
  </div>;
}
export default LanguageSelector;
