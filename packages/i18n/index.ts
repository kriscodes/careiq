import enCommon from "./catalogs/en/common.json";
import esCommon from "./catalogs/es/common.json";
import enWorkflow from "./catalogs/en/workflow.json";
import esWorkflow from "./catalogs/es/workflow.json";
import enAccess from "./catalogs/en/access.json";
import esAccess from "./catalogs/es/access.json";
import enMobile from "./catalogs/en/mobile.json";
import esMobile from "./catalogs/es/mobile.json";
import enErrors from "./catalogs/en/errors.json";
import esErrors from "./catalogs/es/errors.json";
import { errorMessageKey } from "./error-codes";

export type Locale = "en" | "es" | "zh-Hans" | "zh-Hant" | "fil" | "vi" | "ar";
export type Direction = "ltr" | "rtl";
export type MessageValues = Readonly<Record<string, string | number>>;
export type MessageKey = keyof typeof enCommon | keyof typeof enWorkflow | keyof typeof enAccess | keyof typeof enMobile | keyof typeof enErrors;
export const locales: ReadonlyArray<{ code: Locale; name: string; englishName: string; direction: Direction; available: boolean }> = [
  { code: "en", name: "English", englishName: "English", direction: "ltr", available: true },
  { code: "es", name: "Español", englishName: "Spanish", direction: "ltr", available: true },
  { code: "zh-Hans", name: "简体中文", englishName: "Chinese · Simplified", direction: "ltr", available: false },
  { code: "zh-Hant", name: "繁體中文", englishName: "Chinese · Traditional", direction: "ltr", available: false },
  { code: "fil", name: "Filipino", englishName: "Filipino", direction: "ltr", available: false },
  { code: "vi", name: "Tiếng Việt", englishName: "Vietnamese", direction: "ltr", available: false },
  { code: "ar", name: "العربية", englishName: "Arabic", direction: "rtl", available: false },
];
export const availableLocales = locales.filter(locale => locale.available);
export const localeCookie = (scope: "staff" | "patient" = "staff") => `careiq-${scope}-locale`;

function flatten(source: object, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") result[path] = value;
    else if (value && typeof value === "object") Object.assign(result, flatten(value, path));
  }
  return result;
}
export const catalogs: Readonly<Record<"en" | "es", Readonly<Record<string, string>>>> = {
  en: Object.freeze(Object.assign({}, ...[enCommon, enWorkflow, enAccess, enMobile, enErrors].map(source => flatten(source)))),
  es: Object.freeze(Object.assign({}, ...[esCommon, esWorkflow, esAccess, esMobile, esErrors].map(source => flatten(source)))),
};

/** Only complete, enabled catalogs can become an interface preference. */
export function resolveLocale(raw?: string | null): Locale {
  if (!raw) return "en";
  const normalized = raw.trim().replaceAll("_", "-").toLowerCase();
  const exact = availableLocales.find(locale => locale.code.toLowerCase() === normalized);
  if (exact) return exact.code;
  const language = normalized.split("-")[0];
  return availableLocales.find(locale => locale.code === language)?.code ?? "en";
}
export function preferredLocale(candidates: readonly string[]): Locale {
  for (const raw of candidates) {
    const normalized = raw.trim().replaceAll("_", "-").toLowerCase();
    if (availableLocales.some(locale => normalized === locale.code.toLowerCase() || normalized.startsWith(`${locale.code.toLowerCase()}-`))) return resolveLocale(raw);
  }
  return "en";
}
export const directionOf = (locale: Locale): Direction => locales.find(item => item.code === locale)?.direction ?? "ltr";
export function acceptLanguageLocale(header?: string | null): Locale {
  const candidates = (header ?? "").split(",").map((part, index) => {
    const [language, quality] = part.trim().split(";");
    const weight = quality?.trim().startsWith("q=") ? Number(quality.trim().slice(2)) : 1;
    return { language, weight: Number.isFinite(weight) ? weight : 0, index };
  }).filter(item => item.weight > 0).sort((a,b) => b.weight-a.weight || a.index-b.index);
  return preferredLocale(candidates.map(item => item.language));
}

function closingBrace(message: string, start: number): number {
  let depth = 0;
  for (let i = start; i < message.length; i++) {
    if (message[i] === "{") depth++;
    if (message[i] === "}" && --depth === 0) return i;
  }
  return -1;
}
export function messageParameters(message: string): string[] {
  const parameters = new Set<string>();
  for (let position = 0; position < message.length; position++) {
    if (message[position] !== "{") continue;
    const end = closingBrace(message, position);
    if (end < 0) break;
    const body = message.slice(position + 1, end);
    const group = /^\s*(\w+)\s*,\s*(?:plural|select)\s*,([\s\S]*)$/.exec(body);
    if (group) {
      parameters.add(group[1]);
      let branchPosition = 0;
      const rest = group[2];
      while (branchPosition < rest.length) {
        const match = /^\s*(=?[\w.-]+)\s*\{/.exec(rest.slice(branchPosition));
        if (!match) break;
        const start = branchPosition + match[0].length - 1;
        const close = closingBrace(rest, start);
        if (close < 0) break;
        for (const name of messageParameters(rest.slice(start + 1, close))) parameters.add(name);
        branchPosition = close + 1;
      }
    } else if (/^\w+$/.test(body.trim())) parameters.add(body.trim());
    position = end;
  }
  return [...parameters].sort();
}
/** Named interpolation and ICU plural/select messages; no HTML or executable expressions. */
export function formatMessage(message: string, locale: Locale, values: MessageValues = {}, pluralValue?: number): string {
  let result = "";
  for (let position = 0; position < message.length;) {
    if (message[position] !== "{") {
      result += message[position] === "#" && pluralValue !== undefined ? formatNumber(locale, pluralValue) : message[position];
      position++;
      continue;
    }
    const end = closingBrace(message, position);
    if (end < 0) return result + message.slice(position);
    const body = message.slice(position + 1, end);
    const commas = /^\s*([\w]+)\s*,\s*(plural|select)\s*,([\s\S]*)$/.exec(body);
    if (!commas) {
      const value = values[body.trim()];
      result += value === undefined ? `{${body}}` : String(value);
    } else {
      const [, key, kind, rest] = commas;
      const branches: Record<string,string> = {};
      let branchPosition = 0;
      while (branchPosition < rest.length) {
        const match = /^\s*(=?[\w.-]+)\s*\{/.exec(rest.slice(branchPosition));
        if (!match) break;
        const start = branchPosition + match[0].length - 1;
        const close = closingBrace(rest, start);
        if (close < 0) break;
        branches[match[1]] = rest.slice(start+1,close);
        branchPosition = close+1;
      }
      const value = values[key];
      const count = typeof value === "number" ? value : Number(value);
      const selector = kind === "plural" ? `=${count}` in branches ? `=${count}` : new Intl.PluralRules(locale).select(Number.isFinite(count)?count:0) : String(value);
      result += formatMessage(branches[selector] ?? branches.other ?? "", locale, values, kind === "plural" && Number.isFinite(count) ? count : pluralValue);
    }
    position = end+1;
  }
  return result;
}

export function translate(locale: Locale | string, key: string, values?: MessageValues): string {
  const selected = resolveLocale(locale) as "en" | "es";
  const message = Object.hasOwn(catalogs[selected],key) ? catalogs[selected][key] : Object.hasOwn(catalogs.en,key) ? catalogs.en[key] : catalogs[selected]["common.unknownLabel"];
  return formatMessage(message, selected, values);
}
export function formatDate(locale: Locale | string, value: Date | string | number, options?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return translate(locale, "common.unknownLabel");
  return new Intl.DateTimeFormat(resolveLocale(locale), options).format(date);
}
export function formatNumber(locale: Locale | string, value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(resolveLocale(locale), options).format(value);
}

export type RetryHint = "read" | "idempotentWrite" | "write";
export function uiError(locale: Locale | string, error: unknown, fallbackKey = "common.error.unexpected"): string {
  const record = error && typeof error === "object" ? error as { code?: string; status?: number; message?: string; retryHint?: RetryHint } : {};
  const retry = translate(locale, `common.retry.${record.retryHint ?? "read"}`);
  const code = record.code ?? "";
  const operationalKey = errorMessageKey(code);
  if (operationalKey) return translate(locale, operationalKey, { retry });
  const map: Record<string,string> = {
    CONFIGURATION_ERROR:"common.error.unavailable", FILE_UNAVAILABLE:"common.error.fileUnavailable", UPLOAD_FAILED:"common.error.uploadFailed",
    REQUEST_TIMEOUT:"common.error.timeout", NETWORK_ERROR:"common.error.network", INVALID_RESPONSE:"common.error.invalidResponse",
    UNAUTHORIZED:"common.error.authentication", FORBIDDEN:"common.error.forbidden", NOT_FOUND:"common.error.notFound",
    CONFLICT:"common.error.conflict", REVISION_CONFLICT:"common.error.conflict", STALE_REVISION:"common.error.conflict",
    VALIDATION_ERROR:"common.error.invalid", BAD_REQUEST:"common.error.invalid", RATE_LIMITED:"common.error.rateLimited",
  };
  if (Object.hasOwn(map,code)) return translate(locale,map[code],{retry});
  if (record.status === 401) return translate(locale,"common.error.authentication");
  if (record.status === 403) return translate(locale,"common.error.forbidden");
  if (record.status === 404 || record.status === 410) return translate(locale,"common.error.notFound");
  if (record.status === 409 || record.status === 412) return translate(locale,"common.error.conflict");
  if (record.status === 429) return translate(locale,"common.error.rateLimited");
  if (record.status && record.status >= 500) return translate(locale,"common.error.server",{retry});
  if (record.status === 400 || record.status === 422) return translate(locale,"common.error.invalid");
  // Only messages explicitly present in an application catalog can pass through.
  if (record.message) {
    for (const catalog of Object.values(catalogs)) {
      const key = Object.keys(catalog).find(candidate => catalog[candidate] === record.message);
      if (key) return translate(locale,key);
    }
  }
  return translate(locale,fallbackKey);
}
