"use client";
import { useI18n } from "@/i18n/provider";
import { I18nProvider } from "@/i18n/provider";
function GlobalErrorView({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const { t, locale, direction } = useI18n();
  return <html lang={locale} dir={direction}><body style={{ margin: 0, background: "#fff", color: "#2b3832", fontFamily: "system-ui, sans-serif" }}><main style={{ maxWidth: 440, margin: "15vh auto", padding: 24 }}><p style={{ fontWeight: 700 }}>careiq</p><h1>{t("access.copy.careiq_is_unavailable_right_now")}</h1><p>{t("access.copy.we_couldn_t_open_your_account_try_again_or_contact_your_careiq_administrat")}</p><button type="button" onClick={retry} style={{ background: "#496f5a", color: "#fff", border: 0, borderRadius: 10, padding: "14px 24px", font: "inherit", cursor: "pointer" }}>{t("access.copy.try_again")}</button></main></body></html>;
}

export default function GlobalError(props: { error: Error & { digest?: string }; retry: () => void }) {
   return <I18nProvider initialLocale="en" scope="staff"><GlobalErrorView {...props} /></I18nProvider>; }
