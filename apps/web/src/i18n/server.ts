import { cookies, headers } from "next/headers";
import { acceptLanguageLocale, localeCookie, resolveLocale } from "../../../../packages/i18n";
export async function requestLocale(scope:"staff"|"patient"="staff") {
  const [jar,requestHeaders]=await Promise.all([cookies(),headers()]);
  const stored=jar.get(localeCookie(scope))?.value;
  return stored?resolveLocale(stored):acceptLanguageLocale(requestHeaders.get("accept-language"));
}
