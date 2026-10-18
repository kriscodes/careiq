import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptLanguageLocale, availableLocales, catalogs, directionOf, formatDate, formatMessage, formatNumber, messageParameters, resolveLocale, translate, uiError } from "../index";

test("only complete launch languages are selectable and locale negotiation is allowlisted",()=>{
  assert.deepEqual(availableLocales.map(item=>item.code),["en","es"]);
  assert.equal(resolveLocale("es-US"),"es");
  assert.equal(resolveLocale("es_MX"),"es");
  assert.equal(resolveLocale("not-a-language"),"en");
  assert.equal(resolveLocale("ar"),"en");
  assert.equal(directionOf("ar"),"rtl");
  assert.equal(acceptLanguageLocale("fr;q=1,es-MX;q=0.8,en;q=0.7"),"es");
  assert.equal(acceptLanguageLocale("es;q=0,en;q=0.9"),"en");
});

test("English and Spanish catalogs contain matching, nonblank messages and named parameters",()=>{
  const missing=Object.keys(catalogs.en).filter(key=>!(key in catalogs.es));
  const extra=Object.keys(catalogs.es).filter(key=>!(key in catalogs.en));
  assert.equal(missing.length,0,`${missing.length} missing Spanish keys: ${missing.slice(0,8).join(", ")}`);
  assert.equal(extra.length,0,`${extra.length} extra Spanish keys: ${extra.slice(0,8).join(", ")}`);
  for(const [key,value] of Object.entries(catalogs.en)){
    assert.ok(value.trim(),`Empty English message: ${key}`);
    assert.ok(catalogs.es[key]?.trim(),`Missing Spanish message: ${key}`);
    assert.deepEqual(messageParameters(catalogs.es[key]),messageParameters(value),`Parameter mismatch: ${key}`);
  }
});

test("interpolation, plural and select messages preserve supplied content as plain text",()=>{
  assert.equal(formatMessage("Hello {name}","es",{name:"<script>"}),"Hello <script>");
  assert.deepEqual(messageParameters("{count, plural, one {appointment} other {appointments}}"),["count"]);
  const copy="{count, plural, =0 {No visits} one {# visit for {name}} other {# visits for {name}}}";
  assert.equal(formatMessage(copy,"en",{count:0,name:"Alex"}),"No visits");
  assert.equal(formatMessage(copy,"en",{count:1,name:"Alex"}),"1 visit for Alex");
  assert.equal(formatMessage(copy,"en",{count:3,name:"Alex"}),"3 visits for Alex");
  assert.equal(formatMessage("{state, select, ready {Ready} other {Waiting}}","en",{state:"ready"}),"Ready");
  assert.equal(translate("es","missing.untrusted.key"),"No disponible");
  assert.equal(translate("es","__proto__"),"No disponible");
});

test("network/save errors retain uncertainty instructions without exposing server messages",()=>{
  const error={code:"NETWORK_ERROR",status:0,message:"private server trace",retryHint:"idempotentWrite"};
  const copy=uiError("es",error);
  assert.match(copy,/duplicado/);
  assert.doesNotMatch(copy,/private server/);
  assert.match(uiError("es",{...error,retryHint:"write"}),/comprobarlo/);
  assert.equal(uiError("es",{status:403,message:"patient-secret"}),translate("es","common.error.forbidden"));
  assert.equal(uiError("es",new Error("sensitive provider trace")),translate("es","common.error.unexpected"));
});

test("display dates honor a supplied clinic time zone and do not change stored instants",()=>{
  const instant="2026-10-16T16:00:00.000Z";
  assert.match(formatDate("en",instant,{hour:"numeric",minute:"2-digit",timeZone:"America/Los_Angeles"}),/9:00/);
  assert.match(formatDate("es",instant,{hour:"numeric",minute:"2-digit",timeZone:"America/Los_Angeles"}),/9:00/);
  assert.equal(instant,"2026-10-16T16:00:00.000Z");
  assert.equal(formatNumber("es",12345),new Intl.NumberFormat("es").format(12345));
});
